import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionResponse } from "../src/api/types.ts";

function find(node: ReactNode, match: (type: unknown, props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return match(node.type, node.props) ? node.props : find(node.props.children as ReactNode, match);
}

test("Marshal create, equal-revision presence polls, ready lobby and real Start Game callback preserve authority", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-marshal-start-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "marshal-start-hooks", enforce: "pre", transform(code, id) {
      if (id.endsWith("/src/App.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
    } }] });
  const oldFetch = globalThis.fetch;
  const saved = new Map(["sessionStorage", "localStorage", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: App } = await server.ssrLoadModule("/src/App.tsx");
    const { default: Home } = await server.ssrLoadModule("/src/views/HomeView.tsx");
    const { default: Lobby } = await server.ssrLoadModule("/src/views/LobbyView.tsx");
    const { default: MarshalLobby } = await server.ssrLoadModule("/src/views/MarshalLobbyView.tsx");
    const sessions = await server.ssrLoadModule("/src/utils/session.ts");
    for (const failure of [null, "SESSION_REQUIRED", "SESSION_INVALID", "SESSION_REPLACED", "ACTOR_MISMATCH", "VIEWER_MISMATCH"]) {
      await t.test(`Start Game: ${failure ?? "valid session"}`, async () => {
        const gameId = `marshal-start-${failure ?? "valid"}`;
        const tab = new Map<string, string>(), persistent = new Map<string, string>();
        for (const [key, values] of [["sessionStorage", tab], ["localStorage", persistent]] as const) {
          Object.defineProperty(globalThis, key, { configurable: true, value: {
            getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
          } });
        }
        let poll: (() => Promise<void>) | undefined;
        Object.defineProperty(globalThis, "window", { configurable: true, value: {
          setInterval: (callback: () => Promise<void>) => { poll = callback; return 1; }, clearInterval: () => {},
        } });
        let marshal = "", active = "issued-active", starts = 0, reconnects = 0, polls = 0;
        const requests: { action?: string; header: string | null; body?: Record<string, unknown> }[] = [];
        const snapshot = (): ActionResponse => ({ game_id: gameId, revision: 2, error: null, events: [], result: {}, state: {
          meta: { phase: "lobby", marshal_id: marshal, players_order: [marshal, "p1"],
            lobby: { registration_open: true, all_players_ready: true, players: { p1: { ready: true, stage: "ready" } } },
            presence: { [marshal]: { online: polls % 2 === 0 } },
          }, zones: {},
        } });
        globalThis.fetch = async (input, options) => {
          const body = options?.body ? JSON.parse(String(options.body)) : undefined;
          const header = new Headers(options?.headers).get("X-GF-Session");
          requests.push({ action: body?.action, header, body });
          const response = snapshot();
          if (String(input).endsWith("/api/gf/new")) {
            marshal = body.creator_id;
            response.state.meta!.marshal_id = marshal;
            response.result = { session: { player_id: marshal, role: "marshal", active_session: active, reconnect_token: "issued-reconnect" } };
          } else if (String(input).endsWith("/api/gf/reconnect")) {
            reconnects++;
            assert.equal(header, null);
            assert.deepEqual(body, { game_id: gameId, reconnect_token: "issued-reconnect", takeover: false });
            active = "replacement-active";
            response.result = { session: { player_id: marshal, role: "marshal", active_session: active } };
          } else if (body?.action === "gf.start_game") {
            starts++;
            assert.deepEqual(body, { game_id: gameId, action: "gf.start_game", params: { actor_id: marshal }, view: "marshal", viewer_id: marshal });
            assert.equal(header, failure === "SESSION_REQUIRED" && starts === 1 ? null : active);
            if (failure && starts === 1) response.error = { code: failure, message: failure, details: null };
            else response.state.meta!.phase = "hook_selection";
          } else {
            polls++;
            assert.equal(header, active);
          }
          return new Response(JSON.stringify(response), { status: response.error ? 401 : 200 });
        };
        hooks.resetHooks();
        const render = () => { hooks.beginRender(); return App(); };
        await (find(render(), type => type === Home)!.onNewGame as () => Promise<void>)();
        assert.deepEqual(JSON.parse(tab.get(`gf_session:${gameId}`)!), { player_id: marshal, role: "marshal", active_session: active });
        assert.deepEqual(JSON.parse(persistent.get(`gf_reconnect:${gameId}`)!), { player_id: marshal, role: "marshal", reconnect_token: "issued-reconnect" });
        const before = [tab.get(`gf_session:${gameId}`), persistent.get(`gf_reconnect:${gameId}`)];
        render(); hooks.flushEffects();
        await new Promise(resolve => setImmediate(resolve));
        await poll!();
        assert.deepEqual([tab.get(`gf_session:${gameId}`), persistent.get(`gf_reconnect:${gameId}`)], before);
        assert.equal(sessions.loadSession(gameId).player_id, marshal);
        assert.equal(sessions.getActiveSession(gameId), active);
        assert.equal(sessions.getReconnectToken(gameId), "issued-reconnect");
        const lobby = find(render(), type => type === Lobby)!;
        assert.equal(lobby.view, "marshal");
        const start = find(MarshalLobby(lobby), (type, props) => type === "button" && props.children === "Start Game")!;
        assert.equal(start.disabled, false);
        if (failure === "SESSION_REQUIRED") tab.delete(`gf_session:${gameId}`);
        await (start.onClick as () => Promise<void>)();
        const recoverable = failure !== null && !failure.endsWith("MISMATCH");
        assert.equal(reconnects, recoverable ? 1 : 0);
        assert.equal(starts, recoverable ? 2 : 1);
        assert.equal(requests.filter(r => r.action === "gf.start_game").at(-1)!.header,
          recoverable ? "replacement-active" : "issued-active");
        assert.equal(sessions.getReconnectToken(gameId), "issued-reconnect");
        hooks.resetHooks();
      });
    }
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

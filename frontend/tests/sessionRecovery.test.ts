import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
const tick = () => new Promise(resolve => setImmediate(resolve));

test("App recovery requires explicit takeover and preserves seat, projection and credentials", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-recovery-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "recovery-hooks", enforce: "pre", transform(code, id) {
      if (id.endsWith("/src/App.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
    } }] });
  const oldFetch = globalThis.fetch;
  const saved = new Map(["sessionStorage", "localStorage", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: App } = await server.ssrLoadModule("/src/App.tsx");
    const { default: Recovery } = await server.ssrLoadModule("/src/views/SessionRecoveryView.tsx");
    const { default: Home } = await server.ssrLoadModule("/src/views/HomeView.tsx");
    const { default: ErrorView } = await server.ssrLoadModule("/src/views/ErrorView.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const { default: Pause } = await server.ssrLoadModule("/src/components/SessionPauseBanner.tsx");
    const sessions = await server.ssrLoadModule("/src/utils/session.ts");
    let scenario = 0;
    for (const entry of ["restart", "home", "displaced"] as const) {
      for (const role of ["player", "marshal"] as const) {
        await t.test(`${entry} ${role}: conflict, explicit click, busy guard, same seat and pause projection`, async () => {
          const gameId = `recovery-${scenario++}`;
          const tab = new Map<string, string>(), persistent = new Map<string, string>();
          for (const [key, values] of [["sessionStorage", tab], ["localStorage", persistent]] as const) {
            Object.defineProperty(globalThis, key, { configurable: true, value: {
              getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
              removeItem: (key: string) => values.delete(key),
            } });
          }
          let poll: (() => Promise<void>) | undefined;
          let cleared = 0;
          Object.defineProperty(globalThis, "window", { configurable: true, value: {
            setInterval: (callback: () => Promise<void>) => { poll = callback; return 1; }, clearInterval: () => { cleared++; },
          } });
          sessions.storeIssuedSession(gameId, { player_id: "seat", role, active_session: "old-active", reconnect_token: "stable-reconnect" });
          if (entry !== "home") sessions.setLastGame(gameId);
          if (entry === "restart") tab.clear();
          const credential = persistent.get(`gf_reconnect:${gameId}`);
          const snapshot = (code?: string): ActionResponse => ({ game_id: gameId, revision: 12, events: [], result: {},
            error: code ? { code, message: code, details: null } : null,
            state: code ? {} : { meta: { phase: "table", marshal_id: role === "marshal" ? "seat" : "host",
              session_pause: { paused: role === "player", reason: role === "player" ? "marshal_offline" : null },
              pending_interaction: { kind: "test", actor_id: "seat", allowed_actions: [], payload: {}, continuation: null } }, zones: {} } });
          const calls: { path: string; body?: Record<string, unknown>; header: string | null }[] = [];
          let finish: ((r: ActionResponse) => void) | undefined;
          globalThis.fetch = async (input, options) => {
            const path = String(input), body = options?.body ? JSON.parse(String(options.body)) : undefined;
            calls.push({ path, body, header: new Headers(options?.headers).get("X-GF-Session") });
            if (body?.takeover === true) {
              const result = await new Promise<ActionResponse>(resolve => { finish = resolve; });
              return new Response(JSON.stringify(result));
            }
            if (path.endsWith("/api/gf/reconnect")) {
              assert.equal(body.takeover, false);
              return new Response(JSON.stringify(snapshot("TAKEOVER_REQUIRED")), { status: 409 });
            }
            return new Response(JSON.stringify(snapshot(path.includes("view=public") ? undefined : "SESSION_REPLACED")));
          };
          hooks.resetHooks();
          const render = () => { hooks.beginRender(); return App(); };
          if (entry === "home") {
            (find(render(), type => type === Home)!.setJoinGameId as (s: string) => void)(gameId);
            await (find(render(), type => type === Home)!.onJoinGame as () => Promise<void>)();
          } else {
            render(); hooks.flushEffects(); await tick();
          }
          let tree = render(); hooks.flushEffects();
          let recovery = find(tree, type => type === Recovery)!;
          assert.ok(recovery);
          assert.equal(recovery.reason, "takeover-required");
          assert.equal(find(tree, type => type === ErrorView), undefined);
          assert.match(renderToStaticMarkup(Recovery(recovery)), /active in another browser or device/);
          assert.ok(calls.every(c => c.body?.takeover !== true));
          assert.equal(calls.filter(c => c.path.endsWith("/api/gf/reconnect")).length, 1);
          const count = calls.length;
          if (poll) { for (let i = 0; i < 4; i++) await poll(); }
          assert.equal(calls.length, count, "recovery stops private polling and reconnects");
          if (entry !== "home") assert.ok(cleared > 0);
          const click = recovery.onTakeOver as () => Promise<void>;
          const pending = click(); await tick();
          await click(); // A stale handler cannot double-submit before re-render.
          recovery = find(render(), type => type === Recovery)!;
          assert.equal(recovery.busy, true);
          const button = find(Recovery(recovery), (type, props) => type === "button" && props.disabled === true)!;
          assert.ok(button);
          assert.equal(calls.filter(c => c.body?.takeover === true).length, 1);
          assert.deepEqual(calls.at(-1)!.body, { game_id: gameId, reconnect_token: "stable-reconnect", takeover: true });
          assert.equal(calls.at(-1)!.header, null);
          const result = snapshot();
          result.result = { reconnected: true, mode: "takeover", session: { player_id: "seat", role, active_session: "new-active" } };
          finish!(result); await pending;
          tree = render();
          assert.equal(find(tree, type => type === Recovery), undefined);
          const table = find(tree, type => type === Table)!;
          assert.equal(table.currentActorId, "seat"); assert.equal(table.view, role);
          assert.deepEqual(table.resp, { ...result, result: { reconnected: true, mode: "takeover" } });
          const projected = table.resp as ActionResponse;
          assert.equal(projected.revision, 12);
          assert.equal(projected.state.meta!.pending_interaction!.actor_id, "seat");
          const pauseHtml = renderToStaticMarkup(Pause({ meta: projected.state.meta }));
          assert.equal(pauseHtml.includes("Waiting for the Marshal"), role === "player");
          assert.equal(sessions.getActiveSession(gameId), "new-active");
          assert.equal(persistent.get(`gf_reconnect:${gameId}`), credential);
          assert.ok(!JSON.stringify(table.resp).includes("new-active"));
          assert.ok(!JSON.stringify(table.resp).includes("stable-reconnect"));
          hooks.resetHooks();
        });
      }
    }
    for (const outcome of ["resume", "invalid", "cancel", "failure", "network", "takeover-invalid", "late-success"] as const) {
      await t.test(`restart recovery: ${outcome}`, async () => {
        const gameId = `recovery-${scenario++}`;
        const tab = new Map<string, string>(), persistent = new Map<string, string>();
        for (const [key, values] of [["sessionStorage", tab], ["localStorage", persistent]] as const) {
          Object.defineProperty(globalThis, key, { configurable: true, value: {
            getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
          } });
        }
        let poll: (() => Promise<void>) | undefined;
        Object.defineProperty(globalThis, "window", { configurable: true, value: {
          setInterval: (cb: () => Promise<void>) => { poll = cb; return 1; }, clearInterval: () => {},
        } });
        sessions.storeIssuedSession(gameId, { player_id: "seat", role: "marshal", active_session: "old", reconnect_token: "stable" });
        sessions.setLastGame(gameId); tab.clear();
        const credential = persistent.get(`gf_reconnect:${gameId}`);
        const response = (code?: string): ActionResponse => ({ game_id: gameId, revision: 7, events: [],
          state: code ? {} : { meta: { phase: "lobby", marshal_id: "seat", lobby: { registration_open: true } } },
          result: code ? {} : { reconnected: true, mode: "resume", session: { player_id: "seat", role: "marshal", active_session: "resumed" } },
          error: code ? { code, message: code, details: null } : null });
        const bodies: Record<string, unknown>[] = [];
        let finish: ((r: ActionResponse) => void) | undefined;
        globalThis.fetch = async (_input, options) => {
          const body = JSON.parse(String(options?.body)); bodies.push(body);
          assert.equal(new Headers(options?.headers).get("X-GF-Session"), null);
          if (body.takeover) {
            if (outcome === "network") throw new Error("network unavailable");
            if (outcome === "late-success") return new Response(JSON.stringify(await new Promise<ActionResponse>(resolve => { finish = resolve; })));
            return new Response(JSON.stringify(response(outcome === "takeover-invalid" ? "RECONNECT_INVALID" : "HTTP_500")));
          }
          assert.equal(body.takeover, false);
          return new Response(JSON.stringify(response(outcome === "resume" ? undefined : outcome === "invalid" ? "RECONNECT_INVALID" : "TAKEOVER_REQUIRED")));
        };
        hooks.resetHooks();
        const render = () => { hooks.beginRender(); return App(); };
        render(); hooks.flushEffects(); await tick();
        let tree = render();
        if (outcome === "resume") {
          assert.equal(find(tree, type => type === Recovery), undefined);
          assert.equal(sessions.getActiveSession(gameId), "resumed");
          const game = find(tree, (_type, props) => props.view === "marshal" && props.currentActorId === "seat")!;
          assert.ok(game);
          assert.equal((game.resp as ActionResponse).result.mode, "resume");
        } else {
          let recovery = find(tree, type => type === Recovery)!;
          assert.ok(recovery);
          if (outcome === "invalid") {
            assert.equal(recovery.reason, "reconnect-invalid");
            assert.match(renderToStaticMarkup(Recovery(recovery)), /no longer valid/);
            assert.equal(find(Recovery(recovery), (type, props) => type === "button" && props.children === "Take Over"), undefined);
          } else if (outcome !== "cancel") {
            const pending = (recovery.onTakeOver as () => Promise<void>)();
            if (outcome === "late-success") {
              await tick();
              (recovery.onBackHome as () => void)();
              finish!(response());
            }
            await pending;
            tree = render();
            if (outcome === "late-success") assert.ok(find(tree, type => type === Home));
            else {
              recovery = find(tree, type => type === Recovery)!;
              assert.ok(recovery); assert.equal(recovery.busy, false);
              assert.ok(recovery.errorMessage);
              assert.equal(recovery.reason, outcome === "takeover-invalid" ? "reconnect-invalid" : "takeover-required");
              assert.equal(find(tree, type => type === ErrorView), undefined);
            }
          }
          if (outcome !== "late-success") {
            if (poll) await poll();
            assert.equal(bodies.length, outcome === "invalid" || outcome === "cancel" ? 1 : 2);
            (recovery.onBackHome as () => void)();
            assert.ok(find(render(), type => type === Home));
          }
          assert.equal(sessions.getLastGame(), "");
        }
        assert.equal(persistent.get(`gf_reconnect:${gameId}`), credential);
        assert.equal(bodies.filter(b => b.takeover === true).length,
          ["failure", "network", "takeover-invalid", "late-success"].includes(outcome) ? 1 : 0);
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

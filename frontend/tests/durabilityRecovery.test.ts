import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionResponse } from "../src/api/types.ts";
import { chichimecaLiveResponse } from "./fixtures/chichimecaLiveState.ts";

function find(node: ReactNode, match: (type: unknown, props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return match(node.type, node.props) ? node.props : find(node.props.children as ReactNode, match);
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("App restart recovery and durability errors preserve authoritative state", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-durability-ui-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "durability-app-hooks", enforce: "pre", transform(code, id) {
      if (id.endsWith("/src/App.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
    } }] });
  const oldFetch = globalThis.fetch;
  const saved = new Map(["sessionStorage", "localStorage", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: App } = await server.ssrLoadModule("/src/App.tsx");
    const { default: Unavailable } = await server.ssrLoadModule("/src/views/GameUnavailableView.tsx");
    const { default: Home } = await server.ssrLoadModule("/src/views/HomeView.tsx");
    const { default: Recovery } = await server.ssrLoadModule("/src/views/SessionRecoveryView.tsx");
    const { default: ErrorView } = await server.ssrLoadModule("/src/views/ErrorView.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const sessions = await server.ssrLoadModule("/src/utils/session.ts");
    const api = await server.ssrLoadModule("/src/api/gf.ts");
    let count = 0;
    function setup(role: "player" | "marshal" = "player", home = false, sharedGameId?: string) {
      hooks.resetHooks();
      const gameId = sharedGameId ?? `11111111-1111-4111-8111-${String(count++).padStart(12, "0")}`;
      const seatId = role === "marshal" ? "marshal" : "player-nnu30f";
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
      sessions.storeIssuedSession(gameId, { player_id: seatId, role, active_session: "pre-restart-active", reconnect_token: "stable-reconnect" });
      if (!home) sessions.setLastGame(gameId);
      const credential = persistent.get(`gf_reconnect:${gameId}`);
      const snapshot = (paused = false): ActionResponse => {
        const r = structuredClone(chichimecaLiveResponse) as ActionResponse;
        r.game_id = gameId; r.revision = 42; r.result = {}; r.error = null;
        r.state.meta!.pending_interaction = null;
        r.state.meta!.session_pause = { paused, reason: paused ? "marshal_offline" : null };
        r.state.meta!.scene = { status: "active", participants: ["player-nnu30f", "player-o2o9sa"], players: { "player-nnu30f": {} } };
        return r;
      };
      const error = (code: string): ActionResponse => ({ game_id: "", revision: 42, state: {}, events: [], result: {},
        error: { code, message: "private backend details should not be displayed", details: null } });
      const resumed = (paused: boolean) => ({ ...snapshot(paused), result: { reconnected: true, mode: "resume",
        session: { player_id: seatId, role, active_session: "post-restart-active" } } });
      let replies: (ActionResponse | Error | Promise<ActionResponse>)[] = [];
      const requests: { path: string; body?: Record<string, unknown>; header: string | null }[] = [];
      globalThis.fetch = async (input, options) => {
        requests.push({ path: String(input), body: options?.body ? JSON.parse(String(options.body)) : undefined,
          header: new Headers(options?.headers).get("X-GF-Session") });
        const reply = await replies.shift();
        assert.ok(reply, "unexpected request / retry loop");
        if (reply instanceof Error) throw reply;
        return new Response(JSON.stringify(reply), { status: reply.error ? 503 : 200 });
      };
      const render = () => { hooks.beginRender(); return App(); };
      const table = () => find(render(), type => type === Table)!;
      const unavailable = () => find(render(), type => type === Unavailable)!;
      return { gameId, seatId, tab, persistent, credential, snapshot, error, resumed, requests, render, table, unavailable,
        setReplies: (...values: typeof replies) => { replies = values; },
        poll: async () => { assert.ok(poll); await poll(); },
        cleared: () => cleared,
        start: async (paused = false) => { replies = [snapshot(paused)]; render(); hooks.flushEffects(); await tick(); assert.ok(table()); },
        mutation: async () => {
          const props = table();
          return (props.run as (p: Promise<ActionResponse>) => Promise<ActionResponse>)(api.gfAction({
            game_id: gameId, action: "gf.scene_stand", params: { player_id: seatId }, view: role, viewer_id: seatId,
          }));
        },
      };
    }
    for (const role of ["player", "marshal"] as const) {
      await t.test(`${role} restart: SESSION_INVALID resumes same seat at equal revision`, async () => {
        const h = setup(role); await h.start(true);
        h.setReplies(h.error("SESSION_INVALID"), h.resumed(role === "player"), h.snapshot(role === "player"));
        await h.poll();
        assert.equal(h.requests.length, 4);
        assert.equal(h.requests[1].header, "pre-restart-active");
        assert.deepEqual(h.requests[2].body, { game_id: h.gameId, reconnect_token: "stable-reconnect", takeover: false });
        assert.equal(h.requests[3].header, "post-restart-active");
        assert.equal(sessions.getActiveSession(h.gameId), "post-restart-active");
        assert.equal(h.persistent.get(`gf_reconnect:${h.gameId}`), h.credential);
        const table = h.table();
        assert.equal(table.currentActorId, h.seatId); assert.equal(table.view, role);
        assert.equal((table.resp as ActionResponse).revision, 42);
        assert.equal(find(h.render(), type => type === Recovery), undefined);
        if (role === "player") {
          const pausedHtml = renderToStaticMarkup(createElement(Table, table));
          assert.match(pausedHtml, /THE GAME IS PAUSED/);
          assert.match(pausedHtml.match(/<button\b[^>]*title="Game paused while the Marshal is offline"[^>]*>/)![0], /disabled/);
          h.setReplies(h.snapshot(false)); await h.poll();
          const activeHtml = renderToStaticMarkup(createElement(Table, h.table()));
          assert.doesNotMatch(activeHtml, /THE GAME IS PAUSED/);
          assert.doesNotMatch(activeHtml.match(/<button\b[^>]*title="Draw a card"[^>]*>/)![0], /disabled/);
        } else assert.equal((table.resp as ActionResponse).state.meta!.session_pause!.paused, false);
      });
    }
    await t.test("transient polling network failures keep screen, state and credentials", async () => {
      const h = setup(); await h.start(); const previous = h.table().resp;
      h.setReplies(new Error("backend restarting")); await h.poll();
      assert.equal(h.table().resp, previous);
      assert.equal(find(h.render(), type => type === ErrorView), undefined);
      assert.equal(sessions.getActiveSession(h.gameId), "pre-restart-active");
      assert.equal(h.persistent.get(`gf_reconnect:${h.gameId}`), h.credential);
      h.setReplies(h.snapshot()); await h.poll(); assert.ok(h.table());
    });
    await t.test("same-revision persistence rejection preserves game and clears notice on next poll", async () => {
      const h = setup(); await h.start(); const previous = h.table().resp;
      h.setReplies(h.error("PERSISTENCE_UNAVAILABLE"));
      const result = await h.mutation();
      assert.equal(result.error!.code, "PERSISTENCE_UNAVAILABLE");
      assert.equal(h.table().resp, previous);
      assert.ok(find(h.render(), (type, props) => type === "p" && props.children === "The game could not be saved safely. Please try again."));
      assert.equal(find(h.render(), type => type === ErrorView), undefined);
      assert.equal(h.requests.length, 2);
      assert.equal(h.requests[1].body!.action, "gf.scene_stand");
      assert.ok(h.requests.every(r => r.body?.takeover !== true && !r.path.endsWith("/api/gf/reconnect")));
      assert.equal(h.persistent.get(`gf_reconnect:${h.gameId}`), h.credential);
      h.setReplies(h.snapshot()); await h.poll();
      assert.equal(find(h.render(), (_type, props) => props.children === "The game could not be saved safely. Please try again."), undefined);
      assert.equal((h.table().resp as ActionResponse).revision, 42);
    });
    await t.test("poll GAME_UNAVAILABLE stops polling; Retry stays stable then restores preserved state", async () => {
      const h = setup(); await h.start(); const previous = h.table().resp;
      h.setReplies(h.error("GAME_UNAVAILABLE")); await h.poll();
      const tree = h.render(); hooks.flushEffects();
      const unavailable = h.unavailable();
      assert.equal(unavailable.gameId, h.gameId);
      assert.match(renderToStaticMarkup(Unavailable(unavailable)), /This game is currently unavailable./);
      assert.equal(find(tree, type => type === ErrorView), undefined);
      assert.ok(h.cleared() > 0);
      const before = h.requests.length;
      await h.poll(); await h.poll(); assert.equal(h.requests.length, before);
      h.setReplies(h.error("GAME_UNAVAILABLE"));
      await (unavailable.onRetry as () => Promise<void>)();
      assert.ok(h.unavailable());
      assert.ok(h.requests.at(-1)!.path.includes(`${h.gameId}?view=public`));
      h.setReplies(new Error("backend down"));
      await (h.unavailable().onRetry as () => Promise<void>)();
      assert.ok(h.unavailable().errorMessage);
      assert.equal(h.unavailable().busy, false);
      assert.equal(h.persistent.get(`gf_reconnect:${h.gameId}`), h.credential);
      // A lower-revision read proves the retained projection was never replaced by {}.
      const older = h.snapshot(); older.revision = 41;
      h.setReplies(older, older);
      await (h.unavailable().onRetry as () => Promise<void>)();
      assert.equal(h.table().resp, previous);
      assert.equal(find(h.render(), type => type === Unavailable), undefined);
      assert.ok(h.requests.every(r => !r.path.endsWith("/api/gf/reconnect") && r.body?.takeover !== true));
      h.setReplies(h.snapshot(true)); h.render(); hooks.flushEffects(); await tick();
      assert.equal((h.table().resp as ActionResponse).state.meta!.session_pause!.paused, true);
    });
    await t.test("unavailable Retry is single-flight and Back Home retains recovery token", async () => {
      const h = setup(); await h.start();
      h.setReplies(h.error("GAME_UNAVAILABLE")); await h.poll();
      let finish: ((r: ActionResponse) => void) | undefined;
      h.setReplies(new Promise(resolve => { finish = resolve; }));
      const callback = h.unavailable().onRetry as () => Promise<void>;
      const pending = callback(); await tick(); await callback();
      assert.equal(h.unavailable().busy, true);
      assert.ok(find(Unavailable(h.unavailable()), (type, props) => type === "button" && props.disabled === true));
      (h.unavailable().onBackHome as () => void)();
      finish!(h.snapshot()); await pending;
      assert.ok(find(h.render(), type => type === Home));
      assert.equal(h.requests.length, 3);
      assert.equal(h.persistent.get(`gf_reconnect:${h.gameId}`), h.credential);
      assert.equal(sessions.getActiveSession(h.gameId), undefined);
    });
    await t.test("topology rejection preserves projection and offers no reconnect or Retry", async () => {
      const h = setup(); await h.start();
      h.setReplies(h.error("SESSION_TOPOLOGY_INVALID")); await h.mutation();
      const unavailable = h.unavailable();
      assert.equal(unavailable.reason, "topology-invalid");
      const html = renderToStaticMarkup(Unavailable(unavailable));
      assert.match(html, /This game session cannot be recovered safely./);
      assert.doesNotMatch(html, /Retry|private backend details/);
      assert.equal(h.requests.length, 2);
      assert.ok(h.requests.every(r => !r.path.endsWith("/api/gf/reconnect")));
      await h.poll(); assert.equal(h.requests.length, 2);
      assert.equal(h.persistent.get(`gf_reconnect:${h.gameId}`), h.credential);
      (unavailable.onBackHome as () => void)();
      assert.ok(find(h.render(), type => type === Home));
      assert.equal(h.persistent.get(`gf_reconnect:${h.gameId}`), h.credential);
    });
    await t.test("Home GAME_UNAVAILABLE retains requested target despite empty response game_id", async () => {
      const h = setup("player", true);
      (find(h.render(), type => type === Home)!.setJoinGameId as (s: string) => void)(h.gameId);
      h.setReplies(h.error("GAME_UNAVAILABLE"));
      await (find(h.render(), type => type === Home)!.onJoinGame as () => Promise<void>)();
      const unavailable = h.unavailable();
      assert.equal(unavailable.gameId, h.gameId);
      assert.doesNotMatch(renderToStaticMarkup(Unavailable(unavailable)), /Game not found/);
      assert.equal(h.requests.length, 1);
      h.setReplies(h.snapshot(), h.snapshot());
      await (unavailable.onRetry as () => Promise<void>)();
      assert.equal(h.table().currentActorId, h.seatId);
      assert.ok(h.requests.every(r => !r.path.endsWith("/api/gf/reconnect")));
    });
    for (const acquisition of ["new", "join"] as const) {
      await t.test(`Home ${acquisition} persistence failure is visible and issues no credentials`, async () => {
        const h = setup("player", true);
        h.tab.clear(); h.persistent.clear();
        if (acquisition === "new") {
          h.setReplies(h.error("PERSISTENCE_UNAVAILABLE"));
          await (find(h.render(), type => type === Home)!.onNewGame as () => Promise<void>)();
        } else {
          (find(h.render(), type => type === Home)!.setJoinGameId as (s: string) => void)(h.gameId);
          const lobby = h.snapshot();
          lobby.state.meta!.phase = "lobby";
          lobby.state.meta!.lobby = { registration_open: true };
          h.setReplies(lobby, h.error("PERSISTENCE_UNAVAILABLE"));
          await (find(h.render(), type => type === Home)!.onJoinGame as () => Promise<void>)();
        }
        assert.ok(find(h.render(), type => type === Home));
        assert.ok(find(h.render(), (_type, props) => props.children === "The game could not be saved safely. Please try again."));
        assert.equal(sessions.getActiveSession(h.gameId), undefined);
        assert.equal(sessions.getReconnectToken(h.gameId), undefined);
        assert.equal(sessions.getLastGame(), "");
        assert.equal(find(h.render(), type => type === ErrorView), undefined);
      });
    }
    await t.test("second browser after restart sees takeover conflict and never takes over automatically", async () => {
      const a = setup(); await a.start();
      a.setReplies(a.error("SESSION_INVALID"), a.resumed(false), a.snapshot()); await a.poll();
      assert.equal(a.requests[2].body!.takeover, false);
      const b = setup("player", false, a.gameId); await b.start();
      b.setReplies(b.error("SESSION_INVALID"), b.error("TAKEOVER_REQUIRED")); await b.poll();
      const recovery = find(b.render(), type => type === Recovery)!;
      assert.equal(recovery.reason, "takeover-required");
      assert.equal(recovery.gameId, a.gameId);
      assert.equal(b.requests.length, 3);
      assert.deepEqual(b.requests[2].body, { game_id: a.gameId, reconnect_token: "stable-reconnect", takeover: false });
      b.render(); hooks.flushEffects(); await b.poll();
      assert.equal(b.requests.length, 3);
      assert.ok(b.requests.every(r => r.body?.takeover !== true));
    });
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

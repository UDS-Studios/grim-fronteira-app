import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { acceptResponse } from "../src/utils/responseOrdering.ts";
import type { ActionResponse } from "../src/api/types.ts";

function find(node: ReactNode, type: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return node.type === type ? node.props : find(node.props.children as ReactNode, type);
}
function snapshot(revision: number, cards: string[]): ActionResponse {
  return { game_id: "ordering", revision, error: null, events: [], result: {}, state: {
    meta: { session_pause: { paused: false, reason: null }, phase: "table", marshal_id: "host", scene: { status: "setup", dark_mode: true,
      difficulty: { card_id: "9H", value: 19 }, dark: { revealed: false, marshal_total: cards.includes("8C") ? 27 : 21,
        must_discard_last: cards.includes("8C") } } },
    zones: { "scene.dark.marshal_hand": cards }, deck: { draw_pile: { count: 40 }, discard_pile: { count: revision >= 4 ? 1 : 0 } },
  } };
}

test("late polling and refresh responses cannot resurrect a discarded Dark card", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: "custom",
    plugins: [{ name: "ordering-hooks", enforce: "pre", transform(code, id) {
      if (id.endsWith("/src/App.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
    } }] });
  const originalFetch = globalThis.fetch;
  const saved = new Map(["sessionStorage", "localStorage", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: App } = await server.ssrLoadModule("/src/App.tsx");
    const { default: Home } = await server.ssrLoadModule("/src/views/HomeView.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
    for (const key of ["sessionStorage", "localStorage"]) Object.defineProperty(globalThis, key, { configurable: true, value: storage });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setInterval: () => 1, clearInterval: () => {} } });
    let tick: (() => Promise<void>) | undefined;
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setInterval: (callback: () => Promise<void>) => { tick = callback; return 1; }, clearInterval: () => {} } });
    let finishPoll: (r: Response) => void = () => {};
    globalThis.fetch = async (_input, options) => {
      if (options?.method === "POST") {
        const created = snapshot(3, ["8C"]);
        const body = JSON.parse(String(options.body));
        created.state.meta!.marshal_id = body.creator_id;
        created.result = { session: { player_id: body.creator_id, role: "marshal", active_session: "test-active", reconnect_token: "test-reconnect" } };
        return new Response(JSON.stringify(created));
      }
      return new Promise<Response>(resolve => { finishPoll = resolve; });
    };
    hooks.resetHooks();
    const render = () => { hooks.beginRender(); return App(); };
    await (find(render(), Home)!.onNewGame as () => Promise<void>)();
    const table = find(render(), Table)!;
    hooks.flushEffects();
    const run = table.run as (r: Promise<ActionResponse>) => Promise<ActionResponse>;
    await run(Promise.resolve(snapshot(4, []))); // Discard 8C.
    await run(Promise.resolve(snapshot(5, ["2D"]))); // The next physical card.
    finishPoll(new Response(JSON.stringify(snapshot(3, ["8C"]))));
    await new Promise(resolve => setImmediate(resolve));
    let current = find(render(), Table)!.resp as ActionResponse;
    assert.equal(current.revision, 5);
    assert.deepEqual(current.state.zones!["scene.dark.marshal_hand"], ["2D"]);
    await run(Promise.resolve(snapshot(4, []))); // A delayed refresh/action also cannot rewind.
    current = find(render(), Table)!.resp as ActionResponse;
    assert.equal(current.revision, 5);
    assert.deepEqual(current.state.zones!["scene.dark.marshal_hand"], ["2D"]);
    const prior = current;
    const rejected = { ...snapshot(5, []), state: {}, error: {
      code: "GAME_PAUSED", message: "The game is paused while the Marshal is offline", details: { reason: "marshal_offline" },
    } };
    const { gfAction } = await server.ssrLoadModule("/src/api/gf.ts");
    const requests: string[] = [];
    let paused = true;
    globalThis.fetch = async (input, options) => {
      requests.push(String(input));
      return new Response(JSON.stringify(options?.method === "POST" ? rejected : {
        ...snapshot(5, ["2D"]), state: { ...snapshot(5, ["2D"]).state, meta: {
          ...snapshot(5, ["2D"]).state.meta, session_pause: { paused, reason: paused ? "marshal_offline" : null },
        } },
      }));
    };
    await run(gfAction({ game_id: "ordering", action: "gf.scene_stand", params: { player_id: "host" }, view: "player", viewer_id: "host" }));
    const preserved = find(render(), Table)!;
    assert.equal(preserved.resp, prior);
    assert.equal(preserved.currentActorId, table.currentActorId);
    assert.equal(requests.length, 1, "GAME_PAUSED must not reconnect");
    await tick!();
    current = find(render(), Table)!.resp as ActionResponse;
    assert.equal(current.revision, 5);
    assert.equal(current.state.meta!.session_pause!.paused, true);
    paused = false;
    await tick!();
    current = find(render(), Table)!.resp as ActionResponse;
    assert.equal(current.state.meta!.session_pause!.paused, false);
    assert.equal(current.revision, 5);
    const presencePoll = { ...snapshot(5, ["2D"]), state: {
      ...snapshot(5, ["2D"]).state,
      meta: { ...snapshot(5, ["2D"]).state.meta, presence: { host: { online: false } } },
    } };
    await run(Promise.resolve(presencePoll));
    current = find(render(), Table)!.resp as ActionResponse;
    assert.equal(current.revision, 5);
    assert.deepEqual(current.state.meta!.presence, { host: { online: false } });
    hooks.resetHooks();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await server.close();
  }
});


test("response ordering preserves equal-revision projections and accepts a different game", () => {
  const current = snapshot(5, ["2D"]);
  const sameRevision = snapshot(5, []);
  assert.equal(acceptResponse(current, sameRevision), sameRevision);
  const differentGame = { ...snapshot(1, []), game_id: "new-game" };
  assert.equal(acceptResponse(current, differentGame), differentGame);
  assert.equal(acceptResponse(null, differentGame), differentGame);
});

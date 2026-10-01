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
    meta: { phase: "table", marshal_id: "host", scene: { status: "setup", dark_mode: true,
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
    const storage = { getItem: () => "host", setItem: () => {} };
    for (const key of ["sessionStorage", "localStorage"]) Object.defineProperty(globalThis, key, { configurable: true, value: storage });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setInterval: () => 1, clearInterval: () => {} } });
    let finishPoll: (r: Response) => void = () => {};
    globalThis.fetch = async (_input, options) => options?.method === "POST"
      ? new Response(JSON.stringify(snapshot(3, ["8C"])))
      : new Promise<Response>(resolve => { finishPoll = resolve; });
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

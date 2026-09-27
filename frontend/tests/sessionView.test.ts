import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getSessionView } from "../src/utils/sessionView.ts";
import { yankeeLiveState, YANKEE_A, YANKEE_B, INSPECTED_CARD } from "./fixtures/yankeeLiveState.ts";

test("registered players override developer inspection; Marshal keeps non-player views", () => {
  const meta = yankeeLiveState().state.meta!;
  for (const inspection of ["public", "debug"] as const) {
    assert.deepEqual(getSessionView(meta, YANKEE_A, inspection), { view: "player", viewer_id: YANKEE_A });
    assert.deepEqual(getSessionView(meta, YANKEE_B, inspection), { view: "player", viewer_id: YANKEE_B });
    assert.deepEqual(getSessionView(meta, "marshal", inspection), { view: inspection });
  }
  assert.deepEqual(getSessionView({}, "unknown"), { view: "public" });
  assert.deepEqual(getSessionView(meta, "toString"), { view: "public" });
});

// Traverse App's returned elements without evaluating child components.
function findElement(node: ReactNode, type: unknown): ReturnType<typeof createElement<Record<string, unknown>>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
  } else if (isValidElement<Record<string, unknown>>(node)) {
    if (node.type === type) return node;
    return findElement(node.props.children as ReactNode, type);
  }
}

test("App default session reconnects, polls, refreshes and renders private Yankee state; Marshal stays public", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom",
    plugins: [{
      name: "app-only-test-hooks", enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/src/App.tsx")) {
          return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
        }
      },
    }],
  });
  const originalFetch = globalThis.fetch;
  const saved = new Map(["sessionStorage", "localStorage", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: App } = await server.ssrLoadModule("/src/App.tsx");
    const { default: Home } = await server.ssrLoadModule("/src/views/HomeView.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const { default: PlayerTable } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const { default: MarshalTable } = await server.ssrLoadModule("/src/views/MarshalTableView.tsx");
    const requests: { url: URL; body?: Record<string, unknown> }[] = [];
    let poll: (() => void) | undefined;
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      setInterval: (callback: () => void) => { poll = callback; return 1; },
      clearInterval: () => { poll = undefined; },
    } });
    const render = () => { hooks.beginRender(); return App(); };
    const flush = async () => {
      hooks.flushEffects();
      await new Promise(resolve => setImmediate(resolve));
    };

    for (const actor of [YANKEE_A, YANKEE_B, "marshal"]) {
      hooks.resetHooks();
      requests.length = 0;
      const tab = new Map([["gf_player_id", actor]]);
      const storage = { getItem: (key: string) => tab.get(key) ?? null, setItem: (key: string, value: string) => tab.set(key, value) };
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
      globalThis.fetch = async (input, options) => {
        const url = new URL(String(input), "http://localhost");
        requests.push({ url, body: options?.body ? JSON.parse(String(options.body)) : undefined });
        const viewer = url.searchParams.get("view") === "player" ? url.searchParams.get("viewer_id")! : "public";
        const response = yankeeLiveState(viewer);
        response.state.meta!.scene!.status = "active";
        return new Response(JSON.stringify(response));
      };
      let tree = render();
      await flush();
      (findElement(tree, Home)!.props.setJoinGameId as (id: string) => void)("yankee-live");
      tree = render();
      await (findElement(tree, Home)!.props.onJoinGame as () => Promise<void>)();
      const expectedView = actor === "marshal" ? "public" : "player";
      assert.equal(requests[0].url.searchParams.get("view"), "public", "discovery stays public");
      assert.equal(requests.length, 2, "reconnect must fetch the session view before entering gameplay");
      assert.equal(requests[1].url.searchParams.get("view"), expectedView, "reconnect fetches correct privacy before entering game");
      assert.equal(requests[1].url.searchParams.get("viewer_id"), actor === "marshal" ? null : actor);
      tree = render();
      const table = findElement(tree, Table)!;
      assert.equal(table.props.view, expectedView, "App must pass the effective view to TableRouterView");
      const routed = Table(table.props);
      assert.equal(routed.props.children.type, actor === "marshal" ? MarshalTable : PlayerTable);
      const html = renderToStaticMarkup(createElement(Table, table.props));
      if (actor === YANKEE_A) {
        assert.ok(html.includes("Order and Profit · Inspect the top card"));
        assert.ok(html.includes("Inspected top card: 7D"));
        assert.ok(html.includes(">KEEP<") && html.includes(">BURY<"));
      } else {
        assert.ok(!html.includes(INSPECTED_CARD));
        assert.ok(!html.includes(">KEEP<") && !html.includes(">BURY<"));
        assert.ok(html.includes(actor === "marshal" ? "Reclaim interaction" : "Waiting for Yankee A"));
      }
      await flush(); // Initial polling effect.
      assert.ok(poll);
      poll!();
      await new Promise(resolve => setImmediate(resolve));
      // Refresh is App's button; child table controls are not evaluated here.
      const refresh = (function search(node: ReactNode): ReturnType<typeof findElement> {
        if (Array.isArray(node)) return node.map(search).find(Boolean);
        if (!isValidElement<Record<string, unknown>>(node)) return;
        if (node.type === "button" && node.props.children === "Refresh") return node;
        return search(node.props.children as ReactNode);
      })(tree)!;
      await (refresh.props.onClick as () => Promise<void>)();
      for (const request of requests.slice(1)) {
        assert.equal(request.url.searchParams.get("view"), expectedView);
        assert.equal(request.url.searchParams.get("viewer_id"), actor === "marshal" ? null : actor);
      }
      assert.equal(tab.get("gf_player_id"), actor, "reconnect preserves session identity");
    }
    // A fresh join must request its own private action response immediately.
    hooks.resetHooks();
    sessionStorage.setItem("gf_player_id", "new-visitor");
    requests.length = 0;
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input), "http://localhost");
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      requests.push({ url, body });
      if (!body) {
        const response = yankeeLiveState("public");
        response.state.meta!.lobby!.registration_open = true;
        return new Response(JSON.stringify(response));
      }
      assert.equal(body.action, "gf.join_lobby");
      assert.equal(body.view, "player");
      assert.equal(body.viewer_id, body.params.player_id);
      const response = yankeeLiveState(body.viewer_id, body.viewer_id);
      response.state.meta!.lobby!.players![body.viewer_id] = { chosen_name: "Joined Yankee" };
      return new Response(JSON.stringify(response));
    };
    let home = render();
    (findElement(home, Home)!.props.setJoinGameId as (id: string) => void)("yankee-live");
    home = render();
    await (findElement(home, Home)!.props.onJoinGame as () => Promise<void>)();
    const joinedTable = findElement(render(), Table)!;
    assert.equal(joinedTable.props.view, "player");
    assert.equal(joinedTable.props.currentActorId, sessionStorage.getItem("gf_player_id"));
    assert.ok(renderToStaticMarkup(createElement(Table, joinedTable.props)).includes("Inspected top card: 7D"));
    assert.equal(requests.length, 2, "no intermediate public gameplay request");

    // Game creation makes the creator Marshal regardless of a prior player session.
    hooks.resetHooks();
    requests.length = 0;
    globalThis.fetch = async (input, options) => {
      const body = JSON.parse(String(options!.body));
      requests.push({ url: new URL(String(input), "http://localhost"), body });
      assert.equal(body.view, "public");
      assert.equal(body.viewer_id, undefined);
      const response = yankeeLiveState("marshal");
      response.state.meta!.marshal_id = body.creator_id;
      return new Response(JSON.stringify(response));
    };
    home = render();
    await (findElement(home, Home)!.props.onNewGame as () => Promise<void>)();
    const createdTable = findElement(render(), Table)!;
    assert.equal(createdTable.props.view, "public");
    assert.equal(Table(createdTable.props).props.children.type, MarshalTable);
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

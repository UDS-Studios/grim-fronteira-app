import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { yankeeLiveState } from "./fixtures/yankeeLiveState.ts";

function find(node: ReactNode, match: (type: unknown, props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return match(node.type, node.props) ? node.props : find(node.props.children as ReactNode, match);
}

for (const dev of [true, false]) {
  test(`App developer controls in ${dev ? "development" : "production"}`, async t => {
    const cacheDir = await mkdtemp(join(tmpdir(), "gf-dev-controls-"));
    const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
      server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
      plugins: [{ name: "app-dev-controls-test", enforce: "pre", transform(code, id) {
        if (id.endsWith("/src/App.tsx")) code = code
          .replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
        if (/\/src\/(App|views\/(MarshalTableView|PlayerTableView))\.tsx$/.test(id)) {
          return code.replaceAll("import.meta.env.DEV", String(dev));
        }
      } }] });
    const oldFetch = globalThis.fetch;
    const saved = new Map(["sessionStorage", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    try {
      const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
      const { default: App } = await server.ssrLoadModule("/src/App.tsx");
      const { default: Home } = await server.ssrLoadModule("/src/views/HomeView.tsx");
      for (const phase of ["lobby", "hook_selection", "table", "player-table", "victory"]) {
        await t.test(phase, async () => {
          hooks.resetHooks();
          for (const key of saved.keys()) {
            const values = new Map<string, string>();
            Object.defineProperty(globalThis, key, { configurable: true, value: {
              getItem: (key: string) => values.get(key) ?? null,
              setItem: (key: string, value: string) => values.set(key, value),
              removeItem: (key: string) => values.delete(key),
            } });
          }
          const response = yankeeLiveState("marshal");
          response.revision = 37;
          const isTable = phase === "table" || phase === "player-table";
          response.state.meta!.phase = isTable ? "table" : phase;
          response.state.meta!.hooks = { suggestions: ["Test hook"] };
          const requests: string[] = [];
          globalThis.fetch = async (input, options) => {
            requests.push(String(input));
            if (options?.body) {
              const body = JSON.parse(String(options.body));
              response.state.meta!.marshal_id = phase === "player-table" ? "marshal" : body.creator_id;
              response.state.meta!.players_order = [response.state.meta!.marshal_id, body.creator_id];
              response.result = { session: { player_id: body.creator_id, role: phase === "player-table" ? "player" : "marshal", active_session: "active", reconnect_token: "reconnect" } };
            }
            return new Response(JSON.stringify(response), { status: response.error ? 400 : 200 });
          };
          const render = () => { hooks.beginRender(); return App(); };
          await (find(render(), type => type === Home)!.onNewGame as () => Promise<void>)();
          const tree = render();
          const html = renderToStaticMarkup(tree);
          for (const text of ["Non-player inspection:", "revision:", "game_id:", "phase:"]) {
            assert.equal(html.includes(text), dev, text);
          }
          assert.equal(!!find(tree, type => type === "select"), dev);
          assert.equal(!!find(tree, (type, props) => type === "input" && props.placeholder === "game_id"), dev);
          assert.equal(!!find(tree, (type, props) => type === "button" && props.children === "Home"), dev);
          const refresh = find(tree, (type, props) => type === "button" && props.children === "Refresh");
          assert.equal(!!refresh, dev);
          assert.equal(html.includes("State JSON"), dev && isTable);
          assert.equal(/<pre\b/.test(html), dev);
          assert.equal(html.includes('&quot;revision&quot;: 37'), dev);
          if (refresh) {
            await (refresh.onClick as () => Promise<void>)();
            assert.equal(requests.length, 2, "development Refresh remains functional");
          }
          if (["lobby", "table", "player-table", "victory"].includes(phase)) {
            assert.match(html, /Return to Home|Back Home|>HOME</, "normal navigation remains rendered");
            const screen = find(tree, (type, props) => typeof type === "function" && typeof props.onBackHome === "function")!;
            (screen.onBackHome as () => void)();
            assert.ok(find(render(), type => type === Home), "normal Home callback remains functional");
          }
        });
      }
      hooks.resetHooks();
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
}

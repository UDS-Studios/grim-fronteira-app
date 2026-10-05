import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function find(node: ReactNode, match: (type: unknown, props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return match(node.type, node.props) ? node.props : find(node.props.children as ReactNode, match);
}

test("Home tutorials preserve session state, source slide order, captions and native image access", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-tutorials-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)), optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "tutorial-hooks", enforce: "pre", transform(code, id) {
      if (/\/src\/(App|views\/TutorialView)\.tsx$/.test(id)) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
    } }] });
  const oldFetch = globalThis.fetch;
  const saved = new Map(["sessionStorage", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Tutorial } = await server.ssrLoadModule("/src/views/TutorialView.tsx");
    const { default: Home } = await server.ssrLoadModule("/src/views/HomeView.tsx");
    const { default: App } = await server.ssrLoadModule("/src/App.tsx");
    globalThis.fetch = async () => { throw Error("tutorial navigation must not request game actions"); };

    await t.test("Home → Tutorial → Home leaves saved credentials intact", () => {
      hooks.resetHooks();
      const stores: Map<string, string>[] = [];
      for (const key of saved.keys()) {
        const store = new Map([
          ["gf_session:saved-game", JSON.stringify({ player_id: "saved-player", role: "player", active_session: "test-session" })],
          ["gf_reconnect:saved-game", JSON.stringify({ player_id: "saved-player", role: "player", reconnect_token: "test-reconnect" })],
        ]);
        stores.push(store);
        Object.defineProperty(globalThis, key, { configurable: true, value: {
          getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value),
          removeItem: (key: string) => store.delete(key),
        } });
      }
      const render = () => { hooks.beginRender(); return App(); };
      const homeProps = find(render(), type => type === Home)!;
      const before = stores.map(store => [...store]);
      const homeTree = Home(homeProps);
      (find(homeTree, (_type, props) => props.children === "Tutorial")!.onClick as () => void)();
      const tutorial = find(render(), type => type === Tutorial)!;
      assert.ok(tutorial);
      (tutorial.onBackHome as () => void)();
      assert.ok(find(render(), type => type === Home));
      assert.deepEqual(stores.map(store => [...store]), before);
    });

    for (const [role, total] of [["marshal", 12], ["player", 13]] as const) {
      await t.test(`${role}: all ${total} slides, boundaries and role reset`, async () => {
        hooks.resetHooks();
        let homeReturns = 0;
        const render = () => { hooks.beginRender(); return Tutorial({ onBackHome: () => homeReturns++ }); };
        const button = (tree: ReactNode, label: string) => find(tree, (type, props) => type === "button" && props.children === label)!;
        const click = (tree: ReactNode, label: string) => (button(tree, label).onClick as () => void)();
        const title = role === "marshal" ? "Marshal Tutorial" : "Player Tutorial";
        click(render(), title);
        const steps = JSON.parse(await readFile(new URL(`../../docs/tutorials/${role}-tutorial/annotations/steps.json`, import.meta.url), "utf8"));
        const captures = JSON.parse(await readFile(new URL("../../docs/tutorials/captures.json", import.meta.url), "utf8"));
        const readme = await readFile(new URL(`../../docs/tutorials/${role}-tutorial/README.md`, import.meta.url), "utf8");
        const shipped = await readdir(new URL(`../public/assets/tutorials/${role}/`, import.meta.url));
        assert.equal(shipped.length, total);
        for (let index = 0; index < total; index++) {
          const tree = render();
          const step = steps[index];
          assert.equal(step.caption, captures.find((capture: { role: string; num: number }) => capture.role === role && capture.num === step.num).caption);
          assert.ok(readme.includes(step.caption));
          const markers = [...new Set([...step.caption.matchAll(/\((\d+)\)/g)].map(match => Number(match[1])))].sort((a, b) => a - b);
          assert.deepEqual(markers, Array.from({ length: step.marks.length }, (_, index) => index + 1), "every real marker is explained, with no invented numbers");
          const img = find(tree, type => type === "img")!;
          assert.equal(img.src, `/grim-fronteira/assets/tutorials/${role}/${step.filename}.png`);
          assert.equal(img.alt, `Step ${step.num}: ${step.title}. ${step.caption}`);
          assert.equal(find(tree, type => type === "figcaption")!.children, step.caption);
          assert.deepEqual(find(tree, (_type, props) => props.role === "status")!.children, ["Step ", index + 1, " of ", total]);
          assert.equal(button(tree, "Previous").disabled, index === 0);
          assert.equal(button(tree, "Next").disabled, index === total - 1);
          const fullSize = find(tree, (type, props) => type === "a" && props.children === "Open full-size image (new tab)")!;
          assert.equal(fullSize.href, img.src);
          assert.equal(fullSize.target, "_blank");
          assert.equal(fullSize.rel, "noopener noreferrer");
          const asset = await readFile(new URL(`../public/assets/tutorials/${role}/${step.filename}.png`, import.meta.url));
          const original = await readFile(new URL(`../../docs/tutorials/${role}-tutorial/images/${step.filename}.png`, import.meta.url));
          assert.deepEqual(asset, original);
          if (index !== total - 1) click(tree, "Next");
        }
        click(render(), "Next");
        assert.equal(button(render(), "Next").disabled, true);
        click(render(), "Previous");
        assert.equal(button(render(), "Next").disabled, false);
        click(render(), "Choose tutorial");
        click(render(), title);
        assert.equal(button(render(), "Previous").disabled, true, "choosing a role restarts at step 1");
        click(render(), "Previous");
        assert.equal(button(render(), "Previous").disabled, true);
        click(render(), "Back Home");
        assert.equal(homeReturns, 1);
      });
    }
    await t.test("screenshots are centered at 80% on desktop and full-width on mobile", async () => {
      const css = await readFile(new URL("../src/views/TutorialView.css", import.meta.url), "utf8");
      assert.match(css, /\.tutorial-slide img\s*\{[^}]*width: 80%;[^}]*height: auto;[^}]*margin-inline: auto;/);
      assert.match(css, /@media \(max-width: 768px\)\s*\{\s*\.tutorial-slide img\s*\{\s*width: 100%;/);
    });
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

import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { soloNarrationId } from "../src/utils/soloNarration.ts";
import type { SoloState } from "../src/api/types.ts";

function find(node: ReactNode, className: string): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(n => find(n, className)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return node.props.className === className ? node.props : find(node.props.children as ReactNode, className);
}

test("solo narrative identity survives intro/start and polls but changes for outcomes and retries", () => {
  const solo = { node: "lookout", scene_number: 8, step: "intro", attempt: 0,
    outcome: null, text: "Two enormous mastiffs wait." } as SoloState;
  const id = soloNarrationId("game", solo);
  assert.equal(soloNarrationId("game", { ...solo, step: "playing", scene_number: 9 }), id);
  assert.equal(soloNarrationId("game", { ...solo }), id);
  for (const update of [{ outcome: "failure" as const }, { attempt: 1 }, { text: "The dogs growl." }, { node: "tracking" }]) {
    assert.notEqual(soloNarrationId("game", { ...solo, ...update }), id);
  }
  assert.notEqual(soloNarrationId("new-game", solo), id);
});

test("solo typewriter timing, skip, polling, reload, reduced motion and cleanup", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-typewriter-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "narration-hooks", enforce: "pre", transform(code, id) {
      if (id.endsWith("/src/components/SoloNarration.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts?narration";');
    } }] });
  const saved = new Map(["window", "sessionStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const timers = new Map<number, () => void>();
  const stored = new Map<string, string>();
  const changes = new Set<() => void>();
  let nextTimer = 0, reduced = false;
  const media = { get matches() { return reduced; }, addEventListener: (_: string, cb: () => void) => changes.add(cb),
    removeEventListener: (_: string, cb: () => void) => changes.delete(cb) };
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => media,
      setInterval: (cb: () => void, delay: number) => { assert.equal(delay, 12); timers.set(++nextTimer, cb); return nextTimer; },
      clearInterval: (id: number) => timers.delete(id) } });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
      getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value),
    } });
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts?narration");
    const { default: Narration } = await server.ssrLoadModule("/src/components/SoloNarration.tsx");
    const text = "The mastiffs growl.";
    const render = (gameId: string, passageId = "intro", content = text) => {
      hooks.beginRender(); const tree = Narration({ gameId, passageId, text: content }); hooks.flushEffects(); return tree;
    };
    const tick = (n: number) => { for (let i = 0; i < n; i++) for (const cb of [...timers.values()]) cb(); };
    const visible = (tree: ReactNode) => (find(tree, "solo-narration-typed")!.children as unknown[])[0];

    await t.test("polling does not restart; click and keyboard-native button reveal all", () => {
      hooks.resetHooks(); let tree = render("poll");
      assert.equal(visible(tree), "");
      assert.equal(find(tree, "solo-narration-accessible")!.children, text);
      assert.equal(find(tree, "solo-narration-space")!["aria-hidden"], "true");
      tick(3); tree = render("poll"); assert.equal(visible(tree), "The");
      tick(2); tree = render("poll"); assert.equal(visible(tree), "The m");
      const button = find(tree, "solo-narration-reveal")!;
      assert.equal(button.type, "button");
      (button.onClick as () => void)(); tree = render("poll");
      assert.equal(visible(tree), text); assert.equal(timers.size, 0);
      assert.equal(find(tree, "solo-narration-reveal"), undefined);
    });
    await t.test("reload midway shows the whole passage; next passage animates", () => {
      hooks.resetHooks(); render("reload"); tick(2);
      assert.equal(stored.get("gf_solo_narration:reload"), "intro");
      hooks.resetHooks(); assert.equal(timers.size, 0);
      assert.equal(visible(render("reload")), text);
      hooks.resetHooks(); assert.equal(visible(render("reload", "outcome", "You pass.")), "");
      tick(20); assert.equal(visible(render("reload", "outcome", "You pass.")), "You pass.");
      assert.equal(timers.size, 0);
    });
    await t.test("stored passage from a previous mount is never animated", () => {
      hooks.resetHooks(); stored.set("gf_solo_narration:restored", "intro");
      assert.equal(visible(render("restored")), text); assert.equal(timers.size, 0);
    });
    await t.test("reduced motion initially and during typing reveals immediately", () => {
      hooks.resetHooks(); reduced = true;
      assert.equal(visible(render("reduced")), text); assert.equal(timers.size, 0);
      hooks.resetHooks(); reduced = false; render("changed"); tick(2);
      reduced = true; for (const cb of changes) cb();
      assert.equal(visible(render("changed")), text); assert.equal(timers.size, 0);
      reduced = false;
    });
    await t.test("unmount releases timers and media listeners", () => {
      hooks.resetHooks(); render("unmount"); assert.equal(timers.size, 1);
      hooks.resetHooks(); assert.equal(timers.size, 0); assert.equal(changes.size, 0);
    });
    await t.test("blocked browser storage does not break narration", () => {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("storage blocked"); } });
      hooks.resetHooks(); let tree = render("blocked"); assert.equal(visible(tree), "");
      (find(tree, "solo-narration-reveal")!.onClick as () => void)(); tree = render("blocked");
      assert.equal(visible(tree), text);
      hooks.resetHooks(); assert.equal(visible(render("blocked")), text);
    });
    hooks.resetHooks();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    await server.close(); await rm(cacheDir, { recursive: true, force: true });
  }
});

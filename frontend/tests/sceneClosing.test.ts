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

function find(node: ReactNode, match: (props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return match(node.props) ? node.props : find(node.props.children as ReactNode, match);
}

test("Close Scene emphasis and resource copy preserve scene actions and blockers", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-scene-closing-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "scene-closing-hooks", enforce: "pre", transform(code, id) {
      if (/\/src\/(views\/MarshalTableView|utils\/useDarkHandActions)\.tsx?$/.test(id)) {
        return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
      }
    } }] });
  const oldFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Marshal } = await server.ssrLoadModule("/src/views/MarshalTableView.tsx");
    for (const blocker of ["none", "paused", "disconnected", "pending"]) {
      await t.test(`resolved scene: ${blocker}`, async () => {
        hooks.resetHooks();
        const response = yankeeLiveState("marshal");
        response.state.meta!.scene!.status = "resolved";
        if (blocker !== "pending") response.state.meta!.pending_interaction = null;
        response.state.meta!.session_pause = { paused: blocker === "paused", reason: blocker === "paused" ? "marshal_offline" : null };
        const requests: unknown[] = [];
        globalThis.fetch = async (_url, options) => {
          requests.push(JSON.parse(String(options?.body)));
          return new Response(JSON.stringify(response));
        };
        const render = () => {
          hooks.beginRender();
          return Marshal({ resp: response, view: "marshal", currentActorId: "marshal",
            connectionLost: blocker === "disconnected", run: async (promise: Promise<unknown>) => promise, onBackHome: () => {} });
        };
        const tree = render();
        const zone = find(tree, props => props.title === "Close Scene")!;
        assert.match(String(zone.background), /color-mix.*#92513d/);
        assert.match(String(zone.borderColor), /color-mix.*#92513d/);
        const close = find(tree, props => props.label === "Close Scene")!;
        assert.equal(close.disabled, blocker !== "none");
        assert.equal(close.title, "Discard scene cards and distribute rewards");
        const copy = { Scum: "Give Scum to those who proved themselves real bastards.",
          Vengeance: "Give Vengeance to those who made justice through violence." };
        const html = renderToStaticMarkup(tree);
        for (const [label, title] of Object.entries(copy)) {
          const control = find(tree, props => props.label === label)!;
          assert.equal(control.title, title);
          assert.equal(control.disabled, blocker !== "none");
          assert.ok(html.includes(`title="${title}"`));
        }
        await (close.onClick as () => Promise<void>)();
        assert.deepEqual(requests, blocker === "none" ? [{ game_id: response.game_id, action: "gf.scene_close",
          params: { actor_id: "marshal" }, view: "marshal", viewer_id: "marshal" }] : []);

        if (blocker === "none") {
          for (const [label, bonusType] of [["Scum", "scum"], ["Vengeance", "vengeance"]]) {
            requests.length = 0;
            (find(render(), props => props.label === label)!.onClick as () => void)();
            assert.equal(requests.length, 0, "resource selection does not submit until a player is chosen");
            const player = find(render(), props => typeof props.onToggle === "function" &&
              isValidElement<Record<string, unknown>>(props.children) && props.children.props.playerId === "yankee-a" &&
              props.children.props.footerNote === `Click to assign ${bonusType.toUpperCase()}`)!;
            assert.ok(player, "selecting the resource enables the existing player target");
            assert.equal(player.disabled, false);
            await (player.onToggle as () => Promise<void>)();
            assert.deepEqual(requests, [{ game_id: response.game_id, action: "gf.scene_assign_bonus_card",
              params: { actor_id: "marshal", player_id: "yankee-a", bonus_type: bonusType },
              view: "marshal", viewer_id: "marshal" }]);
          }
        }
      });
    }
    for (const status of ["idle", "setup", "active", "closed"]) {
      await t.test(`Close Scene remains unavailable in ${status}`, () => {
        hooks.resetHooks();
        const response = yankeeLiveState("marshal");
        response.state.meta!.scene!.status = status;
        response.state.meta!.pending_interaction = null;
        const tree = Marshal({ resp: response, view: "marshal", currentActorId: "marshal",
          run: () => { throw Error("render must not submit"); }, onBackHome: () => {} });
        assert.equal(find(tree, props => props.label === "Close Scene"), undefined);
        if (status === "closed") {
          const zone = find(tree, props => props.title === "Next Scene")!;
          assert.equal(zone.background, undefined);
          assert.equal(zone.borderColor, undefined);
          assert.equal(find(tree, props => props.label === "New Scene")!.disabled, false);
        }
      });
    }
    hooks.resetHooks();
  } finally {
    globalThis.fetch = oldFetch;
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

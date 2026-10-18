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

function find(node: ReactNode, match: (props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return match(node.props) ? node.props : find(node.props.children as ReactNode, match);
}

function response(): ActionResponse {
  return { game_id: "solo", revision: 7, events: [], result: {}, error: null, state: {
    meta: { mode: "solo", phase: "table", players_order: ["solo_marshal", "solo_player"], marshal_id: "solo_marshal",
      solo: { adventure_id: "malopasso", version: 1, adventure_title: "The Road to Malopasso", node: "gun",
        step: "playing", attempt: 0, scene_number: 1, title: "A gun before sundown", text: "Convince the trader.",
        has_gun: false, outlaw_defeated: false, invitation: "Multiplayer is more fun: try Azzardo and Dark mode.",
        outcome: null, ending: null, needs_heal: false, needs_discard: false, history: [] },
      scene: { status: "active", participants: ["solo_player"], difficulty: { value: 18 },
        players: { solo_player: { hand_value: 16, acknowledged: false, busted: false } } } },
    zones: { "players.solo_player.character": ["KS"], "scene.hand.solo_player": ["6D"],
      "players.solo_player.scum": [], "players.solo_player.vengeance": ["2H"] } } };
}

test("solo story, selection warning, request authority, terminal invitation and recovery choices", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-solo-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "solo-hooks", enforce: "pre", transform(code, id) {
      if (id.endsWith("/src/views/SoloAdventureView.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
    } }] });
  const originalFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Solo } = await server.ssrLoadModule("/src/views/SoloAdventureView.tsx");
    let multiplayer = 0;
    let retries = 0;
    const render = (resp = response(), connectionLost = false) => {
      hooks.beginRender();
      return Solo({ resp, playerId: "solo_player", connectionLost,
        run: async (p: Promise<ActionResponse>) => p, onMultiplayer: () => multiplayer++, onRetry: async () => { retries++; } });
    };
    await t.test("story and limitations use authoritative state without fake NPC targets", () => {
      hooks.resetHooks();
      const html = renderToStaticMarkup(render());
      assert.match(html, /Convince the trader/);
      assert.match(html, /Target 18/);
      assert.match(html, /Chichimeca.*no eligible target/);
      assert.equal(find(render(), props => props.children === "Draw")?.disabled, false);
      assert.equal(find(render(response(), true), props => props.children === "Draw")?.disabled, true);
    });
    await t.test("draw sends expected revision once even on rapid repeat", async () => {
      hooks.resetHooks();
      const requests: Record<string, unknown>[] = [];
      let resolve: (response: Response) => void = () => {};
      globalThis.fetch = async (_url, opts) => {
        requests.push(JSON.parse(String(opts?.body)));
        return new Promise<Response>(done => { resolve = done; });
      };
      const button = find(render(), props => props.children === "Draw")!;
      const first = (button.onClick as () => Promise<void>)();
      await (button.onClick as () => Promise<void>)();
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0], { game_id: "solo", action: "gf.scene_draw_card",
        params: { player_id: "solo_player" }, view: "player", viewer_id: "solo_player", expected_revision: 7 });
      resolve(new Response(JSON.stringify(response())));
      await first;
    });
    await t.test("selecting Chichimeca warns before character is claimed", () => {
      hooks.resetHooks();
      const resp = response();
      resp.state.meta!.phase = "lobby";
      resp.state.zones!["players.solo_player.character"] = [];
      const choice = find(render(resp), props => props["aria-label"] === "KS Chichimeca")!;
      (choice.onClick as () => void)();
      const html = renderToStaticMarkup(render(resp));
      assert.match(html, /Solo limitation/);
      assert.match(html, /disadvantage/);
      assert.match(html, /Play Chichimeca/);
    });
    await t.test("every ending promotes Azzardo and Dark and offers multiplayer and replay", async () => {
      for (const ending of ["death", "ascension", "exhaustion"] as const) {
        hooks.resetHooks();
        const resp = response();
        resp.state.meta!.solo!.ending = ending;
        resp.state.meta!.solo!.step = "ending";
        resp.state.meta!.phase = "victory";
        const tree = render(resp);
        const html = renderToStaticMarkup(tree);
        assert.match(html, /Azzardo and Dark/);
        assert.equal(find(tree, props => props.children === "Draw"), undefined);
        (find(tree, props => props.children === "Play multiplayer")!.onClick as () => void)();
        await (find(tree, props => props.children === (ending === "death" ? "Retry solo" : "Play solo again"))!.onClick as () => Promise<void>)();
      }
      assert.equal(multiplayer, 3);
      assert.equal(retries, 3);
    });
    await t.test("healing and overflow prevent advancing without required decisions", () => {
      hooks.resetHooks();
      const resp = response();
      resp.state.meta!.solo!.step = "outcome";
      resp.state.meta!.solo!.outcome = "success";
      resp.state.meta!.solo!.needs_heal = true;
      assert.equal(find(render(resp), props => props.children === "Continue the trail")!.disabled, true);
      resp.state.meta!.solo!.needs_heal = false;
      resp.state.meta!.solo!.needs_discard = true;
      assert.equal(find(render(resp), props => props.children === "Continue the trail")!.disabled, true);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

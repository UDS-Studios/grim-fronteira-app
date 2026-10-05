import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { yankeeLiveState, YANKEE_A, YANKEE_B, INSPECTED_CARD } from "./fixtures/yankeeLiveState.ts";
import { chichimecaLiveResponse } from "./fixtures/chichimecaLiveState.ts";

function find(node: ReactNode, match: (props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return match(node.props) ? node.props : find(node.props.children as ReactNode, match)
    ?? find(node.props.resourceActions as ReactNode, match);
}

test("shared brass panels mark only active faction choices and preserve controls and privacy", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-faction-panels-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "faction-panel-hooks", enforce: "pre", transform(code, id) {
      if (/\/src\/(views\/PlayerTableView|utils\/useDarkHandActions)\.tsx?$/.test(id)) {
        return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
      }
    } }] });
  const oldFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Player } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const render = (response: unknown, actor = YANKEE_A, connectionLost = false) => {
      hooks.beginRender();
      return Player({ resp: response, currentActorId: actor, view: "player", connectionLost,
        run: async (promise: Promise<unknown>) => promise, onBackHome: () => {} });
    };
    const hasGold = (tree: ReactNode) => renderToStaticMarkup(tree).includes("faction-power-panel");
    for (const faction of ["criollo", "paisa"]) {
      await t.test(`${faction} selection and cancellation`, () => {
        hooks.resetHooks();
        const response = yankeeLiveState();
        response.state.meta!.pending_interaction = null;
        response.state.meta!.scene!.status = "active";
        response.state.zones![`players.${YANKEE_A}.character`] = [faction === "criollo" ? "QD" : "QC"];
        response.state.zones![`players.${YANKEE_A}.scum`] = ["2H"];
        response.state.zones![`players.${YANKEE_A}.vengeance`] = ["3H", "4D", "5C"];
        globalThis.fetch = async () => { throw Error("selection and cancellation must not submit"); };
        const startText = faction === "criollo" ? "Law of Lead · Convert" : "Heart of Shadow · Claim Reward";
        assert.equal(hasGold(render(response)), false, "available power alone does not tint ordinary UI");
        (find(render(response), props => props.children === startText)!.onClick as () => void)();
        const tree = render(response);
        assert.equal(hasGold(tree), true);
        assert.ok(find(tree, props => props.className === "faction-power-panel"));
        const confirmText = faction === "criollo" ? "Confirm conversion" : "Discard 3 · Claim Reward";
        assert.equal(find(tree, props => props.children === confirmText)!.disabled, true, "selection is still required");
        assert.equal(find(render(response, YANKEE_A, true), props => props.children === confirmText)!.disabled, true);
        (find(tree, props => props.children === "Cancel")!.onClick as () => void)();
        assert.equal(hasGold(render(response)), false);
      });
    }
    await t.test("Yankee choices remain private and use unchanged requests", async () => {
      for (const busy of [false, true]) {
        hooks.resetHooks();
        const response = yankeeLiveState();
        const requests: unknown[] = [];
        globalThis.fetch = async (_url, options) => {
          requests.push(JSON.parse(String(options?.body)));
          return new Response(JSON.stringify(response));
        };
        const tree = render(response, YANKEE_A, busy);
        assert.equal(hasGold(tree), true);
        const deck = find(tree, props => typeof props.onChoose === "function")!;
        assert.equal(deck.busy, busy);
        const html = renderToStaticMarkup(tree);
        assert.ok(html.includes(`Inspected top card: ${INSPECTED_CARD}`));
        for (const choice of ["keep", "bury"]) {
          const button = html.match(new RegExp(`<button\\b[^>]*>\\s*${choice.toUpperCase()}\\s*</button>`))![0];
          assert.equal(button.includes('disabled=""'), busy);
          await (deck.onChoose as (choice: string) => Promise<void>)(choice);
        }
        assert.deepEqual(requests, busy ? [] : ["keep", "bury"].map(choice => ({
          game_id: response.game_id, action: "gf.faction_yankee_choose_top_card",
          params: { player_id: YANKEE_A, choice }, view: "player", viewer_id: YANKEE_A,
        })));
        hooks.resetHooks();
        const other = render(yankeeLiveState(YANKEE_B), YANKEE_B);
        assert.equal(hasGold(other), false);
        assert.ok(!renderToStaticMarkup(other).includes(`Inspected top card: ${INSPECTED_CARD}`));
        assert.equal(find(other, props => typeof props.onChoose === "function"), undefined);
      }
    });
    await t.test("Chichimeca target prompt is brass only for the acting player", () => {
      hooks.resetHooks();
      const tree = render(chichimecaLiveResponse, "player-nnu30f");
      assert.equal(hasGold(tree), true);
      assert.equal(find(tree, props => props.children === "Confirm target")!.disabled, true);
      hooks.resetHooks();
      assert.equal(hasGold(render(chichimecaLiveResponse, "player-o2o9sa")), false);
    });
    await t.test("inactive and generic pending states have no brass panel", () => {
      for (const pending of [null, { kind: "ordinary-choice", actor_id: YANKEE_A, allowed_actions: [], payload: {}, continuation: null }]) {
        hooks.resetHooks();
        const response = yankeeLiveState();
        response.state.meta!.pending_interaction = pending;
        assert.equal(hasGold(render(response)), false);
      }
    });
    const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
    assert.match(css, /\.faction-power-panel\s*\{[^}]*background: color-mix[^}]*#9a7b3c[^}]*border: 1px solid color-mix[^}]*#9a7b3c[^}]*color: var\(--text-primary\)/);
    hooks.resetHooks();
  } finally {
    globalThis.fetch = oldFetch;
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

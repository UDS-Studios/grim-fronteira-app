import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { ActionRequest, ActionResponse } from "../src/api/types.ts";
import { getDarkOpeningCount, getDarkExtraCount, getDarkHiddenCardCount, getProjectedCardCount, getDarkPlayerStatus } from "../src/utils/dark.ts";
import { getViewportFit } from "../src/utils/viewportFit.ts";

function fixture(opening = 1, extras = 2): ActionResponse {
  return { game_id: "dark-player", revision: 10, error: null, events: [], result: {}, state: {
    meta: { phase: "table", marshal_id: "host", players_order: ["p1", "p2"],
      scene: { status: "active", mode: "standard", dark_mode: true,
        difficulty: { card_id: null, value: null }, dark: { revealed: false },
        participants: ["p1", "p2"], players: { p1: {}, p2: {} } } },
    zones: { "scene.difficulty": { count: opening }, "scene.dark.marshal_hand": { count: extras },
      "players.p1.character": ["KC"], "scene.hand.p1": ["2S"], "players.p2.character": ["QD"] },
    deck: { draw_pile: { count: 40 }, discard_pile: { count: 3 } },
  } };
}
function revealed(): ActionResponse {
  const response = fixture();
  response.state.meta!.scene!.status = "awaiting_ack";
  response.state.meta!.scene!.dark = { revealed: true, marshal_total: 17 };
  response.state.meta!.scene!.difficulty = { card_id: "RJ", value: 20 };
  response.state.zones!["scene.difficulty"] = ["RJ"];
  response.state.zones!["scene.dark.marshal_hand"] = ["AH", "5D"];
  return response;
}

test("Dark counts read only projected zones and reject malformed counts", () => {
  const state = fixture().state;
  assert.equal(getDarkOpeningCount(state), 1);
  assert.equal(getDarkExtraCount(state), 2);
  assert.equal(getDarkHiddenCardCount(state), 3);
  assert.equal(getDarkHiddenCardCount({}), 0);
  assert.equal(getDarkHiddenCardCount(revealed().state), 3);
  for (const zone of [undefined, null, {}, { count: -1 }, { count: 1.5 }, { count: Infinity }, { count: NaN }, { count: "2" }]) {
    assert.equal(getProjectedCardCount(zone), 0);
  }
  assert.equal(getProjectedCardCount(["RJ", "AH"]), 2);
  assert.equal(getProjectedCardCount({ count: 0 }), 0);
  assert.equal(getProjectedCardCount({ count: 54 }), 54);
});

test("player Dark hand counts, privacy, reveal order, totals and contextual status", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { default: Hand } = await server.ssrLoadModule("/src/components/PlayerDarkHand.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const hand = (response: ActionResponse) => renderToStaticMarkup(createElement(Hand, { state: response.state }));
    const table = (response: ActionResponse, actor = "p1") => renderToStaticMarkup(createElement(Table,
      { resp: response, currentActorId: actor, view: "player", onBackHome: () => {}, run: () => { throw Error("render must not submit"); } }));
    for (const [opening, extras] of [[0, 0], [1, 0], [1, 1], [1, 8], [1, 2], [1, 1]]) {
      const response = fixture(opening, extras);
      const html = hand(response);
      assert.equal((html.match(/alt="Card back"/g) ?? []).length, opening + extras);
      assert.ok(html.includes(`${opening + extras} hidden card`));
      assert.ok(!html.includes("<button") && !html.includes("tabindex="));
      for (const secret of ["RJ", "AH", "5D", "marshal_total", "must_discard_last", "Joker", "bust"]) {
        assert.ok(!JSON.stringify(response).includes(secret), secret);
        assert.ok(!table(response).includes(secret), secret);
      }
      for (const ordinary of ["10 +", "no azzardo", "— no card —", "MARSHAL TOTAL", "player-dark-cards--revealed"]) {
        assert.ok(!table(response).includes(ordinary), ordinary);
      }
      assert.ok(!html.includes("REVEAL") && !html.includes("DRAW") && !html.includes("DISCARD"));
    }
    const response = fixture();
    let html = table(response);
    assert.ok(html.includes("IN THE DARK"));
    assert.ok(html.includes("Your turn. Draw or stand"));
    assert.ok(html.includes("scene-status--your-turn"));
    assert.ok(html.includes("dark-mode-active"));
    assert.ok(table(response, "p2").includes("Waiting for your turn to draw or stand."));
    for (const finished of ["standing", "busted"] as const) {
      response.state.meta!.scene!.players!.p1 = { [finished]: true };
      html = table(response);
      assert.ok(html.includes("Your choice is made. Waiting for the Marshal to reveal the Dark."));
      assert.ok(!html.includes("scene-status--your-turn"));
    }
    html = table(response, "spectator");
    assert.ok(html.includes("Waiting for the participants and the Marshal&#x27;s reveal."));
    assert.ok(!html.includes("Draw or stand"));
    response.state.meta!.scene!.status = "setup";
    response.state.meta!.scene!.players!.p1 = {};
    assert.ok(table(response).includes("Waiting for the Marshal to start the scene."));
    const visible = revealed();
    html = hand(visible);
    assert.deepEqual([...html.matchAll(/alt="([^"]+)"/g)].map(m => m[1]), ["RJ", "AH", "5D"]);
    assert.equal((table(visible).match(/alt="RJ"/g) ?? []).length, 1);
    assert.match(html, /MARSHAL TOTAL/);
    assert.match(html, />17<\/strong>/); // Deliberately not the sum of the fixture's cards.
    assert.ok(html.includes("player-dark-cards--revealed"));
    assert.ok(table(visible).includes("THE DARK IS REVEALED"));
    assert.ok(table(visible).includes("dark-mode-active"));
    assert.ok(table(visible).includes("Resolve the outcome."));
    assert.ok(table(visible).includes("Scum or Vengeance before you acknowledge."));
    for (const result of ["success", "failure", "bust", "wound"] as const) {
      visible.state.meta!.scene!.players!.p1.result = result;
      const message = result === "success" ? "You beat the Marshal&#x27;s hand." : "The Marshal&#x27;s hand beat yours.";
      assert.ok(table(visible).includes(message));
    }
    delete visible.state.meta!.scene!.dark!.marshal_total;
    assert.match(hand(visible), />—<\/strong>/);
    visible.state.meta!.scene!.players!.p1.acknowledged = true;
    assert.ok(table(visible).includes("Waiting for the other participants to acknowledge."));
    assert.ok(getDarkPlayerStatus(visible.state.meta!.scene!, "p1", false, true).includes("An interaction is pending."));
    visible.state.meta!.scene!.status = "closed";
    assert.ok(!table(visible).includes("dark-mode-active"));
    visible.state.meta!.scene!.dark_mode = false;
    assert.equal(hand(visible), "");

    const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
    assert.match(css, /\.player-dark-cards\s*\{[^}]*height: 112px/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.player-dark-cards--revealed \{ animation: none;/);
    for (const count of [1, 5, 20, 54]) {
      const hidden = fixture(1, count - 1);
      const shown = revealed();
      shown.state.zones!["scene.dark.marshal_hand"] = Array.from({ length: count - 1 }, () => "2C");
      for (const current of [hidden, shown]) {
        assert.ok(hand(current).includes(`repeat(${count}, minmax(0, 72px))`));
      }
      for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720]]) {
        const fit = getViewportFit(w - 16, h - 70, 1800, 1500);
        assert.equal(fit.fallback, false);
        assert.ok(1800 * fit.scale <= w - 16 && 1500 * fit.scale <= h - 70 + .001);
      }
    }
  } finally { await server.close(); }
});

function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node.props, ...nodes(node.props.children as ReactNode)];
}

test("Dark player Deck and Stand retain normal player actions and identity", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom", plugins: [{ name: "player-dark-hooks", enforce: "pre",
      transform(code, id) { if (id.endsWith("/src/views/PlayerTableView.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";'); },
    }] });
  const originalFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Table } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const requests: ActionRequest[] = [];
    globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(String(options?.body))); return new Response(JSON.stringify(fixture())); };
    for (const action of ["gf.scene_draw_card", "gf.scene_stand"]) {
      hooks.resetHooks();
      const tree = Table({ resp: fixture(), currentActorId: "p1", view: "player", onBackHome: () => {}, run: (p: Promise<ActionResponse>) => p });
      const props = nodes(tree).find(p => action === "gf.scene_stand" ? typeof p.onStay === "function" : p.title === "Draw a card")!;
      assert.ok(props, action);
      await (props[action === "gf.scene_stand" ? "onStay" : "onClick"] as () => Promise<void>)();
      assert.deepEqual(requests.at(-1), { game_id: "dark-player", action, params: { player_id: "p1" }, view: "player", viewer_id: "p1" });
    }
    hooks.resetHooks();
  } finally { globalThis.fetch = originalFetch; await server.close(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { getYankeeInspectedCardId, getYankeeChoiceRequest, isYankeePendingForActor, YANKEE_CHOOSE_TOP_CARD_ACTION } from "../src/views/player_table/yankee.ts";
import { getViewportFit } from "../src/utils/viewportFit.ts";
import { isPendingInteractionActionAllowed } from "../src/utils/pendingInteractions.ts";
import { yankeeLiveState, YANKEE_A, YANKEE_B, INSPECTED_CARD } from "./fixtures/yankeeLiveState.ts";

test("Yankee helper validates routing, allowed action, and untrusted payload", () => {
  const { state } = yankeeLiveState();
  assert.equal(isYankeePendingForActor(state, YANKEE_A), true);
  assert.equal(getYankeeInspectedCardId(state, YANKEE_B), null);
  assert.equal(isPendingInteractionActionAllowed(state, "gf.scene_draw"), false);
  for (const payload of [null, [], "7D", {}, { inspected_card_id: "" }, { inspected_card_id: " " }, { inspected_card_id: 7 }]) {
    const invalid = structuredClone(state);
    invalid.meta!.pending_interaction!.payload = payload as never;
    assert.equal(getYankeeInspectedCardId(invalid, YANKEE_A), null);
  }
  for (const patch of [{ kind: "another_kind" }, { allowed_actions: [] }, { actor_id: YANKEE_B }]) {
    const invalid = structuredClone(state);
    Object.assign(invalid.meta!.pending_interaction!, patch);
    assert.equal(getYankeeChoiceRequest(invalid, "game", YANKEE_A, "keep"), null);
  }
});

test("Yankee rendered privacy, lifecycle, deck count, controls, and exact requests", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const { default: MarshalTable } = await server.ssrLoadModule("/src/views/MarshalTableView.tsx");
    // "marshal" is an explicit test case, not a new API View value.
    // Production routing selects the table by actor identity.
    const render = (viewer: string, response = yankeeLiveState(viewer), view = "player") => renderToStaticMarkup(createElement(Table, {
      resp: response, currentActorId: viewer, view,
      run: () => { throw Error("Rendering must not submit"); }, onBackHome: () => {},
    }));
    const actor = render(YANKEE_A);
    assert.ok(actor.includes("Order and Profit · Inspect the top card"));
    assert.ok(actor.includes("Keep it on top or bury it at the bottom of the deck."));
    assert.ok(actor.includes(`aria-label="Inspected top card: ${INSPECTED_CARD}"`));
    assert.match(actor, /front\/7D.jpg/);
    assert.match(actor, /width:144px/);
    assert.match(actor, />KEEP<\/button>/);
    assert.match(actor, />BURY<\/button>/);
    assert.match(actor, /<b>42<\/b> cards/);
    assert.match(actor, /<button[^>]*disabled[^>]*title="SCUM"/);
    assert.match(actor, /<button[^>]*disabled[^>]*title="VENGEANCE"/);
    assert.ok(actor.indexOf(">Deck<") < actor.indexOf(">Discard ·"));
    for (const response of [yankeeLiveState(YANKEE_B), yankeeLiveState(YANKEE_A)]) {
      // Also defend against an accidentally overprivileged response.
      const other = render(YANKEE_B, response);
      assert.ok(!other.includes(INSPECTED_CARD), "secret must be absent from the entire HTML");
      assert.ok(!other.includes("inspected_card_id"));
      assert.ok(!other.includes(">KEEP<") && !other.includes(">BURY<"));
      assert.ok(other.includes("Waiting for Yankee A to resolve an interaction. Gameplay actions are paused."));
    }
    for (const viewer of [YANKEE_A, "marshal"]) {
      const html = render(viewer, yankeeLiveState(viewer), viewer === "marshal" ? "marshal" : "player");
      assert.match(html, /class="table-viewport"/);
      assert.match(html, /class="saloon-composition"/);
      assert.match(html, /class="table-deck-stack"/);
      for (const region of ["Difficulty / Scene", "Deck", "Discard", "Refresh Table"]) {
        assert.ok(html.includes(region));
      }
      // Same viewport budget contract as the existing layout suite; these are
      // scale calculations, not browser measurements of document scrolling.
      for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720]]) {
        for (const boardHeight of [1015, 1100, 1500]) {
          const fit = getViewportFit(width - 16, height - 70, 1800, boardHeight);
          assert.equal(fit.fallback, false);
          assert.ok(1800 * fit.scale <= width - 16 + 0.001);
          assert.ok(boardHeight * fit.scale <= height - 70 + 0.001);
        }
      }
    }
    const marshalResponse = yankeeLiveState("marshal");
    const marshalRoute = Table({
      resp: marshalResponse, currentActorId: "marshal", view: "marshal",
      run: () => { throw Error("Rendering must not submit"); }, onBackHome: () => {},
    });
    assert.equal(marshalRoute.props.children.type, MarshalTable, "router must select the actual MarshalTableView");
    assert.equal(marshalRoute.props.children.props.view, "marshal");
    const marshal = render("marshal", marshalResponse, "marshal");
    assert.ok(marshal.includes("Interaction pending for Yankee A. Scene actions are paused."));
    assert.match(marshal, /<button type="button">Reclaim interaction<\/button>/);
    assert.ok(!marshal.includes(">KEEP<") && !marshal.includes(">BURY<"));
    assert.ok(!marshal.includes(INSPECTED_CARD));
    assert.ok(!marshal.includes("Inspected top card"));
    // Even if a privileged payload is supplied, the normal table must not
    // display the private card. App-level debug JSON is outside this render.
    const privilegedMarshal = render("marshal", yankeeLiveState(), "marshal");
    assert.ok(!privilegedMarshal.includes(INSPECTED_CARD));
    assert.ok(!privilegedMarshal.includes("inspected_card_id"));
    for (const view of ["public", "debug"]) {
      const html = renderToStaticMarkup(createElement(Table, {
        resp: yankeeLiveState(), currentActorId: YANKEE_A, view,
        run: () => { throw Error("Rendering must not submit"); }, onBackHome: () => {},
      }));
      assert.ok(!html.includes(INSPECTED_CARD));
      assert.ok(!html.includes(">KEEP<"));
    }
    assert.ok(render(YANKEE_A, structuredClone(yankeeLiveState())).includes("Inspected top card: 7D"));
    const gone = yankeeLiveState();
    gone.state.meta!.pending_interaction = null;
    assert.ok(!render(YANKEE_A, gone).includes("Inspected top card"));
    assert.ok(!render(YANKEE_A, gone).includes(">KEEP<"));
    assert.ok(!render(YANKEE_A, yankeeLiveState(YANKEE_A, YANKEE_B, "9C")).includes("9C"));
    const second = render(YANKEE_B, yankeeLiveState(YANKEE_B, YANKEE_B, "9C"));
    assert.ok(second.includes("Inspected top card: 9C"));
    assert.ok(!second.includes(INSPECTED_CARD));
    assert.match(second, /<b>42<\/b> cards/);

    const { default: Deck } = await server.ssrLoadModule("/src/views/player_table/PTV-YankeeDeck.tsx");
    const { gfAction } = await server.ssrLoadModule("/src/api/gf.ts");
    const originalFetch = globalThis.fetch;
    const requests: unknown[] = [];
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options!.body as string));
      return new Response(JSON.stringify(yankeeLiveState()));
    };
    try {
      const response = yankeeLiveState();
      const before = structuredClone(response.state);
      const tree = Deck({ cardId: INSPECTED_CARD, deckCount: 42, busy: false,
        onChoose: async (choice: "keep" | "bury") => {
          const request = getYankeeChoiceRequest(response.state, response.game_id, YANKEE_A, choice);
          assert.ok(request);
          await gfAction(request);
        } });
      const buttons = tree.props.children.filter((child: { type: string }) => child.type === "button");
      for (const button of buttons) await button.props.onClick();
      assert.deepEqual(requests, ["keep", "bury"].map(choice => ({
        game_id: response.game_id, action: YANKEE_CHOOSE_TOP_CARD_ACTION,
        params: { player_id: YANKEE_A, choice }, view: "player", viewer_id: YANKEE_A,
      })));
      assert.deepEqual(response.state, before, "inspection never mutates the deck locally");
      const busy = renderToStaticMarkup(createElement(Deck, { cardId: INSPECTED_CARD, deckCount: 42, busy: true, onChoose: () => {} }));
      assert.equal((busy.match(/disabled=""/g) ?? []).length, 2);
    } finally { globalThis.fetch = originalFetch; }
  } finally { await server.close(); }
});

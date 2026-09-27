import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { FactionName } from "../src/api/types.ts";
import { getFactionMedallion } from "../src/views/player_table/factionMedallion.ts";
import { isCriolloAvailable } from "../src/views/player_table/criollo.ts";
import { isPaisaAvailable } from "../src/views/player_table/paisa.ts";
import { yankeeLiveState, YANKEE_A, YANKEE_B, INSPECTED_CARD } from "./fixtures/yankeeLiveState.ts";

const cases = {
  criollo: {
    card: "QD", state: "available",
    powerName: "Law of Lead",
    description: "Once per scene, turn one Scum into Vengeance or one Vengeance into Scum.",
    instruction: "Power available: select one of your Scum or Vengeance cards to convert.",
  },
  paisa: {
    card: "QC", state: "available",
    powerName: "Heart of Shadow",
    description: "Spend 3 Vengeance to claim 1 Reward.",
    instruction: "Power available: select 3 Vengeance cards to claim a Reward.",
  },
  chichimeca: {
    card: "QS", state: "resolving",
    powerName: "Children of the Earth",
    description: "Whenever you take a wound, steal 1 Scum from an opponent.",
    instruction: "Choose an opponent to steal 1 Scum from.",
  },
  yankee: {
    card: "QH", state: "resolving",
    powerName: "Order and Profit",
    description: "Before a duel you're part of, inspect the top card of the deck and decide whether to keep it on top or bury it at the bottom.",
    instruction: "Inspect the top card, then choose KEEP or BURY.",
  },
} as const;

function fixture(faction: FactionName, active: boolean) {
  const response = yankeeLiveState();
  const state = response.state;
  state.zones![`players.${YANKEE_A}.character`] = [cases[faction].card];
  state.meta!.scene!.status = "active";
  state.meta!.pending_interaction = null;
  if (active) {
    if (faction === "criollo") state.zones![`players.${YANKEE_A}.scum`] = ["2H"];
    if (faction === "paisa") state.zones![`players.${YANKEE_A}.vengeance`] = ["2H", "3C", "4D"];
    if (faction === "chichimeca" || faction === "yankee") {
      state.meta!.pending_interaction = {
        kind: faction === "yankee" ? "yankee_inspect_top_card" : "chichimeca_choose_target",
        actor_id: YANKEE_A, allowed_actions: [faction === "yankee" ? "gf.faction_yankee_choose_top_card" : "gf.faction_chichimeca_choose_target"],
        payload: faction === "yankee" ? { inspected_card_id: INSPECTED_CARD } : { eligible_target_ids: [YANKEE_B] },
        continuation: null,
      };
    }
  }
  return response;
}

function derive(response: ReturnType<typeof fixture>, actionPending = false) {
  return getFactionMedallion(response.state, YANKEE_A, {
    criolloAvailable: isCriolloAvailable(response.state, YANKEE_A),
    paisaAvailable: isPaisaAvailable(response.state, YANKEE_A),
    actionPending,
  });
}

for (const faction of Object.keys(cases) as FactionName[]) {
  test(`${faction}: idle and ${cases[faction].state} use canonical medallion copy`, () => {
    const expected = cases[faction];
    for (const active of [false, true]) {
      const model = derive(fixture(faction, active))!;
      assert.equal(model.state, active ? expected.state : "idle");
      assert.equal(model.powerName, expected.powerName);
      assert.equal(model.description, expected.description);
      assert.equal(model.instruction, active ? expected.instruction : null);
      assert.equal(model.tooltip, active ? expected.instruction : expected.description);
      assert.doesNotMatch(JSON.stringify(model), /Heart of Ombra|Children of the Land|discard|7D|inspected_card_id/);
    }
  });
}

test("existing activation locks suppress availability; automatic powers use only current actor routing", () => {
  for (const faction of ["criollo", "paisa"] as const) {
    const response = fixture(faction, true);
    assert.equal(derive(response, true)!.state, "idle");
    response.state.meta!.pending_interaction = yankeeLiveState().state.meta!.pending_interaction;
    assert.equal(derive(response)!.state, "idle");
  }
  const spent = fixture("criollo", true);
  spent.state.meta!.scene!.faction_power_usage = { [YANKEE_A]: { criollo: true } };
  assert.equal(derive(spent)!.state, "idle");
  for (const faction of ["chichimeca", "yankee"] as const) {
    const response = fixture(faction, true);
    response.state.meta!.pending_interaction!.payload = {};
    assert.equal(derive(response)!.state, "resolving", "medallion does not require or read private payload");
    response.state.meta!.pending_interaction!.actor_id = YANKEE_B;
    assert.equal(derive(response)!.state, "idle");
    response.state.meta!.pending_interaction = null;
    assert.equal(derive(response)!.state, "idle");
  }
  assert.equal(getFactionMedallion({}, YANKEE_A, {
    criolloAvailable: false, paisaAvailable: false, actionPending: false,
  }), null);
});

test("actual table passes semantic state and tooltip to a non-interactive PlayerBoard medallion", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom",
  });
  try {
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const render = (response: ReturnType<typeof fixture>) => renderToStaticMarkup(createElement(Table, {
      resp: response, currentActorId: YANKEE_A, view: "player",
      run: () => { throw Error("Rendering must not dispatch"); }, onBackHome: () => {},
    }));
    for (const faction of Object.keys(cases) as FactionName[]) {
      for (const active of [false, true]) {
        const html = render(fixture(faction, active));
        const tag = html.match(/<div role="img"[^>]*data-power-state="[^"]+"[^>]*>/)?.[0];
        assert.ok(tag, "medallion must be a non-button semantic image");
        assert.ok(tag.includes(`data-power-state="${active ? cases[faction].state : "idle"}"`));
        const tooltip = active ? cases[faction].instruction : cases[faction].description;
        assert.ok(tag.includes('tabindex="0"'));
        assert.ok(tag.includes(`aria-label="${cases[faction].powerName}. ${tooltip.replaceAll("'", "&#x27;")}"`));
        assert.doesNotMatch(tag, /onclick|title=|role="button"|7D|inspected_card_id|Heart of Ombra|Children of the Land|discard/);
        const popup = html.match(/<span class="faction-medallion-tooltip"[^>]*><strong>[^<]*<\/strong><span>[^<]*<\/span><\/span>/)?.[0];
        assert.ok(popup, "in-app tooltip renders the centralized current copy");
        assert.ok(popup.includes(`<strong>${cases[faction].powerName}</strong>`));
        assert.ok(popup.includes(tooltip.replaceAll("'", "&#x27;")));
        assert.ok(popup.includes('aria-hidden="true"'), "label already supplies the same text to assistive technology");
        assert.doesNotMatch(popup, /7D|inspected_card_id|Heart of Ombra|Children of the Land|discard/);
        assert.ok(html.includes(`alt="${cases[faction].powerName}"`));
      }
    }
    for (const faction of ["criollo", "paisa"] as const) {
      const dead = fixture(faction, true);
      dead.state.meta!.players![YANKEE_A].wounds = 2;
      assert.match(render(dead), /data-power-state="idle"/, "existing living-player availability gate is reused");
    }
  } finally { await server.close(); }
});


test("medallion CSS provides hover/focus tooltips, distinct glows, stable geometry and reduced motion", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  for (const state of ["idle", "available", "resolving"]) {
    assert.ok(css.includes(`.faction-medallion[data-power-state="${state}"]`));
  }
  assert.match(css, /data-power-state="idle"\]\s*\{[^}]*box-shadow: none/);
  assert.match(css, /data-power-state="available"\]\s*\{[^}]*animation: medallion-breathe 4.8s/);
  assert.match(css, /data-power-state="resolving"\]\s*\{[^}]*animation: medallion-resolving-breathe 4s/);
  assert.match(css, /\.faction-medallion-tooltip\s*\{[^}]*position: absolute;[^}]*right: calc\(100% \+ 12px\);[^}]*top: 0;/);
  assert.match(css, /\.faction-medallion-tooltip\s*\{[^}]*visibility: hidden;[^}]*pointer-events: none;/);
  assert.match(css, /\.faction-medallion:hover \.faction-medallion-tooltip,\s*\.faction-medallion:focus \.faction-medallion-tooltip\s*\{[^}]*visibility: visible;[^}]*pointer-events: auto;/);
  assert.match(css, /\.faction-medallion:focus-visible\s*\{[^}]*outline:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.faction-medallion\[data-power-state\]\s*\{[^}]*animation: none;[^}]*transition: none;/);
  const board = await readFile(new URL("../src/views/player_table/PTV-PlayerBoard.tsx", import.meta.url), "utf8");
  const medallion = board.slice(board.indexOf('className="faction-medallion"'), board.indexOf('{powerArtSrc ?'));
  assert.doesNotMatch(medallion, /onClick|onMouseDown|onPointerDown/);
  assert.match(medallion, /width: s\(190\),\s*height: s\(190\)/);
});

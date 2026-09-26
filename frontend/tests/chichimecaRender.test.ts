import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { chichimecaLiveResponse } from "./fixtures/chichimecaLiveState.ts";
import { getPendingInteraction, isPendingInteractionActionAllowed } from "../src/utils/pendingInteractions.ts";
import { CHICHIMECA_CHOOSE_TARGET_ACTION, getChichimecaEligibleTargetIds, isChichimecaPendingForActor } from "../src/views/player_table/chichimeca.ts";

test("reported closed-scene state activates Chichimeca alongside the generic lock", () => {
  const { state } = chichimecaLiveResponse;
  assert.equal(isChichimecaPendingForActor(state, "player-nnu30f"), true);
  assert.equal(isPendingInteractionActionAllowed(state, CHICHIMECA_CHOOSE_TARGET_ACTION), true);
  assert.deepEqual(getChichimecaEligibleTargetIds(state, "player-nnu30f"), ["player-o2o9sa"]);
  assert.notEqual(getPendingInteraction(state), null);
});

test("actual table router renders the closed-scene prompt and target while preserving other locks", async () => {
  // Use existing Vite and React server rendering; no additional test framework.
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { default: TableRouterView } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const render = (currentActorId: string) => renderToStaticMarkup(createElement(TableRouterView, {
      resp: structuredClone(chichimecaLiveResponse),
      currentActorId,
      view: "player",
      run: () => { throw new Error("Rendering must not submit actions"); },
      onBackHome: () => {},
    }));
    const actor = render("player-nnu30f");
    assert.ok(actor.includes("Children of the Land · Choose an enemy"));
    assert.ok(actor.includes("Choose an enemy to discard 1 Scum."));
    assert.ok(!actor.includes("Scum targeting active."));
    const target = actor.match(/<div\b[^>]*aria-label="Target Paisà with Children of the Land"[^>]*>/)?.[0];
    assert.ok(target, "eligible Paisà must appear as a target in Other Players");
    assert.match(target, /role="button"/);
    assert.match(target, /tabindex="0"/);
    assert.match(target, /aria-disabled="false"/);
    assert.match(target, /data-target-state="eligible"/);
    assert.match(target, /var\(--target-positive\)/);
    assert.ok(!actor.includes("Children of the Earth"));
    assert.match(actor, /<button[^>]*disabled[^>]*>Confirm target<\/button>/);
    assert.match(actor, /<button[^>]*disabled[^>]*title="SCUM"/);
    assert.match(actor, /<button[^>]*disabled[^>]*title="VENGEANCE"/);

    for (const status of ["active", "awaiting_ack", "resolved"]) {
      const response = structuredClone(chichimecaLiveResponse);
      response.state.meta!.scene!.status = status;
      const html = renderToStaticMarkup(createElement(TableRouterView, {
        resp: response, currentActorId: "player-nnu30f", view: "player",
        run: () => { throw Error("render must not submit"); }, onBackHome: () => {},
      }));
      assert.ok(html.includes("Children of the Land · Choose an enemy"));
      assert.match(html, /data-target-state="eligible"/);
    }

    const { default: OtherPlayers } = await server.ssrLoadModule("/src/views/player_table/PTV-OtherPlayers.tsx");
    const panels = renderToStaticMarkup(createElement(OtherPlayers, {
      players: ["eligible", "selected", "ineligible"].map(playerId => ({
        playerId, displayName: playerId, figureCardId: "QC",
        scumCount: 1, vengeanceCount: 0, rewardCount: 0, rewardPoints: 0,
      })), wholePanelTargeting: true, targetActionLabel: "Children of the Land",
      selectableTargetPlayerIds: ["eligible", "selected"], selectedTargetPlayerId: "selected",
      onSelectSceneTarget: () => {},
    }));
    assert.ok(!panels.includes("<button"), "whole-panel targets must have no nested figure buttons");
    assert.match(panels, /aria-pressed="true"[^>]*data-target-state="selected"[^>]*border:3px solid var\(--target-positive\)/);
    assert.match(panels, /aria-disabled="true"[^>]*data-target-state="ineligible"/);
    assert.doesNotMatch(panels, /tabindex="0"[^>]*aria-disabled="true"/);

    const scum = renderToStaticMarkup(createElement(OtherPlayers, {
      players: [{ playerId: "p2", displayName: "Paisà", figureCardId: "QC",
        scumCount: 1, vengeanceCount: 0, rewardCount: 0, rewardPoints: 0 }],
      sceneTargetingActive: true, selectableTargetPlayerIds: ["p2"], onSelectSceneTarget: () => {},
    }));
    assert.match(scum, /<button[^>]*aria-label="Target Paisà with Scum"/);
    assert.ok(!scum.includes('class="other-player-target"'));

    const other = render("player-o2o9sa");
    assert.ok(other.includes("Waiting for Chichimeca to resolve an interaction. Gameplay actions are paused."));
    assert.ok(!other.includes("Confirm target"));
    assert.ok(!other.includes('aria-label="Target Chichimeca with Children of the Land"'));

    const marshal = render("marshal");
    assert.match(marshal, /<button type="button">Reclaim interaction<\/button>/);
    assert.ok(marshal.includes("Scene actions are paused."));
  } finally {
    await server.close();
  }
});

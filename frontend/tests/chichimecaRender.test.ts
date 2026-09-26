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
    const target = actor.match(/<button\b[^>]*aria-label="Target Paisà with Children of the Land"[^>]*>/)?.[0];
    assert.ok(target, "eligible Paisà must appear as a target in Other Players");
    assert.doesNotMatch(target, /disabled/);
    assert.match(actor, /<button[^>]*disabled[^>]*>Confirm target<\/button>/);
    assert.match(actor, /<button[^>]*disabled[^>]*title="SCUM"/);
    assert.match(actor, /<button[^>]*disabled[^>]*title="VENGEANCE"/);

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

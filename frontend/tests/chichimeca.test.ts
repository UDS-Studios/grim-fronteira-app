import assert from "node:assert/strict";
import test from "node:test";
import type { GameState, PendingInteraction } from "../src/api/types.ts";
import { getChichimecaEligibleTargetIds as targets, isChichimecaPendingForActor as active, isValidChichimecaTarget as valid, reconcileChichimecaSelection as reconcile, toggleChichimecaSelection as toggle } from "../src/views/player_table/chichimeca.ts";

function pending(overrides: Partial<PendingInteraction> = {}): GameState {
  return { meta: { pending_interaction: {
    kind: "chichimeca_choose_target", actor_id: "p1",
    allowed_actions: ["gf.faction_chichimeca_choose_target"],
    payload: { eligible_target_ids: ["p2", "p3"] }, continuation: null, ...overrides,
  } } };
}

test("Chichimeca requires exact kind and actor, handles absent pending", () => {
  assert.equal(active(pending(), "p1"), true);
  for (const state of [{}, pending({ kind: "other" }), pending({ actor_id: "p2" })]) {
    assert.equal(active(state, "p1"), false);
    assert.deepEqual(targets(state, "p1"), []);
  }
});

test("authoritative IDs are filtered and deduplicated; unrelated payload is ignored", () => {
  const state = pending({ payload: { eligible_target_ids: ["p3", null, 3, {}, "", "  ", "p2", "p3"], unrelated: true } });
  const before = structuredClone(state);
  assert.deepEqual(targets(state, "p1"), ["p3", "p2"]);
  assert.deepEqual(state, before);
  assert.equal(valid(state, "p1", "p3"), true);
  assert.equal(valid(state, "p1", "p4"), false);
  assert.equal(valid(state, "p2", "p3"), false);
});

test("missing, malformed and empty payloads expose no targets", () => {
  for (const payload of [undefined, null, {}, [], "bad", { eligible_target_ids: "p2" }, { eligible_target_ids: {} }, { eligible_target_ids: [] }]) {
    const state = pending({ payload: payload as PendingInteraction["payload"] });
    assert.deepEqual(targets(state, "p1"), []);
    assert.equal(valid(state, "p1", "p2"), false);
  }
});

test("non-actors never read payload; continuation is never read or required", () => {
  const state = pending();
  delete (state.meta!.pending_interaction as Partial<PendingInteraction>).continuation;
  assert.deepEqual(targets(state, "p1"), ["p2", "p3"]);
  Object.defineProperty(state.meta!.pending_interaction, "continuation", { get() { throw Error("opaque"); } });
  assert.equal(valid(state, "p1", "p2"), true);
  Object.defineProperty(state.meta!.pending_interaction, "payload", { get() { throw Error("actor only"); } });
  assert.deepEqual(targets(state, "p2"), []);
});

test("polling copies preserve selection; removed targets become invalid", () => {
  assert.equal(reconcile("p2", targets(structuredClone(pending()), "p1")), "p2");
  const next = pending({ payload: { eligible_target_ids: ["p3"] } });
  assert.equal(valid(next, "p1", "p2"), false);
  assert.equal(reconcile("p2", targets(next, "p1")), null);
  assert.equal(reconcile("p2", targets({}, "p1")), null);
});

test("single selection supports replacement, deselection and rejects invalid clicks", () => {
  const ids = ["p2", "p3"];
  assert.equal(toggle(null, "p2", ids), "p2");
  assert.equal(toggle("p2", "p3", ids), "p3");
  assert.equal(toggle("p3", "p3", ids), null);
  assert.equal(toggle("p2", "p4", ids), "p2");
  assert.equal(toggle("p4", "p4", ids), null);
});

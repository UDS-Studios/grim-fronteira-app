import assert from "node:assert/strict";
import test from "node:test";
import type { GameState, SceneState } from "../src/api/types.ts";
import { getDarkMarshalHand, getDarkMarshalTotal, isDarkRevealed, isDarkScene, mustMarshalDiscardDarkCard } from "../src/utils/dark.ts";

test("missing, ordinary and redacted Dark state is safe", () => {
  for (const scene of [undefined, {}, { dark_mode: false }, { dark_mode: true },
    { dark_mode: true, difficulty: { card_id: null, value: null }, dark: { revealed: false } }] satisfies (SceneState | undefined)[]) {
    assert.equal(getDarkMarshalTotal(scene), null);
    assert.equal(isDarkRevealed(scene), false);
    assert.equal(mustMarshalDiscardDarkCard(scene), false);
    assert.deepEqual(getDarkMarshalHand({ meta: { scene } }), []);
  }
  assert.equal(isDarkScene(), false);
  assert.equal(isDarkScene({ dark_mode: true }), true);
});

test("total is read verbatim from backend and never reconstructed from difficulty or cards", () => {
  const state: GameState = {
    meta: { scene: { dark_mode: true, difficulty: { card_id: "AH", value: 21 }, dark: {} } },
    zones: { "scene.dark.marshal_hand": ["AC", "RJ", "BJ"] },
  };
  const scene = state.meta!.scene!;
  assert.equal(getDarkMarshalTotal(scene), null, "visible cards do not authorize computing a missing total");
  for (const total of [0, 12, 27, 99]) {
    scene.dark!.marshal_total = total;
    assert.equal(getDarkMarshalTotal(scene), total);
  }
  for (const total of [null, undefined, NaN, Infinity]) {
    scene.dark!.marshal_total = total;
    assert.equal(getDarkMarshalTotal(scene), null);
  }
  const before = structuredClone(state);
  const hand = getDarkMarshalHand(state);
  assert.deepEqual(hand, ["AH", "AC", "RJ", "BJ"]);
  hand.pop();
  assert.deepEqual(state, before, "helper output does not alias authoritative zones");
});

test("reveal and discard flags use projected state without arithmetic", () => {
  const scene: SceneState = { dark_mode: true, dark: { revealed: false, marshal_total: 27 } };
  assert.equal(mustMarshalDiscardDarkCard(scene), false, "a total is not a substitute for the backend flag");
  scene.dark!.must_discard_last = true;
  assert.equal(mustMarshalDiscardDarkCard(scene), true);
  scene.dark!.revealed = true;
  assert.equal(isDarkRevealed(scene), true);
  assert.equal(mustMarshalDiscardDarkCard(scene), false);
  assert.equal(getDarkMarshalTotal(scene), 27);
});

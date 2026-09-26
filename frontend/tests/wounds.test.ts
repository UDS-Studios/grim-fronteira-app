import assert from "node:assert/strict";
import test from "node:test";
import { getWoundDisplay } from "../src/utils/wounds.ts";

test("live active bust displays one committed wound, rotated but alive", () => {
  const scene = { status: "active", players: {
    "player-u47u61": { hand_value: 27, busted: true, wounds_gained: 0, wounds_applied: 1 },
  } };
  assert.deepEqual(getWoundDisplay(1, scene.players["player-u47u61"]), {
    wounds: 1, wounded: true, dead: false,
  });
});

test("explicit provisional wound debt is displayed before commitment", () => {
  assert.deepEqual(getWoundDisplay(0, { wounds_gained: 1, wounds_applied: 0 }), {
    wounds: 1, wounded: true, dead: false,
  });
});

test("a second committed wound reaches the elimination threshold", () => {
  assert.deepEqual(getWoundDisplay(2, { wounds_gained: 0, wounds_applied: 1 }), {
    wounds: 2, wounded: true, dead: true,
  });
});

test("zero and missing counters display no wound", () => {
  const none = { wounds: 0, wounded: false, dead: false };
  assert.deepEqual(getWoundDisplay(0, { wounds_gained: 0 }), none);
  assert.deepEqual(getWoundDisplay(undefined), none);
});

test("busted flag never fabricates debt, including with missing wounds_gained", () => {
  const scenePlayer = { busted: true, wounds_applied: 1 };
  assert.deepEqual(getWoundDisplay(1, scenePlayer), { wounds: 1, wounded: true, dead: false });
  // Marshal bust can exempt a busted player from taking a wound.
  assert.deepEqual(getWoundDisplay(0, { ...scenePlayer, wounds_applied: 0 }), {
    wounds: 0, wounded: false, dead: false,
  });
});

test("count pending units once, without subtracting or readding applied history", () => {
  assert.deepEqual(getWoundDisplay(1, { wounds_gained: 1, wounds_applied: 1 }), {
    wounds: 2, wounded: true, dead: true,
  });
  // Healing can lower the persistent counter without erasing scene history.
  assert.deepEqual(getWoundDisplay(0, { wounds_gained: 0, wounds_applied: 1 }), {
    wounds: 0, wounded: false, dead: false,
  });
});

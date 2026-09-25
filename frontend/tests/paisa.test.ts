import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../src/api/types.ts";
import { isPaisaAvailable, isPaisaSelectionValid, reconcilePaisaSelection, togglePaisaSelection } from "../src/views/player_table/paisa.ts";

function eligible(): GameState {
  return {
    meta: { scene: { status: "resolved", participants: ["p1"] } },
    zones: { "players.p1.character": ["QC"], "players.p1.vengeance": ["AS", "2H", "3D", "4C"] },
  };
}

test("Paisà requires correct faction and three distinct non-empty owned cards", () => {
  assert.equal(isPaisaAvailable(eligible(), "p1"), true);
  assert.equal(isPaisaAvailable({}, "p1"), false);
  assert.equal(isPaisaAvailable(eligible(), "p2"), false);
  const changes: ((state: GameState) => void)[] = [
    s => { s.zones!["players.p1.character"] = ["QD"]; },
    ...[[], ["AS", "2H"], ["AS", "AS", "2H"], ["AS", "2H", ""]].map(cards => (s: GameState) => { s.zones!["players.p1.vengeance"] = cards; }),
  ];
  for (const change of changes) {
    const state = eligible();
    change(state);
    assert.equal(isPaisaAvailable(state, "p1"), false);
  }
});

test("Paisà has no frontend once-per-scene restriction", () => {
  const state = eligible();
  state.meta!.scene!.faction_power_usage = { p1: { paisa: true } };
  assert.equal(isPaisaAvailable(state, "p1"), true);
});

test("selection uses owned IDs, caps at three and permits deselection", () => {
  const owned = ["AS", "2H", "3D", "4C"];
  let selected: string[] = [];
  for (const id of owned) selected = togglePaisaSelection(selected, id, owned);
  assert.deepEqual(selected, owned.slice(0, 3));
  selected = togglePaisaSelection(selected, "2H", owned);
  assert.deepEqual(selected, ["AS", "3D"]);
  selected = togglePaisaSelection(selected, "4C", owned);
  assert.deepEqual(selected, ["AS", "3D", "4C"]);
  assert.deepEqual(togglePaisaSelection([], "foreign", owned), []);
  assert.deepEqual(reconcilePaisaSelection(["AS", "AS", "", "foreign"], owned), ["AS"]);
});

test("polling preserves selections across reordered copies and removes only lost cards", () => {
  const selected = ["AS", "3D", "4C"];
  const before = [...selected];
  assert.deepEqual(reconcilePaisaSelection(selected, ["4C", "3D", "2H", "AS"]), selected);
  assert.deepEqual(reconcilePaisaSelection(selected, ["AS", "2H", "4C"]), ["AS", "4C"]);
  assert.deepEqual(reconcilePaisaSelection(selected, []), []);
  assert.deepEqual(selected, before);
});


test("exactly three Vengeance cards also make Paisà available", () => {
  const state = eligible();
  state.zones!["players.p1.vengeance"] = ["AS", "2H", "3D"];
  assert.equal(isPaisaAvailable(state, "p1"), true);
});

test("confirmation requires exactly three distinct non-empty owned Vengeance IDs", () => {
  const state = eligible();
  state.zones!["players.p1.scum"] = ["5H"];
  state.zones!["players.p2.vengeance"] = ["6D"];
  assert.equal(isPaisaSelectionValid(state, "p1", ["AS", "3D", "4C"]), true);
  for (const selected of [
    [], ["AS"], ["AS", "2H"], ["AS", "2H", "3D", "4C"],
    ["AS", "AS", "2H"], ["AS", "2H", ""],
    ["AS", "2H", "5H"], ["AS", "2H", "6D"],
  ]) assert.equal(isPaisaSelectionValid(state, "p1", selected), false);
  assert.equal(isPaisaSelectionValid({}, "p1", ["AS", "3D", "4C"]), false);
  state.zones!["players.p1.vengeance"] = ["AS", "2H", "4C"];
  assert.equal(isPaisaSelectionValid(state, "p1", ["AS", "3D", "4C"]), false);
});

test("repeated card clicks toggle without introducing duplicate IDs", () => {
  const owned = ["AS", "2H", "3D"];
  const selected = togglePaisaSelection([], "AS", owned);
  assert.deepEqual(selected, ["AS"]);
  assert.deepEqual(togglePaisaSelection(selected, "AS", owned), []);
  assert.deepEqual(togglePaisaSelection(["AS", "AS"], "2H", owned), ["AS", "2H"]);
});


test("Paisà availability ignores scene status, participation and acknowledgement", () => {
  for (const status of ["setup", "active", "awaiting_ack", "resolved", "closed", "idle"]) {
    for (const acknowledged of [false, true]) {
      const state = eligible();
      state.meta!.scene = { status, participants: ["p2"], players: { p1: { acknowledged } } };
      assert.equal(isPaisaAvailable(state, "p1"), true);
    }
  }
});

test("Paisà is available with no scene or meta state", () => {
  const state = eligible();
  delete state.meta!.scene;
  assert.equal(isPaisaAvailable(state, "p1"), true);
  delete state.meta;
  assert.equal(isPaisaAvailable(state, "p1"), true);
});

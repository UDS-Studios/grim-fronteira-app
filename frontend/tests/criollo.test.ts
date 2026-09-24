import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../src/api/types.ts";
import { isCriolloAvailable, isCriolloSelectionOwned } from "../src/views/player_table/criollo.ts";

function eligible(): GameState {
  return {
    meta: { scene: { status: "setup", participants: ["p1"] } },
    zones: { "players.p1.character": ["QD"], "players.p1.scum": ["2H", "3C"], "players.p1.vengeance": ["AS"] },
  };
}

test("Criollo is offered in all four supported statuses, including with only one resource", () => {
  for (const status of ["setup", "active", "awaiting_ack", "resolved"]) {
    for (const resource of ["scum", "vengeance"]) {
      const state = eligible();
      state.meta!.scene!.status = status;
      state.zones![`players.p1.${resource}`] = [];
      assert.equal(isCriolloAvailable(state, "p1"), true);
    }
  }
});

test("Criollo requires faction, participation, unspent usage, supported status and owned resources", () => {
  const changes: ((state: GameState) => void)[] = [
    s => { s.zones!["players.p1.character"] = ["QC"]; },
    s => { s.meta!.scene!.participants = ["p2"]; },
    s => { s.meta!.scene!.faction_power_usage = { p1: { criollo: true } }; },
    ...["idle", "closed", "unknown", undefined].map(status => (s: GameState) => { s.meta!.scene!.status = status; }),
    s => { s.zones!["players.p1.scum"] = []; s.zones!["players.p1.vengeance"] = []; },
  ];
  for (const change of changes) {
    const state = eligible();
    change(state);
    assert.equal(isCriolloAvailable(state, "p1"), false);
  }
  assert.equal(isCriolloAvailable({}, "p1"), false);
  assert.equal(isCriolloAvailable(eligible(), "p2"), false);
});

test("usage is per player and scene; pending interactions are left to the backend gate", () => {
  const state = eligible();
  state.meta!.scene!.faction_power_usage = { p1: { criollo: false, paisa: true }, p2: { criollo: true } };
  state.meta!.pending_interaction = { kind: "example", actor_id: "p2", allowed_actions: [], continuation: null, payload: {} };
  const before = structuredClone(state);
  assert.equal(isCriolloAvailable(state, "p1"), true);
  assert.deepEqual(state, before);
  state.meta!.scene!.faction_power_usage!.p1.criollo = true;
  assert.equal(isCriolloAvailable(state, "p1"), false);
  state.meta!.scene = { status: "setup", participants: ["p1"] };
  assert.equal(isCriolloAvailable(state, "p1"), true);
});

test("selection uses the owned card ID and its exact resource, including non-top cards", () => {
  const state = eligible();
  assert.equal(isCriolloSelectionOwned(state, "p1", { cardId: "2H", resource: "scum" }), true);
  assert.equal(isCriolloSelectionOwned(state, "p1", { cardId: "AS", resource: "vengeance" }), true);
  assert.equal(isCriolloSelectionOwned(state, "p1", { cardId: "2H", resource: "vengeance" }), false);
  assert.equal(isCriolloSelectionOwned(state, "p2", { cardId: "2H", resource: "scum" }), false);
  assert.equal(isCriolloSelectionOwned(state, "p1", null), false);
  assert.equal(isCriolloSelectionOwned({}, "p1", { cardId: "2H", resource: "scum" }), false);
  state.zones!["players.p1.scum"] = ["3C"];
  assert.equal(isCriolloSelectionOwned(state, "p1", { cardId: "2H", resource: "scum" }), false);
});

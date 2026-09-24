import assert from "node:assert/strict";
import test from "node:test";
import type { FactionName, GameState, PendingInteraction } from "../src/api/types.ts";
import {
  factionFromCharacterCard,
  getPlayerCharacterCard,
  getPlayerFaction,
  isFactionPowerUsed,
  isSceneParticipant,
} from "../src/utils/factions.ts";
import {
  getPendingInteraction,
  isPendingInteractionActionAllowed,
  isPendingInteractionActor,
} from "../src/utils/pendingInteractions.ts";

test("all face ranks derive faction from suit", () => {
  const factions: Record<string, FactionName> = {
    D: "criollo", C: "paisa", H: "yankee", S: "chichimeca",
  };
  for (const rank of ["J", "Q", "K"]) {
    for (const [suit, faction] of Object.entries(factions)) {
      assert.equal(factionFromCharacterCard(rank + suit), faction);
    }
  }
});

test("missing, non-face and malformed cards have no faction", () => {
  for (const card of [undefined, null, "", "BJ", "RJ", "AD", "10C", "2H", "invalidS", "qd", " QD", "QD\n", "QX", 42, {}, ["QD"]]) {
    assert.equal(factionFromCharacterCard(card), null);
  }
});

test("character lookup uses only the requested player's single-card zone", () => {
  const state: GameState = { zones: {
    "players.p1.character": ["QD"],
    "players.p2.character": ["QC"],
    "players.p3.hand": ["QS"],
  } };
  const before = structuredClone(state);
  assert.equal(getPlayerCharacterCard(state, "p1"), "QD");
  assert.equal(getPlayerFaction(state, "p1"), "criollo");
  assert.equal(getPlayerFaction(state, "p2"), "paisa");
  assert.equal(getPlayerCharacterCard(state, "p3"), null);
  assert.deepEqual(state, before);
});

test("missing or malformed character zones do not produce a faction", () => {
  for (const cards of [[], ["QD", "QC"], [null], "QD", [""], ["RJ"], ["3D"]]) {
    const state = { zones: { "players.p1.character": cards } } as unknown as GameState;
    assert.equal(getPlayerFaction(state, "p1"), null);
    if (!Array.isArray(cards) || cards.length !== 1 || !cards[0]) {
      assert.equal(getPlayerCharacterCard(state, "p1"), null);
    }
  }
});

test("missing optional state fields safely yield null or false", () => {
  for (const state of [{}, { meta: {} }, { meta: { scene: {} } }, { zones: {} }] satisfies GameState[]) {
    assert.equal(getPlayerCharacterCard(state, "p1"), null);
    assert.equal(getPlayerFaction(state, "p1"), null);
    assert.equal(isSceneParticipant(state, "p1"), false);
    assert.equal(isFactionPowerUsed(state, "p1", "criollo"), false);
    assert.equal(getPendingInteraction(state), null);
    assert.equal(isPendingInteractionActor(state, "p1"), false);
    assert.equal(isPendingInteractionActionAllowed(state, "choose"), false);
  }
});

test("participation and usage are independent structural facts", () => {
  const state: GameState = { meta: { scene: {
    status: "closed",
    mode: "pvp_duel",
    participants: ["p1"],
    faction_power_usage: { p1: { criollo: false }, p2: { paisa: true } },
  } } };
  const before = structuredClone(state);
  assert.equal(isSceneParticipant(state, "p1"), true);
  assert.equal(isSceneParticipant(state, "p2"), false);
  assert.equal(isFactionPowerUsed(state, "p1", "criollo"), false);
  assert.equal(isFactionPowerUsed(state, "p2", "paisa"), true);
  assert.equal(isFactionPowerUsed(state, "p2", "yankee"), false);
  assert.equal(isFactionPowerUsed(state, "p3", "paisa"), false);
  assert.deepEqual(state, before);
});

test("pending actor and action membership are separate; continuation stays opaque", () => {
  const pending: PendingInteraction = {
    kind: "example", actor_id: "p1", allowed_actions: ["choose", "skip"],
    continuation: { opaque: ["backend-only"] }, payload: { target: "p2" },
  };
  const state: GameState = { meta: { pending_interaction: pending } };
  const before = structuredClone(state);
  assert.equal(getPendingInteraction(state), pending);
  assert.equal(isPendingInteractionActor(state, "p1"), true);
  assert.equal(isPendingInteractionActor(state, "p2"), false);
  assert.equal(isPendingInteractionActionAllowed(state, "choose"), true);
  assert.equal(isPendingInteractionActionAllowed(state, "skip"), true);
  assert.equal(isPendingInteractionActionAllowed(state, "other"), false);
  assert.deepEqual(state, before);
});

test("null pending interaction and empty allowed actions", () => {
  const state: GameState = { meta: { pending_interaction: null } };
  assert.equal(getPendingInteraction(state), null);
  assert.equal(isPendingInteractionActor(state, "p1"), false);
  assert.equal(isPendingInteractionActionAllowed(state, "choose"), false);
  state.meta!.pending_interaction = {
    kind: "example", actor_id: "p1", allowed_actions: [], continuation: null, payload: {},
  };
  assert.equal(isPendingInteractionActionAllowed(state, "choose"), false);
});

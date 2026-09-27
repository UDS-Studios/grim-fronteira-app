import assert from "node:assert/strict";
import test from "node:test";
import type { GameState, PendingInteraction } from "../src/api/types.ts";
import {
  getPendingInteraction,
  getPendingInteractionIdentity,
  isPendingInteractionActor,
  isPendingInteractionActionAllowed,
} from "../src/utils/pendingInteractions.ts";

function stateWithPending(overrides: Partial<PendingInteraction> = {}): GameState {
  return { meta: { pending_interaction: {
    kind: "example", actor_id: "p1", allowed_actions: ["example.resolve"],
    payload: {}, continuation: null, ...overrides,
  } } };
}

test("absent or null pending state leaves the generic table lock off", () => {
  for (const state of [{}, { meta: {} }, { meta: { pending_interaction: null } }] satisfies GameState[]) {
    assert.equal(getPendingInteraction(state) !== null, false);
    assert.equal(getPendingInteractionIdentity(state), null);
    assert.equal(isPendingInteractionActor(state, "p1"), false);
  }
});

test("pending state locks ordinary table actions for actors and non-actors alike", () => {
  const state = stateWithPending();
  assert.equal(getPendingInteraction(state) !== null, true);
  assert.equal(isPendingInteractionActor(state, "p1"), true);
  assert.equal(isPendingInteractionActor(state, "p2"), false);
  assert.equal(isPendingInteractionActor(state, "marshal"), false);
  assert.equal(isPendingInteractionActionAllowed(state, "example.resolve"), true);
  assert.equal(isPendingInteractionActionAllowed(state, "gf.scene_draw_card"), false);
  // Allowed-action membership does not remove this checkpoint's generic lock.
  assert.equal(getPendingInteraction(state) !== null, true);
});

test("pending identity is stable across polling copies and opaque data changes", () => {
  const state = stateWithPending();
  const identity = getPendingInteractionIdentity(state);
  assert.equal(getPendingInteractionIdentity(structuredClone(state)), identity);
  assert.equal(getPendingInteractionIdentity(stateWithPending({
    payload: { private: "changed" }, continuation: { opaque: "changed" }, allowed_actions: [],
  })), identity);
  assert.equal(getPendingInteractionIdentity({ meta: { pending_interaction: null } }), null);
});

test("actor and kind changes distinguish chained interactions", () => {
  const identity = getPendingInteractionIdentity(stateWithPending());
  assert.notEqual(getPendingInteractionIdentity(stateWithPending({ actor_id: "p2" })), identity);
  assert.notEqual(getPendingInteractionIdentity(stateWithPending({ kind: "other" })), identity);
  assert.notEqual(
    getPendingInteractionIdentity(stateWithPending({ kind: "a:b", actor_id: "c" })),
    getPendingInteractionIdentity(stateWithPending({ kind: "a", actor_id: "b:c" })),
  );
});

test("generic detection needs neither payload nor continuation", () => {
  const state = { meta: { pending_interaction: {
    kind: "example", actor_id: "p1", allowed_actions: ["example.resolve"],
  } } } as GameState;
  assert.equal(getPendingInteraction(state) !== null, true);
  assert.equal(isPendingInteractionActor(state, "p1"), true);
  assert.equal(isPendingInteractionActionAllowed(state, "example.resolve"), true);
  assert.notEqual(getPendingInteractionIdentity(state), null);
});

test("generic helpers never read payload or continuation", () => {
  const state = stateWithPending();
  const pending = state.meta!.pending_interaction!;
  for (const field of ["payload", "continuation"]) {
    Object.defineProperty(pending, field, { get() { throw new Error(`Do not read ${field}`); } });
  }
  assert.equal(getPendingInteraction(state), pending);
  assert.equal(isPendingInteractionActor(state, "p1"), true);
  assert.equal(isPendingInteractionActionAllowed(state, "example.resolve"), true);
  assert.notEqual(getPendingInteractionIdentity(state), null);
});

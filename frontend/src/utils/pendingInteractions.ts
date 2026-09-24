import type { GameState, PendingInteraction } from "../api/types.ts";

export function getPendingInteraction(state: GameState): PendingInteraction | null {
  return state.meta?.pending_interaction ?? null;
}

export function isPendingInteractionActor(state: GameState, viewerId: string): boolean {
  return getPendingInteraction(state)?.actor_id === viewerId;
}

// Action membership does not imply actor authorization or backend legality.
export function isPendingInteractionActionAllowed(state: GameState, action: string): boolean {
  const actions = getPendingInteraction(state)?.allowed_actions;
  return Array.isArray(actions) && actions.includes(action);
}

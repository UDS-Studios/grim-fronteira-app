import type { GameState } from "../../api/types.ts";
import { getPendingInteraction, isPendingInteractionActor } from "../../utils/pendingInteractions.ts";

export const CHICHIMECA_CHOOSE_TARGET_ACTION = "gf.faction_chichimeca_choose_target";

export function isChichimecaPendingForActor(state: GameState, playerId: string): boolean {
  return getPendingInteraction(state)?.kind === "chichimeca_choose_target" &&
    isPendingInteractionActor(state, playerId);
}

export function getChichimecaEligibleTargetIds(state: GameState, playerId: string): string[] {
  if (!isChichimecaPendingForActor(state, playerId)) return [];
  const ids = getPendingInteraction(state)?.payload?.eligible_target_ids;
  return Array.isArray(ids)
    ? [...new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0))]
    : [];
}

export function isValidChichimecaTarget(state: GameState, playerId: string, targetPlayerId: string): boolean {
  return getChichimecaEligibleTargetIds(state, playerId).includes(targetPlayerId);
}

export function reconcileChichimecaSelection(selected: string | null, eligible: string[]): string | null {
  return selected !== null && eligible.includes(selected) ? selected : null;
}

export function toggleChichimecaSelection(selected: string | null, target: string, eligible: string[]): string | null {
  const valid = reconcileChichimecaSelection(selected, eligible);
  return eligible.includes(target) ? (valid === target ? null : target) : valid;
}

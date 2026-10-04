import type { GameState } from "../../api/types.ts";
import { getPlayerFaction, isFactionPowerUsed, isSceneParticipant } from "../../utils/factions.ts";

export type CriolloSelection = {
  cardId: string;
  resource: "scum" | "vengeance";
};

// Presentation only: action legality remains authoritative on the backend.
export function isCriolloAvailable(state: GameState, playerId: string): boolean {
  return getPlayerFaction(state, playerId) === "criollo" &&
    isSceneParticipant(state, playerId) &&
    !isFactionPowerUsed(state, playerId, "criollo") &&
    ["setup", "active", "awaiting_ack", "resolved"].includes(state.meta?.scene?.status ?? "") &&
    ["scum", "vengeance"].some(resource =>
      (state.zones?.[`players.${playerId}.${resource}`]?.length ?? 0) > 0);
}

export function isCriolloSelectionOwned(
  state: GameState, playerId: string, selection: CriolloSelection | null,
): selection is CriolloSelection {
  return selection !== null &&
    (state.zones?.[`players.${playerId}.${selection.resource}`]?.includes(selection.cardId) ?? false);
}

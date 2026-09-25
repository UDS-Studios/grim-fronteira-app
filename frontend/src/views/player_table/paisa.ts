import type { GameState } from "../../api/types.ts";
import { getPlayerFaction, isSceneParticipant } from "../../utils/factions.ts";

// Presentation only; the backend remains the final legality authority.
export function isPaisaAvailable(state: GameState, playerId: string): boolean {
  const scene = state.meta?.scene;
  return getPlayerFaction(state, playerId) === "paisa" &&
    isSceneParticipant(state, playerId) &&
    (scene?.status === "resolved" ||
      (scene?.status === "awaiting_ack" && !scene.players?.[playerId]?.acknowledged)) &&
    new Set((state.zones?.[`players.${playerId}.vengeance`] ?? []).filter(id => id.trim())).size >= 3;
}

export function reconcilePaisaSelection(selected: string[], owned: string[]): string[] {
  return [...new Set(selected)].filter(id => id.trim() && owned.includes(id)).slice(0, 3);
}

export function togglePaisaSelection(selected: string[], cardId: string, owned: string[]): string[] {
  const valid = reconcilePaisaSelection(selected, owned);
  if (valid.includes(cardId)) return valid.filter(id => id !== cardId);
  return cardId.trim() && owned.includes(cardId) && valid.length < 3 ? [...valid, cardId] : valid;
}

export function isPaisaSelectionValid(state: GameState, playerId: string, selected: string[]): boolean {
  const owned = state.zones?.[`players.${playerId}.vengeance`] ?? [];
  return selected.length === 3 && new Set(selected).size === 3 &&
    selected.every(id => id.trim().length > 0 && owned.includes(id));
}

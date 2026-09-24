import type { FactionName, GameState } from "../api/types.ts";

// Structural presentation helpers only; the backend decides action legality.
export function factionFromCharacterCard(cardId: unknown): FactionName | null {
  if (typeof cardId !== "string" || cardId.length !== 2 || !/^[JQK][DCHS]$/.test(cardId)) return null;

  switch (cardId[1]) {
    case "D": return "criollo";
    case "C": return "paisa";
    case "H": return "yankee";
    case "S": return "chichimeca";
    default: return null;
  }
}

export function getPlayerCharacterCard(state: GameState, playerId: string): string | null {
  const cards = state.zones?.[`players.${playerId}.character`];
  return Array.isArray(cards) && cards.length === 1 && typeof cards[0] === "string" && cards[0].length > 0
    ? cards[0]
    : null;
}

export function getPlayerFaction(state: GameState, playerId: string): FactionName | null {
  return factionFromCharacterCard(getPlayerCharacterCard(state, playerId));
}

export function isSceneParticipant(state: GameState, playerId: string): boolean {
  const participants = state.meta?.scene?.participants;
  return Array.isArray(participants) && participants.includes(playerId);
}

export function isFactionPowerUsed(state: GameState, playerId: string, faction: FactionName): boolean {
  return state.meta?.scene?.faction_power_usage?.[playerId]?.[faction] === true;
}

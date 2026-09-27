import type { ActionRequest, GameState } from "../../api/types.ts";
import { getPendingInteraction, isPendingInteractionActionAllowed } from "../../utils/pendingInteractions.ts";

export const YANKEE_INTERACTION_KIND = "yankee_inspect_top_card";
export const YANKEE_CHOOSE_TOP_CARD_ACTION = "gf.faction_yankee_choose_top_card";
export type YankeeChoice = "keep" | "bury";

export function getYankeeInspectedCardId(state: GameState, playerId: string): string | null {
  const pending = getPendingInteraction(state);
  if (pending?.kind !== YANKEE_INTERACTION_KIND || pending.actor_id !== playerId ||
      !isPendingInteractionActionAllowed(state, YANKEE_CHOOSE_TOP_CARD_ACTION)) return null;
  const payload: unknown = pending.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const card: unknown = (payload as Record<string, unknown>).inspected_card_id;
  return typeof card === "string" && card.trim().length > 0 ? card : null;
}

export function isYankeePendingForActor(state: GameState, playerId: string): boolean {
  return getYankeeInspectedCardId(state, playerId) !== null;
}

export function getYankeeChoiceRequest(state: GameState, gameId: string, playerId: string, choice: YankeeChoice): ActionRequest | null {
  if (!isYankeePendingForActor(state, playerId)) return null;
  return {
    game_id: gameId, action: YANKEE_CHOOSE_TOP_CARD_ACTION,
    params: { player_id: playerId, choice }, view: "player", viewer_id: playerId,
  };
}

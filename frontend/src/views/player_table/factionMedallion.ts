import type { FactionName, GameState } from "../../api/types.ts";
import { getPlayerFaction } from "../../utils/factions.ts";
import { getPendingInteraction } from "../../utils/pendingInteractions.ts";
import { isChichimecaPendingForActor } from "./chichimeca.ts";
import { YANKEE_INTERACTION_KIND } from "./yankee.ts";

export type FactionMedallionState = "idle" | "available" | "resolving";
export type FactionMedallion = {
  state: FactionMedallionState;
  powerName: string;
  description: string;
  instruction: string | null;
  tooltip: string;
};

const copy: Record<FactionName, { powerName: string; description: string; instruction: string }> = {
  yankee: {
    powerName: "Order and Profit",
    description: "Before a duel you're part of, inspect the top card of the deck and decide whether to keep it on top or bury it at the bottom.",
    instruction: "Inspect the top card, then choose KEEP or BURY.",
  },
  criollo: {
    powerName: "Law of Lead",
    description: "Once per scene, turn one Scum into Vengeance or one Vengeance into Scum.",
    instruction: "Power available: select one of your Scum or Vengeance cards to convert.",
  },
  paisa: {
    powerName: "Heart of Shadow",
    description: "Spend 3 Vengeance to claim 1 Reward.",
    instruction: "Power available: select 3 Vengeance cards to claim a Reward.",
  },
  chichimeca: {
    powerName: "Children of the Earth",
    description: "Whenever you take a wound, steal 1 Scum from an opponent.",
    instruction: "Choose an opponent to steal 1 Scum from.",
  },
};

// Availability is supplied by the table's existing rules and living-player checks.
// This model adds only the existing action locks and public pending routing.
export function getFactionMedallion(
  game: GameState,
  playerId: string,
  availability: { criolloAvailable: boolean; paisaAvailable: boolean; actionPending: boolean },
): FactionMedallion | null {
  const faction = getPlayerFaction(game, playerId);
  if (!faction) return null;
  const pending = getPendingInteraction(game);
  let state: FactionMedallionState = "idle";
  if ((faction === "chichimeca" && isChichimecaPendingForActor(game, playerId)) ||
      (faction === "yankee" && pending?.kind === YANKEE_INTERACTION_KIND && pending.actor_id === playerId)) {
    state = "resolving";
  } else if (!pending && !availability.actionPending &&
      ((faction === "criollo" && availability.criolloAvailable) ||
       (faction === "paisa" && availability.paisaAvailable))) {
    state = "available";
  }
  const { powerName, description, instruction: activeInstruction } = copy[faction];
  const instruction = state === "idle" ? null : activeInstruction;
  return { state, powerName, description, instruction, tooltip: instruction ?? description };
}

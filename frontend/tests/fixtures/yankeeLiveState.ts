import type { ActionResponse } from "../../src/api/types.ts";

export const YANKEE_A = "yankee-a";
export const YANKEE_B = "yankee-b";
export const INSPECTED_CARD = "7D";

// Each response represents its viewer's backend-filtered payload.
export function yankeeLiveState(viewer = YANKEE_A, actor = YANKEE_A, card = INSPECTED_CARD): ActionResponse {
  return {
    game_id: "yankee-live", revision: 1, result: null, error: null, events: [],
    state: {
      meta: {
        phase: "table", marshal_id: "marshal", players_order: [YANKEE_A, YANKEE_B],
        players: { [YANKEE_A]: { wounds: 0 }, [YANKEE_B]: { wounds: 0 } },
        lobby: { players: {
          [YANKEE_A]: { chosen_name: "Yankee A", ability_name: "Order and Profit",
            ability_text: "Before a duel you're part of, look at the top card of the deck. Decide whether fate stays on top or gets buried." },
          [YANKEE_B]: { chosen_name: "Yankee B", ability_name: "Order and Profit" },
        } },
        scene: { status: "closed", mode: "duel", participants: [YANKEE_A, YANKEE_B] },
        pending_interaction: {
          kind: "yankee_inspect_top_card", actor_id: actor,
          allowed_actions: ["gf.faction_yankee_choose_top_card"],
          payload: viewer === actor ? { inspected_card_id: card } : {},
          continuation: { on_resolve: { kind: "resume_scene_start", payload: {} },
            on_reclaim: { kind: "resume_scene_start", payload: {} } },
        },
      },
      deck: { draw_pile: { count: 42 }, discard_pile: [] },
      zones: { [`players.${YANKEE_A}.character`]: ["QH"], [`players.${YANKEE_B}.character`]: ["KH"] },
    },
  };
}

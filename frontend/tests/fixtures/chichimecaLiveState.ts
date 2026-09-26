import type { ActionResponse } from "../../src/api/types.ts";

// Essential state from the closed-scene live report, with representative figures.
export const chichimecaLiveResponse: ActionResponse = {
  game_id: "chichimeca-live-regression",
  revision: 1,
  error: null,
  result: null,
  events: [],
  state: {
    meta: {
      phase: "table",
      marshal_id: "marshal",
      players_order: ["player-nnu30f", "player-o2o9sa"],
      players: { "player-nnu30f": { wounds: 1 }, "player-o2o9sa": { wounds: 0 } },
      lobby: { players: {
        "player-nnu30f": { chosen_name: "Chichimeca" },
        "player-o2o9sa": { chosen_name: "Paisà" },
      } },
      scene: { status: "closed", participants: ["player-nnu30f", "player-o2o9sa"] },
      pending_interaction: {
        kind: "chichimeca_choose_target",
        actor_id: "player-nnu30f",
        allowed_actions: ["gf.faction_chichimeca_choose_target"],
        payload: { eligible_target_ids: ["player-o2o9sa"] },
        continuation: {
          on_resolve: { kind: "resume_scene_new", payload: {} },
          on_reclaim: { kind: "resume_scene_new", payload: {} },
        },
      },
    },
    zones: {
      "players.player-nnu30f.character": ["QS"],
      "players.player-o2o9sa.character": ["QC"],
      "players.player-o2o9sa.scum": ["8H"],
    },
  },
};

import { isGameplayPaused } from "./sessionPause";
import { useRef, useState } from "react";
import { gfAction } from "../api/gf";
import type { ActionResponse, View } from "../api/types";
import { getViewRequest } from "./sessionView";
import { canDarkDraw, canDarkDiscardLast, canDarkReveal, canRollDarkDifficulty } from "./dark";

export type DarkHandAction = "gf.scene_roll_difficulty" | "gf.scene_dark_draw" | "gf.scene_dark_discard_last" | "gf.scene_dark_reveal";

// The physical Deck, forced card and Reveal share one submission lock.
export function useDarkHandActions(resp: ActionResponse, actorId: string, view: View,
  run: (request: Promise<ActionResponse>) => Promise<ActionResponse>, connectionLost = false) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const allowed = {
    "gf.scene_roll_difficulty": canRollDarkDifficulty(resp.state, actorId),
    "gf.scene_dark_draw": canDarkDraw(resp.state, actorId),
    "gf.scene_dark_discard_last": canDarkDiscardLast(resp.state, actorId),
    "gf.scene_dark_reveal": canDarkReveal(resp.state, actorId),
  };
  async function submit(action: DarkHandAction) {
    if (connectionLost || isGameplayPaused(resp.state.meta) || view !== "marshal" || !allowed[action] || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const request = gfAction({ game_id: resp.game_id, action, params: { actor_id: actorId },
        ...getViewRequest(view, actorId) }).then(response => response.error ? { ...resp, error: response.error } : response);
      await run(request);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, submit };
}

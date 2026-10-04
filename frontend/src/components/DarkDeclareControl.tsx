import { isGameplayPaused } from "../utils/sessionPause";
import { useId, useRef, useState } from "react";
import type { ActionResponse, GameState, View } from "../api/types";
import { gfAction } from "../api/gf";
import { publicAsset } from "../app/assets";
import { canDeclareDark } from "../utils/dark";
import { getViewRequest } from "../utils/sessionView";
import IconButton from "./IconButton";

export default function DarkDeclareControl({ state, gameId, actorId, view, run }: {
  state: GameState; gameId: string; actorId: string; view: View;
  run: (request: Promise<ActionResponse>) => Promise<ActionResponse>;
}) {
  const tooltipId = useId();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const available = !isGameplayPaused(state.meta) && canDeclareDark(state, actorId);
  async function declare() {
    if (!available || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await run(gfAction({ game_id: gameId, action: "gf.scene_declare_dark",
        params: { actor_id: actorId }, ...getViewRequest(view, actorId) }));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="dark-declare-control" aria-busy={busy}>
      <IconButton src={publicAsset("ui/dark-mode.svg")} alt="Declare the Dark"
        className="dark-declare-button" size={40} disabled={!available || busy}
        describedBy={tooltipId} onClick={declare} />
      <div role="tooltip" className="dark-declare-tooltip">
        <strong>Declare the Dark</strong>
        <span id={tooltipId}>Use for final duels, spiritual trials, or moments when destiny manifests. The Marshal's hand stays hidden until all players have finished.</span>
      </div>
    </div>
  );
}

import { useId, useRef, useState } from "react";
import { gfAction } from "../api/gf";
import type { ActionResponse, View } from "../api/types";
import { getViewRequest } from "../utils/sessionView";
import {
  canDarkDraw, canDarkDiscardLast, canDarkReveal, countUnfinishedDarkParticipants,
  getDarkMarshalHand, getDarkMarshalTotal, mustMarshalDiscardDarkCard,
} from "../utils/dark";
import { getTwentyOneColor } from "../views/player_table/sceneResolution";
import CardImg from "./CardImg";

type DarkAction = "gf.scene_dark_draw" | "gf.scene_dark_discard_last" | "gf.scene_dark_reveal";

export default function MarshalDarkHand({ resp, actorId, view, run }: {
  resp: ActionResponse; actorId: string; view: View;
  run: (request: Promise<ActionResponse>) => Promise<ActionResponse>;
}) {
  const statusId = useId();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const state = resp.state;
  const scene = state.meta?.scene;
  const hand = getDarkMarshalHand(state);
  const total = getDarkMarshalTotal(scene);
  const mustDiscard = mustMarshalDiscardDarkCard(scene);
  const unfinished = countUnfinishedDarkParticipants(scene);
  const allowed = {
    "gf.scene_dark_draw": canDarkDraw(state, actorId),
    "gf.scene_dark_discard_last": canDarkDiscardLast(state, actorId),
    "gf.scene_dark_reveal": canDarkReveal(state, actorId),
  };
  async function submit(action: DarkAction) {
    if (view !== "marshal" || !allowed[action] || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      // Keep the current projection on rejection; never replace it with an empty error state.
      const request = gfAction({ game_id: resp.game_id, action, params: { actor_id: actorId },
        ...getViewRequest(view, actorId) }).then(response => response.error ? { ...resp, error: response.error } : response)
        .catch((error: unknown): ActionResponse => ({ ...resp, error: {
          code: "CLIENT_FETCH_ERROR", message: error instanceof Error ? error.message : String(error), details: null,
        } }));
      await run(request);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const status = mustDiscard ? "You have gone over 21. Discard the last Dark card before continuing."
    : state.meta?.pending_interaction ? "Resolve the pending interaction before continuing."
    : scene?.status === "setup" ? "Start the scene before revealing."
    : !(scene?.participants?.length) ? "Select participants before revealing."
    : unfinished ? `Waiting for ${unfinished} player${unfinished === 1 ? "" : "s"}`
    : total === null ? "Marshal total unavailable. Refresh the table."
    : total > 21 ? "Marshal total is over 21. Reveal is unavailable."
    : "All players have chosen. You may reveal.";

  // This component never provides an alternate inspection route to Marshal-private data.
  if (view !== "marshal" || actorId !== state.meta?.marshal_id || !scene?.dark_mode || scene.dark?.revealed) return null;
  return (
    <section className="marshal-dark-hand" aria-label="Marshal's Dark hand" aria-busy={busy}>
      <div className="marshal-dark-hand-heading">
        <strong>MARSHAL'S DARK HAND</strong>
        <div className="marshal-dark-total">
          <span>MARSHAL TOTAL</span>
          <strong style={{ color: getTwentyOneColor(total) ?? "inherit" }}>{total ?? "—"}</strong>
        </div>
      </div>
      <div className="marshal-dark-cards" role="list" aria-label="Dark cards in draw order"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, hand.length)}, minmax(0, 86px))` }}>
        {hand.map((card, index) => {
          const forced = mustDiscard && index > 0 && index === hand.length - 1;
          const label = index === 0 ? "Opening difficulty" : `Extra draw ${index}`;
          return <div key={`${index}:${card}`} className="marshal-dark-card" role="listitem" tabIndex={0}
            data-forced-discard={forced ? "true" : undefined} aria-label={`${label}: ${card}${forced ? ". Must discard last" : ""}`}>
            <CardImg cardId={card} width={86} title={`${label}: ${card}`} />
            <span className="marshal-dark-card-label">{forced ? "DISCARD LAST" : index === 0 ? "OPENING" : `EXTRA ${index}`}</span>
          </div>;
        })}
        {!hand.length && <span>Draw the hidden difficulty from the deck.</span>}
      </div>
      <div className="marshal-dark-actions">
        <button type="button" disabled={busy || !allowed["gf.scene_dark_draw"]}
          onClick={() => submit("gf.scene_dark_draw")}>DRAW</button>
        {mustDiscard && <button type="button" className="marshal-dark-discard" aria-describedby={statusId}
          disabled={busy || !allowed["gf.scene_dark_discard_last"]}
          onClick={() => submit("gf.scene_dark_discard_last")}>DISCARD LAST</button>}
        <button type="button" className="marshal-dark-reveal" aria-describedby={statusId}
          disabled={busy || !allowed["gf.scene_dark_reveal"]}
          onClick={() => submit("gf.scene_dark_reveal")}>REVEAL</button>
      </div>
      <p id={statusId} role="status" className={mustDiscard ? "marshal-dark-warning" : "marshal-dark-status"}>{status}</p>
    </section>
  );
}

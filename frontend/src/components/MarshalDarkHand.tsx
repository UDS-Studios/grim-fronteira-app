import { useId } from "react";
import type { ActionResponse, View } from "../api/types";
import {
  canDarkDraw, canDarkDiscardLast, canDarkReveal, countUnfinishedDarkParticipants,
  getDarkMarshalHand, getDarkMarshalTotal, mustMarshalDiscardDarkCard,
} from "../utils/dark";
import { getTwentyOneColor } from "../views/player_table/sceneResolution";
import CardImg from "./CardImg";

export default function MarshalDarkHand({ resp, actorId, view, busy, onDiscardLast, onReveal }: {
  resp: ActionResponse; actorId: string; view: View;
  busy: boolean;
  onDiscardLast: () => void;
  onReveal: () => void;
}) {
  const statusId = useId();
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
  const status = mustDiscard ? "You have gone over 21. Click the last Dark card to discard it before continuing."
    : state.meta?.pending_interaction ? "Resolve the pending interaction before continuing."
    : scene?.status === "setup" ? "Start the scene when ready."
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
          return <div key={`${index}:${card}`} className="marshal-dark-card" role="listitem" tabIndex={forced ? undefined : 0}
            data-forced-discard={forced ? "true" : undefined} aria-label={`${label}: ${card}${forced ? ". Must discard last" : ""}`}>
            {forced ? <button type="button" className="marshal-dark-discard-card"
              aria-label={`Discard last Dark card: ${card}`} aria-describedby={statusId}
              disabled={busy || !allowed["gf.scene_dark_discard_last"]} onClick={onDiscardLast}>
              <CardImg cardId={card} width={86} title={`Discard last Dark card: ${card}`} />
              <span className="marshal-dark-card-label">CLICK TO DISCARD</span>
            </button> : <>
              <CardImg cardId={card} width={86} title={`${label}: ${card}`} />
              <span className="marshal-dark-card-label">{index === 0 ? "OPENING" : `EXTRA ${index}`}</span>
            </>}
          </div>;
        })}
        {!hand.length && <span>Draw the hidden difficulty from the deck.</span>}
      </div>
      <div className="marshal-dark-actions">
        <button type="button" className="marshal-dark-reveal" aria-describedby={statusId}
          disabled={busy || !allowed["gf.scene_dark_reveal"]}
          onClick={onReveal}>REVEAL</button>
      </div>
      {allowed["gf.scene_dark_draw"] && <p className="marshal-dark-status">Click the deck to draw another Dark card.</p>}
      <p id={statusId} role="status" className={mustDiscard ? "marshal-dark-warning" : "marshal-dark-status"}>{status}</p>
    </section>
  );
}

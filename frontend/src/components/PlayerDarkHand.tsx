import type { GameState } from "../api/types";
import { getDarkHiddenCardCount, getDarkMarshalHand, getDarkMarshalTotal, isDarkRevealed, isDarkScene } from "../utils/dark";
import CardImg from "./CardImg";

// Informational only: hidden mode reads counts, never identities, values or obligations.
export default function PlayerDarkHand({ state }: { state: GameState }) {
  const scene = state.meta?.scene;
  if (!isDarkScene(scene)) return null;
  const revealed = isDarkRevealed(scene);
  const cards = revealed ? getDarkMarshalHand(state) : [];
  const count = revealed ? cards.length : getDarkHiddenCardCount(state);
  const total = revealed ? getDarkMarshalTotal(scene) : null;
  return (
    <section className="player-dark-hand" aria-label="Marshal's Dark hand">
      <div className="player-dark-heading">
        <strong>MARSHAL'S DARK HAND</strong>
        <span>{count} {revealed ? "" : "hidden "}{count === 1 ? "card" : "cards"}</span>
      </div>
      <div key={revealed ? "revealed" : "hidden"}
        className={`player-dark-cards${revealed ? " player-dark-cards--revealed" : ""}`}
        style={{ gridTemplateColumns: `repeat(${Math.max(1, count)}, minmax(0, 72px))` }}>
        {Array.from({ length: count }, (_, index) => (
          <div className="player-dark-card" key={index} tabIndex={revealed ? 0 : undefined}
            aria-label={revealed ? `${index === 0 ? "Opening difficulty" : `Extra draw ${index}`}: ${cards[index]}` : undefined}>
            <CardImg cardId={revealed ? cards[index] : "BACK"} faceDown={!revealed} width={72}
              title={revealed ? cards[index] : "Hidden Dark card"} />
          </div>
        ))}
      </div>
      <div className="player-dark-total">
        <span>{revealed ? "MARSHAL TOTAL" : "TOTAL"}</span>
        <strong>{revealed ? total ?? "—" : "HIDDEN"}</strong>
      </div>
    </section>
  );
}

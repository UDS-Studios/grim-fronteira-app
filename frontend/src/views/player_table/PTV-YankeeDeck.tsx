import { DECK_CARD_WIDTH } from "../../components/difficultyDisplay";
import CardImg from "../../components/CardImg";
import type { YankeeChoice } from "./yankee";

export default function YankeeDeck({ cardId, deckCount, busy, onChoose }: {
  cardId: string;
  deckCount: number | string | undefined;
  busy: boolean;
  onChoose: (choice: YankeeChoice) => void;
}) {
  return (
    <div className="faction-power-panel" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, textAlign: "center" }}>
      <div>
        <CardImg cardId="BACK" faceDown width={DECK_CARD_WIDTH} title="Deck" />
        <div><b>{deckCount}</b> cards</div>
      </div>
      <div role="group" aria-label={`Inspected top card: ${cardId}`}>
        <CardImg cardId={cardId} width={DECK_CARD_WIDTH} title={`Inspected top card: ${cardId}`} />
        <div>TOP CARD · Only you can see this</div>
      </div>
      <button type="button" disabled={busy} onClick={() => onChoose("keep")}
        title="Keep the card on top of the deck"
        style={{ border: "2px solid var(--target-positive)", background: "var(--surface-muted)", padding: 10 }}>
        KEEP
      </button>
      <button type="button" disabled={busy} onClick={() => onChoose("bury")}
        title="Move the card to the bottom of the deck"
        style={{ border: "2px solid var(--border-strong)", background: "var(--surface-strong)", padding: 10 }}>
        BURY
      </button>
    </div>
  );
}

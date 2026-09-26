import CardImg from "./CardImg";

// Keep the pile shallow as it grows. Every card can be raised by hover/focus.
export default function DiscardPile({ cards }: { cards: string[] }) {
  if (cards.length === 0) return <div style={{ opacity: 0.6 }}>— empty —</div>;
  return (
    <div aria-label={`${cards.length} discarded cards`} style={{
      display: "grid", gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))`,
      paddingRight: 102, height: 154,
    }}>
      {cards.map((cardId, index) => (
        <div key={`${cardId}:${index}`} className="discard-card" tabIndex={0}
          aria-label={`Discard ${index + 1}: ${cardId}`}>
          <CardImg cardId={cardId} width={102} />
        </div>
      ))}
    </div>
  );
}

import CardImg from "./CardImg";

// Overlap older rows like a physical pile instead of growing the table for every
// discard. Every card remains in order and can be raised with hover or focus.
export default function DiscardPile({ cards }: { cards: string[] }) {
  if (cards.length === 0) return <div style={{ opacity: 0.6 }}>— empty —</div>;
  const rows = Math.ceil(cards.length / 3);
  const rowStep = Math.min(140, 140 / Math.max(1, rows - 1));
  return (
    <div>
      <div style={{ marginBottom: 8 }}>{cards.length} cards</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 90px)",
        justifyContent: "center", columnGap: 10, gridAutoRows: rowStep,
        paddingBottom: 140 - rowStep }}>
        {cards.map((cardId, index) => (
          <div key={`${cardId}:${index}`} className="discard-card" tabIndex={0}
            aria-label={`Discard ${index + 1}: ${cardId}`}>
            <CardImg cardId={cardId} width={88} />
          </div>
        ))}
      </div>
    </div>
  );
}

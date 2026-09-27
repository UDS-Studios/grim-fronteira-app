import CardImg from "./CardImg";

// At most two overlapping fan rows; every card still raises on hover/focus.
export default function DiscardPile({ cards }: { cards: string[] }) {
  if (cards.length === 0) return <div style={{ opacity: 0.6 }}>— empty —</div>;
  const rowSize = Math.max(12, Math.ceil(cards.length / 2));
  const rows = [cards.slice(0, rowSize), cards.slice(rowSize)].filter(row => row.length > 0);
  return (
    <div className="discard-pile" aria-label={`${cards.length} discarded cards`} style={{
      display: "grid", gridTemplateRows: `repeat(${rows.length}, 100px)`,
      height: rows.length === 1 ? 154 : 254,
    }}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="discard-fan-row" style={{
          display: "grid", gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
          paddingRight: 102, height: 154,
        }}>
          {row.map((cardId, index) => (
            <div key={`${cardId}:${index}`} className="discard-card" tabIndex={0}
              aria-label={`Discard ${rowIndex * rowSize + index + 1}: ${cardId}`}>
              <CardImg cardId={cardId} width={102} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

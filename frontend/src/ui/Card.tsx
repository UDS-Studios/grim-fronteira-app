type CardProps = {
  cardId: string;
  faceDown?: boolean;
  width?: number;
  title?: string;
};

export default function Card({ cardId, faceDown, width = 96, title }: CardProps) {
  const src = faceDown
    ? "/assets/cards/back/back.jpg"
    : `/assets/cards/front/${cardId}.jpg`;

  return (
    <img
      src={src}
      alt={faceDown ? "Card back" : cardId}
      title={title ?? (faceDown ? "Face-down" : cardId)}
      style={{
        width,
        height: "auto",
        borderRadius: 8,
        boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
      }}
      onError={(e) => {
        // show a visible fallback if a card image is missing
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
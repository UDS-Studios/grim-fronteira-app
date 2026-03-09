import { useState } from "react";

type CardImgProps = {
  cardId: string;
  faceDown?: boolean;
  width?: number;
  title?: string;
};

export default function CardImg({
  cardId,
  faceDown = false,
  width = 86,
  title,
}: CardImgProps) {
  const [hover, setHover] = useState(false);

  const src = faceDown
    ? "/assets/cards/back/back.jpg"
    : `/assets/cards/front/${cardId}.jpg`;

  return (
    <img
      src={src}
      alt={faceDown ? "Card back" : cardId}
      title={title ?? (faceDown ? "Face-down" : cardId)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width,
        height: "auto",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.2)",
        background: "#fff",
        boxShadow: hover
          ? "0 8px 22px rgba(0,0,0,0.35)"
          : "0 2px 10px rgba(0,0,0,0.25)",
        transform: hover ? "translateY(-6px) scale(1.12)" : "translateY(0) scale(1)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        position: "relative",
        zIndex: hover ? 10 : 1,
      }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

import CardImg from "../../components/CardImg";

export type PTVCardStackProps = {
  cardIds?: string[];
  count?: number;
  faceDown?: boolean;
  label?: string;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  accentCountColor?: string;
};

function getCardWidth(size: "sm" | "md" | "lg"): number {
  switch (size) {
    case "sm":
      return 54;
    case "md":
      return 72;
    case "lg":
      return 90;
    default:
      return 72;
  }
}

function getStackOffset(size: "sm" | "md" | "lg"): number {
  switch (size) {
    case "sm":
      return 10;
    case "md":
      return 14;
    case "lg":
      return 18;
    default:
      return 14;
  }
}

export default function PTVCardStack({
  cardIds = [],
  count,
  faceDown = false,
  label,
  size = "md",
  interactive = false,
  disabled = false,
  onClick,
  accentCountColor = "#9b1c1c",
}: PTVCardStackProps) {
  const width = getCardWidth(size);
  const offset = getStackOffset(size);

  const shownCount = typeof count === "number" ? count : cardIds.length;
  const isClickable = interactive && !disabled && typeof onClick === "function";

  if (faceDown) {
    return (
      <div
        style={{
          display: "grid",
          gap: 6,
          justifyItems: "center",
        }}
      >
        {label ? (
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              opacity: 0.85,
              textAlign: "center",
            }}
          >
            {label}
          </div>
        ) : null}

        <button
          type="button"
          onClick={isClickable ? onClick : undefined}
          disabled={!isClickable}
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: isClickable ? "pointer" : "default",
            position: "relative",
            opacity: disabled ? 0.7 : 1,
          }}
          title={label ?? "Card stack"}
        >
          <div
            style={{
              position: "relative",
              width,
              height: Math.round(width * 1.45),
            }}
          >
            {shownCount > 1 ? (
              <div style={{ position: "absolute", top: 0, left: 0 }}>
                <CardImg cardId="BACK" faceDown width={width} />
              </div>
            ) : null}

            <div
              style={{
                position: "absolute",
                top: shownCount > 1 ? 6 : 0,
                left: shownCount > 1 ? 8 : 0,
              }}
            >
              <CardImg cardId="BACK" faceDown width={width} />
            </div>

            <div
              style={{
                position: "absolute",
                right: -8,
                top: -8,
                minWidth: 24,
                height: 24,
                borderRadius: 999,
                background: "rgba(255,255,255,0.92)",
                border: "1px solid var(--border-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 6px",
                fontSize: 13,
                fontWeight: 800,
                color: accentCountColor,
                boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }}
            >
              {shownCount}
            </div>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        justifyItems: "center",
      }}
    >
      {label ? (
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            opacity: 0.85,
            textAlign: "center",
          }}
        >
          {label}
        </div>
      ) : null}

      {cardIds.length === 0 ? (
        <div
          style={{
            width,
            height: Math.round(width * 1.45),
            border: "1px dashed var(--border-muted)",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.45,
            fontSize: 12,
          }}
        >
          empty
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            height: Math.round(width * 1.45),
            width: width + Math.max(0, cardIds.length - 1) * offset,
          }}
        >
          {cardIds.map((cardId, idx) => (
            <button
              key={`${cardId}:${idx}`}
              type="button"
              onClick={isClickable ? onClick : undefined}
              disabled={!isClickable}
              style={{
                position: "absolute",
                top: 0,
                left: idx * offset,
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: isClickable ? "pointer" : "default",
                opacity: disabled ? 0.7 : 1,
              }}
              title={label ?? "Card stack"}
            >
              <CardImg cardId={cardId} width={width} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
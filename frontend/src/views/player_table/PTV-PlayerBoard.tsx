import CardImg from "../../components/CardImg";

export type PTVPlayerBoardProps = {
  displayName: string;
  summaryText?: string | null;
  figureCardId?: string | null;
  scumCardIds: string[];
  vengeanceCardIds: string[];
  rewardCardIds: string[];
  powerLabel: string;
  inScene?: boolean;
  powerDisabled?: boolean;
  onClickScum?: () => void;
  onClickVengeance?: () => void;
  onClickPower?: () => void;
};

type PowerArtKey =
  | "Children of the Earth"
  | "Heart of Shadow"
  | "Law of Lead"
  | "Order and Profit";

function getPowerArtSrc(powerLabel: string): string | null {
  const map: Record<PowerArtKey, string> = {
    "Children of the Earth": "/ui/powers/children_of_the_earth.png",
    "Heart of Shadow": "/ui/powers/heart_of_shadow.png",
    "Law of Lead": "/ui/powers/law_of_lead.png",
    "Order and Profit": "/ui/powers/order_and_profit.png",
  };

  return (map as Record<string, string>)[powerLabel] ?? null;
}

function FixedWidthFaceDownStack({
  cardIds,
  title,
  interactive = false,
  disabled = false,
  onClick,
}: {
  cardIds: string[];
  title: string;
  interactive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const shownCount = cardIds.length;
  const cardWidth = 120;
  const cardHeight = 174;
  const stackAreaWidth = 160;
  const maxSpread = 18;

  const offsets =
    shownCount <= 1
      ? [0]
      : Array.from({ length: shownCount }, (_, idx) =>
          Math.round((idx * maxSpread) / (shownCount - 1))
        );

  const isClickable = interactive && !disabled && typeof onClick === "function";

  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        justifyItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: "LavaArabic, serif",
          fontSize: 18,
          lineHeight: 1,
          opacity: 0.9,
          letterSpacing: "0.02em",
          textAlign: "center",
          width: "100%",
        }}
      >
        {title} : {shownCount}
      </div>

      <button
        type="button"
        onClick={isClickable ? onClick : undefined}
        disabled={!isClickable}
        title={title}
        style={{
          border: "none",
          background: "transparent",
          padding: 0,
          width: stackAreaWidth,
          cursor: isClickable ? "pointer" : "default",
          opacity: disabled ? 0.75 : 1,
          display: "grid",
          justifyItems: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: stackAreaWidth,
            height: cardHeight + 20,
          }}
        >
          {offsets.map((left, idx) => (
            <div
              key={`${title}:${idx}`}
              style={{
                position: "absolute",
                top: 10,
                left,
              }}
            >
              <CardImg cardId="BACK" faceDown width={cardWidth} />
            </div>
          ))}
        </div>
      </button>
    </div>
  );
}

function AdaptiveRewardsRow({
  cardIds,
}: {
  cardIds: string[];
}) {
  const cardWidth = 110;
  const cardHeight = 160;
  const containerWidth = 1000; // effectively limited by parent width

  if (cardIds.length === 0) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: cardHeight,
          border: "1px dashed var(--border-muted)",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.45,
          fontSize: 13,
        }}
      >
        no rewards yet
      </div>
    );
  }

  const gapWhenThereIsSpace = 8;
  const naturalWidth = cardIds.length * cardWidth + Math.max(0, cardIds.length - 1) * gapWhenThereIsSpace;
  const availableWidth = containerWidth;
  const maxLeft = Math.max(availableWidth - cardWidth, 0);

  const step =
    cardIds.length === 1
      ? 0
      : naturalWidth <= availableWidth
        ? cardWidth + gapWhenThereIsSpace
        : maxLeft / (cardIds.length - 1);

  const renderedWidth =
    cardIds.length === 1 ? cardWidth : cardWidth + step * (cardIds.length - 1);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minHeight: cardHeight + 24,
        paddingTop: 8,
        paddingBottom: 8,
        overflow: "visible",
      }}
    >
      <div
        style={{
          position: "relative",
          width: renderedWidth,
          height: cardHeight,
        }}
      >
        {cardIds.map((cardId, idx) => (
          <div
            key={`${cardId}:${idx}`}
            style={{
              position: "absolute",
              top: 0,
              left: idx * step,
            }}
          >
            <CardImg cardId={cardId} width={cardWidth} />
          </div>
        ))}
      </div>
    </div>
  );
}

function splitSummaryText(summaryText?: string | null): string[] {
  const normalized = summaryText?.trim();
  if (!normalized) return [];

  const words = normalized.split(/\s+/);
  if (words.length <= 2) return [normalized];

  let bestIndex = 1;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (let idx = 1; idx < words.length; idx += 1) {
    const left = words.slice(0, idx).join(" ");
    const right = words.slice(idx).join(" ");
    const diff = Math.abs(left.length - right.length);

    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = idx;
    }
  }

  return [
    words.slice(0, bestIndex).join(" "),
    words.slice(bestIndex).join(" "),
  ];
}

export default function PTVPlayerBoard({
  displayName,
  summaryText,
  figureCardId,
  scumCardIds,
  vengeanceCardIds,
  rewardCardIds,
  powerLabel,
  inScene = false,
  powerDisabled = true,
  onClickScum,
  onClickVengeance,
  onClickPower,
}: PTVPlayerBoardProps) {
  const powerArtSrc = getPowerArtSrc(powerLabel);
  const summaryLines = splitSummaryText(summaryText);
  const figureCardWidth = 150;
  const figureCardHeight = 217;

  return (
    <div
      style={{
        width: "100%",
        display: "grid",
        justifyItems: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 920,
          border: "1px solid var(--border-strong)",
          borderRadius: 18,
          background: "var(--surface-strong)",
          overflow: "hidden",
          boxShadow: inScene ? "0 0 0 2px rgba(139,90,43,0.18)" : "none",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "minmax(140px, 1fr) minmax(180px, 1.18fr) minmax(140px, 1fr) minmax(200px, 1.12fr)",
            columnGap: 20,
            alignItems: "start",
            padding: "18px 20px 20px",
            borderBottom: "1px solid var(--border-muted)",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 6,
              justifyItems: "center",
              alignContent: "start",
              paddingTop: 8,
            }}
          >
            <FixedWidthFaceDownStack
              cardIds={scumCardIds}
              title="SCUM"
              interactive={typeof onClickScum === "function"}
              disabled={typeof onClickScum !== "function"}
              onClick={onClickScum}
            />
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              justifyItems: "center",
              alignContent: "start",
            }}
          >
            <div
              style={{
                fontFamily: "LavaArabic, serif",
                fontSize: 30,
                lineHeight: 1,
                letterSpacing: "0.02em",
                textAlign: "center",
              }}
            >
              {displayName}
            </div>

            <div
              style={{
                minHeight: 226,
                display: "grid",
                alignItems: "center",
                justifyItems: "center",
              }}
            >
              {figureCardId ? (
                <CardImg cardId={figureCardId} width={figureCardWidth} />
              ) : (
                <div
                  style={{
                    width: figureCardWidth,
                    height: figureCardHeight,
                    border: "1px dashed var(--border-muted)",
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: 0.5,
                    fontSize: 13,
                  }}
                >
                  no figure
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 6,
              justifyItems: "center",
              alignContent: "start",
              paddingTop: 8,
            }}
          >
            <FixedWidthFaceDownStack
              cardIds={vengeanceCardIds}
              title="VENGEANCE"
              interactive={typeof onClickVengeance === "function"}
              disabled={typeof onClickVengeance !== "function"}
              onClick={onClickVengeance}
            />
          </div>

          <div
            style={{
              display: "grid",
              gap: 18,
              alignContent: "start",
              justifyItems: "start",
              paddingTop: 34,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 2,
                lineHeight: 1.2,
                opacity: 0.82,
                fontSize: 15,
              }}
            >
              {summaryLines.length > 0 ? (
                summaryLines.map((line, idx) => <div key={`${line}:${idx}`}>{line}</div>)
              ) : (
                <div style={{ opacity: 0.5 }}>No description</div>
              )}
            </div>

            <button
              type="button"
              onClick={powerDisabled ? undefined : onClickPower}
              disabled={powerDisabled}
              title={powerDisabled ? "Power not available yet" : powerLabel}
              style={{
                border: "1px solid var(--border-muted)",
                borderRadius: 16,
                background: powerDisabled
                  ? "var(--surface-muted)"
                  : "var(--surface-bg)",
                color: "inherit",
                cursor: powerDisabled ? "not-allowed" : "pointer",
                opacity: powerDisabled ? 0.82 : 1,
                padding: 0,
                overflow: "hidden",
                width: 150,
                height: 150,
                display: "block",
              }}
            >
              {powerArtSrc ? (
                <img
                  src={powerArtSrc}
                  alt={powerLabel}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    padding: 12,
                    fontWeight: 800,
                    lineHeight: 1.2,
                  }}
                >
                  {powerLabel}
                </div>
              )}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 8,
            padding: "14px 20px 20px",
          }}
        >
          <div
            style={{
              fontFamily: "LavaArabic, serif",
              fontSize: 18,
              lineHeight: 1,
              opacity: 0.9,
              letterSpacing: "0.02em",
            }}
          >
            REWARDS
          </div>

          <AdaptiveRewardsRow cardIds={rewardCardIds} />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
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

function useResponsiveScale(minWidth: number, maxScale: number, minScale = 1) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const nextScale = Math.max(minScale, Math.min(maxScale, width / minWidth));
      setScale(nextScale);
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [maxScale, minScale, minWidth]);

  return { ref, scale };
}

function FixedWidthFaceDownStack({
  cardIds,
  title,
  scale = 1,
  interactive = false,
  disabled = false,
  onClick,
}: {
  cardIds: string[];
  title: string;
  scale?: number;
  interactive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const shownCount = cardIds.length;
  const cardWidth = 120 * scale;
  const cardHeight = 174 * scale;
  const stackAreaWidth = 160 * scale;
  const maxSpread = 18 * scale;

  const offsets =
    shownCount === 0
      ? []
      : shownCount === 1
      ? [0]
      : Array.from({ length: shownCount }, (_, idx) =>
          Math.round((idx * maxSpread) / (shownCount - 1))
        );

  const isClickable = interactive && !disabled && typeof onClick === "function";

  return (
    <div
      style={{
        display: "grid",
        gap: 6 * scale,
        justifyItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: "LavaArabic, serif",
          fontSize: 24 * scale,
          lineHeight: 1,
          opacity: 0.9,
          letterSpacing: "0.02em",
          textAlign: "center",
          width: stackAreaWidth,
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
          {shownCount === 0 ? (
            <div
              style={{
                position: "absolute",
                top: 10 * scale,
                left: (stackAreaWidth - cardWidth) / 2,
                width: cardWidth,
                height: cardHeight,
                border: "1px dashed var(--border-muted)",
                borderRadius: 12 * scale,
                opacity: 0.35,
              }}
            />
          ) : (
            offsets.map((left, idx) => (
              <div
                key={`${title}:${idx}`}
                style={{
                  position: "absolute",
                  top: 10 * scale,
                  left,
                }}
              >
                <CardImg cardId="BACK" faceDown width={cardWidth} />
              </div>
            ))
          )}
        </div>
      </button>
    </div>
  );
}

function AdaptiveRewardsRow({
  cardIds,
  scale = 1,
}: {
  cardIds: string[];
  scale?: number;
}) {
  const cardWidth = 88 * scale;
  const cardHeight = 128 * scale;
  const containerWidth = 1000 * scale; // effectively limited by parent width

  if (cardIds.length === 0) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: cardHeight,
          border: "1px dashed var(--border-muted)",
          borderRadius: 12 * scale,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.45,
          fontSize: 13 * scale,
        }}
      >
        no rewards yet
      </div>
    );
  }

  const gapWhenThereIsSpace = 8 * scale;
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
        paddingTop: 8 * scale,
        paddingBottom: 8 * scale,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSummaryText(
  summaryText?: string | null,
  displayName?: string | null
): string {
  const normalized = summaryText?.trim() ?? "";
  if (!normalized) return "";

  const cleanedDisplayName = displayName?.trim();
  let nextText = normalized;

  if (cleanedDisplayName) {
    const displayNamePattern = new RegExp(
      `^${escapeRegExp(cleanedDisplayName)}\\s*,?\\s*`,
      "i"
    );
    nextText = nextText.replace(displayNamePattern, "").trim();
  }

  if (!nextText) return "";

  return nextText.replace(/^\p{L}/u, (char) => char.toUpperCase());
}

function splitSummaryText(
  summaryText?: string | null,
  displayName?: string | null
): string[] {
  const normalized = normalizeSummaryText(summaryText, displayName);
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
  const { ref, scale } = useResponsiveScale(780, 1.4, 0.7);
  const s = (value: number) => value * scale;
  const powerArtSrc = getPowerArtSrc(powerLabel);
  const summaryLines = splitSummaryText(summaryText, displayName);
  const figureCardWidth = s(150);
  const figureCardHeight = s(217);

  return (
    <div
      style={{
        width: "100%",
        display: "grid",
        justifyItems: "center",
      }}
    >
      <div
        ref={ref}
        style={{
          width: "100%",
          maxWidth: 1092,
          border: "1px solid var(--border-strong)",
          borderRadius: s(18),
          background: "var(--surface-strong)",
          overflow: "hidden",
          boxShadow: inScene ? "0 0 0 2px rgba(139,90,43,0.18)" : "none",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${s(500)}px ${s(240)}px`,
            columnGap: s(20),
            alignItems: "start",
            justifyContent: "space-between",
            padding: `${s(18)}px ${s(20)}px ${s(20)}px`,
            borderBottom: "1px solid var(--border-muted)",
          }}
        >
          <div
            style={{
              width: s(500),
              display: "grid",
              gap: s(16),
              alignContent: "start",
              border: "1px solid var(--border-muted)",
              borderRadius: s(16),
              padding: `${s(14)}px ${s(18)}px ${s(18)}px`,
              background: "var(--surface-bg)",
            }}
          >
            <div
              style={{
                fontSize: s(28),
                fontWeight: 800,
                lineHeight: 1,
                textAlign: "center",
              }}
            >
              {displayName}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `${s(135)}px ${s(170)}px ${s(135)}px`,
                columnGap: s(12),
                alignItems: "start",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: s(6),
                  justifyItems: "center",
                  alignContent: "start",
                  paddingTop: s(20),
                }}
              >
                <FixedWidthFaceDownStack
                  cardIds={scumCardIds}
                  title="SCUM"
                  scale={scale}
                  interactive={typeof onClickScum === "function"}
                  disabled={typeof onClickScum !== "function"}
                  onClick={onClickScum}
                />
              </div>

              <div
                style={{
                  minHeight: s(226),
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
                      borderRadius: s(12),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: 0.5,
                      fontSize: s(13),
                    }}
                  >
                    no figure
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gap: s(6),
                  justifyItems: "center",
                  alignContent: "start",
                  paddingTop: s(20),
                }}
              >
                <FixedWidthFaceDownStack
                  cardIds={vengeanceCardIds}
                  title="VENGEANCE"
                  scale={scale}
                  interactive={typeof onClickVengeance === "function"}
                  disabled={typeof onClickVengeance !== "function"}
                  onClick={onClickVengeance}
                />
              </div>
            </div>
          </div>

          <div
            style={{
              width: s(240),
              display: "grid",
              gap: s(18),
              alignContent: "start",
              justifyItems: "start",
              paddingTop: s(22),
              paddingLeft: s(44),
            }}
          >
            <div
              style={{
                fontFamily: "LavaArabic, serif",
                fontSize: s(22),
                lineHeight: 1,
                opacity: 0.9,
                letterSpacing: "0.02em",
              }}
            >
              DESCRIPTION
            </div>

            <div
              style={{
                display: "grid",
                gap: s(2),
                lineHeight: 1.2,
                opacity: 0.82,
                fontSize: s(15),
              }}
            >
              {summaryLines.length > 0 ? (
                summaryLines.map((line, idx) => <div key={`${line}:${idx}`}>{line}</div>)
              ) : (
                <div style={{ opacity: 0.5 }}>No description</div>
              )}
            </div>

            <div
              style={{
                fontFamily: "LavaArabic, serif",
                fontSize: s(16),
                lineHeight: 1,
                opacity: 0.9,
                letterSpacing: "0.02em",
              }}
            >
              FACTION POWER
            </div>

            <button
              type="button"
              onClick={powerDisabled ? undefined : onClickPower}
              disabled={powerDisabled}
              title={powerDisabled ? "Power not available yet" : powerLabel}
              style={{
                border: "1px solid var(--border-muted)",
                borderRadius: s(16),
                background: powerDisabled
                  ? "var(--surface-muted)"
                  : "var(--surface-bg)",
                color: "inherit",
                cursor: powerDisabled ? "not-allowed" : "pointer",
                opacity: powerDisabled ? 0.82 : 1,
                padding: 0,
                overflow: "hidden",
                width: s(150),
                height: s(150),
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
                    padding: s(12),
                    fontWeight: 800,
                    lineHeight: 1.2,
                    fontSize: s(16),
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
            gap: s(8),
            padding: `${s(14)}px ${s(20)}px ${s(20)}px`,
          }}
        >
          <div
            style={{
              fontFamily: "LavaArabic, serif",
              fontSize: s(18),
              lineHeight: 1,
              opacity: 0.9,
              letterSpacing: "0.02em",
            }}
          >
            REWARDS
          </div>

          <AdaptiveRewardsRow cardIds={rewardCardIds} scale={scale} />
        </div>
      </div>
    </div>
  );
}

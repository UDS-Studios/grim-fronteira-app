import CardImg from "../components/CardImg";

type LobbyPlayerState = {
  chosen_name?: string | null;
  character_label?: string | null;
  chosen_feature?: string | null;
  summary_text?: string | null;
};

type PlayerSummaryCardProps = {
  playerId: string;
  pstate: LobbyPlayerState;
  figureCardId?: string | null;
  figureDead?: boolean;
  scumCount: number;
  vengeanceCount: number;
  rewardCount: number;
  woundsCount?: number;
  figureRotated?: boolean;
  footerNote?: string | null;
  selected?: boolean;
  scale?: number;
};

export default function PlayerSummaryCard({
  playerId,
  pstate,
  figureCardId,
  figureDead = false,
  scumCount,
  vengeanceCount,
  rewardCount,
  woundsCount = 0,
  figureRotated = false,
  footerNote = null,
  selected = false,
  scale = 1,
}: PlayerSummaryCardProps) {
  const displayName =
    pstate.chosen_name ??
    pstate.summary_text ??
    playerId;

  const label = pstate.character_label ?? "Unknown";
  const feature = pstate.chosen_feature ?? null;

  return (
    <div
      style={{
        border: "1px solid var(--border-muted)",
        borderRadius: 12 * scale,
        padding: 10 * scale,
        background: selected
          ? "var(--player-selected-bg)"
          : "var(--surface-strong)",
        display: "grid",
        gap: 8 * scale,
        minWidth: 0,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", gap: 10 * scale, alignItems: "flex-start", minWidth: 0 }}>
        <div style={{ minWidth: 70 * scale, flexShrink: 0 }}>
          {figureCardId ? (
            <CardImg
              cardId={figureCardId}
              width={64 * scale}
              rotationDeg={figureRotated ? 90 : 0}
              deadVariant={figureDead}
            />
          ) : (
            <div style={{ opacity: 0.6, fontSize: 14 * scale }}>No figure</div>
          )}
        </div>

        <div style={{ display: "grid", gap: 4 * scale, minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: 16 * scale,
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {displayName}
          </div>
          <div style={{ fontSize: 14 * scale, opacity: 0.9, minWidth: 0, overflowWrap: "anywhere" }}>
            {label}
          </div>
          {feature ? (
            <div style={{ fontSize: 13 * scale, opacity: 0.75, minWidth: 0, overflowWrap: "anywhere" }}>
              {feature}
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8 * scale,
          fontSize: 14 * scale,
          minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <b>Scum:</b> {scumCount}
        </div>
        <div style={{ minWidth: 0 }}>
          <b>Vengeance:</b> {vengeanceCount}
        </div>
        <div style={{ minWidth: 0 }}>
          <b>Rewards:</b> {rewardCount}
        </div>
        <div style={{ minWidth: 0 }}>
          <b>Wounds:</b> {woundsCount}
        </div>
      </div>

      {footerNote ? (
        <div
          style={{
            fontSize: 13 * scale,
            fontWeight: 700,
            color: "#2f5d7a",
          }}
        >
          {footerNote}
        </div>
      ) : null}
    </div>
  );
}

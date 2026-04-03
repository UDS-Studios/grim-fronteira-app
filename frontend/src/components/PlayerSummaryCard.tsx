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
      }}
    >
      <div style={{ display: "flex", gap: 10 * scale, alignItems: "flex-start" }}>
        <div style={{ minWidth: 70 * scale }}>
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

        <div style={{ display: "grid", gap: 4 * scale }}>
          <div style={{ fontWeight: 800, fontSize: 16 * scale }}>{displayName}</div>
          <div style={{ fontSize: 14 * scale, opacity: 0.9 }}>{label}</div>
          {feature && <div style={{ fontSize: 13 * scale, opacity: 0.75 }}>{feature}</div>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 * scale, fontSize: 14 * scale }}>
        <div><b>Scum:</b> {scumCount}</div>
        <div><b>Vengeance:</b> {vengeanceCount}</div>
        <div><b>Rewards:</b> {rewardCount}</div>
        <div><b>Wounds:</b> {woundsCount}</div>
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

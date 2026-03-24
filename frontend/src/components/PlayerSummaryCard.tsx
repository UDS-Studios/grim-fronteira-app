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
  scumCount: number;
  vengeanceCount: number;
  rewardCount: number;
  selected?: boolean;
};

export default function PlayerSummaryCard({
  playerId,
  pstate,
  figureCardId,
  scumCount,
  vengeanceCount,
  rewardCount,
  selected = false,
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
        borderRadius: 12,
        padding: 10,
        background: selected
          ? "var(--player-selected-bg)"
          : "var(--surface-strong)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 70 }}>
          {figureCardId ? (
            <CardImg cardId={figureCardId} width={64} />
          ) : (
            <div style={{ opacity: 0.6 }}>No figure</div>
          )}
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontWeight: 800 }}>{displayName}</div>
          <div style={{ fontSize: 14, opacity: 0.9 }}>{label}</div>
          {feature && <div style={{ fontSize: 13, opacity: 0.75 }}>{feature}</div>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: 14 }}>
        <div><b>Scum:</b> {scumCount}</div>
        <div><b>Vengeance:</b> {vengeanceCount}</div>
        <div><b>Rewards:</b> {rewardCount}</div>
      </div>
    </div>
  );
}

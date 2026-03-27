import CardImg from "../../components/CardImg";
import TableZone from "../../components/TableZone";

export type PTVOtherPlayersEntry = {
  playerId: string;
  displayName: string;
  figureCardId?: string | null;
  scumCount: number;
  vengeanceCount: number;
  rewardCount: number;
  inScene?: boolean;
};

export type PTVOtherPlayersProps = {
  players: PTVOtherPlayersEntry[];
};

function MiniFaceDownStack({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  const cardWidth = 54;
  const cardHeight = 78;
  const spread = count > 1 ? 8 : 0;

  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        justifyItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: "LavaArabic, serif",
          fontSize: 14,
          lineHeight: 1,
          textAlign: "center",
          opacity: 0.9,
        }}
      >
        {label} : {count}
      </div>

      <div
        style={{
          position: "relative",
          width: cardWidth + spread,
          height: cardHeight,
        }}
      >
        {count > 1 ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            <CardImg cardId="BACK" faceDown width={cardWidth} />
          </div>
        ) : null}

        <div
          style={{
            position: "absolute",
            top: 0,
            left: spread,
          }}
        >
          <CardImg cardId="BACK" faceDown width={cardWidth} />
        </div>
      </div>
    </div>
  );
}

function OtherPlayerMini({
  player,
}: {
  player: PTVOtherPlayersEntry;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border-muted)",
        borderRadius: 14,
        padding: 12,
        background: player.inScene
          ? "var(--player-selected-bg)"
          : "var(--surface-strong)",
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{
          textAlign: "center",
          fontWeight: 800,
          lineHeight: 1.15,
        }}
      >
        {player.displayName}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "72px 72px 72px",
          justifyContent: "center",
          alignItems: "start",
          columnGap: 10,
        }}
      >
        <MiniFaceDownStack label="SCUM" count={player.scumCount} />

        <div
          style={{
            display: "grid",
            justifyItems: "center",
            gap: 4,
          }}
        >
          {player.figureCardId ? (
            <CardImg cardId={player.figureCardId} width={64} />
          ) : (
            <div
              style={{
                width: 64,
                height: 92,
                border: "1px dashed var(--border-muted)",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.5,
                fontSize: 11,
              }}
            >
              no figure
            </div>
          )}

          {player.inScene ? (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                opacity: 0.85,
              }}
            >
              In scene
            </div>
          ) : null}
        </div>

        <MiniFaceDownStack label="VENGEANCE" count={player.vengeanceCount} />
      </div>

      <div
        style={{
          fontSize: 13,
          textAlign: "center",
          opacity: 0.85,
        }}
      >
        <b>Rewards:</b> {player.rewardCount}
      </div>
    </div>
  );
}

export default function PTVOtherPlayers({
  players,
}: PTVOtherPlayersProps) {
  return (
    <TableZone title="Other Players">
      {players.length === 0 ? (
        <div style={{ opacity: 0.6 }}>— no other players —</div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 12,
          }}
        >
          {players.map((player) => (
            <OtherPlayerMini
              key={player.playerId}
              player={player}
            />
          ))}
        </div>
      )}
    </TableZone>
  );
}
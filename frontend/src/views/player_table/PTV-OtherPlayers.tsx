import CardImg from "../../components/CardImg";
import ResponsiveScaleBox from "../../components/ResponsiveScaleBox";
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
  scale = 1,
}: {
  label: string;
  count: number;
  scale?: number;
}) {
  const cardWidth = 54 * scale;
  const cardHeight = 78 * scale;
  const spread = count > 1 ? 8 * scale : 0;

  return (
    <div
      style={{
        display: "grid",
        gap: 4 * scale,
        justifyItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: "LavaArabic, serif",
          fontSize: 14 * scale,
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
  scale = 1,
}: {
  player: PTVOtherPlayersEntry;
  scale?: number;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border-muted)",
        borderRadius: 14 * scale,
        padding: 12 * scale,
        background: player.inScene
          ? "var(--player-selected-bg)"
          : "var(--surface-strong)",
        display: "grid",
        gap: 10 * scale,
      }}
    >
      <div
        style={{
          textAlign: "center",
          fontWeight: 800,
          lineHeight: 1.15,
          fontSize: 16 * scale,
        }}
      >
        {player.displayName}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${72 * scale}px ${72 * scale}px ${72 * scale}px`,
          justifyContent: "center",
          alignItems: "start",
          columnGap: 10 * scale,
        }}
      >
        <MiniFaceDownStack label="SCUM" count={player.scumCount} scale={scale} />

        <div
          style={{
            display: "grid",
            justifyItems: "center",
            gap: 4 * scale,
          }}
        >
          {player.figureCardId ? (
            <CardImg cardId={player.figureCardId} width={64 * scale} />
          ) : (
            <div
              style={{
                width: 64 * scale,
                height: 92 * scale,
                border: "1px dashed var(--border-muted)",
                borderRadius: 10 * scale,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.5,
                fontSize: 11 * scale,
              }}
            >
              no figure
            </div>
          )}

          {player.inScene ? (
            <div
              style={{
                fontSize: 11 * scale,
                fontWeight: 700,
                opacity: 0.85,
              }}
            >
              In scene
            </div>
          ) : null}
        </div>

        <MiniFaceDownStack
          label="VENGEANCE"
          count={player.vengeanceCount}
          scale={scale}
        />
      </div>

      <div
        style={{
          fontSize: 13 * scale,
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
  const scale = 1.6;

  return (
    <ResponsiveScaleBox baseWidth={480} minScale={0.5} maxScale={1}>
      <TableZone title="Other Players">
        {players.length === 0 ? (
          <div style={{ opacity: 0.6, fontSize: 14 * scale }}>— no other players —</div>
        ) : (
        <div
          style={{
            display: "grid",
            gap: 12 * scale,
          }}
        >
          {players.map((player) => (
            <OtherPlayerMini
              key={player.playerId}
              player={player}
              scale={scale}
            />
          ))}
        </div>
        )}
      </TableZone>
    </ResponsiveScaleBox>
  );
}

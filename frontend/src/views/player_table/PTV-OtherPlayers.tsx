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
  scenePlayedCards?: string[];
  sceneTotal?: number | null;
  sceneState?: "waiting" | "active" | "done";
  sceneStateLabel?: string | null;
  sceneOutcome?: {
    label: string;
    color: string;
  } | null;
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

      {player.inScene ? (
        <div
          style={{
            border:
              player.sceneState === "active"
                ? "2px solid var(--border-strong)"
                : "1px solid var(--border-muted)",
            borderRadius: 12 * scale,
            padding: 10 * scale,
            background:
              player.sceneState === "active"
                ? "color-mix(in srgb, var(--surface-hover) 72%, transparent)"
                : player.sceneState === "done"
                  ? "color-mix(in srgb, var(--surface-muted) 82%, transparent)"
                  : "var(--surface-bg)",
            opacity: player.sceneState === "done" ? 0.82 : 1,
            display: "grid",
            gap: 8 * scale,
            alignContent: "start",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8 * scale,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 12 * scale, fontWeight: 800 }}>Scene Lane</div>
            {player.sceneStateLabel ? (
              <div style={{ fontSize: 11 * scale, fontWeight: 700, opacity: 0.8 }}>
                {player.sceneStateLabel}
              </div>
            ) : null}
          </div>

          {player.sceneOutcome ? (
            <div
              style={{
                fontWeight: 900,
                color: player.sceneOutcome.color,
                fontSize: 14 * scale,
                lineHeight: 1,
              }}
            >
              {player.sceneOutcome.label}
            </div>
          ) : null}

          <div style={{ fontSize: 12 * scale, fontWeight: 700 }}>
            Total: {player.sceneTotal ?? "-"}
          </div>

          {player.scenePlayedCards && player.scenePlayedCards.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6 * scale,
                alignItems: "flex-start",
              }}
            >
              {player.scenePlayedCards.map((cardId, idx) => (
                <CardImg
                  key={`${player.playerId}:${cardId}:${idx}`}
                  cardId={cardId}
                  width={44 * scale}
                />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11 * scale, opacity: 0.65 }}>— no cards yet —</div>
          )}
        </div>
      ) : null}
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

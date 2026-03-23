import CardImg from "../components/CardImg";
import IconButton from "../components/IconButton";
import TableZone from "../components/TableZone";
import PlayerSummaryCard from "../components/PlayerSummaryCard";
import { getGame } from "../api/gf";
import type { ActionResponse, View } from "../api/types";

type MarshalTableViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  onBackHome: () => void;
};

type LobbyPlayerState = {
  chosen_name?: string | null;
  character_label?: string | null;
  chosen_feature?: string | null;
  summary_text?: string | null;
};

function PlayerLane({
  playerId,
  pstate,
  figureCardId,
  playedCards,
}: {
  playerId: string;
  pstate: LobbyPlayerState;
  figureCardId?: string | null;
  playedCards: string[];
}) {
  const displayName = pstate.chosen_name ?? playerId;
  const label = pstate.character_label ?? "Unknown";
  const feature = pstate.chosen_feature ?? null;

  return (
    <div
      style={{
        border: "1px solid var(--border-muted)",
        borderRadius: 12,
        padding: 12,
        background: "var(--surface-strong)",
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "88px 1fr",
          gap: 12,
          alignItems: "start",
        }}
      >
        <div>
          {figureCardId ? (
            <CardImg cardId={figureCardId} width={80} />
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

      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Played Cards</div>
        {playedCards.length === 0 ? (
          <div style={{ opacity: 0.6 }}>— no cards yet —</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {playedCards.map((cardId, idx) => (
              <CardImg
                key={`${playerId}:${cardId}:${idx}`}
                cardId={cardId}
                width={70}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MarshalTableView({
  resp,
  view,
  run,
  onBackHome,
}: MarshalTableViewProps) {
  const state = (resp.state as any) ?? {};
  const meta = state.meta ?? {};
  const zones: Record<string, string[]> = state.zones ?? {};

  const playersOrder: string[] = meta.players_order ?? [];
  const marshalId = meta.marshal_id ?? "";
  const scene = meta.scene ?? {};
  const lobby = meta.lobby ?? {};
  const lobbyPlayers: Record<string, LobbyPlayerState> = lobby.players ?? {};

  const nonMarshalPlayers = playersOrder.filter((pid) => pid !== marshalId);

  const deckCount = Array.isArray(state.deck)
    ? state.deck.length
    : meta.deck_count ?? "-";

  const discardZone =
    zones["scene.discard"] ??
    zones["discard"] ??
    [];

  const difficultyCards =
    zones["scene.difficulty"] ??
    zones["scene.challenge"] ??
    [];

  const hiddenDifficultyCards =
    zones["scene.difficulty_hidden"] ??
    zones["scene.azzardo"] ??
    [];

  // Placeholder until backend exposes scene participants explicitly.
  const participantIds: string[] = nonMarshalPlayers;

  function getPlayerFigure(pid: string): string | null {
    return (zones[`players.${pid}.character`] ?? [])[0] ?? null;
  }

  function getPlayerPlayedCards(pid: string): string[] {
    return (
      zones[`players.${pid}.played`] ??
      zones[`players.${pid}.hand_played`] ??
      zones[`scene.players.${pid}.played`] ??
      []
    );
  }

  function getPlayerScumCount(pid: string): number {
    return (zones[`players.${pid}.scum`] ?? []).length;
  }

  function getPlayerVengeanceCount(pid: string): number {
    return (zones[`players.${pid}.vengeance`] ?? []).length;
  }

  function getPlayerRewardCount(pid: string): number {
    return (zones[`players.${pid}.rewards`] ?? []).length;
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        marginTop: 12,
        gap: 12,
      }}
    >
      {/* Header / top utility area */}
      <div
        style={{
          flexShrink: 0,
          display: "grid",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "56px 1fr 56px",
            alignItems: "center",
            gap: 12,
          }}
        >
          <IconButton
            src="/ui/home.png"
            alt="Home"
            title="Return to Home"
            onClick={onBackHome}
          />

          <h1
            style={{
              margin: 0,
              textAlign: "center",
              fontFamily: "LavaArabic, serif",
              letterSpacing: "0.04em",
            }}
          >
            Saloon Table
          </h1>

          <IconButton
            src="/ui/refresh.png"
            alt="Refresh"
            title="Refresh Table"
            onClick={() => run(getGame(resp.game_id, view))}
          />
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div><b>phase:</b> {meta.phase ?? "-"}</div>
          <div><b>game_id:</b> {resp.game_id}</div>
          <div><b>revision:</b> {resp.revision}</div>
          <div><b>difficulty:</b> {scene.difficulty_value ?? "-"}</div>
          <div><b>dark mode:</b> {scene.dark_mode ? "ON" : "off"}</div>
        </div>
      </div>

      {/* Main board area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          gap: 14,
          overflow: "hidden",
        }}
      >
        {/* Left column */}
        <div
          style={{
            display: "grid",
            gap: 14,
            overflowY: "auto",
            minHeight: 0,
            alignContent: "start",
          }}
        >
          <TableZone title="Deck">
            <button
              type="button"
              onClick={() => {
                console.log("TODO: Marshal draws difficulty from deck");
              }}
              style={{
                border: "1px solid var(--border-muted)",
                borderRadius: 12,
                padding: 10,
                background: "var(--surface-strong)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
              }}
              title="TODO: Draw difficulty card"
            >
              <CardImg cardId="BACK" faceDown width={86} title="Deck" />
              <div><b>{deckCount}</b> cards</div>
            </button>
          </TableZone>

          <TableZone title="Discard">
            {discardZone.length === 0 ? (
              <div style={{ opacity: 0.6 }}>— empty —</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {discardZone.map((cardId, idx) => (
                  <CardImg key={`${cardId}:${idx}`} cardId={cardId} width={70} />
                ))}
              </div>
            )}
          </TableZone>
        </div>

        {/* Center / scene engine */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: "auto 1fr",
            gap: 14,
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <TableZone title="Difficulty / Scene">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "220px 1fr",
                gap: 20,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  border: "1px solid var(--border-muted)",
                  borderRadius: 14,
                  padding: 16,
                  background: "var(--surface-muted)",
                  minHeight: 170,
                  maxHeight: 220,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    fontFamily: "LavaArabic, serif",
                    fontSize: "3rem",
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  10 +
                </div>

                {difficultyCards.length > 0 ? (
                  <CardImg cardId={difficultyCards[0]} width={90} title="Difficulty card" />
                ) : (
                  <div style={{ opacity: 0.6 }}>— no card —</div>
                )}

                {hiddenDifficultyCards.length > 0 ? (
                  <CardImg cardId="BACK" faceDown width={90} title="Hidden azzardo card" />
                ) : (
                  <div style={{ opacity: 0.35, fontSize: 13 }}>no azzardo</div>
                )}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div><b>difficulty value:</b> {scene.difficulty_value ?? "-"}</div>
                <div><b>difficulty rule:</b> {scene.difficulty_rule ?? "-"}</div>
                <div><b>dark mode:</b> {scene.dark_mode ? "ON" : "off"}</div>
                <div><b>participants:</b> {participantIds.length}</div>
              </div>
            </div>
          </TableZone>

          <div style={{ minHeight: 0, overflow: "hidden" }}>
            <TableZone title="Scene Participants">
              <div
                style={{
                  maxHeight: "100%",
                  overflowY: "auto",
                  display: "grid",
                  gap: 12,
                  minHeight: 0,
                }}
              >
                {participantIds.length === 0 ? (
                  <div style={{ opacity: 0.6 }}>— no players selected —</div>
                ) : (
                  participantIds.map((pid) => (
                    <PlayerLane
                      key={pid}
                      playerId={pid}
                      pstate={lobbyPlayers[pid] ?? {}}
                      figureCardId={getPlayerFigure(pid)}
                      playedCards={getPlayerPlayedCards(pid)}
                    />
                  ))
                )}
              </div>
            </TableZone>
          </div>
        </div>
      </div>

      {/* Bottom player strip */}
      <div style={{ flexShrink: 0 }}>
        <TableZone title="Players">
          {nonMarshalPlayers.length === 0 ? (
            <div style={{ opacity: 0.6 }}>— no players —</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridAutoFlow: "column",
                gridAutoColumns: "280px",
                gap: 10,
                overflowX: "auto",
                overflowY: "hidden",
                paddingBottom: 4,
              }}
            >
              {nonMarshalPlayers.map((pid) => (
                <PlayerSummaryCard
                  key={pid}
                  playerId={pid}
                  pstate={lobbyPlayers[pid] ?? {}}
                  figureCardId={getPlayerFigure(pid)}
                  scumCount={getPlayerScumCount(pid)}
                  vengeanceCount={getPlayerVengeanceCount(pid)}
                  rewardCount={getPlayerRewardCount(pid)}
                />
              ))}
            </div>
          )}
        </TableZone>
      </div>
    </div>
  );
}

import CardImg from "../components/CardImg";
import IconButton from "../components/IconButton";
import ResponsiveScaleBox from "../components/ResponsiveScaleBox";
import TableZone from "../components/TableZone";
import { getGame, gfAction } from "../api/gf";
import type { ActionResponse, View } from "../api/types";
import PTVPlayerBoard from "./player_table/PTV-PlayerBoard";
import PTVOtherPlayers from "./player_table/PTV-OtherPlayers";
import {
  getSceneHandTotal,
  getSceneOutcome,
  type SceneOutcome,
} from "./player_table/sceneResolution";

type PlayerTableViewProps = {
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

type ScenePlayerState = {
  figure_card_id?: string | null;
  figure_value?: number | null;
  hand_value?: number | null;
  standing?: boolean;
  busted?: boolean;
  resolved?: boolean;
  wounds_gained?: number;
  reward_gained?: boolean;
  result?: string | null;
};

type SceneState = {
  status?: "idle" | "setup" | "active" | "resolved";
  participants?: string[];
  dark_mode?: boolean;
  difficulty?: {
    rule_id?: string | null;
    base?: number | null;
    card_id?: string | null;
    value?: number | null;
  };
  azzardo?: {
    status?: string;
    card_id?: string | null;
    value?: number | null;
    revealed?: boolean;
  };
  players?: Record<string, ScenePlayerState>;
  resolution?: {
    completed?: boolean;
    winners?: string[];
    losers?: string[];
  };
};

function getPowerFromCardId(cardId?: string | null): string {
  if (!cardId) return "Unknown";

  const suit = cardId.slice(-1).toUpperCase();

  switch (suit) {
    case "H":
      return "Order and Profit";
    case "D":
      return "Law of Lead";
    case "C":
      return "Heart of Shadow";
    case "S":
      return "Children of the Earth";
    default:
      return "Unknown";
  }
}

function CurrentPlayerSceneRow({
  inScene,
  figureCardId,
  playedCards,
  displayName,
  total,
  stateLabel,
  outcome,
  laneState,
  canStay,
  onStay,
}: {
  inScene: boolean;
  figureCardId?: string | null;
  playedCards: string[];
  displayName: string;
  total: number | null;
  stateLabel?: string | null;
  outcome?: SceneOutcome | null;
  laneState: "waiting" | "active" | "done";
  canStay: boolean;
  onStay: () => void;
}) {
  return (
    <TableZone title="Scene Participation">
      {!inScene ? (
        <div
          style={{
            opacity: 0.6,
            padding: "10px 4px",
          }}
        >
          — you are not in the scene —
        </div>
      ) : (
        <div
          style={{
            border:
              laneState === "active"
                ? "2px solid var(--border-strong)"
                : "1px solid var(--border-muted)",
            borderRadius: 12,
            padding: 12,
            background:
              laneState === "active"
                ? "color-mix(in srgb, var(--surface-hover) 78%, transparent)"
                : laneState === "done"
                  ? "color-mix(in srgb, var(--surface-muted) 84%, transparent)"
                  : "var(--surface-strong)",
            opacity: laneState === "done" ? 0.85 : 1,
            display: "grid",
            gridTemplateColumns: "96px 1fr",
            gap: 14,
            alignItems: "start",
          }}
        >
          <div
            style={{
              display: "grid",
              justifyItems: "center",
              gap: 8,
            }}
          >
            {figureCardId ? (
              <CardImg cardId={figureCardId} width={82} />
            ) : (
              <div style={{ opacity: 0.6 }}>No figure</div>
            )}

            <div
              style={{
                textAlign: "center",
                fontWeight: 800,
                lineHeight: 1.15,
              }}
            >
              {displayName}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              alignContent: "start",
              minHeight: 96,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 700 }}>Played Cards</div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                {stateLabel ? (
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.8 }}>
                    {stateLabel}
                  </div>
                ) : null}

                <div style={{ fontSize: 13, fontWeight: 800 }}>Total: {total ?? "-"}</div>

                {canStay ? (
                  <button
                    type="button"
                    onClick={onStay}
                    style={{
                      border: "1px solid var(--border-muted)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      background: "var(--surface-strong)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      fontWeight: 800,
                    }}
                    title="Stay"
                  >
                    Stay
                  </button>
                ) : null}
              </div>
            </div>

            {outcome ? (
              <div
                style={{
                  fontWeight: 900,
                  color: outcome.color,
                  fontSize: 22,
                  lineHeight: 1,
                }}
              >
                {outcome.label}
              </div>
            ) : null}

            {playedCards.length === 0 ? (
              <div
                style={{
                  opacity: 0.6,
                  minHeight: 72,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                — no cards yet —
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {playedCards.map((cardId, idx) => (
                  <CardImg key={`${cardId}:${idx}`} cardId={cardId} width={70} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </TableZone>
  );
}

export default function PlayerTableView({
  resp,
  view,
  currentActorId,
  run,
  onBackHome,
}: PlayerTableViewProps) {
  const deckScale = 1.6;
  const ds = (value: number) => value * deckScale;
  const state = (resp.state as any) ?? {};
  const meta = state.meta ?? {};
  const deck = state.deck ?? {};
  const zones: Record<string, string[]> = state.zones ?? {};

  const scene: SceneState = meta.scene ?? {};
  const scenePlayers: Record<string, ScenePlayerState> = scene.players ?? {};
  const lobby = meta.lobby ?? {};
  const lobbyPlayers: Record<string, LobbyPlayerState> = lobby.players ?? {};
  const marshalId: string = meta.marshal_id ?? "";

  const deckCount =
    typeof deck?.draw_pile?.count === "number"
      ? deck.draw_pile.count
      : Array.isArray(deck?.draw_pile)
        ? deck.draw_pile.length
        : "-";

  const discardPile: string[] = Array.isArray(deck?.discard_pile)
    ? deck.discard_pile
    : [];

  const participantIds: string[] = Array.isArray(scene.participants)
    ? scene.participants
    : [];

  const playersOrder: string[] = Array.isArray(meta.players_order)
    ? meta.players_order
    : [];

  function getPlayerFigureCardId(pid: string): string | null {
    const cards = zones[`players.${pid}.character`] ?? [];
    return cards[0] ?? null;
  }

  function getPlayerSceneHand(pid: string): string[] {
    return zones[`scene.hand.${pid}`] ?? [];
  }

  function getPlayerScumCards(pid: string): string[] {
    return zones[`players.${pid}.scum`] ?? [];
  }

  function getPlayerVengeanceCards(pid: string): string[] {
    return zones[`players.${pid}.vengeance`] ?? [];
  }

  function getPlayerRewardCards(pid: string): string[] {
    return zones[`players.${pid}.rewards`] ?? [];
  }

  const currentPlayerDisplayName =
    lobbyPlayers?.[currentActorId]?.chosen_name ?? currentActorId;
  const currentPlayerFigureCardId = getPlayerFigureCardId(currentActorId);
  const currentPlayerScumCards = getPlayerScumCards(currentActorId);
  const currentPlayerVengeanceCards = getPlayerVengeanceCards(currentActorId);
  const currentPlayerRewardCards = getPlayerRewardCards(currentActorId);
  const currentPlayerSummaryText =
    lobbyPlayers?.[currentActorId]?.summary_text ?? null;

  const currentPlayerInScene = participantIds.includes(currentActorId);
  const difficultyCardId = scene.difficulty?.card_id ?? null;
  const azzardoStatus = scene.azzardo?.status ?? "unavailable";
  const sceneResolved = scene.status === "resolved" || !!scene.resolution?.completed;
  const azzardoCardId =
    scene.azzardo?.revealed && scene.azzardo?.card_id
      ? scene.azzardo.card_id
      : null;

  const effectiveDifficultyValue =
    sceneResolved && scene.difficulty?.value != null
      ? scene.difficulty.value + (scene.azzardo?.value ?? 0)
      : scene.difficulty?.value ?? null;

  const allParticipantsFinished =
    participantIds.length > 0 &&
    participantIds.every((pid) => {
      const pstate = scenePlayers?.[pid] ?? {};
      return !!pstate.standing || !!pstate.busted || !!pstate.resolved;
    });

  const activeParticipantId =
    scene.status === "active"
      ? participantIds.find((pid) => {
          const pstate = scenePlayers?.[pid] ?? {};
          return !pstate.standing && !pstate.busted && !pstate.resolved;
        }) ?? null
      : null;

  const isCurrentViewerActive = currentActorId === activeParticipantId;
  const currentPlayerState = scenePlayers?.[currentActorId] ?? {};

  function getParticipantTotal(pid: string): number | null {
    if (!participantIds.includes(pid)) return null;
    return getSceneHandTotal({
      figureCardId: getPlayerFigureCardId(pid),
      playedCards: getPlayerSceneHand(pid),
      backendHandValue: scenePlayers?.[pid]?.hand_value,
    });
  }

  function getParticipantLaneState(pid: string): "waiting" | "active" | "done" {
    const pstate = scenePlayers?.[pid] ?? {};
    if (sceneResolved || pstate.resolved || pstate.standing || pstate.busted) return "done";
    if (scene.status === "active" && pid === activeParticipantId) return "active";
    return "waiting";
  }

  function getParticipantStateLabel(pid: string): string | null {
    const pstate = scenePlayers?.[pid] ?? {};
    if (sceneResolved) return "Resolved";
    if (pstate.busted) return "Busted";
    if (pstate.standing) return "Stayed";
    if (scene.status === "active" && pid === activeParticipantId) return "Acting now";
    if (scene.status === "active" && participantIds.includes(pid)) return "Waiting";
    return null;
  }

  function getParticipantOutcome(pid: string): SceneOutcome | null {
    if (!sceneResolved) return null;
    const backendResult = scenePlayers?.[pid]?.result;
    if (backendResult === "success") {
      return { key: "success", label: "Success!", color: "#2f8f3e" };
    }
    if (backendResult === "failure") {
      return { key: "failure", label: "Failure!", color: "#6f1d1b" };
    }
    if (backendResult === "bust") {
      return { key: "wound", label: "Wound!!", color: "#d11f1f" };
    }
    return getSceneOutcome(getParticipantTotal(pid), effectiveDifficultyValue);
  }

  const participantOrderLookup = new Map(participantIds.map((pid, idx) => [pid, idx]));

  const otherPlayers = playersOrder
    .filter((pid) => pid !== currentActorId && pid !== marshalId)
    .map((pid) => ({
      playerId: pid,
      displayName: lobbyPlayers?.[pid]?.chosen_name ?? pid,
      figureCardId: getPlayerFigureCardId(pid),
      scumCount: getPlayerScumCards(pid).length,
      vengeanceCount: getPlayerVengeanceCards(pid).length,
      rewardCount: getPlayerRewardCards(pid).length,
      inScene: participantIds.includes(pid),
      scenePlayedCards: getPlayerSceneHand(pid),
      sceneTotal: getParticipantTotal(pid),
      sceneState: getParticipantLaneState(pid),
      sceneStateLabel: getParticipantStateLabel(pid),
      sceneOutcome: getParticipantOutcome(pid),
    }))
    .sort((a, b) => {
      const aIndex = participantOrderLookup.get(a.playerId);
      const bIndex = participantOrderLookup.get(b.playerId);
      if (aIndex != null && bIndex != null) return aIndex - bIndex;
      if (aIndex != null) return -1;
      if (bIndex != null) return 1;
      return playersOrder.indexOf(a.playerId) - playersOrder.indexOf(b.playerId);
    })
    .filter((player) => player.figureCardId != null);

  const difficultyValueLabel =
    scene.difficulty?.value == null
      ? "-"
      : scene.azzardo?.revealed && scene.azzardo?.value != null
        ? `${scene.difficulty.value} + ${scene.azzardo.value}`
        : azzardoStatus !== "unavailable"
          ? `${scene.difficulty.value} + ?`
          : `${scene.difficulty.value}`;

  const isJokerDifficulty =
    difficultyCardId === "BJ" ||
    difficultyCardId === "RJ" ||
    difficultyCardId?.toUpperCase().includes("JOKER") === true;
  const isAceDifficulty =
    difficultyCardId != null &&
    difficultyCardId.trim().toUpperCase().charAt(0) === "A";

  function getSceneInstruction(): string {
    if (scene.status === "idle") {
      return "Waiting for the Marshal to prepare the scene.";
    }

    if (scene.status === "setup" && !difficultyCardId) {
      return "Marshal is preparing the scene.";
    }

    if (scene.status === "setup" && isJokerDifficulty) {
      return "Joker drawn. No azzardo allowed.";
    }

    if (scene.status === "setup" && isAceDifficulty) {
      return "Ace drawn. Difficulty is 21. No azzardo allowed.";
    }

    if (scene.status === "setup" && azzardoStatus === "unavailable") {
      return "Scene difficulty set. Waiting for the Marshal.";
    }

    if (scene.status === "setup" && azzardoStatus !== "unavailable") {
      return "Azzardo is set. Waiting for the Marshal.";
    }

    if (scene.status === "active") {
      if (isCurrentViewerActive) {
        return "Your turn. Draw until you stay or bust.";
      }
      if (activeParticipantId) {
        const activeName = lobbyPlayers?.[activeParticipantId]?.chosen_name ?? activeParticipantId;
        return `${activeName} is acting.`;
      }
      if (allParticipantsFinished) {
        return "All participants are done.";
      }
      return "Scene active.";
    }

    if (scene.status === "resolved") {
      return "Scene resolved.";
    }

    return "Waiting for backend scene state.";
  }

  async function handleSceneDraw() {
    if (!isCurrentViewerActive) return;

    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_draw_card",
        params: {
          player_id: currentActorId,
        },
        view,
      })
    );
  }

  async function handleSceneStay() {
    if (!isCurrentViewerActive) return;

    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_stand",
        params: {
          player_id: currentActorId,
        },
        view,
      })
    );
  }

  const canDrawFromDeck =
    scene.status === "active" &&
    isCurrentViewerActive &&
    !currentPlayerState.standing &&
    !currentPlayerState.busted &&
    !sceneResolved;

  const canStay =
    currentPlayerInScene &&
    scene.status === "active" &&
    isCurrentViewerActive &&
    !currentPlayerState.standing &&
    !currentPlayerState.busted &&
    !sceneResolved;

  const deckTooltip =
    scene.status !== "active"
      ? "Scene not active"
      : canDrawFromDeck
        ? "Draw a card"
        : "Waiting for another participant";

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

        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div><b>phase:</b> {meta.phase ?? "-"}</div>
          <div><b>game_id:</b> {resp.game_id}</div>
          <div><b>revision:</b> {resp.revision}</div>
          <div><b>difficulty:</b> {scene.difficulty?.value ?? "-"}</div>
          <div><b>dark mode:</b> {scene.dark_mode ? "ON" : "off"}</div>
          <div><b>participants:</b> {participantIds.length}</div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "clamp(176px, 18vw, 352px)",
            display: "grid",
            gap: 14,
            overflowY: "auto",
            minHeight: 0,
            alignContent: "start",
            alignSelf: "start",
            gridAutoRows: "max-content",
          }}
        >
          <ResponsiveScaleBox baseWidth={352} minScale={0.5} maxScale={1}>
            <TableZone title="Deck">
              <button
                type="button"
                onClick={handleSceneDraw}
                disabled={!canDrawFromDeck}
                style={{
                  border: "1px solid var(--border-muted)",
                  borderRadius: ds(12),
                  padding: ds(10),
                  background: "var(--surface-strong)",
                  display: "flex",
                  alignItems: "center",
                  gap: ds(10),
                  width: "100%",
                  boxSizing: "border-box",
                  cursor: canDrawFromDeck ? "pointer" : "not-allowed",
                  opacity: canDrawFromDeck ? 1 : 0.65,
                }}
                title={deckTooltip}
              >
                <CardImg cardId="BACK" faceDown width={ds(86)} title="Deck" />
                <div style={{ fontSize: ds(16), textAlign: "left" }}>
                  <div>
                    <b>{deckCount}</b> cards
                  </div>
                  <div style={{ fontSize: ds(12), opacity: 0.75 }}>{deckTooltip}</div>
                </div>
              </button>
            </TableZone>
          </ResponsiveScaleBox>

          <ResponsiveScaleBox baseWidth={352} minScale={0.5} maxScale={1}>
            <TableZone title="Discard">
              {discardPile.length === 0 ? (
                <div style={{ opacity: 0.6, fontSize: ds(13) }}>— empty —</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: ds(8) }}>
                  {discardPile.map((cardId, idx) => (
                    <CardImg key={`${cardId}:${idx}`} cardId={cardId} width={ds(70)} />
                  ))}
                </div>
              )}
            </TableZone>
          </ResponsiveScaleBox>
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              minHeight: 0,
              overflowX: "auto",
              overflowY: "hidden",
              display: "grid",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gridTemplateRows: "auto auto",
                gap: 18,
                alignItems: "start",
                minWidth: "max-content",
                minHeight: 0,
                width: "100%",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  minHeight: 0,
                }}
              >
                <div style={{ width: "100%" }}>
                  <TableZone title="Difficulty / Scene">
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 360px) 1fr",
                        gap: 18,
                        alignItems: "stretch",
                      }}
                    >
                      <div
                        style={{
                          border: "1px solid var(--border-muted)",
                          borderRadius: 14,
                          padding: 16,
                          background: "var(--surface-muted)",
                          display: "grid",
                          gap: 12,
                          alignContent: "center",
                          justifyItems: "center",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                            justifyContent: "center",
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "LavaArabic, serif",
                              fontSize: isJokerDifficulty ? "4.2rem" : "3rem",
                              lineHeight: 1,
                              whiteSpace: "nowrap",
                              color: isJokerDifficulty ? "#7a1f1f" : "inherit",
                            }}
                          >
                            {isJokerDifficulty ? "20" : "10 +"}
                          </div>

                          {difficultyCardId ? (
                            <CardImg
                              cardId={difficultyCardId}
                              width={90}
                              title="Difficulty card"
                            />
                          ) : (
                            <div style={{ opacity: 0.6 }}>— no card —</div>
                          )}

                          {azzardoStatus !== "unavailable" ? (
                            azzardoCardId ? (
                              <CardImg
                                cardId={azzardoCardId}
                                width={90}
                                title="Azzardo"
                              />
                            ) : (
                              <CardImg
                                cardId="BACK"
                                faceDown
                                width={90}
                                title="Azzardo"
                              />
                            )
                          ) : (
                            <div style={{ opacity: 0.35, fontSize: 13 }}>
                              no azzardo
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gap: 10,
                          alignContent: "start",
                        }}
                      >
                        <div><b>difficulty value:</b> {difficultyValueLabel}</div>
                        <div><b>difficulty rule:</b> {scene.difficulty?.rule_id ?? "-"}</div>
                        <div><b>difficulty base:</b> {scene.difficulty?.base ?? "-"}</div>
                        <div><b>azzardo status:</b> {azzardoStatus}</div>
                        <div><b>dark mode:</b> {scene.dark_mode ? "ON" : "off"}</div>
                        <div><b>participants selected:</b> {participantIds.length}</div>
                        <div><b>scene status:</b> {scene.status ?? "-"}</div>
                        <div style={{ opacity: 0.72 }}>{getSceneInstruction()}</div>
                      </div>
                    </div>
                  </TableZone>
                </div>

                <div style={{ width: "100%" }}>
                  <CurrentPlayerSceneRow
                    inScene={currentPlayerInScene}
                    figureCardId={currentPlayerFigureCardId}
                    playedCards={getPlayerSceneHand(currentActorId)}
                    displayName={currentPlayerDisplayName}
                    total={getParticipantTotal(currentActorId)}
                    stateLabel={getParticipantStateLabel(currentActorId)}
                    outcome={getParticipantOutcome(currentActorId)}
                    laneState={getParticipantLaneState(currentActorId)}
                    canStay={canStay}
                    onStay={handleSceneStay}
                  />
                </div>
              </div>

              <div
                style={{
                  minHeight: 0,
                  display: "grid",
                  alignContent: "start",
                  width: "clamp(240px, 24vw, 461px)",
                  gridColumn: 2,
                  gridRow: "1 / span 2",
                }}
              >
                <PTVOtherPlayers players={otherPlayers} />
              </div>

              <div
                style={{
                  display: "grid",
                  gridColumn: 1,
                  gridRow: 2,
                  minHeight: 0,
                  justifyItems: "center",
                  alignContent: "start",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    maxWidth: 1048,
                  }}
                >
                  <PTVPlayerBoard
                    displayName={currentPlayerDisplayName}
                    summaryText={currentPlayerSummaryText}
                    figureCardId={currentPlayerFigureCardId}
                    scumCardIds={currentPlayerScumCards}
                    vengeanceCardIds={currentPlayerVengeanceCards}
                    rewardCardIds={currentPlayerRewardCards}
                    powerLabel={getPowerFromCardId(currentPlayerFigureCardId)}
                    inScene={currentPlayerInScene}
                    powerDisabled
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import CardImg from "../components/CardImg";
import IconButton from "../components/IconButton";
import ResponsiveScaleBox from "../components/ResponsiveScaleBox";
import TableZone from "../components/TableZone";
import { getGame } from "../api/gf";
import type { ActionResponse, View } from "../api/types";
import PTVPlayerBoard from "./player_table/PTV-PlayerBoard";
import PTVOtherPlayers from "./player_table/PTV-OtherPlayers";

type PlayerTableViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  onBackHome: () => void;
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
};

function CurrentPlayerSceneRow({
  inScene,
  figureCardId,
  playedCards,
  displayName,
}: {
  inScene: boolean;
  figureCardId?: string | null;
  playedCards: string[];
  displayName: string;
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
            border: "1px solid var(--border-muted)",
            borderRadius: 12,
            padding: 12,
            background: "var(--surface-strong)",
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
            <div style={{ fontWeight: 700 }}>Played Cards</div>

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
                  <CardImg
                    key={`${cardId}:${idx}`}
                    cardId={cardId}
                    width={70}
                  />
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

  const scene: SceneState = meta.scene ?? {};

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

  const currentPlayerInScene = participantIds.includes(currentActorId);

  const zones: Record<string, string[]> = state.zones ?? {};
  const lobby = meta.lobby ?? {};
  const lobbyPlayers = lobby.players ?? {};

  function getPlayerFigureCardId(pid: string): string | null {
    const cards = zones[`players.${pid}.character`] ?? [];
    return cards[0] ?? null;
  }

  function getPlayerSceneHand(pid: string): string[] {
    return zones[`scene.hand.${pid}`] ?? [];
  }

  const currentPlayerDisplayName =
    lobbyPlayers?.[currentActorId]?.chosen_name ?? currentActorId;

  const difficultyCardId = scene.difficulty?.card_id ?? null;
  const azzardoStatus = scene.azzardo?.status ?? "unavailable";
  const azzardoCardId =
    scene.azzardo?.revealed && scene.azzardo?.card_id
      ? scene.azzardo.card_id
      : null;

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

    if (scene.status === "setup" && azzardoStatus === "unavailable") {
      return "Scene difficulty set. Waiting for the Marshal.";
    }

    if (scene.status === "setup" && azzardoStatus !== "unavailable") {
      return "Azzardo is set. Waiting for the Marshal.";
    }

    if (scene.status === "active") {
      return "Scene active.";
    }

    if (scene.status === "resolved") {
      return "Scene resolved.";
    }

    return "Waiting for backend scene state.";
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
        {/* LEFT RAIL */}
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
              <div
                style={{
                  border: "1px solid var(--border-muted)",
                  borderRadius: ds(12),
                  padding: ds(10),
                  background: "var(--surface-strong)",
                  display: "flex",
                  alignItems: "center",
                  gap: ds(10),
                  width: "fit-content",
                  maxWidth: "100%",
                  boxSizing: "border-box",
                }}
                title="Deck"
              >
              <CardImg cardId="BACK" faceDown width={ds(86)} title="Deck" />
              <div style={{ fontSize: ds(16) }}>
                <b>{deckCount}</b> cards
              </div>
            </div>
            </TableZone>
          </ResponsiveScaleBox>

          <ResponsiveScaleBox baseWidth={352} minScale={0.5} maxScale={1}>
            <TableZone title="Discard">
              {discardPile.length === 0 ? (
                <div style={{ opacity: 0.6, fontSize: ds(13) }}>— empty —</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: ds(8) }}>
                  {discardPile.map((cardId, idx) => (
                    <CardImg
                      key={`${cardId}:${idx}`}
                      cardId={cardId}
                      width={ds(70)}
                    />
                  ))}
                </div>
              )}
            </TableZone>
          </ResponsiveScaleBox>
        </div>

        {/* CENTER COLUMN */}
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
                <div
                  style={{
                    width: "100%",
                  }}
                >
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

                <div
                  style={{
                    width: "100%",
                  }}
                >
                  <CurrentPlayerSceneRow
                    inScene={currentPlayerInScene}
                    figureCardId={getPlayerFigureCardId(currentActorId)}
                    playedCards={getPlayerSceneHand(currentActorId)}
                    displayName={currentPlayerDisplayName}
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
                <PTVOtherPlayers
                  players={[
                    {
                      playerId: "player-a",
                      displayName: "Aukan Metztli",
                      figureCardId: "KS",
                      scumCount: 0,
                      vengeanceCount: 2,
                      rewardCount: 0,
                      inScene: false,
                    },
                    {
                      playerId: "player-b",
                      displayName: "Rodrigo del Filo",
                      figureCardId: "KD",
                      scumCount: 1,
                      vengeanceCount: 1,
                      rewardCount: 0,
                      inScene: true,
                    },
                  ]}
                />
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
                    displayName="Nora Graves"
                    summaryText="A Yankee Lady with a broken front tooth"
                    figureCardId="QH"
                    scumCardIds={["BACK"]}
                    vengeanceCardIds={["BACK", "BACK"]}
                    rewardCardIds={["4C", "JS"]}
                    powerLabel="Order and Profit"
                    inScene={participantIds.includes(currentActorId)}
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

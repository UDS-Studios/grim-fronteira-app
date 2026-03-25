import { useMemo, useState } from "react";
import CardImg from "../components/CardImg";
import IconButton from "../components/IconButton";
import TableZone from "../components/TableZone";
import PlayerSummaryCard from "../components/PlayerSummaryCard";
import { getGame, gfAction } from "../api/gf";
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

function ActionButton({
  label,
  onClick,
  disabled = false,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        border: "1px solid var(--border-muted)",
        borderRadius: 10,
        padding: "10px 12px",
        background: disabled ? "var(--surface-muted)" : "var(--surface-strong)",
        color: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

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

  return (
    <div
      style={{
        border: "1px solid var(--border-muted)",
        borderRadius: 12,
        padding: 12,
        background: "var(--surface-strong)",
        display: "grid",
        gridTemplateColumns: "110px 1fr",
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
          <CardImg cardId={figureCardId} width={90} />
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
              alignItems: "flex-start",
            }}
          >
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

function SelectablePlayerCard({
  selected,
  onToggle,
  disabled = false,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={disabled ? undefined : onToggle}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        borderRadius: 14,
        outline: selected ? "2px solid var(--accent, #8b5a2b)" : "none",
        boxShadow: selected ? "0 0 0 2px rgba(139,90,43,0.15)" : "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.72 : 1,
        background: selected ? "var(--player-selected-bg)" : "transparent",
      }}
      title={
        disabled
          ? "Scene setup is locked"
          : selected
            ? "Selected for scene"
            : "Click to select for scene"
      }
    >
      {children}
    </div>
  );
}

export default function MarshalTableView({
  resp,
  view,
  currentActorId,
  run,
  onBackHome,
}: MarshalTableViewProps) {
  const state = (resp.state as any) ?? {};
  const meta = state.meta ?? {};
  const zones: Record<string, string[]> = state.zones ?? {};
  const deck = state.deck ?? {};

  const playersOrder: string[] = meta.players_order ?? [];
  const marshalId = meta.marshal_id ?? "";
  const scene: SceneState = meta.scene ?? {};
  const lobby = meta.lobby ?? {};
  const lobbyPlayers: Record<string, LobbyPlayerState> = lobby.players ?? {};

  const nonMarshalPlayers = playersOrder.filter((pid) => pid !== marshalId);

  const deckCount =
    typeof deck?.draw_pile?.count === "number"
      ? deck.draw_pile.count
      : Array.isArray(deck?.draw_pile)
        ? deck.draw_pile.length
        : "-";
  const discardPile: string[] = Array.isArray(deck?.discard_pile) ? deck.discard_pile : [];

  function getPlayerFigureCardId(pid: string): string | null {
    const cards = zones[`players.${pid}.character`] ?? [];
    return cards[0] ?? null;
  }

  function getPlayerSceneHand(pid: string): string[] {
    return zones[`scene.hand.${pid}`] ?? [];
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

  const backendParticipantIds: string[] = Array.isArray(scene.participants)
    ? scene.participants
    : [];

  const participantIds = backendParticipantIds;

  const isEditable = scene.status === "idle" || scene.status === "setup";
  const isLocked = !isEditable;
  const hasDifficulty = scene.difficulty?.card_id != null;
  const azzardoStatus = scene.azzardo?.status ?? "unavailable";
  const hasAzzardo = azzardoStatus !== "unavailable";

  const difficultyCardId = scene.difficulty?.card_id ?? null;
  const azzardoCardId =
    scene.azzardo?.revealed && scene.azzardo?.card_id ? scene.azzardo.card_id : null;

  const difficultyValueLabel =
    scene.difficulty?.value == null
      ? "-"
      : scene.azzardo?.revealed && scene.azzardo?.value != null
        ? `${scene.difficulty.value} + ${scene.azzardo.value}`
        : hasAzzardo
          ? `${scene.difficulty.value} + ?`
          : `${scene.difficulty.value}`;

  const isJokerDifficulty =
    difficultyCardId === "BJ" ||
    difficultyCardId === "RJ" ||
    difficultyCardId?.toUpperCase().includes("JOKER") === true;

  const canDeckClick =
    isEditable &&
    (!hasDifficulty || (!hasAzzardo && !isJokerDifficulty));

  const canStartScene = !isLocked && hasDifficulty && participantIds.length > 0;

  const sortedNonMarshalPlayers = useMemo(() => {
    return [...nonMarshalPlayers].sort((a, b) => {
      const aSelected = participantIds.includes(a) ? 1 : 0;
      const bSelected = participantIds.includes(b) ? 1 : 0;
      return aSelected - bSelected;
    });
  }, [nonMarshalPlayers, participantIds]);
  const [debugCardId, setDebugCardId] = useState("BJ");


  async function toggleParticipant(pid: string) {
    if (!isEditable) return;

    const nextParticipantIds = participantIds.includes(pid)
      ? participantIds.filter((x) => x !== pid)
      : [...participantIds, pid];

    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_set_participants",
        params: {
          actor_id: currentActorId,
          participant_ids: nextParticipantIds,
        },
        view,
      })
    );
  }

  async function handleDeckClick() {
    if (!isEditable) return;

    if (!hasDifficulty) {
      await run(
        gfAction({
          game_id: resp.game_id,
          action: "gf.scene_roll_difficulty",
          params: {
            actor_id: currentActorId,
          },
          view,
        })
      );
      return;
    }

    if (!hasAzzardo && !isJokerDifficulty) {
      await run(
        gfAction({
          game_id: resp.game_id,
          action: "gf.scene_draw_azzardo",
          params: {
            actor_id: currentActorId,
          },
          view,
        })
      );
    }
  }

  async function handleAzzardoUndo() {
    if (!isEditable) return;
    if (azzardoStatus !== "drawn") return;

    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_remove_azzardo",
        params: {
          actor_id: currentActorId,
        },
        view,
      })
    );
  }

  async function handleStartScene() {
    if (!canStartScene) return;

    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_start",
        params: {
          actor_id: currentActorId,
        },
        view,
      })
    );
  }

  async function handleDebugStackTopCard(cardId?: string) {
    if (view !== "debug") return;
    const chosen = (cardId ?? debugCardId).trim().toUpperCase();
    if (!chosen) return;

    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.debug_stack_top_card",
        params: { card_id: chosen },
        view,
      })
    );
  }

  function getSceneInstruction(): string {
    if (scene.status === "idle") {
      return "Select participants or click deck to roll difficulty.";
    }

    if (scene.status === "setup" && !hasDifficulty) {
      return "Click deck to draw difficulty.";
    }

    if (scene.status === "setup" && isJokerDifficulty) {
      return "Joker drawn. No azzardo allowed. Start scene.";
    }

    if (scene.status === "setup" && azzardoStatus === "unavailable") {
      return "Click deck to draw azzardo, or start scene.";
    }

    if (scene.status === "setup" && hasAzzardo) {
      return "Click azzardo to return it to the deck, or start scene.";
    }

    if (scene.status === "active") {
      return "Scene active. Setup is locked.";
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
          <div><b>difficulty:</b> {scene.difficulty?.value ?? (hasDifficulty ? "drawn" : "-")}</div>
          <div><b>dark mode:</b> {scene.dark_mode ? "ON" : "off"}</div>
          <div><b>participants:</b> {participantIds.length}</div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "220px minmax(0, 1fr) 320px",
          gap: 14,
          overflow: "hidden",
        }}
      >
        {/* LEFT RAIL */}
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
              onClick={handleDeckClick}
              disabled={!canDeckClick}
              style={{
                border: "1px solid var(--border-muted)",
                borderRadius: 12,
                padding: 10,
                background: "var(--surface-strong)",
                cursor: canDeckClick ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                opacity: canDeckClick ? 1 : 0.65,
              }}
              title={
                !canDeckClick
                  ? isJokerDifficulty
                    ? "Joker difficulty: no azzardo allowed"
                    : "No more deck clicks allowed for this scene"
                  : !hasDifficulty
                    ? "Click to draw difficulty"
                    : "Click to draw azzardo"
              }
            >
              <CardImg cardId="BACK" faceDown width={86} title="Deck" />
              <div>
                <b>{deckCount}</b> cards
              </div>
            </button>
          </TableZone>

          <TableZone title="Discard">
            {discardPile.length === 0 ? (
              <div style={{ opacity: 0.6 }}>— empty —</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {discardPile.map((cardId, idx) => (
                  <CardImg key={`${cardId}:${idx}`} cardId={cardId} width={70} />
                ))}
              </div>
            )}
          </TableZone>

          {view === "debug" ? (
            <TableZone title="Debug Deck">
              <div
                style={{
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  <ActionButton
                    label="Black Joker"
                    onClick={() => handleDebugStackTopCard("BJ")}
                  />
                  <ActionButton
                    label="Red Joker"
                    onClick={() => handleDebugStackTopCard("RJ")}
                  />
                </div>

                <input
                  type="text"
                  value={debugCardId}
                  onChange={(e) => setDebugCardId(e.target.value)}
                  placeholder="Card ID"
                  spellCheck={false}
                  style={{
                    border: "1px solid var(--border-muted)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    background: "var(--surface-strong)",
                    color: "inherit",
                    fontWeight: 700,
                    textTransform: "uppercase",
                  }}
                />

                <ActionButton
                  label="Stack On Top"
                  onClick={() => handleDebugStackTopCard()}
                />
              </div>
            </TableZone>
          ) : null}
        </div>

        {/* CENTER BOARD */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            gap: 14,
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <TableZone title="Difficulty / Scene">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(260px, 360px) 1fr",
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

                  {hasAzzardo ? (
                    <button
                      type="button"
                      onClick={handleAzzardoUndo}
                      disabled={isLocked}
                      style={{
                        border: "none",
                        background: "transparent",
                        padding: 0,
                        cursor: isLocked ? "not-allowed" : "pointer",
                        opacity: isLocked ? 0.7 : 1,
                      }}
                      title={
                        isLocked
                          ? "Scene is locked"
                          : "Click to return azzardo to the deck"
                      }
                    >
                      {azzardoCardId ? (
                        <CardImg cardId={azzardoCardId} width={90} title="Azzardo" />
                      ) : (
                        <CardImg
                          cardId="BACK"
                          faceDown
                          width={90}
                          title="Azzardo"
                        />
                      )}
                    </button>
                  ) : (
                    <div style={{ opacity: 0.35, fontSize: 13 }}>no azzardo</div>
                  )}
                </div>

                <ActionButton
                  label="Start Scene"
                  onClick={handleStartScene}
                  disabled={!canStartScene}
                  title={
                    canStartScene
                      ? "Lock setup and begin scene"
                      : "Requires difficulty card and at least one participant"
                  }
                />
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
                <div>
                  <b>scene status:</b> {scene.status ?? "-"}
                </div>
                <div style={{ opacity: 0.72 }}>{getSceneInstruction()}</div>
              </div>
            </div>
          </TableZone>

          <div style={{ minHeight: 0, overflow: "hidden" }}>
            <TableZone title="Scene Participants">
              <div
                style={{
                  height: "100%",
                  overflowY: "auto",
                  display: "grid",
                  gap: 12,
                  minHeight: 0,
                  alignContent: "start",
                }}
              >
                {participantIds.length === 0 ? (
                  <div style={{ opacity: 0.6 }}>— empty scene —</div>
                ) : (
                  participantIds.map((pid) => (
                    <PlayerLane
                      key={pid}
                      playerId={pid}
                      pstate={lobbyPlayers[pid] ?? {}}
                      figureCardId={getPlayerFigureCardId(pid)}
                      playedCards={getPlayerSceneHand(pid)}
                    />
                  ))
                )}
              </div>
            </TableZone>
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div
          style={{
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <TableZone title="Players">
            {nonMarshalPlayers.length === 0 ? (
              <div style={{ opacity: 0.6 }}>— no players —</div>
            ) : (
              <div
                style={{
                  height: "100%",
                  minHeight: 0,
                  overflowY: "auto",
                  display: "grid",
                  gap: 10,
                  alignContent: "start",
                  paddingRight: 4,
                }}
              >
                {sortedNonMarshalPlayers.map((pid) => {
                  const selected = participantIds.includes(pid);

                  return (
                    <SelectablePlayerCard
                      key={pid}
                      selected={selected}
                      disabled={isLocked}
                      onToggle={() => toggleParticipant(pid)}
                    >
                      <PlayerSummaryCard
                        playerId={pid}
                        pstate={lobbyPlayers[pid] ?? {}}
                        figureCardId={getPlayerFigureCardId(pid)}
                        scumCount={getPlayerScumCount(pid)}
                        vengeanceCount={getPlayerVengeanceCount(pid)}
                        rewardCount={getPlayerRewardCount(pid)}
                        selected={selected}
                      />
                    </SelectablePlayerCard>
                  );
                })}
              </div>
            )}
          </TableZone>
        </div>
      </div>
    </div>
  );
}

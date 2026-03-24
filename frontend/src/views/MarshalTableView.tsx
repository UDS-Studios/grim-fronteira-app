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

type LocalSceneSetupState =
  | "idle"
  | "difficulty_drawn"
  | "azzardo_drawn"
  | "locked";

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

  const playersOrder: string[] = meta.players_order ?? [];
  const marshalId = meta.marshal_id ?? "";
  const scene = meta.scene ?? {};
  const lobby = meta.lobby ?? {};
  const lobbyPlayers: Record<string, LobbyPlayerState> = lobby.players ?? {};

  const nonMarshalPlayers = playersOrder.filter((pid) => pid !== marshalId);

  const deckCount = Array.isArray(state.deck)
    ? state.deck.length
    : meta.deck_count ?? "-";

  const discardZone = zones["scene.discard"] ?? zones["discard"] ?? [];
  const difficultyCards =
    zones["scene.difficulty"] ?? zones["scene.challenge"] ?? [];
  const hiddenDifficultyCards =
    zones["scene.difficulty_hidden"] ?? zones["scene.azzardo"] ?? [];

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

  const backendParticipantIds: string[] = Array.isArray(scene.participants)
    ? scene.participants
    : [];

  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>(
    backendParticipantIds
  );
  const [localSetupState, setLocalSetupState] =
    useState<LocalSceneSetupState>("idle");

  const participantIds = useMemo(() => {
    return backendParticipantIds.length > 0
      ? backendParticipantIds
      : selectedParticipantIds;
  }, [backendParticipantIds, selectedParticipantIds]);

  const isLocked = localSetupState === "locked";
  const hasDifficulty = scene?.difficulty?.card_id != null;
  const hasAzzardo =
    scene?.azzardo?.card_id != null ||
    hiddenDifficultyCards.length > 0 ||
    localSetupState === "azzardo_drawn";

  const canDeckClick =
    !isLocked && (!hasDifficulty || (hasDifficulty && !hasAzzardo));

  const canStartScene = !isLocked && hasDifficulty && participantIds.length > 0;

  const sortedNonMarshalPlayers = useMemo(() => {
    return [...nonMarshalPlayers].sort((a, b) => {
      const aSelected = participantIds.includes(a) ? 1 : 0;
      const bSelected = participantIds.includes(b) ? 1 : 0;
      return aSelected - bSelected;
    });
  }, [nonMarshalPlayers, participantIds]);


  async function toggleParticipant(pid: string) {
    if (isLocked) return;

    const nextParticipants = participantIds.includes(pid)
      ? participantIds.filter((x) => x !== pid)
      : [...participantIds, pid];

    const next = await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_set_participants",
        params: {
          actor_id: currentActorId,
          participants_ids: nextParticipants,
        },
        view,
      })
    );

    if (!next.error) {
      setSelectedParticipantIds(nextParticipants);
    }
  }

  async function handleDeckClick() {
    if (isLocked) return;

    if (localSetupState === "idle") {
      const next = await run(
        gfAction({
          game_id: resp.game_id,
          action: "gf.scene_roll_difficulty",
          params: {
            actor_id: currentActorId,
          },
          view,
        })
      );

      if (!next.error) {
        setLocalSetupState("difficulty_drawn");
      }

      return;
    }

    if (localSetupState === "difficulty_drawn") {
      if (hasDifficulty && !hasAzzardo) {
        const next = await run(
          gfAction({
            game_id: resp.game_id,
            action: "gf.scene_draw_azzardo",
            params: {
              actor_id: currentActorId,
            },
            view,
          })
        );

        if (!next.error) {
          setLocalSetupState("azzardo_drawn");
        }
      }
    }
  }

  function handleAzzardoUndo() {
    if (isLocked) return;
    if (localSetupState !== "azzardo_drawn") return;

    console.log("TODO: gf.undo_azzardo");
    setLocalSetupState("difficulty_drawn");
  }

  async function handleStartScene() {
    if (!canStartScene) return;

    const next = await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_start",
        params: {
          actor_id: currentActorId,
        },
        view,
      })
    );

    if (!next.error) {
      setLocalSetupState("locked");
    }
  }

  function getSceneInstruction(): string {
    if (isLocked) return "Scene locked. Waiting for player interaction.";
    if (localSetupState === "idle") return "Click deck to draw difficulty.";
    if (localSetupState === "difficulty_drawn") {
      return "Click deck again to draw azzardo, or start scene.";
    }
    if (localSetupState === "azzardo_drawn") {
      return "Click azzardo to return it, or start scene.";
    }
    return "";
  }

  const difficultyCardId =
    scene?.difficulty?.card_id ??
    difficultyCards[0] ??
    null;

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
          <div><b>difficulty:</b> {scene?.difficulty?.value ?? (hasDifficulty ? "drawn" : "-")}</div>
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
                canDeckClick
                  ? localSetupState === "idle"
                    ? "Click to draw difficulty"
                    : "Click to draw azzardo"
                  : "No more deck clicks allowed for this scene"
              }
            >
              <CardImg cardId="BACK" faceDown width={86} title="Deck" />
              <div>
                <b>{deckCount}</b> cards
              </div>
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
                      fontSize: "3rem",
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    10 +
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
                      <CardImg
                        cardId="BACK"
                        faceDown
                        width={90}
                        title="Azzardo"
                      />
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
                <div><b>difficulty value:</b> {scene?.difficulty?.value ?? "-"}</div>
                <div><b>difficulty rule:</b> {scene?.difficulty?.rule_id ?? "-"}</div>
                <div><b>difficulty base:</b> {scene?.difficulty?.base ?? 10}</div>
                <div><b>dark mode:</b> {scene.dark_mode ? "ON" : "off"}</div>
                <div><b>participants selected:</b> {participantIds.length}</div>
                <div>
                  <b>scene status:</b> {scene?.status ?? (isLocked ? "active" : "setup")}
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
                      figureCardId={getPlayerFigure(pid)}
                      playedCards={getPlayerPlayedCards(pid)}
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
                        figureCardId={getPlayerFigure(pid)}
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
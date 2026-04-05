import { useMemo, useState } from "react";
import CardImg from "../components/CardImg";
import IconButton from "../components/IconButton";
import ResponsiveScaleBox from "../components/ResponsiveScaleBox";
import TableZone from "../components/TableZone";
import PlayerSummaryCard from "../components/PlayerSummaryCard";
import { getGame, gfAction } from "../api/gf";
import type { ActionResponse, View } from "../api/types";
import {
  getSceneHandTotal,
  getSceneOutcome,
  getTwentyOneColor,
  type SceneOutcome,
} from "./player_table/sceneResolution";

type MarshalTableViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  onBackHome: () => void;
};

function formatModifierTotal(modifierTotal: number): string {
  if (modifierTotal > 0) return `+${modifierTotal}`;
  if (modifierTotal < 0) return `${modifierTotal}`;
  return "";
}

type LobbyPlayerState = {
  chosen_name?: string | null;
  character_label?: string | null;
  chosen_feature?: string | null;
  summary_text?: string | null;
};

type MetaPlayerState = {
  reward_points?: number;
  wounds?: number;
};

type SceneState = {
  status?: "idle" | "setup" | "active" | "awaiting_ack" | "resolved" | "closed";
  participants?: string[];
  dark_mode?: boolean;
  bonus_assignments?: Record<string, "scum" | "vengeance">;
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
  players?: Record<string, {
    figure_card_id?: string | null;
    figure_value?: number | null;
    hand_value?: number | null;
    scum_mod_cards?: string[];
    vengeance_mod_cards?: string[];
    modifier_total?: number;
    standing?: boolean;
    busted?: boolean;
    resolved?: boolean;
    acknowledged?: boolean;
    wounds_gained?: number;
    reward_gained?: boolean;
    result?: string | null;
    recovery_action?: "healed" | "skipped" | null;
    reward_discard_started?: boolean;
  }>;
  resolution?: {
    completed?: boolean;
    winners?: string[];
    losers?: string[];
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
  total,
  woundsCount,
  figureRotated,
  figureDead,
  scumModCardIds,
  vengeanceModCardIds,
  modifierTotal,
  stateLabel,
  laneState,
  outcome,
  canForceAcknowledge,
  onForceAcknowledge,
  mustHealOrSkip,
  mustDiscardRewards,
  onForceSkipHeal,
  onForceDiscardRewards,
}: {
  playerId: string;
  pstate: LobbyPlayerState;
  figureCardId?: string | null;
  playedCards: string[];
  total: number | null;
  woundsCount: number;
  figureRotated: boolean;
  figureDead: boolean;
  scumModCardIds: string[];
  vengeanceModCardIds: string[];
  modifierTotal: number;
  stateLabel?: string | null;
  laneState: "waiting" | "active" | "done";
  outcome?: SceneOutcome | null;
  canForceAcknowledge: boolean;
  onForceAcknowledge: () => void;
  mustHealOrSkip: boolean;
  mustDiscardRewards: boolean;
  onForceSkipHeal: () => void;
  onForceDiscardRewards: () => void;
}) {
  const totalColor = getTwentyOneColor(total);
  const displayName = pstate.chosen_name ?? playerId;
  const requirementTint =
    mustHealOrSkip && mustDiscardRewards
      ? "color-mix(in srgb, #7b3fc6 18%, var(--surface-strong))"
      : mustDiscardRewards
        ? "color-mix(in srgb, #d11f1f 14%, var(--surface-strong))"
        : mustHealOrSkip
          ? "color-mix(in srgb, #d17a1f 16%, var(--surface-strong))"
          : laneState === "active"
            ? "color-mix(in srgb, var(--surface-hover) 78%, transparent)"
            : laneState === "done"
              ? "color-mix(in srgb, var(--surface-muted) 84%, transparent)"
              : "var(--surface-strong)";
  const requirementBorder =
    mustHealOrSkip && mustDiscardRewards
      ? "2px solid #7b3fc6"
      : mustDiscardRewards
        ? "2px solid #b42318"
        : mustHealOrSkip
          ? "2px solid #c26a18"
          : laneState === "active"
            ? "2px solid var(--border-strong)"
            : "1px solid var(--border-muted)";

  return (
    <div
      style={{
        border: requirementBorder,
        borderRadius: 12,
        padding: 12,
        background: requirementTint,
        opacity: laneState === "done" ? 0.85 : 1,
        display: "grid",
        gridTemplateColumns: "114px minmax(0, 1fr) auto auto",
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
          <CardImg
            cardId={figureCardId}
            width={94}
            rotationDeg={figureRotated ? 90 : 0}
            deadVariant={figureDead}
          />
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {stateLabel ? (
              <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.8 }}>
                {stateLabel}
              </div>
            ) : null}
            <div style={{ fontSize: 13, fontWeight: 800, color: totalColor ?? "inherit" }}>
              Total: {total ?? "-"}
            </div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Wounds: {woundsCount}</div>
            {canForceAcknowledge ? (
              <button
                type="button"
                onClick={onForceAcknowledge}
                style={{
                  border: "1px solid var(--border-muted)",
                  borderRadius: 10,
                  padding: "8px 12px",
                  background: "var(--surface-strong)",
                  color: "inherit",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
                title="Force acknowledge this participant"
              >
                Force Acknowledge
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

        {mustHealOrSkip || mustDiscardRewards ? (
          <div
            style={{
              display: "grid",
              gap: 8,
            }}
          >
            {mustHealOrSkip ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: "#d11f1f",
                    fontWeight: 900,
                  }}
                >
                  Must heal or skip
                </div>
                <ActionButton
                  label="Force Skip"
                  onClick={onForceSkipHeal}
                  title="Force this participant to skip healing"
                />
              </div>
            ) : null}

            {mustDiscardRewards ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: "#d11f1f",
                    fontWeight: 900,
                  }}
                >
                  Must discard rewards
                </div>
                <ActionButton
                  label="Force Discard"
                  onClick={onForceDiscardRewards}
                  title="Automatically discard rewards until this participant reaches 20 or less"
                />
              </div>
            ) : null}
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
              alignItems: "flex-start",
            }}
          >
            {playedCards.map((cardId, idx) => (
              <CardImg
                key={`${playerId}:${cardId}:${idx}`}
                cardId={cardId}
                width={78}
              />
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          border: "1px solid var(--border-muted)",
          borderRadius: 12,
          padding: "14px 16px",
          background: "color-mix(in srgb, var(--surface-muted) 92%, transparent)",
          display: "grid",
          gridTemplateColumns: "88px 88px 88px",
          gap: 14,
          alignItems: "start",
          justifyItems: "center",
          minWidth: 324,
          minHeight: 144,
        }}
      >
        {(["SCUM", "VENGEANCE", "MODS"] as const).map((label, idx) => (
          <div
            key={label}
            style={{
              display: "grid",
              gap: 6,
              justifyItems: "center",
            }}
          >
            <div
              style={{
                fontFamily: "LavaArabic, serif",
                fontSize: 13,
                lineHeight: 1,
                letterSpacing: "0.05em",
                textAlign: "center",
              }}
            >
              {label}
            </div>
            {idx === 0 ? (
              scumModCardIds.length > 0 ? (
                <CardImg cardId={scumModCardIds[scumModCardIds.length - 1]} width={88} />
              ) : (
                <div
                  style={{
                    width: 88,
                    height: 120,
                    border: "2px dashed color-mix(in srgb, var(--border-muted) 82%, transparent)",
                    borderRadius: 12,
                    background:
                      "color-mix(in srgb, var(--surface-strong) 70%, transparent)",
                    opacity: 0.6,
                  }}
                />
              )
            ) : idx === 1 ? (
              vengeanceModCardIds.length > 0 ? (
                <CardImg
                  cardId={vengeanceModCardIds[vengeanceModCardIds.length - 1]}
                  width={88}
                />
              ) : (
                <div
                  style={{
                    width: 88,
                    height: 120,
                    border: "2px dashed color-mix(in srgb, var(--border-muted) 82%, transparent)",
                    borderRadius: 12,
                    background:
                      "color-mix(in srgb, var(--surface-strong) 70%, transparent)",
                    opacity: 0.6,
                  }}
                />
              )
            ) : (
              <div
                style={{
                  width: 88,
                  height: 120,
                  border: "2px dashed color-mix(in srgb, var(--border-muted) 82%, transparent)",
                  borderRadius: 12,
                  background:
                    "color-mix(in srgb, var(--surface-strong) 70%, transparent)",
                  opacity: 0.6,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "LavaArabic, serif",
                  fontSize: "2.2rem",
                  lineHeight: 1,
                  color:
                    modifierTotal < 0
                      ? "#d11f1f"
                      : modifierTotal > 0
                        ? "#1ea84f"
                        : "inherit",
                }}
              >
                {formatModifierTotal(modifierTotal)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          border: "1px solid var(--border-muted)",
          borderRadius: 12,
          padding: "12px 16px",
          background: "color-mix(in srgb, var(--surface-muted) 92%, transparent)",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          justifyItems: "center",
          alignItems: "center",
          minWidth: 96,
          minHeight: 144,
        }}
      >
        <div
          style={{
            fontFamily: "LavaArabic, serif",
            fontSize: 12,
            lineHeight: 1,
            letterSpacing: "0.06em",
            textAlign: "center",
          }}
        >
          TOTAL
        </div>
        <div
          style={{
            fontFamily: "LavaArabic, serif",
            fontSize: "2.4rem",
            lineHeight: 1,
            whiteSpace: "nowrap",
            opacity: 0.58,
            color: totalColor ?? "inherit",
          }}
        >
          {total ?? "-"}
        </div>
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
          ? "Unavailable"
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
  const deckScale = 1.6;
  const playersRailScale = 1.6;
  const [pendingBonusType, setPendingBonusType] = useState<"scum" | "vengeance" | null>(null);
  const ds = (value: number) => value * deckScale;
  const state = (resp.state as any) ?? {};
  const meta = state.meta ?? {};
  const zones: Record<string, string[]> = state.zones ?? {};
  const deck = state.deck ?? {};

  const playersOrder: string[] = meta.players_order ?? [];
  const marshalId = meta.marshal_id ?? "";
  const scene: SceneState = meta.scene ?? {};
  const scenePlayers = scene.players ?? {};
  const metaPlayers: Record<string, MetaPlayerState> = meta.players ?? {};
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

  function getPlayerScumModCards(pid: string): string[] {
    return scenePlayers?.[pid]?.scum_mod_cards ?? [];
  }

  function getPlayerVengeanceModCards(pid: string): string[] {
    return scenePlayers?.[pid]?.vengeance_mod_cards ?? [];
  }

  function getPlayerModifierTotal(pid: string): number {
    return scenePlayers?.[pid]?.modifier_total ?? 0;
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

  function getPlayerRewardPoints(pid: string): number {
    return metaPlayers?.[pid]?.reward_points ?? 0;
  }

  function getAssignedBonusType(pid: string): "scum" | "vengeance" | null {
    return scene.bonus_assignments?.[pid] ?? null;
  }

  function getPersistentWounds(pid: string): number {
    return metaPlayers?.[pid]?.wounds ?? 0;
  }

  function getDisplayedWounds(pid: string): number {
    const persistentWounds = getPersistentWounds(pid);
    const pendingWounds =
      sceneResolved ? scenePlayers?.[pid]?.wounds_gained ?? 0 : !!scenePlayers?.[pid]?.busted ? 1 : 0;
    return persistentWounds + pendingWounds;
  }

  function getIsDead(pid: string): boolean {
    return getDisplayedWounds(pid) >= 2;
  }

  function getFigureRotated(pid: string): boolean {
    return getDisplayedWounds(pid) > 0;
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
  const canCloseScene = scene.status === "resolved";
  const canOpenNewScene = scene.status === "closed";
  const canAssignBonus = scene.status === "resolved";

  const difficultyCardId = scene.difficulty?.card_id ?? null;
  const azzardoCardId =
    scene.azzardo?.revealed && scene.azzardo?.card_id ? scene.azzardo.card_id : null;
  const sceneResolved = scene.status === "resolved" || scene.status === "closed" || !!scene.resolution?.completed;
  const effectiveDifficultyValue =
    sceneResolved && scene.difficulty?.value != null
      ? scene.difficulty.value + (scene.azzardo?.value ?? 0)
      : scene.difficulty?.value ?? null;
  const difficultyTotalColor = getTwentyOneColor(
    scene.azzardo?.revealed ? effectiveDifficultyValue : scene.difficulty?.value ?? null
  );
  const activeParticipantId =
    scene.status === "active"
      ? participantIds.find((pid) => {
          const pstate = scenePlayers?.[pid] ?? {};
          return !pstate.standing && !pstate.busted && !pstate.resolved;
        }) ?? null
      : null;

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
    if (scene.status === "awaiting_ack") {
      return pstate.acknowledged ? "Acknowledged" : "Awaiting acknowledgment";
    }
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
    const recoveryAction = scenePlayers?.[pid]?.recovery_action;
    const total = getParticipantTotal(pid);
    const marshalBusted = effectiveDifficultyValue != null && effectiveDifficultyValue > 21;
    if (backendResult === "success") {
      if (total === 21) {
        return { key: "success", label: "Critical Success!!", color: "#1ea84f" };
      }
      if (marshalBusted) {
        return { key: "success", label: "Success!", color: "#2f8f3e" };
      }
      return (
        getSceneOutcome(total, effectiveDifficultyValue) ?? {
          key: "success",
          label: "Success!",
          color: "#2f8f3e",
        }
      );
    }
    if (backendResult === "failure") {
      return { key: "failure", label: "Failure!", color: "#6f1d1b" };
    }
    if (backendResult === "bust") {
      if (marshalBusted) {
        return { key: "failure", label: "Failure!", color: "#6f1d1b" };
      }
      if (recoveryAction === "healed") {
        return { key: "success", label: "Healed!", color: "#2f8f3e" };
      }
      return { key: "wound", label: "Wound!!", color: "#d11f1f" };
    }
    return getSceneOutcome(total, effectiveDifficultyValue);
  }

  const difficultyValueLabel =
    scene.difficulty?.value == null
      ? "-"
      : scene.azzardo?.revealed && scene.azzardo?.value != null
        ? `${scene.difficulty.value} + ${scene.azzardo.value}`
        : hasAzzardo
          ? `${scene.difficulty.value} + ?`
          : `${scene.difficulty.value}`;
  const totalBoxLabel =
    scene.difficulty?.value == null
      ? "-"
      : scene.azzardo?.revealed && effectiveDifficultyValue != null
        ? `${effectiveDifficultyValue}`
        : hasAzzardo
          ? `${scene.difficulty.value} + ?`
          : `${scene.difficulty.value}`;

  const isJokerDifficulty =
    difficultyCardId === "BJ" ||
    difficultyCardId === "RJ" ||
    difficultyCardId?.toUpperCase().includes("JOKER") === true;
  const isAceDifficulty =
    difficultyCardId != null &&
    difficultyCardId.trim().toUpperCase().charAt(0) === "A";
  const isFigureDifficulty =
    difficultyCardId != null &&
    ["J", "Q", "K"].includes(difficultyCardId.trim().toUpperCase().charAt(0));
  const azzardoBlockedByDifficulty = isJokerDifficulty || isAceDifficulty || isFigureDifficulty;

  const canDeckClick =
    isEditable &&
    (!hasDifficulty || (!hasAzzardo && !azzardoBlockedByDifficulty));

  const canStartScene = !isLocked && hasDifficulty && participantIds.length > 0;

  function getParticipantPostSceneRequirements(pid: string): {
    mustHealOrSkip: boolean;
    mustDiscardRewards: boolean;
  } {
    const wounds = getDisplayedWounds(pid);
    const rewardPoints = getPlayerRewardPoints(pid);
    const recoveryAction = scenePlayers?.[pid]?.recovery_action;
    const rewardDiscardStarted = !!scenePlayers?.[pid]?.reward_discard_started;

    return {
      mustHealOrSkip: wounds === 1 && rewardPoints > 11 && recoveryAction == null,
      mustDiscardRewards: rewardPoints > 21 || (rewardDiscardStarted && rewardPoints > 20),
    };
  }

  const hasBlockedParticipantForNewScene =
    scene.status === "closed" &&
    participantIds.some((pid) => {
      const requirements = getParticipantPostSceneRequirements(pid);
      return requirements.mustHealOrSkip || requirements.mustDiscardRewards;
    });

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

    if (!hasAzzardo && !azzardoBlockedByDifficulty) {
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

  async function handleForceAcknowledge(pid: string) {
    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_force_acknowledge_resolution",
        params: {
          actor_id: currentActorId,
          player_id: pid,
        },
        view,
      })
    );
  }

  async function handleForceSkipHeal(pid: string) {
    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_force_skip_heal",
        params: {
          actor_id: currentActorId,
          player_id: pid,
        },
        view,
      })
    );
  }

  async function handleForceDiscardRewards(pid: string) {
    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_force_discard_rewards",
        params: {
          actor_id: currentActorId,
          player_id: pid,
        },
        view,
      })
    );
  }

  async function handleNewScene() {
    setPendingBonusType(null);
    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_new",
        params: {
          actor_id: currentActorId,
        },
        view,
      })
    );
  }

  async function handleCloseScene() {
    setPendingBonusType(null);
    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_close",
        params: {
          actor_id: currentActorId,
        },
        view,
      })
    );
  }

  async function handleAssignBonus(pid: string) {
    if (!pendingBonusType) return;
    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.scene_assign_bonus_card",
        params: {
          actor_id: currentActorId,
          player_id: pid,
          bonus_type: pendingBonusType,
        },
        view,
      })
    );
    setPendingBonusType(null);
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
      return difficultyCardId === "RJ"
        ? "Red Joker drawn. No azzardo allowed. Each player receives 1 Scum. Start scene."
        : "Black Joker drawn. No azzardo allowed. Each player receives 1 Vengeance. Start scene.";
    }

    if (scene.status === "setup" && isAceDifficulty) {
      return "Ace drawn. Difficulty is 21. No azzardo allowed. Start scene.";
    }

    if (scene.status === "setup" && isFigureDifficulty) {
      return "Figure drawn. No azzardo allowed. Start scene.";
    }

    if (scene.status === "setup" && participantIds.length === 0) {
      if (!hasDifficulty) {
        return "Select at least one participant, then draw difficulty.";
      }

      if (hasAzzardo) {
        return "Select at least one participant before starting the scene.";
      }

      if (azzardoBlockedByDifficulty) {
        return "Select at least one participant before starting the scene.";
      }

      return "Click deck to draw azzardo, or select at least one participant before starting the scene.";
    }

    if (scene.status === "setup" && azzardoStatus === "unavailable") {
      return "Click deck to draw azzardo, or start scene.";
    }

    if (scene.status === "setup" && hasAzzardo) {
      return "Click azzardo to return it to the deck, or start scene.";
    }

    if (scene.status === "active") {
      if (activeParticipantId) {
        const activeName = lobbyPlayers?.[activeParticipantId]?.chosen_name ?? activeParticipantId;
        return `Scene active. ${activeName} is acting.`;
      }
      return "Scene active. Setup is locked.";
    }

    if (scene.status === "awaiting_ack") {
      const remaining = participantIds.filter((pid) => !scenePlayers?.[pid]?.acknowledged);
      return `Scene resolved. Waiting for acknowledgments from ${remaining.length} participant${remaining.length === 1 ? "" : "s"}.`;
    }

    if (scene.status === "resolved") {
      if (pendingBonusType) {
        return `Scene resolved. Click a player to assign one bonus ${pendingBonusType} card, or click the same assign button again to cancel.`;
      }
      return "Scene resolved. You can assign one bonus Scum or Vengeance card per player, or click Close Scene to discard the cards in play and distribute rewards.";
    }

    if (scene.status === "closed") {
      if (hasBlockedParticipantForNewScene) {
        return "Scene closed. Resolve participant heal/skip or reward discard requirements before opening a new scene.";
      }
      return "Scene closed. Click New Scene to prepare the next one.";
    }

    return "Waiting for backend scene state.";
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
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
          minHeight: 0,
          overflowX: "auto",
          overflowY: "hidden",
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gap: 14,
          alignItems: "start",
          minWidth: "max-content",
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
        }}
      >
          {canCloseScene || canOpenNewScene ? (
            <ResponsiveScaleBox baseWidth={352} minScale={0.5} maxScale={1}>
              <TableZone title={canCloseScene ? "Close Scene" : "Next Scene"}>
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                  }}
                >
                  {canCloseScene ? (
                    <ActionButton
                      label="Close Scene"
                      onClick={handleCloseScene}
                      title="Discard scene cards and distribute rewards"
                    />
                  ) : (
                    <ActionButton
                      label="New Scene"
                      onClick={handleNewScene}
                      disabled={hasBlockedParticipantForNewScene}
                      title={
                        hasBlockedParticipantForNewScene
                          ? "Resolve participant heal/skip or reward discard requirements first"
                          : "Prepare a new scene"
                      }
                    />
                  )}

                  {canAssignBonus ? (
                    <div
                      style={{
                        border: "1px solid var(--border-muted)",
                        borderRadius: ds(12),
                        padding: ds(10),
                        background: "var(--surface-strong)",
                        display: "grid",
                        gap: ds(8),
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 800,
                          textAlign: "center",
                        }}
                      >
                        Assign
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: ds(8),
                        }}
                      >
                        <ActionButton
                          label="Vengeance"
                          onClick={() =>
                            setPendingBonusType((prev) =>
                              prev === "vengeance" ? null : "vengeance"
                            )
                          }
                          disabled={!canAssignBonus}
                          title="Assign one bonus Vengeance card"
                        />
                        <ActionButton
                          label="Scum"
                          onClick={() =>
                            setPendingBonusType((prev) => (prev === "scum" ? null : "scum"))
                          }
                          disabled={!canAssignBonus}
                          title="Assign one bonus Scum card"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </TableZone>
            </ResponsiveScaleBox>
          ) : null}

          <ResponsiveScaleBox baseWidth={352} minScale={0.5} maxScale={1}>
            <TableZone title="Deck">
              <button
                type="button"
                onClick={handleDeckClick}
                disabled={!canDeckClick}
                style={{
                  border: "1px solid var(--border-muted)",
                  borderRadius: ds(12),
                  padding: ds(10),
                  background: "var(--surface-strong)",
                  cursor: canDeckClick ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: ds(10),
                  width: "100%",
                  opacity: canDeckClick ? 1 : 0.65,
                }}
                title={
                  !canDeckClick
                    ? azzardoBlockedByDifficulty
                      ? isJokerDifficulty
                        ? "Joker difficulty: no azzardo allowed"
                        : isAceDifficulty
                          ? "Ace difficulty: total is 21, no azzardo allowed"
                        : "Figure difficulty: no azzardo allowed"
                      : "No more deck clicks allowed for this scene"
                    : !hasDifficulty
                      ? "Click to draw difficulty"
                      : "Click to draw azzardo"
                }
              >
                {deckCount > 0 ? (
                  <CardImg cardId="BACK" faceDown width={ds(86)} title="Deck" />
                ) : (
                  <div
                    style={{
                      width: ds(86),
                      height: ds(124),
                      border: "2px dashed var(--border-muted)",
                      borderRadius: ds(10),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-muted)",
                      fontSize: ds(12),
                      background: "color-mix(in srgb, var(--surface-bg) 82%, transparent)",
                      flexShrink: 0,
                    }}
                  >
                    empty
                  </div>
                )}
                <div style={{ fontSize: ds(16) }}>
                  <b>{deckCount}</b> cards
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
            gridTemplateRows: "auto auto",
            gap: 14,
            minHeight: 0,
          }}
        >
          <TableZone title="Difficulty / Scene">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "max-content max-content minmax(320px, 1fr)",
                gap: 14,
                alignItems: "center",
                justifyContent: "start",
              }}
            >
              <div
                style={{
                  border: "1px solid var(--border-muted)",
                  borderRadius: 14,
                  padding: "14px 16px",
                  background: "var(--surface-muted)",
                  display: "grid",
                  gap: 12,
                  alignContent: "center",
                  justifyItems: "center",
                  justifySelf: "start",
                  minHeight: 212,
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
                      width={ds(86)}
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
                        <CardImg cardId={azzardoCardId} width={ds(86)} title="Azzardo" />
                      ) : (
                        <CardImg
                          cardId="BACK"
                          faceDown
                          width={ds(86)}
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
                  border: "1px solid var(--border-muted)",
                  borderRadius: 14,
                  padding: "16px 20px",
                  background: "var(--surface-muted)",
                  display: "grid",
                  gridTemplateRows: "auto 1fr",
                  justifyItems: "center",
                  alignItems: "center",
                  minWidth: 116,
                  justifySelf: "start",
                  minHeight: 212,
                }}
              >
                <div
                  style={{
                    fontFamily: "LavaArabic, serif",
                    fontSize: 14,
                    lineHeight: 1,
                    letterSpacing: "0.06em",
                    textAlign: "center",
                  }}
                >
                  TOTAL
                </div>
                <div
                  style={{
                    fontFamily: "LavaArabic, serif",
                    fontSize: "3rem",
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    opacity: 0.58,
                    color: difficultyTotalColor ?? "inherit",
                  }}
                >
                  {totalBoxLabel}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 10,
                  alignContent: "start",
                  minWidth: 0,
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

          <div style={{ minHeight: 0 }}>
            <TableZone title="Scene Participants">
              <div
                style={{
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
                    (() => {
                      const requirements = getParticipantPostSceneRequirements(pid);

                      return (
                        <PlayerLane
                          key={pid}
                          playerId={pid}
                          pstate={lobbyPlayers[pid] ?? {}}
                          figureCardId={getPlayerFigureCardId(pid)}
                          playedCards={getPlayerSceneHand(pid)}
                          total={getParticipantTotal(pid)}
                          woundsCount={getDisplayedWounds(pid)}
                          figureRotated={getFigureRotated(pid)}
                          figureDead={getIsDead(pid)}
                          scumModCardIds={getPlayerScumModCards(pid)}
                          vengeanceModCardIds={getPlayerVengeanceModCards(pid)}
                          modifierTotal={getPlayerModifierTotal(pid)}
                          stateLabel={getParticipantStateLabel(pid)}
                          laneState={getParticipantLaneState(pid)}
                          outcome={getParticipantOutcome(pid)}
                          canForceAcknowledge={
                            scene.status === "awaiting_ack" && !scenePlayers?.[pid]?.acknowledged
                          }
                          onForceAcknowledge={() => handleForceAcknowledge(pid)}
                          mustHealOrSkip={scene.status === "closed" && requirements.mustHealOrSkip}
                          mustDiscardRewards={
                            scene.status === "closed" && requirements.mustDiscardRewards
                          }
                          onForceSkipHeal={() => handleForceSkipHeal(pid)}
                          onForceDiscardRewards={() => handleForceDiscardRewards(pid)}
                        />
                      );
                    })()
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
            width: "clamp(216px, 24vw, 432px)",
          }}
        >
          <ResponsiveScaleBox baseWidth={480} minScale={0.5} maxScale={1}>
            <TableZone title="Players">
              {nonMarshalPlayers.length === 0 ? (
                <div style={{ opacity: 0.6, fontSize: 14 * playersRailScale }}>— no players —</div>
              ) : (
                <div
                  style={{
                    minHeight: 0,
                    display: "grid",
                    gap: 10 * playersRailScale,
                    alignContent: "start",
                  }}
                >
                  {sortedNonMarshalPlayers.map((pid) => {
                    const selected = participantIds.includes(pid);
                    const assignedBonusType = getAssignedBonusType(pid);
                    const targetingBonus = pendingBonusType !== null;
                    const dead = getIsDead(pid);
                    const canTargetForBonus =
                      targetingBonus && canAssignBonus && assignedBonusType == null && !dead;

                    return (
                      <SelectablePlayerCard
                        key={pid}
                        selected={targetingBonus ? false : selected}
                        disabled={targetingBonus ? !canTargetForBonus : isLocked || dead}
                        onToggle={() =>
                          targetingBonus ? handleAssignBonus(pid) : toggleParticipant(pid)
                        }
                      >
                        <PlayerSummaryCard
                          playerId={pid}
                          pstate={lobbyPlayers[pid] ?? {}}
                          figureCardId={getPlayerFigureCardId(pid)}
                          scumCount={getPlayerScumCount(pid)}
                          vengeanceCount={getPlayerVengeanceCount(pid)}
                          rewardCount={getPlayerRewardCount(pid)}
                          woundsCount={getDisplayedWounds(pid)}
                          figureRotated={getFigureRotated(pid)}
                          figureDead={dead}
                          footerNote={
                            dead
                              ? "DEAD"
                              : assignedBonusType
                              ? `Assigned: ${assignedBonusType === "scum" ? "SCUM" : "VENGEANCE"}`
                              : targetingBonus
                                ? `Click to assign ${pendingBonusType?.toUpperCase()}`
                                : null
                          }
                          selected={targetingBonus ? canTargetForBonus : selected}
                          scale={playersRailScale}
                        />
                      </SelectablePlayerCard>
                    );
                  })}
                </div>
              )}
            </TableZone>
          </ResponsiveScaleBox>
        </div>
      </div>
    </div>
  );
}

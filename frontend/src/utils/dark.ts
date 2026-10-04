import type { GameState, SceneState } from "../api/types.ts";

export function isDarkScene(scene?: SceneState): boolean {
  return scene?.dark_mode === true;
}

export function isDarkRevealed(scene?: SceneState): boolean {
  return isDarkScene(scene) && scene?.dark?.revealed === true;
}

// Read only the backend total. Missing/redacted values never fall back to card arithmetic.
export function getDarkMarshalTotal(scene?: SceneState): number | null {
  const total = scene?.dark?.marshal_total;
  return isDarkScene(scene) && typeof total === "number" && Number.isFinite(total) ? total : null;
}

// The full physical hand is difficulty followed by extras, only as projected by the backend.
export function getDarkMarshalHand(state: GameState): string[] {
  if (!isDarkScene(state.meta?.scene)) return [];
  const difficulty = state.meta?.scene?.difficulty?.card_id;
  const extras = state.zones?.["scene.dark.marshal_hand"];
  return [
    ...(difficulty ? [difficulty] : []),
    ...(Array.isArray(extras) ? extras : []),
  ];
}

export function mustMarshalDiscardDarkCard(scene?: SceneState): boolean {
  return isDarkScene(scene) && !isDarkRevealed(scene) && scene?.dark?.must_discard_last === true;
}

// Obvious setup gates only; the backend remains the final rules validator.
export function canDeclareDark(state: GameState, actorId: string): boolean {
  const scene = state.meta?.scene;
  return !!actorId.trim() && actorId === state.meta?.marshal_id &&
    !state.meta?.pending_interaction && scene?.status === "setup" &&
    !(scene.mode === "duel" && scene.duel?.subtype === "pvp") &&
    !isDarkScene(scene) && scene.difficulty?.card_id == null &&
    (scene.azzardo?.status ?? "unavailable") === "unavailable" && scene.azzardo?.card_id == null;
}

export function hasDarkAtmosphere(scene?: SceneState): boolean {
  return isDarkScene(scene) && scene?.status !== "closed";
}

function canUseDarkHand(state: GameState, actorId: string): boolean {
  const meta = state.meta;
  const scene = meta?.scene;
  return meta?.phase === "table" && !!actorId.trim() && actorId === meta.marshal_id &&
    !meta.pending_interaction && isDarkScene(scene) && !isDarkRevealed(scene) &&
    !(scene?.mode === "duel" && scene.duel?.subtype === "pvp") &&
    (scene?.status === "setup" || scene?.status === "active") && scene.difficulty?.card_id != null;
}

export function countUnfinishedDarkParticipants(scene?: SceneState): number {
  return (scene?.participants ?? []).filter(pid => {
    const player = scene?.players?.[pid];
    return player?.standing !== true && player?.busted !== true;
  }).length;
}

export function canDarkDraw(state: GameState, actorId: string): boolean {
  const total = getDarkMarshalTotal(state.meta?.scene);
  return canUseDarkHand(state, actorId) && !mustMarshalDiscardDarkCard(state.meta?.scene) &&
    total !== null && total <= 21;
}

export function canDarkDiscardLast(state: GameState, actorId: string): boolean {
  return canUseDarkHand(state, actorId) && mustMarshalDiscardDarkCard(state.meta?.scene) &&
    Array.isArray(state.zones?.["scene.dark.marshal_hand"]) && getDarkExtraCount(state) > 0;
}

export function canDarkReveal(state: GameState, actorId: string): boolean {
  const scene = state.meta?.scene;
  return canDarkDraw(state, actorId) && scene?.status === "active" &&
    (scene.participants?.length ?? 0) > 0 && countUnfinishedDarkParticipants(scene) === 0;
}

export function canRollDarkDifficulty(state: GameState, actorId: string): boolean {
  const meta = state.meta;
  const scene = meta?.scene;
  return meta?.phase === "table" && !!actorId.trim() && actorId === meta.marshal_id &&
    !meta.pending_interaction && isDarkScene(scene) && !isDarkRevealed(scene) &&
    scene?.status === "setup" && scene.difficulty?.card_id == null &&
    !(scene.mode === "duel" && scene.duel?.subtype === "pvp");
}

// Counts never inspect identities or derive card values.
export function getProjectedCardCount(zone: unknown): number {
  if (Array.isArray(zone)) return zone.length;
  if (!zone || typeof zone !== "object" || !("count" in zone)) return 0;
  const count = zone.count;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function getDarkOpeningCount(state: GameState): number {
  return getProjectedCardCount(state.zones?.["scene.difficulty"]);
}

export function getDarkExtraCount(state: GameState): number {
  return getProjectedCardCount(state.zones?.["scene.dark.marshal_hand"]);
}

export function getDarkHiddenCardCount(state: GameState): number {
  return getDarkOpeningCount(state) + getDarkExtraCount(state);
}

export function getDarkPlayerStatus(scene: SceneState, actorId: string, ownTurn: boolean, paused = false): string {
  const player = scene.players?.[actorId];
  if (isDarkRevealed(scene)) {
    const outcome = player?.result === "success"
      ? player.reward_cards_gained === 2
        ? "You survived the Dark and earned 2 Rewards."
        : "The Dark is revealed. You beat the Marshal's hand."
      : player?.result === "failure" || player?.result === "bust" || player?.result === "wound"
        ? "The Dark is revealed. The Marshal's hand beat yours."
        : "The Marshal has revealed the hand. Resolve the outcome.";
    const next = paused ? "An interaction is pending."
      : scene.status === "awaiting_ack"
        ? player?.acknowledged ? "Waiting for the other participants to acknowledge."
          : scene.participants?.includes(actorId) ? "You can still play Scum or Vengeance before you acknowledge." : "Waiting for the participants to acknowledge."
        : "";
    return `THE DARK IS REVEALED\n${outcome}${next ? `\n${next}` : ""}`;
  }
  if (!scene.participants?.includes(actorId)) {
    return "IN THE DARK\nThe scene is in the Dark. Waiting for the participants and the Marshal's reveal.";
  }
  if (player?.standing || player?.busted) {
    return "IN THE DARK\nYour choice is made. Waiting for the Marshal to reveal the Dark.";
  }
  const action = paused ? "An interaction is pending."
    : scene.status !== "active" ? "Waiting for the Marshal to start the scene."
      : ownTurn ? "Your turn. Draw or stand without knowing what waits in the dark."
        : "Waiting for your turn to draw or stand.";
  return `IN THE DARK\nThe Marshal's hand is hidden. ${action}`;
}

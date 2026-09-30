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
  return [
    ...(difficulty ? [difficulty] : []),
    ...(state.zones?.["scene.dark.marshal_hand"] ?? []),
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
    (state.zones?.["scene.dark.marshal_hand"]?.length ?? 0) > 0;
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

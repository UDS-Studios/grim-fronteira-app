import type { GameMeta } from "../api/types.ts";

export function isGameplayPaused(meta: GameMeta | null | undefined): boolean {
  return meta?.session_pause?.paused === true;
}

export const PAUSE_EXPLANATION = "Game paused while the Marshal is offline";

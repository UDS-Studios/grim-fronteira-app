import type { GameMeta } from "../api/types.ts";

export type PresenceStatus = "online" | "offline" | "unknown";

export function getPresenceStatus(meta: GameMeta | null | undefined, playerId: string): PresenceStatus {
  const online = meta?.presence?.[playerId]?.online;
  if (online === true) return "online";
  if (online === false) return "offline";
  return "unknown";
}

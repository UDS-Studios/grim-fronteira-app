import type { GameMeta } from "../api/types.ts";

// Local routing only, not authentication. An open lobby retains the fresh join flow.
export function getGameEntryMode(meta: GameMeta, actorId: string): "join" | "reconnect" | "closed" {
  if (meta.lobby?.registration_open) return "join";
  const registered = Object.prototype.hasOwnProperty.call(meta.lobby?.players ?? {}, actorId);
  return actorId.trim() && (registered || actorId === meta.marshal_id) ? "reconnect" : "closed";
}

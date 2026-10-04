import type { GameMeta } from "../api/types.ts";

// Local routing only, not authentication. An open lobby retains the fresh join flow.
export function getGameEntryMode(meta: GameMeta, actorId: string): "join" | "reconnect" | "closed" {
  if (actorId.trim() && actorId === meta.marshal_id) return "reconnect";
  if (meta.lobby?.registration_open) return "join";
  const registered = Object.prototype.hasOwnProperty.call(meta.lobby?.players ?? {}, actorId);
  return actorId.trim() && (registered || actorId === meta.marshal_id) ? "reconnect" : "closed";
}

export type RecoveryReason = "takeover-required" | "session-replaced" | "reconnect-invalid";

export function getRecoveryReason(code: string | undefined): RecoveryReason | null {
  switch (code) {
    case "TAKEOVER_REQUIRED": return "takeover-required";
    case "SESSION_REPLACED": return "session-replaced";
    case "RECONNECT_INVALID": return "reconnect-invalid";
    default: return null;
  }
}

// Backend issues canonical UUIDs. Normalize casing without restricting UUID version.
export function normalizeGameId(input: string): string | null {
  const value = input.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}


// Presentation only: closed lobbies are distinct from games already underway.
// Stored sessions take the authenticated recovery path before this is consulted.
export function getClosedGameEntryScreen(meta: GameMeta): "registration-closed" | "already-started" {
  return ["hook_selection", "started", "table", "victory"].includes(meta.phase ?? "")
    ? "already-started" : "registration-closed";
}

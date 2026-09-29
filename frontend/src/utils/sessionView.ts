import type { GameMeta, View } from "../api/types.ts";

export type InspectionView = Exclude<View, "player" | "marshal">;

// Attach identity to an already-selected gameplay projection, never an inspection view.
export function getViewRequest(view: View, actorId: string): { view: View; viewer_id?: string } {
  return view === "player" || view === "marshal" ? { view, viewer_id: actorId } : { view };
}

// This chooses response privacy, not authentication. The backend remains authoritative.
export function getSessionView(meta: GameMeta, actorId: string, inspectionView: InspectionView = "public"): {
  view: View;
  viewer_id?: string;
} {
  if (actorId.trim() && actorId === meta.marshal_id) {
    return getViewRequest("marshal", actorId);
  }
  const registered = Object.prototype.hasOwnProperty.call(meta.lobby?.players ?? {}, actorId) ||
    Object.prototype.hasOwnProperty.call(meta.players ?? {}, actorId) ||
    (meta.players_order ?? []).includes(actorId);
  if (actorId.trim() && actorId !== meta.marshal_id && registered) {
    return getViewRequest("player", actorId);
  }
  return { view: inspectionView };
}

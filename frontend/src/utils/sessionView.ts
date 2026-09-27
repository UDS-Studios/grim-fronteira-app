import type { GameMeta, View } from "../api/types.ts";

export type InspectionView = Exclude<View, "player">;

// This chooses response privacy, not authentication. The backend remains authoritative.
export function getSessionView(meta: GameMeta, actorId: string, inspectionView: InspectionView = "public"): {
  view: View;
  viewer_id?: string;
} {
  const registered = Object.prototype.hasOwnProperty.call(meta.lobby?.players ?? {}, actorId) ||
    Object.prototype.hasOwnProperty.call(meta.players ?? {}, actorId) ||
    (meta.players_order ?? []).includes(actorId);
  if (actorId.trim() && actorId !== meta.marshal_id && registered) {
    return { view: "player", viewer_id: actorId };
  }
  return { view: inspectionView };
}

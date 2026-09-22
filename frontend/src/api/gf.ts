import { api } from "./client";
import type { ActionRequest, NewGameRequest, View } from "./types";

export function newGame(req: NewGameRequest) {
  return api("/api/gf/new", "POST", req);
}

export function gfAction(req: ActionRequest) {
  return api("/api/gf/action", "POST", req);
}

export function getGame(gameId: string, view: View, viewerId?: string | null) {
  const query = new URLSearchParams({ view });
  if (viewerId) query.set("viewer_id", viewerId);
  return api(`/api/game/${encodeURIComponent(gameId)}?${query}`, "GET");
}

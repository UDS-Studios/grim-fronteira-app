import { api } from "./client";
import type { ActionRequest, NewGameRequest, View } from "./types";

export function newGame(req: NewGameRequest) {
  return api("/api/gf/new", "POST", req);
}

export function gfAction(req: ActionRequest) {
  return api("/api/gf/action", "POST", req);
}

export function getGame(gameId: string, view: View) {
  return api(`/api/game/${encodeURIComponent(gameId)}?view=${view}`, "GET");
}
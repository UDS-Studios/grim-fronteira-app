import { api } from "./client.ts";
import type { ActionRequest, ActionResponse, NewGameRequest, View } from "./types.ts";
import { getActiveSession, getReconnectToken, storeIssuedSession, type BrowserSession } from "../utils/session.ts";

const recoverable = new Set(["SESSION_REQUIRED", "SESSION_INVALID", "SESSION_REPLACED"]);
const reconnecting = new Map<string, Promise<ActionResponse>>();

function storeResponse(response: ActionResponse): ActionResponse {
  const result = response.result as { session?: BrowserSession } | null;
  if (!response.error && result?.session) {
    storeIssuedSession(response.game_id, result.session);
    // Keep bearer credentials out of UI state and the existing JSON inspector.
    const visible = { ...result };
    delete visible.session;
    return { ...response, result: visible };
  }
  return response;
}

export async function newGame(req: NewGameRequest) {
  return storeResponse(await api("/api/gf/new", "POST", req));
}

export function reconnectGame(gameId: string): Promise<ActionResponse> {
  const existing = reconnecting.get(gameId);
  if (existing) return existing;
  const token = getReconnectToken(gameId);
  if (!token) return Promise.resolve({ game_id: gameId, revision: 0, state: {}, events: [], result: {},
    error: { code: "SESSION_REQUIRED", message: "No reconnect credential stored for this game", details: null } });
  const pending = api("/api/gf/reconnect", "POST", { game_id: gameId, reconnect_token: token })
    .then(storeResponse).finally(() => { reconnecting.delete(gameId); });
  reconnecting.set(gameId, pending);
  return pending;
}

async function withSession(gameId: string, authenticated: boolean, send: (token?: string) => Promise<ActionResponse>) {
  const used = authenticated ? getActiveSession(gameId) : undefined;
  const response = await send(used);
  if (!authenticated || !response.error || !recoverable.has(response.error.code) || !getReconnectToken(gameId)) return response;
  // A concurrent request may have already completed recovery for this game.
  const current = getActiveSession(gameId);
  if (!current || current === used) {
    const recovered = await reconnectGame(gameId);
    if (recovered.error) return recovered;
  }
  return send(getActiveSession(gameId)); // Exactly one retry, with no recursive recovery.
}

export async function gfAction(req: ActionRequest) {
  const acquisition = req.action === "gf.join_lobby";
  const authenticated = req.view !== "debug" && !acquisition &&
    (req.action !== "gf.get_state" || req.view === "player" || req.view === "marshal");
  const response = await withSession(req.game_id, authenticated,
    token => api("/api/gf/action", "POST", req, token));
  return acquisition ? storeResponse(response) : response;
}

export function getGame(gameId: string, view: View, viewerId?: string | null) {
  const query = new URLSearchParams({ view });
  if (viewerId) query.set("viewer_id", viewerId);
  return withSession(gameId, view === "player" || view === "marshal",
    token => api(`/api/game/${encodeURIComponent(gameId)}?${query}`, "GET", undefined, token));
}

export type BrowserSession = {
  player_id: string;
  role: "marshal" | "player";
  active_session?: string;
  reconnect_token?: string;
};

const sessionKey = (gameId: string) => `gf_session:${gameId}`;
const reconnectKey = (gameId: string) => `gf_reconnect:${gameId}`;

function read(storage: Storage | undefined, key: string): BrowserSession | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return null;
    const s = value as BrowserSession;
    return typeof s.player_id === "string" && (s.role === "player" || s.role === "marshal") ? s : null;
  } catch { return null; }
}

export function loadSession(gameId: string): BrowserSession | null {
  const persistent = read(globalThis.localStorage, reconnectKey(gameId));
  const active = read(globalThis.sessionStorage, sessionKey(gameId));
  return active ? { ...persistent, ...active } : persistent;
}

export function getActiveSession(gameId: string): string | undefined {
  const value = read(globalThis.sessionStorage, sessionKey(gameId))?.active_session;
  return typeof value === "string" && value ? value : undefined;
}

export function getReconnectToken(gameId: string): string | undefined {
  const value = read(globalThis.localStorage, reconnectKey(gameId))?.reconnect_token;
  return typeof value === "string" && value ? value : undefined;
}

export function storeIssuedSession(gameId: string, session: BrowserSession): void {
  const { player_id, role, active_session, reconnect_token } = session;
  if (!gameId || typeof player_id !== "string" || !player_id ||
      (role !== "player" && role !== "marshal") || typeof active_session !== "string" || !active_session) {
    throw new Error("Invalid session response");
  }
  const token = reconnect_token ?? getReconnectToken(gameId);
  if (token) globalThis.localStorage?.setItem(reconnectKey(gameId), JSON.stringify({ player_id, role, reconnect_token: token }));
  globalThis.sessionStorage?.setItem(sessionKey(gameId), JSON.stringify({ player_id, role, active_session }));
}

export function clearSession(gameId: string): void {
  globalThis.sessionStorage?.removeItem(sessionKey(gameId));
  globalThis.localStorage?.removeItem(reconnectKey(gameId));
}

// Non-secret tab routing: refresh returns to the same game.
export function getLastGame(): string {
  return globalThis.sessionStorage?.getItem("gf_last_game") ?? "";
}

export function setLastGame(gameId: string): void {
  if (gameId) globalThis.sessionStorage?.setItem("gf_last_game", gameId);
  else globalThis.sessionStorage?.removeItem("gf_last_game");
}

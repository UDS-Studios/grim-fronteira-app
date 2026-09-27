type IdentityStorage = Pick<Storage, "getItem" | "setItem">;

export function getOrCreateClientId(storage: IdentityStorage = localStorage): string {
  const key = "gf_client_id";
  const existing = storage.getItem(key);
  if (existing) return existing;

  const id = `player-${Math.random().toString(36).slice(2, 8)}`;
  storage.setItem(key, id);
  return id;
}

export function getFreshPlayerId(): string {
  return `player-${Math.random().toString(36).slice(2, 8)}`;
}

// Active actors belong to this tab. Keep the device ID only as a legacy fallback.
export function persistPlayerId(playerId: string, storage: IdentityStorage = sessionStorage): string {
  storage.setItem("gf_player_id", playerId);
  return playerId;
}

export function getOrCreatePlayerId(
  tabStorage: IdentityStorage = sessionStorage,
  legacyStorage: IdentityStorage = localStorage,
): string {
  const existing = tabStorage.getItem("gf_player_id");
  if (existing?.trim()) return existing;
  return persistPlayerId(getOrCreateClientId(legacyStorage), tabStorage);
}

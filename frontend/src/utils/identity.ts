export function getOrCreateClientId(): string {
  const key = "gf_client_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = `player-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(key, id);
  return id;
}

export function getFreshPlayerId(): string {
  return `player-${Math.random().toString(36).slice(2, 8)}`;
}

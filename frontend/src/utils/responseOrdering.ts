import type { ActionResponse } from "../api/types.ts";

// Polls and actions can finish out of order. Never rewind the same game's projection.
export function acceptResponse(current: ActionResponse | null, incoming: ActionResponse): ActionResponse {
  if (current?.game_id === incoming.game_id && current.revision > incoming.revision) return current;
  return incoming;
}

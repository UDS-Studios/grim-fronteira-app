export type View = "public" | "player" | "debug";

export type ErrorPayload = {
  code: string;
  message: string;
  details: any | null;
};

// The backend's serialized payload is authoritative for viewer-specific data.
export type PendingInteraction = {
  kind: string;
  actor_id: string;
  allowed_actions: string[];
  continuation: unknown | null;
  payload: Record<string, unknown>;
};

export type ActionResponse = {
  game_id: string;
  revision: number;
  state: any;
  events: any[];
  result: any;
  error: ErrorPayload | null;
};

export type NewGameRequest = {
  creator_id: string;
  template_path: string;
  seed?: number | null;
  view: View;
  viewer_id?: string | null;
  meta?: Record<string, any> | null;
};

export type ActionRequest = {
  game_id: string;
  action: string;
  params: Record<string, any>;
  view: View;
  viewer_id?: string | null;
};

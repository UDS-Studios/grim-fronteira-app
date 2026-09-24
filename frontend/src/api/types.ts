export type View = "public" | "player" | "debug";

export type ErrorPayload = {
  code: string;
  message: string;
  details: unknown | null;
};

// The backend's serialized payload is authoritative for viewer-specific data.
export type PendingInteraction = {
  kind: string;
  actor_id: string;
  allowed_actions: string[];
  continuation: unknown | null;
  payload: Record<string, unknown>;
};

// Only the state fields consumed by the current frontend are described here.
export type FactionName = "criollo" | "paisa" | "yankee" | "chichimeca";

export type SceneFactionPowerUsage =
  Record<string, Partial<Record<FactionName, boolean>>>;

export type SceneState = {
  status?: string;
  mode?: string;
  participants?: string[];
  faction_power_usage?: SceneFactionPowerUsage;
};

export type GameMeta = {
  phase?: string;
  marshal_id?: string;
  players_order?: string[];
  players?: Record<string, { reward_points?: number; wounds?: number }>;
  scene?: SceneState;
  pending_interaction?: PendingInteraction | null;
  lobby?: {
    registration_open?: boolean;
    character_assignment_mode?: string;
    character_assignment_locked?: boolean;
    available_figures_count?: number;
    all_players_ready?: boolean;
    claimed_figures?: Record<string, string>;
    players?: Record<string, unknown>;
  };
  hooks?: {
    suggestions?: string[];
    selected_hook?: string | null;
  };
  victory?: {
    winner?: string | null;
    winner_label?: string;
    reason?: string | null;
  };
};

export type GameState = {
  meta?: GameMeta;
  zones?: Record<string, string[]>;
  deck?: {
    draw_pile?: string[] | { count?: number };
    discard_pile?: string[];
  };
};

export type ActionResponse = {
  game_id: string;
  revision: number;
  state: GameState;
  events: unknown[];
  result: unknown;
  error: ErrorPayload | null;
};

export type NewGameRequest = {
  creator_id: string;
  template_path: string;
  seed?: number | null;
  view: View;
  viewer_id?: string | null;
  meta?: Record<string, unknown> | null;
};

export type ActionRequest = {
  game_id: string;
  action: string;
  params: Record<string, unknown>;
  view: View;
  viewer_id?: string | null;
};

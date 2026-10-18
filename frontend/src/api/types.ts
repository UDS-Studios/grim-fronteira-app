export type View = "public" | "player" | "marshal" | "debug";

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

export type SceneDarkState = {
  revealed?: boolean;
  must_discard_last?: boolean;
  marshal_total?: number | null;
};

export type ScenePlayerState = {
  hand_value?: number;
  dark_reward_loss_pending?: boolean;
  reward_cards_gained?: number;
  wounds_gained?: number;
  wounds_applied?: number;
  result?: "success" | "failure" | "bust" | "wound" | "duel_win" | "friendship" | null;
  standing?: boolean;
  busted?: boolean;
  acknowledged?: boolean;
};

export type SceneState = {
  status?: string;
  mode?: string;
  duel?: { subtype?: string | null };
  azzardo?: { status?: string; card_id?: string | null };
  participants?: string[];
  players?: Record<string, ScenePlayerState>;
  dark_mode?: boolean;
  dark?: SceneDarkState;
  difficulty?: {
    card_id?: string | null;
    value?: number | null;
  };
  faction_power_usage?: SceneFactionPowerUsage;
};

export type SeatPresence = {
  online: boolean;
};

export type SoloState = {
  adventure_id: string; version: number; adventure_title: string;
  node: string; step: "intro" | "playing" | "outcome" | "ending";
  attempt: number; scene_number: number; title: string; text: string;
  has_gun: boolean; outlaw_defeated: boolean; invitation: string;
  outcome: "success" | "failure" | "bust" | null;
  ending: "death" | "ascension" | "exhaustion" | null;
  needs_heal: boolean; needs_discard: boolean;
  resolved_hand?: string[];
  special_completion?: { id: string; title: string; text: string } | null;
  history: { node: string; outcome: string; attempt: number; scene_number: number }[];
};

export type GameMeta = {
  mode?: "solo";
  solo?: SoloState;
  session_pause?: SessionPause;
  presence?: Record<string, SeatPresence>;
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

export type SessionPause = {
  paused: boolean;
  reason: "marshal_offline" | null;
};

export type CardZoneProjection = string[] | { count?: number };

// Ordinary player/lobby zones remain card arrays; Dark zones can be count-only.
export type GameZones = Record<string, CardZoneProjection> &
  Record<`players.${string}` | `scene.hand.${string}` | `lobby.${string}`, string[]>;

export type GameState = {
  meta?: GameMeta;
  zones?: GameZones;
  deck?: {
    draw_pile?: string[] | { count?: number };
    discard_pile?: string[] | { count?: number };
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
  expected_revision?: number;
  game_id: string;
  action: string;
  params: Record<string, unknown>;
  view: View;
  viewer_id?: string | null;
};

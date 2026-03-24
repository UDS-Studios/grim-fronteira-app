export type View = "public" | "debug";

export type ErrorPayload = {
  code: string;
  message: string;
  details: any | null;
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
  meta?: Record<string, any> | null;
};

export type ActionRequest = {
  game_id: string;
  action: string;
  params: Record<string, any>;
  view: View;
};
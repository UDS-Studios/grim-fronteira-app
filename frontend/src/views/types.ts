import type { Dispatch, SetStateAction } from "react";
import type { ActionResponse, GameMeta, View } from "../api/types";

export type MetaAny = GameMeta;
export type Zones = Record<string, string[]>;
export type RunAction = (p: Promise<ActionResponse>) => Promise<ActionResponse>;

export type LobbyViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  joinPlayerId: string;
  setJoinPlayerId: (v: string) => void;
  selectedPlayerId: string;
  setSelectedPlayerId: (v: string) => void;
  claimCardId: string;
  setClaimCardId: (v: string) => void;
  run: RunAction;
  setResp: Dispatch<SetStateAction<ActionResponse | null>>;
  onBackHome: () => void;
};

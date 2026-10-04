import type { Dispatch, SetStateAction } from "react";
import type { ActionResponse, GameMeta, GameZones, View } from "../api/types";

export type MetaAny = GameMeta;
export type Zones = GameZones;
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
  connectionLost?: boolean;
  run: RunAction;
  setResp: Dispatch<SetStateAction<ActionResponse | null>>;
  onBackHome: () => void;
};

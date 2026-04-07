import MarshalLobbyView from "./MarshalLobbyView";
import PlayerLobbyView from "./PlayerLobbyView";
import type { LobbyViewProps, MetaAny } from "./types";

export default function LobbyView(props: LobbyViewProps) {
  const meta = ((props.resp.state as any)?.meta ?? {}) as MetaAny;
  const marshalId = meta.marshal_id ?? "";
  const isMarshal = props.currentActorId === marshalId;

  if (isMarshal) {
    return <MarshalLobbyView {...props} />;
  }

  return (
    <PlayerLobbyView
      resp={props.resp}
      view={props.view}
      currentActorId={props.currentActorId}
      run={props.run}
    />
  );
}

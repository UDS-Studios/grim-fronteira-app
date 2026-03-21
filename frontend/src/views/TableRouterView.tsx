import MarshalTableView from "./MarshalTableView";
import PlayerTableView from "./PlayerTableView";
import type { ActionResponse, View } from "../api/types";

type TableRouterViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  onBackHome: () => void;
};

export default function TableRouterView({
  resp,
  view,
  currentActorId,
  run,
  onBackHome,
}: TableRouterViewProps) {
  const state = (resp.state as any) ?? {};
  const meta = state.meta ?? {};
  const marshalId = meta.marshal_id ?? "";

  const isMarshal = currentActorId === marshalId;

  if (isMarshal) {
    return (
      <MarshalTableView
        resp={resp}
        view={view}
        currentActorId={currentActorId}
        run={run}
        onBackHome={onBackHome}
      />
    );
  }

  return (
    <PlayerTableView
      resp={resp}
      view={view}
      currentActorId={currentActorId}
      run={run}
      onBackHome={onBackHome}
    />
  );
}
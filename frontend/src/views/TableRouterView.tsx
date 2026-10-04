import ResponsiveScaleBox from "../components/ResponsiveScaleBox";
import MarshalTableView from "./MarshalTableView";
import PlayerTableView from "./PlayerTableView";
import type { ActionResponse, View } from "../api/types";

type TableRouterViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  connectionLost?: boolean;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  onBackHome: () => void;
};

export default function TableRouterView({
  resp,
  view,
  currentActorId,
  run,
  connectionLost = false,
  onBackHome,
}: TableRouterViewProps) {
  const state = resp.state ?? {};
  const meta = state.meta ?? {};
  const marshalId = meta.marshal_id ?? "";

  const isMarshal = currentActorId === marshalId;

  const Table = isMarshal ? MarshalTableView : PlayerTableView;
  return (
    <ResponsiveScaleBox baseWidth={1800} fit="viewport">
      <Table
        resp={resp}
        view={view}
        currentActorId={currentActorId}
        connectionLost={connectionLost}
        run={run}
        onBackHome={onBackHome}
      />
    </ResponsiveScaleBox>
  );
}

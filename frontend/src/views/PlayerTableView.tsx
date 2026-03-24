import type { ActionResponse, View } from "../api/types";

type PlayerTableViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  onBackHome: () => void;
};

export default function PlayerTableView({
  currentActorId,
}: PlayerTableViewProps) {
  return (
    <div
      style={{
        marginTop: 12,
        flex: 1,
        minHeight: 0,
        border: "1px solid var(--border-strong)",
        borderRadius: 16,
        padding: 20,
        background: "var(--surface-bg)",
        overflow: "auto",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Player Control Center</h2>
      <div>Current player: <b>{currentActorId}</b></div>
      <div style={{ marginTop: 10, opacity: 0.75 }}>
        Player table view coming next.
      </div>
    </div>
  );
}

import { useId } from "react";

export default function ReclaimInteractionControl({ busy, disabled, onReclaim }: {
  busy: boolean;
  disabled: boolean;
  onReclaim: () => void;
}) {
  const warningId = useId();
  return (
    <div className="reclaim-control">
      <button type="button" className="reclaim-button" aria-describedby={warningId}
        onClick={onReclaim} disabled={disabled}>
        {busy ? "Reclaiming…" : "Reclaim interaction"}
      </button>
      <div id={warningId} role="tooltip" className="reclaim-warning">
        Emergency action. Use Reclaim only if the acting player is unreachable and the game cannot continue. This skips their pending interaction and resumes play.
      </div>
    </div>
  );
}

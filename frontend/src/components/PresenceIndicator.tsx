import type { PresenceStatus } from "../utils/presence";

export default function PresenceIndicator({ status }: { status: PresenceStatus }) {
  if (status === "unknown") return null;
  return (
    <span className={`presence-indicator presence-indicator--${status}`}>
      <span className="presence-light" aria-hidden="true" />
      {status === "online" ? "Online" : "Offline"}
    </span>
  );
}

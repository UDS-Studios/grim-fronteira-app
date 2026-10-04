import type { GameMeta } from "../api/types";
import { getPresenceStatus } from "../utils/presence";
import { isGameplayPaused } from "../utils/sessionPause";

export default function SessionPauseBanner({ meta }: { meta: GameMeta }) {
  const paused = isGameplayPaused(meta) && meta.session_pause?.reason === "marshal_offline";
  if (!paused && getPresenceStatus(meta, meta.marshal_id ?? "") !== "offline") return null;
  return (
    <div className="marshal-offline-banner" role="status">
      <span className="presence-light" aria-hidden="true" />
      <div>
        <strong>{paused ? "THE MARSHAL IS OFFLINE — THE GAME IS PAUSED" : "THE MARSHAL IS OFFLINE"}</strong>
        <span>Waiting for the Marshal to reconnect.</span>
      </div>
    </div>
  );
}

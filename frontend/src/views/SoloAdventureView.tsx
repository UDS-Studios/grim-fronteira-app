import { useEffect, useRef, useState } from "react";
import type { ActionRequest, ActionResponse } from "../api/types";
import { gfAction, getGame } from "../api/gf";
import TableZone from "../components/TableZone";
import ResponsiveScaleBox from "../components/ResponsiveScaleBox";
import PlayerLobbyView from "./PlayerLobbyView";
import PlayerTableView from "./PlayerTableView";
import { getPlayerFaction } from "../utils/factions";
import "./SoloAdventureView.css";

type Props = {
  resp: ActionResponse;
  playerId: string;
  connectionLost: boolean;
  run: (request: Promise<ActionResponse>) => Promise<ActionResponse>;
  onMultiplayer: () => void;
  onRetry: () => Promise<void>;
};

/** The adventure adds a Marshal's voice to the real player lobby and table. */
export default function SoloAdventureView({ resp, playerId, connectionLost, run, onMultiplayer, onRetry }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestFlight = useRef<Promise<ActionResponse> | null>(null);
  const retrying = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const meta = resp.state.meta ?? {};
  const solo = meta.solo!;
  const scene = meta.scene;
  const player = scene?.players?.[playerId];
  const faction = getPlayerFaction(resp.state, playerId);
  const terminal = Boolean(solo.ending);
  const disabled = busy || connectionLost;
  const isLobby = meta.phase === "lobby";

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [resp.game_id, solo.node, solo.step]);

  // Every shared player-view command keeps solo's revision and duplicate guards.
  function submit(request: ActionRequest): Promise<ActionResponse> {
    if (requestFlight.current) return requestFlight.current;
    if (connectionLost) return Promise.resolve({ ...resp, error: {
      code: "CONNECTION_LOST", message: "Waiting for the server. Your saved adventure is still shown.", details: null,
    } });
    setError("");
    setBusy(true);
    const pending = gfAction({ ...request, expected_revision: resp.revision }).finally(() => {
      requestFlight.current = null;
      setBusy(false);
    });
    requestFlight.current = pending;
    return pending;
  }

  async function handleResponse(request: Promise<ActionResponse>): Promise<ActionResponse> {
    const response = await run(request);
    if (response.error) {
      setError(response.error.code === "HTTP_409"
        ? "The adventure changed. The latest state has been loaded; choose your action again."
        : response.error.message);
      if (response.error.code === "HTTP_409") await run(getGame(resp.game_id, "player", playerId));
    }
    return response;
  }

  function continueStory() {
    return handleResponse(submit({ game_id: resp.game_id, action: "gf.solo_continue",
      params: { player_id: playerId }, view: "player", viewer_id: playerId }));
  }

  async function retry() {
    if (requestFlight.current || retrying.current) return;
    retrying.current = true;
    setBusy(true);
    try { await onRetry(); } finally { retrying.current = false; setBusy(false); }
  }

  const narrative = <section className="solo-story" aria-label="Adventure story" aria-live="polite">
    <TableZone title={solo.adventure_title}>
      <div className="solo-story-heading">
        <h2 ref={heading} tabIndex={-1}>{solo.title}</h2>
        <span>{terminal ? "End of the tale" : `Scene ${solo.scene_number + (solo.step === "intro" ? 1 : 0) || 1} · ${solo.outcome === "bust" ? "Wound" : solo.outcome ?? "Your trail"}`}</span>
      </div>
      <p className="solo-story-text">{solo.text}</p>
      {solo.step === "outcome" && <p className="solo-outcome-summary">Your total: <strong>{player?.hand_value}</strong> · Target: <strong>{scene?.difficulty?.value}</strong>. {solo.outcome === "success" ? "One Reward earned." : solo.outcome === "bust" ? "One wound taken; no Reward earned." : "No wound and no Reward."}</p>}
      {solo.has_gun && !terminal && <span className="solo-story-equipment">Armed with the trader's revolver</span>}
      {terminal ? <>
        <p>{solo.invitation}</p>
        <div className="solo-actions"><button type="button" onClick={onMultiplayer} disabled={busy}>Play multiplayer</button>
          <button type="button" onClick={retry} disabled={disabled}>{solo.ending === "death" ? "Retry solo" : "Play solo again"}</button></div>
      </> : solo.step === "intro" ? <button type="button" disabled={disabled} onClick={continueStory}>Play this test</button>
        : solo.step === "outcome" ? <div className="solo-actions">
          <button type="button" disabled={disabled || solo.needs_heal || solo.needs_discard} onClick={continueStory}>
            {solo.outcome === "failure" || (solo.outcome === "bust" && ["witnesses", "tracking"].includes(solo.node)) ? "Try another approach" : "Continue the trail"}
          </button>
          {(solo.needs_heal || solo.needs_discard) && <span>Finish the Reward choices on your player board first.</span>}
        </div> : null}
    </TableZone>
  </section>;

  const notes = <TableZone title="Marshal's notes">
    <div className="solo-notes">
      <p>Play as you would at a human Marshal's table. Click the <strong>Deck</strong> to draw; use <strong>STAY</strong> to keep your total. Match or beat the difficulty without going over 21.</p>
      <p>Your character contributes 10. Aces count as 1 or 11; Jokers count as 0 and grant a resource. A bust gives one wound. Two wounds end your run.</p>
      <p>Click your <strong>Vengeance</strong> stack to add +1, or +2 with your suit. Before acknowledging a result, you can still play Vengeance; it can also make you bust.</p>
      <p><strong>Scum</strong> targets other players in multiplayer. There is no eligible target in this solo story.</p>
      {faction === "chichimeca" && <p className="solo-warning"><strong>Chichimeca:</strong> your power has no eligible target here. In multiplayer, a wound lets you take Scum from an eligible enemy.</p>}
      {faction === "criollo" && <p><strong>Law of Lead:</strong> use Convert on your board to change one Scum into Vengeance or the reverse, once per scene.</p>}
      {faction === "paisa" && <p><strong>Heart of Shadow:</strong> use Claim Reward on your board, then select three Vengeance cards.</p>}
      {faction === "yankee" && <p><strong>Order and Profit:</strong> before a duel, the Deck lets you keep or bury the inspected top card.</p>}
      <details><summary>Rewards and recovery</summary>
        <p>Successful tests grant one Reward. Exactly 21 Reward points wins, even before the final duel. Over 21, select Rewards to discard until you have 20 or fewer.</p>
        <p>With one wound and more than 11 Reward points, use HEAL to spend cards worth at least 11, or SKIP to keep your Rewards.</p>
        <p>Solo leaves out Azzardo and Dark; try both with a human Marshal in multiplayer.</p>
      </details>
      {solo.history.length > 0 && <details><summary>Your trail so far</summary><ol>{solo.history.map(entry => <li key={entry.scene_number}>
        Scene {entry.scene_number}: {entry.node} — {entry.outcome === "bust" ? "wounded" : entry.outcome}</li>)}</ol></details>}
    </div>
  </TableZone>;

  return <main className={`solo-adventure ${isLobby ? "solo-adventure--lobby" : "solo-adventure--table"}`}>
    {error && <p role="alert" className="solo-error">{error}</p>}
    {connectionLost && <p role="alert">Waiting for the server. Your last saved adventure is shown.</p>}
    {isLobby ? <>
      <div className="solo-lobby-toolbar"><span>{solo.adventure_title} · Learn by playing</span><button type="button" disabled={busy} onClick={onMultiplayer}>Home</button></div>
      <div className="solo-lobby-scroll"><PlayerLobbyView resp={resp} view="player" currentActorId={playerId}
        connectionLost={disabled} run={handleResponse} onAction={submit} /></div>
    </> : <ResponsiveScaleBox baseWidth={1800} fit="viewport">
      <PlayerTableView resp={resp} view="player" currentActorId={playerId} connectionLost={connectionLost}
        readOnly={busy || terminal || solo.step === "intro"} run={handleResponse} onAction={submit}
        onBackHome={onMultiplayer} sceneNarrative={narrative} learningNotes={notes} />
    </ResponsiveScaleBox>}
  </main>;
}

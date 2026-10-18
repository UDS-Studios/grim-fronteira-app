import { useEffect, useRef, useState } from "react";
import type { ActionResponse, SoloState } from "../api/types";
import { gfAction, getGame } from "../api/gf";
import CardImg from "../components/CardImg";
import { isCriolloAvailable } from "./player_table/criollo";
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
const figures = ["D", "C", "H", "S"].flatMap(s => ["J", "Q", "K"].map(r => r + s));
const factionLabels: Record<string, string> = { D: "Criollo", C: "Paisà", H: "Yankee", S: "Chichimeca" };
function rewardPoints(card: string): number {
  if (card === "RJ" || card === "BJ") return 0;
  const rank = card.slice(0, -1);
  return rank === "A" ? 11 : ["J", "Q", "K"].includes(rank) ? 10 : Number(rank);
}

export default function SoloAdventureView({ resp, playerId, connectionLost, run, onMultiplayer, onRetry }: Props) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState("");
  const [figure, setFigure] = useState("KD");
  const [name, setName] = useState("");
  const [selectedRewards, setSelectedRewards] = useState<string[]>([]);
  const [selectedVengeance, setSelectedVengeance] = useState<string[]>([]);
  const meta = resp.state.meta ?? {};
  const solo = meta.solo as SoloState;
  const scene = meta.scene;
  const p = scene?.players?.[playerId];
  const zones = resp.state.zones ?? {};
  const own = (resource: string): string[] => {
    const cards = zones[`players.${playerId}.${resource}`];
    return Array.isArray(cards) ? cards : [];
  };
  const character = own("character")[0];
  const wounds = meta.players?.[playerId]?.wounds ?? 0;
  const rewards = own("rewards");
  const points = rewards.reduce((n, card) => n + rewardPoints(card), 0);
  const lobby = (meta.lobby?.players?.[playerId] ?? {}) as {
    chosen_name?: string; stage?: string; feature_suggestions?: string[]; chosen_feature?: string;
  };
  const pending = meta.pending_interaction;
  const disabled = busy || connectionLost;
  const terminal = Boolean(solo.ending);
  const active = scene?.status === "active" && !p?.standing && !p?.busted && !pending && !terminal;
  const canVengeance = !pending && !terminal && !p?.busted && !p?.acknowledged &&
    ["active", "awaiting_ack"].includes(scene?.status ?? "") && own("vengeance").length > 0;
  const faction = character ? getPlayerFaction(resp.state, playerId) : null;
  const validRewards = selectedRewards.filter(c => rewards.includes(c));
  const validVengeance = selectedVengeance.filter(c => own("vengeance").includes(c));
  const toggle = (cards: string[], card: string) => cards.includes(card) ? cards.filter(c => c !== card) : [...cards, card];

  useEffect(() => {
    heading.current?.focus();
  }, [resp.game_id, solo.node, solo.step, lobby.stage]);

  async function command(action: string, params: Record<string, unknown> = {}) {
    if (inFlight.current || connectionLost) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await run(gfAction({ game_id: resp.game_id, action,
        params: { player_id: playerId, ...params }, view: "player", viewer_id: playerId,
        expected_revision: resp.revision }));
      if (r.error) {
        setError(r.error.code === "HTTP_409" ? "Your adventure changed. The latest state has been loaded; choose your next action again." : r.error.message);
        if (r.error.code === "HTTP_409") await run(getGame(resp.game_id, "player", playerId));
      } else {
        setSelectedRewards([]);
        setSelectedVengeance([]);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function retry() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await onRetry(); } finally { inFlight.current = false; setBusy(false); }
  }

  return <main className="solo-adventure">
    <header className="solo-header">
      <div><span className="solo-eyebrow">Solo · Learn by playing</span><h1>{solo.adventure_title}</h1></div>
      <button type="button" onClick={onMultiplayer} disabled={busy}>Multiplayer / Home</button>
    </header>
    {error && <p role="alert" className="solo-error">{error}</p>}
    {connectionLost && <p role="alert">Waiting for the server. Your last saved adventure is shown.</p>}
    {meta.phase === "lobby" ? <section className="solo-panel">
      <h2 ref={heading} tabIndex={-1}>Choose your traveller</h2>
      {!character ? <>
        <p>Your face card starts each hand at 10. Jacks begin with two Scum cards, Queens with one Scum and one Vengeance, Kings with two Vengeance.</p>
        <p>For a first run, a King starts with Vengeance you can use on your own tests. Scum is used against other players in multiplayer.</p>
        <div className="solo-figures" role="group" aria-label="Character cards">
          {figures.map(card => <button type="button" key={card} aria-pressed={figure === card}
            onClick={() => setFigure(card)} disabled={disabled} aria-label={`${card} ${factionLabels[card.slice(-1)]}`}>
            <CardImg cardId={card} width={64} /><span>{card} · {factionLabels[card.slice(-1)]}</span>
          </button>)}
        </div>
        {figure.endsWith("S") && <p role="note" className="solo-warning"><strong>Solo limitation:</strong> Chichimeca's power needs another player to target, so it cannot be used in this adventure. You can still play, but you will be at a disadvantage. Try multiplayer to use the faction's full power. Select another card above to choose another faction.</p>}
        <button type="button" disabled={disabled} onClick={() => command("gf.claim_character", { card_id: figure })}>
          {figure.endsWith("S") ? "Play Chichimeca" : "Choose this character"}
        </button>
      </> : <>
        <div className="solo-character"><CardImg cardId={character} width={82} /><p>{factionLabels[character.slice(-1)]} · {character}</p></div>
        {lobby.stage === "waiting_for_name" && <form onSubmit={e => { e.preventDefault(); void command("gf.submit_character_name", { name: name.trim() }); }}>
          <label htmlFor="solo-name">What is your name?</label>
          <input id="solo-name" value={name} maxLength={80} onChange={e => setName(e.target.value)} disabled={disabled} autoComplete="off" />
          <button disabled={disabled || !name.trim()}>Take this name</button>
        </form>}
        {lobby.stage === "waiting_for_feature" && <><h3>Choose a distinctive feature</h3><div className="solo-actions">
          {lobby.feature_suggestions?.map(feature => <button type="button" key={feature} disabled={disabled}
            onClick={() => command("gf.submit_character_feature", { feature })}>{feature}</button>)}
        </div></>}
        {lobby.stage === "ready" && <><p>{lobby.chosen_name}, the trail is waiting. No dice, no human Marshal: read the story, then play your hand. Two wounds end your run.</p>
          <button type="button" disabled={disabled} onClick={() => command("gf.solo_continue")}>Begin the adventure</button></>}
      </>}
    </section> : <>
      <section className="solo-panel solo-story" aria-label="Adventure story" aria-live="polite">
        <span className="solo-eyebrow">{terminal ? "End of the tale" : `Scene ${solo.scene_number + (solo.step === "intro" ? 1 : 0) || 1} · ${solo.outcome === "bust" ? "Wound" : solo.outcome ?? "Your trail"}`}</span>
        <h2 ref={heading} tabIndex={-1}>{solo.title}</h2><p>{solo.text}</p>
        {solo.step === "outcome" && <p className="solo-outcome-summary">Your total: <strong>{p?.hand_value}</strong> · Target: <strong>{scene?.difficulty?.value}</strong>. {solo.outcome === "success" ? "One Reward earned." : solo.outcome === "bust" ? "One wound taken; no Reward earned." : "No wound and no Reward. Try again with a fresh hand."}</p>}
        {solo.has_gun && !terminal && <span className="solo-tag">Armed with the trader's revolver</span>}
      </section>
      <section className="solo-stats" aria-label="Character status">
        <span><strong>{lobby.chosen_name || "Traveller"}</strong> · {factionLabels[character?.slice(-1) ?? ""]}</span>
        <span>Wounds <strong>{wounds} / 2</strong></span><span>Rewards <strong>{points} / 21</strong></span>
      </section>
      {terminal ? <section className="solo-panel">
        <h2>Bring your posse</h2><p>{solo.invitation}</p>
        <div className="solo-actions"><button type="button" onClick={onMultiplayer} disabled={busy}>Play multiplayer</button>
          <button type="button" onClick={retry} disabled={disabled}>{solo.ending === "death" ? "Retry solo" : "Play solo again"}</button></div>
      </section> : <>
        {solo.step === "intro" && <section className="solo-panel"><p>Each test has a fresh difficulty card. Match or beat the difficulty without going over 21. Your character card counts toward your hand.</p>
          <button type="button" disabled={disabled} onClick={() => command("gf.solo_continue")}>Play this test</button></section>}
        {solo.step === "playing" && <section className="solo-panel">
          <div className="solo-test-heading"><h2>Your hand</h2><strong>Target {scene?.difficulty?.value ?? "—"}</strong></div>
          <div className="solo-cards">{character && <CardImg cardId={character} width={78} />}
            {(zones[`scene.hand.${playerId}`] ?? []).map(card => <CardImg cardId={card} key={card} width={78} />)}
            <strong className="solo-total">{p?.hand_value ?? 10}</strong></div>
          {pending?.kind === "yankee_inspect_top_card" ? <><h3>Order and Profit</h3>
            <p>Before a duel, you may inspect the next card. Keep it on top or bury it at the bottom.</p>
            <CardImg cardId={String(pending.payload.inspected_card_id)} width={78} />
            <div className="solo-actions">{["keep", "bury"].map(choice => <button type="button" key={choice} disabled={disabled}
              onClick={() => command("gf.faction_yankee_choose_top_card", { choice })}>{choice === "keep" ? "Keep on top" : "Bury card"}</button>)}</div></> : <>
            <p>Draw to add a card, or stand to keep your total. Aces can count as 1 or 11; Jokers count as 0 and grant a resource. Over 21 is a bust and costs one wound.</p>
            <div className="solo-actions"><button type="button" disabled={disabled || !active} onClick={() => command("gf.scene_draw_card")}>Draw</button>
              <button type="button" disabled={disabled || !active} onClick={() => command("gf.scene_stand")}>Stand</button>
              {canVengeance && <button type="button" disabled={disabled} onClick={() => command("gf.scene_play_vengeance")}>Play Vengeance</button>}
              {scene?.status === "awaiting_ack" && <button type="button" disabled={disabled} onClick={() => command("gf.scene_acknowledge_resolution")}>Accept result</button>}
            </div>
            {scene?.status === "awaiting_ack" && <p role="status">Result: {p?.result === "bust" ? "bust — one wound" : p?.result}. You can still play Vengeance before accepting a non-bust result.</p>}
          </>}
        </section>}
        <section className="solo-panel"><h2>Your resources</h2>
          <p>Vengeance adds +1 to your test, or +2 when its suit matches yours; it can also push you over 21. Scum targets other players, so it cannot be played against the scripted obstacles here.</p>
          <div className="solo-resources">{["scum", "vengeance"].map(resource => <div key={resource}><h3>{resource === "scum" ? "Scum" : "Vengeance"} ({own(resource).length})</h3>
            <div className="solo-cards">{own(resource).map(card => <span key={card}><CardImg cardId={card} width={56} />
              {isCriolloAvailable(resp.state, playerId) && !pending && <button type="button" disabled={disabled}
                onClick={() => command("gf.faction_criollo_convert_resource", { card_id: card, from_resource: resource })}>Convert {card}</button>}
              {faction === "paisa" && resource === "vengeance" && <label><input type="checkbox" disabled={disabled || Boolean(pending)} checked={validVengeance.includes(card)}
                onChange={() => setSelectedVengeance(toggle(validVengeance, card))} />Select {card}</label>}
            </span>)}</div></div>)}</div>
          {faction === "criollo" && <p>Law of Lead: once per scene, convert one Scum to Vengeance or the reverse.</p>}
          {faction === "paisa" && <><p>Heart of Ombra: spend three Vengeance cards to claim one Reward.</p><button type="button" disabled={disabled || Boolean(pending) || validVengeance.length !== 3}
            onClick={() => command("gf.faction_paisa_claim_reward", { vengeance_card_ids: validVengeance })}>Claim Reward</button></>}
          {faction === "chichimeca" && <p className="solo-warning">Chichimeca's power has no eligible target here. In multiplayer, a wound lets you take Scum from an eligible enemy.</p>}
          {faction === "yankee" && <p>Order and Profit: inspect the next card before a duel, then keep or bury it.</p>}
        </section>
        <section className="solo-panel"><h2>Rewards</h2><p>Successful tests grant one Reward card. Exactly 21 Reward points wins the game. If you go over, discard Rewards until you have 20 or fewer.</p>
          <div className="solo-cards">{rewards.map(card => <div key={card}><CardImg cardId={card} width={64} />
            {solo.needs_heal && <label><input type="checkbox" checked={validRewards.includes(card)} disabled={disabled}
              onChange={() => setSelectedRewards(toggle(validRewards, card))} />Spend {card}</label>}
            {solo.needs_discard && <button type="button" disabled={disabled} onClick={() => command("gf.scene_discard_reward", { reward_card_id: card })}>Discard {card}</button>}
          </div>)}</div>
          {solo.needs_heal && <><p>You have one wound and more than 11 Reward points. Spend cards worth at least 11 to heal, or keep your Rewards and skip healing.</p>
            <div className="solo-actions"><button type="button" disabled={disabled || validRewards.reduce((n, c) => n + rewardPoints(c), 0) < 11}
              onClick={() => command("gf.scene_heal_wound", { reward_card_ids: validRewards })}>Heal one wound</button>
              <button type="button" disabled={disabled} onClick={() => command("gf.scene_skip_heal")}>Skip healing</button></div></>}
        </section>
        {solo.step === "outcome" && <button className="solo-continue" type="button" disabled={disabled || solo.needs_heal || solo.needs_discard}
          onClick={() => command("gf.solo_continue")}>{solo.outcome === "failure" || (solo.outcome === "bust" && ["witnesses", "tracking"].includes(solo.node)) ? "Try another approach" : "Continue the trail"}</button>}
      </>}
      {solo.history.length > 0 && <details className="solo-panel"><summary>Your trail so far</summary><ol>{solo.history.map(entry => <li key={entry.scene_number}>
        Scene {entry.scene_number}: {entry.node} — {entry.outcome === "bust" ? "wounded" : entry.outcome}</li>)}</ol></details>}
    </>}
  </main>;
}

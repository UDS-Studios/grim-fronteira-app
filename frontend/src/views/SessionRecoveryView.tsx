import type { RecoveryReason } from "../utils/reconnect";

type Props = {
  reason: RecoveryReason;
  gameId: string;
  onTakeOver: () => void;
  onBackHome: () => void;
  busy: boolean;
  errorMessage?: string | null;
};

export default function SessionRecoveryView({ reason, gameId, onTakeOver, onBackHome, busy, errorMessage }: Props) {
  const invalid = reason === "reconnect-invalid";
  return (
    <section aria-labelledby="recovery-title" style={{ margin: "auto", maxWidth: 480, padding: 24,
      background: "var(--surface-strong)", border: "1px solid var(--border-muted)", borderRadius: 16 }}>
      <h1 id="recovery-title">{invalid ? "Unable to recover this seat" : "Seat active elsewhere"}</h1>
      <p>{invalid ? "This saved recovery credential is no longer valid."
        : "This seat is active in another browser or device."}</p>
      {!invalid && <p>Taking over will disconnect the other active session.</p>}
      <p>Game: {gameId}</p>
      {errorMessage && <p role="alert">{errorMessage}</p>}
      <div style={{ display: "flex", gap: 12 }}>
        {!invalid && <button disabled={busy} onClick={onTakeOver}>{busy ? "Taking Over…" : "Take Over"}</button>}
        <button onClick={onBackHome}>Back Home</button>
      </div>
    </section>
  );
}

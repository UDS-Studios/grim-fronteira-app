type Props = {
  gameId: string;
  reason: "game-unavailable" | "topology-invalid";
  busy: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  onBackHome: () => void;
};

export default function GameUnavailableView({ gameId, reason, busy, errorMessage, onRetry, onBackHome }: Props) {
  const topology = reason === "topology-invalid";
  return (
    <section aria-labelledby="unavailable-title" style={{ margin: "auto", maxWidth: 480, padding: 24,
      background: "var(--surface-strong)", border: "1px solid var(--border-muted)", borderRadius: 16 }}>
      <h1 id="unavailable-title">{topology ? "Session unavailable" : "Game unavailable"}</h1>
      <p>{topology ? "This game session cannot be recovered safely." : "This game is currently unavailable."}</p>
      {!topology && <p>The saved game could not be loaded safely.</p>}
      <p>Game: {gameId}</p>
      {errorMessage && <p role="alert">{errorMessage}</p>}
      <div style={{ display: "flex", gap: 12 }}>
        {!topology && <button disabled={busy} onClick={onRetry}>{busy ? "Retrying…" : "Retry"}</button>}
        <button onClick={onBackHome}>Back Home</button>
      </div>
    </section>
  );
}

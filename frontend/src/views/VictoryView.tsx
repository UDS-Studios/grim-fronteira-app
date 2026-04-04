type VictoryViewProps = {
  winnerLabel: string;
  reason?: string | null;
  onBackHome: () => void;
};

export default function VictoryView({
  winnerLabel,
  reason = null,
  onBackHome,
}: VictoryViewProps) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          minHeight: 320,
          border: "1px solid var(--border-strong)",
          borderRadius: 18,
          background: "var(--surface-bg)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.12)",
          padding: 28,
          display: "grid",
          gridTemplateRows: "1fr auto",
          gap: 24,
        }}
      >
        <div
          style={{
            display: "grid",
            alignContent: "center",
            justifyItems: "center",
            textAlign: "center",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.12em", opacity: 0.7 }}>
            VICTORY
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.05 }}>
            {winnerLabel} Wins
          </div>
          {reason ? (
            <div style={{ fontSize: 16, opacity: 0.82, maxWidth: 420 }}>
              {reason}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={onBackHome}
            style={{
              minWidth: 160,
              border: "1px solid var(--border-strong)",
              borderRadius: 12,
              padding: "12px 20px",
              background: "var(--surface-strong)",
              color: "var(--text-primary)",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            HOME
          </button>
        </div>
      </div>
    </div>
  );
}

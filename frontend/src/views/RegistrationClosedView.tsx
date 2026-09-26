// src/views/RegistrationClosedView.tsx
type RegistrationClosedViewProps = {
  gameId: string;
  onBackHome: () => void;
};

export default function RegistrationClosedView({
  gameId,
  onBackHome,
}: RegistrationClosedViewProps) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "auto",
        padding: 8,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background: "#faf8f2",
          border: "1px solid #333",
          borderRadius: 16,
          padding: 24,
          width: "min(520px, 100%)",
          display: "grid",
          gap: 16,
          justifyItems: "center",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 520 }}>
          Registration for game <b>{gameId}</b> is closed.
          <br />
          If you already joined this game, reopen it from the same player session.
        </div>

        <button onClick={onBackHome}>Back Home</button>
      </div>
    </div>
  );
}

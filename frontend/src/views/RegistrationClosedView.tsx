// src/views/RegistrationClosedView.tsx
type RegistrationClosedViewProps = {
  gameId: string;
  marshalId: string;
  onBackHome: () => void;
};

export default function RegistrationClosedView({
  gameId,
  marshalId,
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
        <img
          src="/registration-closed.png"
          alt="Registration Closed"
          style={{
            width: "min(360px, 100%)",
            height: "auto",
            display: "block",
          }}
        />

        <div style={{ textAlign: "center", maxWidth: 520 }}>
          Game <b>{gameId}</b> is currently closed.
          <br />
          Ask Marshal <b>{marshalId}</b> to open it back for you.
        </div>

        <button onClick={onBackHome}>Back Home</button>
      </div>
    </div>
  );
}

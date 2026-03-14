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
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#faf8f2",
          border: "1px solid #333",
          borderRadius: 16,
          padding: 24,
          minWidth: 520,
          display: "grid",
          gap: 16,
          justifyItems: "center",
        }}
      >
        <img
          src="/registration-closed.png"
          alt="Registration Closed"
          style={{
            width: 360,
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
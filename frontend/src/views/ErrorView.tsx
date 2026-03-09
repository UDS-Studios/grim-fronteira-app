import type { ActionResponse } from "../api/types";

type ErrorViewProps = {
  error: ActionResponse;
  onBackHome: () => void;
};

export default function ErrorView({ error, onBackHome }: ErrorViewProps) {
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
          background: "#fff4f4",
          border: "1px solid #c00",
          borderRadius: 16,
          padding: 24,
          minWidth: 420,
          display: "grid",
          gap: 16,
          justifyItems: "center",
        }}
      >
        <img
          src="/ui/error-404.png"
          alt="Error 404"
          style={{
            width: 300,
            height: "auto",
            display: "block",
          }}
        />

        <div>
          <b>{error.error?.code ?? "UNKNOWN_ERROR"}</b>
        </div>

        <div style={{ textAlign: "center" }}>
          {error.error?.message ?? "Unknown error."}
        </div>

        <button onClick={onBackHome}>Back Home</button>
      </div>
    </div>
  );
}

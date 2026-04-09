import { publicAsset } from "../app/assets";
import type { ActionResponse } from "../api/types";

type ErrorViewProps = {
  error: ActionResponse;
  onBackHome: () => void;
};

export default function ErrorView({ error, onBackHome }: ErrorViewProps) {
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
          background: "var(--danger-bg)",
          border: "1px solid var(--danger-border)",
          borderRadius: 16,
          padding: 24,
          width: "min(420px, 100%)",
          display: "grid",
          gap: 16,
          justifyItems: "center",
        }}
      >
        <img
          src={publicAsset("ui/error-404.png")}
          alt="Error 404"
          style={{
            width: "min(300px, 100%)",
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

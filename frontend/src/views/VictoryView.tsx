import type { ReactNode } from "react";
import { publicAsset } from "../app/assets";
import CardImg from "../components/CardImg";

type VictoryViewProps = {
  winnerLabel: string;
  winnerFigureCardId?: string | null;
  showMarshalPortrait?: boolean;
  reason?: string | null;
  onBackHome: () => void;
  resultLabel?: string;
  title?: string;
  invitation?: string;
  achievement?: { title: string; text: string } | null;
  actions?: ReactNode;
};

export default function VictoryView({
  winnerLabel,
  winnerFigureCardId = null,
  showMarshalPortrait = false,
  reason = null,
  onBackHome,
  resultLabel = "VICTORY",
  title,
  invitation,
  achievement,
  actions,
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
            {resultLabel}
          </div>
          {winnerFigureCardId ? (
            <div
              style={{
                padding: 8,
                borderRadius: 16,
                background: "color-mix(in srgb, var(--surface-strong) 86%, transparent)",
                boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
              }}
            >
              <CardImg cardId={winnerFigureCardId} width={120} />
            </div>
          ) : showMarshalPortrait ? (
            <div
              style={{
                padding: 8,
                borderRadius: 16,
                background: "color-mix(in srgb, var(--surface-strong) 86%, transparent)",
                boxShadow: "0 10px 22px rgba(0,0,0,0.12)",
              }}
            >
              <img
                src={publicAsset("ui/marshal.png")}
                alt="Marshal"
                style={{
                  display: "block",
                  width: 120,
                  height: "auto",
                }}
              />
            </div>
          ) : null}
          <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1.05 }}>
            {title ?? `${winnerLabel} Wins`}
          </div>
          {reason ? (
            <div style={{ fontSize: 16, opacity: 0.82, maxWidth: 420 }}>
              {reason}
            </div>
          ) : null}
          {achievement && <section aria-label="Special adventure completion" style={{
            border: "1px solid var(--border-strong)", borderRadius: 12, padding: 16,
            background: "var(--surface-strong)", maxWidth: 420,
          }}>
            <h2 style={{ fontFamily: "LavaArabic, serif", fontSize: 28, margin: "0 0 8px" }}>{achievement.title}</h2>
            <p style={{ fontSize: 16, lineHeight: 1.5, margin: 0 }}>{achievement.text}</p>
          </section>}
          {invitation && <p style={{ fontSize: 16, lineHeight: 1.5, maxWidth: 420, margin: 0 }}>{invitation}</p>}
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          {actions ?? (
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
          )}
        </div>
      </div>
    </div>
  );
}

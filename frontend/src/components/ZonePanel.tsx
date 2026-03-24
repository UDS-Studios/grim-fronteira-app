import type { View } from "../api/types";
import CardImg from "./CardImg";

type ZonePanelProps = {
  name: string;
  cards: string[];
  view: View;
};

export default function ZonePanel({ name, cards, view }: ZonePanelProps) {
  const isSecretPile = name.endsWith(".scum") || name.endsWith(".vengeance");
  const renderAsFacedownStack = view === "public" && isSecretPile;

  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: 14,
        padding: 10,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
          alignItems: "baseline",
        }}
      >
        <div style={{ fontWeight: 700 }}>{name}</div>
        <div style={{ opacity: 0.75, fontSize: 13 }}>({cards.length})</div>
      </div>

      {cards.length === 0 ? (
        <div style={{ opacity: 0.6 }}>— empty —</div>
      ) : renderAsFacedownStack ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CardImg cardId="BACK" faceDown width={86} title={`${cards.length} cards`} />
          <div style={{ fontSize: 14, opacity: 0.9 }}>x {cards.length}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {cards.map((c, idx) => (
            <CardImg key={`${name}:${c}:${idx}`} cardId={c} width={86} />
          ))}
        </div>
      )}
    </div>
  );
}

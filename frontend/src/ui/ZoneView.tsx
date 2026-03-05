import Card from "./Card";

type ZoneViewProps = {
  name: string;
  cards: string[];
  mode?: "front" | "stack-facedown" | "auto";
};

export default function ZoneView({ name, cards, mode = "auto" }: ZoneViewProps) {
  const isStack =
    mode === "stack-facedown" ||
    (mode === "auto" &&
      (name.endsWith(".scum") || name.endsWith(".vengeance") || name.includes("draw_pile")));

  return (
    <div style={{ border: "1px solid #333", borderRadius: 12, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>{name}</div>
        <div style={{ opacity: 0.8 }}>({cards.length})</div>
      </div>

      {cards.length === 0 ? (
        <div style={{ opacity: 0.6 }}>— empty —</div>
      ) : isStack ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Card cardId="BACK" faceDown width={86} title={`${cards.length} cards`} />
          <div style={{ fontSize: 14, opacity: 0.9 }}>x {cards.length}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {cards.map((c) => (
            <Card key={c + Math.random()} cardId={c} width={86} />
          ))}
        </div>
      )}
    </div>
  );
}
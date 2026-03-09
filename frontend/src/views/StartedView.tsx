import type { ActionResponse, View } from "../api/types";
import ZonePanel from "../components/ZonePanel";
import type { MetaAny, Zones } from "./types";

type StartedViewProps = {
  resp: ActionResponse;
  view: View;
};

export default function StartedView({ resp, view }: StartedViewProps) {
  const state = (resp.state as any) ?? {};
  const zones: Zones = state.zones ?? {};
  const meta: MetaAny = state.meta ?? {};
  const sceneMeta = meta.scene ?? {};
  const playersMeta = meta.players ?? {};

  const zoneEntries = Object.entries(zones).sort(([a], [b]) => a.localeCompare(b));

  const groupedZones = {
    players: zoneEntries.filter(([k]) => k.startsWith("players.")),
    scene: zoneEntries.filter(([k]) => k.startsWith("scene.")),
    setup: zoneEntries.filter(([k]) => k.startsWith("setup.")),
    other: zoneEntries.filter(
      ([k]) => !k.startsWith("players.") && !k.startsWith("scene.") && !k.startsWith("setup.")
    ),
  };

  return (
    <>
      <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div><b>phase:</b> {meta.phase ?? "-"}</div>
        <div><b>dark_mode:</b> {sceneMeta?.dark_mode ? "ON" : "off"}</div>
        <div>
          <b>difficulty:</b> {sceneMeta?.difficulty_value ?? "-"}{" "}
          <span style={{ opacity: 0.7 }}>({sceneMeta?.difficulty_rule ?? "-"})</span>
        </div>
      </div>

      {playersMeta && Object.keys(playersMeta).length > 0 && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Players</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {Object.entries(playersMeta).map(([pid, info]: any) => (
              <div key={pid} style={{ padding: 8, border: "1px solid #ccc", borderRadius: 10 }}>
                <div style={{ fontWeight: 700 }}>{pid}</div>
                <div style={{ opacity: 0.85, fontSize: 14 }}>
                  reward_points: {info?.reward_points ?? 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Started Game</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {groupedZones.scene.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Scene</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {groupedZones.scene.map(([name, cards]) => (
                  <ZonePanel key={name} name={name} cards={cards} view={view} />
                ))}
              </div>
            </div>
          )}

          {groupedZones.players.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Players</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {groupedZones.players.map(([name, cards]) => (
                  <ZonePanel key={name} name={name} cards={cards} view={view} />
                ))}
              </div>
            </div>
          )}

          {groupedZones.setup.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Setup</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {groupedZones.setup.map(([name, cards]) => (
                  <ZonePanel key={name} name={name} cards={cards} view={view} />
                ))}
              </div>
            </div>
          )}

          {groupedZones.other.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Other</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {groupedZones.other.map(([name, cards]) => (
                  <ZonePanel key={name} name={name} cards={cards} view={view} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

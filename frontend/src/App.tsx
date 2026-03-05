import { useMemo, useState } from "react";
import { newGame, gfAction, getGame } from "./api/gf";
import type { ActionResponse, View } from "./api/types";

function CardImg({
  cardId,
  faceDown = false,
  width = 86,
  title,
}: {
  cardId: string;
  faceDown?: boolean;
  width?: number;
  title?: string;
}) {
  const src = faceDown
    ? "/assets/cards/back/back.jpg"
    : `/assets/cards/front/${cardId}.jpg`;

  return (
    <img
      src={src}
      alt={faceDown ? "Card back" : cardId}
      title={title ?? (faceDown ? "Face-down" : cardId)}
      style={{
        width,
        height: "auto",
        borderRadius: 10,
        boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
        border: "1px solid rgba(0,0,0,0.2)",
      }}
      onError={(e) => {
        // hide broken images, but keep layout stable
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function ZonePanel({
  name,
  cards,
  view,
}: {
  name: string;
  cards: string[];
  view: View;
}) {
  const isSecretPile =
    name.endsWith(".scum") || name.endsWith(".vengeance");

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

export default function App() {
  const [view, setView] = useState<View>("public");
  const [gameId, setGameId] = useState("");
  const [resp, setResp] = useState<ActionResponse | null>(null);

  async function run(p: Promise<ActionResponse>) {
    try {
      const r = await p;
      setResp(r);
      if (!r.error && r.game_id) setGameId(r.game_id);
    } catch (e: any) {
      setResp({
        game_id: gameId,
        revision: 0,
        state: {},
        events: [],
        result: {},
        error: {
          code: "CLIENT_FETCH_ERROR",
          message: e?.message ?? String(e),
          details: null,
        },
      });
    }
  }

  const zones = useMemo(() => {
    const z = (resp?.state as any)?.zones ?? {};
    return Object.entries(z) as Array<[string, string[]]>;
  }, [resp]);

  const groupedZones = useMemo(() => {
    const players: Array<[string, string[]]> = [];
    const scene: Array<[string, string[]]> = [];
    const setup: Array<[string, string[]]> = [];
    const other: Array<[string, string[]]> = [];

    for (const [k, v] of zones) {
      if (k.startsWith("players.")) players.push([k, v]);
      else if (k.startsWith("scene.")) scene.push([k, v]);
      else if (k.startsWith("setup.")) setup.push([k, v]);
      else other.push([k, v]);
    }

    const sort = (a: [string, string[]], b: [string, string[]]) =>
      a[0].localeCompare(b[0]);

    players.sort(sort);
    scene.sort(sort);
    setup.sort(sort);
    other.sort(sort);

    return { players, scene, setup, other };
  }, [zones]);

  const meta = (resp?.state as any)?.meta ?? {};
  const sceneMeta = meta?.scene ?? {};
  const playersMeta = meta?.players ?? {};

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Grim Fronteira — Frontend Scaffold</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          View:&nbsp;
          <select value={view} onChange={(e) => setView(e.target.value as View)}>
            <option value="public">public</option>
            <option value="debug">debug</option>
          </select>
        </label>

        <button
          onClick={() =>
            run(
              newGame({
                template_path: "data/templates/standard_54.json",
                seed: 78,
                view,
              })
            )
          }
        >
          New Game
        </button>

        <button
          disabled={!gameId}
          onClick={() =>
            run(
              gfAction({
                game_id: gameId,
                action: "gf.get_state",
                params: {},
                view,
              })
            )
          }
        >
          Action: get_state
        </button>

        <button
          disabled={!gameId}
          onClick={() =>
            run(
              gfAction({
                game_id: gameId,
                action: "gf.setup_players",
                params: {
                  player_ids: ["p1", "p2"],
                  shuffle_face_pile_first: true,
                  face_shuffle_seed: 123,
                },
                view,
              })
            )
          }
        >
          Action: setup_players
        </button>

        <button
          disabled={!gameId}
          onClick={() =>
            run(
              gfAction({
                game_id: gameId,
                action: "gf.roll_difficulty",
                params: { player_ids: ["p1", "p2"], seed: 999 },
                view,
              })
            )
          }
        >
          Action: roll_difficulty
        </button>

        <button disabled={!gameId} onClick={() => run(getGame(gameId, view))}>
          GET /api/game/:id
        </button>

        <input
          style={{ width: 420 }}
          placeholder="game_id"
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
        />
      </div>

      {resp?.error && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #c00", borderRadius: 10 }}>
          <b>Error:</b> {resp.error.code} — {resp.error.message}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div><b>revision:</b> {resp?.revision ?? "-"}</div>
        <div><b>game_id:</b> {resp?.game_id ?? "-"}</div>
        <div>
          <b>dark_mode:</b>{" "}
          {sceneMeta?.dark_mode ? "ON" : "off"}
        </div>
        <div>
          <b>difficulty:</b>{" "}
          {sceneMeta?.difficulty_value ?? "-"}{" "}
          <span style={{ opacity: 0.7 }}>
            ({sceneMeta?.difficulty_rule ?? "-"})
          </span>
        </div>
      </div>

      {/* Players meta (reward points) */}
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

      {/* Zones board */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Zones</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Scene */}
          <div style={{ gridColumn: "1 / -1" }}>
            {groupedZones.scene.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Scene</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {groupedZones.scene.map(([name, cards]) => (
                    <ZonePanel key={name} name={name} cards={cards} view={view} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Setup */}
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

          {/* Players */}
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

          {/* Other */}
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

      {/* Raw protocol dump stays useful */}
      <pre style={{ marginTop: 14, padding: 12, border: "1px solid #ddd", overflowX: "auto" }}>
        {resp ? JSON.stringify(resp, null, 2) : "No state yet."}
      </pre>
    </div>
  );
}
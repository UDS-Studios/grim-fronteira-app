import { useState } from "react";
import { newGame, gfAction, getGame } from "./api/gf";
import type { ActionResponse, View } from "./api/types";

export default function App() {
  const [view, setView] = useState<View>("public");
  const [gameId, setGameId] = useState("");
  const [resp, setResp] = useState<ActionResponse | null>(null);

  async function run(p: Promise<ActionResponse>) {
    const r = await p;
    setResp(r);
    if (!r.error && r.game_id) setGameId(r.game_id);
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Grim Fronteira — Frontend Scaffold</h1>

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
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #c00" }}>
          <b>Error:</b> {resp.error.code} — {resp.error.message}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div><b>revision:</b> {resp?.revision ?? "-"}</div>
        <div><b>game_id:</b> {resp?.game_id ?? "-"}</div>
      </div>

      <pre style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", overflowX: "auto" }}>
        {resp ? JSON.stringify(resp.state, null, 2) : "No state yet."}
      </pre>
    </div>
  );
}
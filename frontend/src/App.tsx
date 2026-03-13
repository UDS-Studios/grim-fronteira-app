import { useEffect, useState } from "react";
import { newGame, getGame, gfAction } from "./api/gf";
import type { ActionResponse, View } from "./api/types";
import { getFreshPlayerId, getOrCreateClientId } from "./utils/identity";
import ErrorView from "./views/ErrorView";
import HomeView from "./views/HomeView";
import LobbyView from "./views/LobbyView";
import StartedView from "./views/StartedView";
import type { MetaAny } from "./views/types";

export default function App() {
  const [view, setView] = useState<View>("public");
  const [gameId, setGameId] = useState("");
  const [resp, setResp] = useState<ActionResponse | null>(null);

  const [currentActorId, setCurrentActorId] = useState("");
  const [joinPlayerId, setJoinPlayerId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [claimCardId, setClaimCardId] = useState("");
  const [joinGameId, setJoinGameId] = useState("");
  const [screen, setScreen] = useState<"home" | "game" | "error">("home");

  useEffect(() => {
    const id = getOrCreateClientId();
    setCurrentActorId(id);
    setSelectedPlayerId(id);
  }, []);

  useEffect(() => {
    if (screen !== "game" || !gameId) return;

    let cancelled = false;

    const sync = async () => {
      try {
        const r = await getGame(gameId, view);
        if (cancelled) return;

        if (!r.error) {
          setResp(r);
        }
      } catch {
        // ignore transient polling failures for now
      }
    };

    // initial sync immediately
    sync();

    const id = window.setInterval(sync, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [screen, gameId, view]);

  async function run(p: Promise<ActionResponse>): Promise<ActionResponse> {
    try {
      const r = await p;
      setResp(r);
      if (!r.error && r.game_id) {
        setGameId(r.game_id);
        setScreen("game");
      } else if (r.error) {
        console.error("API action error:", r);
        // stay on the current screen so we can inspect the real error
      }
      return r;
    } catch (e: any) {
      const errResp: ActionResponse = {
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
      };
      setResp(errResp);
      setScreen("error");
      return errResp;
    }
  }

  const state = (resp?.state as any) ?? {};
  const meta: MetaAny = state.meta ?? {};
  const phase = meta.phase ?? "no-game";

  return (
    <div
      style={{
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        background: "#efe3c2",
        minHeight: "100vh",
      }}
    >
      {screen === "home" && (
        <HomeView
          joinGameId={joinGameId}
          setJoinGameId={setJoinGameId}
          onNewGame={() =>
            run(
              newGame({
                creator_id: currentActorId,
                template_path: "data/templates/standard_54.json",
                seed: 42,
                view,
              })
            )
          }
          onJoinGame={async () => {
            const r = await run(getGame(joinGameId, view));
            if (r.error) return;

            const freshPlayerId = getFreshPlayerId();

            const joinResp = await run(
              gfAction({
                game_id: r.game_id,
                action: "gf.join_lobby",
                params: { player_id: freshPlayerId },
                view,
              })
            );
            if (joinResp.error) return;

            setCurrentActorId(freshPlayerId);
            setSelectedPlayerId(freshPlayerId);
          }}
        />
      )}

      {screen === "error" && resp && (
        <ErrorView
          error={resp}
          onBackHome={() => {
            setResp(null);
            setGameId("");
            setJoinGameId("");
            setScreen("home");
          }}
        />
      )}

      {screen === "game" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label>
              View:&nbsp;
              <select value={view} onChange={(e) => setView(e.target.value as View)}>
                <option value="public">public</option>
                <option value="debug">debug</option>
              </select>
            </label>

            <button onClick={() => setScreen("home")}>Home</button>

            <button disabled={!gameId} onClick={() => run(getGame(gameId, view))}>
              Refresh
            </button>

            <input
              style={{ width: 360 }}
              placeholder="game_id"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
            />
          </div>

          {resp?.error && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid #c00",
                borderRadius: 10,
                background: "#fff4f4",
              }}
            >
              <b>Error:</b> {resp.error.code} — {resp.error.message}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div><b>revision:</b> {resp?.revision ?? "-"}</div>
            <div><b>game_id:</b> {resp?.game_id ?? "-"}</div>
            <div><b>phase:</b> {phase}</div>
          </div>

          {resp && phase === "lobby" && (
            <LobbyView
              resp={resp}
              view={view}
              currentActorId={currentActorId}
              joinPlayerId={joinPlayerId}
              setJoinPlayerId={setJoinPlayerId}
              selectedPlayerId={selectedPlayerId}
              setSelectedPlayerId={setSelectedPlayerId}
              claimCardId={claimCardId}
              setClaimCardId={setClaimCardId}
              run={run}
              setResp={setResp}
              onBackHome={() => {
                setResp(null);
                setGameId("");
                setJoinGameId("");
                setScreen("home");
              }}
            />
          )}

          {resp && phase === "started" && <StartedView resp={resp} view={view} />}

          <pre
            style={{
              marginTop: 14,
              padding: 12,
              border: "1px solid #ddd",
              overflowX: "auto",
              background: "#fff",
            }}
          >
            {resp ? JSON.stringify(resp, null, 2) : "No state yet."}
          </pre>
        </>
      )}
    </div>
  );
}

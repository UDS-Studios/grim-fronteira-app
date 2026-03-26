import { useEffect, useState } from "react";
import { newGame, getGame, gfAction } from "./api/gf";
import type { ActionResponse, View } from "./api/types";
import { getFreshPlayerId, getOrCreateClientId } from "./utils/identity";
import ErrorView from "./views/ErrorView";
import HomeView from "./views/HomeView";
import LobbyView from "./views/LobbyView";
import HookSelectionView from "./views/HookSelectionView";
import RegistrationClosedView from "./views/RegistrationClosedView";
import TableRouterView from "./views/TableRouterView";
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
  const [screen, setScreen] = useState<"home" | "game" | "error" | "registration-closed">("home");
  const [closedGameId, setClosedGameId] = useState("");
  const [closedMarshalId, setClosedMarshalId] = useState("");

  useEffect(() => {
    const id = getOrCreateClientId();
    setCurrentActorId(id);
    setSelectedPlayerId(id);
  }, []);

  useEffect(() => {
    if (screen !== "game" || !gameId) return;

    let cancelled = false;

    const resetToHome = () => {
      setResp(null);
      setGameId("");
      setJoinGameId("");
      setScreen("home");
    };

    const sync = async () => {
      try {
        const r = await getGame(gameId, view);
        if (cancelled) return;

        if (!r.error) {
          setResp(r);
          return;
        }

        if (r.error.code === "HTTP_404") {
          resetToHome();
        }
      } catch {
        // ignore transient polling failures for now
      }
    };

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
  const viewportHeight = "calc(100vh - 32px)";
  const useScrollableGameContent = phase === "lobby";
  const useFixedGameViewport = phase === "lobby";

  return (
    <div
      style={{
        padding: 16,
        boxSizing: "border-box",
        fontFamily: "system-ui, sans-serif",
        background: "var(--app-bg)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {screen === "home" && (
        <div
          style={{
            height: viewportHeight,
            minHeight: 0,
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
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

              const loadedMeta = ((r.state as any)?.meta ?? {}) as MetaAny;
              const lobby = loadedMeta.lobby ?? {};
              const marshalId = loadedMeta.marshal_id ?? "";

              if (!lobby.registration_open) {
                setClosedGameId(r.game_id);
                setClosedMarshalId(marshalId);
                setScreen("registration-closed");
                return;
              }

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
        </div>
      )}

      {screen === "registration-closed" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <RegistrationClosedView
            gameId={closedGameId}
            marshalId={closedMarshalId}
            onBackHome={() => {
              setResp(null);
              setGameId("");
              setJoinGameId("");
              setClosedGameId("");
              setClosedMarshalId("");
              setScreen("home");
            }}
          />
        </div>
      )}

      {screen === "error" && resp && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <ErrorView
            error={resp}
            onBackHome={() => {
              setResp(null);
              setGameId("");
              setJoinGameId("");
              setScreen("home");
            }}
          />
        </div>
      )}

      {screen === "game" && (
        <div
          style={{
            height: useFixedGameViewport ? viewportHeight : undefined,
            minHeight: viewportHeight,
            display: "flex",
            flexDirection: "column",
            overflow: useFixedGameViewport ? "hidden" : "visible",
            flexShrink: 0,
          }}
        >
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
                border: "1px solid var(--danger-border)",
                borderRadius: 10,
                background: "var(--danger-bg)",
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

          <div
            style={{
              flex: useFixedGameViewport ? 1 : "0 0 auto",
              minHeight: 0,
              overflowY: useScrollableGameContent ? "auto" : "visible",
              overflowX: useFixedGameViewport ? "hidden" : "visible",
              display: "flex",
              flexDirection: "column",
            }}
          >
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

            {resp && phase === "hook_selection" && (
              <HookSelectionView
                resp={resp}
                view={view}
                currentActorId={currentActorId}
                run={run}
              />
            )}

            {resp && (phase === "started" || phase === "table") && (
              <TableRouterView
                resp={resp}
                view={view}
                currentActorId={currentActorId}
                run={run}
                onBackHome={() => {
                  setResp(null);
                  setGameId("");
                  setJoinGameId("");
                  setScreen("home");
                }}
              />
            )}
          </div>
        </div>
      )}

      {resp && screen !== "home" && (
        <pre
          style={{
            marginTop: 14,
            marginBottom: 0,
            padding: 12,
            border: "1px solid var(--border-muted)",
            overflow: "auto",
            background: "var(--surface-strong)",
            minHeight: 120,
          }}
        >
          {JSON.stringify(resp, null, 2)}
        </pre>
      )}
    </div>
  );
}

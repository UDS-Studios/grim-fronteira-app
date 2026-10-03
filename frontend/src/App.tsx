import { acceptResponse } from "./utils/responseOrdering";
import { useEffect, useState } from "react";
import { newGame, getGame, gfAction, reconnectGame } from "./api/gf";
import type { ActionResponse } from "./api/types";
import { getFreshPlayerId } from "./utils/identity";
import { getSessionView, type InspectionView } from "./utils/sessionView";
import { getGameEntryMode } from "./utils/reconnect";
import { loadSession, getReconnectToken, getActiveSession, getLastGame, setLastGame } from "./utils/session";
import ErrorView from "./views/ErrorView";
import HomeView from "./views/HomeView";
import LobbyView from "./views/LobbyView";
import HookSelectionView from "./views/HookSelectionView";
import RegistrationClosedView from "./views/RegistrationClosedView";
import TableRouterView from "./views/TableRouterView";
import VictoryView from "./views/VictoryView";
import type { MetaAny } from "./views/types";

export default function App() {
  const [inspectionView, setInspectionView] = useState<InspectionView>("public");
  const [gameId, setGameId] = useState(getLastGame);
  const [resp, setResp] = useState<ActionResponse | null>(null);

  const [currentActorId, setCurrentActorId] = useState(() => loadSession(getLastGame())?.player_id ?? getFreshPlayerId());
  const [joinPlayerId, setJoinPlayerId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState(currentActorId);
  const [claimCardId, setClaimCardId] = useState("");
  const [joinGameId, setJoinGameId] = useState("");
  const [screen, setScreen] = useState<"home" | "game" | "error" | "registration-closed">(() => getLastGame() ? "game" : "home");
  const [closedGameId, setClosedGameId] = useState("");

  const seat = loadSession(gameId);
  const { view, viewer_id: viewerId } = seat && seat.player_id === currentActorId
    ? { view: seat.role, viewer_id: seat.player_id }
    : getSessionView({}, "", inspectionView);

  useEffect(() => {
    if (screen !== "game" || !gameId) return;

    let cancelled = false;

    const resetToHome = () => {
      setResp(null);
      setGameId("");
      setLastGame("");
      setJoinGameId("");
      setScreen("home");
    };

    const sync = async () => {
      try {
        const r = await getGame(gameId, view, viewerId);
        if (cancelled) return;

        if (!r.error) {
          setResp(current => acceptResponse(current, r));
          return;
        }

        if (["SESSION_REQUIRED", "SESSION_INVALID", "SESSION_REPLACED", "ACTOR_MISMATCH", "VIEWER_MISMATCH", "RECONNECT_INVALID"].includes(r.error.code)) {
          setResp(r);
          setScreen("error");
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
  }, [screen, gameId, view, viewerId]);

  async function run(p: Promise<ActionResponse>): Promise<ActionResponse> {
    try {
      const r = await p;
      setResp(current => acceptResponse(current, r));
      if (!r.error && r.game_id) {
        const seat = loadSession(r.game_id);
        if (seat) {
          setCurrentActorId(seat.player_id);
          setSelectedPlayerId(seat.player_id);
        }
        setLastGame(r.game_id);
        setGameId(r.game_id);
        setScreen("game");
      } else if (r.error) {
        console.error("API action error:", r.error.code);
        // stay on the current screen so we can inspect the real error
      }
      return r;
    } catch (e: unknown) {
      const errResp: ActionResponse = {
        game_id: gameId,
        revision: 0,
        state: {},
        events: [],
        result: {},
        error: {
          code: "CLIENT_FETCH_ERROR",
          message: e instanceof Error ? e.message : String(e),
          details: null,
        },
      };
      setResp(errResp);
      setScreen("error");
      return errResp;
    }
  }

  const state = resp?.state ?? {};
  const meta: MetaAny = state.meta ?? {};
  const zones = state.zones ?? {};
  const phase = meta.phase ?? "no-game";
  const victoryWinnerId = meta.victory?.winner ?? null;
  const victoryWinnerFigureCardId =
    typeof victoryWinnerId === "string" && victoryWinnerId !== "marshal"
      ? (zones[`players.${victoryWinnerId}.character`]?.[0] ?? null)
      : null;
  const showMarshalVictoryPortrait = victoryWinnerId === "marshal";
  const viewportHeight = "calc(100dvh - 32px)";
  const isTable = screen === "game" && (phase === "started" || phase === "table");
  const useScrollableGameContent = phase === "lobby";
  const useFixedGameViewport = phase === "lobby" || isTable;

  return (
    <div
      style={{
        padding: isTable ? 8 : 16,
        height: isTable ? "100dvh" : undefined,
        overflow: isTable ? "hidden" : undefined,
        boxSizing: "border-box",
        fontFamily: "system-ui, sans-serif",
        background: "var(--app-bg)",
        minHeight: "100dvh",
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
                  // No authoritative role exists yet; the response establishes the Marshal session.
                  view: inspectionView,
                })
              )
            }
            onJoinGame={async () => {
              let entryMode: ReturnType<typeof getGameEntryMode> | undefined;
              const response = await run((async () => {
                // Discover identity/routing without entering gameplay on this public response.
                const loaded = await getGame(joinGameId, "public");
                if (loaded.error) return loaded;
                const loadedMeta = loaded.state.meta ?? {};
                const stored = loadSession(loaded.game_id);
                const hasCredential = getActiveSession(loaded.game_id) || getReconnectToken(loaded.game_id);
                entryMode = hasCredential && stored ? "reconnect" : getGameEntryMode(loadedMeta, "");
                if (entryMode === "closed") return loaded;
                if (entryMode === "reconnect") {
                  if (!getActiveSession(loaded.game_id)) return reconnectGame(loaded.game_id);
                  const session = { view: stored!.role, viewer_id: stored!.player_id };
                  return getGame(loaded.game_id, session.view, session.viewer_id);
                }

                const freshPlayerId = getFreshPlayerId();
                const joined = await gfAction({
                  game_id: loaded.game_id,
                  action: "gf.join_lobby",
                  params: { player_id: freshPlayerId },
                  view: "player",
                  viewer_id: freshPlayerId,
                });
                if (!joined.error) {
                  setCurrentActorId(freshPlayerId);
                  setSelectedPlayerId(freshPlayerId);
                }
                return joined;
              })());
              if (!response.error && entryMode === "closed") {
                setClosedGameId(response.game_id);
                setScreen("registration-closed");
              }
            }}
          />
        </div>
      )}

      {screen === "registration-closed" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <RegistrationClosedView
            gameId={closedGameId}
            onBackHome={() => {
              setResp(null);
              setGameId("");
              setLastGame("");
              setJoinGameId("");
              setClosedGameId("");
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
              setLastGame("");
              setJoinGameId("");
              setScreen("home");
            }}
          />
        </div>
      )}

      {screen === "game" && (
        <div
          style={{
            height: isTable ? "100%" : useFixedGameViewport ? viewportHeight : undefined,
            minHeight: isTable ? 0 : viewportHeight,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: useFixedGameViewport ? "hidden" : "visible",
            flexShrink: 0,
          }}
        >
          <div className={isTable ? "table-dev-controls" : undefined} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
            <label>
              Non-player inspection:&nbsp;
              <select value={inspectionView} disabled={view === "player" || view === "marshal"} onChange={(e) => {
                if (e.target.value === "public" || e.target.value === "debug") setInspectionView(e.target.value);
              }}>
                <option value="public">public</option>
                <option value="debug">debug</option>
              </select>
            </label>

            <button onClick={() => setScreen("home")}>Home</button>

            <button disabled={!gameId} onClick={() => run(getGame(gameId, view, viewerId))}>
              Refresh
            </button>

            <input
              style={{ width: 360, maxWidth: "100%", minWidth: 0 }}
              placeholder="game_id"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
            />
            {isTable && <details className="table-debug">
              <summary>State JSON</summary>
              <pre>{JSON.stringify(resp, null, 2)}</pre>
            </details>}
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

          <div style={{ marginTop: isTable ? 4 : 12, display: "flex", gap: 16, flexWrap: "wrap", flexShrink: 0, fontSize: isTable ? 12 : undefined }}>
            <div><b>revision:</b> {resp?.revision ?? "-"}</div>
            <div><b>game_id:</b> {resp?.game_id ?? "-"}</div>
            <div><b>phase:</b> {phase}</div>
          </div>

          <div
            style={{
              flex: useFixedGameViewport ? 1 : "0 0 auto",
              minHeight: 0,
              minWidth: 0,
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
                  setLastGame("");
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
                  setLastGame("");
                  setJoinGameId("");
                  setScreen("home");
                }}
              />
            )}

            {resp && phase === "victory" && (
              <VictoryView
                winnerLabel={meta.victory?.winner_label ?? "Marshal"}
                winnerFigureCardId={victoryWinnerFigureCardId}
                showMarshalPortrait={showMarshalVictoryPortrait}
                reason={meta.victory?.reason ?? null}
                onBackHome={() => {
                  setResp(null);
                  setGameId("");
                  setLastGame("");
                  setJoinGameId("");
                  setScreen("home");
                }}
              />
            )}
          </div>
        </div>
      )}

      {resp && screen !== "home" && !isTable && (
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

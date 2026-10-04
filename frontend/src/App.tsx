import SessionPauseBanner from "./components/SessionPauseBanner";
import { acceptResponse } from "./utils/responseOrdering";
import { useEffect, useRef, useState } from "react";
import { newGame, getGame, gfAction, reconnectGame, takeoverGame } from "./api/gf";
import type { ActionResponse } from "./api/types";
import { getFreshPlayerId } from "./utils/identity";
import { getSessionView, type InspectionView } from "./utils/sessionView";
import { getGameEntryMode, getRecoveryReason, normalizeGameId, type RecoveryReason } from "./utils/reconnect";
import { loadSession, clearActiveSession, getReconnectToken, getActiveSession, getLastGame, setLastGame } from "./utils/session";
import SessionRecoveryView from "./views/SessionRecoveryView";
import ErrorView from "./views/ErrorView";
import HomeView from "./views/HomeView";
import LobbyView from "./views/LobbyView";
import HookSelectionView from "./views/HookSelectionView";
import RegistrationClosedView from "./views/RegistrationClosedView";
import TableRouterView from "./views/TableRouterView";
import VictoryView from "./views/VictoryView";
import type { MetaAny } from "./views/types";

export default function App() {
  const [pauseNotice, setPauseNotice] = useState<string | null>(null);
  const [inspectionView, setInspectionView] = useState<InspectionView>("public");
  const [gameId, setGameId] = useState(getLastGame);
  const [resp, setResp] = useState<ActionResponse | null>(null);

  const [currentActorId, setCurrentActorId] = useState(() => loadSession(getLastGame())?.player_id ?? getFreshPlayerId());
  const [joinPlayerId, setJoinPlayerId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState(currentActorId);
  const [claimCardId, setClaimCardId] = useState("");
  const [joinGameId, setJoinGameId] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [screen, setScreen] = useState<"home" | "game" | "error" | "registration-closed" | "recovery">(() => getLastGame() ? "game" : "home");
  const [closedGameId, setClosedGameId] = useState("");
  const [recovery, setRecovery] = useState<{ reason: RecoveryReason; gameId: string } | null>(null);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const takeoverInFlight = useRef(false);
  // Invalidate responses from the gameplay screen after recovery or navigation.
  const responseEpoch = useRef(0);

  function backHome() {
    clearActiveSession(recovery?.gameId || gameId);
    resetToHome();
  }

  function resetToHome() {
    responseEpoch.current++;
    setJoinError(null);
    setGameId("");
    setLastGame("");
    setJoinGameId("");
    setResp(null);
    setRecovery(null);
    setClosedGameId("");
    setRecoveryError(null);
    setScreen("home");
  }

  function enterRecovery(reason: RecoveryReason, targetGame: string) {
    responseEpoch.current++;
    setRecovery({ reason, gameId: targetGame });
    setRecoveryError(null);
    setScreen("recovery");
  }

  function restoreGame(r: ActionResponse) {
    const restored = loadSession(r.game_id);
    if (restored) {
      setCurrentActorId(restored.player_id);
      setSelectedPlayerId(restored.player_id);
    }
    setPauseNotice(null);
    setResp(current => acceptResponse(current, r));
    setLastGame(r.game_id);
    setGameId(r.game_id);
    setRecovery(null);
    setScreen("game");
  }

  async function takeOver() {
    if (!recovery || takeoverInFlight.current) return;
    takeoverInFlight.current = true;
    setTakeoverBusy(true);
    setRecoveryError(null);
    const epoch = responseEpoch.current;
    try {
      const r = await takeoverGame(recovery.gameId);
      if (epoch !== responseEpoch.current) return;
      if (!r.error) restoreGame(r);
      else {
        const reason = getRecoveryReason(r.error.code);
        if (reason) enterRecovery(reason, recovery.gameId);
        setRecoveryError("Unable to take over this seat. Please try again or return home.");
      }
    } catch {
      if (epoch === responseEpoch.current) setRecoveryError("Unable to connect. Please try again or return home.");
    } finally {
      takeoverInFlight.current = false;
      setTakeoverBusy(false);
    }
  }

  const seat = loadSession(gameId);
  const { view, viewer_id: viewerId } = seat && seat.player_id === currentActorId
    ? { view: seat.role, viewer_id: seat.player_id }
    : getSessionView({}, "", inspectionView);

  useEffect(() => {
    if (screen !== "game" || !gameId) return;

    let cancelled = false;
    const epoch = responseEpoch.current;

    const sync = async () => {
      if (cancelled || epoch !== responseEpoch.current) return;
      try {
        const r = await (getReconnectToken(gameId) && !getActiveSession(gameId)
          ? reconnectGame(gameId) : getGame(gameId, view, viewerId));
        if (cancelled || epoch !== responseEpoch.current) return;

        if (!r.error) {
          setPauseNotice(null);
          setResp(current => acceptResponse(current, r));
          return;
        }

        const reason = getRecoveryReason(r.error.code);
        if (reason) {
          cancelled = true; // Stop even before React cleans up the interval.
          enterRecovery(reason, gameId);
          return;
        }

        if (["SESSION_REQUIRED", "SESSION_INVALID", "ACTOR_MISMATCH", "VIEWER_MISMATCH"].includes(r.error.code)) {
          setResp(r);
          setScreen("error");
        }
        if (r.error.code === "HTTP_404") {
          clearActiveSession(gameId);
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

  async function run(p: Promise<ActionResponse>, targetGameId = gameId): Promise<ActionResponse> {
    const epoch = responseEpoch.current;
    try {
      const r = await p;
      if (epoch !== responseEpoch.current) return r;
      const reason = getRecoveryReason(r.error?.code);
      if (reason) {
        enterRecovery(reason, r.game_id || targetGameId);
        return r;
      }
      if (r.error?.code === "HTTP_404" && screen === "home") {
        setJoinError("Game not found.");
        return r;
      }
      if (r.error?.code === "GAME_PAUSED") {
        setPauseNotice(r.error.message);
        return r; // Empty rejection state must never replace the valid projection.
      }
      setPauseNotice(null);
      if (!r.error && r.game_id) {
        restoreGame(r);
      } else if (r.error) {
        setResp(current => acceptResponse(current, r));
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
      if (epoch !== responseEpoch.current) return errResp;
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
            joinError={joinError}
            setJoinGameId={value => { setJoinGameId(value); setJoinError(null); }}
            onNewGame={() => {
              setJoinError(null);
              return run(
                newGame({
                  creator_id: currentActorId,
                  template_path: "data/templates/standard_54.json",
                  // No authoritative role exists yet; the response establishes the Marshal session.
                  view: inspectionView,
                })
              );
            }}
            onJoinGame={async () => {
              const targetGameId = normalizeGameId(joinGameId);
              if (!targetGameId) {
                setJoinError("Invalid game ID. Please enter the complete game ID.");
                return;
              }
              setJoinError(null);
              let entryMode: ReturnType<typeof getGameEntryMode> | undefined;
              const response = await run((async () => {
                // Discover identity/routing without entering gameplay on this public response.
                const loaded = await getGame(targetGameId, "public");
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
              })(), targetGameId);
              if (!response.error && entryMode === "closed") {
                setClosedGameId(response.game_id);
                setScreen("registration-closed");
              }
            }}
          />
        </div>
      )}

      {screen === "recovery" && recovery && (
        <SessionRecoveryView reason={recovery.reason} gameId={recovery.gameId}
          onTakeOver={takeOver} onBackHome={backHome} busy={takeoverBusy} errorMessage={recoveryError} />
      )}

      {screen === "registration-closed" && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <RegistrationClosedView
            gameId={closedGameId}
            onBackHome={backHome}
          />
        </div>
      )}

      {screen === "error" && resp && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <ErrorView
            error={resp}
            onBackHome={backHome}
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

            <button onClick={backHome}>Home</button>

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

          {pauseNotice && <div role="status">{pauseNotice}</div>}
          {view === "player" && !isTable && phase !== "lobby" && <SessionPauseBanner meta={meta} />}

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
                onBackHome={backHome}
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
                onBackHome={backHome}
              />
            )}

            {resp && phase === "victory" && (
              <VictoryView
                winnerLabel={meta.victory?.winner_label ?? "Marshal"}
                winnerFigureCardId={victoryWinnerFigureCardId}
                showMarshalPortrait={showMarshalVictoryPortrait}
                reason={meta.victory?.reason ?? null}
                onBackHome={backHome}
              />
            )}
          </div>
        </div>
      )}

      {resp && screen !== "home" && screen !== "recovery" && !isTable && (
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

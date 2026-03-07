import { useEffect, useState } from "react";
import { newGame, gfAction, getGame } from "./api/gf";
import type { ActionResponse, View } from "./api/types";

type MetaAny = Record<string, any>;
type Zones = Record<string, string[]>;

function getOrCreateClientId(): string {
  const key = "gf_client_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = `player-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(key, id);
  return id;
}

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
        background: "#fff",
      }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: 14,
        padding: 14,
        background: "#faf8f2",
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
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

function StartedView({
  resp,
  view,
}: {
  resp: ActionResponse;
  view: View;
}) {
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

function LobbyView({
  resp,
  view,
  actorId,
  setActorId,
  joinPlayerId,
  setJoinPlayerId,
  selectedPlayerId,
  setSelectedPlayerId,
  claimCardId,
  setClaimCardId,
  run,
  setResp,
}: {
  resp: ActionResponse;
  view: View;
  actorId: string;
  setActorId: (v: string) => void;
  joinPlayerId: string;
  setJoinPlayerId: (v: string) => void;
  selectedPlayerId: string;
  setSelectedPlayerId: (v: string) => void;
  claimCardId: string;
  setClaimCardId: (v: string) => void;
  run: (p: Promise<ActionResponse>) => Promise<void>;
  setResp: React.Dispatch<React.SetStateAction<ActionResponse | null>>;
}) {
  const state = (resp.state as any) ?? {};
  const meta: MetaAny = state.meta ?? {};
  const zones: Zones = state.zones ?? {};

  const marshalId = meta.marshal_id ?? "";
  const playersOrder: string[] = meta.players_order ?? [];
  const lobby = meta.lobby ?? {};
  const availableFigures: string[] = zones["lobby.figure_pool.available"] ?? [];
  const claimedFigures: Record<string, string> = lobby.claimed_figures ?? {};

  const effectiveActorId = actorId || marshalId || "host1";

  return (
    <>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
        <Section title="Saloon Status">
          <div><b>phase:</b> {meta.phase ?? "-"}</div>
          <div><b>marshal_id:</b> {marshalId || "-"}</div>
          <div><b>registration_open:</b> {String(lobby.registration_open)}</div>
          <div><b>game_started:</b> {String(lobby.game_started)}</div>
          <div><b>assignment_mode:</b> {lobby.character_assignment_mode ?? "-"}</div>
          <div><b>assignment_locked:</b> {String(lobby.character_assignment_locked)}</div>
          <div><b>available_figures_count:</b> {lobby.available_figures_count ?? availableFigures.length}</div>
        </Section>

        <Section title="Marshal Controls">
          <div style={{ display: "grid", gap: 10 }}>
            <label>
              Actor ID:&nbsp;
              <input
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                placeholder={marshalId || "host1"}
                style={{ width: 220 }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() =>
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.set_character_assignment_mode",
                      params: { actor_id: effectiveActorId, mode: "choice" },
                      view,
                    })
                  )
                }
              >
                Mode: choice
              </button>

              <button
                onClick={() =>
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.set_character_assignment_mode",
                      params: { actor_id: effectiveActorId, mode: "random" },
                      view,
                    })
                  )
                }
              >
                Mode: random
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() =>
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.set_registration_open",
                      params: { actor_id: effectiveActorId, is_open: true },
                      view,
                    })
                  )
                }
              >
                Open registration
              </button>

              <button
                onClick={() =>
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.set_registration_open",
                      params: { actor_id: effectiveActorId, is_open: false },
                      view,
                    })
                  )
                }
              >
                Close registration
              </button>
            </div>

            <button
              onClick={() =>
                run(
                  gfAction({
                    game_id: resp.game_id,
                    action: "gf.start_game",
                    params: { actor_id: effectiveActorId, seed: 999 },
                    view,
                  })
                )
              }
            >
              Start Game
            </button>
          </div>
        </Section>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Section title="Players in Saloon">
          <div style={{ display: "grid", gap: 10 }}>
            <div><b>players_order:</b> {playersOrder.length ? playersOrder.join(", ") : "—"}</div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={joinPlayerId}
                onChange={(e) => setJoinPlayerId(e.target.value)}
                placeholder="player_id"
                style={{ width: 180 }}
              />
              <button
                onClick={() =>
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.join_lobby",
                      params: { player_id: joinPlayerId },
                      view,
                    })
                  )
                }
                disabled={!joinPlayerId.trim()}
              >
                Join Lobby
              </button>
            </div>

            <div>
              <b>claimed figures:</b>
              <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                {Object.keys(claimedFigures).length === 0 ? (
                  <div style={{ opacity: 0.7 }}>— none yet —</div>
                ) : (
                  Object.entries(claimedFigures).map(([pid, fig]) => (
                    <div key={pid}>
                      {pid}: <b>{fig}</b>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Character Assignment">
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                placeholder="player_id"
                style={{ width: 160 }}
              />
              <input
                value={claimCardId}
                onChange={(e) => setClaimCardId(e.target.value.toUpperCase())}
                placeholder="card_id (e.g. QS)"
                style={{ width: 180 }}
              />
              <button
                onClick={() =>
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.claim_character",
                      params: { player_id: selectedPlayerId, card_id: claimCardId },
                      view,
                    })
                  )
                }
                disabled={
                  !selectedPlayerId.trim() ||
                  !claimCardId.trim() ||
                  lobby.character_assignment_mode !== "choice"
                }
              >
                Claim Character
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                placeholder="player_id"
                style={{ width: 160 }}
              />
              <button
                onClick={() =>
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.draw_character",
                      params: { player_id: selectedPlayerId, seed: 321 },
                      view,
                    })
                  )
                }
                disabled={
                  !selectedPlayerId.trim() ||
                  lobby.character_assignment_mode !== "random"
                }
              >
                Draw Character
              </button>
            </div>
          </div>
        </Section>
      </div>

      <div style={{ marginTop: 12 }}>
        <Section title="Available Figures">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {availableFigures.length === 0 ? (
              <div style={{ opacity: 0.7 }}>— no figures available —</div>
            ) : lobby.character_assignment_mode === "random" ? (
              availableFigures.map((_, idx) => (
                <button
                  key={`hidden-${idx}`}
                  type="button"
                  onClick={() => {
                    if (!selectedPlayerId.trim()) {
                      setResp({
                        game_id: resp.game_id,
                        revision: resp.revision,
                        state: resp.state,
                        events: [],
                        result: {},
                        error: {
                          code: "UI_MISSING_PLAYER",
                          message: "Set player_id before drawing a random character.",
                          details: null,
                        },
                      });
                      return;
                    }

                    run(
                      gfAction({
                        game_id: resp.game_id,
                        action: "gf.draw_character",
                        params: { player_id: selectedPlayerId, seed: 321 + idx },
                        view,
                      })
                    );
                  }}
                  style={{
                    border: "1px solid transparent",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                    borderRadius: 12,
                  }}
                  title={
                    selectedPlayerId.trim()
                      ? `Draw random character for ${selectedPlayerId}`
                      : "Set player_id before drawing"
                  }
                >
                  <CardImg
                    cardId="BACK"
                    faceDown
                    width={86}
                    title="Hidden figure"
                  />
                </button>
              ))
            ) : (
              availableFigures.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    if (!selectedPlayerId.trim()) {
                      setResp({
                        game_id: resp.game_id,
                        revision: resp.revision,
                        state: resp.state,
                        events: [],
                        result: {},
                        error: {
                          code: "UI_MISSING_PLAYER",
                          message: "Set player_id before claiming a character.",
                          details: null,
                        },
                      });
                      return;
                    }

                    setClaimCardId(c);

                    run(
                      gfAction({
                        game_id: resp.game_id,
                        action: "gf.claim_character",
                        params: { player_id: selectedPlayerId, card_id: c },
                        view,
                      })
                    );
                  }}
                  style={{
                    border: claimCardId === c ? "3px solid #8b5a2b" : "1px solid transparent",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                    borderRadius: 12,
                  }}
                  title={
                    selectedPlayerId.trim()
                      ? `Claim ${c} for ${selectedPlayerId}`
                      : `Set player_id before claiming ${c}`
                  }
                >
                  <CardImg cardId={c} width={86} />
                </button>
              ))
            )}
          </div>
        </Section>
      </div>

      <div style={{ marginTop: 12 }}>
        <Section title="Current Player Zones">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {Object.entries(zones)
              .filter(([name]) => name.startsWith("players."))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, cards]) => (
                <ZonePanel key={name} name={name} cards={cards} view={view} />
              ))}
          </div>
        </Section>
      </div>
    </>
  );
}

function HomeView({
  joinGameId,
  setJoinGameId,
  onNewGame,
  onJoinGame,
}: {
  joinGameId: string;
  setJoinGameId: (v: string) => void;
  onNewGame: () => void;
  onJoinGame: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#faf8f2",
          border: "1px solid #333",
          borderRadius: 16,
          padding: 24,
          minWidth: 760,
          display: "grid",
          gap: 22,
        }}
      >
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "LavaArabic, serif",
            fontSize: "4.4em",
            letterSpacing: "0.05em",
            lineHeight: 1,
          }}
        >
          Grim Fronteira
        </h1>

        <div
          style={{
            marginTop: 8,
            fontSize: "1.2em",
            letterSpacing: "0.12em",
            opacity: 0.85,
            fontStyle: "italic",
          }}
        >
          The Frontier is Waiting...
        </div>
      </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 28,
            alignItems: "start",
          }}
        >
          <button
            onClick={onNewGame}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              justifySelf: "center",
            }}
            title="Create a new game"
          >
            <img
              src="/ui/new-game.png"
              alt="New Game"
              style={{
                width: 260,
                height: "auto",
                display: "block",
              }}
            />
          </button>

          <div
            style={{
              display: "grid",
              gap: 10,
              justifyItems: "center",
            }}
          >
            <input
              value={joinGameId}
              onChange={(e) => setJoinGameId(e.target.value)}
              placeholder="game_id"
              style={{
                width: 260,
                textAlign: "center",
                padding: "8px 10px",
              }}
            />

            <button
              onClick={onJoinGame}
              disabled={!joinGameId.trim()}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: joinGameId.trim() ? "pointer" : "default",
                opacity: joinGameId.trim() ? 1 : 0.45,
              }}
              title={joinGameId.trim() ? "Join existing game" : "Enter a game id first"}
            >
              <img
                src="/ui/join-game.png"
                alt="Join Game"
                style={{
                  width: 260,
                  height: "auto",
                  display: "block",
                }}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorView({
  error,
  onBackHome,
}: {
  error: ActionResponse;
  onBackHome: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff4f4",
          border: "1px solid #c00",
          borderRadius: 16,
          padding: 24,
          minWidth: 420,
          display: "grid",
          gap: 16,
          justifyItems: "center",
        }}
      >
        <img
          src="/ui/error-404.png"
          alt="Error 404"
          style={{
            width: 300,
            height: "auto",
            display: "block",
          }}
        />

        <div>
          <b>{error.error?.code ?? "UNKNOWN_ERROR"}</b>
        </div>

        <div style={{ textAlign: "center" }}>
          {error.error?.message ?? "Unknown error."}
        </div>

        <button onClick={onBackHome}>Back Home</button>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("public");
  const [gameId, setGameId] = useState("");
  const [resp, setResp] = useState<ActionResponse | null>(null);

  const [creatorId, setCreatorId] = useState("");
  const [actorId, setActorId] = useState("");
  const [joinPlayerId, setJoinPlayerId] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [claimCardId, setClaimCardId] = useState("");
  const [joinGameId, setJoinGameId] = useState("");
  const [screen, setScreen] = useState<"home" | "game" | "error">("home");

  useEffect(() => {
    const id = getOrCreateClientId();
    setCreatorId(id);
    setActorId(id);
    setSelectedPlayerId(id);
  }, []);

  async function run(p: Promise<ActionResponse>) {
    try {
      const r = await p;
      setResp(r);
      if (!r.error && r.game_id) {
        setGameId(r.game_id);
        setScreen("game");
      } else if (r.error) {
        setScreen("error");
      }
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
      setScreen("error");
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
                creator_id: creatorId,
                template_path: "data/templates/standard_54.json",
                seed: 42,
                view,
              })
            )
          }
          onJoinGame={() => run(getGame(joinGameId, view))}
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
              actorId={actorId}
              setActorId={setActorId}
              joinPlayerId={joinPlayerId}
              setJoinPlayerId={setJoinPlayerId}
              selectedPlayerId={selectedPlayerId}
              setSelectedPlayerId={setSelectedPlayerId}
              claimCardId={claimCardId}
              setClaimCardId={setClaimCardId}
              run={run}
              setResp={setResp}
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
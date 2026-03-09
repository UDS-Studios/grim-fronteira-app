import React, { useEffect, useState } from "react";
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

function getFreshPlayerId(): string {
  return `player-${Math.random().toString(36).slice(2, 8)}`;
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
  const [hover, setHover] = useState(false);

  const src = faceDown
    ? "/assets/cards/back/back.jpg"
    : `/assets/cards/front/${cardId}.jpg`;

  return (
    <img
      src={src}
      alt={faceDown ? "Card back" : cardId}
      title={title ?? (faceDown ? "Face-down" : cardId)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width,
        height: "auto",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.2)",
        background: "#fff",
        boxShadow: hover
          ? "0 8px 22px rgba(0,0,0,0.35)"
          : "0 2px 10px rgba(0,0,0,0.25)",
        transform: hover ? "translateY(-6px) scale(1.12)" : "translateY(0) scale(1)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        position: "relative",
        zIndex: hover ? 10 : 1,
      }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

function IconButton({
  src,
  alt,
  onClick,
  title,
  size = 40,
}: {
  src: string;
  alt: string;
  onClick?: () => void;
  title?: string;
  size?: number;
}) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        opacity: hover ? 1 : 0.85,
        transition: "opacity 0.15s ease",
      }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          width: size,
          height: size,
          display: "block",
        }}
      />
    </button>
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

function MarshalLobbyView({
  resp,
  view,
  currentActorId,
  joinPlayerId,
  setJoinPlayerId,
  selectedPlayerId,
  setSelectedPlayerId,
  claimCardId,
  setClaimCardId,
  run,
  setResp,
  onBackHome,
}: {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  joinPlayerId: string;
  setJoinPlayerId: (v: string) => void;
  selectedPlayerId: string;
  setSelectedPlayerId: (v: string) => void;
  claimCardId: string;
  setClaimCardId: (v: string) => void;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  setResp: React.Dispatch<React.SetStateAction<ActionResponse | null>>;
  onBackHome: () => void;
}) {
  const state = (resp.state as any) ?? {};
  const meta: MetaAny = state.meta ?? {};
  const zones: Zones = state.zones ?? {};

  const marshalId = meta.marshal_id ?? "";
  const playersOrder: string[] = meta.players_order ?? [];
  const lobby = meta.lobby ?? {};
  const availableFigures: string[] = zones["lobby.figure_pool.available"] ?? [];
  const claimedFigures: Record<string, string> = lobby.claimed_figures ?? {};

  const effectiveActorId = currentActorId || marshalId || "host1";
  const isMarshal = effectiveActorId === marshalId;

  const registrationOpen = !!lobby.registration_open;
  const assignmentMode = lobby.character_assignment_mode ?? "choice";
  const assignmentLocked = !!lobby.character_assignment_locked;
  const availableCount = lobby.available_figures_count ?? availableFigures.length;

  async function copyGameId() {
    try {
      await navigator.clipboard.writeText(resp.game_id);
      setResp({
        ...resp,
        error: {
          code: "COPIED",
          message: "Game ID copied to clipboard.",
          details: null,
        },
      });
    } catch {
      setResp({
        ...resp,
        error: {
          code: "COPY_FAILED",
          message: "Could not copy Game ID.",
          details: null,
        },
      });
    }
  }

  return (
    <div
      style={{
        marginTop: 12,
        border: "1px solid #333",
        borderRadius: 16,
        padding: 16,
        background: "#faf8f2",
        display: "grid",
        gap: 14,
      }}
    >
      {/* Top utility bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "56px 1fr 56px",
          alignItems: "center",
          gap: 12,
        }}
      >
        <IconButton
          src="/ui/home.png"
          alt="Home"
          title="Return to Home"
          onClick={onBackHome}
        />

        <h1
          style={{
            margin: 0,
            textAlign: "center",
            fontFamily: "LavaArabic, serif",
            letterSpacing: "0.04em",
          }}
        >
          Saloon Lobby
        </h1>

        <IconButton
          src="/ui/refresh.png"
          alt="Refresh"
          title="Refresh Lobby"
          onClick={() => run(getGame(resp.game_id, view))}
        />
      </div>

      {/* Game ID row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr 180px",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: "1.15em" }}>GAME ID</div>

        <input
          value={resp.game_id}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: "1em",
            textAlign: "left",
          }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            paddingRight: 10,
          }}
        >
          <IconButton
            src="/ui/copy.png"
            alt="Copy Game ID"
            title="Copy Game ID"
            onClick={copyGameId}
          />
        </div>
      </div>

      {/* Marshal controls */}
      <Section title="Marshal Controls">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div
            style={{
              border: "1px solid #bbb",
              borderRadius: 12,
              padding: 14,
              background: "#fffdf7",
              display: "grid",
              gap: 12,
            }}
          >
            <div
              style={{
                textAlign: "center",
                fontFamily: "LavaArabic, serif",
                fontSize: "1.8em",
                letterSpacing: "0.04em",
              }}
            >
              Character Creation
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <button
                type="button"
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
                disabled={!isMarshal || assignmentLocked}
                style={{
                  fontFamily: "LavaArabic, serif",
                  letterSpacing: "0.05em",
                  fontSize: "1.8em",
                  fontWeight: 900,
                  opacity: assignmentMode === "choice" ? 1 : 0.7,
                  background: assignmentMode === "choice" ? "#f2e1b0" : "#f3f3f3",
                  border: assignmentMode === "choice" ? "2px solid #8b5a2b" : "1px solid #bbb",
                  boxShadow: assignmentMode === "choice" ? "inset 0 0 0 1px #c89b5d" : "none",
                }}
              >
                CHOICE
              </button>

              <button
                type="button"
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
                disabled={!isMarshal || assignmentLocked}
                style={{
                  fontFamily: "LavaArabic, serif",
                  letterSpacing: "0.05em",
                  fontSize: "1.8em",
                  fontWeight: 900,
                  opacity: assignmentMode === "random" ? 1 : 0.7,
                  background: assignmentMode === "random" ? "#f2e1b0" : "#f3f3f3",
                  border: assignmentMode === "random" ? "2px solid #8b5a2b" : "1px solid #bbb",
                  boxShadow: assignmentMode === "random" ? "inset 0 0 0 1px #c89b5d" : "none",
                }}
              >
                RANDOM
              </button>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #bbb",
              borderRadius: 12,
              padding: 14,
              background: "#fffdf7",
              display: "grid",
              gap: 12,
            }}
          >
            <div
              style={{
                textAlign: "center",
                fontFamily: "LavaArabic, serif",
                fontSize: "1.8em",
                letterSpacing: "0.04em",
              }}
            >
              Game
            </div>

            <button
              type="button"
              onClick={() =>
                run(
                  gfAction({
                    game_id: resp.game_id,
                    action: "gf.set_registration_open",
                    params: { actor_id: effectiveActorId, is_open: !registrationOpen },
                    view,
                  })
                )
              }
              disabled={!isMarshal}
              style={{
                fontFamily: "LavaArabic, serif",
                letterSpacing: "0.05em",
                fontSize: "1.8em",
              }}
            >
              {registrationOpen ? "Close Registration" : "Reopen Registration"}
            </button>

            <button
              type="button"
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
              disabled={!isMarshal}
              style={{
                fontFamily: "LavaArabic, serif",
                fontSize: "2.3em",
                letterSpacing: "0.05em",
                fontWeight: 900,
                color: "#7a1f1f",
              }}
            >
              Start Game
            </button>
          </div>
        </div>
      </Section>

      {/* Available figures */}
      <Section title="Available Figures">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            minHeight: 110,
            alignItems: "center",
          }}
        >
          {availableFigures.length === 0 ? (
            <div style={{ opacity: 0.7 }}>— no figures available —</div>
          ) : isMarshal ? (
            assignmentMode === "random" ? (
              availableFigures.map((_, idx) => (
                <CardImg
                  key={`marshal-hidden-${idx}`}
                  cardId="BACK"
                  faceDown
                  width={86}
                  title="Hidden figure"
                />
              ))
            ) : (
              availableFigures.map((c) => (
                <CardImg
                  key={c}
                  cardId={c}
                  width={86}
                  title={Object.values(claimedFigures).includes(c) ? `${c} already claimed` : c}
                />
              ))
            )
          ) : assignmentMode === "random" ? (
            availableFigures.map((_, idx) => (
              <button
                key={`hidden-${idx}`}
                type="button"
                disabled={!selectedPlayerId.trim()}
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
                  cursor: selectedPlayerId.trim() ? "pointer" : "default",
                  borderRadius: 12,
                  opacity: selectedPlayerId.trim() ? 1 : 0.7,
                }}
                title={
                  selectedPlayerId.trim()
                    ? `Draw random character for ${selectedPlayerId}`
                    : "Set player_id before drawing"
                }
              >
                <CardImg cardId="BACK" faceDown width={86} title="Hidden figure" />
              </button>
            ))
          ) : (
            availableFigures.map((c) => {
              const taken = Object.values(claimedFigures).includes(c);

              return (
                <button
                  key={c}
                  type="button"
                  disabled={!selectedPlayerId.trim() || taken}
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
                    cursor: !selectedPlayerId.trim() || taken ? "default" : "pointer",
                    borderRadius: 12,
                    opacity: taken ? 0.35 : selectedPlayerId.trim() ? 1 : 0.7,
                  }}
                  title={
                    taken
                      ? `${c} already claimed`
                      : selectedPlayerId.trim()
                        ? `Claim ${c} for ${selectedPlayerId}`
                        : `Set player_id before claiming ${c}`
                  }
                >
                  <CardImg cardId={c} width={86} title={c} />
                </button>
              );
            })
          )}
        </div>
      </Section>

      {/* Lower info row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        }}
      >
        <Section title="Informations">
          <div style={{ display: "grid", gap: 8 }}>
            <div><b>marshal:</b> {marshalId || "-"}</div>
            <div><b>players joined:</b> {playersOrder.length}</div>
            <div><b>registration:</b> {registrationOpen ? "open" : "closed"}</div>
            <div><b>assignment:</b> {assignmentMode}</div>
            <div><b>locked:</b> {assignmentLocked ? "yes" : "no"}</div>
            <div><b>available figures:</b> {availableCount}</div>
            <div><b>selected player:</b> {selectedPlayerId || "—"}</div>
          </div>
        </Section>

        <Section title="Players in Saloon">
          <div style={{ display: "grid", gap: 8 }}>
            {playersOrder.length === 0 ? (
              <div style={{ opacity: 0.7 }}>— nobody yet —</div>
            ) : (
              playersOrder.map((pid) => {
                const claimed = claimedFigures[pid];

                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => setSelectedPlayerId(pid)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: selectedPlayerId === pid ? "2px solid #8b5a2b" : "1px solid #bbb",
                      background: selectedPlayerId === pid ? "#fff8ea" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{pid}</div>
                    <div style={{ fontSize: 14, opacity: 0.8 }}>
                      {claimed ? `Figure: ${claimed}` : "No figure yet"}
                    </div>
                  </button>
                );
              })
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginTop: 8,
              }}
            >
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
          </div>
        </Section>
      </div>
    </div>
  );
}

function PlayerLobbyView({
  resp,
  view,
  currentActorId,
  run,
}: {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
}) {
  const state = (resp.state as any) ?? {};
  const meta: MetaAny = state.meta ?? {};
  const zones: Zones = state.zones ?? {};

  const marshalId = meta.marshal_id ?? "";
  const lobby = meta.lobby ?? {};
  const playersOrder: string[] = meta.players_order ?? [];
  const availableFigures: string[] = zones["lobby.figure_pool.available"] ?? [];
  const claimedFigures: Record<string, string> = lobby.claimed_figures ?? {};

  const assignmentMode = lobby.character_assignment_mode ?? "choice";
  const currentPlayerId = currentActorId;
  const myClaimedFigure = claimedFigures[currentPlayerId] ?? null;

  return (
    <div
      style={{
        marginTop: 12,
        border: "1px solid #333",
        borderRadius: 16,
        padding: 16,
        background: "#faf8f2",
        display: "grid",
        gap: 14,
      }}
    >
      {/* Title only */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "56px 1fr 56px",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div />
        <h1
          style={{
            margin: 0,
            textAlign: "center",
            fontFamily: "LavaArabic, serif",
            letterSpacing: "0.04em",
          }}
        >
          Saloon Lobby
        </h1>
        <div />
      </div>

      {/* Available figures */}
      <Section title="Available Figures">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            minHeight: 110,
            alignItems: "center",
          }}
        >
          {availableFigures.length === 0 ? (
            <div style={{ opacity: 0.7 }}>— no figures available —</div>
          ) : assignmentMode === "random" ? (
            availableFigures.map((_, idx) => (
              <button
                key={`hidden-${idx}`}
                type="button"
                disabled={!!myClaimedFigure}
                onClick={() => {
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.draw_character",
                      params: { player_id: currentPlayerId, seed: 321 + idx },
                      view,
                    })
                  );
                }}
                style={{
                  border: "1px solid transparent",
                  background: "transparent",
                  padding: 0,
                  cursor: myClaimedFigure ? "default" : "pointer",
                  borderRadius: 12,
                  opacity: myClaimedFigure ? 0.5 : 1,
                }}
                title={
                  myClaimedFigure
                    ? "You already selected a figure"
                    : `Draw random character for ${currentPlayerId}`
                }
              >
                <CardImg cardId="BACK" faceDown width={86} title="Hidden figure" />
              </button>
            ))
          ) : (
            availableFigures.map((c) => (
              <button
                key={c}
                type="button"
                disabled={!!myClaimedFigure}
                onClick={() => {
                  run(
                    gfAction({
                      game_id: resp.game_id,
                      action: "gf.claim_character",
                      params: { player_id: currentPlayerId, card_id: c },
                      view,
                    })
                  );
                }}
                style={{
                  border: "1px solid transparent",
                  background: "transparent",
                  padding: 0,
                  cursor: myClaimedFigure ? "default" : "pointer",
                  borderRadius: 12,
                  opacity: myClaimedFigure ? 0.5 : 1,
                }}
                title={
                  myClaimedFigure
                    ? "You already selected a figure"
                    : `Claim ${c}`
                }
              >
                <CardImg cardId={c} width={86} title={c} />
              </button>
            ))
          )}
        </div>
      </Section>

      {/* Lower two-box layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: 14,
          alignItems: "stretch",
        }}
      >
        <Section title="Your Figure">
          <div
            style={{
              minHeight: 320,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {myClaimedFigure ? (
              <CardImg cardId={myClaimedFigure} width={180} title={myClaimedFigure} />
            ) : (
              <div style={{ opacity: 0.65, textAlign: "center" }}>
                Choose your figure
              </div>
            )}
          </div>
        </Section>

        <Section title="Informations">
          <div style={{ display: "grid", gap: 10 }}>
            <div><b>You are:</b> {currentPlayerId}</div>
            <div><b>Marshal:</b> {marshalId || "-"}</div>
            <div><b>Players in saloon:</b> {playersOrder.length}</div>
            <div><b>Character creation:</b> {assignmentMode}</div>
            <div><b>Your selected figure:</b> {myClaimedFigure ?? "none yet"}</div>

            <div style={{ marginTop: 12, opacity: 0.8 }}>
              {myClaimedFigure
                ? "Waiting for the Marshal to start the game."
                : assignmentMode === "random"
                  ? "Choose a facedown card to draw your figure."
                  : "Choose one available figure from the row above."}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function LobbyView(props: {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  joinPlayerId: string;
  setJoinPlayerId: (v: string) => void;
  selectedPlayerId: string;
  setSelectedPlayerId: (v: string) => void;
  claimCardId: string;
  setClaimCardId: (v: string) => void;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  setResp: React.Dispatch<React.SetStateAction<ActionResponse | null>>;
  onBackHome: () => void;
}) {
  const meta = ((props.resp.state as any)?.meta ?? {}) as MetaAny;
  const marshalId = meta.marshal_id ?? "";
  const isMarshal = props.currentActorId === marshalId;

  if (isMarshal) {
    return <MarshalLobbyView {...props} />;
  }

  return (
    <PlayerLobbyView
      resp={props.resp}
      view={props.view}
      currentActorId={props.currentActorId}
      run={props.run}
    />
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
  onJoinGame: () => Promise<void>;
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
            fontSize: "5.1em",
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

  async function run(p: Promise<ActionResponse>): Promise<ActionResponse> {
    try {
      const r = await p;
      setResp(r);
      if (!r.error && r.game_id) {
        setGameId(r.game_id);
        setScreen("game");
      } else if (r.error) {
        setScreen("error");
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

            const loadedMeta = ((r.state as any)?.meta ?? {}) as MetaAny;
            const marshalId = loadedMeta.marshal_id ?? "";

            if (currentActorId !== marshalId) {
              const freshPlayerId = getFreshPlayerId();
              setCurrentActorId(freshPlayerId);
              setSelectedPlayerId(freshPlayerId);
            } else {
              setSelectedPlayerId(currentActorId);
            }
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
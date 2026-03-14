import { getGame, gfAction } from "../api/gf";
import CardImg from "../components/CardImg";
import IconButton from "../components/IconButton";
import Section from "../components/Section";
import type { LobbyViewProps, MetaAny, Zones } from "./types";

export default function MarshalLobbyView({
  resp,
  view,
  currentActorId,
  selectedPlayerId,
  setSelectedPlayerId,
  claimCardId,
  setClaimCardId,
  run,
  setResp,
  onBackHome,
}: LobbyViewProps) {
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
  const text = resp.game_id;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  } catch {
    console.warn("Could not copy Game ID to clipboard");
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        }}
      >
        <Section title="Informations">
          <div style={{ display: "grid", gap: 8 }}>
            <div><b>players joined:</b> {playersOrder.length}</div>
            <div><b>registration:</b> {registrationOpen ? "open" : "closed"}</div>
            <div><b>assignment:</b> {assignmentMode}</div>
            <div><b>locked:</b> {assignmentLocked ? "yes" : "no"}</div>
            <div><b>available figures:</b> {availableCount}</div>
          </div>
        </Section>

        <Section title="Players in Saloon">
          <div style={{ display: "grid", gap: 8 }}>
            {playersOrder.filter((pid) => pid !== marshalId).length === 0 ? (
              <div style={{ opacity: 0.7 }}>— nobody yet —</div>
            ) : (
              playersOrder
                .filter((pid) => pid !== marshalId)
                .map((pid) => {
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
          </div>
        </Section>
      </div>
    </div>
  );
}

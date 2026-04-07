import { getGame, gfAction } from "../api/gf";
import CardImg from "../components/CardImg";
import IconButton from "../components/IconButton";
import Section from "../components/Section";
import type { LobbyViewProps, MetaAny, Zones } from "./types";

type LobbyPlayerState = {
  stage?: "waiting_for_figure" | "waiting_for_name" | "waiting_for_feature" | "ready";
  card_id?: string | null;
  character_label?: string | null;
  name_suggestions?: string[];
  chosen_name?: string | null;
  feature_suggestions?: string[];
  chosen_feature?: string | null;
  ready?: boolean;
  summary_text?: string | null;
  display_text?: string | null;
};

export default function MarshalLobbyView({
  resp,
  view,
  currentActorId,
  selectedPlayerId,
  setSelectedPlayerId,
  run,
  onBackHome,
}: LobbyViewProps) {
  const state = (resp.state as any) ?? {};
  const meta: MetaAny = state.meta ?? {};
  const zones: Zones = state.zones ?? {};

  const marshalId = meta.marshal_id ?? "";
  const playersOrder: string[] = meta.players_order ?? [];
  const lobby = meta.lobby ?? {};
  const lobbyPlayers: Record<string, LobbyPlayerState> = lobby.players ?? {};
  const availableFigures: string[] = zones["lobby.figure_pool.available"] ?? [];
  const claimedFigures: Record<string, string> = lobby.claimed_figures ?? {};

  const effectiveActorId = currentActorId || marshalId || "host1";
  const isMarshal = effectiveActorId === marshalId;

  const registrationOpen = !!lobby.registration_open;
  const assignmentMode = lobby.character_assignment_mode ?? "choice";
  const assignmentLocked = !!lobby.character_assignment_locked;
  const availableCount = lobby.available_figures_count ?? availableFigures.length;
  const allPlayersReady = !!lobby.all_players_ready;

  const joinedPlayers = playersOrder.filter((pid) => pid !== marshalId);

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

  function renderPlayerSaloonText(pid: string, pstate: LobbyPlayerState) {
    const stage = pstate.stage ?? "waiting_for_figure";
    const label = pstate.character_label ?? null;
    const chosenName = pstate.chosen_name ?? null;
    const chosenFeature = pstate.chosen_feature ?? null;

    if (stage === "waiting_for_figure") {
      return { prefix: "", summary: `${pid} has not selected a figure yet` };
    }

    if (stage === "waiting_for_name") {
      if (label) {
        return { prefix: `${pid} is `, summary: `a ${label}` };
      }
      return { prefix: "", summary: `${pid} selected a figure` };
    }

    if (stage === "waiting_for_feature") {
      if (chosenName && label) {
        return { prefix: `${pid} is `, summary: `${chosenName}, a ${label}` };
      }
      return { prefix: "", summary: `${pid} is choosing a feature` };
    }

    if (stage === "ready") {
      if (chosenName && label && chosenFeature) {
        return {
          prefix: `${pid} is `,
          summary: `${chosenName}, a ${label} with ${chosenFeature}`,
        };
      }
      return { prefix: "", summary: `${pid} is ready` };
    }

    return { prefix: "", summary: `${pid} is in the saloon` };
  }

  return (
    <div
      style={{
        marginTop: 12,
        border: "1px solid var(--border-strong)",
        borderRadius: 16,
        padding: 16,
        background: "var(--surface-bg)",
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
          gridTemplateColumns: "120px minmax(0, 1fr) 180px",
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

      <div style={{ display: "grid", gap: 14 }}>
        <Section title="Marshal Controls">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div
              style={{
                border: "1px solid var(--border-muted)",
                borderRadius: 12,
                padding: 14,
                background: "var(--surface-muted)",
                display: "grid",
                gap: 12,
                alignContent: "start",
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
                  alignItems: "stretch",
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
                    fontSize: "1.45em",
                    fontWeight: 900,
                    color: "var(--text-primary)",
                    opacity: assignmentMode === "choice" ? 1 : 0.7,
                    background: assignmentMode === "choice"
                      ? "var(--surface-hover)"
                      : "var(--surface-strong)",
                    border: assignmentMode === "choice"
                      ? "2px solid var(--border-strong)"
                      : "1px solid var(--border-muted)",
                    boxShadow: assignmentMode === "choice"
                      ? "inset 0 0 0 1px color-mix(in srgb, var(--border-strong) 35%, transparent)"
                      : "none",
                    minHeight: 84,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "12px 16px",
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
                    fontSize: "1.45em",
                    fontWeight: 900,
                    color: "var(--text-primary)",
                    opacity: assignmentMode === "random" ? 1 : 0.7,
                    background: assignmentMode === "random"
                      ? "var(--surface-hover)"
                      : "var(--surface-strong)",
                    border: assignmentMode === "random"
                      ? "2px solid var(--border-strong)"
                      : "1px solid var(--border-muted)",
                    boxShadow: assignmentMode === "random"
                      ? "inset 0 0 0 1px color-mix(in srgb, var(--border-strong) 35%, transparent)"
                      : "none",
                    minHeight: 84,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "12px 16px",
                  }}
                >
                  RANDOM
                </button>
              </div>
            </div>

            <div
              style={{
                border: "1px solid var(--border-muted)",
                borderRadius: 12,
                padding: 14,
                background: "var(--surface-muted)",
                display: "grid",
                gap: 12,
                alignContent: "start",
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
                  fontSize: "1.45em",
                  minHeight: 56,
                  lineHeight: 1.05,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "12px 16px",
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
                      params: { actor_id: effectiveActorId },
                      view,
                    })
                  )
                }
                disabled={!isMarshal || !allPlayersReady}
                style={{
                  fontFamily: "LavaArabic, serif",
                  fontSize: "1.9em",
                  letterSpacing: "0.05em",
                  fontWeight: 900,
                  color: "var(--accent-danger)",
                  opacity: !allPlayersReady ? 0.55 : 1,
                  minHeight: 64,
                  lineHeight: 1.05,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "14px 18px",
                }}
                title={
                  allPlayersReady
                    ? "Start the game"
                    : "All non-marshal players must finalize their character first"
                }
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
              minHeight: 120,
              alignItems: "center",
              overflow: "visible",
              padding: "6px 2px 10px",
            }}
          >
            {availableFigures.length === 0 ? (
              <div style={{ opacity: 0.7 }}>— no figures available —</div>
            ) : assignmentMode === "random" ? (
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
            )}
          </div>
        </Section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 14,
          }}
        >
          <Section title="Informations">
            <div style={{ display: "grid", gap: 8 }}>
              <div><b>players joined:</b> {joinedPlayers.length}</div>
              <div><b>registration:</b> {registrationOpen ? "open" : "closed"}</div>
              <div><b>assignment:</b> {assignmentMode}</div>
              <div><b>locked:</b> {assignmentLocked ? "yes" : "no"}</div>
              <div><b>available figures:</b> {availableCount}</div>
              <div><b>all players ready:</b> {allPlayersReady ? "yes" : "no"}</div>
            </div>
          </Section>

          <Section title="Players in Saloon">
            <div style={{ display: "grid", gap: 8 }}>
              {joinedPlayers.length === 0 ? (
                <div style={{ opacity: 0.7 }}>— nobody yet —</div>
              ) : (
                joinedPlayers.map((pid) => {
                  const pstate = lobbyPlayers[pid] ?? {};
                  const { prefix, summary } = renderPlayerSaloonText(pid, pstate);
                  const stage = pstate.stage ?? "waiting_for_figure";
                  const isReady = stage === "ready";

                  let statusColor = "#bbb";
                  if (stage === "waiting_for_name" || stage === "waiting_for_feature") {
                    statusColor = "#d9b94b";
                  }
                  if (stage === "ready") {
                    statusColor = "#5aa65a";
                  }

                  return (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => setSelectedPlayerId(pid)}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: selectedPlayerId === pid
                          ? "2px solid var(--border-strong)"
                          : "1px solid var(--border-muted)",
                        background: isReady
                          ? "color-mix(in srgb, #5aa65a 24%, var(--surface-strong))"
                          : selectedPlayerId === pid
                          ? "var(--surface-hover)"
                          : "var(--surface-strong)",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                      }}
                      title={pid}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: statusColor,
                            flexShrink: 0,
                          }}
                        />

                        <div style={{ fontSize: 14, opacity: 0.9, color: "var(--text-primary)" }}>
                          {prefix}
                          <b>{summary}</b>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

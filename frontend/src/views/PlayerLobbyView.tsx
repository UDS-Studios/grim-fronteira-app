import { gfAction } from "../api/gf";
import CardImg from "../components/CardImg";
import Section from "../components/Section";
import type { MetaAny, Zones, RunAction } from "./types";
import type { ActionResponse, View } from "../api/types";

type PlayerLobbyViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: RunAction;
};

export default function PlayerLobbyView({
  resp,
  view,
  currentActorId,
  run,
}: PlayerLobbyViewProps) {
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

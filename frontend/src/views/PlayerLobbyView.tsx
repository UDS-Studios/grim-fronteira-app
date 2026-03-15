import { useState } from "react";
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

export default function PlayerLobbyView({
  resp,
  view,
  currentActorId,
  run,
}: PlayerLobbyViewProps) {
  const [customName, setCustomName] = useState("");
  const [customFeature, setCustomFeature] = useState("");

  const state = (resp.state as any) ?? {};
  const meta: MetaAny = state.meta ?? {};
  const zones: Zones = state.zones ?? {};

  const marshalId = meta.marshal_id ?? "";
  const lobby = meta.lobby ?? {};
  const lobbyPlayers: Record<string, LobbyPlayerState> = lobby.players ?? {};
  const availableFigures: string[] = zones["lobby.figure_pool.available"] ?? [];

  const assignmentMode = lobby.character_assignment_mode ?? "choice";
  const registrationOpen = !!lobby.registration_open;
  const currentPlayerId = currentActorId;

  const pstate: LobbyPlayerState =
    lobbyPlayers[currentPlayerId] ?? { stage: "waiting_for_figure" };

  const stage = pstate.stage ?? "waiting_for_figure";
  const myCardId = pstate.card_id ?? null;
  const characterLabel = pstate.character_label ?? null;
  const chosenName = pstate.chosen_name ?? null;
  const chosenFeature = pstate.chosen_feature ?? null;
  const nameSuggestions = pstate.name_suggestions ?? [];
  const featureSuggestions = pstate.feature_suggestions ?? [];
  const displayText = pstate.display_text ?? null;

  const canPickFigure =
    registrationOpen && stage === "waiting_for_figure";

  async function submitName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;

    const seed = deterministicSeedFrom(
      `${resp.game_id}|${currentPlayerId}|${trimmed}`
    );

    setCustomName("");
    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.submit_character_name",
        params: {
          player_id: currentPlayerId,
          name: trimmed,
          seed,
        },
        view,
      })
    );
  }

  function deterministicSeedFrom(text: string): number {
    let h = 2166136261;

    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }

    return Math.abs(h >>> 0);
  }

  async function submitFeature(feature: string) {
    const trimmed = feature.trim();
    if (!trimmed) return;

    setCustomFeature("");
    await run(
      gfAction({
        game_id: resp.game_id,
        action: "gf.submit_character_feature",
        params: {
          player_id: currentPlayerId,
          feature: trimmed,
        },
        view,
      })
    );
  }

  function renderInfoContent() {
    if (stage === "waiting_for_figure") {
      return (
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <b>Player ID:</b> {currentPlayerId} — <b>Marshal ID:</b> {marshalId || "-"}
          </div>

          <div style={{ marginTop: 12, opacity: 0.8 }}>
            {assignmentMode === "random"
              ? "Choose one of the facedown cards to draw your figure."
              : "Choose one of the available figures above."}
          </div>
        </div>
      );
    }

    if (stage === "waiting_for_name") {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            Your Character is a{" "}
            <span style={{ fontFamily: "LavaArabic, serif", fontSize: "1.2em" }}>
              {characterLabel}
            </span>
          </div>

          <div style={{ fontWeight: 700 }}>Pick one of these names:</div>

          <div style={{ display: "grid", gap: 8 }}>
            {nameSuggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => submitName(name)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #bbb",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                {name}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 8 }}>Or write your own</div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Write a custom name"
              style={{ flex: 1, padding: "10px 12px" }}
            />
            <button
              type="button"
              onClick={() => submitName(customName)}
              disabled={!customName.trim()}
            >
              Submit
            </button>
          </div>
        </div>
      );
    }

    if (stage === "waiting_for_feature") {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            Your Character is{" "}
            <span style={{ fontFamily: "LavaArabic, serif", fontSize: "1.2em" }}>
              {chosenName}
            </span>{" "}
            a{" "}
            <span style={{ fontFamily: "LavaArabic, serif", fontSize: "1.2em" }}>
              {characterLabel}
            </span>
          </div>

          <div style={{ fontWeight: 700 }}>Pick one of these features:</div>

          <div style={{ display: "grid", gap: 8 }}>
            {featureSuggestions.map((feature) => (
              <button
                key={feature}
                type="button"
                onClick={() => submitFeature(feature)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #bbb",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                {feature}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 8 }}>Or write your own</div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={customFeature}
              onChange={(e) => setCustomFeature(e.target.value)}
              placeholder="Write a custom feature"
              style={{ flex: 1, padding: "10px 12px" }}
            />
            <button
              type="button"
              onClick={() => submitFeature(customFeature)}
              disabled={!customFeature.trim()}
            >
              Submit
            </button>
          </div>
        </div>
      );
    }

    if (stage === "ready") {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            Your Character is{" "}
            <span style={{ fontFamily: "LavaArabic, serif", fontSize: "1.2em" }}>
              {chosenName}
            </span>{" "}
            a{" "}
            <span style={{ fontFamily: "LavaArabic, serif", fontSize: "1.2em" }}>
              {characterLabel}
            </span>{" "}
            with{" "}
            <span style={{ fontFamily: "LavaArabic, serif", fontSize: "1.2em" }}>
              {chosenFeature}
            </span>
          </div>

          <div style={{ opacity: 0.85 }}>
            Waiting for the Marshal to start the game.
          </div>

          {displayText && (
            <div style={{ fontSize: 14, opacity: 0.7 }}>
              {displayText}
            </div>
          )}
        </div>
      );
    }

    return null;
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
                disabled={!canPickFigure}
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
                  cursor: canPickFigure ? "pointer" : "default",
                  borderRadius: 12,
                  opacity: canPickFigure ? 1 : 0.5,
                }}
                title={
                  !registrationOpen
                    ? "Registration is closed"
                    : "Draw random character"
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
                disabled={!canPickFigure}
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
                  cursor: canPickFigure ? "pointer" : "default",
                  borderRadius: 12,
                  opacity: canPickFigure ? 1 : 0.5,
                }}
                title={
                  !registrationOpen
                    ? "Registration is closed"
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
            {myCardId ? (
              <CardImg cardId={myCardId} width={180} title={myCardId} />
            ) : (
              <div style={{ opacity: 0.65, textAlign: "center" }}>
                Choose your figure
              </div>
            )}
          </div>
        </Section>

        <Section title="Informations">
          {renderInfoContent()}
        </Section>
      </div>
    </div>
  );
}
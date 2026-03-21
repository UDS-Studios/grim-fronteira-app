import CardImg from "../components/CardImg";
import IconButton from "../components/IconButton";
import TableZone from "../components/TableZone";
import PlayerSummaryCard from "../components/PlayerSummaryCard";
import { getGame } from "../api/gf";
import type { ActionResponse, View } from "../api/types";

type MarshalTableViewProps = {
  resp: ActionResponse;
  view: View;
  currentActorId: string;
  run: (p: Promise<ActionResponse>) => Promise<ActionResponse>;
  onBackHome: () => void;
};

export default function MarshalTableView({
  resp,
  view,
  currentActorId,
  run,
  onBackHome,
}: MarshalTableViewProps) {
  const state = (resp.state as any) ?? {};
  const meta = state.meta ?? {};
  const zones: Record<string, string[]> = state.zones ?? {};

  const playersOrder: string[] = meta.players_order ?? [];
  const marshalId = meta.marshal_id ?? "";
  const scene = meta.scene ?? {};
  const lobby = meta.lobby ?? {};
  const lobbyPlayers = lobby.players ?? {};

  const nonMarshalPlayers = playersOrder.filter((pid) => pid !== marshalId);

  const deckCount = Array.isArray(state.deck) ? state.deck.length : (meta.deck_count ?? "-");

  const discardZone =
    zones["scene.discard"] ??
    zones["discard"] ??
    [];

  const difficultyCards =
    zones["scene.difficulty"] ??
    zones["scene.challenge"] ??
    [];

  const playedCards =
    Object.entries(zones)
      .filter(([name]) => name.includes(".played") || name.includes(".hand_played"))
      .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
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
          Saloon Table
        </h1>

        <IconButton
          src="/ui/refresh.png"
          alt="Refresh"
          title="Refresh Table"
          onClick={() => run(getGame(resp.game_id, view))}
        />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div><b>phase:</b> {meta.phase ?? "-"}</div>
        <div><b>game_id:</b> {resp.game_id}</div>
        <div><b>revision:</b> {resp.revision}</div>
        <div><b>difficulty:</b> {scene.difficulty_value ?? "-"}</div>
        <div><b>dark mode:</b> {scene.dark_mode ? "ON" : "off"}</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr 360px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <TableZone title="Deck">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <CardImg cardId="BACK" faceDown width={86} title="Deck" />
              <div><b>{deckCount}</b> cards</div>
            </div>
          </TableZone>

          <TableZone title="Discard">
            {discardZone.length === 0 ? (
              <div style={{ opacity: 0.6 }}>— empty —</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {discardZone.map((cardId, idx) => (
                  <CardImg key={`${cardId}:${idx}`} cardId={cardId} width={70} />
                ))}
              </div>
            )}
          </TableZone>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <TableZone title="Difficulty / Scene">
            <div style={{ display: "grid", gap: 10 }}>
              <div><b>difficulty value:</b> {scene.difficulty_value ?? "-"}</div>
              <div><b>difficulty rule:</b> {scene.difficulty_rule ?? "-"}</div>

              {difficultyCards.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {difficultyCards.map((cardId, idx) => (
                    <CardImg key={`${cardId}:${idx}`} cardId={cardId} width={80} />
                  ))}
                </div>
              )}
            </div>
          </TableZone>

          <TableZone title="Cards Played">
            {playedCards.length === 0 ? (
              <div style={{ opacity: 0.6 }}>— no played cards exposed yet —</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {playedCards.map(([zoneName, cards]) => (
                  <div key={zoneName} style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>{zoneName}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {cards.map((cardId, idx) => (
                        <CardImg key={`${zoneName}:${cardId}:${idx}`} cardId={cardId} width={70} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TableZone>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <TableZone title="Players">
            <div style={{ display: "grid", gap: 10 }}>
              {nonMarshalPlayers.length === 0 ? (
                <div style={{ opacity: 0.6 }}>— no players —</div>
              ) : (
                nonMarshalPlayers.map((pid) => {
                  const pstate = lobbyPlayers[pid] ?? {};
                  const figure = (zones[`players.${pid}.character`] ?? [])[0] ?? null;
                  const scumCount = (zones[`players.${pid}.scum`] ?? []).length;
                  const vengeanceCount = (zones[`players.${pid}.vengeance`] ?? []).length;
                  const rewardCount = (zones[`players.${pid}.rewards`] ?? []).length;

                  return (
                    <PlayerSummaryCard
                      key={pid}
                      playerId={pid}
                      pstate={pstate}
                      figureCardId={figure}
                      scumCount={scumCount}
                      vengeanceCount={vengeanceCount}
                      rewardCount={rewardCount}
                    />
                  );
                })
              )}
            </div>
          </TableZone>
        </div>
      </div>
    </div>
  );
}
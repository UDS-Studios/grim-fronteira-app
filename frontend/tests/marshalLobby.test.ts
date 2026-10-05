import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionResponse } from "../src/api/types.ts";

function findStart(node: ReactNode): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(findStart).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.type === "button" && node.props.children === "Start Game") return node.props;
  return findStart(node.props.children as ReactNode);
}

test("Marshal lobby start requires joined ready players, connection and Marshal role", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-lobby-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  const oldFetch = globalThis.fetch;
  try {
    const { default: Lobby } = await server.ssrLoadModule("/src/views/MarshalLobbyView.tsx");
    const zeroTitle = "At least one player must join before the game can start.";
    const readyTitle = "All non-marshal players must finalize their character first";
    const cases = [
      { name: "Marshal only, empty-set readiness true", players: [], ready: true, disabled: true, title: zeroTitle },
      { name: "Marshal only, readiness false and disconnected", players: [], ready: false, disconnected: true, disabled: true, title: zeroTitle },
      { name: "one unready player", players: [false], ready: false, disabled: true, title: readyTitle },
      { name: "one ready player", players: [true], ready: true, disabled: false, title: "Start the game" },
      { name: "multiple players, one unready", players: [true, false], ready: false, disabled: true, title: readyTitle },
      { name: "multiple ready players", players: [true, true], ready: true, disabled: false, title: "Start the game" },
      { name: "ready but disconnected", players: [true], ready: true, disconnected: true, disabled: true, title: "Connection lost" },
      { name: "unready and disconnected", players: [false], ready: false, disconnected: true, disabled: true, title: readyTitle },
      { name: "non-Marshal", players: [true], ready: true, actor: "p1", disabled: true, title: "Start the game" },
    ];
    for (const scenario of cases) {
      await t.test(scenario.name, async () => {
        const ids = scenario.players.map((_, index) => `p${index + 1}`);
        const response: ActionResponse = { game_id: "lobby-test", revision: 1, events: [], result: {}, error: null,
          state: { zones: {}, meta: { phase: "lobby", marshal_id: "host", players_order: ["host", ...ids],
            lobby: { all_players_ready: scenario.ready, registration_open: true,
              players: Object.fromEntries(ids.map((id, index) => [id, {
                ready: scenario.players[index], stage: scenario.players[index] ? "ready" : "waiting_for_figure",
              }])) } } } };
        const requests: unknown[] = [];
        globalThis.fetch = async (_input, options) => {
          requests.push(JSON.parse(String(options?.body)));
          return new Response(JSON.stringify(response), { status: 200 });
        };
        const tree = Lobby({ resp: response, view: "marshal", currentActorId: scenario.actor ?? "host",
          connectionLost: scenario.disconnected ?? false, selectedPlayerId: "", setSelectedPlayerId: () => {},
          onBackHome: () => {}, run: async (promise: Promise<ActionResponse>) => promise });
        const start = findStart(tree)!;
        assert.equal(start.disabled, scenario.disabled);
        assert.equal(start.title, scenario.title);
        const markup = renderToStaticMarkup(tree);
        const button = markup.match(/<button\b[^>]*>Start Game<\/button>/)![0];
        assert.equal(/disabled=""/.test(button), scenario.disabled);
        const click = start.onClick as () => Promise<void>;
        // Normal UI honors disabled; directly invoking blocked callbacks also tests the handler guard.
        if (!start.disabled) await click();
        assert.equal(requests.length, scenario.disabled ? 0 : 1);
        if (scenario.disabled) {
          await click();
          assert.equal(requests.length, 0);
        } else {
          assert.deepEqual(requests[0], { game_id: "lobby-test", action: "gf.start_game", params: { actor_id: "host" },
            view: "marshal", viewer_id: "host" });
        }
      });
    }
  } finally {
    globalThis.fetch = oldFetch;
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

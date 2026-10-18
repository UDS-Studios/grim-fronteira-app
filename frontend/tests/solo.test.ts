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

function find(node: ReactNode, match: (p: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(n => find(n, match)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return match(node.props) ? node.props : find(node.props.children as ReactNode, match)
    ?? find(node.props.resourceActions as ReactNode, match) ?? find(node.props.rewardActions as ReactNode, match);
}
function response(): ActionResponse {
  return { game_id: "solo", revision: 7, events: [], result: {}, error: null, state: {
    meta: { mode: "solo", phase: "table", players_order: ["solo_marshal", "solo_player"], marshal_id: "solo_marshal",
      solo: { adventure_id: "malopasso", version: 1, adventure_title: "The Road to Malopasso", node: "gun",
        step: "playing", attempt: 0, scene_number: 1, title: "A gun before sundown", text: "Convince the trader.",
        has_gun: false, outlaw_defeated: false, invitation: "Multiplayer is more fun: try Azzardo and Dark mode.",
        outcome: null, ending: null, needs_heal: false, needs_discard: false, history: [] },
      scene: { status: "active", participants: ["solo_player"], difficulty: { value: 18, card_id: "8H" }, azzardo: { status: "skipped" },
        players: { solo_player: { hand_value: 16, acknowledged: false, busted: false } } } },
    zones: { "players.solo_player.character": ["KS"], "scene.hand.solo_player": ["6D"],
      "players.solo_player.scum": ["2C"], "players.solo_player.vengeance": ["2H"] } } };
}
function lobbyResponse() {
  const r = response(); r.state.meta!.phase = "lobby";
  r.state.meta!.lobby = { registration_open: false, character_assignment_mode: "choice", players: { solo_player: { stage: "waiting_for_figure" } } };
  r.state.zones!["players.solo_player.character"] = [];
  r.state.zones!["lobby.figure_pool.available"] = ["KD", "KS"];
  return r;
}

test("solo reuses the real Saloon and Table, retaining safe transport and limitations", async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-shared-solo-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)), optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "solo-hooks", enforce: "pre", transform(code, id) {
      if (id.endsWith("/src/views/SoloAdventureView.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts?solo";');
      if (id.endsWith("/src/views/PlayerTableView.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts?table";');
      if (id.endsWith("/src/views/PlayerLobbyView.tsx")) return code.replace('import React, { useState } from "react";', 'import * as React from "/tests/fixtures/appHooks.ts?lobby"; import { useState } from "/tests/fixtures/appHooks.ts?lobby";');
    } }] });
  const oldFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts?solo");
    const tableHooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts?table");
    const lobbyHooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts?lobby");
    const { default: Solo } = await server.ssrLoadModule("/src/views/SoloAdventureView.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const { default: Lobby } = await server.ssrLoadModule("/src/views/PlayerLobbyView.tsx");
    let multiplayer = 0, retries = 0;
    let requests: Record<string, unknown>[] = [];
    const reset = () => { hooks.resetHooks(); tableHooks.resetHooks(); lobbyHooks.resetHooks(); requests = [];
      globalThis.fetch = async (_url, opts) => { requests.push(JSON.parse(String(opts?.body))); return new Response(JSON.stringify(response())); }; };
    const render = (resp = response(), connectionLost = false) => { hooks.beginRender(); return Solo({ resp, playerId: "solo_player", connectionLost,
      run: async (p: Promise<ActionResponse>) => p, onMultiplayer: () => multiplayer++, onRetry: async () => { retries++; } }); };
    const tableProps = (r = response(), lost = false) => find(render(r, lost), p => p.sceneNarrative !== undefined)!;
    const table = (r = response(), lost = false) => { const p = tableProps(r, lost); tableHooks.beginRender(); return Table(p); };
    const lobby = (r = lobbyResponse(), lost = false) => { const p = find(render(r, lost), p => p.currentActorId === "solo_player" && p.onAction !== undefined)!;
      lobbyHooks.beginRender(); return Lobby(p); };

    await t.test("same board composition, story above scene, notes alongside, no fake Azzardo", () => {
      reset(); const tree = table(), html = renderToStaticMarkup(tree);
      for (const text of ["Saloon Table", "saloon-table", "Difficulty / Scene", "Scene Participation", "Marshal&#x27;s notes"]) assert.ok(html.includes(text), text);
      assert.ok(html.indexOf("Convince the trader") < html.indexOf("Scene Participation"));
      assert.match(html, /Chichimeca.*no eligible target/);
      assert.ok(!html.includes("18 + ?")); assert.ok(!html.includes('title="Azzardo"'));
      const board = find(tree, p => p.rewardCardIds !== undefined)!;
      assert.equal(board.onClickScum, undefined); assert.equal(typeof board.onClickVengeance, "function");
      assert.equal(find(tree, p => p.title === "Draw a card")!.disabled, false);
    });
    await t.test("closed solo results retain cards without carrying them into a new scene or multiplayer", () => {
      reset(); const r = response();
      r.state.meta!.scene!.status = "closed";
      r.state.meta!.solo!.step = "outcome";
      r.state.meta!.solo!.outcome = "bust";
      r.state.meta!.solo!.resolved_hand = ["8S", "6C"];
      r.state.meta!.scene!.players!.solo_player.hand_value = 24;
      delete r.state.zones!["scene.hand.solo_player"];
      const hand = () => find(table(r), p => p.playedCards !== undefined)!.playedCards;
      assert.deepEqual(hand(), ["8S", "6C"]);
      r.state.meta!.scene!.status = "setup";
      assert.deepEqual(hand(), []);
      r.state.meta!.scene!.status = "closed";
      delete r.state.meta!.mode;
      assert.deepEqual(hand(), []);
    });
    await t.test("shared Deck keeps revision and duplicate guards", async () => {
      reset(); let resolve: (r: Response) => void = () => {};
      globalThis.fetch = async (_url, opts) => { requests.push(JSON.parse(String(opts?.body))); return new Promise<Response>(done => { resolve = done; }); };
      const button = find(table(), p => p.title === "Draw a card")!;
      const first = (button.onClick as () => Promise<void>)(), second = (button.onClick as () => Promise<void>)();
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0], { game_id: "solo", action: "gf.scene_draw_card", params: { player_id: "solo_player" }, view: "player", viewer_id: "solo_player", expected_revision: 7 });
      resolve(new Response(JSON.stringify(response()))); await Promise.all([first, second]);
    });
    await t.test("shared Vengeance stack keeps the authenticated solo transport", async () => {
      reset(); const board = find(table(), p => p.rewardCardIds !== undefined)!;
      await (board.onClickVengeance as () => Promise<void>)();
      assert.equal(requests[0].action, "gf.scene_play_vengeance"); assert.equal(requests[0].expected_revision, 7);
      assert.deepEqual(requests[0].params, { player_id: "solo_player" });
    });
    await t.test("Saloon selection works with closed multiplayer registration", async () => {
      reset(); const html = renderToStaticMarkup(lobby());
      for (const text of ["Saloon Lobby", "Available Figures", "Your Figure"]) assert.ok(html.includes(text));
      const card = find(lobby(), p => p.title === "Claim KD")!; assert.equal(card.disabled, false);
      (card.onClick as () => void)(); await Promise.resolve();
      assert.equal(requests[0].action, "gf.claim_character"); assert.equal(requests[0].expected_revision, 7);
      assert.deepEqual(requests[0].params, { player_id: "solo_player", card_id: "KD" });
    });
    await t.test("Chichimeca warns before claim and offers confirmation or another faction", async () => {
      reset(); (find(lobby(), p => p.title === "Claim KS")!.onClick as () => void)(); assert.equal(requests.length, 0);
      let tree = lobby(); assert.match(renderToStaticMarkup(tree), /disadvantage/);
      (find(tree, p => p.children === "Choose another faction")!.onClick as () => void)();
      assert.equal(find(lobby(), p => p.children === "Play Chichimeca"), undefined);
      (find(lobby(), p => p.title === "Claim KS")!.onClick as () => void)(); tree = lobby();
      await (find(tree, p => p.children === "Play Chichimeca")!.onClick as () => Promise<void>)();
      assert.deepEqual(requests[0].params, { player_id: "solo_player", card_id: "KS" });
    });
    await t.test("Saloon suggestions and ready stage use shared controls", async () => {
      reset(); const r = lobbyResponse(); r.state.zones!["players.solo_player.character"] = ["KD"];
      r.state.meta!.lobby!.players!.solo_player = { stage: "waiting_for_name", card_id: "KD", name_suggestions: ["Dust"] };
      await (find(lobby(r), p => p.children === "Dust")!.onClick as () => Promise<void>)();
      assert.equal(requests[0].action, "gf.submit_character_name"); assert.equal(requests[0].expected_revision, 7);
      r.state.meta!.lobby!.players!.solo_player = { stage: "waiting_for_feature", card_id: "KD", feature_suggestions: ["a red coat"] };
      await (find(lobby(r), p => p.children === "a red coat")!.onClick as () => Promise<void>)();
      assert.equal(requests[1].action, "gf.submit_character_feature");
      r.state.meta!.lobby!.players!.solo_player = { stage: "ready", card_id: "KD" };
      const tree = lobby(r); assert.ok(!renderToStaticMarkup(tree).includes("Waiting for the Marshal to start"));
      await (find(tree, p => p.children === "Begin the adventure")!.onClick as () => Promise<void>)();
      assert.equal(requests[2].action, "gf.solo_continue");
    });
    await t.test("terminal invitation stays on the table with gameplay disabled", async () => {
      reset(); for (const ending of ["death", "ascension", "exhaustion"] as const) {
        const r = response(); r.state.meta!.solo!.ending = ending; r.state.meta!.solo!.step = "ending"; r.state.meta!.phase = "victory";
        const props = tableProps(r); assert.equal(props.readOnly, true);
        const story = props.sceneNarrative as ReactNode; assert.match(renderToStaticMarkup(story), /Azzardo and Dark/);
        (find(story, p => p.children === "Play multiplayer")!.onClick as () => void)();
        await (find(story, p => p.children === (ending === "death" ? "Retry solo" : "Play solo again"))!.onClick as () => Promise<void>)();
        assert.equal(find(table(r), p => p.title === "Continue the story above the scene.")!.disabled, true);
      }
      assert.equal(multiplayer, 3); assert.equal(retries, 3); assert.equal(requests.length, 0);
    });
    await t.test("obligations gate story continuation; disconnect disables shared controls", () => {
      reset(); const r = response(); r.state.meta!.solo!.step = "outcome"; r.state.meta!.solo!.outcome = "success";
      for (const obligation of ["needs_heal", "needs_discard"] as const) {
        r.state.meta!.solo![obligation] = true;
        assert.equal(find(tableProps(r).sceneNarrative as ReactNode, p => p.children === "Continue the trail")!.disabled, true);
        r.state.meta!.solo![obligation] = false;
      }
      assert.equal(find(table(response(), true), p => p.title === "Connection lost")!.disabled, true);
      assert.equal(find(lobby(lobbyResponse(), true), p => p.title === "Claim KD")!.disabled, true);
    });
    await t.test("a wounded outlaw keeps a Continue the duel action", async () => {
      reset(); const r = response(); r.state.meta!.solo!.node = "duel";
      r.state.meta!.solo!.step = "outcome"; r.state.meta!.solo!.outcome = "bust";
      const story = tableProps(r).sceneNarrative as ReactNode;
      assert.equal(find(story, p => p.children === "Continue the trail"), undefined);
      const button = find(story, p => p.children === "Continue the duel")!;
      assert.equal(button.disabled, false);
      await (button.onClick as () => Promise<void>)();
      assert.equal(requests[0].action, "gf.solo_continue");
      assert.equal(requests[0].expected_revision, 7);
    });
    await t.test("multiplayer Saloon keeps registration and waiting behavior", () => {
      reset(); const r = lobbyResponse(); delete r.state.meta!.mode; delete r.state.meta!.solo;
      const p = { resp: r, view: "player", currentActorId: "solo_player", run: async (p: Promise<ActionResponse>) => p };
      lobbyHooks.beginRender(); assert.equal(find(Lobby(p), p => p.title === "Registration is closed")!.disabled, true);
      r.state.meta!.lobby!.players!.solo_player = { stage: "ready", card_id: "KD" };
      lobbyHooks.beginRender(); assert.match(renderToStaticMarkup(Lobby(p)), /Waiting for the Marshal to start the game/);
      assert.equal(requests.length, 0);
    });
  } finally { globalThis.fetch = oldFetch; await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
});

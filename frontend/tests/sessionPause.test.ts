import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { isGameplayPaused } from "../src/utils/sessionPause.ts";
import type { GameMeta } from "../src/api/types.ts";
import { chichimecaLiveResponse } from "./fixtures/chichimecaLiveState.ts";

test("only explicit authoritative paused true pauses gameplay", () => {
  assert.equal(isGameplayPaused({ session_pause: { paused: true, reason: "marshal_offline" } }), true);
  for (const meta of [null, undefined, {}, { presence: { marshal: { online: false } } },
    { session_pause: { paused: false, reason: null } }, { session_pause: { paused: "true" } }]) {
    assert.equal(isGameplayPaused(meta as GameMeta), false);
  }
});

test("authoritative pause gates table and hook mutations while preserving information and navigation", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
    plugins: [{ name: "pause-hooks", enforce: "pre", transform(code, id) {
      if (/\/src\/(views\/(PlayerTableView|MarshalTableView|HookSelectionView|PlayerLobbyView|MarshalLobbyView)|utils\/useDarkHandActions)\.tsx?$/.test(id)) {
        return code.replace('import React, { useState } from "react";',
          'import * as React from "/tests/fixtures/appHooks.ts"; import { useState } from "/tests/fixtures/appHooks.ts";')
          .replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
      }
    } }] });
  const oldFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const { default: Player } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const { default: Marshal } = await server.ssrLoadModule("/src/views/MarshalTableView.tsx");
    const { default: Hook } = await server.ssrLoadModule("/src/views/HookSelectionView.tsx");
    const { default: Victory } = await server.ssrLoadModule("/src/views/VictoryView.tsx");
    const { default: MarshalLobby } = await server.ssrLoadModule("/src/views/MarshalLobbyView.tsx");
    const { default: Lobby } = await server.ssrLoadModule("/src/views/PlayerLobbyView.tsx");
    const response = structuredClone(chichimecaLiveResponse);
    response.state.meta!.pending_interaction = null;
    response.state.meta!.scene = { status: "active", participants: ["player-nnu30f", "player-o2o9sa"], players: { "player-nnu30f": {} } };
    response.state.meta!.presence = { marshal: { online: false }, "player-o2o9sa": { online: false } };
    const common = { resp: response, view: "player", currentActorId: "player-nnu30f", onBackHome: () => {},
      run: () => { throw Error("paused callbacks must not submit"); } };
    const render = (component: unknown, props: object) => {
      hooks.resetHooks();
      return renderToStaticMarkup(createElement(component as typeof Table, props));
    };
    const button = (html: string, title: string) => html.match(new RegExp(`<button\\b[^>]*title="${title}"[^>]*>`))![0];
    const informational = render(Table, common);
    assert.ok(!informational.includes("THE GAME IS PAUSED"));
    assert.doesNotMatch(button(informational, "Draw a card"), /disabled/);
    response.state.meta!.session_pause = { paused: false, reason: null };
    assert.doesNotMatch(button(render(Table, common), "Stay"), /disabled/);
    response.state.meta!.presence!.marshal.online = true;
    assert.ok(!render(Table, common).includes("THE GAME IS PAUSED"), "ordinary player offline has no global effect");
    response.state.meta!.session_pause = { paused: true, reason: "marshal_offline" };
    delete response.state.meta!.presence;
    const paused = render(Table, common);
    assert.ok(paused.includes("THE MARSHAL IS OFFLINE — THE GAME IS PAUSED"));
    assert.ok(paused.includes("Waiting for the Marshal to reconnect."));
    assert.match(button(paused, "Game paused while the Marshal is offline"), /disabled/);
    assert.match(button(paused, "Stay"), /disabled/);
    assert.doesNotMatch(button(paused, "Return to Home"), /disabled/);
    assert.doesNotMatch(button(paused, "Refresh Table"), /disabled/);
    response.state.meta!.session_pause = { paused: false, reason: null };
    const resumed = render(Table, common);
    assert.ok(!resumed.includes("THE GAME IS PAUSED"));
    assert.doesNotMatch(button(resumed, "Draw a card"), /disabled/);
    assert.doesNotMatch(button(resumed, "Stay"), /disabled/);
    response.state.meta!.session_pause = { paused: true, reason: "marshal_offline" };
    globalThis.fetch = async () => { throw Error("paused mutation attempted network request"); };
    // Invoke callbacks directly too: disabled styling is not the submission guard.
    const visit = async (node: ReactNode): Promise<void> => {
      if (Array.isArray(node)) { for (const child of node) await visit(child); return; }
      if (!isValidElement<Record<string, unknown>>(node)) return;
      for (const [name, value] of Object.entries(node.props)) {
        if (typeof value !== "function") continue;
        if (name === "onStay" || name === "onAcknowledge" || name.startsWith("onForce") || name === "onReclaim") await value();
      }
      if (node.type === "button" && typeof node.props.onClick === "function" && node.props.disabled) await node.props.onClick();
      await visit(node.props.children as ReactNode);
    };
    hooks.resetHooks(); await visit(Player(common));
    response.state.meta!.pending_interaction = chichimecaLiveResponse.state.meta!.pending_interaction;
    assert.ok(render(Table, common).includes("Children of the Earth · Choose an enemy"));
    hooks.resetHooks(); await visit(Player(common));
    const marshalProps = { ...common, currentActorId: "marshal", view: "marshal" };
    const marshalHtml = render(Table, marshalProps);
    assert.match(marshalHtml, /<button[^>]*disabled[^>]*>Reclaim interaction<\/button>/);
    assert.doesNotMatch(button(marshalHtml, "Refresh Table"), /disabled/);
    hooks.resetHooks(); await visit(Marshal(marshalProps));
    const { useDarkHandActions } = await server.ssrLoadModule("/src/utils/useDarkHandActions.ts");
    hooks.resetHooks();
    const dark = useDarkHandActions(response, "marshal", "marshal", common.run);
    for (const action of ["gf.scene_roll_difficulty", "gf.scene_dark_draw", "gf.scene_dark_discard_last", "gf.scene_dark_reveal"]) await dark.submit(action);

    response.state.meta!.hooks = { suggestions: ["Test hook"] };
    const hookHtml = render(Hook, marshalProps);
    assert.match(hookHtml, /<button[^>]*disabled[^>]*>Bring the Frontier to life!!<\/button>/);
    assert.match(hookHtml, /Test hook/);
    hooks.resetHooks(); await visit(Hook(marshalProps));
    // The transport blocker uses the same handler guards, without pause authority.
    response.state.meta!.session_pause = { paused: false, reason: null };
    response.state.meta!.pending_interaction = null;
    const disconnectedPlayer = { ...common, connectionLost: true };
    const disconnectedMarshal = { ...marshalProps, connectionLost: true };
    const offlineHtml = render(Table, disconnectedPlayer);
    assert.match(button(offlineHtml, "Connection lost"), /disabled/);
    assert.match(button(offlineHtml, "Stay"), /disabled/);
    assert.doesNotMatch(offlineHtml, /THE GAME IS PAUSED|aria-description="Game paused/);
    assert.doesNotMatch(button(offlineHtml, "Return to Home"), /disabled/);
    assert.doesNotMatch(button(offlineHtml, "Refresh Table"), /disabled/);
    hooks.resetHooks(); await visit(Player(disconnectedPlayer));
    hooks.resetHooks(); await visit(Marshal(disconnectedMarshal));
    hooks.resetHooks(); await visit(Hook(disconnectedMarshal));
    hooks.resetHooks();
    const offlineDark = useDarkHandActions(response, "marshal", "marshal", common.run, true);
    for (const action of ["gf.scene_roll_difficulty", "gf.scene_dark_draw", "gf.scene_dark_discard_last", "gf.scene_dark_reveal"]) await offlineDark.submit(action);
    assert.match(render(Hook, disconnectedMarshal), /<button[^>]*disabled[^>]*>Bring the Frontier to life!!<\/button>/);
    assert.doesNotMatch(button(render(Table, common), "Stay"), /disabled/);
    response.state.meta!.session_pause = { paused: false, reason: null };
    response.state.meta!.presence = { marshal: { online: false } };
    response.state.meta!.lobby!.players!["player-nnu30f"] = { stage: "waiting_for_figure" };
    response.state.meta!.lobby!.registration_open = true;
    response.state.zones!["lobby.figure_pool.available"] = ["JS"];
    const lobbyHtml = render(Lobby, common);
    assert.ok(lobbyHtml.includes("Marshal:"));
    assert.match(lobbyHtml, /<button[^>]*title="Claim JS"/);
    assert.doesNotMatch(button(lobbyHtml, "Claim JS"), /disabled/);
    const offlineLobby = { ...common, connectionLost: true };
    assert.match(button(render(Lobby, offlineLobby), "Claim JS"), /disabled/);
    hooks.resetHooks(); await visit(Lobby(offlineLobby));
    const offlineMarshalLobby = { ...marshalProps, connectionLost: true, selectedPlayerId: "player-nnu30f", setSelectedPlayerId: () => {} };
    hooks.resetHooks(); await visit(MarshalLobby(offlineMarshalLobby));
    // Dark transport rejections must reach App.run rather than become UI error projections.
    let transportReachedRun = false;
    hooks.resetHooks();
    response.state.meta!.scene = { status: "setup", dark_mode: true, participants: ["player-nnu30f"] };
    // Render again after installing an allowed Dark setup state.
    hooks.resetHooks();
    const enabledDark = useDarkHandActions(response, "marshal", "marshal", async (p: Promise<unknown>) => {
      await assert.rejects(p, /paused mutation attempted network request/);
      transportReachedRun = true;
      return response;
    });
    await enabledDark.submit("gf.scene_roll_difficulty");
    assert.equal(transportReachedRun, true);
    const victoryHtml = render(Victory, { winnerLabel: "Winner", onBackHome: () => {} });
    assert.ok(victoryHtml.includes("Winner"));
    assert.doesNotMatch(victoryHtml, /disabled/);
  } finally { globalThis.fetch = oldFetch; await server.close(); }
});

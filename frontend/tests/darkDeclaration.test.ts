import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { GameState } from "../src/api/types.ts";
import { canDeclareDark, hasDarkAtmosphere } from "../src/utils/dark.ts";
import { yankeeLiveState } from "./fixtures/yankeeLiveState.ts";

function setup(): GameState {
  return { meta: { marshal_id: "marshal", scene: { status: "setup", mode: "standard",
    dark_mode: false, difficulty: { card_id: null }, azzardo: { status: "unavailable", card_id: null } } } };
}

test("declaration mirrors setup gates, Marshal identity and pending lock", () => {
  assert.equal(canDeclareDark(setup(), "marshal"), true);
  assert.equal(canDeclareDark(setup(), "player"), false);
  assert.equal(canDeclareDark({}, ""), false);
  for (const change of [
    { status: "idle" }, { status: "active" }, { status: "awaiting_ack" }, { status: "resolved" }, { status: "closed" },
    { difficulty: { card_id: "RJ" } }, { dark_mode: true }, { mode: "duel", duel: { subtype: "pvp" } },
    { azzardo: { status: "drawn" } }, { azzardo: { status: "skipped" } }, { azzardo: { card_id: "AH" } },
  ]) {
    const state = setup();
    Object.assign(state.meta!.scene!, change);
    assert.equal(canDeclareDark(state, "marshal"), false, JSON.stringify(change));
  }
  const npc = setup();
  Object.assign(npc.meta!.scene!, { mode: "duel", duel: { subtype: "npc" } });
  assert.equal(canDeclareDark(npc, "marshal"), true);
  npc.meta!.pending_interaction = { kind: "test", actor_id: "marshal", allowed_actions: [], payload: {}, continuation: null };
  assert.equal(canDeclareDark(npc, "marshal"), false);
});

test("icon, explanatory tooltip, both table atmospheres and privacy", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const render = (actor: string, dark: boolean, status = "setup", revealed = false) => {
      const resp = yankeeLiveState(actor);
      resp.state.meta!.pending_interaction = null;
      Object.assign(resp.state.meta!.scene!, setup().meta!.scene, { status, dark_mode: dark, dark: { revealed } });
      return renderToStaticMarkup(createElement(Table, { resp, currentActorId: actor,
        view: actor === "marshal" ? "marshal" : "player", run: () => { throw Error("render must not act"); }, onBackHome: () => {} }));
    };
    const ordinary = render("marshal", false);
    assert.match(ordinary, /<button[^>]*aria-label="Declare the Dark"[^>]*aria-describedby="[^"]+"/);
    assert.match(ordinary, /src="[^"]*ui\/dark-mode.svg"/);
    assert.ok(ordinary.includes('role="tooltip"'));
    assert.ok(ordinary.includes("Use for final duels, spiritual trials, or moments when destiny manifests."));
    assert.ok(ordinary.includes("hand stays hidden until all players have finished."));
    assert.ok(!ordinary.includes('title="Declare the Dark"'), "custom tooltip replaces native title");
    for (const actor of ["marshal", "yankee-a"]) {
      assert.ok(!render(actor, false).includes("dark-mode-active"));
      assert.ok(!render(actor, true, "closed", true).includes("dark-mode-active"));
      for (const revealed of [false, true]) {
        const html = render(actor, true, "setup", revealed);
        assert.ok(html.includes('class="saloon-table dark-mode-active"'));
        assert.ok(!html.includes('aria-label="Declare the Dark"'));
        if (actor === "marshal") {
          assert.ok(html.includes("Dark declared. Draw the hidden difficulty."));
          assert.ok(!html.includes("Click deck to draw azzardo"));
        }
        assert.ok(!html.includes("marshal_total") && !html.includes("must_discard_last"));
      }
    }
    const resp = yankeeLiveState("marshal");
    resp.state.meta!.pending_interaction = null;
    Object.assign(resp.state.meta!.scene!, setup().meta!.scene, { dark_mode: true, difficulty: { card_id: "RJ", value: 20 } });
    const html = renderToStaticMarkup(createElement(Table, { resp, currentActorId: "marshal", view: "marshal",
      run: () => { throw Error("render must not act"); }, onBackHome: () => {} }));
    assert.ok(html.includes("Dark declared. Start the scene when ready."));
    assert.ok(!html.includes("Each player receives") && !html.includes("Click to draw azzardo"));
    assert.match(html, /<button[^>]*disabled=""[^>]*title="Dark setup: deck unavailable"/);
    // Public/player projection has no secret card, total or discard identities to render.
    resp.state.meta!.scene!.difficulty = { card_id: null, value: null };
    resp.state.meta!.scene!.dark = { revealed: false };
    resp.state.zones!["scene.dark.marshal_hand"] = [];
    resp.state.deck!.discard_pile = { count: 3 };
    const player = renderToStaticMarkup(createElement(Table, { resp, currentActorId: "yankee-a", view: "player",
      run: () => { throw Error("render must not act"); }, onBackHome: () => {} }));
    assert.ok(!player.includes("RJ") && !player.includes("marshal_total") && !player.includes("must_discard_last"));
    const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
    assert.match(css, /\.dark-declare-control:hover \.dark-declare-tooltip/);
    assert.match(css, /\.dark-declare-control:focus-within \.dark-declare-tooltip/);
    assert.match(css, /\.saloon-table.dark-mode-active::before\s*\{[^}]*position: absolute;[^}]*pointer-events: none;/);
    assert.equal(hasDarkAtmosphere({ dark_mode: true, status: "resolved", dark: { revealed: true } }), true);
  } finally { await server.close(); }
});

test("declaration sends the Marshal request once, awaits authority and unlocks after failure", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom", plugins: [{
      name: "dark-control-hooks", enforce: "pre", transform(code, id) {
        if (id.endsWith("/src/components/DarkDeclareControl.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
      },
    }] });
  const originalFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Control } = await server.ssrLoadModule("/src/components/DarkDeclareControl.tsx");
    hooks.resetHooks();
    const state = setup();
    const before = structuredClone(state);
    const requests: unknown[] = [];
    let finish: (response: Response) => void = () => {};
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Promise<Response>(resolve => { finish = resolve; });
    };
    const props = { state, gameId: "game", actorId: "marshal", view: "marshal", run: (p: Promise<unknown>) => p };
    const tree = Control(props);
    const click = tree.props.children[0].props.onClick;
    const pending = click();
    await click();
    assert.deepEqual(requests, [{ game_id: "game", action: "gf.scene_declare_dark", params: { actor_id: "marshal" }, view: "marshal", viewer_id: "marshal" }]);
    hooks.beginRender();
    assert.equal(Control(props).props.children[0].props.disabled, true);
    assert.deepEqual(state, before, "no optimistic declaration");
    finish(new Response(JSON.stringify({ error: { message: "rejected" } })));
    await pending;
    hooks.beginRender();
    const retried = Control(props);
    assert.equal(retried.props.children[0].props.disabled, false);
    state.meta!.scene!.dark_mode = true;
    hooks.beginRender();
    const active = Control(props);
    assert.equal(active.props.children[0].props.disabled, true);
    await active.props.children[0].props.onClick();
    assert.equal(requests.length, 1);
    hooks.resetHooks();
  } finally { globalThis.fetch = originalFetch; await server.close(); }
});

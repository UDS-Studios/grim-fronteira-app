import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import type { ActionRequest, ActionResponse } from "../src/api/types.ts";
import { canDarkDraw, canDarkDiscardLast, canDarkReveal, countUnfinishedDarkParticipants } from "../src/utils/dark.ts";
import { getViewportFit } from "../src/utils/viewportFit.ts";

function fixture(): ActionResponse {
  return { game_id: "dark", revision: 8, events: [], error: null, result: {}, state: {
    meta: { phase: "table", marshal_id: "host", players_order: ["p1", "p2"],
      scene: { status: "active", mode: "standard", dark_mode: true,
        difficulty: { card_id: "RJ", value: 20 },
        dark: { revealed: false, marshal_total: 17, must_discard_last: false },
        participants: ["p1", "p2"], players: { p1: { standing: true }, p2: { busted: true } } } },
    zones: { "scene.difficulty": ["RJ"], "scene.dark.marshal_hand": ["AH", "5D"] },
    deck: { draw_pile: { count: 40 }, discard_pile: { count: 3 } },
  } };
}

test("Dark action gates use backend flags, total and completion in setup and active", () => {
  const response = fixture();
  const state = response.state;
  const scene = state.meta!.scene!;
  assert.equal(canDarkDraw(state, "host"), true);
  assert.equal(canDarkReveal(state, "host"), true);
  assert.equal(canDarkDiscardLast(state, "host"), false);
  assert.equal(countUnfinishedDarkParticipants(scene), 0);
  scene.status = "setup";
  assert.equal(canDarkDraw(state, "host"), true);
  assert.equal(canDarkReveal(state, "host"), false);
  scene.status = "active";
  scene.players!.p1.standing = false;
  assert.equal(countUnfinishedDarkParticipants(scene), 1);
  assert.equal(canDarkReveal(state, "host"), false);
  delete scene.players!.p2;
  assert.equal(countUnfinishedDarkParticipants(scene), 2);
  scene.dark!.must_discard_last = true;
  scene.dark!.marshal_total = 27;
  assert.equal(canDarkDraw(state, "host"), false);
  assert.equal(canDarkReveal(state, "host"), false);
  assert.equal(canDarkDiscardLast(state, "host"), true);
  state.zones!["scene.dark.marshal_hand"] = [];
  assert.equal(canDarkDiscardLast(state, "host"), false);
  for (const total of [undefined, null, 22]) {
    const current = fixture().state;
    current.meta!.scene!.dark!.marshal_total = total;
    assert.equal(canDarkDraw(current, "host"), false);
    assert.equal(canDarkReveal(current, "host"), false);
  }
  const empty = fixture().state;
  empty.meta!.scene!.participants = [];
  assert.equal(canDarkReveal(empty, "host"), false);
  for (const invalid of ["phase", "actor", "ordinary", "pvp", "revealed", "idle", "awaiting_ack", "resolved", "closed", "difficulty", "pending"]) {
    const current = fixture().state;
    const s = current.meta!.scene!;
    if (invalid === "phase") current.meta!.phase = "lobby";
    else if (invalid === "ordinary") s.dark_mode = false;
    else if (invalid === "pvp") { s.mode = "duel"; s.duel = { subtype: "pvp" }; }
    else if (invalid === "revealed") s.dark!.revealed = true;
    else if (invalid === "difficulty") s.difficulty!.card_id = null;
    else if (invalid === "pending") current.meta!.pending_interaction = { kind: "test", actor_id: "p1", allowed_actions: [], payload: {}, continuation: null };
    else if (invalid !== "actor") s.status = invalid;
    const actor = invalid === "actor" ? "p1" : "host";
    assert.equal(canDarkDraw(current, actor), false, invalid);
    assert.equal(canDarkReveal(current, actor), false, invalid);
    s.dark!.must_discard_last = true;
    assert.equal(canDarkDiscardLast(current, actor), false, invalid);
  }
});

test("private ordered fan replaces difficulty once, reads total and remains bounded", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const render = (resp: ActionResponse, actor = "host", view = "marshal") => renderToStaticMarkup(createElement(Table,
      { resp, view, currentActorId: actor, run: () => { throw Error("render must not submit"); }, onBackHome: () => {} }));
    const resp = fixture();
    const html = render(resp);
    assert.ok(html.includes("dark-mode-active"));
    assert.deepEqual([...html.matchAll(/aria-label="(Opening difficulty|Extra draw \d+): ([^"]+)"/g)].map(m => m[2]), ["RJ", "AH", "5D"]);
    assert.equal((html.match(/alt="RJ"/g) ?? []).length, 1);
    assert.ok(html.includes("MARSHAL TOTAL"));
    assert.match(html, />17<\/strong>/);
    assert.ok(!html.includes("Difficulty card"));
    assert.ok(html.includes("All players have chosen. You may reveal."));
    assert.match(html, /<button[^>]*class="marshal-dark-reveal"(?![^>]*disabled)[^>]*>REVEAL/);
    resp.state.meta!.scene!.players!.p1.standing = false;
    assert.ok(render(resp).includes("Waiting for 1 player"));
    resp.state.meta!.scene!.players!.p2.busted = false;
    assert.ok(render(resp).includes("Waiting for 2 players"));
    resp.state.meta!.scene!.players!.p1.standing = true;
    resp.state.meta!.scene!.players!.p2.busted = true;
    resp.state.meta!.scene!.dark!.marshal_total = null;
    assert.match(render(resp), />—<\/strong>/);
    resp.state.meta!.scene!.dark = { revealed: false, marshal_total: 27, must_discard_last: true };
    const bust = render(resp);
    assert.ok(bust.includes("You have gone over 21. Click the last Dark card to discard it before continuing."));
    assert.match(bust, /data-forced-discard="true" aria-label="Extra draw 2: 5D. Must discard last"/);
    assert.ok(!html.includes(">DRAW</button>") && !bust.includes(">DRAW</button>"));
    assert.ok(!bust.includes(">DISCARD LAST</button>"));
    assert.match(bust, /<button[^>]*aria-label="Draw from deck"[^>]*disabled=""/);
    assert.match(bust, /<button[^>]*class="marshal-dark-reveal"[^>]*disabled=""[^>]*>REVEAL/);
    assert.match(bust, /<button[^>]*class="marshal-dark-discard-card"[^>]*aria-label="Discard last Dark card: 5D"(?![^>]*disabled)/);
    assert.equal((bust.match(/<button[^>]*aria-label="Discard last Dark card:/g) ?? []).length, 1);
    assert.ok(!bust.includes('aria-label="Discard last Dark card: RJ"'));
    assert.ok(!bust.includes('aria-label="Discard last Dark card: AH"'));
    // Redacted backend projection contains no data to reconstruct or cache.
    const player = fixture();
    player.state.meta!.scene!.difficulty = { card_id: null, value: null };
    player.state.meta!.scene!.dark = { revealed: false };
    player.state.zones = { "scene.difficulty": [], "scene.dark.marshal_hand": [] };
    const publicHtml = render(player, "p1", "player");
    for (const secret of ["RJ", "AH", "5D", "MARSHAL TOTAL", "marshal_total", "must_discard_last", "DISCARD LAST", "marshal-dark-hand"]) {
      assert.ok(!publicHtml.includes(secret), secret);
    }
    assert.ok(publicHtml.includes("dark-mode-active"));
    assert.ok(!render(player, "host", "player").includes('class="marshal-dark-hand"'));
    resp.state.meta!.scene!.dark!.revealed = true;
    assert.ok(!render(resp).includes('class="marshal-dark-hand"'));
    assert.ok(render(resp).includes("dark-mode-active"));
    const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
    assert.match(css, /\.marshal-dark-cards\s*\{[^}]*height: 168px/);
    for (const count of [1, 5, 20, 54]) {
      const many = fixture();
      many.state.zones!["scene.dark.marshal_hand"] = Array.from({ length: count - 1 }, () => "2C");
      assert.ok(render(many).includes(`repeat(${count}, minmax(0, 86px))`));
      for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720]]) {
        const fit = getViewportFit(w - 16, h - 70, 1800, 1500);
        assert.equal(fit.fallback, false);
        assert.ok(1800 * fit.scale <= w - 16 && 1500 * fit.scale <= h - 70 + .001);
      }
    }
  } finally { await server.close(); }
});

function buttons(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return node.type === "button" ? [node.props] : buttons(node.props.children as ReactNode);
}

function findProps(node: ReactNode, type: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => findProps(child, type)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return node.type === type ? node.props : findProps(node.props.children as ReactNode, type);
}

test("physical Deck and forced card send exact requests and share the Reveal busy lock", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom", plugins: [{
      name: "dark-hand-hooks", enforce: "pre", transform(code, id) {
        if (["/src/components/MarshalDarkHand.tsx", "/src/views/MarshalTableView.tsx", "/src/utils/useDarkHandActions.ts"].some(path => id.endsWith(path))) {
          return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
        }
      },
    }] });
  const originalFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Hand } = await server.ssrLoadModule("/src/components/MarshalDarkHand.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/MarshalTableView.tsx");
    for (const [scenario, action] of [["opening", "gf.scene_roll_difficulty"], ["setup", "gf.scene_dark_draw"],
      ["active", "gf.scene_dark_draw"], ["discard", "gf.scene_dark_discard_last"], ["reveal", "gf.scene_dark_reveal"]]) {
      for (const failure of [false, true]) {
        hooks.resetHooks();
        const resp = fixture();
        if (scenario === "opening" || scenario === "setup") resp.state.meta!.scene!.status = "setup";
        if (scenario === "opening") {
          resp.state.meta!.scene!.difficulty = { card_id: null, value: null };
          resp.state.meta!.scene!.dark = { revealed: false };
          resp.state.zones!["scene.dark.marshal_hand"] = [];
        }
        if (scenario === "discard") resp.state.meta!.scene!.dark = { revealed: false, marshal_total: 27, must_discard_last: true };
        const before = structuredClone(resp);
        const requests: ActionRequest[] = [];
        let finish: (r: Response) => void = () => {};
        globalThis.fetch = async (_url, options) => {
          requests.push(JSON.parse(String(options?.body)));
          return new Promise<Response>(resolve => { finish = resolve; });
        };
        let received: ActionResponse | undefined;
        const props = { resp, currentActorId: "host", view: "marshal", onBackHome: () => {},
          run: async (p: Promise<ActionResponse>) => { received = await p; return received; } };
        const render = () => {
          hooks.beginRender();
          const tree = Table(props);
          const deck = buttons(tree).find(b => b["aria-label"] === "Draw from deck")!;
          const hand = buttons(Hand(findProps(tree, Hand)!));
          return { deck, hand };
        };
        const first = render();
        const target = scenario === "discard" ? first.hand.find(b => b["aria-label"] === "Discard last Dark card: 5D")!
          : scenario === "reveal" ? first.hand.find(b => b.children === "REVEAL")! : first.deck;
        assert.equal(target.disabled, false, scenario);
        if (scenario === "discard") assert.equal(first.deck.disabled, true);
        const click = target.onClick as () => Promise<void>;
        const pending = click();
        await click();
        await (first.deck.onClick as () => Promise<void>)();
        for (const button of first.hand) await (button.onClick as () => Promise<void>)();
        const waiting = render();
        assert.equal(waiting.deck.disabled, true);
        assert.ok(waiting.hand.every(b => b.disabled === true));
        assert.deepEqual(resp, before);
        assert.deepEqual(requests, [{ game_id: "dark", action, params: { actor_id: "host" }, view: "marshal", viewer_id: "host" }]);
        const success = fixture();
        success.revision++;
        finish(new Response(JSON.stringify(failure ? { error: { code: "REJECTED", message: "Unavailable", details: null }, state: {} } : success)));
        await pending;
        assert.deepEqual(received?.state, failure ? before.state : success.state);
        const restored = render();
        assert.equal(scenario === "discard" ? restored.hand[0].disabled : scenario === "reveal" ? restored.hand.at(-1)!.disabled : restored.deck.disabled, false);
        assert.deepEqual(resp, before);
      }
    }
    hooks.resetHooks();
  } finally { globalThis.fetch = originalFetch; await server.close(); }
});

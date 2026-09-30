import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import type { ActionResponse, ActionRequest } from "../src/api/types.ts";
import { acceptResponse } from "../src/utils/responseOrdering.ts";
import { getWoundDisplay } from "../src/utils/wounds.ts";

function fixture(): ActionResponse {
  return { game_id: "consequences", revision: 20, events: [], result: {}, error: null, state: {
    meta: { phase: "table", marshal_id: "host", players_order: ["p1"],
      players: { p1: { reward_points: 24, wounds: 1 } },
      scene: { status: "closed", dark_mode: true, dark: { revealed: true, marshal_total: 18 },
        difficulty: { card_id: "8H", value: 18 }, participants: ["p1"],
        players: { p1: { result: "failure", acknowledged: true, wounds_gained: 0, wounds_applied: 1, dark_reward_loss_pending: true, reward_cards_gained: 0 } } } },
    zones: { "players.p1.character": ["KC"], "players.p1.rewards": ["9H", "8C", "7D"],
      "players.p1.scum": ["2D"], "players.p1.vengeance": ["3D"],
      "scene.difficulty": ["8H"], "scene.dark.marshal_hand": ["TC"] },
    deck: { draw_pile: { count: 35 }, discard_pile: { count: 5 } },
  } };
}
function nodes(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node.props, ...nodes(node.props.children as ReactNode)];
}
function find(node: ReactNode, type: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(n => find(n, type)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return node.type === type ? node.props : find(node.props.children as ReactNode, type);
}

const serverOptions = { root: fileURLToPath(new URL("..", import.meta.url)),
  server: { middlewareMode: true, hmr: false as const }, appType: "custom" as const };

test("Dark consequence presentation, independent obligations and Marshal new-scene gating", async () => {
  const server = await createServer(serverOptions);
  try {
    const { default: Player } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const { default: Marshal } = await server.ssrLoadModule("/src/views/MarshalTableView.tsx");
    const render = (r: ActionResponse, marshal = false) => renderToStaticMarkup(createElement(marshal ? Marshal : Player,
      { resp: r, view: marshal ? "marshal" : "player", currentActorId: marshal ? "host" : "p1", run: () => { throw Error("render submitted"); }, onBackHome: () => {} }));
    const r = fixture();
    const html = render(r);
    assert.ok(html.includes("THE DARK DEMANDS PAYMENT"));
    assert.ok(html.includes("Choose 1 Reward to lose before the next scene can begin."));
    assert.match(html, /<button[^>]*disabled=""[^>]*>LOSE REWARD/);
    assert.ok(html.includes(">HEAL<") && html.includes(">SKIP<") && html.includes(">Discard Rewards<"));
    assert.deepEqual(getWoundDisplay(1, r.state.meta!.scene!.players!.p1), { wounds: 1, wounded: true, dead: false });
    assert.ok(render(r, true).includes("Dark Reward loss pending"));
    assert.ok(!render(r, true).includes("Choose Dark Reward") && !render(r, true).includes("LOSE REWARD"));
    assert.match(render(r, true), /<button[^>]*disabled=""[^>]*>New Scene/);
    r.state.meta!.players!.p1 = { reward_points: 7, wounds: 0 };
    assert.match(render(r, true), /<button[^>]*disabled=""[^>]*>New Scene/); // Dark debt alone blocks.
    r.state.meta!.scene!.players!.p1.dark_reward_loss_pending = false;
    assert.ok(!render(r).includes("THE DARK DEMANDS PAYMENT"));
    assert.match(render(r, true), /<button(?![^>]*disabled)[^>]*>New Scene/);
    r.state.zones!["players.p1.rewards"] = [];
    r.state.meta!.players!.p1 = { reward_points: 0, wounds: 1 };
    assert.ok(!render(r).includes("Choose Dark Reward"));
    assert.ok(render(r).includes("The Dark claimed a wound."));
    r.state.meta!.scene!.players!.p1 = { result: "success", reward_cards_gained: 2 };
    assert.ok(render(r).includes("You survived the Dark and earned 2 Rewards."));
    assert.ok(!render(r).includes('alt="9H"')); // No client-generated Rewards.
    r.state.meta!.scene!.status = "awaiting_ack";
    assert.ok(render(r).includes("earned 2 Rewards"));
    r.state.meta!.scene!.players!.p1.result = "failure";
    assert.ok(!render(r).includes("earned 2 Rewards"));
    r.state.meta!.scene!.dark_mode = false;
    r.state.meta!.scene!.players!.p1.result = "success";
    assert.ok(!render(r).includes("earned 2 Rewards"));
  } finally { await server.close(); }
});

test("Dark Reward selection shares modes, validates ownership and submits exactly once without optimism", async () => {
  const server = await createServer({ ...serverOptions, plugins: [{ name: "consequence-hooks", enforce: "pre",
    transform(code, id) { if (id.endsWith("/src/views/PlayerTableView.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";'); },
  }] });
  const originalFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Table } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const { default: Board } = await server.ssrLoadModule("/src/views/player_table/PTV-PlayerBoard.tsx");
    const { default: Payment } = await server.ssrLoadModule("/src/components/DarkRewardPayment.tsx");
    let r = fixture();
    const requests: ActionRequest[] = [];
    let finish: (response: Response) => void = () => {};
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Promise<Response>(resolve => { finish = resolve; });
    };
    const run = async (p: Promise<ActionResponse>) => { const next = await p; if (!next.error) r = next; return next; };
    const render = () => {
      hooks.beginRender();
      const tree = Table({ resp: r, view: "player", currentActorId: "p1", run, onBackHome: () => {} });
      hooks.flushEffects();
      const board = find(tree, Board)!;
      const payment = find(board.rewardActions as ReactNode, Payment);
      const controls = nodes(board.rewardActions as ReactNode);
      return { tree, board, payment, button: (label: string) => controls.find(p => p.children === label)! };
    };
    const click = async (props: Record<string, unknown>, key = "onClick") => { await (props[key] as () => Promise<void>)(); };
    const select = (card: string, index: number) => (render().board.onClickRewardCard as (c: string, i: number) => void)(card, index);
    hooks.resetHooks(); render();
    await click(render().payment!, "onToggle");
    assert.equal(render().payment!.canConfirm, false);
    for (const invalid of ["2D", "3D", "KC", "TC"]) select(invalid, 0);
    assert.deepEqual(render().board.selectedRewardCardIds, []);
    select("9H", 0);
    assert.deepEqual(render().board.selectedRewardCardIds, ["9H:0"]);
    select("8C", 1);
    assert.deepEqual(render().board.selectedRewardCardIds, ["8C:1"]);
    select("8C", 1);
    assert.deepEqual(render().board.selectedRewardCardIds, []);
    select("9H", 0);
    const selectedMarkup = renderToStaticMarkup(createElement(Board, render().board));
    assert.match(selectedMarkup, /aria-label="Select Reward: 9H" aria-pressed="true"/);
    await click(render().button("HEAL"));
    assert.deepEqual(render().board.selectedRewardCardIds, []);
    select("9H", 0); select("8C", 1);
    assert.equal((render().board.selectedRewardCardIds as string[]).length, 2);
    await click(render().payment!, "onToggle");
    assert.deepEqual(render().board.selectedRewardCardIds, []);
    select("7D", 2);
    await click(render().button("Discard Rewards"));
    assert.deepEqual(render().board.selectedRewardCardIds, []);
    assert.equal(render().payment!.active, false);
    select("9H", 0);
    const ordinary = click(render().button("Confirm Discard"));
    assert.equal(requests.at(-1)!.action, "gf.scene_discard_reward");
    finish(new Response(JSON.stringify(r))); await ordinary;
    assert.equal(render().board.rewardSelectionEnabled, false);

    await click(render().payment!, "onToggle"); select("8C", 1);
    const before = structuredClone(r);
    const payment = render().payment!;
    const pending = click(payment, "onConfirm");
    await click(payment, "onConfirm");
    await click(render().button("SKIP"));
    await click(payment, "onToggle");
    assert.deepEqual(r, before);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], { game_id: "consequences", action: "gf.scene_discard_dark_reward",
      params: { player_id: "p1", reward_card_id: "8C" }, view: "player", viewer_id: "p1" });
    assert.equal(render().board.rewardSelectionLocked, true);
    assert.equal(render().payment!.busy, true);
    const after = fixture(); after.revision++;
    after.state.zones!["players.p1.rewards"] = ["9H", "7D"];
    after.state.meta!.players!.p1.reward_points = 16;
    after.state.meta!.scene!.players!.p1.dark_reward_loss_pending = false;
    finish(new Response(JSON.stringify(after))); await pending;
    assert.equal(render().payment, undefined);
    assert.deepEqual(render().board.selectedRewardCardIds, []);
    assert.deepEqual(render().board.rewardCardIds, ["9H", "7D"]);
    assert.equal(acceptResponse(after, before), after); // Generic ordering also covers Rewards.
    assert.ok(render().button("HEAL")); // Remaining healing obligation is still reachable.
    assert.equal(render().button("Discard Rewards"), undefined);

    // A pending interaction clears selection and prevents all Reward submissions.
    r = fixture(); hooks.resetHooks(); render();
    await click(render().payment!, "onToggle"); select("9H", 0);
    r.state.meta!.pending_interaction = { kind: "chichimeca_choose_target", actor_id: "p1", allowed_actions: [], payload: {}, continuation: null };
    render(); render();
    assert.equal(render().payment!.busy, true);
    assert.deepEqual(render().board.selectedRewardCardIds, []);
    await click(render().payment!, "onConfirm");
    assert.equal(requests.length, 2);
    r.state.meta!.pending_interaction = null;
    render(); render();
    await click(render().payment!, "onToggle"); select("9H", 0);
    const rejection = click(render().payment!, "onConfirm");
    finish(new Response(JSON.stringify({ ...r, error: { code: "REJECTED", message: "Try again", details: null } })));
    await rejection;
    assert.equal(render().payment!.busy, false);
    assert.equal(render().payment!.canConfirm, true);
    // A newer authoritative zone invalidates a stale selection rather than discarding a different card.
    r.state.zones!["players.p1.rewards"] = ["8C", "7D"];
    render(); render();
    assert.equal(render().payment!.canConfirm, false);
    hooks.resetHooks();
  } finally { globalThis.fetch = originalFetch; await server.close(); }
});

test("visible Dark lifecycle: count-only setup, player choices, reveal, interaction, acknowledgement, payment and next scene", async () => {
  const server = await createServer({ ...serverOptions, plugins: [{ name: "lifecycle-hooks", enforce: "pre",
    transform(code, id) { if (id.endsWith("/src/views/PlayerTableView.tsx")) return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";'); },
  }] });
  const originalFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Player } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
    const { default: Marshal } = await server.ssrLoadModule("/src/views/MarshalTableView.tsx");
    const { default: Board } = await server.ssrLoadModule("/src/views/player_table/PTV-PlayerBoard.tsx");
    const { default: Payment } = await server.ssrLoadModule("/src/components/DarkRewardPayment.tsx");
    let r = fixture();
    r.state.meta!.players!.p1 = { reward_points: 7, wounds: 0 };
    r.state.zones!["players.p1.rewards"] = ["7D"];
    r.state.zones!["scene.difficulty"] = [];
    r.state.zones!["scene.dark.marshal_hand"] = [];
    r.state.meta!.scene = { status: "setup", dark_mode: false, difficulty: { card_id: null, value: null }, participants: ["p1"], players: { p1: {} } };
    let next = structuredClone(r);
    const requests: ActionRequest[] = [];
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify(next));
    };
    const run = async (p: Promise<ActionResponse>) => { r = await p; return r; };
    const tree = () => {
      hooks.beginRender();
      const result = Player({ resp: r, view: "player", currentActorId: "p1", run, onBackHome: () => {} });
      hooks.flushEffects(); return result;
    };
    const html = () => renderToStaticMarkup(tree());
    const playerAction = async (name: string) => {
      const callback = nodes(tree()).find(p => typeof p[name] === "function")!;
      await (callback[name] as () => Promise<void>)();
    };
    hooks.resetHooks();
    assert.ok(!html().includes("player-dark-hand"));
    // Authoritative public/player snapshots for Marshal declaration and successive draws.
    r.state.meta!.scene!.dark_mode = true; r.state.meta!.scene!.dark = { revealed: false };
    r.state.zones!["scene.difficulty"] = { count: 0 };
    r.state.zones!["scene.dark.marshal_hand"] = { count: 0 };
    assert.ok(html().includes("0 hidden cards"));
    r.state.zones!["scene.difficulty"] = { count: 1 };
    assert.ok(html().includes("1 hidden card"));
    r.state.zones!["scene.dark.marshal_hand"] = { count: 2 };
    assert.ok(html().includes("3 hidden cards"));
    assert.ok(!html().includes('alt="8H"') && !html().includes("MARSHAL TOTAL"));
    r.state.meta!.scene!.status = "active";
    next = structuredClone(r); next.revision++;
    next.state.zones!["scene.hand.p1"] = ["2S"];
    const deck = nodes(tree()).find(p => p.title === "Draw a card")!;
    await (deck.onClick as () => Promise<void>)();
    assert.equal(requests.at(-1)!.action, "gf.scene_draw_card");
    next = structuredClone(r); next.revision++;
    next.state.meta!.scene!.players!.p1.standing = true;
    await playerAction("onStay");
    assert.ok(html().includes("Waiting for the Marshal to reveal the Dark."));
    // Reveal exposes identities and total; the projection also provides the outcome.
    r.state.meta!.scene!.status = "awaiting_ack";
    r.state.meta!.scene!.dark = { revealed: true, marshal_total: 18 };
    r.state.meta!.scene!.difficulty = { card_id: "8H", value: 18 };
    r.state.meta!.scene!.players!.p1.result = "failure";
    r.state.zones!["scene.difficulty"] = ["8H"];
    r.state.zones!["scene.dark.marshal_hand"] = ["TC", "RJ"];
    assert.ok(html().includes('alt="8H"') && html().includes("MARSHAL TOTAL"));
    assert.ok(html().includes("Scum or Vengeance before you acknowledge."));
    r.state.meta!.pending_interaction = { kind: "chichimeca_choose_target", actor_id: "p1", allowed_actions: [], payload: {}, continuation: null };
    const submitted = requests.length;
    await playerAction("onAcknowledge");
    assert.equal(requests.length, submitted);
    assert.ok(html().includes("An interaction is pending."));
    r.state.meta!.pending_interaction = null;
    next = structuredClone(r); next.revision++;
    next.state.meta!.scene!.status = "resolved";
    next.state.meta!.scene!.players!.p1.acknowledged = true;
    await playerAction("onAcknowledge");
    assert.equal(requests.at(-1)!.action, "gf.scene_acknowledge_resolution");
    // Marshal close commits consequences; the player's existing Reward remains until chosen.
    r.state.meta!.scene!.status = "closed";
    r.state.meta!.scene!.players!.p1.dark_reward_loss_pending = true;
    r.state.meta!.scene!.players!.p1.wounds_applied = 1;
    r.state.meta!.players!.p1.wounds = 1;
    assert.ok(html().includes("THE DARK DEMANDS PAYMENT"));
    let board = find(tree(), Board)!;
    const payment = find(board.rewardActions as ReactNode, Payment)!;
    (payment.onToggle as () => void)();
    board = find(tree(), Board)!;
    (board.onClickRewardCard as (c: string, i: number) => void)("7D", 0);
    next = structuredClone(r); next.revision++;
    next.state.meta!.scene!.players!.p1.dark_reward_loss_pending = false;
    next.state.meta!.players!.p1.reward_points = 0;
    next.state.zones!["players.p1.rewards"] = [];
    board = find(tree(), Board)!;
    await (find(board.rewardActions as ReactNode, Payment)!.onConfirm as () => Promise<void>)();
    assert.equal(requests.at(-1)!.action, "gf.scene_discard_dark_reward");
    assert.ok(!html().includes("THE DARK DEMANDS PAYMENT"));
    const marshalHtml = renderToStaticMarkup(createElement(Marshal, { resp: r, currentActorId: "host", view: "marshal", run, onBackHome: () => {} }));
    assert.match(marshalHtml, /<button(?![^>]*disabled)[^>]*>New Scene/);
    r.state.meta!.scene = { status: "setup", dark_mode: false, participants: [], players: {} };
    assert.ok(!html().includes("player-dark-hand"));
    hooks.resetHooks();
  } finally { globalThis.fetch = originalFetch; await server.close(); }
});

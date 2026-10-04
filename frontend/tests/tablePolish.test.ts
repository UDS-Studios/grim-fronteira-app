import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { yankeeLiveState } from "./fixtures/yankeeLiveState.ts";
import { getViewportFit } from "../src/utils/viewportFit.ts";

test("shared discard fans retain order, count, focus and bounded height in both tables", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { default: Discard } = await server.ssrLoadModule("/src/components/DiscardPile.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    for (const count of [1, 12, 13, 24, 25, 54]) {
      const cards = Array.from({ length: count }, (_, i) => `${i % 9 + 2}H`);
      const html = renderToStaticMarkup(createElement(Discard, { cards }));
      const rows = html.split('class="discard-fan-row"').slice(1);
      assert.equal(rows.length, count <= 12 ? 1 : 2);
      const firstRowCount = count <= 12 ? count : Math.max(12, Math.ceil(count / 2));
      assert.equal((rows[0].match(/class="discard-card"/g) ?? []).length, firstRowCount);
      if (rows[1]) assert.equal((rows[1].match(/class="discard-card"/g) ?? []).length, count - firstRowCount);
      assert.ok(html.includes(`aria-label="${count} discarded cards"`));
      assert.ok(html.includes(`height:${count <= 12 ? 154 : 254}px`));
      assert.equal((html.match(/tabindex="0"/g) ?? []).length, count);
      assert.deepEqual([...html.matchAll(/aria-label="Discard (\d+): ([^"]+)"/g)].map(match => [Number(match[1]), match[2]]),
        cards.map((card, i) => [i + 1, card]));
      assert.equal((html.match(/width:102px/g) ?? []).length, count);

      for (const actor of ["yankee-a", "marshal"]) {
        const response = yankeeLiveState(actor);
        response.state.deck!.discard_pile = cards;
        const table = renderToStaticMarkup(createElement(Table, {
          resp: response, currentActorId: actor, view: actor === "marshal" ? "public" : "player",
          run: () => { throw Error("Render must not submit"); }, onBackHome: () => {},
        }));
        assert.ok(table.includes(`Discard · ${count}`));
        assert.equal((table.match(/class="discard-fan-row"/g) ?? []).length, count <= 12 ? 1 : 2);
        assert.ok(table.includes('class="table-viewport"'));
        // Calculation coverage, not measurements of browser scrolling.
        for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720]]) {
          for (const baseHeight of [1015, 1100, 1500]) {
            const boardHeight = baseHeight + (count > 12 ? 100 : 0);
            const fit = getViewportFit(width - 16, height - 70, 1800, boardHeight);
            assert.equal(fit.fallback, false);
            assert.ok(1800 * fit.scale <= width - 16 + 0.001);
            assert.ok(boardHeight * fit.scale <= height - 70 + 0.001);
          }
        }
      }
    }
    assert.ok(renderToStaticMarkup(createElement(Discard, { cards: [] })).includes("empty"));
    const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
    assert.match(css, /\.discard-card:hover, \.discard-card:focus-visible\s*\{\s*z-index: 20/);
  } finally { await server.close(); }
});

test("Marshal Reclaim keeps its action and authorization with associated danger help", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom",
    plugins: [{
      name: "marshal-test-hooks", enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/src/utils/useDarkHandActions.ts")) {
          return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
        }
        if (id.endsWith("/src/views/MarshalTableView.tsx")) {
          return code.replace('import { useEffect, useMemo, useState } from "react";',
            'import { useEffect, useState } from "/tests/fixtures/appHooks.ts"; const useMemo = (factory: () => unknown) => factory();');
        }
      },
    }],
  });
  const originalFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const { default: Marshal } = await server.ssrLoadModule("/src/views/MarshalTableView.tsx");
    const { default: Control } = await server.ssrLoadModule("/src/components/ReclaimInteractionControl.tsx");
    const requests: unknown[] = [];
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(String(options!.body)));
      return new Response(JSON.stringify(yankeeLiveState("marshal")));
    };
    function find(node: ReactNode): ReturnType<typeof createElement<Record<string, unknown>>> | undefined {
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      if (!isValidElement<Record<string, unknown>>(node)) return;
      if (node.type === Control) return node;
      return find(node.props.children as ReactNode);
    }
    const response = yankeeLiveState("marshal");
    const renderTree = (actor: string) => {
      hooks.beginRender();
      return Marshal({ resp: response, currentActorId: actor, view: "public",
        run: (promise: Promise<unknown>) => promise, onBackHome: () => {} });
    };
    hooks.resetHooks();
    const control = find(renderTree("marshal"))!;
    assert.ok(control);
    assert.equal(control.props.disabled, false);
    const html = renderToStaticMarkup(control);
    const id = html.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(id);
    assert.ok(html.includes(`id="${id}" role="tooltip" class="reclaim-warning"`));
    assert.ok(html.includes("Emergency action. Use Reclaim only if the acting player is unreachable and the game cannot continue. This skips their pending interaction and resumes play."));
    assert.ok(!html.includes(">KEEP<") && !html.includes(">BURY<"));
    await (control.props.onReclaim as () => Promise<void>)();
    assert.deepEqual(requests, [{
      game_id: response.game_id, action: "gf.pending_reclaim",
      params: { actor_id: "marshal" }, view: "public",
    }]);
    hooks.resetHooks();
    const unauthorized = find(renderTree("yankee-a"))!;
    assert.equal(unauthorized.props.disabled, true);
    await (unauthorized.props.onReclaim as () => Promise<void>)();
    assert.equal(requests.length, 1);
    hooks.resetHooks();
    response.state.meta!.pending_interaction = null;
    assert.equal(find(renderTree("marshal")), undefined);
    hooks.resetHooks();
    const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
    assert.match(css, /\.reclaim-control:hover \.reclaim-warning,\s*\.reclaim-control:focus-within \.reclaim-warning\s*\{[^}]*visibility: visible/);
    assert.match(css, /\.reclaim-warning\s*\{[^}]*var\(--danger-border\)[^}]*var\(--danger-bg\)[^}]*var\(--accent-danger\)[^}]*visibility: hidden/);
    assert.match(css, /\.reclaim-button\s*\{[^}]*background: transparent/);
  } finally { globalThis.fetch = originalFetch; await server.close(); }
});

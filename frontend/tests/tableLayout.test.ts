import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chichimecaLiveResponse } from "./fixtures/chichimecaLiveState.ts";

test("both roles share viewport fitting and retain every functional region", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom",
  });
  try {
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    for (const currentActorId of ["player-nnu30f", "marshal"]) {
      const html = renderToStaticMarkup(createElement(Table, {
        resp: chichimecaLiveResponse, currentActorId, view: "player",
        run: () => { throw Error("Layout must not submit actions"); }, onBackHome: () => {},
      }));
      assert.match(html, /class="table-viewport"/);
      assert.match(html, /class="saloon-composition"/);
      assert.match(html, /font-size:var\(--difficulty-base-size\)/);
      assert.match(html, /class="table-deck-stack"/);
      const rail = html.slice(html.indexOf('class="table-deck-stack"'));
      assert.ok(rail.indexOf('>Deck<') < rail.indexOf('>Discard ·'), "Deck precedes Discard in the rail");
      for (const region of ["Deck", "Discard", "Difficulty / Scene", "Refresh Table"]) {
        assert.ok(html.includes(region), `${currentActorId}: ${region}`);
      }
      if (currentActorId === "marshal") {
        assert.ok(html.includes("Next Scene"));
        assert.ok(html.includes("Reclaim interaction"));
      } else {
        for (const region of ["Scene Participation", "Other Players", "REWARDS", "Confirm target", "DESCRIPTION", "FACTION POWER", "SCUM", "VENGEANCE"]) {
          assert.ok(html.includes(region), region);
        }
        assert.match(html, /alt="Children of the Earth"/);
        assert.match(html, /width:190px;height:190px/);
        assert.match(html, /grid-template-columns:500px minmax\(0, 1fr\)/);
      }
    }
    const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
    assert.match(css, /--difficulty-base-size: 3rem/);
    assert.match(css, /\.table-deck-stack\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    const { default: DiscardPile } = await server.ssrLoadModule("/src/components/DiscardPile.tsx");
    const cards = Array.from({ length: 54 }, (_, index) => `${index % 9 + 2}H`);
    const full = renderToStaticMarkup(createElement(DiscardPile, { cards }));
    assert.equal((full.match(/class="discard-card"/g) ?? []).length, 54);
    assert.equal((full.match(/tabindex="0"/g) ?? []).length, 54);
    assert.ok(full.includes("Discard 54:"), "older cards remain accessible by focus");
    assert.ok(renderToStaticMarkup(createElement(DiscardPile, { cards: [] })).includes("empty"));
  } finally {
    await server.close();
  }
});

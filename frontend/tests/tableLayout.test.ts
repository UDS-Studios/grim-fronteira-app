import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
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
      for (const region of ["Deck", "Discard", "Difficulty / Scene", "Refresh Table"]) {
        assert.ok(html.includes(region), `${currentActorId}: ${region}`);
      }
      if (currentActorId === "marshal") {
        assert.ok(html.includes("Next Scene"));
        assert.ok(html.includes("Reclaim interaction"));
      } else {
        for (const region of ["Scene Participation", "Other Players", "REWARDS", "Confirm target"]) {
          assert.ok(html.includes(region), region);
        }
      }
    }
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

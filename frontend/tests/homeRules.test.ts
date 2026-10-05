import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Home offers a native base-aware rules download with visible keyboard focus", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "gf-home-rules-"));
  const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)), optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  try {
    const { default: Home } = await server.ssrLoadModule("/src/views/HomeView.tsx");
    const html = renderToStaticMarkup(createElement(Home, {
      joinGameId: "", setJoinGameId: () => {}, onNewGame: () => {}, onJoinGame: async () => {},
    }));
    const anchor = html.match(/<a\b[^>]*>Download Rules<\/a>/)?.[0];
    assert.ok(anchor);
    assert.ok(anchor.includes('href="/grim-fronteira/assets/Grim-Fronteira-Rules.pdf"'));
    assert.ok(anchor.includes('download="Grim-Fronteira-Rules.pdf"'));
    assert.ok(!anchor.includes("onclick") && !anchor.includes("target="));
    assert.ok(html.includes('alt="New Game"') && html.includes('alt="Join Game"'));
    const css = await readFile(new URL("../src/views/HomeView.css", import.meta.url), "utf8");
    assert.match(css, /\.home-rules-download:focus-visible,[^}]*outline: 3px solid[^}]*outline-offset: 3px/);
    assert.match(css, /\.home-rules-download,[^}]*justify-self: center/);
  } finally {
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

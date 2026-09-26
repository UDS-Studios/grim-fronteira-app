import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { chichimecaLiveResponse } from "./fixtures/chichimecaLiveState.ts";

test("both Difficulty / Scene panels replace internal labels with themed gameplay status", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom",
  });
  try {
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    const render = (currentActorId: string, status = "active", extraScene: Record<string, unknown> = {}) => {
      const resp = structuredClone(chichimecaLiveResponse);
      resp.state.meta!.pending_interaction = null;
      resp.state.meta!.scene = {
        ...resp.state.meta!.scene, status,
        ...extraScene,
      };
      return renderToStaticMarkup(createElement(Table, {
        resp, currentActorId, view: "player",
        run: () => { throw Error("Presentation must not submit actions"); }, onBackHome: () => {},
      }));
    };
    for (const actor of ["player-nnu30f", "player-o2o9sa", "marshal"]) {
      const html = render(actor);
      const panelStart = html.indexOf("Difficulty / Scene");
      const statusEnd = html.indexOf("</div>", html.indexOf('class="scene-status', panelStart));
      assert.ok(panelStart >= 0 && statusEnd > panelStart);
      const panel = html.slice(panelStart, statusEnd);
      for (const label of ["difficulty value:", "difficulty rule:", "difficulty base:",
        "azzardo status:", "dark mode:", "participants selected:", "scene status:"]) {
        assert.ok(!panel.includes(label), `${actor}: ${label} must not appear in the panel`);
      }
      assert.ok(panel.includes("10 +"));
      assert.ok(panel.includes("TOTAL"));
      if (actor === "player-nnu30f") {
        assert.match(panel, /class="scene-status scene-status--your-turn">Your turn\. Draw until you stay or bust\./);
      } else {
        assert.match(panel, /class="scene-status">(?:Scene active\. )?Chichimeca is acting\./);
        assert.ok(!panel.includes("scene-status--your-turn"));
      }
    }
    const closed = render("player-o2o9sa", "closed");
    assert.match(closed, /class="scene-status">Scene closed\. Waiting for the Marshal to start a new scene\./);
    assert.ok(!closed.includes("scene-status--your-turn"));
    for (const actor of ["player-o2o9sa", "marshal"]) {
      const awaiting = render(actor, "awaiting_ack", { resolution: { message: "Awaiting acknowledgment." } });
      assert.match(awaiting, /class="scene-status">Awaiting acknowledgment\./);
      const joker = render(actor, "setup", { difficulty: { card_id: "RJ", value: 20 } });
      assert.match(joker, /class="scene-status">Red Joker drawn\./);
    }
  } finally {
    await server.close();
  }
});

test("status styles use game typography and reserve danger emphasis for own turn", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const normal = css.match(/\.scene-status\s*\{([^}]+)\}/)?.[1] ?? "";
  const ownTurn = css.match(/\.scene-status--your-turn\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(normal, /font-family: LavaArabic, serif/);
  assert.match(normal, /color: var\(--text-primary\)/);
  assert.ok(!normal.includes("--accent-danger"));
  assert.match(ownTurn, /color: var\(--accent-danger\)/);
  assert.match(ownTurn, /font-weight: 800/);
  assert.ok(Number(ownTurn.match(/font-size: (\d+)px/)?.[1]) > Number(normal.match(/font-size: (\d+)px/)?.[1]));
});

test("App retains the existing collapsible State JSON control and its response data", async () => {
  // App initially renders Home during SSR; check the unchanged game-only control
  // directly rather than adding a browser/state-mocking framework for this test.
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /<details className="table-debug">\s*<summary>State JSON<\/summary>\s*<pre>\{JSON.stringify\(resp, null, 2\)\}<\/pre>\s*<\/details>/);
});

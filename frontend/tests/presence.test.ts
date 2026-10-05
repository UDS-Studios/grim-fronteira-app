import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPresenceStatus } from "../src/utils/presence.ts";
import { acceptResponse } from "../src/utils/responseOrdering.ts";
import type { GameMeta } from "../src/api/types.ts";
import { chichimecaLiveResponse } from "./fixtures/chichimecaLiveState.ts";

for (const dev of [true, false]) {
  test(`Player table Marshal ID and presence in ${dev ? "development" : "production"}`, async t => {
    const cacheDir = await mkdtemp(join(tmpdir(), "gf-marshal-presence-"));
    const server = await createServer({ cacheDir, root: fileURLToPath(new URL("..", import.meta.url)),
      server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom",
      plugins: [{ name: "marshal-id-mode", enforce: "pre", transform(code, id) {
        if (id.endsWith("/src/views/PlayerTableView.tsx")) {
          return code.replaceAll("import.meta.env.DEV", String(dev));
        }
      } }] });
    try {
      const { default: Player } = await server.ssrLoadModule("/src/views/PlayerTableView.tsx");
      for (const online of [true, false]) {
        await t.test(online ? "online" : "offline", () => {
          const response = structuredClone(chichimecaLiveResponse);
          const marshalId = "player-marshal-raw-id";
          response.state.meta!.marshal_id = marshalId;
          response.state.meta!.presence = { [marshalId]: { online } };
          response.state.meta!.pending_interaction = null;
          const html = renderToStaticMarkup(createElement(Player, {
            resp: response, view: "player", currentActorId: "player-nnu30f", onBackHome: () => {},
            run: () => { throw Error("presentation must not submit requests"); },
          }));
          assert.equal(html.includes(marshalId), dev);
          const statusLine = html.match(/<div><b>Marshal:<\/b>(.*?)<\/div>/)?.[1];
          assert.ok(statusLine, "Marshal label remains present");
          assert.equal(statusLine.includes(marshalId), dev);
          assert.ok(statusLine.includes(`presence-indicator--${online ? "online" : "offline"}`));
          assert.ok(statusLine.includes(online ? "Online" : "Offline"));
        });
      }
    } finally {
      await server.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
}

test("only explicit backend booleans determine presence; missing and malformed data are unknown", () => {
  assert.equal(getPresenceStatus({ presence: { p1: { online: true } } }, "p1"), "online");
  assert.equal(getPresenceStatus({ presence: { p1: { online: false } } }, "p1"), "offline");
  for (const meta of [undefined, null, {}, { presence: {} }, { presence: null },
    { presence: { p1: null } }, { presence: { p1: {} } }, { presence: { p1: { online: "false" } } }]) {
    assert.equal(getPresenceStatus(meta as GameMeta | null | undefined, "p1"), "unknown");
  }
  assert.equal(getPresenceStatus({ presence: { other: { online: false } } }, "p1"), "unknown");
});

test("pure indicators, lobby/table integrations, equal-revision updates and unchanged gameplay controls", async () => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom" });
  try {
    const { default: Indicator } = await server.ssrLoadModule("/src/components/PresenceIndicator.tsx");
    const { default: MarshalLobby } = await server.ssrLoadModule("/src/views/MarshalLobbyView.tsx");
    const { default: PlayerLobby } = await server.ssrLoadModule("/src/views/PlayerLobbyView.tsx");
    const { default: Table } = await server.ssrLoadModule("/src/views/TableRouterView.tsx");
    for (const status of ["online", "offline"]) {
      const html = renderToStaticMarkup(createElement(Indicator, { status }));
      assert.match(html, /class="presence-light" aria-hidden="true"/);
      assert.ok(html.includes(`presence-indicator--${status}`));
      assert.ok(html.includes(status === "online" ? "Online" : "Offline"));
    }
    assert.equal(renderToStaticMarkup(createElement(Indicator, { status: "unknown" })), "");
    const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
    assert.match(css, /presence-indicator--online\s*\{[^}]*#28a745/);
    assert.match(css, /presence-indicator--offline\s*\{[^}]*#e04444/);
    assert.match(css, /\.presence-light\s*\{[^}]*border-radius: 50%/);
    const response = structuredClone(chichimecaLiveResponse);
    response.state.meta!.presence = { marshal: { online: false }, "player-nnu30f": { online: true }, "player-o2o9sa": { online: false } };
    response.state.meta!.pending_interaction = null;
    response.state.meta!.lobby!.players!["player-nnu30f"] = { chosen_name: "Chichimeca", stage: "ready" };
    const common = { resp: response, view: "player", currentActorId: "player-nnu30f",
      selectedPlayerId: "", setSelectedPlayerId: () => {}, onBackHome: () => {},
      run: () => { throw Error("Presence rendering must not send requests"); } };
    const render = (component: unknown, props = common) => renderToStaticMarkup(createElement(component as typeof Table, props));
    const lobby = render(MarshalLobby);
    assert.match(lobby, /Marshal:<\/b> marshal.*?presence-indicator--offline/);
    assert.match(lobby, /player-nnu30f[^]*?presence-indicator--online/);
    assert.match(lobby, /player-o2o9sa[^]*?presence-indicator--offline/);
    assert.match(render(PlayerLobby), /Marshal:<\/b> marshal.*?presence-indicator--offline/);
    // Every lobby stage preserves the Marshal indicator.
    for (const stage of ["waiting_for_figure", "waiting_for_name", "waiting_for_feature", "ready"]) {
      response.state.meta!.lobby!.players!["player-nnu30f"] = { stage, chosen_name: "Chichimeca" };
      assert.match(render(PlayerLobby), /Marshal:<\/b> marshal.*?presence-indicator--offline/);
    }
    const marshalTable = render(Table, { ...common, currentActorId: "marshal" });
    assert.ok(!marshalTable.includes("marshal-offline-banner"));
    assert.match(marshalTable, /Chichimeca[^]*?presence-indicator--online/);
    assert.match(marshalTable, /Paisà[^]*?presence-indicator--offline/);
    assert.match(render(Table), /Marshal:<\/b> marshal.*?presence-indicator--offline/);
    delete response.state.meta!.presence;
    for (const component of [MarshalLobby, PlayerLobby, Table]) {
      assert.ok(!render(component).includes("presence-indicator"));
      assert.ok(!render(component).includes("marshal-offline-banner"));
    }
    response.state.meta!.scene = { status: "active", participants: ["player-nnu30f", "player-o2o9sa"],
      players: { "player-nnu30f": {} }, difficulty: { value: 12 } };
    response.state.meta!.presence = { marshal: { online: true } };
    const online = structuredClone(response);
    const offline = structuredClone(response);
    offline.state.meta!.presence!.marshal.online = false;
    const updated = acceptResponse(online, offline);
    assert.equal(updated, offline);
    assert.equal(updated.revision, online.revision);
    const onlineHtml = render(Table, { ...common, resp: online });
    const offlineHtml = render(Table, { ...common, resp: updated });
    assert.match(onlineHtml, /Marshal:<\/b> marshal.*?presence-indicator--online/);
    assert.match(offlineHtml, /Marshal:<\/b> marshal.*?presence-indicator--offline/);
    assert.ok(!onlineHtml.includes("marshal-offline-banner"));
    assert.match(offlineHtml, /class="marshal-offline-banner" role="status"/);
    assert.ok(offlineHtml.includes("THE MARSHAL IS OFFLINE"));
    assert.ok(offlineHtml.includes("Waiting for the Marshal to reconnect."));
    const banner = offlineHtml.match(/class="marshal-offline-banner"[^]*?<\/div><\/div>/)![0];
    assert.doesNotMatch(banner, /paused|actions disabled/i);
    const missingSeat = structuredClone(offline);
    missingSeat.state.meta!.presence = {};
    assert.ok(!render(Table, { ...common, resp: missingSeat }).includes("marshal-offline-banner"));
    assert.ok(onlineHtml.includes('title="Draw a card"'));
    assert.ok(onlineHtml.includes('title="Stay"'));
    const buttons = (html: string) => html.match(/<button\b[^>]*>/g);
    assert.deepEqual(buttons(offlineHtml), buttons(onlineHtml), "all existing player action attributes remain identical");
    assert.doesNotMatch(offlineHtml, /GAME PAUSED|WAITING FOR MARSHAL|ACTIONS DISABLED/);
    // Public projections remain passive and can omit presence.
    assert.doesNotThrow(() => render(PlayerLobby, { ...common, view: "public" }));
  } finally { await server.close(); }
});

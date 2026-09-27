import assert from "node:assert/strict";
import test from "node:test";
import type { GameMeta } from "../src/api/types.ts";
import { getOrCreatePlayerId, persistPlayerId } from "../src/utils/identity.ts";
import { getGameEntryMode } from "../src/utils/reconnect.ts";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const closedGame: GameMeta = {
  phase: "table",
  marshal_id: "marshal",
  lobby: { registration_open: false, players: { "player-802r1k": {}, marshal: {} } },
};

test("open registration retains normal joining for new and existing identities", () => {
  const open = { ...closedGame, lobby: { ...closedGame.lobby, registration_open: true } };
  assert.equal(getGameEntryMode(open, "new-player"), "join");
  assert.equal(getGameEntryMode(open, "player-802r1k"), "join");
});

test("closed registration reconnects a registered player", () => {
  assert.equal(getGameEntryMode(closedGame, "player-802r1k"), "reconnect");
});

test("Marshal reconnects even if absent from lobby players", () => {
  assert.equal(getGameEntryMode(closedGame, "marshal"), "reconnect");
  assert.equal(getGameEntryMode({ marshal_id: "marshal" }, "marshal"), "reconnect");
});

test("closed registration rejects unknown, empty and inherited identities", () => {
  for (const actor of ["new-player", "", "  ", "toString", "constructor"]) {
    assert.equal(getGameEntryMode(closedGame, actor), "closed");
  }
  assert.equal(getGameEntryMode({}, "new-player"), "closed");
});

test("successful join identity persists and is restored by app initialization", () => {
  const tab = storage();
  const legacy = storage({ gf_client_id: "old-device-id" });
  assert.equal(persistPlayerId("player-802r1k", tab), "player-802r1k");
  assert.equal(tab.getItem("gf_player_id"), "player-802r1k");
  const restoredActor = getOrCreatePlayerId(tab, legacy);
  assert.equal(restoredActor, "player-802r1k");
  assert.equal(getGameEntryMode(closedGame, restoredActor), "reconnect");
  assert.equal(legacy.getItem("gf_client_id"), "old-device-id");
});

test("session identity wins without reading legacy storage", () => {
  const tab = storage({ gf_player_id: "player-802r1k" });
  const unavailableLegacy = {
    getItem: () => { throw Error("should not read legacy ID"); },
    setItem: () => { throw Error("should not write legacy ID"); },
  };
  assert.equal(getOrCreatePlayerId(tab, unavailableLegacy), "player-802r1k");
});

test("legacy identity migrates to this tab for existing players and Marshal", () => {
  const tab = storage();
  const legacy = storage({ gf_client_id: "marshal" });
  assert.equal(getOrCreatePlayerId(tab, legacy), "marshal");
  assert.equal(tab.getItem("gf_player_id"), "marshal");
  legacy.setItem("gf_client_id", "different-device-id");
  assert.equal(getOrCreatePlayerId(tab, legacy), "marshal");
});

test("first visit creates and retains the fallback identity", () => {
  const tab = storage();
  const legacy = storage();
  const actor = getOrCreatePlayerId(tab, legacy);
  assert.match(actor, /^player-/);
  assert.equal(getOrCreatePlayerId(tab, legacy), actor);
  assert.equal(tab.getItem("gf_player_id"), actor);
  assert.equal(legacy.getItem("gf_client_id"), actor);
});

test("two tabs persist independent joined players without overwriting the shared device ID", () => {
  const legacy = storage({ gf_client_id: "device-id" });
  const tabA = storage();
  const tabB = storage();
  getOrCreatePlayerId(tabA, legacy);
  getOrCreatePlayerId(tabB, legacy);
  persistPlayerId("player-802r1k", tabA);
  persistPlayerId("other-player", tabB);
  assert.equal(getOrCreatePlayerId(tabA, legacy), "player-802r1k");
  assert.equal(getOrCreatePlayerId(tabB, legacy), "other-player");
  assert.equal(legacy.getItem("gf_client_id"), "device-id");
});

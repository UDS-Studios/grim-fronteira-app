import assert from "node:assert/strict";
import test from "node:test";
import { newGame, gfAction, getGame, reconnectGame } from "../src/api/gf.ts";
import { loadSession, storeIssuedSession, getActiveSession, getReconnectToken, clearSession } from "../src/utils/session.ts";
import type { ActionResponse } from "../src/api/types.ts";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear() };
}
const session = { player_id: "p1", role: "player" as const, active_session: "active-A", reconnect_token: "reconnect-A" };
function response(code?: string, issued?: object): ActionResponse {
  return { game_id: "A", revision: 1, state: { meta: { marshal_id: "host" } }, events: [],
    result: issued ? { session: issued } : {}, error: code ? { code, message: code, details: null } : null };
}

test("per-game session storage, transport, bounded recovery and acquisition", async t => {
  const oldFetch = globalThis.fetch;
  const descriptors = ["sessionStorage", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const tab = storage(), persistent = storage();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: tab });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: persistent });
  const calls: { path: string; headers: Headers; body: Record<string, unknown> | undefined }[] = [];
  let replies: ActionResponse[] = [];
  globalThis.fetch = async (input, options) => {
    calls.push({ path: String(input), headers: new Headers(options?.headers), body: options?.body ? JSON.parse(String(options.body)) : undefined });
    const reply = replies.shift();
    assert.ok(reply, "unexpected request / retry loop");
    return new Response(JSON.stringify(reply));
  };
  const reset = () => { tab.clear(); persistent.clear(); calls.length = 0; replies = []; };
  try {
    await t.test("create stores Marshal credentials outside visible result", async () => {
      reset(); replies = [response(undefined, { ...session, player_id: "host", role: "marshal" })];
      const result = await newGame({ creator_id: "host", template_path: "deck", view: "public" });
      assert.equal(loadSession("A")?.role, "marshal");
      assert.equal(getActiveSession("A"), "active-A");
      assert.equal(getReconnectToken("A"), "reconnect-A");
      assert.ok(!JSON.stringify(result).includes("active-A"));
      assert.ok(!JSON.stringify(result).includes("reconnect-A"));
      assert.equal(calls[0].headers.get("X-GF-Session"), null);
    });
    await t.test("join stores player credentials without preexisting authority", async () => {
      reset(); replies = [response(undefined, session)];
      await gfAction({ game_id: "A", action: "gf.join_lobby", params: { player_id: "p1" }, view: "player", viewer_id: "p1" });
      assert.deepEqual(loadSession("A"), session);
      assert.equal(calls[0].headers.get("X-GF-Session"), null);
    });
    await t.test("private GET and mutation use active header, public reads and other games do not", async () => {
      reset(); storeIssuedSession("A", session); replies = Array.from({ length: 5 }, () => response());
      await getGame("A", "player", "p1");
      await gfAction({ game_id: "A", action: "gf.scene_stand", params: { player_id: "p1" }, view: "public" });
      await getGame("A", "public"); await getGame("B", "player", "p1");
      await gfAction({ game_id: "A", action: "gf.get_state", params: {}, view: "public" });
      assert.deepEqual(calls.map(c => c.headers.get("X-GF-Session")), ["active-A", "active-A", null, null, null]);
      assert.ok(!JSON.stringify(calls).includes("reconnect-A"));
      assert.ok(calls.every(c => !c.path.includes("active-A")));
      assert.ok(!JSON.stringify(calls[1].body).includes("active-A"));
    });
    await t.test("reconnect sends only reconnect body and replaces active session", async () => {
      reset(); storeIssuedSession("A", session);
      replies = [response(undefined, { player_id: "p1", role: "player", active_session: "active-B" })];
      await reconnectGame("A");
      assert.equal(calls[0].path.endsWith("/api/gf/reconnect"), true);
      assert.deepEqual(calls[0].body, { game_id: "A", reconnect_token: "reconnect-A" });
      assert.equal(calls[0].headers.get("X-GF-Session"), null);
      assert.equal(getActiveSession("A"), "active-B");
      assert.equal(getReconnectToken("A"), "reconnect-A");
      assert.ok(!tab.getItem("gf_session:A")!.includes("reconnect-A"));
      assert.ok(!persistent.getItem("gf_reconnect:A")!.includes("active-"));
    });
    for (const code of ["SESSION_REQUIRED", "SESSION_INVALID", "SESSION_REPLACED"]) {
      await t.test(`${code} reconnects and retries once`, async () => {
        reset(); storeIssuedSession("A", session);
        replies = [response(code), response(undefined, { player_id: "p1", role: "player", active_session: "active-B" }), response()];
        const result = await getGame("A", "player", "p1");
        assert.equal(result.error, null); assert.equal(calls.length, 3);
        assert.equal(calls[2].headers.get("X-GF-Session"), "active-B");
      });
    }
    await t.test("replacement on the retry surfaces and consumes the allowance", async () => {
      reset(); storeIssuedSession("A", session);
      replies = [response("SESSION_REPLACED"), response(undefined, session), response("SESSION_REPLACED")];
      assert.equal((await getGame("A", "player", "p1")).error?.code, "SESSION_REPLACED");
      replies = [response("SESSION_REPLACED")];
      assert.equal((await getGame("A", "player", "p1")).error?.code, "SESSION_REPLACED");
      assert.equal(calls.length, 4);
      assert.equal(calls.filter(c => c.path.endsWith("/api/gf/reconnect")).length, 1);
    });
    await t.test("later replacement polls stay blocked across successful requests and ordinary recovery", async () => {
      reset(); storeIssuedSession("A", session);
      replies = [response("SESSION_REPLACED"), response(undefined, { ...session, active_session: "active-B" }), response()];
      assert.equal((await getGame("A", "player", "p1")).error, null);
      for (const code of ["SESSION_REQUIRED", "SESSION_INVALID"]) {
        replies = [response(code), response(undefined, { ...session, active_session: `active-${code}` }), response()];
        assert.equal((await getGame("A", "player", "p1")).error, null);
      }
      const reconnectCount = calls.filter(c => c.path.endsWith("/api/gf/reconnect")).length;
      replies = [response(), ...Array.from({ length: 10 }, () => response("SESSION_REPLACED"))];
      assert.equal((await getGame("A", "player", "p1")).error, null);
      for (let poll = 0; poll < 10; poll++) {
        assert.equal((await getGame("A", "player", "p1")).error?.code, "SESSION_REPLACED");
      }
      assert.equal(calls.filter(c => c.path.endsWith("/api/gf/reconnect")).length, reconnectCount);
      assert.equal(replies.length, 0);
      // Another game has its own allowance.
      storeIssuedSession("B", session);
      replies = [response("SESSION_REPLACED"), { ...response(undefined, session), game_id: "B" }, response()];
      assert.equal((await getGame("B", "player", "p1")).error, null);
    });
    for (const lifecycle of ["join", "manual reconnect", "clear", "replace"]) {
      await t.test(`${lifecycle} resets replacement recovery eligibility`, async () => {
        reset(); storeIssuedSession("A", session);
        replies = [response("SESSION_REPLACED"), response(undefined, session), response()];
        await getGame("A", "player", "p1");
        replies = [response("SESSION_REPLACED")];
        assert.equal((await getGame("A", "player", "p1")).error?.code, "SESSION_REPLACED");
        if (lifecycle === "join") {
          replies = [response(undefined, session)];
          await gfAction({ game_id: "A", action: "gf.join_lobby", params: { player_id: "p1" }, view: "player" });
        } else if (lifecycle === "manual reconnect") {
          replies = [response(undefined, session)];
          await reconnectGame("A");
        } else {
          if (lifecycle === "clear") clearSession("A");
          storeIssuedSession("A", session);
        }
        replies = [response("SESSION_REPLACED"), response(undefined, session), response()];
        assert.equal((await getGame("A", "player", "p1")).error, null);
        assert.equal(replies.length, 0);
      });
    }
    await t.test("mutation recovery preserves original body and retries only once", async () => {
      reset(); storeIssuedSession("A", session);
      replies = [response("SESSION_INVALID"), response(undefined, { ...session, active_session: "active-B" }), response("SESSION_INVALID")];
      const result = await gfAction({ game_id: "A", action: "gf.scene_stand", params: { player_id: "p1" }, view: "player", viewer_id: "p1" });
      assert.equal(result.error?.code, "SESSION_INVALID"); assert.equal(calls.length, 3);
      assert.deepEqual(calls[0].body, calls[2].body);
    });
    for (const code of ["ACTOR_MISMATCH", "VIEWER_MISMATCH", "RECONNECT_INVALID", "GAME_PAUSED"]) {
      await t.test(`${code} never triggers recovery`, async () => {
        reset(); storeIssuedSession("A", session); replies = [response(code)];
        assert.equal((await getGame("A", "player", "p1")).error?.code, code);
        assert.equal(calls.length, 1);
      });
    }
    await t.test("GAME_PAUSED does not consume the replaced recovery allowance", async () => {
      reset(); storeIssuedSession("A", session);
      replies = [response("GAME_PAUSED")];
      assert.equal((await getGame("A", "player", "p1")).error?.code, "GAME_PAUSED");
      replies = [response("SESSION_REPLACED"), response(undefined, { ...session, active_session: "active-B" }), response()];
      assert.equal((await getGame("A", "player", "p1")).error, null);
      assert.equal(calls.filter(c => c.path.endsWith("/api/gf/reconnect")).length, 1);
    });
    await t.test("failed reconnect stops without retrying original request", async () => {
      reset(); storeIssuedSession("A", session); replies = [response("SESSION_REPLACED"), response("RECONNECT_INVALID")];
      assert.equal((await getGame("A", "player", "p1")).error?.code, "RECONNECT_INVALID");
      assert.equal(calls.length, 2);
      replies = [response("SESSION_REPLACED")];
      assert.equal((await getGame("A", "player", "p1")).error?.code, "SESSION_REPLACED");
      assert.equal(calls.length, 3);
    });
    await t.test("legacy IDs alone never supply credentials or trigger reconnect", async () => {
      reset(); tab.setItem("gf_player_id", "p1"); persistent.setItem("gf_client_id", "host");
      replies = [response("SESSION_REQUIRED")];
      assert.equal(loadSession("A"), null);
      await getGame("A", "player", "p1");
      assert.equal(calls.length, 1); assert.equal(calls[0].headers.get("X-GF-Session"), null);
    });
    await t.test("same-tab refresh restores active session; browser restart recovers with persistent token", async () => {
      reset(); storeIssuedSession("A", session);
      assert.deepEqual(loadSession("A"), session);
      tab.clear(); assert.equal(getActiveSession("A"), undefined);
      assert.equal(getReconnectToken("A"), "reconnect-A");
      replies = [response("SESSION_REQUIRED"), response(undefined, { player_id: "p1", role: "player", active_session: "active-B" }), response()];
      assert.equal((await getGame("A", "player", "p1")).error, null);
      assert.equal(calls[0].headers.get("X-GF-Session"), null);
      clearSession("A"); assert.equal(loadSession("A"), null);
    });
    await t.test("concurrent expired polls share a single reconnect", async () => {
      reset(); storeIssuedSession("A", session);
      replies = [response("SESSION_REPLACED"), response("SESSION_REPLACED"), response(undefined, { ...session, active_session: "active-B" }), response(), response()];
      const results = await Promise.all([getGame("A", "player", "p1"), getGame("A", "player", "p1")]);
      assert.ok(results.every(r => !r.error));
      replies = [response("SESSION_REPLACED")];
      assert.equal((await getGame("A", "player", "p1")).error?.code, "SESSION_REPLACED");
      assert.equal(calls.filter(c => c.path.endsWith("/api/gf/reconnect")).length, 1);
    });
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

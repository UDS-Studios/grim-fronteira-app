import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import type { ActionRequest, ActionResponse } from "../src/api/types.ts";
import { yankeeLiveState, YANKEE_A } from "./fixtures/yankeeLiveState.ts";

function callback(node: ReactNode, prop: string): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = callback(child, prop);
      if (found) return found;
    }
  } else if (isValidElement<Record<string, unknown>>(node)) {
    if (typeof node.props[prop] === "function") return node.props[prop] as () => Promise<void>;
    return callback(node.props.children as ReactNode, prop);
  }
}

test("real Marshal and player table callbacks POST their private projection", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true, hmr: false }, appType: "custom",
    plugins: [{
      name: "table-callback-hooks", enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/src/views/MarshalTableView.tsx") || id.endsWith("/src/views/PlayerTableView.tsx") || id.endsWith("/src/utils/useDarkHandActions.ts")) {
          return code.replace('from "react";', 'from "/tests/fixtures/appHooks.ts";');
        }
      },
    }],
  });
  const originalFetch = globalThis.fetch;
  try {
    const hooks = await server.ssrLoadModule("/tests/fixtures/appHooks.ts");
    const requests: ActionRequest[] = [];
    globalThis.fetch = async (_input, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify(yankeeLiveState("public")));
    };
    for (const role of ["marshal", "player"] as const) {
      hooks.resetHooks();
      const actor = role === "marshal" ? "marshal" : YANKEE_A;
      const resp = yankeeLiveState(actor);
      resp.state.meta!.scene!.status = "active";
      if (role === "player") resp.state.meta!.pending_interaction = null;
      const { default: Table } = await server.ssrLoadModule(`/src/views/${role === "marshal" ? "Marshal" : "Player"}TableView.tsx`);
      const tree = Table({ resp, currentActorId: actor, view: role,
        run: (request: Promise<ActionResponse>) => request, onBackHome: () => {} });
      const submit = callback(tree, role === "marshal" ? "onReclaim" : "onStay");
      assert.ok(submit);
      await submit();
      assert.deepEqual(requests.at(-1), {
        game_id: resp.game_id,
        action: role === "marshal" ? "gf.pending_reclaim" : "gf.scene_stand",
        params: role === "marshal" ? { actor_id: actor } : { player_id: actor },
        view: role, viewer_id: actor,
      });
    }
    assert.equal(requests.length, 2);
    hooks.resetHooks();
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});

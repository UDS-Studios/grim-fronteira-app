import { API_BASE } from "../app/config.ts";
import type { ActionResponse } from "./types.ts";

export async function api<TBody>(
  path: string,
  method: "GET" | "POST",
  body?: TBody,
  activeSession?: string
): Promise<ActionResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}),
      ...(activeSession ? { "X-GF-Session": activeSession } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  return (await res.json()) as ActionResponse;
}
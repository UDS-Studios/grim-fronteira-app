import { API_BASE } from "../app/config";
import type { ActionResponse } from "./types";

export async function api<TBody>(
  path: string,
  method: "GET" | "POST",
  body?: TBody
): Promise<ActionResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  return (await res.json()) as ActionResponse;
}
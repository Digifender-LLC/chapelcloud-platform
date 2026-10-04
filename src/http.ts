import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Reads a JSON object body. Requiring application/json means a cross-site
 * HTML form can never reach these handlers, and browsers must preflight
 * cross-origin calls, which CORS only allows from the portal.
 */
export async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  if (!c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new HTTPException(415, { message: "Expected an application/json body." });
  }
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HTTPException(400, { message: "Expected a JSON object." });
  }
  return body as Record<string, unknown>;
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

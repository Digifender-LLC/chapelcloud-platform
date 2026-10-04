import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";
import { readSessionCookie } from "./cookies";
import { lookupSession } from "./sessions";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for cookie-authenticated requests. Browsers always send Origin on
 * cross-origin POSTs, so a state-changing request from any page other than the
 * portal is rejected. Requests without Origin (curl, server-to-server) carry
 * no ambient browser cookies and are allowed through to normal auth checks.
 */
export const requireTrustedOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== c.env.PORTAL_ORIGIN && origin !== new URL(c.req.url).origin) {
      throw new HTTPException(403, { message: "Untrusted origin." });
    }
  }
  await next();
});

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = readSessionCookie(c);
  const session = token ? await lookupSession(c.env.DB, token) : null;
  if (!session) throw new HTTPException(401, { message: "Sign in required." });
  c.set("session", session);
  await next();
});

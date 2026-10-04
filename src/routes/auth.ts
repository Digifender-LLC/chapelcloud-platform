import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { findUserByEmail, findUserById, listMemberships, publicUser, type UserRow } from "../accounts";
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from "../auth/cookies";
import { sha256Hex } from "../auth/crypto";
import { requireSession } from "../auth/middleware";
import { burnPasswordCheck, hashPassword, passwordProblem, PASSWORD_MAX_LENGTH, verifyPassword } from "../auth/password";
import { createSession, lookupSession, revokeOtherSessions, revokeSession } from "../auth/sessions";
import { badRequest, readJsonBody } from "../http";
import { normalizeEmail, type AppEnv, type Role } from "../types";

// After this many consecutive failures the account is locked for LOCKOUT_MS.
export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID_CREDENTIALS = "Email or password is incorrect.";

export const auth = new Hono<AppEnv>();

async function startSession(c: Context<AppEnv>, user: { id: string; email: string; name: string }) {
  const { token, expiresAt } = await createSession(c.env.DB, user.id, {
    userAgent: c.req.header("User-Agent"),
    ip: c.req.header("CF-Connecting-IP"),
  });
  writeSessionCookie(c, token, expiresAt);
  return c.json({
    user: publicUser(user),
    organizations: await listMemberships(c.env.DB, user.id),
    expiresAt,
  });
}

/**
 * Checks a password for an existing account, applying the lockout policy.
 * Throws the same 401 for every failure so callers cannot tell why it failed.
 */
async function checkPassword(db: D1Database, user: UserRow, password: string, now = Date.now()): Promise<void> {
  if (user.locked_until && user.locked_until > now) {
    await burnPasswordCheck(password);
    throw new HTTPException(429, { message: "Too many failed attempts. Try again later." });
  }
  if (user.status === "active" && (await verifyPassword(password, user.password_hash))) {
    if (user.failed_login_count > 0 || user.locked_until) {
      await db
        .prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?")
        .bind(user.id)
        .run();
    }
    return;
  }
  const failures = user.failed_login_count + 1;
  const locked = failures >= MAX_FAILED_LOGINS;
  await db
    .prepare("UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?")
    .bind(locked ? 0 : failures, locked ? now + LOCKOUT_MS : null, user.id)
    .run();
  throw new HTTPException(401, { message: INVALID_CREDENTIALS });
}

auth.post("/login", async (c) => {
  const body = await readJsonBody(c);
  const email = normalizeEmail(body.email);
  const password = body.password;
  if (!email || typeof password !== "string" || !password || password.length > PASSWORD_MAX_LENGTH) {
    throw new HTTPException(401, { message: INVALID_CREDENTIALS });
  }

  const user = await findUserByEmail(c.env.DB, email);
  if (!user) {
    await burnPasswordCheck(password);
    throw new HTTPException(401, { message: INVALID_CREDENTIALS });
  }
  await checkPassword(c.env.DB, user, password);
  return startSession(c, user);
});

auth.post("/logout", async (c) => {
  const token = readSessionCookie(c);
  if (token) await revokeSession(c.env.DB, await sha256Hex(token));
  clearSessionCookie(c);
  return c.body(null, 204);
});

auth.get("/session", requireSession, async (c) => {
  const session = c.get("session");
  return c.json({
    user: publicUser({ id: session.userId, email: session.email, name: session.name }),
    organizations: await listMemberships(c.env.DB, session.userId),
    expiresAt: session.expiresAt,
  });
});

auth.post("/password", requireSession, async (c) => {
  const session = c.get("session");
  const body = await readJsonBody(c);
  const problem = passwordProblem(body.newPassword);
  if (problem) badRequest(problem);
  if (typeof body.currentPassword !== "string" || body.currentPassword.length > PASSWORD_MAX_LENGTH) {
    throw new HTTPException(401, { message: INVALID_CREDENTIALS });
  }

  const user = await findUserById(c.env.DB, session.userId);
  if (!user) throw new HTTPException(401, { message: "Sign in required." });
  await checkPassword(c.env.DB, user, body.currentPassword);

  await c.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(body.newPassword as string), Date.now(), user.id)
    .run();
  // Anyone else holding a session for this account is signed out.
  await revokeOtherSessions(c.env.DB, user.id, session.sessionId);
  return c.body(null, 204);
});

/**
 * Accepts an organization invitation. A new customer chooses their name and
 * password here; an existing customer confirms with their current password.
 * Either way they end up signed in with the new membership.
 */
auth.post("/invitations/accept", async (c) => {
  const db = c.env.DB;
  const body = await readJsonBody(c);
  if (typeof body.token !== "string" || !body.token) badRequest("Invitation token is required.");
  if (typeof body.password !== "string") badRequest("Password is required.");
  const password = body.password;

  const now = Date.now();
  const invitation = await db
    .prepare(
      `SELECT id, org_id, email, role FROM invitations
        WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?`,
    )
    .bind(await sha256Hex(body.token), now)
    .first<{ id: string; org_id: string; email: string; role: Role }>();
  if (!invitation) badRequest("This invitation is invalid or has expired.");

  // A signed-in customer can only accept invitations sent to their own address.
  const existingToken = readSessionCookie(c);
  const current = existingToken ? await lookupSession(db, existingToken) : null;
  if (current && current.email !== invitation.email) {
    throw new HTTPException(403, { message: "This invitation was sent to a different email address." });
  }

  let user: { id: string; email: string; name: string };
  const statements: D1PreparedStatement[] = [];
  const existing = await findUserByEmail(db, invitation.email);
  if (existing) {
    if (password.length > PASSWORD_MAX_LENGTH) throw new HTTPException(401, { message: INVALID_CREDENTIALS });
    await checkPassword(db, existing, password);
    user = existing;
  } else {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 200) badRequest("Name is required.");
    const problem = passwordProblem(password);
    if (problem) badRequest(problem);
    user = { id: crypto.randomUUID(), email: invitation.email, name };
    statements.push(
      db
        .prepare(
          `INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(user.id, user.email, user.name, await hashPassword(password), now, now),
    );
  }

  statements.push(
    db
      .prepare("UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL")
      .bind(now, invitation.id),
    // An existing member keeps their current role.
    db
      .prepare("INSERT OR IGNORE INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)")
      .bind(user.id, invitation.org_id, invitation.role, now),
  );
  const results = await db.batch(statements).catch(() => null);
  const claimed = results?.[statements.length - 2]?.meta.changes === 1;
  if (!claimed) badRequest("This invitation is invalid or has expired.");

  return startSession(c, user);
});

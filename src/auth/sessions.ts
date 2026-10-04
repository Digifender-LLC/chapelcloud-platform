import { randomToken, sha256Hex } from "./crypto";

// Sent as `__Host-cc_session`: Secure, no Domain, Path=/ (see src/auth/cookies.ts).
export const SESSION_COOKIE = "cc_session";
// A session ends 30 days after sign-in, or after 7 days without use.
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// last_seen_at is written at most this often to keep reads cheap.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  expiresAt: number;
}

export async function createSession(
  db: D1Database,
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const expiresAt = now + SESSION_ABSOLUTE_TTL_MS;
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(await sha256Hex(token), userId, now, now, expiresAt, meta.userAgent ?? null, meta.ip ?? null)
    .run();
  return { token, expiresAt };
}

export async function lookupSession(db: D1Database, token: string, now = Date.now()): Promise<SessionUser | null> {
  const sessionId = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.id, s.last_seen_at, s.expires_at, u.id AS user_id, u.email, u.name
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ? AND s.last_seen_at > ? AND u.status = 'active'`,
    )
    .bind(sessionId, now, now - SESSION_IDLE_TTL_MS)
    .first<{ id: string; last_seen_at: number; expires_at: number; user_id: string; email: string; name: string }>();
  if (!row) return null;

  if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
    await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(now, sessionId).run();
  }
  return { sessionId, userId: row.user_id, email: row.email, name: row.name, expiresAt: row.expires_at };
}

export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function revokeOtherSessions(db: D1Database, userId: string, keepSessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(userId, keepSessionId).run();
}

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getRole, listMemberships } from "../accounts";
import { randomToken, sha256Hex } from "../auth/crypto";
import { requireSession } from "../auth/middleware";
import { badRequest, readJsonBody } from "../http";
import { normalizeEmail, ROLES, type AppEnv, type Role } from "../types";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const orgs = new Hono<AppEnv>();
orgs.use(requireSession);

orgs.get("/", async (c) => {
  return c.json({ organizations: await listMemberships(c.env.DB, c.get("session").userId) });
});

async function requireRole(db: D1Database, userId: string, orgId: string, allowed: Role[]): Promise<Role> {
  const role = await getRole(db, userId, orgId);
  // Non-members get 404 so organization ids cannot be probed.
  if (!role) throw new HTTPException(404, { message: "Organization not found." });
  if (!allowed.includes(role)) throw new HTTPException(403, { message: "You do not have access to do that." });
  return role;
}

orgs.get("/:orgId/members", async (c) => {
  const orgId = c.req.param("orgId");
  await requireRole(c.env.DB, c.get("session").userId, orgId, [...ROLES]);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, m.role, m.created_at AS joinedAt
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ?
      ORDER BY u.name`,
  )
    .bind(orgId)
    .all();
  return c.json({ members: results });
});

/**
 * Invites someone to the organization. Until outbound email is wired up, the
 * response carries the one-time accept link for staff to send by hand; the
 * token itself is never stored, only its hash.
 */
orgs.post("/:orgId/invitations", async (c) => {
  const session = c.get("session");
  const orgId = c.req.param("orgId");
  const inviterRole = await requireRole(c.env.DB, session.userId, orgId, ["owner", "admin"]);

  const body = await readJsonBody(c);
  const email = normalizeEmail(body.email);
  if (!email) badRequest("A valid email is required.");
  const role = (body.role ?? "member") as Role;
  if (!ROLES.includes(role)) badRequest("Role must be owner, admin or member.");
  if (role === "owner" && inviterRole !== "owner") {
    throw new HTTPException(403, { message: "Only owners can invite owners." });
  }

  const token = randomToken();
  const now = Date.now();
  const invitation = { id: crypto.randomUUID(), email, role, expiresAt: now + INVITATION_TTL_MS };
  await c.env.DB.prepare(
    `INSERT INTO invitations (id, org_id, email, role, token_hash, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(invitation.id, orgId, email, role, await sha256Hex(token), session.userId, now, invitation.expiresAt)
    .run();

  return c.json(
    { invitation, acceptUrl: `${c.env.PORTAL_ORIGIN}/invite#token=${token}` },
    201,
  );
});

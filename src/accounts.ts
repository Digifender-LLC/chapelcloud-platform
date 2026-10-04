import type { Role } from "./types";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  status: "active" | "disabled";
  failed_login_count: number;
  locked_until: number | null;
}

export interface OrgMembership {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function listMemberships(db: D1Database, userId: string): Promise<OrgMembership[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.name, o.slug, m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = ?
        ORDER BY o.name`,
    )
    .bind(userId)
    .all<OrgMembership>();
  return results;
}

export async function getRole(db: D1Database, userId: string, orgId: string): Promise<Role | null> {
  const row = await db
    .prepare("SELECT role FROM memberships WHERE user_id = ? AND org_id = ?")
    .bind(userId, orgId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

export function publicUser(user: { id: string; email: string; name: string }) {
  return { id: user.id, email: user.email, name: user.name };
}

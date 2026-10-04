import { env, exports } from "cloudflare:workers";
import { sha256Hex } from "../src/auth/crypto";
import { hashPassword } from "../src/auth/password";
import type { Role } from "../src/types";

export const PORTAL = "https://portal.chapel.cloud";
export const API = "https://api.chapel.cloud";

export function call(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers = new Headers({ Origin: init.origin ?? PORTAL });
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (init.cookie) headers.set("Cookie", init.cookie);
  return (exports as unknown as { default: Fetcher }).default.fetch(
    new Request(API + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

/** Turns a Set-Cookie response header into a Cookie request header. */
export function sessionCookie(res: Response): string {
  const header = res.headers.get("Set-Cookie") ?? "";
  const match = header.match(/__Host-cc_session=([^;]*)/);
  if (!match) throw new Error(`No session cookie in: ${header}`);
  return `__Host-cc_session=${match[1]}`;
}

let counter = 0;
export function uniqueEmail(prefix = "user") {
  return `${prefix}-${++counter}-${crypto.randomUUID().slice(0, 8)}@example.org`;
}

export async function createOrg(name = "Grace Chapel") {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, `${name.toLowerCase().replace(/\W+/g, "-")}-${id.slice(0, 8)}`, Date.now())
    .run();
  return id;
}

export async function createUser(opts: { email?: string; password?: string; orgId?: string; role?: Role } = {}) {
  const id = crypto.randomUUID();
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? "correct horse battery staple";
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, email, "Test User", await hashPassword(password), now, now)
    .run();
  if (opts.orgId) {
    await env.DB.prepare("INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, opts.orgId, opts.role ?? "member", now)
      .run();
  }
  return { id, email, password };
}

export async function login(email: string, password: string) {
  const res = await call("/v1/auth/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return sessionCookie(res);
}

export async function createInvitation(orgId: string, email: string, role: Role = "member", expiresAt = Date.now() + 60_000) {
  const token = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO invitations (id, org_id, email, role, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), orgId, email, role, await sha256Hex(token), Date.now(), expiresAt)
    .run();
  return token;
}

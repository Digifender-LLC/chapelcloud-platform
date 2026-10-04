import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LOCKOUT_MS, MAX_FAILED_LOGINS } from "../src/routes/auth";
import { call, createInvitation, createOrg, createUser, login, sessionCookie, uniqueEmail } from "./helpers";

describe("login", () => {
  it("signs in with the right password and sets a host-only secure cookie", async () => {
    const orgId = await createOrg();
    const user = await createUser({ orgId, role: "owner" });

    const res = await call("/v1/auth/login", { body: { email: ` ${user.email.toUpperCase()} `, password: user.password } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/^__Host-cc_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).not.toMatch(/Domain=/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.json<any>();
    expect(body.user).toEqual({ id: user.id, email: user.email, name: "Test User" });
    expect(body.organizations).toEqual([expect.objectContaining({ id: orgId, role: "owner" })]);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const user = await createUser();
    const wrong = await call("/v1/auth/login", { body: { email: user.email, password: "not the password" } });
    const unknown = await call("/v1/auth/login", { body: { email: uniqueEmail(), password: "not the password" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get("Set-Cookie")).toBeNull();
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    const user = await createUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await call("/v1/auth/login", { body: { email: user.email, password: "wrong password!" } });
    }
    const locked = await call("/v1/auth/login", { body: { email: user.email, password: user.password } });
    expect(locked.status).toBe(429);

    const row = await env.DB.prepare("SELECT locked_until FROM users WHERE id = ?").bind(user.id).first<{ locked_until: number }>();
    expect(row!.locked_until).toBeGreaterThan(Date.now() + LOCKOUT_MS - 60_000);
  });

  it("rejects disabled accounts", async () => {
    const user = await createUser();
    await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(user.id).run();
    const res = await call("/v1/auth/login", { body: { email: user.email, password: user.password } });
    expect(res.status).toBe(401);
  });

  it("requires a JSON body", async () => {
    const res = await call("/v1/auth/login", { method: "POST" });
    expect(res.status).toBe(415);
  });

  it("rejects state-changing requests from other origins", async () => {
    const user = await createUser();
    const res = await call("/v1/auth/login", {
      body: { email: user.email, password: user.password },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });

  it("allows credentialed CORS only for the portal", async () => {
    const res = await call("/v1/auth/session", {});
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://portal.chapel.cloud");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});

describe("sessions", () => {
  it("returns the signed-in customer and ends the session on logout", async () => {
    const user = await createUser();
    const cookie = await login(user.email, user.password);

    const me = await call("/v1/auth/session", { cookie });
    expect(me.status).toBe(200);
    expect((await me.json<any>()).user.email).toBe(user.email);

    const out = await call("/v1/auth/logout", { method: "POST", cookie });
    expect(out.status).toBe(204);
    expect(out.headers.get("Set-Cookie")).toMatch(/__Host-cc_session=;/);
    expect((await call("/v1/auth/session", { cookie })).status).toBe(401);
  });

  it("rejects missing, forged and expired sessions", async () => {
    expect((await call("/v1/auth/session")).status).toBe(401);
    expect((await call("/v1/auth/session", { cookie: "__Host-cc_session=forged" })).status).toBe(401);

    const user = await createUser();
    const cookie = await login(user.email, user.password);
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").bind(Date.now() - 1, user.id).run();
    expect((await call("/v1/auth/session", { cookie })).status).toBe(401);
  });

  it("ends sessions that sit idle too long", async () => {
    const user = await createUser();
    const cookie = await login(user.email, user.password);
    await env.DB.prepare("UPDATE sessions SET last_seen_at = 0 WHERE user_id = ?").bind(user.id).run();
    expect((await call("/v1/auth/session", { cookie })).status).toBe(401);
  });

  it("stores only a hash of the session token", async () => {
    const user = await createUser();
    const cookie = await login(user.email, user.password);
    const token = cookie.split("=")[1]!;
    const row = await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ?").bind(user.id).first<{ id: string }>();
    expect(row!.id).not.toBe(token);
    expect(row!.id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("password change", () => {
  it("requires the current password and signs out other sessions", async () => {
    const user = await createUser();
    const here = await login(user.email, user.password);
    const elsewhere = await login(user.email, user.password);
    const newPassword = "a brand new long passphrase";

    const wrong = await call("/v1/auth/password", { cookie: here, body: { currentPassword: "nope nope nope", newPassword } });
    expect(wrong.status).toBe(401);

    const short = await call("/v1/auth/password", { cookie: here, body: { currentPassword: user.password, newPassword: "short" } });
    expect(short.status).toBe(400);

    const ok = await call("/v1/auth/password", { cookie: here, body: { currentPassword: user.password, newPassword } });
    expect(ok.status).toBe(204);
    expect((await call("/v1/auth/session", { cookie: here })).status).toBe(200);
    expect((await call("/v1/auth/session", { cookie: elsewhere })).status).toBe(401);
    expect((await call("/v1/auth/login", { body: { email: user.email, password: newPassword } })).status).toBe(200);
  });
});

describe("invitations", () => {
  it("lets a new customer set up their account and signs them in", async () => {
    const orgId = await createOrg();
    const email = uniqueEmail("new");
    const token = await createInvitation(orgId, email, "admin");

    const res = await call("/v1/auth/invitations/accept", {
      body: { token, name: "Pastor Jo", password: "a long enough passphrase" },
    });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.user).toMatchObject({ email, name: "Pastor Jo" });
    expect(body.organizations).toEqual([expect.objectContaining({ id: orgId, role: "admin" })]);
    expect((await call("/v1/auth/session", { cookie: sessionCookie(res) })).status).toBe(200);

    const again = await call("/v1/auth/invitations/accept", {
      body: { token, name: "Pastor Jo", password: "a long enough passphrase" },
    });
    expect(again.status).toBe(400);
  });

  it("adds an existing customer after they confirm their password", async () => {
    const firstOrg = await createOrg("First Church");
    const secondOrg = await createOrg("Second Church");
    const user = await createUser({ orgId: firstOrg });
    const token = await createInvitation(secondOrg, user.email);

    const wrong = await call("/v1/auth/invitations/accept", { body: { token, password: "wrong password!" } });
    expect(wrong.status).toBe(401);

    const res = await call("/v1/auth/invitations/accept", { body: { token, password: user.password } });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).organizations.map((o: any) => o.id).sort()).toEqual([firstOrg, secondOrg].sort());
  });

  it("rejects expired and unknown invitations", async () => {
    const orgId = await createOrg();
    const token = await createInvitation(orgId, uniqueEmail(), "member", Date.now() - 1);
    const body = { name: "X", password: "a long enough passphrase" };
    expect((await call("/v1/auth/invitations/accept", { body: { ...body, token } })).status).toBe(400);
    expect((await call("/v1/auth/invitations/accept", { body: { ...body, token: "nope" } })).status).toBe(400);
  });

  it("will not let a signed-in customer take someone else's invitation", async () => {
    const orgId = await createOrg();
    const user = await createUser();
    const cookie = await login(user.email, user.password);
    const token = await createInvitation(orgId, uniqueEmail("other"));
    const res = await call("/v1/auth/invitations/accept", {
      cookie,
      body: { token, name: "Other", password: "a long enough passphrase" },
    });
    expect(res.status).toBe(403);
  });
});

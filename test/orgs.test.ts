import { describe, expect, it } from "vitest";
import { call, createOrg, createUser, login, sessionCookie, uniqueEmail } from "./helpers";

describe("organizations", () => {
  it("lists only the caller's organizations", async () => {
    const mine = await createOrg("Mine");
    await createOrg("Not Mine");
    const user = await createUser({ orgId: mine, role: "member" });
    const cookie = await login(user.email, user.password);

    const res = await call("/v1/orgs", { cookie });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).organizations.map((o: any) => o.id)).toEqual([mine]);
  });

  it("hides other organizations' members", async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    const user = await createUser({ orgId: mine });
    const cookie = await login(user.email, user.password);

    expect((await call(`/v1/orgs/${mine}/members`, { cookie })).status).toBe(200);
    expect((await call(`/v1/orgs/${theirs}/members`, { cookie })).status).toBe(404);
  });

  it("lets admins invite, and the invitee can join with the returned link", async () => {
    const orgId = await createOrg();
    const admin = await createUser({ orgId, role: "admin" });
    const cookie = await login(admin.email, admin.password);
    const email = uniqueEmail("invitee");

    const res = await call(`/v1/orgs/${orgId}/invitations`, { cookie, body: { email, role: "member" } });
    expect(res.status).toBe(201);
    const { acceptUrl } = await res.json<any>();
    expect(acceptUrl).toMatch(/^https:\/\/portal\.chapel\.cloud\/invite#token=/);

    const token = new URL(acceptUrl).hash.slice("#token=".length);
    const accepted = await call("/v1/auth/invitations/accept", {
      body: { token, name: "New Member", password: "a long enough passphrase" },
    });
    expect(accepted.status).toBe(200);

    const members = await call(`/v1/orgs/${orgId}/members`, { cookie: sessionCookie(accepted) });
    expect((await members.json<any>()).members.map((m: any) => m.email).sort()).toEqual([admin.email, email].sort());
  });

  it("stops members inviting, and admins inviting owners", async () => {
    const orgId = await createOrg();
    const member = await createUser({ orgId, role: "member" });
    const admin = await createUser({ orgId, role: "admin" });
    const memberCookie = await login(member.email, member.password);
    const adminCookie = await login(admin.email, admin.password);

    expect((await call(`/v1/orgs/${orgId}/invitations`, { cookie: memberCookie, body: { email: uniqueEmail() } })).status).toBe(403);
    expect(
      (await call(`/v1/orgs/${orgId}/invitations`, { cookie: adminCookie, body: { email: uniqueEmail(), role: "owner" } })).status,
    ).toBe(403);
  });

  it("requires a session", async () => {
    expect((await call("/v1/orgs")).status).toBe(401);
  });
});

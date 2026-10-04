# Customer portal sign-in (design)

- **Status:** Proposed. Mirror as an ADR in `company/decisions` once accepted.
- **Date:** 2026-10-04

The customer portal is a browser app (future repo, `portal.chapel.cloud`) that
calls this platform API (`api.chapel.cloud`). This document covers how a
church or nonprofit's staff get an account, sign in, and stay signed in.

## Choices

| Area | Choice | Why |
|------|--------|-----|
| Runtime | Cloudflare Worker + [Hono](https://hono.dev) | Matches home-site's Cloudflare stack; free tier; no servers to run. |
| Storage | Cloudflare D1 (SQLite), migrations in `migrations/` | Free tier, relational, lives next to the Worker. |
| Credentials | Email + password, PBKDF2-SHA256 (100k iterations, per-user salt) | WebCrypto-native. 100k is the Workers maximum; the hash string records the parameters so we can move to Argon2id (WASM) later and rehash on login. |
| Sessions | Opaque 256-bit token in a cookie; only its SHA-256 is stored | Revocable server-side (logout, password change, disable account), unlike JWTs. A database leak cannot be replayed as cookies. |
| Cookie | `__Host-cc_session`, `Secure; HttpOnly; SameSite=Lax; Path=/` | `__Host-` pins it to the API host with no `Domain`. |
| Lifetime | 30 days absolute, 7 days idle | Church staff sign in occasionally; a week of inactivity is a reasonable cut-off. |
| Sign-up | Invitation only, no public sign-up | ChapelCloud is a managed service: we onboard each customer, then their owners and admins invite staff. |
| CSRF | `SameSite=Lax`, JSON-only bodies, and an `Origin` check on every non-GET | A cross-site form cannot send JSON, and any browser request from another origin is rejected. |
| CORS | Credentialed CORS for `PORTAL_ORIGIN` only | Portal and API sit on sibling subdomains of `chapel.cloud`, so they are same-site. |
| Brute force | 10 consecutive failures lock the account for 15 minutes | Simple and stateful in D1. Add Cloudflare rate limiting per IP in front once we deploy. |
| Enumeration | Same 401 for unknown email and wrong password, with a dummy hash check to equalise timing | Login should not reveal who our customers are. |

## Data model

```
organizations ──< memberships >── users ──< sessions
      └──< invitations
```

- **organizations**: a church or nonprofit customer.
- **users**: a person. One account can belong to several organizations.
- **memberships**: `owner`, `admin` or `member` per organization. Owners and
  admins can invite; only owners can invite owners.
- **invitations**: one-time, 7-day token, stored as a hash.
- **sessions**: see above.

## API

All under `/v1`, JSON in and out, errors as `{ "error": "..." }`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/login` | none | `{ email, password }` → sets cookie, returns user + orgs |
| POST | `/auth/logout` | cookie | Revokes the session, clears cookie |
| GET | `/auth/session` | cookie | Current user + orgs (portal calls this on load) |
| POST | `/auth/password` | cookie | `{ currentPassword, newPassword }`; signs out other sessions |
| POST | `/auth/invitations/accept` | none | `{ token, name, password }` for new users, `{ token, password }` for existing ones; signs in |
| GET | `/orgs` | cookie | Organizations the user belongs to |
| GET | `/orgs/:orgId/members` | member | Member list (404 for non-members) |
| POST | `/orgs/:orgId/invitations` | owner/admin | `{ email, role }` → one-time `acceptUrl` |

## Onboarding a new customer

There is no outbound email yet, so invitations return their link for staff to
send by hand. For a brand-new organization (an owner-only step that writes
to the production database; coding agents must not run it):

```sh
node scripts/invite-owner.mjs "Grace Chapel" pastor@gracechapel.org > invite.sql
npx wrangler d1 execute chapelcloud-platform --remote --file invite.sql   # owner only
# send the printed link to the pastor
```

The link uses a URL fragment (`#token=`) so the token is never sent to a server
in a request line or logged by a proxy.

## Not yet built

- Password reset by email (needs an email provider; until then a forgotten
  password has to be reset by ChapelCloud staff).
- Outbound invitation emails.
- Per-IP rate limiting at the edge.
- Two-factor sign-in (TOTP or passkeys), worth adding before billing data
  lives in the portal.
- Revoking invitations and removing members, listing and revoking own sessions.
- Staff (ChapelCloud-side) admin access across organizations.

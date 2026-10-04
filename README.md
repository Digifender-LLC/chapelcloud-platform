# ChapelCloud — platform (`chapelcloud-platform`)

Shared backend platform for ChapelCloud: organizations (churches / nonprofits), auth, billing hooks, and device registry for connected hardware.

This repo is a scaffold. Implementation choices will be recorded as ADRs in [`company/decisions`](https://github.com/chapelcloud/company/tree/main/decisions) and mirrored here under `docs/`.

## Intended scope

- **Orgs & members** — churches/nonprofits and staff roles
- **Auth** — sign-in for portal and device pairing
- **Billing hooks** — subscriptions / entitlements (provider TBD)
- **Device registry** — campus display appliances, e-paper displays, status, config
- **APIs** used by the future customer portal and device agents

## Non-goals (for now)

- Marketing pages → [`home-site`](https://github.com/chapelcloud/home-site)
- Brand masters → [`brand`](https://github.com/chapelcloud/brand)
- Business plans → [`company`](https://github.com/chapelcloud/company)

## Status

The first service is the customer portal API: sign-in, sessions, customer
accounts, organizations and invitations. See
[`docs/customer-portal-auth.md`](docs/customer-portal-auth.md).

## Development

Cloudflare Worker (Hono) with a D1 database.

```sh
npm install
npm run db:migrate:local   # create local D1 tables
npm run dev                # http://localhost:8787
npm test                   # runs in the Workers runtime via Miniflare
npm run typecheck
```

Run `npm run cf-typegen` after changing bindings.

## Deployment

Merging to `main` deploys. Cloudflare Workers Builds (Worker `chapelcloud-platform`)
runs `npm run typecheck && npm test`, then applies D1 migrations to the
`chapelcloud-platform` database and runs `wrangler deploy`. A failing typecheck or
test means nothing is deployed. The API is served at `https://api.chapel.cloud`
(`workers.dev` is disabled). Never deploy or run `--remote` commands by hand;
see [`AGENTS.md`](AGENTS.md).

## Docs

- [`docs/architecture.md`](docs/architecture.md) — target shape
- [`docs/domains.md`](docs/domains.md) — product domains this platform serves
- [`docs/customer-portal-auth.md`](docs/customer-portal-auth.md) — portal sign-in design

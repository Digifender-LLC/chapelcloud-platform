# ChapelCloud — platform

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

Scaffold only. No runtime service yet.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — target shape
- [`docs/domains.md`](docs/domains.md) — product domains this platform serves

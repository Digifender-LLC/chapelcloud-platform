# Agent instructions

## Deployment rule

- **Merging to `main` deploys to production.** Cloudflare Workers Builds (Worker
  `chapelcloud-platform`, served at `https://api.chapel.cloud`) runs on every push
  to `main`:
  - build: `npm run typecheck && npm test`
  - deploy: `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`
- A failing typecheck or test blocks the deploy, so keep both green. Run them
  locally before opening a PR.
- **Never run `wrangler deploy`, `wrangler versions upload`, `wrangler secret`, or
  any `--remote` command (e.g. `wrangler d1 execute/migrations apply --remote`) by
  hand.** Ship changes by opening a PR and merging it. Agents do not need
  Cloudflare credentials.
- **Migrations must be backward compatible.** They are applied to the production
  D1 database *before* the new Worker code goes live, so the currently running
  code must keep working against the migrated schema. Add columns/tables rather
  than renaming or dropping; remove old columns only in a later PR after no
  deployed code uses them. Never edit a migration that has already been merged.
- Keep the Worker `name`, the D1 `database_name`/`database_id`, the
  `api.chapel.cloud` custom domain and `"workers_dev": false` in `wrangler.jsonc`
  unchanged unless the owner asks.
- Plain vars belong in `wrangler.jsonc` (dashboard-only vars are overwritten on
  deploy). Secrets are set by the owner in Cloudflare, never committed.

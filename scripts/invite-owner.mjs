#!/usr/bin/env node
// Creates an organization and a one-time owner invitation for its first
// customer. Prints the SQL to run and the link to send them.
//
//   node scripts/invite-owner.mjs "Grace Chapel" pastor@gracechapel.org > invite.sql
//   npx wrangler d1 execute chapelcloud-platform --remote --file invite.sql
//
// Owner-only: the second command writes to the production database. Coding
// agents must not run it (see AGENTS.md).
//
// The link is printed to stderr so it never lands in the SQL file.
import { createHash, randomBytes, randomUUID } from "node:crypto";

const [name, rawEmail, portalOrigin = "https://portal.chapel.cloud"] = process.argv.slice(2);
if (!name || !rawEmail) {
  console.error('Usage: node scripts/invite-owner.mjs "<org name>" <owner email> [portal origin]');
  process.exit(1);
}

const email = rawEmail.trim().toLowerCase();
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const orgId = randomUUID();
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const now = Date.now();
const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
const sql = (value) => `'${String(value).replace(/'/g, "''")}'`;

console.log(`INSERT INTO organizations (id, name, slug, created_at) VALUES (${sql(orgId)}, ${sql(name)}, ${sql(slug)}, ${now});`);
console.log(
  `INSERT INTO invitations (id, org_id, email, role, token_hash, created_at, expires_at) ` +
    `VALUES (${sql(randomUUID())}, ${sql(orgId)}, ${sql(email)}, 'owner', ${sql(tokenHash)}, ${now}, ${expiresAt});`,
);
console.error(`\nSend this link to ${email} (valid for 7 days):\n${portalOrigin}/invite#token=${token}\n`);

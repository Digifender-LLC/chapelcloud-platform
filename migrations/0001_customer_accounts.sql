-- Customer accounts, organizations, sessions and invitations for the portal.
-- Timestamps are Unix epoch milliseconds.

CREATE TABLE organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,   -- stored trimmed + lowercased
  name                TEXT NOT NULL,
  password_hash       TEXT NOT NULL,          -- see src/auth/password.ts for format
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE memberships (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  org_id      TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, org_id)
);

CREATE INDEX memberships_org_id ON memberships (org_id);

-- The session id is the SHA-256 of the cookie token, so a leaked database
-- row cannot be replayed as a cookie.
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  user_agent    TEXT,
  ip            TEXT
);

CREATE INDEX sessions_user_id ON sessions (user_id);

CREATE TABLE invitations (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  token_hash   TEXT NOT NULL UNIQUE,
  invited_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER
);

CREATE INDEX invitations_org_id ON invitations (org_id);

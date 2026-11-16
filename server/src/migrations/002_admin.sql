-- Platform superadmin: the product operator, above every shop account.
-- Kept separate from shop users so shop auth is untouched and an admin owns no
-- shop. Admins are seeded, never created through a public sign-up.

CREATE TABLE admins (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  id         text PRIMARY KEY,
  admin_id   text NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions(admin_id);

-- Platform suspension is distinct from a shop's own open/close: a suspended
-- shop cannot take customer uploads regardless of its is_open setting, and the
-- shop cannot lift it itself. Null means not suspended.
ALTER TABLE shops ADD COLUMN suspended_at timestamptz;
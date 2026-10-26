-- Named admin accounts, so every change can be put down to someone. The
-- ADMIN_PASSWORD login stays as the owner's way in (and to add the first
-- admins).
CREATE TABLE admins (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- Kept lower-case; admins log in with it.
  email text NOT NULL UNIQUE,
  salt text NOT NULL,
  password_hash text NOT NULL,
  -- Logins from before this moment no longer work (set on a password reset).
  sessions_valid_after timestamptz NOT NULL DEFAULT '-infinity',
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Who changed what, in words, newest first.
CREATE TABLE activity_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor text NOT NULL,
  summary text NOT NULL
);
CREATE INDEX activity_log_at_idx ON activity_log (at DESC);

-- A new password ends the employee's other logins too.
ALTER TABLE employees
  ADD COLUMN sessions_valid_after timestamptz NOT NULL DEFAULT '-infinity';

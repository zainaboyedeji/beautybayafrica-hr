-- The owner is an ordinary admin account (email and password), made from
-- ADMIN_EMAIL and ADMIN_PASSWORD when the server starts. Its password is kept
-- in step with ADMIN_PASSWORD, so it can always be recovered from the host's
-- settings, and it can't be deactivated from the app.
ALTER TABLE admins ADD COLUMN is_owner boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX admins_one_owner ON admins (is_owner) WHERE is_owner;

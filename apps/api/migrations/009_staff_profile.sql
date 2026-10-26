-- Profile photos, in their own table so lists of employees stay small. The
-- site shrinks each one to a small square JPEG before it is sent.
CREATE TABLE employee_photos (
  employee_id text PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Personal details the employee keeps up to date in the staff portal.
ALTER TABLE employees
  ADD COLUMN date_of_birth date,
  ADD COLUMN home_address text,
  ADD COLUMN emergency_name text,
  ADD COLUMN emergency_relationship text,
  ADD COLUMN emergency_phone text;

-- HR's noticeboard, shown to everyone in the staff portal.
CREATE TABLE announcements (
  id text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  posted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX announcements_created_idx ON announcements (created_at DESC);

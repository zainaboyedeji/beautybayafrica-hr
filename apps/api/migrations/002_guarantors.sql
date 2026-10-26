-- People who vouch for an employee. HR or the employee can add them; HR
-- marks each one verified once checked, and any later change by the employee
-- clears that so HR checks again.
CREATE TABLE guarantors (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text NOT NULL,
  phone text NOT NULL,
  email text,
  address text NOT NULL,
  occupation text,
  workplace text,
  added_by text NOT NULL CHECK (added_by IN ('admin', 'employee')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guarantors_employee_idx ON guarantors (employee_id, created_at);

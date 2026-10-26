-- A password HR gives someone is temporary: they choose their own the next
-- time they log in, before they can do anything else. Everyone with a
-- password today was given it by HR, so they choose their own too.
ALTER TABLE employees
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
UPDATE employees SET must_change_password = true WHERE password_hash IS NOT NULL;

-- What staff ask HR for: a new password, a bank change, a letter...
CREATE TABLE staff_requests (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN
    ('password_reset', 'bank_change', 'details_correction', 'letter', 'other')),
  details text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'declined', 'cancelled')),
  -- HR's reply, which the employee sees.
  response text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX staff_requests_employee_idx ON staff_requests (employee_id, created_at DESC);
CREATE INDEX staff_requests_open_idx ON staff_requests (created_at DESC) WHERE status = 'open';

CREATE TABLE departments (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Everyone who works for the company, current and past. Leavers keep their
-- row (with end_date) so their leave and payslips stay on record.
CREATE TABLE employees (
  id text PRIMARY KEY,
  employee_no text NOT NULL UNIQUE,
  name text NOT NULL,
  -- Kept lower-case; employees log in to the staff portal with it.
  email text NOT NULL UNIQUE,
  phone text,
  job_title text NOT NULL,
  department_id text REFERENCES departments (id) ON DELETE SET NULL,
  employment_type text NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  start_date date NOT NULL,
  end_date date CHECK (end_date >= start_date),
  base_salary numeric(12, 2) NOT NULL CHECK (base_salary >= 0),
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  annual_leave_days integer NOT NULL DEFAULT 20 CHECK (annual_leave_days >= 0),
  -- Empty until the admin gives them a password for the staff portal.
  salt text,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Fixed monthly allowances (housing, transport…) and deductions (loan…).
CREATE TABLE pay_items (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('allowance', 'deduction')),
  name text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX pay_items_employee_idx ON pay_items (employee_id);

CREATE TABLE leave_requests (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN
    ('annual', 'sick', 'unpaid', 'maternity', 'paternity', 'compassionate')),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  -- Monday-to-Friday days covered, worked out when the request is made.
  days integer NOT NULL CHECK (days > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX leave_requests_employee_idx ON leave_requests (employee_id, start_date);

-- One payroll per month. A draft can be recalculated or deleted; once marked
-- paid it is locked and employees can see their payslips.
CREATE TABLE payroll_runs (
  period text PRIMARY KEY CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  paid_at timestamptz
);

-- Each payslip keeps its own copy of the employee's details and every pay
-- line, so later changes to an employee don't rewrite past payslips.
CREATE TABLE payslips (
  period text NOT NULL REFERENCES payroll_runs (period) ON DELETE CASCADE,
  -- No foreign key: a payslip outlives the employee record.
  employee_id text NOT NULL,
  employee_no text NOT NULL,
  employee_name text NOT NULL,
  job_title text NOT NULL,
  department_name text,
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  working_days integer NOT NULL,
  days_paid integer NOT NULL,
  earnings jsonb NOT NULL,
  deductions jsonb NOT NULL,
  bonus numeric(12, 2) NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  other_deduction numeric(12, 2) NOT NULL DEFAULT 0 CHECK (other_deduction >= 0),
  note text,
  gross numeric(12, 2) NOT NULL,
  total_deductions numeric(12, 2) NOT NULL,
  net numeric(12, 2) NOT NULL,
  PRIMARY KEY (period, employee_id)
);

-- New starters get their contract, then their account set-up, by email to
-- their personal address (they have no work login yet).
ALTER TABLE employees
  ADD COLUMN personal_email text,
  -- A one-time link to choose their own password (only its hash is kept).
  ADD COLUMN setup_token_hash text UNIQUE,
  ADD COLUMN setup_token_expires_at timestamptz;

-- HR's contract wording, with {{blanks}} filled in for each person.
CREATE TABLE contract_templates (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- One contract sent to one person. The wording is copied in when it is sent,
-- so later edits to the template don't change what they were offered.
CREATE TABLE contracts (
  id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  template_name text,
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'viewed', 'accepted', 'withdrawn')),
  -- The link in the email (only its hash is kept).
  token_hash text NOT NULL UNIQUE,
  token_expires_at timestamptz NOT NULL,
  sent_by text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  viewed_at timestamptz,
  -- How they accepted: the name they typed, when, and from where.
  accepted_at timestamptz,
  accepted_name text,
  accepted_ip text,
  accepted_user_agent text
);
CREATE INDEX contracts_employee_idx ON contracts (employee_id, sent_at DESC);

-- Every email the app sends (or would send, before email is set up).
CREATE TABLE email_outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  -- sent, failed, or not_sent when no email service is set up yet.
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'not_sent')),
  error text,
  employee_id text REFERENCES employees (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX email_outbox_created_idx ON email_outbox (created_at DESC);

-- A starting point for HR to edit. Have it checked by a lawyer before use.
INSERT INTO contract_templates (id, name, body) VALUES (
  'default-full-time',
  'Full-time employment',
  $template$CONTRACT OF EMPLOYMENT

This contract is between {{company}} ("the Company") and {{name}} ("the Employee"), and starts on {{start_date}}.

1. Job
You are employed as {{job_title}} in {{department}}, on a {{employment_type}} basis. Your duties are those of the role, and any other reasonable duties the Company asks of you.

2. Pay
Your basic salary is {{basic_salary}} a month. You also receive these monthly allowances: {{allowances}}. Your total monthly pay before deductions is {{monthly_pay}}. Pay is made by bank transfer at the end of each month, less any deductions required by law (such as PAYE and pension) and any others you agree to in writing.

3. Hours
Your normal working days are Monday to Friday. Your hours will be set by your manager to meet the needs of the business.

4. Probation
The first 3 months are a probation period. During probation either side may end this contract with one week's written notice.

5. Leave
You are entitled to {{annual_leave_days}} working days of paid annual leave each calendar year, in addition to public holidays. Leave must be requested in the staff portal and approved before it is taken.

6. Notice
After probation, either side may end this contract with one month's written notice, or pay in place of notice.

7. Confidentiality
You must not share the Company's confidential information, or that of its customers, during or after your employment.

8. Conduct
You agree to follow the Company's rules and policies, as updated from time to time.

By accepting, you confirm you have read and agree to these terms.

{{company}}
{{today}}$template$
);

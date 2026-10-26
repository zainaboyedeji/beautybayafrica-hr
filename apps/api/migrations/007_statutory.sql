-- What the PAYE and pension remittance schedules need: each employee's tax ID,
-- pension fund administrator and RSA PIN, the employer's pension share, and
-- whether NHF (2.5% of basic) is taken.
ALTER TABLE employees
  ADD COLUMN tax_id text,
  ADD COLUMN pension_provider text,
  ADD COLUMN pension_pin text,
  ADD COLUMN employer_pension_percent numeric(5, 2) NOT NULL DEFAULT 0
    CHECK (employer_pension_percent >= 0 AND employer_pension_percent <= 100),
  ADD COLUMN nhf boolean NOT NULL DEFAULT false;

-- Payslips keep their own copy, like the other details.
ALTER TABLE payslips
  ADD COLUMN tax_id text,
  ADD COLUMN pension_provider text,
  ADD COLUMN pension_pin text,
  -- Paid by the company on top of salary, so not a deduction.
  ADD COLUMN employer_pension numeric(12, 2) NOT NULL DEFAULT 0;

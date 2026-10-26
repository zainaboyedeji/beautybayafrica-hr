-- Pension and PAYE are set per employee by HR, instead of for the whole
-- company. Pension is a % of basic + allowances (0 = none). PAYE is 'none',
-- a 'fixed' monthly amount HR enters, or 'auto' (worked out from the tax
-- bands). Everyone starts with neither, as HR adds them when they apply.
ALTER TABLE employees
  ADD COLUMN pension_percent numeric(5, 2) NOT NULL DEFAULT 0
    CHECK (pension_percent >= 0 AND pension_percent <= 100),
  ADD COLUMN paye text NOT NULL DEFAULT 'none'
    CHECK (paye IN ('none', 'fixed', 'auto')),
  ADD COLUMN paye_amount numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (paye_amount >= 0);

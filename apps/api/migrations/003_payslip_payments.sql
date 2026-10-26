-- Salaries are paid person by person: each payslip records when its transfer
-- was confirmed and the payment reference. Employees see a payslip once it is
-- paid, and the month locks when everyone is.
ALTER TABLE payslips ADD COLUMN paid_at timestamptz;
ALTER TABLE payslips ADD COLUMN payment_reference text;

-- Months already marked paid count as paid for everyone in them.
UPDATE payslips p SET paid_at = r.paid_at
FROM payroll_runs r
WHERE r.period = p.period AND r.status = 'paid' AND p.paid_at IS NULL;

-- HR can deactivate an employee, e.g. on suspension or dismissal: they are
-- shut out of the staff portal at once, open sessions included. Their records,
-- pay and password are kept, so reactivating restores access as it was.
ALTER TABLE employees ADD COLUMN deactivated_at timestamptz;

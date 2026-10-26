import { db, transaction } from "./db";
import {
  adminOnly,
  anyone,
  clearFailedLogins,
  createToken,
  employeeOnly,
  hashPassword,
  isAdminPassword,
  isLockedOut,
  LOCKOUT_MINUTES,
  MIN_PASSWORD_LENGTH,
  passwordMatchesHash,
  recordFailedLogin,
  sessionOf,
  type Session,
} from "./auth";
import {
  calculatePayslip,
  isDay,
  isPeriod,
  periodEnd,
  periodStart,
  round2,
  today,
  weekdaysBetween,
} from "./payroll";
import { salaryReference } from "@hr/types";
import express from "express";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type {
  Dashboard,
  Guarantor,
  Day,
  Department,
  Employee,
  EmploymentType,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  MyProfile,
  PayItem,
  PayeMode,
  PayItemKind,
  PayLine,
  PayrollRun,
  PayrollRunDetail,
  PayrollStatus,
  Payslip,
} from "@hr/types";

const app = express();
// 4100 locally, so it can run next to the POS API (4000).
const port = Number(process.env.PORT ?? 4100);

// Behind a hosting proxy (e.g. Render), set TRUST_PROXY=1 so login attempts
// are counted per visitor rather than for the proxy as a whole.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));

// An error with the HTTP status to answer with, for use inside transactions.
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Trimmed text, or null when empty. */
const optionalText = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
};

const optionalAmount = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === "") return 0;
  const amount = Number(value);
  if (!(amount >= 0)) throw new HttpError(400, `${label} must be 0 or more`);
  return round2(amount);
};

// --- Database rows ---------------------------------------------------------

type EmployeeRow = {
  id: string;
  employee_no: string;
  name: string;
  email: string;
  phone: string | null;
  job_title: string;
  department_id: string | null;
  department_name: string | null;
  employment_type: EmploymentType;
  start_date: Day;
  end_date: Day | null;
  base_salary: number;
  pension_percent: number;
  paye: PayeMode;
  paye_amount: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  annual_leave_days: number;
  salt: string | null;
  password_hash: string | null;
  deactivated_at: Date | null;
  annual_leave_taken: number;
  monthly_allowances?: number;
  guarantor_count: number;
  verified_guarantor_count: number;
};

const toEmployee = (row: EmployeeRow): Employee => ({
  id: row.id,
  employeeNo: row.employee_no,
  name: row.name,
  email: row.email,
  ...(row.phone !== null ? { phone: row.phone } : {}),
  jobTitle: row.job_title,
  ...(row.department_id !== null ? { departmentId: row.department_id } : {}),
  ...(row.department_name !== null ? { departmentName: row.department_name } : {}),
  employmentType: row.employment_type,
  startDate: row.start_date,
  ...(row.end_date !== null ? { endDate: row.end_date } : {}),
  baseSalary: row.base_salary,
  monthlyAllowances: row.monthly_allowances ?? 0,
  ...(row.bank_name !== null ? { bankName: row.bank_name } : {}),
  ...(row.bank_account_number !== null
    ? { bankAccountNumber: row.bank_account_number }
    : {}),
  ...(row.bank_account_name !== null ? { bankAccountName: row.bank_account_name } : {}),
  pensionPercent: row.pension_percent,
  paye: row.paye,
  payeAmount: row.paye_amount,
  annualLeaveDays: row.annual_leave_days,
  annualLeaveTaken: row.annual_leave_taken,
  canLogIn: row.password_hash !== null,
  ...(row.deactivated_at !== null
    ? { deactivatedAt: row.deactivated_at.toISOString() }
    : {}),
  guarantors: row.guarantor_count,
  verifiedGuarantors: row.verified_guarantor_count,
});

// Annual leave counts against the year it starts in (requests can't span years).
const EMPLOYEE_SELECT = `
  SELECT e.*, d.name AS department_name,
    COALESCE((
      SELECT sum(l.days) FROM leave_requests l
      WHERE l.employee_id = e.id AND l.type = 'annual' AND l.status = 'approved'
        AND date_part('year', l.start_date) = date_part('year', $1::date)
    ), 0)::int AS annual_leave_taken,
    COALESCE((
      SELECT sum(i.amount) FROM pay_items i
      WHERE i.employee_id = e.id AND i.kind = 'allowance'
    ), 0) AS monthly_allowances,
    (SELECT count(*) FROM guarantors g WHERE g.employee_id = e.id)::int
      AS guarantor_count,
    (SELECT count(*) FROM guarantors g
     WHERE g.employee_id = e.id AND g.verified_at IS NOT NULL)::int
      AS verified_guarantor_count
  FROM employees e LEFT JOIN departments d ON d.id = e.department_id`;

const fetchEmployees = async () =>
  (
    await db.query<EmployeeRow>(
      `${EMPLOYEE_SELECT} ORDER BY e.end_date IS NOT NULL, e.name`,
      [today()],
    )
  ).rows;

const fetchEmployee = async (id: string) =>
  (await db.query<EmployeeRow>(`${EMPLOYEE_SELECT} WHERE e.id = $2`, [today(), id]))
    .rows[0];

type LeaveRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  type: LeaveType;
  start_date: Day;
  end_date: Day;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decision_note: string | null;
  decided_at: Date | null;
  created_at: Date;
};

const toLeave = (row: LeaveRow): LeaveRequest => ({
  id: row.id,
  employeeId: row.employee_id,
  employeeName: row.employee_name,
  type: row.type,
  startDate: row.start_date,
  endDate: row.end_date,
  days: row.days,
  ...(row.reason !== null ? { reason: row.reason } : {}),
  status: row.status,
  ...(row.decision_note !== null ? { decisionNote: row.decision_note } : {}),
  ...(row.decided_at !== null ? { decidedAt: row.decided_at.toISOString() } : {}),
  createdAt: row.created_at.toISOString(),
});

const LEAVE_SELECT = `
  SELECT l.*, e.name AS employee_name
  FROM leave_requests l JOIN employees e ON e.id = l.employee_id`;

type PayslipRow = {
  period: string;
  employee_id: string;
  employee_no: string;
  employee_name: string;
  job_title: string;
  department_name: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  working_days: number;
  days_paid: number;
  earnings: PayLine[];
  deductions: PayLine[];
  bonus: number;
  other_deduction: number;
  note: string | null;
  gross: number;
  total_deductions: number;
  net: number;
  paid_at: Date | null;
  payment_reference: string | null;
};

const toPayslip = (row: PayslipRow): Payslip => ({
  period: row.period,
  employeeId: row.employee_id,
  employeeNo: row.employee_no,
  employeeName: row.employee_name,
  jobTitle: row.job_title,
  ...(row.department_name !== null ? { departmentName: row.department_name } : {}),
  ...(row.bank_name !== null ? { bankName: row.bank_name } : {}),
  ...(row.bank_account_number !== null
    ? { bankAccountNumber: row.bank_account_number }
    : {}),
  ...(row.bank_account_name !== null ? { bankAccountName: row.bank_account_name } : {}),
  workingDays: row.working_days,
  daysPaid: row.days_paid,
  earnings: row.earnings,
  deductions: row.deductions,
  bonus: row.bonus,
  otherDeduction: row.other_deduction,
  ...(row.note !== null ? { note: row.note } : {}),
  gross: row.gross,
  totalDeductions: row.total_deductions,
  net: row.net,
  ...(row.paid_at !== null ? { paidAt: row.paid_at.toISOString() } : {}),
  ...(row.payment_reference !== null ? { paymentReference: row.payment_reference } : {}),
});

type PayrollRunRow = {
  period: string;
  status: PayrollStatus;
  created_at: Date;
  paid_at: Date | null;
  employees: number;
  paid_count: number;
  gross: number;
  net: number;
};

const toPayrollRun = (row: PayrollRunRow): PayrollRun => ({
  period: row.period,
  status: row.status,
  employees: row.employees,
  paidCount: row.paid_count,
  gross: row.gross,
  net: row.net,
  createdAt: row.created_at.toISOString(),
  ...(row.paid_at !== null ? { paidAt: row.paid_at.toISOString() } : {}),
});

const RUN_SELECT = `
  SELECT r.*, count(p.employee_id)::int AS employees,
    count(p.paid_at)::int AS paid_count,
    COALESCE(sum(p.gross), 0) AS gross, COALESCE(sum(p.net), 0) AS net
  FROM payroll_runs r LEFT JOIN payslips p ON p.period = r.period`;

// The site is served from another origin (localhost:3000 or the static host).
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());

// Opening the server's address in a browser shows this instead of an error.
app.get("/", (_req, res) => {
  res.json({ service: "HR API", status: "ok" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// --- Login -----------------------------------------------------------------

app.post("/auth/login", async (req, res) => {
  const key = req.ip ?? "unknown";
  if (isLockedOut(key)) {
    res.status(429).json({
      error: `Too many wrong attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
    });
    return;
  }

  const password = String(req.body?.password ?? "");
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  let session: Omit<Session, "exp"> | null = null;
  if (!email && password && isAdminPassword(password)) {
    session = { role: "admin", name: "Admin" };
  } else if (email && password) {
    const { rows } = await db.query<EmployeeRow>(
      `SELECT * FROM employees WHERE email = $1 AND password_hash IS NOT NULL
         AND deactivated_at IS NULL AND (end_date IS NULL OR end_date >= $2)`,
      [email, today()],
    );
    const member = rows[0];
    if (
      member &&
      passwordMatchesHash(password, member.salt!, member.password_hash!)
    )
      session = { role: "employee", name: member.name, employeeId: member.id };
  }

  if (!session) {
    recordFailedLogin(key);
    res
      .status(401)
      .json({ error: email ? "Wrong email or password" : "Wrong password" });
    return;
  }
  clearFailedLogins(key);
  res.json({ token: createToken(session), role: session.role, name: session.name });
});

// --- Dashboard -------------------------------------------------------------

app.get("/dashboard", adminOnly, async (_req, res) => {
  const day = today();
  const [counts, onLeave, lastRun] = await Promise.all([
    db.query<{
      active: number;
      departments: number;
      pending: number;
      payroll: number;
    }>(
      `SELECT
         (SELECT count(*) FROM employees
          WHERE start_date <= $1 AND (end_date IS NULL OR end_date >= $1))::int AS active,
         (SELECT count(*) FROM departments)::int AS departments,
         (SELECT count(*) FROM leave_requests WHERE status = 'pending')::int AS pending,
         COALESCE((SELECT sum(e.base_salary) + COALESCE(sum(a.total), 0)
           FROM employees e
           LEFT JOIN (SELECT employee_id, sum(amount) AS total FROM pay_items
                      WHERE kind = 'allowance' GROUP BY employee_id) a
             ON a.employee_id = e.id
           WHERE e.end_date IS NULL OR e.end_date >= $1), 0) AS payroll`,
      [day],
    ),
    db.query<LeaveRow>(
      `${LEAVE_SELECT} WHERE l.status = 'approved'
         AND l.start_date <= $1 AND l.end_date >= $1
       ORDER BY e.name`,
      [day],
    ),
    db.query<PayrollRunRow>(
      `${RUN_SELECT} WHERE r.status = 'paid'
       GROUP BY r.period ORDER BY r.period DESC LIMIT 1`,
    ),
  ]);
  const c = counts.rows[0];
  const dashboard: Dashboard = {
    activeEmployees: c.active,
    departments: c.departments,
    pendingLeave: c.pending,
    onLeaveToday: onLeave.rows.map((l) => ({
      employeeName: l.employee_name,
      type: l.type,
      endDate: l.end_date,
    })),
    monthlyPayroll: c.payroll,
    ...(lastRun.rows[0] ? { lastPaidRun: toPayrollRun(lastRun.rows[0]) } : {}),
  };
  res.json(dashboard);
});

// --- Departments -----------------------------------------------------------

app.get("/departments", adminOnly, async (_req, res) => {
  const { rows } = await db.query<Department>(
    `SELECT d.id, d.name, count(e.id)::int AS headcount
     FROM departments d
     LEFT JOIN employees e ON e.department_id = d.id
       AND (e.end_date IS NULL OR e.end_date >= $1)
     GROUP BY d.id ORDER BY d.name`,
    [today()],
  );
  res.json(rows);
});

app.post("/departments", adminOnly, async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "Enter the department's name" });
    return;
  }
  const id = randomUUID();
  await db.query("INSERT INTO departments (id, name) VALUES ($1, $2)", [id, name]);
  const department: Department = { id, name, headcount: 0 };
  res.status(201).json(department);
});

app.put("/departments/:id", adminOnly, async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "Enter the department's name" });
    return;
  }
  const { rowCount } = await db.query(
    "UPDATE departments SET name = $2 WHERE id = $1",
    [req.params.id, name],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Department not found" });
    return;
  }
  res.json({ id: req.params.id, name });
});

// Its employees stay, without a department.
app.delete("/departments/:id", adminOnly, async (req, res) => {
  const { rowCount } = await db.query("DELETE FROM departments WHERE id = $1", [
    req.params.id,
  ]);
  if (!rowCount) {
    res.status(404).json({ error: "Department not found" });
    return;
  }
  res.sendStatus(204);
});

// --- Employees -------------------------------------------------------------

const EMPLOYMENT_TYPES: EmploymentType[] = [
  "full_time",
  "part_time",
  "contract",
  "intern",
];

/** The employee fields from a request body, checked. */
const readEmployeeForm = (body: Record<string, unknown> | undefined) => {
  const employeeNo = String(body?.employeeNo ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const jobTitle = String(body?.jobTitle ?? "").trim();
  const employmentType = String(body?.employmentType ?? "full_time");
  const startDate = String(body?.startDate ?? "");
  const endDate = optionalText(body?.endDate);
  const baseSalary = Number(body?.baseSalary);
  const annualLeaveDays = Number(body?.annualLeaveDays ?? 20);
  if (!employeeNo || !name || !jobTitle)
    throw new HttpError(400, "Staff number, name and job title are required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Enter a valid email address");
  if (!EMPLOYMENT_TYPES.includes(employmentType as EmploymentType))
    throw new HttpError(400, "Unknown employment type");
  if (!isDay(startDate)) throw new HttpError(400, "Choose the start date");
  if (endDate !== null && (!isDay(endDate) || endDate < startDate))
    throw new HttpError(400, "The leaving date must be on or after the start date");
  if (!(baseSalary >= 0)) throw new HttpError(400, "Enter the monthly basic salary");
  if (!Number.isInteger(annualLeaveDays) || annualLeaveDays < 0 || annualLeaveDays > 365)
    throw new HttpError(400, "Annual leave must be a whole number of days");
  const pensionPercent = Number(body?.pensionPercent ?? 0);
  if (!(pensionPercent >= 0 && pensionPercent <= 100))
    throw new HttpError(400, "Pension must be a % from 0 to 100");
  const paye = String(body?.paye ?? "none") as PayeMode;
  if (!PAYE_MODES.includes(paye)) throw new HttpError(400, "Choose how PAYE is taken");
  const payeAmount = paye === "fixed" ? optionalAmount(body?.payeAmount, "PAYE") : 0;
  if (paye === "fixed" && payeAmount === 0)
    throw new HttpError(400, "Enter the monthly PAYE amount");
  return [
    employeeNo,
    name,
    email,
    optionalText(body?.phone),
    jobTitle,
    optionalText(body?.departmentId),
    employmentType,
    startDate,
    endDate,
    round2(baseSalary),
    optionalText(body?.bankName),
    optionalText(body?.bankAccountNumber),
    optionalText(body?.bankAccountName),
    annualLeaveDays,
    round2(pensionPercent),
    paye,
    payeAmount,
  ];
};

const PAYE_MODES: PayeMode[] = ["none", "fixed", "auto"];

const checkPassword = (password: string) => {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new HttpError(
      400,
      `The password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
};

app.get("/employees", adminOnly, async (_req, res) => {
  res.json((await fetchEmployees()).map(toEmployee));
});

app.post("/employees", adminOnly, async (req, res) => {
  const values = readEmployeeForm(req.body);
  const password = String(req.body?.password ?? "");
  // A password is optional here; without one they can't use the staff portal yet.
  if (password) checkPassword(password);
  const login = password ? hashPassword(password) : null;
  // Allowances and deductions can be given with the rest of the form.
  const items = Array.isArray(req.body?.items) ? readPayItems(req.body.items) : [];
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO employees (employee_no, name, email, phone, job_title,
         department_id, employment_type, start_date, end_date, base_salary,
         bank_name, bank_account_number, bank_account_name, annual_leave_days,
         pension_percent, paye, paye_amount, id, salt, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20)`,
      [...values, id, login?.salt ?? null, login?.hash ?? null],
    );
    await savePayItems(client, id, items);
  });
  res.status(201).json(toEmployee(await fetchEmployee(id)));
});

app.put("/employees/:id", adminOnly, async (req, res) => {
  const values = readEmployeeForm(req.body);
  // Without `items`, the allowances and deductions stay as they are.
  const items = Array.isArray(req.body?.items) ? readPayItems(req.body.items) : null;
  await transaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE employees SET employee_no = $1, name = $2, email = $3, phone = $4,
         job_title = $5, department_id = $6, employment_type = $7,
         start_date = $8, end_date = $9, base_salary = $10, bank_name = $11,
         bank_account_number = $12, bank_account_name = $13,
         annual_leave_days = $14, pension_percent = $15, paye = $16,
         paye_amount = $17
       WHERE id = $18`,
      [...values, req.params.id],
    );
    if (!rowCount) throw new HttpError(404, "Employee not found");
    if (items) await savePayItems(client, String(req.params.id), items);
  });
  res.json(toEmployee(await fetchEmployee(String(req.params.id))));
});

// Give an employee a (new) password for the staff portal.
app.put("/employees/:id/password", adminOnly, async (req, res) => {
  const password = String(req.body?.password ?? "");
  checkPassword(password);
  const { salt, hash } = hashPassword(password);
  const { rowCount } = await db.query(
    "UPDATE employees SET salt = $2, password_hash = $3 WHERE id = $1",
    [req.params.id, salt, hash],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.sendStatus(204);
});

// Stop an employee using the staff portal; they are logged out straight away.
app.delete("/employees/:id/password", adminOnly, async (req, res) => {
  const { rowCount } = await db.query(
    "UPDATE employees SET salt = NULL, password_hash = NULL WHERE id = $1",
    [req.params.id],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.sendStatus(204);
});

// Shuts an employee out of the staff portal straight away, or lets them back in.
app.put("/employees/:id/active", adminOnly, async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE employees SET deactivated_at = CASE WHEN $2 THEN NULL
       ELSE COALESCE(deactivated_at, now()) END
     WHERE id = $1`,
    [req.params.id, req.body?.active === true],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.json(toEmployee(await fetchEmployee(String(req.params.id))));
});

// Only for someone added by mistake: anyone who has been paid keeps their
// record, and is given a leaving date instead.
app.delete("/employees/:id", adminOnly, async (req, res) => {
  const { rowCount: paid } = await db.query(
    "SELECT 1 FROM payslips WHERE employee_id = $1 LIMIT 1",
    [req.params.id],
  );
  if (paid) {
    res.status(409).json({
      error: "This employee has payslips. Set a leaving date instead of deleting them.",
    });
    return;
  }
  const { rowCount } = await db.query("DELETE FROM employees WHERE id = $1", [
    req.params.id,
  ]);
  if (!rowCount) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  res.sendStatus(204);
});

// --- Fixed allowances and deductions ---------------------------------------

type PayItemRow = {
  id: string;
  employee_id: string;
  kind: PayItemKind;
  name: string;
  amount: number;
};

const toPayItem = (row: PayItemRow): PayItem => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  amount: row.amount,
});

const fetchPayItems = async (client: PoolClient | typeof db, ids: string[]) =>
  (
    await client.query<PayItemRow>(
      "SELECT * FROM pay_items WHERE employee_id = ANY($1) ORDER BY created_at",
      [ids],
    )
  ).rows;

/** Allowance and deduction lines from a request body, checked. */
const readPayItems = (given: unknown[]) =>
  given.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const kind = String(item.kind ?? "") as PayItemKind;
    const name = String(item.name ?? "").trim();
    const amount = Number(item.amount);
    if (kind !== "allowance" && kind !== "deduction")
      throw new HttpError(400, "Each line must be an allowance or a deduction");
    if (!name) throw new HttpError(400, "Each line needs a name");
    if (!(amount > 0)) throw new HttpError(400, `Enter an amount for ${name}`);
    return { kind, name, amount: round2(amount) };
  });

/** Replaces an employee's allowances and deductions with `items`. */
async function savePayItems(
  client: PoolClient,
  employeeId: string,
  items: ReturnType<typeof readPayItems>,
) {
  await client.query("DELETE FROM pay_items WHERE employee_id = $1", [employeeId]);
  const rows: PayItemRow[] = [];
  for (const item of items) {
    const { rows: inserted } = await client.query<PayItemRow>(
      `INSERT INTO pay_items (id, employee_id, kind, name, amount)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [randomUUID(), employeeId, item.kind, item.name, item.amount],
    );
    rows.push(inserted[0]);
  }
  return rows;
}

app.get("/employees/:id/pay-items", adminOnly, async (req, res) => {
  res.json((await fetchPayItems(db, [String(req.params.id)])).map(toPayItem));
});

// Replaces the employee's whole list, as edited on the page.
app.put("/employees/:id/pay-items", adminOnly, async (req, res) => {
  const items = readPayItems(Array.isArray(req.body?.items) ? req.body.items : []);
  const saved = await transaction(async (client) => {
    const found = await client.query("SELECT 1 FROM employees WHERE id = $1", [
      req.params.id,
    ]);
    if (!found.rowCount) throw new HttpError(404, "Employee not found");
    return savePayItems(client, String(req.params.id), items);
  });
  res.json(saved.map(toPayItem));
});

// --- Staff portal ----------------------------------------------------------

app.get("/me", employeeOnly, async (_req, res) => {
  const row = await fetchEmployee(sessionOf(res).employeeId!);
  const employee = toEmployee(row);
  const profile: MyProfile = {
    ...employee,
    annualLeaveLeft: employee.annualLeaveDays - employee.annualLeaveTaken,
  };
  res.json(profile);
});

app.put("/me/password", employeeOnly, async (req, res) => {
  const current = String(req.body?.currentPassword ?? "");
  const next = String(req.body?.newPassword ?? "");
  const { rows } = await db.query<EmployeeRow>(
    "SELECT * FROM employees WHERE id = $1",
    [sessionOf(res).employeeId],
  );
  const me = rows[0];
  if (!passwordMatchesHash(current, me.salt!, me.password_hash!)) {
    res.status(400).json({ error: "Your current password is wrong" });
    return;
  }
  checkPassword(next);
  const { salt, hash } = hashPassword(next);
  await db.query(
    "UPDATE employees SET salt = $2, password_hash = $3 WHERE id = $1",
    [me.id, salt, hash],
  );
  res.sendStatus(204);
});

// Employees only see payslips once the month's payroll is marked paid.
app.get("/payslips/mine", employeeOnly, async (_req, res) => {
  const { rows } = await db.query<PayslipRow>(
    `SELECT p.* FROM payslips p JOIN payroll_runs r ON r.period = p.period
     WHERE p.employee_id = $1 AND p.paid_at IS NOT NULL
     ORDER BY p.period DESC`,
    [sessionOf(res).employeeId],
  );
  res.json(rows.map(toPayslip));
});

// --- Leave -----------------------------------------------------------------

const LEAVE_TYPES: LeaveType[] = [
  "annual",
  "sick",
  "unpaid",
  "maternity",
  "paternity",
  "compassionate",
];

app.get("/leave", adminOnly, async (_req, res) => {
  const { rows } = await db.query<LeaveRow>(
    `${LEAVE_SELECT} ORDER BY l.created_at DESC`,
  );
  res.json(rows.map(toLeave));
});

app.get("/leave/mine", employeeOnly, async (_req, res) => {
  const { rows } = await db.query<LeaveRow>(
    `${LEAVE_SELECT} WHERE l.employee_id = $1 ORDER BY l.start_date DESC`,
    [sessionOf(res).employeeId],
  );
  res.json(rows.map(toLeave));
});

// Employees ask for leave for themselves. The admin can record leave for
// anyone, which is approved straight away.
app.post("/leave", anyone, async (req, res) => {
  const session = sessionOf(res);
  const isAdmin = session.role === "admin";
  const employeeId = isAdmin
    ? String(req.body?.employeeId ?? "")
    : session.employeeId!;
  const type = String(req.body?.type ?? "") as LeaveType;
  const startDate = String(req.body?.startDate ?? "");
  const endDate = String(req.body?.endDate ?? "");
  if (!LEAVE_TYPES.includes(type)) {
    res.status(400).json({ error: "Choose the type of leave" });
    return;
  }
  if (!isDay(startDate) || !isDay(endDate) || endDate < startDate) {
    res.status(400).json({ error: "Choose a first and last day, in that order" });
    return;
  }
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
    res.status(400).json({
      error: "Leave can't run into the next year. Make one request for each year.",
    });
    return;
  }
  const days = weekdaysBetween(startDate, endDate);
  if (days === 0) {
    res.status(400).json({ error: "Those dates don't include a working day" });
    return;
  }

  const row = await transaction(async (client) => {
    // Locking the employee makes two requests at once wait for each other,
    // so neither can slip past the overlap and allowance checks.
    const { rows } = await client.query<EmployeeRow>(
      "SELECT * FROM employees WHERE id = $1 FOR UPDATE",
      [employeeId],
    );
    const employee = rows[0];
    if (!employee) throw new HttpError(400, "Choose an employee");
    if (startDate < employee.start_date)
      throw new HttpError(400, "That is before their start date");
    if (employee.end_date && endDate > employee.end_date)
      throw new HttpError(400, "That is after their leaving date");

    const { rows: overlapping } = await client.query<{ start_date: Day }>(
      `SELECT start_date FROM leave_requests
       WHERE employee_id = $1 AND status IN ('pending', 'approved')
         AND start_date <= $3 AND end_date >= $2 LIMIT 1`,
      [employeeId, startDate, endDate],
    );
    if (overlapping[0])
      throw new HttpError(409, "This overlaps leave that is already booked or waiting");

    if (type === "annual") {
      // Waiting requests count too, so the allowance can't be asked for twice.
      const { rows: used } = await client.query<{ days: number }>(
        `SELECT COALESCE(sum(days), 0)::int AS days FROM leave_requests
         WHERE employee_id = $1 AND type = 'annual'
           AND status IN ('pending', 'approved')
           AND date_part('year', start_date) = $2`,
        [employeeId, Number(startDate.slice(0, 4))],
      );
      const left = employee.annual_leave_days - used[0].days;
      if (days > left)
        throw new HttpError(
          400,
          `That is ${days} working days, but only ${Math.max(0, left)} days of annual leave are left for ${startDate.slice(0, 4)}`,
        );
    }

    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO leave_requests (id, employee_id, type, start_date, end_date,
         days, reason, status, decision_note, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        randomUUID(),
        employeeId,
        type,
        startDate,
        endDate,
        days,
        optionalText(req.body?.reason),
        isAdmin ? "approved" : "pending",
        isAdmin ? "Recorded by the admin" : null,
        isAdmin ? new Date() : null,
      ],
    );
    return (
      await client.query<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = $1`, [
        inserted[0].id,
      ])
    ).rows[0];
  });
  res.status(201).json(toLeave(row));
});

// Approve or reject a request, with an optional note. Approved leave can
// still be rejected later, e.g. if plans change.
app.put("/leave/:id/status", adminOnly, async (req, res) => {
  const status = String(req.body?.status ?? "");
  if (status !== "approved" && status !== "rejected") {
    res.status(400).json({ error: "Status must be approved or rejected" });
    return;
  }
  const { rows } = await db.query<{ id: string }>(
    `UPDATE leave_requests SET status = $2,
       decision_note = COALESCE($3, decision_note), decided_at = now()
     WHERE id = $1 AND status IN ('pending', 'approved') RETURNING id`,
    [req.params.id, status, optionalText(req.body?.note)],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "No open leave request with that id" });
    return;
  }
  const updated = await db.query<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = $1`, [
    rows[0].id,
  ]);
  res.json(toLeave(updated.rows[0]));
});

// Employees can withdraw their own request until it is decided.
app.put("/leave/:id/cancel", anyone, async (req, res) => {
  const session = sessionOf(res);
  const { rows } = await db.query<{ id: string }>(
    `UPDATE leave_requests SET status = 'cancelled', decided_at = now()
     WHERE id = $1 AND (
       ($2::text IS NULL AND status IN ('pending', 'approved'))
       OR (employee_id = $2 AND status = 'pending'))
     RETURNING id`,
    [req.params.id, session.role === "admin" ? null : session.employeeId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "This request can no longer be cancelled" });
    return;
  }
  res.sendStatus(204);
});

// --- Payroll ---------------------------------------------------------------

type Adjustment = { bonus: number; otherDeduction: number; note: string | null };

/**
 * Works out the payslips for a month for everyone employed during it (or just
 * `onlyId`), keeping each person's one-off bonus and deduction.
 */
async function buildPayslips(
  client: PoolClient,
  period: string,
  adjustments: Map<string, Adjustment>,
  onlyId?: string,
) {
  const start = periodStart(period);
  const end = periodEnd(period);
  const { rows: employees } = await client.query<EmployeeRow>(
    `SELECT e.*, d.name AS department_name, 0 AS annual_leave_taken
     FROM employees e LEFT JOIN departments d ON d.id = e.department_id
     WHERE e.start_date <= $2 AND (e.end_date IS NULL OR e.end_date >= $1)
       AND ($3::text IS NULL OR e.id = $3)
     ORDER BY e.name`,
    [start, end, onlyId ?? null],
  );
  const ids = employees.map((e) => e.id);
  const items = await fetchPayItems(client, ids);
  const { rows: unpaid } = await client.query<{
    employee_id: string;
    start_date: Day;
    end_date: Day;
  }>(
    `SELECT employee_id, start_date, end_date FROM leave_requests
     WHERE employee_id = ANY($1) AND type = 'unpaid' AND status = 'approved'
       AND start_date <= $3 AND end_date >= $2`,
    [ids, start, end],
  );
  return employees.map((employee) => {
    const own = items.filter((i) => i.employee_id === employee.id);
    const lines = (kind: PayItemKind) =>
      own.filter((i) => i.kind === kind).map((i) => ({ name: i.name, amount: i.amount }));
    const adjustment = adjustments.get(employee.id);
    return calculatePayslip({
      period,
      employee,
      allowances: lines("allowance"),
      deductions: lines("deduction"),
      unpaidLeave: unpaid
        .filter((l) => l.employee_id === employee.id)
        .map((l) => ({ start: l.start_date, end: l.end_date })),
      bonus: adjustment?.bonus ?? 0,
      otherDeduction: adjustment?.otherDeduction ?? 0,
      note: adjustment?.note ?? null,
    });
  });
}

const savePayslip = (client: PoolClient, p: Payslip) =>
  client.query(
    `INSERT INTO payslips (period, employee_id, employee_no, employee_name,
       job_title, department_name, bank_name, bank_account_number,
       bank_account_name, working_days, days_paid, earnings, deductions, bonus,
       other_deduction, note, gross, total_deductions, net)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19)`,
    [
      p.period,
      p.employeeId,
      p.employeeNo,
      p.employeeName,
      p.jobTitle,
      p.departmentName ?? null,
      p.bankName ?? null,
      p.bankAccountNumber ?? null,
      p.bankAccountName ?? null,
      p.workingDays,
      p.daysPaid,
      JSON.stringify(p.earnings),
      JSON.stringify(p.deductions),
      p.bonus,
      p.otherDeduction,
      p.note ?? null,
      p.gross,
      p.totalDeductions,
      p.net,
    ],
  );

/** Locks a month's payroll for changes, which only a draft allows. */
const lockDraft = async (client: PoolClient, period: string) => {
  const { rows } = await client.query<{ status: PayrollStatus }>(
    "SELECT status FROM payroll_runs WHERE period = $1 FOR UPDATE",
    [period],
  );
  if (!rows[0]) throw new HttpError(404, "No payroll for that month");
  if (rows[0].status !== "draft")
    throw new HttpError(409, "Everyone has been paid for this month, so it is locked");
};

/** Locks the month once nobody is left to pay. */
const closeIfAllPaid = (client: PoolClient, period: string) =>
  client.query(
    `UPDATE payroll_runs SET status = 'paid', paid_at = now()
     WHERE period = $1 AND NOT EXISTS (
       SELECT 1 FROM payslips WHERE period = $1 AND paid_at IS NULL)`,
    [period],
  );

const fetchRun = async (period: string): Promise<PayrollRunDetail | null> => {
  const { rows } = await db.query<PayrollRunRow>(
    `${RUN_SELECT} WHERE r.period = $1 GROUP BY r.period`,
    [period],
  );
  if (!rows[0]) return null;
  const { rows: payslips } = await db.query<PayslipRow>(
    "SELECT * FROM payslips WHERE period = $1 ORDER BY employee_name",
    [period],
  );
  return { ...toPayrollRun(rows[0]), payslips: payslips.map(toPayslip) };
};

app.get("/payroll", adminOnly, async (_req, res) => {
  const { rows } = await db.query<PayrollRunRow>(
    `${RUN_SELECT} GROUP BY r.period ORDER BY r.period DESC`,
  );
  res.json(rows.map(toPayrollRun));
});

app.post("/payroll", adminOnly, async (req, res) => {
  const period = String(req.body?.period ?? "");
  if (!isPeriod(period)) {
    res.status(400).json({ error: "Choose the month to pay" });
    return;
  }
  await transaction(async (client) => {
    const { rowCount } = await client.query(
      "INSERT INTO payroll_runs (period) VALUES ($1) ON CONFLICT DO NOTHING",
      [period],
    );
    if (!rowCount)
      throw new HttpError(409, "There is already a payroll for that month");
    const payslips = await buildPayslips(client, period, new Map());
    if (payslips.length === 0)
      throw new HttpError(400, "Nobody was employed in that month");
    for (const payslip of payslips) await savePayslip(client, payslip);
  });
  res.status(201).json(await fetchRun(period));
});

app.get("/payroll/:period", adminOnly, async (req, res) => {
  const run = await fetchRun(String(req.params.period));
  if (!run) {
    res.status(404).json({ error: "No payroll for that month" });
    return;
  }
  res.json(run);
});

// Brings a draft up to date after salaries, allowances, leave or staff have
// changed, keeping the one-off bonuses and deductions already entered.
app.post("/payroll/:period/recalculate", adminOnly, async (req, res) => {
  const period = String(req.params.period);
  await transaction(async (client) => {
    await lockDraft(client, period);
    const { rows } = await client.query<PayslipRow>(
      "SELECT * FROM payslips WHERE period = $1",
      [period],
    );
    const kept = new Map(
      rows.map((p) => [
        p.employee_id,
        { bonus: p.bonus, otherDeduction: p.other_deduction, note: p.note },
      ]),
    );
    // Anyone already paid keeps the payslip they were paid on.
    const paid = new Set(rows.filter((p) => p.paid_at).map((p) => p.employee_id));
    await client.query(
      "DELETE FROM payslips WHERE period = $1 AND paid_at IS NULL",
      [period],
    );
    for (const payslip of await buildPayslips(client, period, kept))
      if (!paid.has(payslip.employeeId)) await savePayslip(client, payslip);
    await closeIfAllPaid(client, period);
  });
  res.json(await fetchRun(period));
});

// A one-off bonus or deduction for one person this month.
app.put("/payroll/:period/payslips/:employeeId", adminOnly, async (req, res) => {
  const period = String(req.params.period);
  const employeeId = String(req.params.employeeId);
  const adjustment: Adjustment = {
    bonus: optionalAmount(req.body?.bonus, "Bonus"),
    otherDeduction: optionalAmount(req.body?.otherDeduction, "Deduction"),
    note: optionalText(req.body?.note),
  };
  await transaction(async (client) => {
    await lockDraft(client, period);
    const [payslip] = await buildPayslips(
      client,
      period,
      new Map([[employeeId, adjustment]]),
      employeeId,
    );
    if (!payslip) throw new HttpError(404, "They weren't employed in that month");
    const { rowCount: paid } = await client.query(
      "SELECT 1 FROM payslips WHERE period = $1 AND employee_id = $2 AND paid_at IS NOT NULL",
      [period, employeeId],
    );
    if (paid)
      throw new HttpError(409, "They have already been paid, so this payslip can't change");
    await client.query(
      "DELETE FROM payslips WHERE period = $1 AND employee_id = $2",
      [period, employeeId],
    );
    await savePayslip(client, payslip);
  });
  res.json(await fetchRun(period));
});

// HR sends each salary from the bank, then confirms it here. The payslip is
// then final and shows in the employee's portal; the month locks once
// everyone is paid.
app.post("/payroll/:period/payslips/:employeeId/paid", adminOnly, async (req, res) => {
  const period = String(req.params.period);
  const employeeId = String(req.params.employeeId);
  const given = optionalText(req.body?.reference);
  await transaction(async (client) => {
    await lockDraft(client, period);
    const { rows } = await client.query<PayslipRow>(
      "SELECT * FROM payslips WHERE period = $1 AND employee_id = $2 FOR UPDATE",
      [period, employeeId],
    );
    const payslip = rows[0];
    if (!payslip) throw new HttpError(404, "No payslip for them this month");
    if (payslip.paid_at)
      throw new HttpError(409, `${payslip.employee_name} has already been paid`);
    await client.query(
      `UPDATE payslips SET paid_at = now(), payment_reference = $3
       WHERE period = $1 AND employee_id = $2`,
      [period, employeeId, given ?? salaryReference(period, payslip.employee_no)],
    );
    await closeIfAllPaid(client, period);
  });
  res.json(await fetchRun(period));
});

// For a payment confirmed by mistake, while the month is still open.
app.delete("/payroll/:period/payslips/:employeeId/paid", adminOnly, async (req, res) => {
  const period = String(req.params.period);
  await transaction(async (client) => {
    await lockDraft(client, period);
    const { rowCount } = await client.query(
      `UPDATE payslips SET paid_at = NULL, payment_reference = NULL
       WHERE period = $1 AND employee_id = $2 AND paid_at IS NOT NULL`,
      [period, String(req.params.employeeId)],
    );
    if (!rowCount) throw new HttpError(404, "They haven't been marked paid");
  });
  res.json(await fetchRun(period));
});

// Confirms everyone left in one go, e.g. after a bulk upload of the bank file.
app.post("/payroll/:period/paid", adminOnly, async (req, res) => {
  const period = String(req.params.period);
  await transaction(async (client) => {
    await lockDraft(client, period);
    const { rows } = await client.query<PayslipRow>(
      "SELECT * FROM payslips WHERE period = $1 AND paid_at IS NULL",
      [period],
    );
    for (const p of rows)
      await client.query(
        `UPDATE payslips SET paid_at = now(), payment_reference = $3
         WHERE period = $1 AND employee_id = $2`,
        [period, p.employee_id, salaryReference(period, p.employee_no)],
      );
    await closeIfAllPaid(client, period);
  });
  res.json(await fetchRun(period));
});

app.delete("/payroll/:period", adminOnly, async (req, res) => {
  const period = String(req.params.period);
  await transaction(async (client) => {
    await lockDraft(client, period);
    const { rowCount: paid } = await client.query(
      "SELECT 1 FROM payslips WHERE period = $1 AND paid_at IS NOT NULL",
      [period],
    );
    if (paid)
      throw new HttpError(409, "Some people are already paid. Undo those payments first.");
    await client.query("DELETE FROM payroll_runs WHERE period = $1", [period]);
  });
  res.sendStatus(204);
});

// The month's bank transfers as a spreadsheet, for the bank's bulk payment upload.
app.get("/payroll/:period/bank.csv", adminOnly, async (req, res) => {
  const run = await fetchRun(String(req.params.period));
  if (!run) {
    res.status(404).json({ error: "No payroll for that month" });
    return;
  }
  const cell = (value: string | number | undefined) => {
    const text = String(value ?? "");
    // Quote text with commas or quotes, and stop spreadsheet formulas.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [
    ["Staff number", "Name", "Bank", "Account number", "Account name", "Amount", "Reference"],
    // Only people still to pay, so uploading it again can't pay anyone twice.
    ...run.payslips.filter((p) => !p.paidAt).map((p) => [
      p.employeeNo,
      p.employeeName,
      p.bankName,
      p.bankAccountNumber,
      p.bankAccountName,
      p.net.toFixed(2),
      salaryReference(p.period, p.employeeNo),
    ]),
  ];
  res
    .type("text/csv")
    .attachment(`payroll-${run.period}.csv`)
    .send(lines.map((line) => line.map(cell).join(",")).join("\n"));
});

// --- Guarantors ----------------------------------------------------------

type GuarantorRow = {
  id: string;
  employee_id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string | null;
  address: string;
  occupation: string | null;
  workplace: string | null;
  added_by: "admin" | "employee";
  verified_at: Date | null;
  updated_at: Date;
};

const toGuarantor = (row: GuarantorRow): Guarantor => ({
  id: row.id,
  employeeId: row.employee_id,
  name: row.name,
  relationship: row.relationship,
  phone: row.phone,
  ...(row.email !== null ? { email: row.email } : {}),
  address: row.address,
  ...(row.occupation !== null ? { occupation: row.occupation } : {}),
  ...(row.workplace !== null ? { workplace: row.workplace } : {}),
  addedBy: row.added_by,
  ...(row.verified_at !== null ? { verifiedAt: row.verified_at.toISOString() } : {}),
  updatedAt: row.updated_at.toISOString(),
});

const MAX_GUARANTORS = 3;

/** The guarantor fields from a request body, checked. */
const readGuarantorForm = (body: Record<string, unknown> | undefined) => {
  const name = String(body?.name ?? "").trim();
  const relationship = String(body?.relationship ?? "").trim();
  const phone = String(body?.phone ?? "").trim();
  const address = String(body?.address ?? "").trim();
  const email = optionalText(body?.email)?.toLowerCase() ?? null;
  if (!name || !relationship || !phone || !address)
    throw new HttpError(400, "Name, relationship, phone and address are required");
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Enter a valid email address, or leave it empty");
  return [
    name,
    relationship,
    phone,
    email,
    address,
    optionalText(body?.occupation),
    optionalText(body?.workplace),
  ];
};

const fetchGuarantors = async (employeeId: string) =>
  (
    await db.query<GuarantorRow>(
      "SELECT * FROM guarantors WHERE employee_id = $1 ORDER BY created_at",
      [employeeId],
    )
  ).rows.map(toGuarantor);

const addGuarantor = (
  employeeId: string,
  addedBy: "admin" | "employee",
  body: Record<string, unknown> | undefined,
) => {
  const values = readGuarantorForm(body);
  return transaction(async (client) => {
    // Locking the employee keeps two quick adds from passing the limit.
    const found = await client.query(
      "SELECT 1 FROM employees WHERE id = $1 FOR UPDATE",
      [employeeId],
    );
    if (!found.rowCount) throw new HttpError(404, "Employee not found");
    const { rows } = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM guarantors WHERE employee_id = $1",
      [employeeId],
    );
    if (rows[0].count >= MAX_GUARANTORS)
      throw new HttpError(409, `Up to ${MAX_GUARANTORS} guarantors can be on file`);
    const { rows: inserted } = await client.query<GuarantorRow>(
      `INSERT INTO guarantors (name, relationship, phone, email, address,
         occupation, workplace, id, employee_id, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [...values, randomUUID(), employeeId, addedBy],
    );
    return toGuarantor(inserted[0]);
  });
};

app.get("/employees/:id/guarantors", adminOnly, async (req, res) => {
  res.json(await fetchGuarantors(String(req.params.id)));
});

app.post("/employees/:id/guarantors", adminOnly, async (req, res) => {
  res.status(201).json(await addGuarantor(String(req.params.id), "admin", req.body));
});

app.get("/me/guarantors", employeeOnly, async (_req, res) => {
  res.json(await fetchGuarantors(sessionOf(res).employeeId!));
});

app.post("/me/guarantors", employeeOnly, async (req, res) => {
  res.status(201).json(await addGuarantor(sessionOf(res).employeeId!, "employee", req.body));
});

// HR can change any guarantor and keeps their verified mark; an employee can
// change only their own, which then needs checking again.
app.put("/guarantors/:id", anyone, async (req, res) => {
  const session = sessionOf(res);
  const values = readGuarantorForm(req.body);
  const { rows } = await db.query<GuarantorRow>(
    `UPDATE guarantors SET name = $1, relationship = $2, phone = $3, email = $4,
       address = $5, occupation = $6, workplace = $7, updated_at = now(),
       verified_at = CASE WHEN $9::text IS NULL THEN verified_at END
     WHERE id = $8 AND ($9::text IS NULL OR employee_id = $9)
     RETURNING *`,
    [...values, req.params.id, session.role === "admin" ? null : session.employeeId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "Guarantor not found" });
    return;
  }
  res.json(toGuarantor(rows[0]));
});

app.delete("/guarantors/:id", anyone, async (req, res) => {
  const session = sessionOf(res);
  const { rowCount } = await db.query(
    "DELETE FROM guarantors WHERE id = $1 AND ($2::text IS NULL OR employee_id = $2)",
    [req.params.id, session.role === "admin" ? null : session.employeeId],
  );
  if (!rowCount) {
    res.status(404).json({ error: "Guarantor not found" });
    return;
  }
  res.sendStatus(204);
});

app.put("/guarantors/:id/verified", adminOnly, async (req, res) => {
  const { rows } = await db.query<GuarantorRow>(
    `UPDATE guarantors SET verified_at = CASE WHEN $2 THEN now() END
     WHERE id = $1 RETURNING *`,
    [req.params.id, req.body?.verified === true],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "Guarantor not found" });
    return;
  }
  res.json(toGuarantor(rows[0]));
});

// --- Errors ----------------------------------------------------------------

// Which unique column clashed, in words.
const UNIQUE_MESSAGES: Record<string, string> = {
  employees_email_key: "Another employee already uses that email",
  employees_employee_no_key: "Another employee already has that staff number",
  departments_name_key: "There is already a department with that name",
};

const errorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else if (err?.code === "23505") {
    res
      .status(409)
      .json({ error: UNIQUE_MESSAGES[err.constraint] ?? "That is already in use" });
  } else if (err?.code === "23503") {
    // A department or employee chosen in a form was deleted meanwhile.
    res.status(400).json({ error: "Something you chose no longer exists" });
  } else if (typeof err?.status === "number" && err.status < 500) {
    // Bad request bodies, such as invalid JSON.
    res.status(err.status).json({ error: err.message });
  } else {
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server" });
  }
};
app.use(errorHandler);

app.listen(port, () => {
  console.log(`HR API listening on http://localhost:${port}`);
});

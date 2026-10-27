import { db, transaction } from "./db";
import {
  actorOf,
  adminOnly,
  anyone,
  clearFailedLogins,
  createToken,
  employeeOnly,
  employeeOnTemporaryPassword,
  hashPassword,
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
import { COMPANY_EMAIL_DOMAIN, isCompanyEmail, salaryReference } from "@hr/types";
import { payslipPdf } from "./payslip-pdf";
import { contractPdf } from "./contract-pdf";
import { sendEmail } from "./mailer";
import express from "express";
import type { PoolClient } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  Contract,
  ContractStatus,
  ContractTemplate,
  OutboxEmail,
  PublicContract,
  Activity,
  Admin,
  Announcement,
  AnnouncementCategory,
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
  PublicHoliday,
  StaffRequest,
  StaffRequestStatus,
  StaffRequestType,
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

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
const money = (amount: number) => naira.format(amount);
/** "October 2026", for a period. */
const monthName = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
/** "2 Nov 2026", for a day. */
const dayName = (day: Day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Records a change in the activity log as the logged-in user. Inside a
 * transaction, pass its client, so the entry is kept only if the change is.
 */
const logActivity = (
  client: PoolClient | typeof db,
  res: express.Response,
  summary: string,
) =>
  client.query("INSERT INTO activity_log (actor, summary) VALUES ($1, $2)", [
    actorOf(sessionOf(res)),
    summary,
  ]);

/** Lines as a CSV file, with text quoted and spreadsheet formulas stopped. */
const toCsv = (lines: (string | number | undefined | null)[][]) => {
  const cell = (value: string | number | undefined | null) => {
    const text = String(value ?? "");
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return lines.map((line) => line.map(cell).join(",")).join("\n");
};

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
  employer_pension_percent: number;
  nhf: boolean;
  tax_id: string | null;
  pension_provider: string | null;
  pension_pin: string | null;
  date_of_birth: Day | null;
  home_address: string | null;
  emergency_name: string | null;
  emergency_relationship: string | null;
  emergency_phone: string | null;
  personal_email: string | null;
  setup_token_hash: string | null;
  setup_token_expires_at: Date | null;
  contract_status?: ContractStatus | null;
  photo_updated_at?: Date | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  annual_leave_days: number;
  salt: string | null;
  password_hash: string | null;
  sessions_valid_after: Date;
  must_change_password: boolean;
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
  employerPensionPercent: row.employer_pension_percent,
  nhf: row.nhf,
  ...(row.tax_id !== null ? { taxId: row.tax_id } : {}),
  ...(row.pension_provider !== null ? { pensionProvider: row.pension_provider } : {}),
  ...(row.pension_pin !== null ? { pensionPin: row.pension_pin } : {}),
  ...(row.photo_updated_at ? { photoVersion: row.photo_updated_at.toISOString() } : {}),
  ...(row.date_of_birth !== null ? { dateOfBirth: row.date_of_birth } : {}),
  ...(row.home_address !== null ? { homeAddress: row.home_address } : {}),
  ...(row.emergency_name !== null ? { emergencyName: row.emergency_name } : {}),
  ...(row.emergency_relationship !== null
    ? { emergencyRelationship: row.emergency_relationship }
    : {}),
  ...(row.emergency_phone !== null ? { emergencyPhone: row.emergency_phone } : {}),
  ...(row.personal_email !== null ? { personalEmail: row.personal_email } : {}),
  ...(row.contract_status ? { contractStatus: row.contract_status } : {}),
  setupPending:
    row.setup_token_hash !== null &&
    row.setup_token_expires_at !== null &&
    row.setup_token_expires_at > new Date(),
  annualLeaveDays: row.annual_leave_days,
  annualLeaveTaken: row.annual_leave_taken,
  canLogIn: row.password_hash !== null,
  mustChangePassword: row.must_change_password,
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
    (SELECT p.updated_at FROM employee_photos p WHERE p.employee_id = e.id)
      AS photo_updated_at,
    (SELECT c.status FROM contracts c
     WHERE c.employee_id = e.id AND c.status <> 'withdrawn'
     ORDER BY c.sent_at DESC LIMIT 1) AS contract_status,
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
  employer_pension: number;
  tax_id: string | null;
  pension_provider: string | null;
  pension_pin: string | null;
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
  employerPension: row.employer_pension,
  ...(row.tax_id !== null ? { taxId: row.tax_id } : {}),
  ...(row.pension_provider !== null ? { pensionProvider: row.pension_provider } : {}),
  ...(row.pension_pin !== null ? { pensionPin: row.pension_pin } : {}),
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

// Room for a profile photo (the site shrinks them to well under this).
app.use(express.json({ limit: "1mb" }));

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
  let session: Omit<Session, "iat" | "exp"> | null = null;
  let mustChangePassword = false;
  if (email && password && req.body?.role === "admin") {
    const { rows } = await db.query<AdminRow>(
      "SELECT * FROM admins WHERE email = $1 AND deactivated_at IS NULL",
      [email],
    );
    const admin = rows[0];
    if (admin && passwordMatchesHash(password, admin.salt, admin.password_hash))
      session = { role: "admin", name: admin.name, adminId: admin.id };
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
    ) {
      session = { role: "employee", name: member.name, employeeId: member.id };
      mustChangePassword = member.must_change_password;
    }
  }

  if (!session) {
    recordFailedLogin(key);
    res.status(401).json({ error: "Wrong email or password" });
    return;
  }
  clearFailedLogins(key);
  res.json({
    token: createToken(session),
    role: session.role,
    name: session.name,
    mustChangePassword,
  });
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
  await transaction(async (client) => {
    await client.query("INSERT INTO departments (id, name) VALUES ($1, $2)", [id, name]);
    await logActivity(client, res, `Added the ${name} department`);
  });
  const department: Department = { id, name, headcount: 0 };
  res.status(201).json(department);
});

app.put("/departments/:id", adminOnly, async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "Enter the department's name" });
    return;
  }
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM departments WHERE id = $1 FOR UPDATE",
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, "Department not found");
    await client.query("UPDATE departments SET name = $2 WHERE id = $1", [
      req.params.id,
      name,
    ]);
    if (rows[0].name !== name)
      await logActivity(client, res, `Renamed the ${rows[0].name} department to ${name}`);
  });
  res.json({ id: req.params.id, name });
});

// Its employees stay, without a department.
app.delete("/departments/:id", adminOnly, async (req, res) => {
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      "DELETE FROM departments WHERE id = $1 RETURNING name",
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, "Department not found");
    await logActivity(client, res, `Deleted the ${rows[0].name} department`);
  });
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
  if (!isCompanyEmail(email))
    throw new HttpError(400, `Use their @${COMPANY_EMAIL_DOMAIN} work email`);
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
  const employerPensionPercent = Number(body?.employerPensionPercent ?? 0);
  if (!(employerPensionPercent >= 0 && employerPensionPercent <= 100))
    throw new HttpError(400, "Employer pension must be a % from 0 to 100");
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
    optionalText(body?.taxId),
    optionalText(body?.pensionProvider),
    optionalText(body?.pensionPin),
    round2(employerPensionPercent),
    body?.nhf === true,
    ...readPersonalDetails(body).slice(1),
  ];
};

/**
 * The details an employee can change themselves, checked: phone, date of
 * birth, home address and emergency contact.
 */
const readPersonalDetails = (body: Record<string, unknown> | undefined) => {
  const dateOfBirth = optionalText(body?.dateOfBirth);
  if (dateOfBirth !== null && (!isDay(dateOfBirth) || dateOfBirth >= today()))
    throw new HttpError(400, "Enter a real date of birth");
  const personalEmail = optionalText(body?.personalEmail)?.toLowerCase() ?? null;
  if (personalEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail))
    throw new HttpError(400, "Enter a valid personal email, or leave it empty");
  return [
    optionalText(body?.phone),
    dateOfBirth,
    optionalText(body?.homeAddress),
    optionalText(body?.emergencyName),
    optionalText(body?.emergencyRelationship),
    optionalText(body?.emergencyPhone),
    personalEmail,
  ];
};
const PERSONAL_COLUMNS = [
  "phone",
  "date_of_birth",
  "home_address",
  "emergency_name",
  "emergency_relationship",
  "emergency_phone",
  "personal_email",
] as const;

// The columns readEmployeeForm's values go into, in order, and how a change
// to each reads in the activity log.
const EMPLOYEE_FIELDS: [column: keyof EmployeeRow, label: string, show?: (v: never) => string][] = [
  ["employee_no", "staff number"],
  ["name", "name"],
  ["email", "email"],
  ["phone", "phone"],
  ["job_title", "job title"],
  ["department_id", "department", () => "changed"],
  ["employment_type", "employment type"],
  ["start_date", "start date"],
  ["end_date", "leaving date"],
  ["base_salary", "basic salary", money],
  ["bank_name", "bank"],
  ["bank_account_number", "account number"],
  ["bank_account_name", "account name"],
  ["annual_leave_days", "annual leave days"],
  ["pension_percent", "pension %"],
  ["paye", "PAYE"],
  ["paye_amount", "fixed PAYE", money],
  ["tax_id", "tax ID"],
  ["pension_provider", "pension provider"],
  ["pension_pin", "RSA PIN"],
  ["employer_pension_percent", "employer pension %"],
  ["nhf", "NHF", (on: boolean) => (on ? "on" : "off")],
  ["date_of_birth", "date of birth"],
  ["home_address", "home address"],
  ["emergency_name", "emergency contact"],
  ["emergency_relationship", "emergency contact's relationship"],
  ["emergency_phone", "emergency contact's phone"],
  ["personal_email", "personal email"],
];
const EMPLOYEE_COLUMNS = EMPLOYEE_FIELDS.map(([column]) => column);

/** What an edit changed, e.g. "basic salary ₦150,000.00 → ₦180,000.00". */
const describeChanges = (before: EmployeeRow, values: unknown[]) =>
  EMPLOYEE_FIELDS.flatMap(([column, label, show], i) => {
    const was = before[column] ?? null;
    const now = values[i] ?? null;
    if (String(was) === String(now)) return [];
    const text = (v: unknown) =>
      v === null ? "none" : show ? show(v as never) : String(v);
    return show && column === "department_id"
      ? [`${label} changed`]
      : [`${label} ${text(was)} → ${text(now)}`];
  });

/** "Transport ₦20,000.00, Staff loan ₦5,000.00 (deduction)", for the log. */
const describeItems = (items: { kind: string; name: string; amount: number }[]) =>
  items.length === 0
    ? "none"
    : items
        .map((i) => `${i.name} ${money(i.amount)}${i.kind === "deduction" ? " (deduction)" : ""}`)
        .join(", ");

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
  // Optionally, a contract template to email them straight away.
  const contractTemplateId = optionalText(req.body?.contractTemplateId);
  if (contractTemplateId && !values[EMPLOYEE_COLUMNS.indexOf("personal_email")])
    throw new HttpError(400, "Add their personal email, so their contract can be sent there");
  if (
    contractTemplateId &&
    !(await db.query("SELECT 1 FROM contract_templates WHERE id = $1", [contractTemplateId])).rowCount
  )
    throw new HttpError(400, "That contract template no longer exists");
  const id = randomUUID();
  await transaction(async (client) => {
    // A password HR gives is temporary: they choose their own when they log in.
    const columns = [...EMPLOYEE_COLUMNS, "id", "salt", "password_hash", "must_change_password"];
    await client.query(
      `INSERT INTO employees (${columns.join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      [...values, id, login?.salt ?? null, login?.hash ?? null, login !== null],
    );
    await savePayItems(client, id, items);
    await logActivity(
      client,
      res,
      `Added employee ${values[1]} (${values[0]}), basic salary ${money(values[9] as number)}` +
        (items.length ? `, with ${describeItems(items)}` : ""),
    );
  });
  if (contractTemplateId) await sendContract(res, id, contractTemplateId);
  res.status(201).json(toEmployee(await fetchEmployee(id)));
});

app.put("/employees/:id", adminOnly, async (req, res) => {
  const values = readEmployeeForm(req.body);
  // Without `items`, the allowances and deductions stay as they are.
  const items = Array.isArray(req.body?.items) ? readPayItems(req.body.items) : null;
  const id = String(req.params.id);
  await transaction(async (client) => {
    const { rows } = await client.query<EmployeeRow>(
      "SELECT * FROM employees WHERE id = $1 FOR UPDATE",
      [id],
    );
    const before = rows[0];
    if (!before) throw new HttpError(404, "Employee not found");
    const changes = describeChanges(before, values);
    await client.query(
      `UPDATE employees SET
         ${EMPLOYEE_COLUMNS.map((column, i) => `${column} = $${i + 1}`).join(", ")}
       WHERE id = $${EMPLOYEE_COLUMNS.length + 1}`,
      [...values, id],
    );
    if (items) {
      const old = (await fetchPayItems(client, [id])).map(toPayItem);
      if (describeItems(old) !== describeItems(items))
        changes.push(`pay lines ${describeItems(old)} → ${describeItems(items)}`);
      await savePayItems(client, id, items);
    }
    if (changes.length)
      await logActivity(client, res, `Updated ${values[1]}: ${changes.join("; ")}`);
  });
  res.json(toEmployee(await fetchEmployee(String(req.params.id))));
});

/**
 * Gives an employee a temporary password: any login they had ends, and they
 * choose their own password the next time they log in.
 */
async function setTemporaryPassword(
  client: PoolClient,
  res: express.Response,
  employeeId: string,
  password: string,
) {
  checkPassword(password);
  const { salt, hash } = hashPassword(password);
  const { rows } = await client.query<{ name: string }>(
    `UPDATE employees SET salt = $2, password_hash = $3, sessions_valid_after = $4,
       must_change_password = true
     WHERE id = $1 RETURNING name`,
    [employeeId, salt, hash, new Date()],
  );
  if (!rows[0]) throw new HttpError(404, "Employee not found");
  await logActivity(client, res, `Gave ${rows[0].name} a temporary staff portal password`);
  return rows[0].name;
}

app.put("/employees/:id/password", adminOnly, async (req, res) => {
  await transaction((client) =>
    setTemporaryPassword(client, res, String(req.params.id), String(req.body?.password ?? "")),
  );
  res.sendStatus(204);
});

// Stop an employee using the staff portal; they are logged out straight away.
app.delete("/employees/:id/password", adminOnly, async (req, res) => {
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      "UPDATE employees SET salt = NULL, password_hash = NULL WHERE id = $1 RETURNING name",
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, "Employee not found");
    await logActivity(client, res, `Removed staff portal access for ${rows[0].name}`);
  });
  res.sendStatus(204);
});

// Shuts an employee out of the staff portal straight away, or lets them back in.
app.put("/employees/:id/active", adminOnly, async (req, res) => {
  const active = req.body?.active === true;
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string; was_active: boolean }>(
      `UPDATE employees e SET deactivated_at = CASE WHEN $2 THEN NULL
         ELSE COALESCE(e.deactivated_at, now()) END
       FROM employees old WHERE e.id = $1 AND old.id = e.id
       RETURNING e.name, old.deactivated_at IS NULL AS was_active`,
      [req.params.id, active],
    );
    if (!rows[0]) throw new HttpError(404, "Employee not found");
    if (rows[0].was_active !== active)
      await logActivity(
        client,
        res,
        active
          ? `Reactivated ${rows[0].name}`
          : `Deactivated ${rows[0].name}, shutting them out of the staff portal`,
      );
  });
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
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string; employee_no: string }>(
      "DELETE FROM employees WHERE id = $1 RETURNING name, employee_no",
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, "Employee not found");
    await logActivity(
      client,
      res,
      `Deleted employee ${rows[0].name} (${rows[0].employee_no}) and their leave records`,
    );
  });
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
    const old = (await fetchPayItems(client, [String(req.params.id)])).map(toPayItem);
    const saved = await savePayItems(client, String(req.params.id), items);
    if (describeItems(old) !== describeItems(items)) {
      const name = (await fetchEmployee(String(req.params.id))).name;
      await logActivity(
        client,
        res,
        `Updated ${name}: pay lines ${describeItems(old)} → ${describeItems(items)}`,
      );
    }
    return saved;
  });
  res.json(saved.map(toPayItem));
});

// --- Staff portal ----------------------------------------------------------

// Works on a temporary password too, so the portal can ask for a new one.
app.get("/me", employeeOnTemporaryPassword, async (_req, res) => {
  const row = await fetchEmployee(sessionOf(res).employeeId!);
  const employee = toEmployee(row);
  const profile: MyProfile = {
    ...employee,
    annualLeaveLeft: employee.annualLeaveDays - employee.annualLeaveTaken,
  };
  res.json(profile);
});

// Staff choose their own password only to replace a temporary one from HR.
// Otherwise passwords change through HR (a password request), so a lost
// or shared login can always be taken back by HR.
app.put("/me/password", employeeOnTemporaryPassword, async (req, res) => {
  const current = String(req.body?.currentPassword ?? "");
  const next = String(req.body?.newPassword ?? "");
  const id = sessionOf(res).employeeId!;
  const { rows } = await db.query<EmployeeRow>("SELECT * FROM employees WHERE id = $1", [id]);
  const me = rows[0];
  if (!me.must_change_password)
    throw new HttpError(403, "To change your password, send HR a password request");
  if (!passwordMatchesHash(current, me.salt!, me.password_hash!))
    throw new HttpError(400, "The temporary password is wrong");
  checkPassword(next);
  if (next === current)
    throw new HttpError(400, "Choose a new password, not the one HR gave you");
  const { salt, hash } = hashPassword(next);
  await transaction(async (client) => {
    // Other logins on the temporary password end; this one carries on.
    await client.query(
      `UPDATE employees SET salt = $2, password_hash = $3, sessions_valid_after = $4,
         must_change_password = false
       WHERE id = $1`,
      [id, salt, hash, new Date()],
    );
    await logActivity(client, res, "Chose their own staff portal password");
  });
  res.json({
    token: createToken({ role: "employee", name: me.name, employeeId: id }),
    role: "employee",
    name: me.name,
    mustChangePassword: false,
  });
});

// Employees keep their own phone, address and emergency contact up to date.
// Bank details stay with HR, so nobody can redirect a salary from the portal.
app.put("/me/details", employeeOnly, async (req, res) => {
  const values = readPersonalDetails(req.body);
  const id = sessionOf(res).employeeId!;
  await transaction(async (client) => {
    const { rows } = await client.query<EmployeeRow>(
      "SELECT * FROM employees WHERE id = $1 FOR UPDATE",
      [id],
    );
    const changed = PERSONAL_COLUMNS.filter(
      (column, i) => String(rows[0][column] ?? null) !== String(values[i] ?? null),
    );
    await client.query(
      `UPDATE employees SET
         ${PERSONAL_COLUMNS.map((column, i) => `${column} = $${i + 2}`).join(", ")}
       WHERE id = $1`,
      [id, ...values],
    );
    if (changed.length)
      await logActivity(
        client,
        res,
        `Updated their ${changed.map((c) => c.replace(/_/g, " ")).join(", ")}`,
      );
  });
  const row = await fetchEmployee(id);
  res.json({ ...toEmployee(row), annualLeaveLeft: row.annual_leave_days - row.annual_leave_taken });
});

const PHOTO_MAX_BYTES = 512 * 1024;
// The first bytes of each image type, so only real images are kept.
const PHOTO_SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  "image/webp": (b) =>
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP",
};

/** A photo sent as a data: URL, checked. */
const readPhoto = (value: unknown) => {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
    String(value ?? ""),
  );
  if (!match) throw new HttpError(400, "Choose a JPEG, PNG or WebP photo");
  const image = Buffer.from(match[2], "base64");
  if (image.length > PHOTO_MAX_BYTES) throw new HttpError(400, "That photo is too large");
  if (!PHOTO_SIGNATURES[match[1]](image))
    throw new HttpError(400, "That file isn't a JPEG, PNG or WebP photo");
  return { contentType: match[1], image };
};

/** Sets (or, with no photo, removes) an employee's photo, and logs it. */
async function savePhoto(
  res: express.Response,
  employeeId: string,
  photo: ReturnType<typeof readPhoto> | null,
) {
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM employees WHERE id = $1",
      [employeeId],
    );
    if (!rows[0]) throw new HttpError(404, "Employee not found");
    const own = sessionOf(res).role === "employee";
    if (photo) {
      await client.query(
        `INSERT INTO employee_photos (employee_id, content_type, image)
         VALUES ($1, $2, $3)
         ON CONFLICT (employee_id) DO UPDATE SET content_type = $2, image = $3,
           updated_at = clock_timestamp()`,
        [employeeId, photo.contentType, photo.image],
      );
      await logActivity(client, res, own ? "Changed their photo" : `Changed ${rows[0].name}'s photo`);
    } else {
      const { rowCount } = await client.query(
        "DELETE FROM employee_photos WHERE employee_id = $1",
        [employeeId],
      );
      if (rowCount)
        await logActivity(client, res, own ? "Removed their photo" : `Removed ${rows[0].name}'s photo`);
    }
  });
  res.json(toEmployee(await fetchEmployee(employeeId)));
}

app.put("/me/photo", employeeOnly, async (req, res) => {
  await savePhoto(res, sessionOf(res).employeeId!, readPhoto(req.body?.photo));
});
app.delete("/me/photo", employeeOnly, async (_req, res) => {
  await savePhoto(res, sessionOf(res).employeeId!, null);
});
app.put("/employees/:id/photo", adminOnly, async (req, res) => {
  await savePhoto(res, String(req.params.id), readPhoto(req.body?.photo));
});
app.delete("/employees/:id/photo", adminOnly, async (req, res) => {
  await savePhoto(res, String(req.params.id), null);
});

// Admins see everyone's photo; an employee sees their own.
app.get("/employees/:id/photo", anyone, async (req, res) => {
  const session = sessionOf(res);
  if (session.role === "employee" && session.employeeId !== req.params.id) {
    res.status(403).json({ error: "You can only see your own photo" });
    return;
  }
  const { rows } = await db.query<{ content_type: string; image: Buffer }>(
    "SELECT content_type, image FROM employee_photos WHERE employee_id = $1",
    [req.params.id],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "No photo" });
    return;
  }
  res
    .set("Cache-Control", "private, max-age=86400")
    .set("X-Content-Type-Options", "nosniff")
    .type(rows[0].content_type)
    .send(rows[0].image);
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

const COMPANY_NAME = process.env.COMPANY_NAME ?? "Beauty Bay Africa";

/** Sends a payslip as a PDF download, named after the person and month. */
const sendPayslipPdf = async (res: express.Response, row: PayslipRow) => {
  const payslip = toPayslip(row);
  res
    .type("application/pdf")
    .attachment(`Payslip ${payslip.period} ${payslip.employeeName}.pdf`)
    .send(await payslipPdf(payslip, COMPANY_NAME));
};

// An employee's own payslip as a PDF, once it is paid.
app.get("/payslips/mine/:period/pdf", employeeOnly, async (req, res) => {
  const { rows } = await db.query<PayslipRow>(
    `SELECT * FROM payslips
     WHERE period = $1 AND employee_id = $2 AND paid_at IS NOT NULL`,
    [req.params.period, sessionOf(res).employeeId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "No paid payslip for that month" });
    return;
  }
  await sendPayslipPdf(res, rows[0]);
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

/** "Amaka Obi's annual leave, 2 Nov 2026 – 6 Nov 2026 (5 days)", for the log. */
const describeLeave = (l: LeaveRow) =>
  `${l.employee_name}'s ${l.type} leave, ${dayName(l.start_date)} – ${dayName(l.end_date)} ` +
  `(${l.days} day${l.days === 1 ? "" : "s"})`;

/** The public holidays from `start` to `end`. */
const holidaysBetween = async (
  start: Day,
  end: Day,
  client: PoolClient | typeof db = db,
) =>
  new Set(
    (
      await client.query<{ day: Day }>(
        "SELECT day FROM public_holidays WHERE day BETWEEN $1 AND $2",
        [start, end],
      )
    ).rows.map((h) => h.day),
  );

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
  const days = weekdaysBetween(startDate, endDate, await holidaysBetween(startDate, endDate));
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
    const leave = (
      await client.query<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = $1`, [
        inserted[0].id,
      ])
    ).rows[0];
    await logActivity(
      client,
      res,
      isAdmin
        ? `Recorded ${describeLeave(leave)} (approved)`
        : `Asked for ${describeLeave(leave)}`,
    );
    return leave;
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
  const note = optionalText(req.body?.note);
  const updated = await transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE leave_requests SET status = $2,
         decision_note = COALESCE($3, decision_note), decided_at = now()
       WHERE id = $1 AND status IN ('pending', 'approved') RETURNING id`,
      [req.params.id, status, note],
    );
    if (!rows[0]) throw new HttpError(404, "No open leave request with that id");
    const leave = (
      await client.query<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = $1`, [rows[0].id])
    ).rows[0];
    await logActivity(
      client,
      res,
      `${status === "approved" ? "Approved" : "Rejected"} ${describeLeave(leave)}` +
        (note ? `: ${note}` : ""),
    );
    return leave;
  });
  res.json(toLeave(updated));
});

// Employees can withdraw their own request until it is decided.
app.put("/leave/:id/cancel", anyone, async (req, res) => {
  const session = sessionOf(res);
  await transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE leave_requests SET status = 'cancelled', decided_at = now()
       WHERE id = $1 AND (
         ($2::text IS NULL AND status IN ('pending', 'approved'))
         OR (employee_id = $2 AND status = 'pending'))
       RETURNING id`,
      [req.params.id, session.role === "admin" ? null : session.employeeId],
    );
    if (!rows[0]) throw new HttpError(404, "This request can no longer be cancelled");
    const leave = (
      await client.query<LeaveRow>(`${LEAVE_SELECT} WHERE l.id = $1`, [rows[0].id])
    ).rows[0];
    await logActivity(client, res, `Cancelled ${describeLeave(leave)}`);
  });
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
  const holidays = await holidaysBetween(start, end, client);
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
      holidays,
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
       other_deduction, note, gross, total_deductions, net, employer_pension,
       tax_id, pension_provider, pension_pin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20, $21, $22, $23)`,
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
      p.employerPension,
      p.taxId ?? null,
      p.pensionProvider ?? null,
      p.pensionPin ?? null,
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
    const net = round2(payslips.reduce((sum, p) => sum + p.net, 0));
    await logActivity(
      client,
      res,
      `Ran payroll for ${monthName(period)}: ${payslips.length} people, ${money(net)} net`,
    );
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
    await logActivity(client, res, `Recalculated payroll for ${monthName(period)}`);
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
    await logActivity(
      client,
      res,
      `Set ${payslip.employeeName}'s ${monthName(period)} one-offs: bonus ${money(adjustment.bonus)}, ` +
        `deduction ${money(adjustment.otherDeduction)}` +
        (adjustment.note ? ` (${adjustment.note})` : ""),
    );
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
    const reference = given ?? salaryReference(period, payslip.employee_no);
    await client.query(
      `UPDATE payslips SET paid_at = now(), payment_reference = $3
       WHERE period = $1 AND employee_id = $2`,
      [period, employeeId, reference],
    );
    await closeIfAllPaid(client, period);
    await logActivity(
      client,
      res,
      `Marked ${payslip.employee_name} paid for ${monthName(period)}: ${money(payslip.net)} (ref ${reference})`,
    );
  });
  res.json(await fetchRun(period));
});

// For a payment confirmed by mistake, while the month is still open.
app.delete("/payroll/:period/payslips/:employeeId/paid", adminOnly, async (req, res) => {
  const period = String(req.params.period);
  await transaction(async (client) => {
    await lockDraft(client, period);
    const { rows } = await client.query<{ employee_name: string; net: number }>(
      `UPDATE payslips SET paid_at = NULL, payment_reference = NULL
       WHERE period = $1 AND employee_id = $2 AND paid_at IS NOT NULL
       RETURNING employee_name, net`,
      [period, String(req.params.employeeId)],
    );
    if (!rows[0]) throw new HttpError(404, "They haven't been marked paid");
    await logActivity(
      client,
      res,
      `Undid ${rows[0].employee_name}'s ${monthName(period)} payment of ${money(rows[0].net)}`,
    );
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
    if (rows.length)
      await logActivity(
        client,
        res,
        `Marked everyone left paid for ${monthName(period)}: ${rows.length} people, ` +
          money(round2(rows.reduce((sum, p) => sum + p.net, 0))),
      );
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
    await logActivity(client, res, `Deleted the draft payroll for ${monthName(period)}`);
  });
  res.sendStatus(204);
});

// Opens a locked month again to correct a mistake, with the reason on record.
// Everyone stays paid; undo the payments that need changing, fix them, and pay
// again. The month locks once everyone is paid again.
app.post("/payroll/:period/reopen", adminOnly, async (req, res) => {
  const period = String(req.params.period);
  const reason = optionalText(req.body?.reason);
  if (!reason) {
    res.status(400).json({ error: "Say why this month is being reopened" });
    return;
  }
  await transaction(async (client) => {
    const { rows } = await client.query<{ status: PayrollStatus }>(
      "SELECT status FROM payroll_runs WHERE period = $1 FOR UPDATE",
      [period],
    );
    if (!rows[0]) throw new HttpError(404, "No payroll for that month");
    if (rows[0].status !== "paid") throw new HttpError(409, "This month is already open");
    await client.query(
      "UPDATE payroll_runs SET status = 'draft', paid_at = NULL WHERE period = $1",
      [period],
    );
    await logActivity(client, res, `Reopened ${monthName(period)} to correct it: ${reason}`);
  });
  res.json(await fetchRun(period));
});

/** The amount of the deduction whose name starts with `prefix`, or 0. */
const deductionOf = (p: Payslip, prefix: string) =>
  p.deductions.find((d) => d.name.startsWith(prefix))?.amount ?? 0;

const sendCsv = (res: express.Response, name: string, lines: Parameters<typeof toCsv>[0]) =>
  res.type("text/csv").attachment(name).send(toCsv(lines));

// The month's PAYE, for the remittance to the state's tax office.
app.get("/payroll/:period/paye.csv", adminOnly, async (req, res) => {
  const run = await fetchRun(String(req.params.period));
  if (!run) {
    res.status(404).json({ error: "No payroll for that month" });
    return;
  }
  sendCsv(res, `paye-${run.period}.csv`, [
    ["Staff number", "Name", "Tax ID", "Gross pay", "Pension", "NHF", "PAYE"],
    ...run.payslips
      .filter((p) => deductionOf(p, "PAYE") > 0)
      .map((p) => [
        p.employeeNo,
        p.employeeName,
        p.taxId,
        p.gross.toFixed(2),
        deductionOf(p, "Pension").toFixed(2),
        deductionOf(p, "NHF").toFixed(2),
        deductionOf(p, "PAYE").toFixed(2),
      ]),
  ]);
});

// The month's pension contributions, for the remittance to each PFA.
app.get("/payroll/:period/pension.csv", adminOnly, async (req, res) => {
  const run = await fetchRun(String(req.params.period));
  if (!run) {
    res.status(404).json({ error: "No payroll for that month" });
    return;
  }
  sendCsv(res, `pension-${run.period}.csv`, [
    ["Staff number", "Name", "Pension provider", "RSA PIN", "Employee", "Employer", "Total"],
    ...run.payslips
      .map((p) => ({ p, own: deductionOf(p, "Pension") }))
      .filter(({ p, own }) => own + p.employerPension > 0)
      .map(({ p, own }) => [
        p.employeeNo,
        p.employeeName,
        p.pensionProvider,
        p.pensionPin,
        own.toFixed(2),
        p.employerPension.toFixed(2),
        round2(own + p.employerPension).toFixed(2),
      ]),
  ]);
});

// Anyone's payslip as a PDF, for HR (drafts too, marked NOT PAID YET).
app.get("/payroll/:period/payslips/:employeeId/pdf", adminOnly, async (req, res) => {
  const { rows } = await db.query<PayslipRow>(
    "SELECT * FROM payslips WHERE period = $1 AND employee_id = $2",
    [req.params.period, req.params.employeeId],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "No payslip for them that month" });
    return;
  }
  await sendPayslipPdf(res, rows[0]);
});

// The month's bank transfers as a spreadsheet, for the bank's bulk payment upload.
app.get("/payroll/:period/bank.csv", adminOnly, async (req, res) => {
  const run = await fetchRun(String(req.params.period));
  if (!run) {
    res.status(404).json({ error: "No payroll for that month" });
    return;
  }
  sendCsv(res, `payroll-${run.period}.csv`, [
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
  ]);
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
  res: express.Response,
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
    const { rows: inserted } = await client.query<GuarantorRow & { employee_name: string }>(
      `INSERT INTO guarantors (name, relationship, phone, email, address,
         occupation, workplace, id, employee_id, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *, (SELECT name FROM employees WHERE id = $9) AS employee_name`,
      [...values, randomUUID(), employeeId, addedBy],
    );
    await logActivity(
      client,
      res,
      `Added guarantor ${inserted[0].name} for ${inserted[0].employee_name}`,
    );
    return toGuarantor(inserted[0]);
  });
};

app.get("/employees/:id/guarantors", adminOnly, async (req, res) => {
  res.json(await fetchGuarantors(String(req.params.id)));
});

app.post("/employees/:id/guarantors", adminOnly, async (req, res) => {
  res.status(201).json(await addGuarantor(res, String(req.params.id), "admin", req.body));
});

app.get("/me/guarantors", employeeOnly, async (_req, res) => {
  res.json(await fetchGuarantors(sessionOf(res).employeeId!));
});

app.post("/me/guarantors", employeeOnly, async (req, res) => {
  res.status(201).json(await addGuarantor(res, sessionOf(res).employeeId!, "employee", req.body));
});

// HR can change any guarantor and keeps their verified mark; an employee can
// change only their own, which then needs checking again.
app.put("/guarantors/:id", anyone, async (req, res) => {
  const session = sessionOf(res);
  const values = readGuarantorForm(req.body);
  const row = await transaction(async (client) => {
    const { rows } = await client.query<GuarantorRow & { employee_name: string }>(
      `UPDATE guarantors SET name = $1, relationship = $2, phone = $3, email = $4,
         address = $5, occupation = $6, workplace = $7, updated_at = now(),
         verified_at = CASE WHEN $9::text IS NULL THEN verified_at END
       WHERE id = $8 AND ($9::text IS NULL OR employee_id = $9)
       RETURNING *, (SELECT name FROM employees WHERE id = guarantors.employee_id)
         AS employee_name`,
      [...values, req.params.id, session.role === "admin" ? null : session.employeeId],
    );
    if (!rows[0]) throw new HttpError(404, "Guarantor not found");
    await logActivity(
      client,
      res,
      `Changed the details of ${rows[0].employee_name}'s guarantor ${rows[0].name}`,
    );
    return rows[0];
  });
  res.json(toGuarantor(row));
});

app.delete("/guarantors/:id", anyone, async (req, res) => {
  const session = sessionOf(res);
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string; employee_name: string }>(
      `DELETE FROM guarantors WHERE id = $1 AND ($2::text IS NULL OR employee_id = $2)
       RETURNING name, (SELECT name FROM employees WHERE id = guarantors.employee_id)
         AS employee_name`,
      [req.params.id, session.role === "admin" ? null : session.employeeId],
    );
    if (!rows[0]) throw new HttpError(404, "Guarantor not found");
    await logActivity(
      client,
      res,
      `Removed guarantor ${rows[0].name} for ${rows[0].employee_name}`,
    );
  });
  res.sendStatus(204);
});

app.put("/guarantors/:id/verified", adminOnly, async (req, res) => {
  const verified = req.body?.verified === true;
  const row = await transaction(async (client) => {
    const { rows } = await client.query<GuarantorRow & { employee_name: string }>(
      `UPDATE guarantors SET verified_at = CASE WHEN $2 THEN now() END
       WHERE id = $1
       RETURNING *, (SELECT name FROM employees WHERE id = guarantors.employee_id)
         AS employee_name`,
      [req.params.id, verified],
    );
    if (!rows[0]) throw new HttpError(404, "Guarantor not found");
    await logActivity(
      client,
      res,
      `${verified ? "Verified" : "Unverified"} ${rows[0].employee_name}'s guarantor ${rows[0].name}`,
    );
    return rows[0];
  });
  res.json(toGuarantor(row));
});

// --- Admin accounts --------------------------------------------------------

type AdminRow = {
  id: string;
  name: string;
  email: string;
  salt: string;
  password_hash: string;
  sessions_valid_after: Date;
  deactivated_at: Date | null;
  is_owner: boolean;
  created_at: Date;
};

const toAdmin = (row: AdminRow): Admin => ({
  id: row.id,
  name: row.name,
  email: row.email,
  isOwner: row.is_owner,
  ...(row.deactivated_at !== null ? { deactivatedAt: row.deactivated_at.toISOString() } : {}),
  createdAt: row.created_at.toISOString(),
});

const OWNER_OR_MISSING =
  "Admin not found. (The owner's account is managed with ADMIN_EMAIL and ADMIN_PASSWORD on the server.)";

/**
 * Makes or updates the owner's admin account from ADMIN_EMAIL and
 * ADMIN_PASSWORD, so the owner can always get in by changing them on the
 * host. A changed password ends the owner's other logins.
 */
async function ensureOwner() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD to make the owner's admin login.");
    return;
  }
  if (!isCompanyEmail(email) || password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `ADMIN_EMAIL must end with @${COMPANY_EMAIL_DOMAIN}, and ADMIN_PASSWORD needs ` +
        `${MIN_PASSWORD_LENGTH} or more characters. The owner's login was not updated.`,
    );
    return;
  }
  await transaction(async (client) => {
    const { rows } = await client.query<AdminRow>(
      "SELECT * FROM admins WHERE is_owner OR email = $1 ORDER BY is_owner DESC FOR UPDATE",
      [email],
    );
    const owner = rows.find((r) => r.is_owner);
    const sameEmailAdmin = rows.find((r) => !r.is_owner && r.email === email);
    if (owner && sameEmailAdmin)
      throw new Error(`ADMIN_EMAIL ${email} already belongs to another admin`);
    const current = owner ?? sameEmailAdmin;
    if (!current) {
      const { salt, hash } = hashPassword(password);
      await client.query(
        `INSERT INTO admins (id, name, email, salt, password_hash, is_owner)
         VALUES ($1, 'Owner', $2, $3, $4, true)`,
        [randomUUID(), email, salt, hash],
      );
      return;
    }
    const samePassword = passwordMatchesHash(password, current.salt, current.password_hash);
    if (current.is_owner && current.email === email && samePassword && !current.deactivated_at)
      return;
    const { salt, hash } = samePassword
      ? { salt: current.salt, hash: current.password_hash }
      : hashPassword(password);
    await client.query(
      `UPDATE admins SET is_owner = true, email = $2, salt = $3, password_hash = $4,
         deactivated_at = NULL,
         sessions_valid_after = CASE WHEN $5 THEN sessions_valid_after ELSE $6 END
       WHERE id = $1`,
      [current.id, email, salt, hash, samePassword, new Date()],
    );
  });
}

app.get("/admins", adminOnly, async (_req, res) => {
  const { rows } = await db.query<AdminRow>(
    "SELECT * FROM admins ORDER BY is_owner DESC, deactivated_at IS NOT NULL, name",
  );
  res.json(rows.map(toAdmin));
});

app.post("/admins", adminOnly, async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!name) throw new HttpError(400, "Enter their name");
  if (!isCompanyEmail(email))
    throw new HttpError(400, `Use their @${COMPANY_EMAIL_DOMAIN} work email`);
  checkPassword(password);
  const { salt, hash } = hashPassword(password);
  const row = await transaction(async (client) => {
    const { rows } = await client.query<AdminRow>(
      `INSERT INTO admins (id, name, email, salt, password_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [randomUUID(), name, email, salt, hash],
    );
    await logActivity(client, res, `Added admin ${name} (${email})`);
    return rows[0];
  });
  res.status(201).json(toAdmin(row));
});

// A new password ends the admin's existing logins.
app.put("/admins/:id/password", adminOnly, async (req, res) => {
  const password = String(req.body?.password ?? "");
  checkPassword(password);
  const { salt, hash } = hashPassword(password);
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      `UPDATE admins SET salt = $2, password_hash = $3, sessions_valid_after = $4
       WHERE id = $1 AND NOT is_owner RETURNING name`,
      [req.params.id, salt, hash, new Date()],
    );
    if (!rows[0]) throw new HttpError(404, OWNER_OR_MISSING);
    await logActivity(client, res, `Set a new password for admin ${rows[0].name}`);
  });
  res.sendStatus(204);
});

// Deactivating logs them out straight away.
app.put("/admins/:id/active", adminOnly, async (req, res) => {
  const active = req.body?.active === true;
  if (!active && sessionOf(res).adminId === req.params.id)
    throw new HttpError(400, "You can't deactivate yourself");
  const row = await transaction(async (client) => {
    const { rows } = await client.query<AdminRow>(
      `UPDATE admins SET deactivated_at = CASE WHEN $2 THEN NULL
         ELSE COALESCE(deactivated_at, now()) END
       WHERE id = $1 AND NOT is_owner RETURNING *`,
      [req.params.id, active],
    );
    if (!rows[0]) throw new HttpError(404, OWNER_OR_MISSING);
    await logActivity(
      client,
      res,
      `${active ? "Reactivated" : "Deactivated"} admin ${rows[0].name}`,
    );
    return rows[0];
  });
  res.json(toAdmin(row));
});

// --- Contracts and account set-up ------------------------------------------

// Where the site is, for the links in emails.
const SITE_URL = (process.env.SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const CONTRACT_LINK_DAYS = 14;
const SETUP_LINK_DAYS = 7;

/** A long random link token; only its hash is stored. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
};
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

type TemplateRow = { id: string; name: string; body: string; updated_at: Date };
const toTemplate = (row: TemplateRow): ContractTemplate => ({
  id: row.id,
  name: row.name,
  body: row.body,
  updatedAt: row.updated_at.toISOString(),
});

type ContractRow = {
  id: string;
  employee_id: string;
  template_name: string | null;
  title: string;
  body: string;
  status: ContractStatus;
  token_expires_at: Date;
  sent_by: string;
  sent_at: Date;
  viewed_at: Date | null;
  accepted_at: Date | null;
  accepted_name: string | null;
  accepted_ip: string | null;
};
const toContract = (row: ContractRow): Contract => ({
  id: row.id,
  employeeId: row.employee_id,
  ...(row.template_name !== null ? { templateName: row.template_name } : {}),
  title: row.title,
  body: row.body,
  status: row.status,
  sentBy: row.sent_by,
  sentAt: row.sent_at.toISOString(),
  ...(row.viewed_at !== null ? { viewedAt: row.viewed_at.toISOString() } : {}),
  expiresAt: row.token_expires_at.toISOString(),
  ...(row.accepted_at !== null ? { acceptedAt: row.accepted_at.toISOString() } : {}),
  ...(row.accepted_name !== null ? { acceptedName: row.accepted_name } : {}),
  ...(row.accepted_ip !== null ? { acceptedIp: row.accepted_ip } : {}),
});

const EMPLOYMENT_WORDS: Record<EmploymentType, string> = {
  full_time: "full-time",
  part_time: "part-time",
  contract: "fixed-term contract",
  intern: "internship",
};

/**
 * The {{blanks}} a contract template can use, for one employee. Unknown
 * blanks are left as they are, so a typo shows up in the preview.
 */
export const CONTRACT_BLANKS = [
  "name", "first_name", "job_title", "department", "employment_type", "start_date",
  "basic_salary", "allowances", "monthly_pay", "annual_leave_days", "work_email",
  "personal_email", "staff_number", "company", "today",
] as const;

async function fillContract(client: PoolClient | typeof db, employeeId: string, body: string) {
  const e = await fetchEmployee(employeeId);
  if (!e) throw new HttpError(404, "Employee not found");
  const items = (await fetchPayItems(client, [employeeId])).filter((i) => i.kind === "allowance");
  const allowances = items.reduce((sum, i) => sum + i.amount, 0);
  const values: Record<(typeof CONTRACT_BLANKS)[number], string> = {
    name: e.name,
    first_name: e.name.split(/\s+/)[0],
    job_title: e.job_title,
    department: e.department_name ?? "the Company",
    employment_type: EMPLOYMENT_WORDS[e.employment_type],
    start_date: dayName(e.start_date),
    basic_salary: money(e.base_salary),
    allowances: items.length ? items.map((i) => `${i.name} ${money(i.amount)}`).join(", ") : "none",
    monthly_pay: money(round2(e.base_salary + allowances)),
    annual_leave_days: String(e.annual_leave_days),
    work_email: e.email,
    personal_email: e.personal_email ?? "",
    staff_number: e.employee_no,
    company: COMPANY_NAME,
    today: dayName(today()),
  };
  return {
    employee: e,
    body: body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) =>
      key in values ? values[key as keyof typeof values] : whole,
    ),
  };
}

const contractEmail = (name: string, link: string) =>
  [
    `Dear ${name.split(/\s+/)[0]},`,
    "",
    `Welcome to ${COMPANY_NAME}! Your employment contract is ready for you to read and accept:`,
    "",
    link,
    "",
    `The link works for ${CONTRACT_LINK_DAYS} days. Once you accept, you'll get a second email showing you how to set up your ${COMPANY_NAME} HR account, where you'll see your payslips and ask for leave.`,
    "",
    "If you have any questions about the contract, reply to this email or speak to HR.",
    "",
    `${COMPANY_NAME} HR`,
  ].join("\n");

const setupEmail = (name: string, workEmail: string, link: string) =>
  [
    `Dear ${name.split(/\s+/)[0]},`,
    "",
    `Thank you for accepting your contract. Now set up your ${COMPANY_NAME} HR account:`,
    "",
    `1. Open this link and choose your own password (it works for ${SETUP_LINK_DAYS} days):`,
    `   ${link}`,
    `2. Then log in at ${SITE_URL}/login on the Employee tab, with your work email:`,
    `   ${workEmail}`,
    "",
    "In the HR account you can see your payslips, check your leave and ask for time off, keep your details up to date, and send HR requests.",
    "",
    "Keep your password to yourself. If you ever forget it, use \"Forgotten your password?\" on the login page.",
    "",
    `${COMPANY_NAME} HR`,
  ].join("\n");

/**
 * Makes a contract for an employee from a template (or wording HR edited),
 * withdraws any earlier one they haven't accepted, and emails them the link.
 */
async function sendContract(
  res: express.Response,
  employeeId: string,
  templateId: string,
  editedBody?: string | null,
) {
  const { contract, token, employee } = await transaction(async (client) => {
    const { rows: templates } = await client.query<TemplateRow>(
      "SELECT * FROM contract_templates WHERE id = $1",
      [templateId],
    );
    const template = templates[0];
    if (!template) throw new HttpError(400, "Choose a contract template");
    const filled = await fillContract(client, employeeId, editedBody ?? template.body);
    if (!filled.employee.personal_email)
      throw new HttpError(400, "Add their personal email first, so the contract can be sent there");
    await client.query(
      "UPDATE contracts SET status = 'withdrawn' WHERE employee_id = $1 AND status IN ('sent', 'viewed')",
      [employeeId],
    );
    const { token, hash } = newToken();
    const { rows } = await client.query<ContractRow>(
      `INSERT INTO contracts (id, employee_id, template_name, title, body, token_hash,
         token_expires_at, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        randomUUID(),
        employeeId,
        template.name,
        template.name,
        filled.body,
        hash,
        daysFromNow(CONTRACT_LINK_DAYS),
        actorOf(sessionOf(res)),
      ],
    );
    await logActivity(
      client,
      res,
      `Sent ${filled.employee.name} the "${template.name}" contract at ${filled.employee.personal_email}`,
    );
    return { contract: rows[0], token, employee: filled.employee };
  });
  // Sent once the contract is saved, so an email never points at nothing.
  await sendEmail({
    to: employee.personal_email!,
    subject: `Your employment contract from ${COMPANY_NAME}`,
    text: contractEmail(employee.name, `${SITE_URL}/contract?t=${token}`),
    employeeId,
  });
  return contract;
}

/** Gives an employee a fresh link to choose their password, and emails it. */
async function sendSetupLink(
  client: PoolClient,
  employee: { id: string; name: string; email: string; personal_email: string | null },
) {
  if (!employee.personal_email) throw new HttpError(400, "Add their personal email first");
  const { token, hash } = newToken();
  await client.query(
    "UPDATE employees SET setup_token_hash = $2, setup_token_expires_at = $3 WHERE id = $1",
    [employee.id, hash, daysFromNow(SETUP_LINK_DAYS)],
  );
  return () =>
    sendEmail({
      to: employee.personal_email!,
      subject: `Set up your ${COMPANY_NAME} HR account`,
      text: setupEmail(employee.name, employee.email, `${SITE_URL}/setup?t=${token}`),
      employeeId: employee.id,
    });
}

// --- Contract templates (HR) ---

app.get("/contract-templates", adminOnly, async (_req, res) => {
  const { rows } = await db.query<TemplateRow>("SELECT * FROM contract_templates ORDER BY name");
  res.json(rows.map(toTemplate));
});

/** A template's name and wording from a request body, checked. */
const readTemplate = (body: Record<string, unknown> | undefined) => {
  const name = String(body?.name ?? "").trim();
  const text = String(body?.body ?? "").trim();
  if (!name || !text) throw new HttpError(400, "Give the template a name and its wording");
  if (text.length > 50_000) throw new HttpError(400, "That contract is too long");
  return { name, body: text };
};

app.post("/contract-templates", adminOnly, async (req, res) => {
  const t = readTemplate(req.body);
  const row = await transaction(async (client) => {
    const { rows } = await client.query<TemplateRow>(
      "INSERT INTO contract_templates (id, name, body) VALUES ($1, $2, $3) RETURNING *",
      [randomUUID(), t.name, t.body],
    );
    await logActivity(client, res, `Added the "${t.name}" contract template`);
    return rows[0];
  });
  res.status(201).json(toTemplate(row));
});

// Contracts already sent keep the wording they were sent with.
app.put("/contract-templates/:id", adminOnly, async (req, res) => {
  const t = readTemplate(req.body);
  const row = await transaction(async (client) => {
    const { rows } = await client.query<TemplateRow>(
      `UPDATE contract_templates SET name = $2, body = $3, updated_at = clock_timestamp()
       WHERE id = $1 RETURNING *`,
      [req.params.id, t.name, t.body],
    );
    if (!rows[0]) throw new HttpError(404, "Template not found");
    await logActivity(client, res, `Edited the "${t.name}" contract template`);
    return rows[0];
  });
  res.json(toTemplate(row));
});

app.delete("/contract-templates/:id", adminOnly, async (req, res) => {
  await transaction(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      "DELETE FROM contract_templates WHERE id = $1 RETURNING name",
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, "Template not found");
    await logActivity(client, res, `Deleted the "${rows[0].name}" contract template`);
  });
  res.sendStatus(204);
});

// The wording a template gives for one employee, before it is sent.
app.post("/employees/:id/contract-preview", adminOnly, async (req, res) => {
  const { rows } = await db.query<TemplateRow>("SELECT * FROM contract_templates WHERE id = $1", [
    String(req.body?.templateId ?? ""),
  ]);
  if (!rows[0]) throw new HttpError(400, "Choose a contract template");
  const filled = await fillContract(db, String(req.params.id), rows[0].body);
  res.json({ title: rows[0].name, body: filled.body });
});

// --- Contracts (HR) ---

app.get("/employees/:id/contracts", adminOnly, async (req, res) => {
  const { rows } = await db.query<ContractRow>(
    "SELECT * FROM contracts WHERE employee_id = $1 ORDER BY sent_at DESC",
    [req.params.id],
  );
  res.json(rows.map(toContract));
});

app.post("/employees/:id/contracts", adminOnly, async (req, res) => {
  const contract = await sendContract(
    res,
    String(req.params.id),
    String(req.body?.templateId ?? ""),
    optionalText(req.body?.body),
  );
  res.status(201).json(toContract(contract));
});

// A new link (the old one stops working) and the email again.
app.post("/contracts/:id/resend", adminOnly, async (req, res) => {
  const { row, token, employee } = await transaction(async (client) => {
    const { token, hash } = newToken();
    const { rows } = await client.query<ContractRow>(
      `UPDATE contracts SET token_hash = $2, token_expires_at = $3
       WHERE id = $1 AND status IN ('sent', 'viewed') RETURNING *`,
      [req.params.id, hash, daysFromNow(CONTRACT_LINK_DAYS)],
    );
    if (!rows[0]) throw new HttpError(404, "No contract waiting with that id");
    const employee = await fetchEmployee(rows[0].employee_id);
    if (!employee.personal_email) throw new HttpError(400, "Add their personal email first");
    await logActivity(client, res, `Resent ${employee.name}'s contract to ${employee.personal_email}`);
    return { row: rows[0], token, employee };
  });
  await sendEmail({
    to: employee.personal_email!,
    subject: `Your employment contract from ${COMPANY_NAME}`,
    text: contractEmail(employee.name, `${SITE_URL}/contract?t=${token}`),
    employeeId: employee.id,
  });
  res.json(toContract(row));
});

app.put("/contracts/:id/withdraw", adminOnly, async (req, res) => {
  const row = await transaction(async (client) => {
    const { rows } = await client.query<ContractRow>(
      `UPDATE contracts SET status = 'withdrawn'
       WHERE id = $1 AND status IN ('sent', 'viewed') RETURNING *`,
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, "No contract waiting with that id");
    const employee = await fetchEmployee(rows[0].employee_id);
    await logActivity(client, res, `Withdrew ${employee.name}'s contract`);
    return rows[0];
  });
  res.json(toContract(row));
});

const sendContractPdf = async (res: express.Response, row: ContractRow) => {
  const employee = await fetchEmployee(row.employee_id);
  res
    .type("application/pdf")
    .attachment(`Contract ${employee.name}.pdf`)
    .send(await contractPdf(toContract(row), COMPANY_NAME, employee.name));
};

app.get("/contracts/:id/pdf", adminOnly, async (req, res) => {
  const { rows } = await db.query<ContractRow>("SELECT * FROM contracts WHERE id = $1", [
    req.params.id,
  ]);
  if (!rows[0]) throw new HttpError(404, "Contract not found");
  await sendContractPdf(res, rows[0]);
});

// HR sends (again) the email with a link to set up their account.
app.post("/employees/:id/setup-email", adminOnly, async (req, res) => {
  const send = await transaction(async (client) => {
    const { rows } = await client.query<EmployeeRow>(
      "SELECT * FROM employees WHERE id = $1 FOR UPDATE",
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, "Employee not found");
    const send = await sendSetupLink(client, rows[0]);
    await logActivity(
      client,
      res,
      `Sent ${rows[0].name} an account set-up link at ${rows[0].personal_email}`,
    );
    return send;
  });
  await send();
  res.json(toEmployee(await fetchEmployee(String(req.params.id))));
});

// --- Contracts (the employee's own, in the portal) ---

app.get("/me/contracts", employeeOnly, async (_req, res) => {
  const { rows } = await db.query<ContractRow>(
    "SELECT * FROM contracts WHERE employee_id = $1 AND status = 'accepted' ORDER BY accepted_at DESC",
    [sessionOf(res).employeeId],
  );
  res.json(rows.map(toContract));
});

app.get("/me/contracts/:id/pdf", employeeOnly, async (req, res) => {
  const { rows } = await db.query<ContractRow>(
    "SELECT * FROM contracts WHERE id = $1 AND employee_id = $2 AND status = 'accepted'",
    [req.params.id, sessionOf(res).employeeId],
  );
  if (!rows[0]) throw new HttpError(404, "Contract not found");
  await sendContractPdf(res, rows[0]);
});

// --- Contract and set-up links (no login: the link is the key) ---

const contractByToken = async (client: PoolClient | typeof db, token: string, lock = false) =>
  (
    await client.query<ContractRow>(
      `SELECT * FROM contracts WHERE token_hash = $1${lock ? " FOR UPDATE" : ""}`,
      [hashToken(token)],
    )
  ).rows[0];

app.get("/public/contracts/:token", async (req, res) => {
  const row = await contractByToken(db, String(req.params.token));
  if (!row) throw new HttpError(404, "This link isn't valid. Ask HR to send your contract again.");
  if (row.status === "withdrawn")
    throw new HttpError(410, "This contract was withdrawn. HR will send you a new one.");
  const expired = row.status !== "accepted" && row.token_expires_at < new Date();
  if (row.status === "sent" && !expired)
    await db.query("UPDATE contracts SET status = 'viewed', viewed_at = now() WHERE id = $1", [row.id]);
  const employee = await fetchEmployee(row.employee_id);
  const contract: PublicContract = {
    company: COMPANY_NAME,
    employeeName: employee.name,
    title: row.title,
    body: row.body,
    status: row.status === "sent" && !expired ? "viewed" : row.status,
    expired,
    ...(row.accepted_at ? { acceptedAt: row.accepted_at.toISOString() } : {}),
    ...(row.accepted_name ? { acceptedName: row.accepted_name } : {}),
  };
  res.json(contract);
});

// Accepting needs their full name typed, as a signature. Their account set-up
// email follows straight away, unless they can already log in.
app.post("/public/contracts/:token/accept", async (req, res) => {
  const typed = String(req.body?.fullName ?? "").trim().replace(/\s+/g, " ");
  if (req.body?.agree !== true) throw new HttpError(400, "Tick the box to agree to the terms");
  const send = await transaction(async (client) => {
    const row = await contractByToken(client, String(req.params.token), true);
    if (!row || row.status === "withdrawn")
      throw new HttpError(404, "This contract can't be accepted. Ask HR to send it again.");
    if (row.status === "accepted") throw new HttpError(409, "You've already accepted this contract");
    if (row.token_expires_at < new Date())
      throw new HttpError(410, "This link has expired. Ask HR to send your contract again.");
    const { rows } = await client.query<EmployeeRow>(
      "SELECT * FROM employees WHERE id = $1 FOR UPDATE",
      [row.employee_id],
    );
    const employee = rows[0];
    if (typed.toLowerCase() !== employee.name.trim().replace(/\s+/g, " ").toLowerCase())
      throw new HttpError(400, `Type your full name exactly as it appears: ${employee.name}`);
    await client.query(
      `UPDATE contracts SET status = 'accepted', accepted_at = now(), accepted_name = $2,
         accepted_ip = $3, accepted_user_agent = $4
       WHERE id = $1`,
      [row.id, typed, req.ip ?? null, String(req.header("user-agent") ?? "").slice(0, 300)],
    );
    await client.query("INSERT INTO activity_log (actor, summary) VALUES ($1, $2)", [
      `${employee.name} (contract link)`,
      `Accepted the "${row.title}" contract`,
    ]);
    return employee.password_hash === null ? sendSetupLink(client, employee) : null;
  });
  // The new starter isn't kept waiting on the mail server: the set-up email
  // goes in the background and lands in the outbox either way.
  if (send) void send().catch((err) => console.error("Set-up email failed:", err));
  res.json({ accepted: true, setupEmailSent: send !== null });
});

app.get("/public/contracts/:token/pdf", async (req, res) => {
  const row = await contractByToken(db, String(req.params.token));
  if (!row || row.status !== "accepted") throw new HttpError(404, "No accepted contract here");
  await sendContractPdf(res, row);
});

const employeeBySetupToken = async (client: PoolClient | typeof db, token: string) =>
  (
    await client.query<EmployeeRow>(
      `SELECT * FROM employees WHERE setup_token_hash = $1 AND setup_token_expires_at > now()
         AND deactivated_at IS NULL AND (end_date IS NULL OR end_date >= $2)`,
      [hashToken(token), today()],
    )
  ).rows[0];

app.get("/public/setup/:token", async (req, res) => {
  const employee = await employeeBySetupToken(db, String(req.params.token));
  if (!employee)
    throw new HttpError(404, "This link has expired or was already used. Ask HR for a new one.");
  res.json({ name: employee.name, workEmail: employee.email, company: COMPANY_NAME });
});

// They choose their own password, so there is no temporary one to change.
app.post("/public/setup/:token", async (req, res) => {
  const password = String(req.body?.password ?? "");
  checkPassword(password);
  const employee = await transaction(async (client) => {
    const employee = await employeeBySetupToken(client, String(req.params.token));
    if (!employee)
      throw new HttpError(404, "This link has expired or was already used. Ask HR for a new one.");
    const { salt, hash } = hashPassword(password);
    await client.query(
      `UPDATE employees SET salt = $2, password_hash = $3, must_change_password = false,
         sessions_valid_after = $4, setup_token_hash = NULL, setup_token_expires_at = NULL
       WHERE id = $1`,
      [employee.id, salt, hash, new Date()],
    );
    await client.query("INSERT INTO activity_log (actor, summary) VALUES ($1, $2)", [
      `${employee.name} (set-up link)`,
      "Set up their staff portal account",
    ]);
    return employee;
  });
  res.json({ workEmail: employee.email });
});

// --- Emails sent (HR) ---

app.get("/emails", adminOnly, async (_req, res) => {
  const { rows } = await db.query<{
    id: string;
    to_address: string;
    subject: string;
    body: string;
    status: OutboxEmail["status"];
    error: string | null;
    created_at: Date;
  }>("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 200");
  const emails: OutboxEmail[] = rows.map((r) => ({
    id: String(r.id),
    to: r.to_address,
    subject: r.subject,
    body: r.body,
    status: r.status,
    ...(r.error !== null ? { error: r.error } : {}),
    createdAt: r.created_at.toISOString(),
  }));
  res.json(emails);
});

// --- Requests to HR --------------------------------------------------------

type RequestRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_no: string;
  type: StaffRequestType;
  details: string | null;
  status: StaffRequestStatus;
  response: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
};

const toRequest = (row: RequestRow): StaffRequest => ({
  id: row.id,
  employeeId: row.employee_id,
  employeeName: row.employee_name,
  employeeNo: row.employee_no,
  type: row.type,
  ...(row.details !== null ? { details: row.details } : {}),
  status: row.status,
  ...(row.response !== null ? { response: row.response } : {}),
  ...(row.resolved_by !== null ? { resolvedBy: row.resolved_by } : {}),
  ...(row.resolved_at !== null ? { resolvedAt: row.resolved_at.toISOString() } : {}),
  createdAt: row.created_at.toISOString(),
});

const REQUEST_SELECT = `
  SELECT r.*, e.name AS employee_name, e.employee_no
  FROM staff_requests r JOIN employees e ON e.id = r.employee_id`;

const REQUEST_LABELS: Record<StaffRequestType, string> = {
  password_reset: "a new password",
  bank_change: "a bank account change",
  details_correction: "a correction to their details",
  letter: "a letter",
  other: "something else",
};

const fetchRequest = async (client: PoolClient | typeof db, id: string) =>
  (await client.query<RequestRow>(`${REQUEST_SELECT} WHERE r.id = $1`, [id])).rows[0];

/** Opens a request, unless the same kind is already waiting. */
async function openRequest(
  client: PoolClient,
  employeeId: string,
  type: StaffRequestType,
  details: string | null,
) {
  if (type !== "other") {
    const { rowCount } = await client.query(
      "SELECT 1 FROM staff_requests WHERE employee_id = $1 AND type = $2 AND status = 'open'",
      [employeeId, type],
    );
    if (rowCount) return null;
  }
  const id = randomUUID();
  await client.query(
    `INSERT INTO staff_requests (id, employee_id, type, details) VALUES ($1, $2, $3, $4)`,
    [id, employeeId, type, details],
  );
  return fetchRequest(client, id);
}

app.get("/requests", adminOnly, async (_req, res) => {
  const { rows } = await db.query<RequestRow>(
    `${REQUEST_SELECT} ORDER BY r.status = 'open' DESC, r.created_at DESC LIMIT 300`,
  );
  res.json(rows.map(toRequest));
});

app.get("/requests/mine", employeeOnly, async (_req, res) => {
  const { rows } = await db.query<RequestRow>(
    `${REQUEST_SELECT} WHERE r.employee_id = $1 ORDER BY r.created_at DESC`,
    [sessionOf(res).employeeId],
  );
  res.json(rows.map(toRequest));
});

const REQUEST_TYPES = Object.keys(REQUEST_LABELS) as StaffRequestType[];

app.post("/requests", employeeOnly, async (req, res) => {
  const type = String(req.body?.type ?? "") as StaffRequestType;
  const details = optionalText(req.body?.details);
  if (!REQUEST_TYPES.includes(type)) throw new HttpError(400, "Choose what you need");
  if (details && details.length > 2000)
    throw new HttpError(400, "Keep the details under 2,000 characters");
  if (!details && (type === "bank_change" || type === "details_correction" || type === "other"))
    throw new HttpError(400, "Say what you need, so HR can help");
  const row = await transaction(async (client) => {
    const opened = await openRequest(client, sessionOf(res).employeeId!, type, details);
    if (!opened)
      throw new HttpError(409, "You already have one of these waiting. HR will get back to you.");
    await logActivity(client, res, `Asked HR for ${REQUEST_LABELS[type]}`);
    return opened;
  });
  res.status(201).json(toRequest(row));
});

app.put("/requests/:id/cancel", employeeOnly, async (req, res) => {
  await transaction(async (client) => {
    const { rows } = await client.query<{ type: StaffRequestType }>(
      `UPDATE staff_requests SET status = 'cancelled', resolved_at = now()
       WHERE id = $1 AND employee_id = $2 AND status = 'open' RETURNING type`,
      [req.params.id, sessionOf(res).employeeId],
    );
    if (!rows[0]) throw new HttpError(404, "This request can no longer be cancelled");
    await logActivity(client, res, `Withdrew their request for ${REQUEST_LABELS[rows[0].type]}`);
  });
  res.sendStatus(204);
});

// HR closes a request as done or declined, with a reply the employee sees.
// For a password request, `password` sets their temporary password in the
// same step.
app.put("/requests/:id", adminOnly, async (req, res) => {
  const status = String(req.body?.status ?? "") as StaffRequestStatus;
  const response = optionalText(req.body?.response);
  const password = optionalText(req.body?.password);
  if (status !== "done" && status !== "declined")
    throw new HttpError(400, "Mark it done or declined");
  if (status === "declined" && !response)
    throw new HttpError(400, "Say why, so they know what to do next");
  const row = await transaction(async (client) => {
    const request = await fetchRequest(client, String(req.params.id));
    if (!request || request.status !== "open")
      throw new HttpError(404, "No open request with that id");
    if (password && status === "done")
      await setTemporaryPassword(client, res, request.employee_id, password);
    await client.query(
      `UPDATE staff_requests SET status = $2, response = $3, resolved_by = $4,
         resolved_at = now()
       WHERE id = $1`,
      [request.id, status, response, actorOf(sessionOf(res))],
    );
    await logActivity(
      client,
      res,
      `${status === "done" ? "Completed" : "Declined"} ${request.employee_name}'s request for ` +
        `${REQUEST_LABELS[request.type]}${response ? `: ${response}` : ""}`,
    );
    return fetchRequest(client, request.id);
  });
  res.json(toRequest(row));
});

// For someone locked out: asks HR for a new password without logging in. The
// answer is the same whether or not the email is on file, so it can't be
// used to find out who works here, and it is limited like logins.
app.post("/auth/password-request", async (req, res) => {
  const key = `password-request:${req.ip ?? "unknown"}`;
  if (isLockedOut(key)) {
    res.status(429).json({ error: `Too many requests. Try again in ${LOCKOUT_MINUTES} minutes.` });
    return;
  }
  recordFailedLogin(key);
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (isCompanyEmail(email)) {
    const { rows } = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM employees WHERE email = $1 AND deactivated_at IS NULL
         AND (end_date IS NULL OR end_date >= $2)`,
      [email, today()],
    );
    if (rows[0])
      await transaction(async (client) => {
        const opened = await openRequest(
          client,
          rows[0].id,
          "password_reset",
          "Sent from the login page (forgot password)",
        );
        if (opened)
          await client.query("INSERT INTO activity_log (actor, summary) VALUES ($1, $2)", [
            `${rows[0].name} (login page)`,
            "Asked HR for a new password",
          ]);
      });
  }
  res.json({
    message:
      "If that email belongs to a member of staff, HR has been asked to give you a new password. They will tell you it in person.",
  });
});

// --- Noticeboard -----------------------------------------------------------

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
  posted_by: string;
  created_at: Date;
  updated_at: Date | null;
};

const toAnnouncement = (row: AnnouncementRow): Announcement => ({
  id: row.id,
  title: row.title,
  body: row.body,
  category: row.category,
  pinned: row.pinned,
  postedBy: row.posted_by,
  createdAt: row.created_at.toISOString(),
  ...(row.updated_at !== null ? { updatedAt: row.updated_at.toISOString() } : {}),
});

const NOTICE_CATEGORIES: AnnouncementCategory[] = ["general", "important", "event", "celebration"];

/** A notice's fields from a request body, checked. */
const readNotice = (body: Record<string, unknown> | undefined) => {
  const title = String(body?.title ?? "").trim();
  const text = String(body?.body ?? "").trim();
  const category = String(body?.category ?? "general") as AnnouncementCategory;
  if (!title || !text) throw new HttpError(400, "Enter a title and the message");
  if (title.length > 120) throw new HttpError(400, "Keep the title under 120 characters");
  if (text.length > 2000) throw new HttpError(400, "Keep the message under 2,000 characters");
  if (!NOTICE_CATEGORIES.includes(category)) throw new HttpError(400, "Choose the type of notice");
  return { title, body: text, category, pinned: body?.pinned === true };
};

// Pinned notices first, then the newest.
app.get("/announcements", anyone, async (_req, res) => {
  const { rows } = await db.query<AnnouncementRow>(
    "SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 30",
  );
  res.json(rows.map(toAnnouncement));
});

app.post("/announcements", adminOnly, async (req, res) => {
  const n = readNotice(req.body);
  const row = await transaction(async (client) => {
    const { rows } = await client.query<AnnouncementRow>(
      `INSERT INTO announcements (id, title, body, category, pinned, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), n.title, n.body, n.category, n.pinned, actorOf(sessionOf(res))],
    );
    await logActivity(client, res, `Posted a${n.pinned ? " pinned" : ""} ${n.category} notice: ${n.title}`);
    return rows[0];
  });
  res.status(201).json(toAnnouncement(row));
});

app.put("/announcements/:id", adminOnly, async (req, res) => {
  const n = readNotice(req.body);
  const row = await transaction(async (client) => {
    const { rows } = await client.query<AnnouncementRow>(
      `UPDATE announcements SET title = $2, body = $3, category = $4, pinned = $5,
         updated_at = clock_timestamp()
       WHERE id = $1 RETURNING *`,
      [req.params.id, n.title, n.body, n.category, n.pinned],
    );
    if (!rows[0]) throw new HttpError(404, "Notice not found");
    await logActivity(client, res, `Edited the notice: ${n.title}`);
    return rows[0];
  });
  res.json(toAnnouncement(row));
});

app.delete("/announcements/:id", adminOnly, async (req, res) => {
  await transaction(async (client) => {
    const { rows } = await client.query<{ title: string }>(
      "DELETE FROM announcements WHERE id = $1 RETURNING title",
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, "Notice not found");
    await logActivity(client, res, `Took down the notice: ${rows[0].title}`);
  });
  res.sendStatus(204);
});

// --- Activity --------------------------------------------------------------

app.get("/activity", adminOnly, async (_req, res) => {
  const { rows } = await db.query<{ id: string; at: Date; actor: string; summary: string }>(
    "SELECT * FROM activity_log ORDER BY at DESC, id DESC LIMIT 500",
  );
  const activity: Activity[] = rows.map((r) => ({
    id: String(r.id),
    at: r.at.toISOString(),
    actor: r.actor,
    summary: r.summary,
  }));
  res.json(activity);
});

// --- Public holidays -------------------------------------------------------

// Anyone can see them, so the staff portal's leave form can count days.
app.get("/holidays", anyone, async (_req, res) => {
  const { rows } = await db.query<PublicHoliday>(
    "SELECT day, name FROM public_holidays ORDER BY day",
  );
  res.json(rows);
});

// Leave already booked keeps its day count; new requests use the new list.
app.post("/holidays", adminOnly, async (req, res) => {
  const day = String(req.body?.day ?? "");
  const name = String(req.body?.name ?? "").trim();
  if (!isDay(day)) throw new HttpError(400, "Choose the day");
  if (!name) throw new HttpError(400, "Enter the holiday's name");
  await transaction(async (client) => {
    await client.query("INSERT INTO public_holidays (day, name) VALUES ($1, $2)", [
      day,
      name,
    ]);
    await logActivity(client, res, `Added public holiday ${name} on ${dayName(day)}`);
  });
  const holiday: PublicHoliday = { day, name };
  res.status(201).json(holiday);
});

app.delete("/holidays/:day", adminOnly, async (req, res) => {
  await transaction(async (client) => {
    const { rows } = await client.query<PublicHoliday>(
      "DELETE FROM public_holidays WHERE day = $1 RETURNING day, name",
      [isDay(String(req.params.day)) ? String(req.params.day) : null],
    );
    if (!rows[0]) throw new HttpError(404, "That day isn't a public holiday");
    await logActivity(
      client,
      res,
      `Removed public holiday ${rows[0].name} on ${dayName(rows[0].day)}`,
    );
  });
  res.sendStatus(204);
});

// --- Backup ----------------------------------------------------------------

// Everything in the HR database as one file, to keep somewhere safe. Password
// hashes are left out; after a restore, give everyone a new password.
app.get("/backup", adminOnly, async (_req, res) => {
  const tables = [
    "departments",
    "employees",
    "pay_items",
    "leave_requests",
    "payroll_runs",
    "payslips",
    "guarantors",
    "public_holidays",
    "admins",
    "activity_log",
    "announcements",
    "employee_photos",
    "staff_requests",
    "contract_templates",
    "contracts",
    "email_outbox",
  ];
  const data: Record<string, unknown[]> = {};
  for (const table of tables) {
    const { rows } = await db.query(`SELECT * FROM ${table}`);
    data[table] = rows.map(
      ({ salt: _salt, password_hash: _hash, token_hash: _t, setup_token_hash: _s, ...rest }) =>
      // Photos as base64 text, rather than JSON's list-of-bytes form.
      Object.fromEntries(
        Object.entries(rest).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString("base64") : v]),
      ),
    );
  }
  await logActivity(db, res, "Downloaded a backup of all HR data");
  res
    .attachment(`hr-backup-${today()}.json`)
    .json({ exportedAt: new Date().toISOString(), tables: data });
});

// --- Errors ----------------------------------------------------------------

// Which unique column clashed, in words.
const UNIQUE_MESSAGES: Record<string, string> = {
  employees_email_key: "Another employee already uses that email",
  employees_employee_no_key: "Another employee already has that staff number",
  departments_name_key: "There is already a department with that name",
  admins_email_key: "Another admin already uses that email",
  public_holidays_pkey: "That day is already a public holiday",
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

ensureOwner()
  .catch((err) => console.error("Could not set up the owner's login:", err.message))
  .finally(() =>
    app.listen(port, () => {
      console.log(`HR API listening on http://localhost:${port}`);
    }),
  );

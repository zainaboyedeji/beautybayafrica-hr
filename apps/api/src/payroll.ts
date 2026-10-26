import type { Day, PayeMode, PayLine, Period, Payslip } from "@hr/types";

// --- Calendar --------------------------------------------------------------

const DAY_MS = 86_400_000;
const toTime = (day: Day) => Date.parse(`${day}T00:00:00Z`);
const toDay = (time: number) => new Date(time).toISOString().slice(0, 10);

// "Today" for logins, leave and payroll is the company's calendar day, not the
// server's or the database's (which run on UTC).
const TIME_ZONE = process.env.TIME_ZONE ?? "Africa/Lagos";
export const today = (): Day =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());

export const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && toDay(toTime(value) || 0) === value;

export const isPeriod = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const periodStart = (period: Period): Day => `${period}-01`;

export const periodEnd = (period: Period): Day => {
  const [year, month] = period.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return toDay(Date.UTC(year, month, 0));
};

/**
 * Monday-to-Friday days from `start` to `end`, both included, leaving out
 * any `holidays` (public holidays don't count as days of leave).
 */
export function weekdaysBetween(start: Day, end: Day, holidays?: ReadonlySet<Day>) {
  let count = 0;
  for (let t = toTime(start); t <= toTime(end); t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays?.has(toDay(t))) count++;
  }
  return count;
}

const later = (a: Day, b: Day) => (a > b ? a : b);
const earlier = (a: Day, b: Day) => (a < b ? a : b);

/** Weekdays where two date ranges overlap. */
export const overlapWeekdays = (
  aStart: Day,
  aEnd: Day,
  bStart: Day,
  bEnd: Day,
  holidays?: ReadonlySet<Day>,
) => {
  const start = later(aStart, bStart);
  const end = earlier(aEnd, bEnd);
  return start > end ? 0 : weekdaysBetween(start, end, holidays);
};

// --- Money -----------------------------------------------------------------

export const round2 = (n: number) => Math.round(n * 100) / 100;
const NHF_RATE = 0.025;
const sum = (lines: PayLine[]) => round2(lines.reduce((s, l) => s + l.amount, 0));

// Personal income tax bands of the Nigeria Tax Act 2025 (from January 2026),
// on yearly taxable income (pay less pension and NHF). Reliefs the app does
// not track (rent relief, life insurance) are left out, so check unusual cases
// with an accountant.
const TAX_BANDS: [upTo: number, rate: number][] = [
  [800_000, 0],
  [3_000_000, 0.15],
  [12_000_000, 0.18],
  [25_000_000, 0.21],
  [50_000_000, 0.23],
  [Infinity, 0.25],
];

export function yearlyTax(taxable: number) {
  let tax = 0;
  let from = 0;
  for (const [upTo, rate] of TAX_BANDS) {
    if (taxable <= from) break;
    tax += (Math.min(taxable, upTo) - from) * rate;
    from = upTo;
  }
  return tax;
}

// --- Payslips --------------------------------------------------------------

export type PayslipInput = {
  period: Period;
  employee: {
    id: string;
    employee_no: string;
    name: string;
    job_title: string;
    department_name: string | null;
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
    bank_name: string | null;
    bank_account_number: string | null;
    bank_account_name: string | null;
  };
  allowances: PayLine[];
  deductions: PayLine[];
  /** Approved unpaid leave of this employee that touches the month. */
  unpaidLeave: { start: Day; end: Day }[];
  /** Public holidays, which are paid even during unpaid leave. */
  holidays: ReadonlySet<Day>;
  bonus: number;
  otherDeduction: number;
  note: string | null;
};

/**
 * One employee's pay for a month. Basic pay and allowances are paid for the
 * working days they were employed, less unpaid leave; fixed deductions (such
 * as loan repayments) are taken in full.
 */
export function calculatePayslip(input: PayslipInput): Payslip {
  const { period, employee: e } = input;
  const monthStart = periodStart(period);
  const monthEnd = periodEnd(period);
  const workingDays = weekdaysBetween(monthStart, monthEnd);

  const from = later(monthStart, e.start_date);
  const to = e.end_date ? earlier(monthEnd, e.end_date) : monthEnd;
  const employedDays = from > to ? 0 : weekdaysBetween(from, to);
  const unpaidDays = input.unpaidLeave.reduce(
    (days, leave) =>
      from > to
        ? days
        : days + overlapWeekdays(from, to, leave.start, leave.end, input.holidays),
    0,
  );
  const daysPaid = Math.max(0, employedDays - unpaidDays);
  const share = workingDays === 0 ? 0 : daysPaid / workingDays;

  const regular: PayLine[] = [
    { name: "Basic salary", amount: round2(e.base_salary * share) },
    ...input.allowances.map((a) => ({ name: a.name, amount: round2(a.amount * share) })),
  ];
  const earnings: PayLine[] = [
    ...regular,
    ...(input.bonus > 0 ? [{ name: "Bonus", amount: round2(input.bonus) }] : []),
  ];
  const regularPay = sum(regular);
  const gross = sum(earnings);

  // Pension and PAYE are as HR set them on the employee.
  const deductions: PayLine[] = [];
  const pension = round2((regularPay * e.pension_percent) / 100);
  if (pension > 0)
    deductions.push({ name: `Pension (${e.pension_percent}%)`, amount: pension });
  // National Housing Fund: 2.5% of basic salary.
  const nhf = e.nhf ? round2(regular[0].amount * NHF_RATE) : 0;
  if (nhf > 0) deductions.push({ name: "NHF (2.5%)", amount: nhf });
  let tax = 0;
  if (e.paye === "fixed") {
    // Pro-rated like the pay it is on, for joiners, leavers and unpaid leave.
    tax = round2(e.paye_amount * share);
  } else if (e.paye === "auto") {
    // Tax this month's regular pay as if it were paid all year, and a bonus
    // at the rate of the top of that income.
    const yearly = (regularPay - pension - nhf) * 12;
    tax = round2(
      yearlyTax(yearly) / 12 + (yearlyTax(yearly + input.bonus) - yearlyTax(yearly)),
    );
  }
  if (tax > 0) deductions.push({ name: "PAYE tax", amount: tax });
  deductions.push(...input.deductions.map((d) => ({ ...d, amount: round2(d.amount) })));
  if (input.otherDeduction > 0)
    deductions.push({ name: "Other deduction", amount: round2(input.otherDeduction) });
  const totalDeductions = sum(deductions);

  return {
    period,
    employeeId: e.id,
    employeeNo: e.employee_no,
    employeeName: e.name,
    jobTitle: e.job_title,
    ...(e.department_name !== null ? { departmentName: e.department_name } : {}),
    ...(e.bank_name !== null ? { bankName: e.bank_name } : {}),
    ...(e.bank_account_number !== null ? { bankAccountNumber: e.bank_account_number } : {}),
    ...(e.bank_account_name !== null ? { bankAccountName: e.bank_account_name } : {}),
    workingDays,
    daysPaid,
    earnings,
    deductions,
    bonus: round2(input.bonus),
    otherDeduction: round2(input.otherDeduction),
    ...(input.note !== null ? { note: input.note } : {}),
    gross,
    totalDeductions,
    net: round2(gross - totalDeductions),
    employerPension: round2((regularPay * e.employer_pension_percent) / 100),
    ...(e.tax_id !== null ? { taxId: e.tax_id } : {}),
    ...(e.pension_provider !== null ? { pensionProvider: e.pension_provider } : {}),
    ...(e.pension_pin !== null ? { pensionPin: e.pension_pin } : {}),
  };
}

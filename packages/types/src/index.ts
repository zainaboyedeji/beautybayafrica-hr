/** Calendar dates travel as "YYYY-MM-DD" text, so no time zone can move them. */
export type Day = string;

/** A payroll month, as "YYYY-MM". */
export type Period = string;

export interface Department {
  id: string;
  name: string;
  /** How many current employees are in it. */
  headcount: number;
}

export type EmploymentType = "full_time" | "part_time" | "contract" | "intern";

/**
 * PAYE on an employee's pay: none, a fixed monthly amount HR enters, or
 * worked out automatically from the Nigeria Tax Act 2025 bands.
 */
export type PayeMode = "none" | "fixed" | "auto";

export interface Employee {
  id: string;
  /** The company's own staff number, e.g. BBA-014. */
  employeeNo: string;
  name: string;
  email: string;
  phone?: string;
  jobTitle: string;
  departmentId?: string;
  departmentName?: string;
  employmentType: EmploymentType;
  startDate: Day;
  /** Set once they have left; they then drop out of payroll after this day. */
  endDate?: Day;
  /** Monthly basic salary, before allowances and deductions. */
  baseSalary: number;
  /** Total of their fixed monthly allowances (Transport, Housing…). */
  monthlyAllowances: number;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  /** Employee pension as a % of basic + allowances; 0 for none. */
  pensionPercent: number;
  /** How PAYE is taken; `payeAmount` is the monthly amount when "fixed". */
  paye: PayeMode;
  payeAmount: number;
  /** The company's own pension contribution, on top of pay; 0 for none. */
  employerPensionPercent: number;
  /** True when NHF (2.5% of basic salary) is taken. */
  nhf: boolean;
  /** Set when they have a profile photo; changes whenever it does. */
  photoVersion?: string;
  dateOfBirth?: Day;
  homeAddress?: string;
  /** Who to call in an emergency. */
  emergencyName?: string;
  emergencyRelationship?: string;
  emergencyPhone?: string;
  /** For the PAYE and pension schedules. */
  taxId?: string;
  pensionProvider?: string;
  pensionPin?: string;
  /** Working days of annual leave per calendar year. */
  annualLeaveDays: number;
  /** Annual leave approved for this calendar year, in working days. */
  annualLeaveTaken: number;
  /** True once the admin has given them a password for the staff portal. */
  canLogIn: boolean;
  /** True while they still have HR's temporary password, until they set their own. */
  mustChangePassword: boolean;
  /** Set while deactivated: they can't use the staff portal at all. */
  deactivatedAt?: string;
  /** How many guarantors are on file, and how many HR has verified. */
  guarantors: number;
  verifiedGuarantors: number;
}

export type PayItemKind = "allowance" | "deduction";

/** A fixed monthly addition to or deduction from one employee's pay. */
export interface PayItem {
  id: string;
  kind: PayItemKind;
  /** e.g. Housing, Transport, Staff loan. */
  name: string;
  amount: number;
}

export type LeaveType =
  | "annual"
  | "sick"
  | "unpaid"
  | "maternity"
  | "paternity"
  | "compassionate";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: LeaveType;
  startDate: Day;
  endDate: Day;
  /** Working days (Monday to Friday) the leave covers. */
  days: number;
  reason?: string;
  status: LeaveStatus;
  decisionNote?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface PayLine {
  name: string;
  amount: number;
}

export interface Payslip {
  period: Period;
  employeeId: string;
  /** Copied when the payslip is made, so later edits don't change it. */
  employeeNo: string;
  employeeName: string;
  jobTitle: string;
  departmentName?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  /** Monday-to-Friday days in the month. */
  workingDays: number;
  /** Working days paid for: employed, less unpaid leave. */
  daysPaid: number;
  earnings: PayLine[];
  deductions: PayLine[];
  /** One-off extras the admin added to this month only. */
  bonus: number;
  otherDeduction: number;
  note?: string;
  gross: number;
  totalDeductions: number;
  net: number;
  /** The company's pension contribution, paid on top of `net`. */
  employerPension: number;
  taxId?: string;
  pensionProvider?: string;
  pensionPin?: string;
  /** When HR confirmed the salary transfer; employees see it from then. */
  paidAt?: string;
  /** The transfer reference: the bank's, or one the app made up. */
  paymentReference?: string;
}

export type PayrollStatus = "draft" | "paid";

export interface PayrollRun {
  period: Period;
  status: PayrollStatus;
  employees: number;
  /** How many of them have been paid so far. */
  paidCount: number;
  gross: number;
  net: number;
  createdAt: string;
  paidAt?: string;
}

export interface PayrollRunDetail extends PayrollRun {
  payslips: Payslip[];
}

export interface Dashboard {
  activeEmployees: number;
  departments: number;
  pendingLeave: number;
  /** Employees on approved leave today. */
  onLeaveToday: { employeeName: string; type: LeaveType; endDate: Day }[];
  /** Monthly basic salaries plus fixed allowances of everyone employed. */
  monthlyPayroll: number;
  lastPaidRun?: PayrollRun;
}

/** What a logged-in employee sees about themselves. */
export interface MyProfile extends Employee {
  annualLeaveLeft: number;
}

/** Someone who vouches for an employee. */
export interface Guarantor {
  id: string;
  employeeId: string;
  name: string;
  /** How they know the employee, e.g. Uncle, Former employer. */
  relationship: string;
  phone: string;
  email?: string;
  address: string;
  occupation?: string;
  workplace?: string;
  addedBy: "admin" | "employee";
  /** When HR checked them; cleared if the employee changes the details. */
  verifiedAt?: string;
  updatedAt: string;
}

/** Someone who can log in to the HR office. */
export interface Admin {
  id: string;
  name: string;
  email: string;
  /** The owner's account, made from ADMIN_EMAIL / ADMIN_PASSWORD on the server. */
  isOwner: boolean;
  deactivatedAt?: string;
  createdAt: string;
}

export type AnnouncementCategory = "general" | "important" | "event" | "celebration";

/** A notice from HR, shown to everyone in the staff portal. */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  /** Pinned notices stay at the top. */
  pinned: boolean;
  /** Set once HR has edited it. */
  updatedAt?: string;
  /** Who posted it, e.g. "Bola (admin)". */
  postedBy: string;
  createdAt: string;
}

export type StaffRequestType =
  | "password_reset"
  | "bank_change"
  | "details_correction"
  | "letter"
  | "other";
export type StaffRequestStatus = "open" | "done" | "declined" | "cancelled";

/** Something an employee has asked HR for. */
export interface StaffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  type: StaffRequestType;
  details?: string;
  status: StaffRequestStatus;
  /** HR's reply, which the employee sees. */
  response?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

/** One change made in the app, in words. */
export interface Activity {
  id: string;
  at: string;
  /** Who did it, e.g. "Amaka (admin)" or "Tunde (staff portal)". */
  actor: string;
  summary: string;
}

export interface PublicHoliday {
  day: Day;
  name: string;
}

/** Staff and admin emails must be on the company's own domain. */
export const COMPANY_EMAIL_DOMAIN = "beautybayafrica.com";

/** True for a well-formed address ending in @beautybayafrica.com. */
export const isCompanyEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+$/.test(email) &&
  email.trim().toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN}`);

/** The reference to put on a salary transfer, e.g. SAL-202610-BBA-001. */
export const salaryReference = (period: Period, employeeNo: string) =>
  `SAL-${period.replace("-", "")}-${employeeNo}`.toUpperCase();

import type {
  EmploymentType,
  LeaveStatus,
  LeaveType,
  StaffRequestStatus,
  StaffRequestType,
} from "@hr/types";

// Today on this computer's calendar, as YYYY-MM-DD.
export const today = () => new Date().toLocaleDateString("en-CA");

export const formatDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** "2026-10" → "October 2026". */
export const formatPeriod = (period: string) =>
  new Date(`${period}-01T00:00:00`).toLocaleDateString("en-NG", {
    month: "long",
    year: "numeric",
  });

export const formatDays = (days: number) => `${days} day${days === 1 ? "" : "s"}`;

export const LEAVE_LABELS: Record<LeaveType, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  unpaid: "Unpaid leave",
  maternity: "Maternity leave",
  paternity: "Paternity leave",
  compassionate: "Compassionate leave",
};

export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
};

export const LEAVE_STATUS_STYLES: Record<LeaveStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-zinc-100 text-zinc-600",
};

/** What each kind of request to HR is called, and what it's for. */
export const REQUEST_TYPES: Record<
  StaffRequestType,
  { label: string; hint: string; needsDetails: boolean }
> = {
  password_reset: {
    label: "New password",
    hint: "Forgotten it, or think someone else knows it? HR gives you a temporary one, then you choose your own.",
    needsDetails: false,
  },
  bank_change: {
    label: "Change my bank account",
    hint: "Give the bank, account number and account name. HR checks it with you before your salary goes there.",
    needsDetails: true,
  },
  details_correction: {
    label: "Correct my details",
    hint: "e.g. your name, job title or start date is wrong.",
    needsDetails: true,
  },
  letter: {
    label: "Letter",
    hint: "e.g. an employment or salary letter for a bank, visa or landlord. Say who it's for.",
    needsDetails: false,
  },
  other: { label: "Something else", hint: "Tell HR what you need.", needsDetails: true },
};

export const REQUEST_STATUS_STYLES: Record<StaffRequestStatus, string> = {
  open: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
  declined: "bg-red-100 text-red-700",
  cancelled: "bg-surface-alt text-muted",
};

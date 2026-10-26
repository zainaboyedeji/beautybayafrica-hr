import type { EmploymentType, LeaveStatus, LeaveType } from "@hr/types";

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

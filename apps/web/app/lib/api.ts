"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Activity,
  Admin,
  Announcement,
  Dashboard,
  Guarantor,
  Department,
  Employee,
  LeaveRequest,
  MyProfile,
  PayItem,
  PayrollRun,
  PayrollRunDetail,
  Payslip,
  PublicHoliday,
} from "@hr/types";
import { getSession, logOut } from "./auth";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

export const money = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: process.env.NEXT_PUBLIC_CURRENCY ?? "NGN",
});

/** Calls the HR API as the logged-in user. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = getSession()?.token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  // The login has expired, or the employee has left or lost portal access.
  if (res.status === 401) {
    logOut();
    throw new Error("Please log in again");
  }
  return res;
}

/**
 * Sends `body` as JSON and returns the parsed answer, throwing the API's
 * error message (or `fallback`) when it fails.
 */
export async function apiSend<T = unknown>(
  path: string,
  method: string,
  body: unknown,
  fallback: string,
): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(answer.error ?? fallback);
  return answer as T;
}

const getJson =
  <T,>(path: string) =>
  async (): Promise<T> => {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error(`${path} request failed`);
    return res.json();
  };

export const fetchDashboard = getJson<Dashboard>("/dashboard");
export const fetchEmployees = getJson<Employee[]>("/employees");
export const fetchDepartments = getJson<Department[]>("/departments");
export const fetchLeave = getJson<LeaveRequest[]>("/leave");
export const fetchPayrollRuns = getJson<PayrollRun[]>("/payroll");
export const fetchMe = getJson<MyProfile>("/me");
export const fetchMyLeave = getJson<LeaveRequest[]>("/leave/mine");
export const fetchMyPayslips = getJson<Payslip[]>("/payslips/mine");
export const fetchAdmins = getJson<Admin[]>("/admins");
export const fetchActivity = getJson<Activity[]>("/activity");
export const fetchHolidays = getJson<PublicHoliday[]>("/holidays");
export const fetchAnnouncements = getJson<Announcement[]>("/announcements");

/** Saves a file from the API (a CSV, a backup) to the user's computer. */
export async function downloadFile(path: string, fileName: string, fallback: string) {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(fallback);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export const fetchPayItems = (employeeId: string) =>
  getJson<PayItem[]>(`/employees/${employeeId}/pay-items`)();

/** Guarantors at `path`: for one employee, or the logged-in employee. */
export const fetchGuarantors = (path: string) => getJson<Guarantor[]>(path)();

export const fetchPayrollRun = (period: string) =>
  getJson<PayrollRunDetail>(`/payroll/${period}`)();

export const describeError = (e: unknown, fallback: string) =>
  e instanceof TypeError
    ? `Cannot reach the HR API at ${API_URL}.`
    : e instanceof Error
      ? e.message
      : fallback;

/**
 * Loads data on mount. `loader` must be stable: a module-level function, or
 * one wrapped in useCallback.
 */
export function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(
    () =>
      loader()
        .then((result) => {
          setData(result);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [loader],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, failed, reload };
}

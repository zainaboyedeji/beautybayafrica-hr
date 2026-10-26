"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

export type Role = "admin" | "employee";
const ROLES: Role[] = ["admin", "employee"];
export type Session = { token: string; role: Role; name: string };

const STORAGE_KEY = "hr-session";

/** Where each kind of user starts. */
export const homeOf = (role: Role) => (role === "admin" ? "/" : "/me");

const readSaved = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const parse = (saved: string | null): Session | null => {
  try {
    const session = saved ? (JSON.parse(saved) as Session) : null;
    return session && ROLES.includes(session.role) ? session : null;
  } catch {
    return null;
  }
};

export const getSession = () => parse(readSaved());

export function saveSession(session: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function logOut() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  // A full reload so no data from the previous user stays in memory.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

/**
 * The logged-in user, or null while checking. Sends anyone not logged in to
 * the login page, and each role away from the other's pages.
 */
export function useSession(allowed: Role[]) {
  const router = useRouter();
  // `undefined` while pre-rendering, before the browser storage can be read.
  const saved = useSyncExternalStore(subscribe, readSaved, () => undefined);
  const session = saved === undefined ? null : parse(saved);
  const permitted = session !== null && allowed.includes(session.role);
  const role = session?.role;

  useEffect(() => {
    if (saved === undefined || permitted) return;
    router.replace(role ? homeOf(role) : "/login");
  }, [saved, permitted, role, router]);

  return permitted ? session : null;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import Icon, { type IconName } from "../components/icons";
import { fetchLeave, useLoad } from "../lib/api";
import { logOut } from "../lib/auth";

// Each section has its own icon tint, so the menu reads at a glance.
const LINKS: { href: string; label: string; icon: IconName; tint: string }[] = [
  { href: "/", label: "Dashboard", icon: "home", tint: "bg-brand-soft text-brand-deep" },
  { href: "/employees", label: "Employees", icon: "users", tint: "bg-violet-100 text-violet-700" },
  { href: "/departments", label: "Departments", icon: "building", tint: "bg-sky-100 text-sky-800" },
  { href: "/leave", label: "Leave", icon: "calendar", tint: "bg-amber-100 text-amber-800" },
  { href: "/payroll", label: "Payroll", icon: "wallet", tint: "bg-emerald-100 text-emerald-800" },
];

export default function Sidebar() {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const leave = useLoad(fetchLeave);
  const { reload } = leave;
  // Check for new leave requests whenever the admin moves to another page.
  useEffect(() => {
    void reload();
  }, [pathname, reload]);
  const pending = leave.data?.filter((l) => l.status === "pending").length ?? 0;

  return (
    <aside className="no-print flex w-64 shrink-0 flex-col rounded-3xl bg-white/85 p-4 shadow-soft ring-1 ring-line backdrop-blur">
      <div className="flex items-center gap-3 px-2 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-11 w-11" />
        <div>
          <p className="font-display text-lg font-semibold leading-tight">Beauty Bay</p>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-deep">
            People &amp; pay
          </p>
        </div>
      </div>
      <nav className="mt-6 flex flex-col gap-1.5">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`group flex items-center gap-3 rounded-2xl px-2.5 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-gradient-to-r from-brand to-brand-hover text-ink shadow-md shadow-brand/30"
                  : "text-muted hover:bg-surface-alt hover:text-ink"
              }`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition group-hover:scale-105 ${
                  active ? "bg-white/40 text-ink" : link.tint
                }`}
              >
                <Icon name={link.icon} className="h-[18px] w-[18px]" />
              </span>
              {link.label}
              {link.href === "/leave" && pending > 0 && (
                <span
                  aria-label={`${pending} waiting`}
                  className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${
                    active ? "bg-white text-brand-deep" : "bg-brand text-ink"
                  }`}
                >
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-2xl bg-gradient-to-br from-brand-soft via-surface-alt to-violet-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brand-deep">
          Logged in as
        </p>
        <p className="mt-0.5 font-semibold">Admin</p>
        <button
          onClick={logOut}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-ink shadow-sm transition hover:text-brand-deep"
        >
          <Icon name="logout" className="h-4 w-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}

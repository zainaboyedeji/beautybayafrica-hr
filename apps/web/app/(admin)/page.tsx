"use client";

import Link from "next/link";
import type { Department } from "@hr/types";
import Avatar, { Person } from "../components/avatar";
import { CARD } from "../components/form-styles";
import Icon, { type IconName } from "../components/icons";
import { fetchDashboard, fetchDepartments, fetchLeave, money, useLoad } from "../lib/api";
import { formatDay, formatDays, formatPeriod, LEAVE_LABELS } from "../lib/format";
import { LoadError, Loading } from "../lib/status";

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function DashboardPage() {
  const dashboard = useLoad(fetchDashboard);
  const departments = useLoad(fetchDepartments);
  const leave = useLoad(fetchLeave);
  const d = dashboard.data;
  const waiting = (leave.data ?? []).filter((l) => l.status === "pending");

  if (dashboard.failed) return <LoadError />;
  if (!d) return <Loading />;

  return (
    <div className="mx-auto max-w-7xl">
      {/* Welcome banner. Text sits on the deep end of the gradient, where white reads well. */}
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-deep via-brand-hover to-brand p-8 text-white shadow-xl shadow-brand/30">
        <div aria-hidden className="absolute -right-10 -top-16 h-64 w-64 animate-float rounded-full bg-white/15" />
        <div aria-hidden className="absolute -bottom-20 right-40 h-48 w-48 animate-float rounded-full bg-violet-300/25 [animation-delay:-3s]" />
        <div className="relative max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em]">
            <Icon name="sun" className="h-4 w-4" />
            {new Date().toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">{greeting()}!</h1>
          <p className="mt-3 text-white/90">
            {d.onLeaveToday.length === 0
              ? "Everyone is in today"
              : `${plural(d.onLeaveToday.length, "person is", "people are")} off today`}
            {d.pendingLeave > 0
              ? `, and ${plural(d.pendingLeave, "leave request is", "leave requests are")} waiting for you.`
              : ", and no leave is waiting for you."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href="/leave"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-brand-deep shadow-md transition hover:-translate-y-0.5"
            >
              <Icon name="calendar" className="h-4 w-4" />
              Review leave
            </Link>
            <Link
              href="/payroll"
              className="inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/40 transition hover:-translate-y-0.5 hover:bg-white/25"
            >
              <Icon name="wallet" className="h-4 w-4" />
              Run payroll
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon="users" tint="bg-violet-100 text-violet-700" label="On the team" value={String(d.activeEmployees)} href="/employees" />
        <Stat icon="building" tint="bg-sky-100 text-sky-800" label="Departments" value={String(d.departments)} href="/departments" />
        <Stat icon="clock" tint="bg-amber-100 text-amber-800" label="Leave waiting" value={String(d.pendingLeave)} href="/leave" highlight={d.pendingLeave > 0} />
        <Stat icon="wallet" tint="bg-emerald-100 text-emerald-800" label="Monthly pay bill" value={money.format(d.monthlyPayroll)} href="/payroll" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className={`${CARD} lg:col-span-2`}>
          <CardTitle icon="clock" tint="bg-amber-100 text-amber-800" title="Waiting for you" />
          {waiting.length === 0 ? (
            <Empty text="All caught up. No leave requests to decide." />
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {waiting.slice(0, 5).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <Person
                    name={l.employeeName}
                    detail={`${LEAVE_LABELS[l.type]} · ${formatDay(l.startDate)} – ${formatDay(l.endDate)}`}
                  />
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    {formatDays(l.days)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {waiting.length > 0 && (
            <Link href="/leave" className="mt-3 inline-block text-sm font-semibold text-brand-deep hover:underline">
              Approve or reject →
            </Link>
          )}
        </section>

        <section className={CARD}>
          <CardTitle icon="sun" tint="bg-brand-soft text-brand-deep" title="Off today" />
          {d.onLeaveToday.length === 0 ? (
            <Empty text="Everyone is in today." />
          ) : (
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              {d.onLeaveToday.map((l, i) => (
                <li key={i} className="flex items-center gap-3">
                  <Avatar name={l.employeeName} />
                  <span>
                    <span className="block font-semibold">{l.employeeName}</span>
                    <span className="block text-muted">
                      {LEAVE_LABELS[l.type]} · back after {formatDay(l.endDate)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${CARD} lg:col-span-2`}>
          <CardTitle icon="building" tint="bg-sky-100 text-sky-800" title="Team by department" />
          {departments.failed ? (
            <LoadError />
          ) : !departments.data ? (
            <Loading />
          ) : departments.data.length === 0 ? (
            <Empty text="Add departments to see how the team is spread." />
          ) : (
            <HeadcountChart departments={departments.data} />
          )}
        </section>

        <section className={`${CARD} bg-gradient-to-br from-white to-emerald-50`}>
          <CardTitle icon="wallet" tint="bg-emerald-100 text-emerald-800" title="Last payroll" />
          {d.lastPaidRun ? (
            <div className="mt-4">
              <p className="text-sm text-muted">{formatPeriod(d.lastPaidRun.period)}</p>
              <p className="mt-1 text-3xl font-semibold">{money.format(d.lastPaidRun.net)}</p>
              <p className="mt-1 text-sm text-muted">
                net paid to {plural(d.lastPaidRun.employees, "person", "people")}
              </p>
            </div>
          ) : (
            <Empty text="No payroll paid yet." />
          )}
          <Link href="/payroll" className="mt-4 inline-block text-sm font-semibold text-brand-deep hover:underline">
            Go to payroll →
          </Link>
        </section>
      </div>
    </div>
  );
}

function Stat({
  icon,
  tint,
  label,
  value,
  href,
  highlight,
}: {
  icon: IconName;
  tint: string;
  label: string;
  value: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-4 rounded-3xl p-5 shadow-soft ring-1 transition hover:-translate-y-1 hover:shadow-lg hover:shadow-brand/20 ${
        highlight ? "bg-gradient-to-br from-brand-soft to-white ring-brand-soft" : "bg-white ring-line"
      }`}
    >
      <span className={`flex h-12 w-12 items-center justify-center rounded-2xl transition group-hover:scale-110 ${tint}`}>
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <span>
        <span className="block text-sm text-muted">{label}</span>
        <span className="block text-2xl font-semibold">{value}</span>
      </span>
    </Link>
  );
}

function CardTitle({ icon, tint, title }: { icon: IconName; tint: string; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-xl font-semibold">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      {title}
    </h2>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="mt-4 rounded-2xl bg-surface-alt px-4 py-6 text-center text-sm text-muted">{text}</p>;
}

/**
 * Employees per department as horizontal bars: one series in the brand
 * colour, value at each bar's tip, the exact figure on hover.
 */
function HeadcountChart({ departments }: { departments: Department[] }) {
  const sorted = [...departments].sort((a, b) => b.headcount - a.headcount);
  const max = Math.max(1, ...sorted.map((d) => d.headcount));
  return (
    <figure className="mt-5">
      <ul className="flex flex-col gap-3" aria-label="Employees per department">
        {sorted.map((d) => (
          <li
            key={d.id}
            className="group grid grid-cols-[8rem_1fr] items-center gap-3 rounded-lg text-sm"
            title={`${d.name}: ${plural(d.headcount, "employee", "employees")}`}
          >
            <span className="truncate text-muted group-hover:text-ink">{d.name}</span>
            <span className="flex items-center gap-2">
              <span
                className="h-5 rounded-r-[4px] bg-brand transition group-hover:bg-brand-hover"
                style={{ width: `${(d.headcount / max) * 85}%`, minWidth: d.headcount ? 4 : 0 }}
              />
              <span className="font-semibold">{d.headcount}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

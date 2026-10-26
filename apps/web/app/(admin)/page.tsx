"use client";

import Link from "next/link";
import { useState } from "react";
import type { Announcement, AnnouncementCategory, Department, Employee } from "@hr/types";
import Avatar, { Person } from "../components/avatar";
import ConfirmDialog from "../components/confirm-dialog";
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../components/form-styles";
import NoticeCard, { NOTICE_TYPES } from "../components/notice-card";
import { Notice } from "../components/notice";
import Icon, { type IconName } from "../components/icons";
import {
  apiSend,
  describeError,
  fetchAnnouncements,
  fetchDashboard,
  fetchDepartments,
  fetchEmployees,
  fetchLeave,
  money,
  useLoad,
} from "../lib/api";
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

        <Birthdays />
        <Noticeboard />
      </div>
    </div>
  );
}

/** HR's notices, which every employee sees on their staff portal home. */
function Noticeboard() {
  const notices = useLoad(fetchAnnouncements);
  const blank = { title: "", body: "", category: "general" as AnnouncementCategory, pinned: false };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [removing, setRemoving] = useState<Announcement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>, fallback: string, done: string) => {
    setSaving(true);
    setError(null);
    try {
      await work();
      await notices.reload();
      setNotice(done);
      return true;
    } catch (e) {
      setError(describeError(e, fallback));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setEditing(null);
    setForm(blank);
  };
  const submit = async () => {
    const ok = editing
      ? await run(
          () => apiSend(`/announcements/${editing.id}`, "PUT", form, "Could not save"),
          "Could not save",
          "Notice updated.",
        )
      : await run(
          () => apiSend("/announcements", "POST", form, "Could not post"),
          "Could not post",
          "Notice posted. Staff see it on their portal home.",
        );
    if (ok) reset();
  };
  const togglePin = (n: Announcement) =>
    run(
      () => apiSend(`/announcements/${n.id}`, "PUT", { ...n, pinned: !n.pinned }, "Could not save"),
      "Could not save",
      n.pinned ? "Notice unpinned." : "Notice pinned to the top.",
    );

  return (
    <section className={`${CARD} lg:col-span-3`}>
      {removing && (
        <ConfirmDialog
          title="Take down notice"
          message={`Take down "${removing.title}"? Staff will no longer see it.`}
          confirmLabel="Take down"
          danger
          onConfirm={async () => {
            const n = removing;
            setRemoving(null);
            if (editing?.id === n.id) reset();
            await run(
              () => apiSend(`/announcements/${n.id}`, "DELETE", undefined, "Could not take it down"),
              "Could not take it down",
              "Notice taken down.",
            );
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <CardTitle icon="megaphone" tint="bg-brand-soft text-brand-deep" title="Noticeboard" />
          <p className="mt-1 text-sm text-muted">
            Everyone sees these on their staff portal home. Pinned notices stay at the top.
          </p>
        </div>
        {notices.data && (
          <span className="rounded-full bg-surface-alt px-3 py-1 text-xs font-semibold text-muted">
            {notices.data.length} live · {notices.data.filter((n) => n.pinned).length} pinned
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <form
          className="flex flex-col gap-3 rounded-3xl bg-surface-alt/70 p-5 ring-1 ring-line"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm font-semibold">{editing ? "Edit notice" : "New notice"}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type of notice">
            {(Object.keys(NOTICE_TYPES) as AnnouncementCategory[]).map((c) => {
              const type = NOTICE_TYPES[c];
              const on = form.category === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setForm({ ...form, category: c })}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition ${
                    on ? `${type.tint} ring-transparent shadow-sm` : "bg-white text-muted ring-line hover:text-ink"
                  }`}
                >
                  <Icon name={type.icon} className="h-4 w-4" />
                  {type.label}
                </button>
              );
            })}
          </div>
          <input
            required
            maxLength={120}
            placeholder="Title, e.g. Office closed on Friday"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={INPUT}
          />
          <div>
            <textarea
              required
              rows={5}
              maxLength={2000}
              placeholder="The message for all staff"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className={INPUT}
            />
            <p className="mt-1 text-right text-xs text-muted">{form.body.length} / 2000</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
              className="h-4 w-4 accent-brand-deep"
            />
            <Icon name="pin" className="h-4 w-4 text-brand-deep" />
            Pin to the top
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            {editing && (
              <button type="button" onClick={reset} className={SECONDARY_BUTTON}>
                Cancel
              </button>
            )}
            <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
              <Icon name="megaphone" className="h-4 w-4" />
              {saving ? "Saving…" : editing ? "Save changes" : "Post notice"}
            </button>
          </div>
        </form>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
            Preview: how staff will see it
          </p>
          <NoticeCard
            notice={{
              ...form,
              title: form.title || "Your title",
              body: form.body || "Your message shows here as you type.",
              postedBy: editing?.postedBy ?? "You",
              createdAt: editing?.createdAt ?? new Date().toISOString(),
              ...(editing ? { updatedAt: new Date().toISOString() } : {}),
            }}
          />
        </div>
      </div>

      <Notice text={notice} />
      <div className="mt-6">
        <p className="mb-3 text-sm font-semibold">On the board</p>
        {notices.failed ? (
          <LoadError />
        ) : !notices.data ? (
          <Loading />
        ) : notices.data.length === 0 ? (
          <Empty text="No notices yet. Post the first one above." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {notices.data.map((n) => (
              <NoticeCard
                key={n.id}
                notice={n}
                actions={
                  <>
                    <button
                      disabled={saving}
                      onClick={() => {
                        setEditing(n);
                        setForm({ title: n.title, body: n.body, category: n.category, pinned: n.pinned });
                        setNotice(null);
                      }}
                      className="font-semibold text-brand-deep hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => void togglePin(n)}
                      className="font-semibold text-brand-deep hover:underline"
                    >
                      {n.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => setRemoving(n)}
                      className="font-semibold text-red-700 hover:underline"
                    >
                      Take down
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Birthdays this month, from the dates of birth staff and HR have entered. */
function Birthdays() {
  const employees = useLoad(fetchEmployees);
  const month = new Date().getMonth() + 1;
  const todayDay = new Date().getDate();
  const current = (e: Employee) => !e.endDate || e.endDate >= new Date().toLocaleDateString("en-CA");
  const birthdays = (employees.data ?? [])
    .filter((e) => current(e) && e.dateOfBirth && Number(e.dateOfBirth.slice(5, 7)) === month)
    .sort((a, b) => a.dateOfBirth!.slice(8).localeCompare(b.dateOfBirth!.slice(8)));

  return (
    <section className={`${CARD} bg-gradient-to-br from-white to-rose-50 lg:col-span-3`}>
      <CardTitle icon="sparkle" tint="bg-rose-100 text-rose-700" title="Birthdays this month" />
      {employees.failed ? (
        <LoadError />
      ) : !employees.data ? (
        <Loading />
      ) : birthdays.length === 0 ? (
        <Empty text="No birthdays this month (or no dates of birth entered yet)." />
      ) : (
        <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {birthdays.map((e) => {
            const day = Number(e.dateOfBirth!.slice(8));
            return (
              <li key={e.id} className="flex items-center gap-3">
                <Avatar name={e.name} employeeId={e.id} photoVersion={e.photoVersion} />
                <span className="flex-1">
                  <span className="block font-semibold">{e.name}</span>
                  <span className="block text-muted">
                    {new Date(2000, month - 1, day).toLocaleDateString("en-NG", { day: "numeric", month: "long" })}
                  </span>
                </span>
                {day === todayDay && (
                  <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                    Today!
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

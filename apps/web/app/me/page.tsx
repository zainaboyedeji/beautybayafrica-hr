"use client";

import { useState, type ReactNode } from "react";
import type {
  Announcement,
  LeaveRequest,
  MyProfile,
  Payslip,
  StaffRequest,
  StaffRequestType,
} from "@hr/types";
import Avatar from "../components/avatar";
import ConfirmDialog from "../components/confirm-dialog";
import Guarantors from "../components/guarantors";
import {
  CARD,
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TABLE,
  TABLE_CARD,
  TBODY,
  THEAD,
} from "../components/form-styles";
import Icon, { type IconName } from "../components/icons";
import LeaveForm from "../components/leave-form";
import Modal from "../components/modal";
import { Notice } from "../components/notice";
import NoticeCard, { timeAgo } from "../components/notice-card";
import PayslipView, { printPayslip } from "../components/payslip-view";
import PasswordInput from "../components/password-input";
import PhotoPicker from "../components/photo-picker";
import StatusBadge from "../components/status-badge";
import {
  apiSend,
  describeError,
  fetchAnnouncements,
  fetchHolidays,
  fetchMe,
  fetchMyLeave,
  fetchMyPayslips,
  fetchMyRequests,
  money,
  useLoad,
} from "../lib/api";
import { logOut, saveSession, type Session } from "../lib/auth";
import {
  EMPLOYMENT_LABELS,
  formatDay,
  formatDays,
  formatPeriod,
  LEAVE_LABELS,
  REQUEST_STATUS_STYLES,
  REQUEST_TYPES,
  today,
} from "../lib/format";
import { LoadError, Loading } from "../lib/status";

type Tab = "home" | "leave" | "pay" | "requests" | "profile";
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "leave", label: "Leave", icon: "calendar" },
  { key: "pay", label: "Payslips", icon: "wallet" },
  { key: "requests", label: "Requests", icon: "inbox" },
  { key: "profile", label: "My profile", icon: "user" },
];

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
};

/** Whole days from today to `day`. */
const daysUntil = (day: string) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000);

const deductionOf = (p: Payslip, prefix: string) =>
  p.deductions.find((d) => d.name.startsWith(prefix))?.amount ?? 0;

export default function MyPortalPage() {
  const me = useLoad(fetchMe);
  const leave = useLoad(fetchMyLeave);
  const payslips = useLoad(fetchMyPayslips);
  const holidays = useLoad(fetchHolidays);
  const notices = useLoad(fetchAnnouncements);
  const requests = useLoad(fetchMyRequests);
  const [tab, setTab] = useState<Tab>("home");
  // A request type to open straight away, e.g. from "Ask for a new password".
  const [startRequest, setStartRequest] = useState<StaffRequestType | null>(null);
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [viewing, setViewing] = useState<Payslip | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (request: LeaveRequest) => {
    setCancelling(null);
    setError(null);
    try {
      await apiSend(`/leave/${request.id}/cancel`, "PUT", {}, "Could not cancel request");
      setNotice("Leave request cancelled.");
      await Promise.all([leave.reload(), me.reload()]);
    } catch (e) {
      setError(describeError(e, "Could not cancel request"));
    }
  };

  const profile = me.data;
  const day = today();
  const upcomingHolidays = (holidays.data ?? []).filter((h) => h.day >= day);
  const upcomingLeave = (leave.data ?? [])
    .filter((l) => l.endDate >= day && (l.status === "approved" || l.status === "pending"))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const thisYear = (payslips.data ?? []).filter((p) => p.period.startsWith(day.slice(0, 4)));
  const sum = (pick: (p: Payslip) => number) => thisYear.reduce((s, p) => s + pick(p), 0);

  return (
    <div className="min-h-screen text-ink">
      <header className="no-print sticky top-0 z-10 px-4 pt-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between rounded-full bg-white/85 py-2 pl-3 pr-2 shadow-soft ring-1 ring-line backdrop-blur">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-9 w-9" />
            <span className="font-display text-lg font-semibold">Staff portal</span>
          </div>
          <div className="flex items-center gap-1 text-sm font-semibold">
            {profile && (
              <button
                onClick={() => setTab("profile")}
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition hover:bg-surface-alt"
              >
                <Avatar
                  name={profile.name}
                  size="sm"
                  employeeId={profile.id}
                  photoVersion={profile.photoVersion}
                />
                <span className="hidden sm:inline">{profile.name.split(" ")[0]}</span>
              </button>
            )}
            <button
              onClick={logOut}
              className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-muted transition hover:bg-surface-alt hover:text-ink"
            >
              <Icon name="logout" className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl animate-fade-up p-4 sm:p-6">
        {me.failed ? (
          <LoadError />
        ) : !profile ? (
          <Loading />
        ) : profile.mustChangePassword ? (
          <ChooseOwnPassword name={profile.name} />
        ) : (
          <>
            {/* Text sits on the deep end of the gradient, where white reads well. */}
            <section className="relative mt-2 overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-deep via-brand-hover to-brand p-6 text-white shadow-xl shadow-brand/30 sm:p-8">
              <div aria-hidden className="absolute -right-12 -top-16 h-60 w-60 animate-float rounded-full bg-white/15" />
              <div aria-hidden className="absolute -bottom-24 right-32 h-48 w-48 animate-float rounded-full bg-violet-300/25 [animation-delay:-3s]" />
              <div className="relative flex flex-wrap items-center gap-5">
                <PhotoPicker
                  light
                  employee={profile}
                  path="/me/photo"
                  onChanged={() => {
                    setNotice("Photo saved.");
                    void me.reload();
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white/85">{greeting()},</p>
                  <h1 className="text-4xl font-semibold">{profile.name.split(" ")[0]}!</h1>
                  <p className="mt-1 text-white/90">
                    {profile.jobTitle}
                    {profile.departmentName && ` · ${profile.departmentName}`} · {profile.employeeNo}
                  </p>
                </div>
                <button
                  onClick={() => setAsking(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-brand-deep shadow-md transition hover:-translate-y-0.5"
                >
                  <Icon name="plus" className="h-4 w-4" />
                  Ask for leave
                </button>
              </div>
            </section>

            <nav
              role="tablist"
              aria-label="Sections"
              className="no-print mt-5 grid grid-cols-5 gap-1 rounded-full bg-white/85 p-1 text-sm font-semibold shadow-soft ring-1 ring-line"
            >
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setStartRequest(null);
                  }}
                  className={`flex items-center justify-center gap-2 rounded-full py-2.5 transition ${
                    tab === t.key
                      ? "bg-gradient-to-r from-brand to-brand-hover text-ink shadow-md shadow-brand/30"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon name={t.icon} className="h-4 w-4" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </nav>
            <Notice text={notice} />
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

            {tab === "home" && (
              <HomeTab
                profile={profile}
                latest={payslips.data?.[0]}
                earnedThisYear={sum((p) => p.net)}
                nextHoliday={upcomingHolidays[0]}
                upcomingLeave={upcomingLeave.slice(0, 3)}
                notices={notices}
                onViewPayslip={setViewing}
                onGo={setTab}
              />
            )}
            {tab === "leave" && (
              <LeaveTab
                profile={profile}
                leave={leave}
                holidays={upcomingHolidays}
                onAsk={() => setAsking(true)}
                onCancel={setCancelling}
              />
            )}
            {tab === "pay" && (
              <PayTab
                payslips={payslips}
                totals={{
                  gross: sum((p) => p.gross),
                  paye: sum((p) => deductionOf(p, "PAYE")),
                  pension: sum((p) => deductionOf(p, "Pension")),
                  net: sum((p) => p.net),
                  count: thisYear.length,
                }}
                onView={setViewing}
              />
            )}
            {tab === "profile" && (
              <ProfileTab
                profile={profile}
                onEdit={() => setEditing(true)}
                onAskPassword={() => {
                  setStartRequest("password_reset");
                  setTab("requests");
                }}
              />
            )}
            {tab === "requests" && (
              <RequestsTab
                key={startRequest ?? "none"}
                requests={requests}
                startWith={startRequest}
                onChanged={(message) => {
                  setStartRequest(null);
                  setNotice(message);
                }}
              />
            )}
          </>
        )}

        {asking && (
          <Modal title="Ask for leave" onClose={() => setAsking(false)}>
            <LeaveForm
              onCancel={() => setAsking(false)}
              onSaved={() => {
                setAsking(false);
                setTab("leave");
                setNotice("Leave request sent. You'll see the decision here.");
                void leave.reload();
              }}
            />
          </Modal>
        )}
        {cancelling && (
          <ConfirmDialog
            title="Cancel request"
            message={`Cancel your request for ${LEAVE_LABELS[cancelling.type].toLowerCase()} from ${formatDay(cancelling.startDate)}?`}
            confirmLabel="Cancel request"
            danger
            onConfirm={() => cancel(cancelling)}
            onClose={() => setCancelling(null)}
          />
        )}
        {viewing && (
          <Modal wide title="Payslip" onClose={() => setViewing(null)}>
            <PayslipView payslip={viewing} />
            <div className="no-print mt-5 flex justify-end">
              <button onClick={() => printPayslip(viewing)} className={SECONDARY_BUTTON}>
                <Icon name="printer" className="h-4 w-4" />
                Print or save as PDF
              </button>
            </div>
          </Modal>
        )}
        {editing && profile && (
          <Modal title="My details" onClose={() => setEditing(false)}>
            <DetailsForm
              profile={profile}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                setNotice("Your details are saved.");
                void me.reload();
              }}
            />
          </Modal>
        )}
      </main>
    </div>
  );
}

type Loaded<T> = { data: T | null; failed: boolean };

// --- Home -------------------------------------------------------------------

function HomeTab({
  profile,
  latest,
  earnedThisYear,
  nextHoliday,
  upcomingLeave,
  notices,
  onViewPayslip,
  onGo,
}: {
  profile: MyProfile;
  latest?: Payslip;
  earnedThisYear: number;
  nextHoliday?: { day: string; name: string };
  upcomingLeave: LeaveRequest[];
  notices: Loaded<Announcement[]>;
  onViewPayslip: (p: Payslip) => void;
  onGo: (tab: Tab) => void;
}) {
  const missing = [
    !profile.photoVersion && "a photo",
    !profile.phone && "your phone number",
    !profile.emergencyName && "an emergency contact",
    profile.guarantors === 0 && "a guarantor",
  ].filter(Boolean) as string[];
  const holidayIn = nextHoliday ? daysUntil(nextHoliday.day) : 0;

  return (
    <div className="mt-6 flex flex-col gap-6">
      {missing.length > 0 && (
        <button
          onClick={() => onGo("profile")}
          className="flex items-center gap-4 rounded-3xl bg-amber-50 p-4 text-left text-sm ring-1 ring-amber-200 transition hover:-translate-y-0.5"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
            <Icon name="sparkle" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold text-amber-900">Finish your profile</span>
            <span className="block text-amber-800">
              Add {missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}` : missing[0]}.
            </span>
          </span>
          <span className="font-semibold text-amber-900">Go →</span>
        </button>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={CARD}>
          <Heading icon="calendar" tint="bg-amber-100 text-amber-800" title="Leave left" small />
          <p className="mt-3 text-3xl font-semibold">
            {profile.annualLeaveLeft}
            <span className="text-base font-normal text-muted"> of {profile.annualLeaveDays}</span>
          </p>
          <div aria-hidden className="mt-3 h-2 overflow-hidden rounded-full bg-brand-soft/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-brand-hover"
              style={{
                width: `${profile.annualLeaveDays ? Math.max(0, (profile.annualLeaveLeft / profile.annualLeaveDays) * 100) : 0}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">{formatDays(profile.annualLeaveTaken)} used this year</p>
        </div>
        <button
          disabled={!latest}
          onClick={() => latest && onViewPayslip(latest)}
          className={`${CARD} bg-gradient-to-br from-white to-emerald-50 text-left transition enabled:hover:-translate-y-0.5`}
        >
          <Heading icon="wallet" tint="bg-emerald-100 text-emerald-800" title="Latest pay" small />
          <p className="mt-3 text-3xl font-semibold">{latest ? money.format(latest.net) : "—"}</p>
          <p className="mt-2 text-xs text-muted">
            {latest ? `${formatPeriod(latest.period)} · tap to view` : "No payslips yet"}
          </p>
        </button>
        <div className={CARD}>
          <Heading icon="sparkle" tint="bg-violet-100 text-violet-700" title="Earned this year" small />
          <p className="mt-3 text-3xl font-semibold">{money.format(earnedThisYear)}</p>
          <p className="mt-2 text-xs text-muted">Net pay, {today().slice(0, 4)}</p>
        </div>
        <div className={CARD}>
          <Heading icon="sun" tint="bg-sky-100 text-sky-800" title="Next holiday" small />
          {nextHoliday ? (
            <>
              <p className="mt-3 text-xl font-semibold leading-tight">{nextHoliday.name}</p>
              <p className="mt-2 text-xs text-muted">
                {formatDay(nextHoliday.day)} ·{" "}
                {holidayIn === 0 ? "today" : holidayIn === 1 ? "tomorrow" : `in ${holidayIn} days`}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">None listed yet</p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <Heading icon="megaphone" tint="bg-brand-soft text-brand-deep" title="From HR" />
          <div className="mt-4 flex flex-col gap-3">
            {notices.failed ? (
              <LoadError />
            ) : !notices.data ? (
              <Loading />
            ) : notices.data.length === 0 ? (
              <p className={`${CARD} text-sm text-muted`}>No notices from HR right now.</p>
            ) : (
              notices.data.map((n) => <NoticeCard key={n.id} notice={n} />)
            )}
          </div>
        </section>
        <section>
          <Heading icon="calendar" tint="bg-amber-100 text-amber-800" title="Coming up" />
          <div className={`${CARD} mt-4`}>
            {upcomingLeave.length === 0 ? (
              <p className="text-sm text-muted">No leave booked. Enjoy the work!</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {upcomingLeave.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-medium">{LEAVE_LABELS[l.type]}</span>
                      <span className="block text-muted">
                        {formatDay(l.startDate)} – {formatDay(l.endDate)} · {formatDays(l.days)}
                      </span>
                    </span>
                    <StatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => onGo("leave")}
              className="mt-4 text-sm font-semibold text-brand-deep hover:underline"
            >
              All my leave →
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

// --- Leave ------------------------------------------------------------------

function LeaveTab({
  profile,
  leave,
  holidays,
  onAsk,
  onCancel,
}: {
  profile: MyProfile;
  leave: Loaded<LeaveRequest[]>;
  holidays: { day: string; name: string }[];
  onAsk: () => void;
  onCancel: (l: LeaveRequest) => void;
}) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading icon="calendar" tint="bg-amber-100 text-amber-800" title="My leave" />
          <button onClick={onAsk} className={PRIMARY_BUTTON}>
            <Icon name="plus" className="h-4 w-4" />
            Ask for leave
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          {profile.annualLeaveLeft} of {profile.annualLeaveDays} days of annual leave left this
          year. Weekends and public holidays don&apos;t count.
        </p>
        <div className="mt-4">
          {leave.failed ? (
            <LoadError />
          ) : !leave.data ? (
            <Loading />
          ) : leave.data.length === 0 ? (
            <p className="text-sm text-muted">You haven&apos;t asked for leave yet.</p>
          ) : (
            <div className={TABLE_CARD}>
              <table className={TABLE}>
                <thead className={THEAD}>
                  <tr>
                    <th className="px-5 py-3.5">Leave</th>
                    <th className="px-5 py-3.5">Dates</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody className={TBODY}>
                  {leave.data.map((l) => (
                    <tr key={l.id} className="align-top">
                      <td className="px-5 py-4">
                        {LEAVE_LABELS[l.type]}
                        {l.reason && <p className="text-muted">{l.reason}</p>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        {formatDay(l.startDate)} – {formatDay(l.endDate)}
                        <p className="text-muted">{formatDays(l.days)}</p>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={l.status} />
                        {l.decisionNote && <p className="mt-1 text-muted">{l.decisionNote}</p>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {l.status === "pending" && (
                          <button
                            onClick={() => onCancel(l)}
                            className="font-medium text-red-700 hover:underline"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      <aside>
        <Heading icon="sun" tint="bg-sky-100 text-sky-800" title="Public holidays" />
        <div className={`${CARD} mt-4`}>
          {holidays.length === 0 ? (
            <p className="text-sm text-muted">None listed yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5 text-sm">
              {holidays.slice(0, 8).map((h) => (
                <li key={h.day} className="flex justify-between gap-3">
                  <span className="font-medium">{h.name}</span>
                  <span className="whitespace-nowrap text-muted">{formatDay(h.day)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

// --- Payslips ---------------------------------------------------------------

function PayTab({
  payslips,
  totals,
  onView,
}: {
  payslips: Loaded<Payslip[]>;
  totals: { gross: number; paye: number; pension: number; net: number; count: number };
  onView: (p: Payslip) => void;
}) {
  const year = today().slice(0, 4);
  return (
    <div className="mt-6 flex flex-col gap-6">
      {totals.count > 0 && (
        <section className={CARD}>
          <Heading icon="sparkle" tint="bg-violet-100 text-violet-700" title={`${year} so far`} small />
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Gross pay" value={money.format(totals.gross)} />
            <Figure label="PAYE tax" value={money.format(totals.paye)} />
            <Figure label="Pension" value={money.format(totals.pension)} />
            <Figure label="Net pay" value={money.format(totals.net)} strong />
          </dl>
          <p className="mt-3 text-xs text-muted">
            From {totals.count} payslip{totals.count === 1 ? "" : "s"} this year.
          </p>
        </section>
      )}
      <section>
        <Heading icon="wallet" tint="bg-emerald-100 text-emerald-800" title="My payslips" />
        <div className="mt-4">
          {payslips.failed ? (
            <LoadError />
          ) : !payslips.data ? (
            <Loading />
          ) : payslips.data.length === 0 ? (
            <p className="text-sm text-muted">
              Your payslips show here once each month&apos;s salary is paid.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {payslips.data.map((p) => (
                <li key={p.period}>
                  <button
                    onClick={() => onView(p)}
                    className="group flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-left text-sm shadow-soft ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-brand-soft"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
                      <Icon name="wallet" />
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold">{formatPeriod(p.period)}</span>
                      <span className="block text-muted">
                        {money.format(p.net)} net · {money.format(p.gross)} gross
                      </span>
                    </span>
                    <span className="font-semibold text-brand-deep group-hover:underline">View →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 ${strong ? "text-2xl font-semibold text-brand-deep" : "text-lg font-semibold"}`}>
        {value}
      </dd>
    </div>
  );
}

// --- Profile ----------------------------------------------------------------

/** "••••6789": enough to recognise the account, not enough to misuse it. */
const masked = (account?: string) => (account ? `••••${account.slice(-4)}` : "Not given");

function ProfileTab({
  profile,
  onEdit,
  onAskPassword,
}: {
  profile: MyProfile;
  onEdit: () => void;
  onAskPassword: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={CARD}>
          <div className="flex items-center justify-between gap-3">
            <Heading icon="user" tint="bg-brand-soft text-brand-deep" title="My details" small />
            <button onClick={onEdit} className={SECONDARY_BUTTON}>
              <Icon name="pencil" className="h-4 w-4" />
              Edit
            </button>
          </div>
          <dl className="mt-4 divide-y divide-line text-sm">
            <Row label="Work email" value={profile.email} />
            <Row label="Phone" value={profile.phone} />
            <Row label="Date of birth" value={profile.dateOfBirth && formatDay(profile.dateOfBirth)} />
            <Row label="Home address" value={profile.homeAddress} />
            <Row
              label="Emergency contact"
              value={
                profile.emergencyName &&
                [
                  profile.emergencyName,
                  profile.emergencyRelationship && `(${profile.emergencyRelationship})`,
                  profile.emergencyPhone && `· ${profile.emergencyPhone}`,
                ]
                  .filter(Boolean)
                  .join(" ")
              }
            />
          </dl>
        </section>
        <section className={CARD}>
          <Heading icon="building" tint="bg-sky-100 text-sky-800" title="My job" small />
          <dl className="mt-4 divide-y divide-line text-sm">
            <Row label="Staff number" value={profile.employeeNo} />
            <Row label="Job" value={profile.jobTitle} />
            <Row label="Department" value={profile.departmentName} />
            <Row label="Employment" value={EMPLOYMENT_LABELS[profile.employmentType]} />
            <Row label="Started" value={formatDay(profile.startDate)} />
            <Row
              label="Salary paid to"
              value={`${profile.bankName ?? "Bank not given"} ${masked(profile.bankAccountNumber)}`}
            />
          </dl>
          <p className="mt-3 text-xs text-muted">
            To change your job details or bank account, send HR a request (Requests tab). Bank
            changes are only made by HR, to keep your salary safe.
          </p>
        </section>
      </div>

      <section>
        <Heading icon="users" tint="bg-violet-100 text-violet-700" title="My guarantors" />
        <p className="mt-1 text-sm text-muted">
          People who can vouch for you. HR checks each one and marks them verified.
        </p>
        <div className="mt-4">
          <Guarantors path="/me/guarantors" isAdmin={false} />
        </div>
      </section>

      <section className={`${CARD} flex items-start gap-3`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
          <Icon name="key" className="h-[18px] w-[18px]" />
        </span>
        <div className="flex-1">
          <p className="font-semibold">Your password</p>
          <p className="mt-1 text-sm text-muted">
            To change it, ask HR for a new one: they give you a temporary password, then you
            choose your own when you next log in.
          </p>
        </div>
        <button onClick={onAskPassword} className={SECONDARY_BUTTON}>
          Ask for a new password
        </button>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right font-medium ${value ? "" : "font-normal text-muted"}`}>
        {value || "Not given"}
      </dd>
    </div>
  );
}

function DetailsForm({
  profile,
  onSaved,
  onCancel,
}: {
  profile: MyProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    phone: profile.phone ?? "",
    dateOfBirth: profile.dateOfBirth ?? "",
    homeAddress: profile.homeAddress ?? "",
    emergencyName: profile.emergencyName ?? "",
    emergencyRelationship: profile.emergencyRelationship ?? "",
    emergencyPhone: profile.emergencyPhone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
    className: INPUT,
  });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend("/me/details", "PUT", form, "Could not save your details");
      onSaved();
    } catch (e) {
      setError(describeError(e, "Could not save your details"));
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Phone
          <input autoFocus type="tel" {...field("phone")} />
        </label>
        <label className="text-sm font-medium">
          Date of birth
          <input type="date" max={today()} {...field("dateOfBirth")} />
        </label>
      </div>
      <label className="text-sm font-medium">
        Home address
        <textarea rows={2} {...field("homeAddress")} />
      </label>
      <p className="mt-2 text-sm font-semibold">
        Emergency contact <span className="font-normal text-muted">(who HR calls if something happens)</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Name
          <input {...field("emergencyName")} />
        </label>
        <label className="text-sm font-medium">
          Relationship
          <input placeholder="e.g. Sister" {...field("emergencyRelationship")} />
        </label>
        <label className="text-sm font-medium">
          Phone
          <input type="tel" {...field("emergencyPhone")} />
        </label>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : "Save details"}
        </button>
      </div>
    </form>
  );
}

function Heading({
  icon,
  tint,
  title,
  small,
}: {
  icon: IconName;
  tint: string;
  title: string;
  small?: boolean;
}) {
  return (
    <h2 className={`flex items-center gap-3 font-semibold ${small ? "text-base" : "text-xl"}`}>
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      {title}
    </h2>
  );
}

// --- Requests ---------------------------------------------------------------

function RequestsTab({
  requests,
  startWith,
  onChanged,
}: {
  requests: Loaded<StaffRequest[]> & { reload: () => Promise<void> };
  startWith: StaffRequestType | null;
  onChanged: (message: string) => void;
}) {
  const [asking, setAsking] = useState<StaffRequestType | null>(startWith);
  const [withdrawing, setWithdrawing] = useState<StaffRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const withdraw = async (r: StaffRequest) => {
    setWithdrawing(null);
    setError(null);
    try {
      await apiSend(`/requests/${r.id}/cancel`, "PUT", {}, "Could not withdraw it");
      onChanged("Request withdrawn.");
      await requests.reload();
    } catch (e) {
      setError(describeError(e, "Could not withdraw it"));
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-6">
      {asking && (
        <Modal title="Ask HR" onClose={() => setAsking(null)}>
          <RequestForm
            type={asking}
            onCancel={() => setAsking(null)}
            onSaved={() => {
              setAsking(null);
              onChanged("Request sent to HR. You'll see their reply here.");
              void requests.reload();
            }}
          />
        </Modal>
      )}
      {withdrawing && (
        <ConfirmDialog
          title="Withdraw request"
          message={`Withdraw your request for ${REQUEST_TYPES[withdrawing.type].label.toLowerCase()}?`}
          confirmLabel="Withdraw"
          danger
          onConfirm={() => withdraw(withdrawing)}
          onClose={() => setWithdrawing(null)}
        />
      )}

      <section>
        <Heading icon="inbox" tint="bg-brand-soft text-brand-deep" title="Ask HR" />
        <p className="mt-1 text-sm text-muted">Pick what you need. HR replies here.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(REQUEST_TYPES) as StaffRequestType[]).map((t) => (
            <button
              key={t}
              onClick={() => setAsking(t)}
              className="group flex flex-col items-start gap-1 rounded-3xl bg-white p-4 text-left shadow-soft ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-brand-soft"
            >
              <span className="font-semibold">{REQUEST_TYPES[t].label}</span>
              <span className="text-xs text-muted">{REQUEST_TYPES[t].hint}</span>
              <span className="mt-1 text-sm font-semibold text-brand-deep group-hover:underline">
                Ask →
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <Heading icon="clock" tint="bg-amber-100 text-amber-800" title="My requests" />
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-4">
          {requests.failed ? (
            <LoadError />
          ) : !requests.data ? (
            <Loading />
          ) : requests.data.length === 0 ? (
            <p className="text-sm text-muted">You haven&apos;t asked HR for anything yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {requests.data.map((r) => (
                <li key={r.id} className={`${CARD} text-sm`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{REQUEST_TYPES[r.type].label}</p>
                      <p className="text-xs text-muted">Sent {timeAgo(r.createdAt)}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${REQUEST_STATUS_STYLES[r.status]}`}
                    >
                      {r.status === "open" ? "Waiting for HR" : r.status}
                    </span>
                  </div>
                  {r.details && <p className="mt-2 whitespace-pre-line">{r.details}</p>}
                  {r.response && (
                    <p className="mt-3 rounded-2xl bg-surface-alt px-4 py-3">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                        HR replied {r.resolvedAt && timeAgo(r.resolvedAt)}
                      </span>
                      <span className="mt-1 block whitespace-pre-line">{r.response}</span>
                    </p>
                  )}
                  {r.status === "open" && (
                    <button
                      onClick={() => setWithdrawing(r)}
                      className="mt-3 font-medium text-red-700 hover:underline"
                    >
                      Withdraw
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function RequestForm({
  type,
  onSaved,
  onCancel,
}: {
  type: StaffRequestType;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const info = REQUEST_TYPES[type];
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend("/requests", "POST", { type, details }, "Could not send the request");
      onSaved();
    } catch (e) {
      setError(describeError(e, "Could not send the request"));
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="font-semibold">{info.label}</p>
      <p className="text-sm text-muted">{info.hint}</p>
      <label className="text-sm font-medium">
        Details {!info.needsDetails && <span className="font-normal text-muted">(optional)</span>}
        <textarea
          autoFocus
          required={info.needsDetails}
          rows={4}
          maxLength={2000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          className={INPUT}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Sending…" : "Send to HR"}
        </button>
      </div>
    </form>
  );
}

// --- First login: choose your own password ----------------------------------

/**
 * Shown instead of the portal while someone is on HR's temporary password:
 * they choose their own before they can do anything else.
 */
function ChooseOwnPassword({ name }: { name: string }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (form.newPassword !== form.repeat) {
      setError("The new passwords don't match");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      saveSession(
        await apiSend<Session>("/me/password", "PUT", form, "Could not save your password"),
      );
      // Load the whole portal afresh, now that it is open to them.
      window.location.reload();
    } catch (e) {
      setError(describeError(e, "Could not save your password"));
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, hint?: string, autoComplete = "new-password") => (
    <label className="text-sm font-medium">
      {label} {hint && <span className="font-normal text-muted">{hint}</span>}
      <PasswordInput
        required
        minLength={key === "currentPassword" ? undefined : 8}
        autoComplete={autoComplete}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className={INPUT}
      />
    </label>
  );

  return (
    <section className={`${CARD} mx-auto mt-8 max-w-md`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-deep">
        <Icon name="key" className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-3xl font-semibold">Choose your own password</h1>
      <p className="mt-2 text-sm text-muted">
        Welcome, {name.split(" ")[0]}. HR gave you a temporary password. Choose one only you
        know before you go on; HR won&apos;t be able to see it.
      </p>
      <form
        className="mt-5 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {field("currentPassword", "Temporary password", "(the one HR gave you)", "current-password")}
        {field("newPassword", "New password", "(at least 8 characters)")}
        {field("repeat", "New password again")}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={saving} className={`${PRIMARY_BUTTON} mt-2 h-12`}>
          {saving ? "Saving…" : "Save and continue"}
        </button>
      </form>
    </section>
  );
}

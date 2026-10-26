"use client";

import { useState } from "react";
import type { LeaveRequest, Payslip } from "@hr/types";
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
import PayslipView from "../components/payslip-view";
import StatusBadge from "../components/status-badge";
import {
  apiSend,
  describeError,
  fetchMe,
  fetchMyLeave,
  fetchMyPayslips,
  money,
  useLoad,
} from "../lib/api";
import { logOut } from "../lib/auth";
import { formatDay, formatDays, formatPeriod, LEAVE_LABELS } from "../lib/format";
import { LoadError, Loading } from "../lib/status";

export default function MyPortalPage() {
  const me = useLoad(fetchMe);
  const leave = useLoad(fetchMyLeave);
  const payslips = useLoad(fetchMyPayslips);
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [viewing, setViewing] = useState<Payslip | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
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
            <button
              onClick={() => setChangingPassword(true)}
              className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-muted transition hover:bg-surface-alt hover:text-ink"
            >
              <Icon name="key" className="h-4 w-4" />
              <span className="hidden sm:inline">Change password</span>
            </button>
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
        ) : (
          <>
            {/* Text sits on the deep end of the gradient, where white reads well. */}
            <section className="relative mt-2 overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-deep via-brand-hover to-brand p-8 text-white shadow-xl shadow-brand/30">
              <div aria-hidden className="absolute -right-12 -top-16 h-60 w-60 animate-float rounded-full bg-white/15" />
              <div aria-hidden className="absolute -bottom-24 right-32 h-48 w-48 animate-float rounded-full bg-violet-300/25 [animation-delay:-3s]" />
              <div className="relative flex flex-wrap items-center gap-5">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-xl font-semibold text-brand-deep shadow-lg">
                  {profile.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <div>
                  <h1 className="text-4xl font-semibold">Hello, {profile.name.split(" ")[0]}!</h1>
                  <p className="mt-1 text-white/90">
                    {profile.jobTitle}
                    {profile.departmentName && ` · ${profile.departmentName}`} · {profile.employeeNo}
                  </p>
                </div>
                <button
                  onClick={() => setAsking(true)}
                  className="ml-auto inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-brand-deep shadow-md transition hover:-translate-y-0.5"
                >
                  <Icon name="plus" className="h-4 w-4" />
                  Ask for leave
                </button>
              </div>
            </section>
            <Notice text={notice} />
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className={CARD}>
                <Heading icon="calendar" tint="bg-amber-100 text-amber-800" title="Annual leave left" />
                <p className="mt-4 text-4xl font-semibold">
                  {profile.annualLeaveLeft}
                  <span className="text-lg font-normal text-muted"> of {profile.annualLeaveDays} days</span>
                </p>
                <div aria-hidden className="mt-3 h-2.5 overflow-hidden rounded-full bg-brand-soft/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-brand-hover"
                    style={{
                      width: `${profile.annualLeaveDays ? Math.max(0, (profile.annualLeaveLeft / profile.annualLeaveDays) * 100) : 0}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {formatDays(profile.annualLeaveTaken)} used this year
                </p>
              </div>
              <div className={`${CARD} bg-gradient-to-br from-white to-emerald-50`}>
                <Heading icon="wallet" tint="bg-emerald-100 text-emerald-800" title="Latest pay" />
                <p className="mt-4 text-4xl font-semibold">
                  {payslips.data?.[0] ? money.format(payslips.data[0].net) : "—"}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {payslips.data?.[0]
                    ? `Net pay for ${formatPeriod(payslips.data[0].period)}`
                    : "No payslips yet"}
                </p>
              </div>
            </div>
          </>
        )}

        {asking && (
          <Modal title="Ask for leave" onClose={() => setAsking(false)}>
            <LeaveForm
              onCancel={() => setAsking(false)}
              onSaved={() => {
                setAsking(false);
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
              <button onClick={() => window.print()} className={SECONDARY_BUTTON}>
                <Icon name="printer" className="h-4 w-4" />
                Print
              </button>
            </div>
          </Modal>
        )}
        {changingPassword && (
          <Modal title="Change password" onClose={() => setChangingPassword(false)}>
            <PasswordForm
              onCancel={() => setChangingPassword(false)}
              onSaved={() => {
                setChangingPassword(false);
                setNotice("Password changed.");
              }}
            />
          </Modal>
        )}

        <section className="mt-8">
          <Heading icon="calendar" tint="bg-amber-100 text-amber-800" title="My leave" />
          <div className="mt-4">
            {leave.failed ? (
              <LoadError />
            ) : !leave.data ? (
              <Loading />
            ) : leave.data.length === 0 ? (
              <p className="text-sm text-muted">You haven&apos;t asked for leave yet.</p>
            ) : (
              <div className={TABLE_CARD}><table className={TABLE}>
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
                            onClick={() => setCancelling(l)}
                            className="font-medium text-red-700 hover:underline"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </section>

        <section className="mt-8">
          <Heading icon="users" tint="bg-violet-100 text-violet-700" title="My guarantors" />
          <p className="mt-1 text-sm text-muted">
            People who can vouch for you. HR checks each one and marks them verified.
          </p>
          <div className="mt-4">
            <Guarantors path="/me/guarantors" isAdmin={false} />
          </div>
        </section>

        <section className="mt-8">
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
                      onClick={() => setViewing(p)}
                      className="group flex w-full items-center gap-4 rounded-3xl bg-white p-4 text-left text-sm shadow-soft ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-brand-soft"
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
                        <Icon name="wallet" />
                      </span>
                      <span className="flex-1">
                        <span className="block font-semibold">{formatPeriod(p.period)}</span>
                        <span className="block text-muted">{money.format(p.net)} net</span>
                      </span>
                      <span className="font-semibold text-brand-deep group-hover:underline">View →</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Heading({ icon, tint, title }: { icon: IconName; tint: string; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-xl font-semibold">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      {title}
    </h2>
  );
}

function PasswordForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
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
      await apiSend("/me/password", "PUT", form, "Could not change password");
      onSaved();
    } catch (e) {
      setError(describeError(e, "Could not change password"));
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
      <label className="text-sm font-medium">
        Current password
        <input
          autoFocus
          required
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          className={INPUT}
        />
      </label>
      <label className="text-sm font-medium">
        New password <span className="font-normal text-muted">(at least 8 characters)</span>
        <input
          required
          minLength={8}
          type="password"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          className={INPUT}
        />
      </label>
      <label className="text-sm font-medium">
        New password again
        <input
          required
          type="password"
          autoComplete="new-password"
          value={form.repeat}
          onChange={(e) => setForm({ ...form, repeat: e.target.value })}
          className={INPUT}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : "Change password"}
        </button>
      </div>
    </form>
  );
}

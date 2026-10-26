"use client";

import { useEffect, useState } from "react";
import type { Payslip, PayrollRunDetail } from "@hr/types";
import ConfirmDialog from "../../components/confirm-dialog";
import { Person } from "../../components/avatar";
import {
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TABLE, TABLE_CARD, TBODY, THEAD,
} from "../../components/form-styles";
import Icon, { type IconName } from "../../components/icons";
import PageHeader from "../../components/page-header";
import PaySalary from "../../components/pay-salary";
import Modal from "../../components/modal";
import { Notice } from "../../components/notice";
import PayslipView from "../../components/payslip-view";
import {
  apiFetch,
  apiSend,
  describeError,
  fetchPayrollRun,
  fetchPayrollRuns,
  money,
  useLoad,
} from "../../lib/api";
import { formatDay, formatPeriod, today } from "../../lib/format";
import { LoadError, Loading } from "../../lib/status";

type Confirm = "paid" | "delete";

export default function PayrollPage() {
  const runs = useLoad(fetchPayrollRuns);
  const [period, setPeriod] = useState<string | null>(null);
  const [newPeriod, setNewPeriod] = useState(today().slice(0, 7));
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Open the latest month once the list arrives.
  const shown = period ?? runs.data?.[0]?.period ?? null;

  const create = async () => {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const run = await apiSend<PayrollRunDetail>(
        "/payroll",
        "POST",
        { period: newPeriod },
        "Could not start payroll",
      );
      setNotice(
        `Payroll for ${formatPeriod(run.period)} worked out for ${run.employees} people. Check it, then mark it paid.`,
      );
      await runs.reload();
      setPeriod(run.period);
    } catch (e) {
      setError(describeError(e, "Could not start payroll"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        icon="wallet"
        eyebrow="Salaries"
        title="Payroll"
        description="Work out a month's pay, check it, then pay each person."
      />
      <Notice text={notice} />
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 grid gap-6 xl:grid-cols-[15rem_1fr]">
        <aside className="flex flex-col gap-4">
          <form
            className="rounded-3xl bg-white p-5 shadow-soft ring-1 ring-line"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label className="text-sm font-medium">
              Month to pay
              <input
                required
                type="month"
                value={newPeriod}
                onChange={(e) => setNewPeriod(e.target.value)}
                className={INPUT}
              />
            </label>
            <button type="submit" disabled={creating} className={`${PRIMARY_BUTTON} mt-3 w-full`}>
              <Icon name="sparkle" className="h-4 w-4" />
              {creating ? "Working it out…" : "Run payroll"}
            </button>
          </form>
          <nav className="rounded-3xl bg-white p-2 shadow-soft ring-1 ring-line">
            {runs.failed ? (
              <LoadError />
            ) : !runs.data ? (
              <Loading />
            ) : runs.data.length === 0 ? (
              <p className="p-2 text-sm text-muted">No payroll yet.</p>
            ) : (
              runs.data.map((r) => (
                <button
                  key={r.period}
                  onClick={() => setPeriod(r.period)}
                  aria-current={shown === r.period ? "page" : undefined}
                  className={`flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm transition ${
                    shown === r.period
                      ? "bg-brand-soft font-semibold text-brand-deep"
                      : "hover:bg-surface-alt"
                  }`}
                >
                  {formatPeriod(r.period)}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.status === "paid"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {r.status === "paid"
                      ? "Paid"
                      : r.paidCount > 0
                        ? `${r.paidCount}/${r.employees} paid`
                        : "Draft"}
                  </span>
                </button>
              ))
            )}
          </nav>
        </aside>

        <section className="min-w-0">
          {shown && (
            <RunDetail
              key={shown}
              period={shown}
              onChanged={(message) => {
                setNotice(message);
                setError(null);
                void runs.reload();
              }}
              onDeleted={(message) => {
                setNotice(message);
                setPeriod(null);
                void runs.reload();
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function RunDetail({
  period,
  onChanged,
  onDeleted,
}: {
  period: string;
  onChanged: (message: string) => void;
  onDeleted: (message: string) => void;
}) {
  const [run, setRun] = useState<PayrollRunDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [viewing, setViewing] = useState<Payslip | null>(null);
  const [adjusting, setAdjusting] = useState<Payslip | null>(null);
  const [paying, setPaying] = useState<Payslip | null>(null);
  const [undoing, setUndoing] = useState<Payslip | null>(null);

  useEffect(() => {
    fetchPayrollRun(period)
      .then(setRun)
      .catch(() => setFailed(true));
  }, [period]);

  if (failed) return <LoadError />;
  if (!run) return <Loading />;
  const draft = run.status === "draft";

  const act = async (work: () => Promise<PayrollRunDetail | void>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await work();
      if (updated) setRun(updated);
      onChanged(message);
    } catch (e) {
      setError(describeError(e, "Could not update payroll"));
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = () =>
    act(async () => {
      const res = await apiFetch(`/payroll/${period}/bank.csv`);
      if (!res.ok) throw new Error("Could not download the bank file");
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `payroll-${period}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }, `Bank file for ${formatPeriod(period)} downloaded.`);

  const unpaid = run.payslips.filter((p) => !p.paidAt);
  const missingBank = unpaid.filter((p) => !p.bankAccountNumber);
  const paidNet = run.payslips.reduce((sum, p) => sum + (p.paidAt ? p.net : 0), 0);

  return (
    <div>
      {confirm === "paid" && (
        <ConfirmDialog
          title="Mark everyone paid"
          message={`Only do this if you have already sent all ${unpaid.length} remaining salaries (${money.format(run.net - paidNet)}), e.g. with the bank file. ${formatPeriod(period)} is then locked, and everyone gets their payslip.`}
          confirmLabel="Mark all paid"
          onConfirm={async () => {
            setConfirm(null);
            await act(
              () => apiSend(`/payroll/${period}/paid`, "POST", {}, "Could not mark paid"),
              `${formatPeriod(period)} marked paid. Employees can now see their payslips.`,
            );
          }}
          onClose={() => setConfirm(null)}
        />
      )}
      {paying && (
        <PaySalary
          key={paying.employeeId}
          payslip={paying}
          next={unpaid.find((p) => p.employeeId !== paying.employeeId && p.bankAccountNumber)}
          onPaid={(updated) => {
            setRun(updated);
            onChanged(
              updated.status === "paid"
                ? `Everyone is paid for ${formatPeriod(period)}. The month is now locked.`
                : `${paying.employeeName} paid. Their payslip is in the staff portal.`,
            );
          }}
          onViewPayslip={(p) => {
            setPaying(null);
            setViewing(p);
          }}
          onPayNext={setPaying}
          onClose={() => setPaying(null)}
        />
      )}
      {undoing && (
        <ConfirmDialog
          title="Undo payment"
          message={`Mark ${undoing.employeeName} as not paid? Only do this if the transfer was recorded by mistake or failed. Their payslip disappears from the staff portal until you pay them again.`}
          confirmLabel="Undo payment"
          danger
          onConfirm={async () => {
            const who = undoing;
            setUndoing(null);
            await act(
              () =>
                apiSend(
                  `/payroll/${period}/payslips/${who.employeeId}/paid`,
                  "DELETE",
                  undefined,
                  "Could not undo payment",
                ),
              `${who.employeeName} marked as not paid.`,
            );
          }}
          onClose={() => setUndoing(null)}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title="Delete draft"
          message={`Delete the draft payroll for ${formatPeriod(period)}, with any bonuses entered?`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            setConfirm(null);
            try {
              await apiSend(`/payroll/${period}`, "DELETE", undefined, "Could not delete payroll");
              onDeleted(`Draft payroll for ${formatPeriod(period)} deleted.`);
            } catch (e) {
              setError(describeError(e, "Could not delete payroll"));
            }
          }}
          onClose={() => setConfirm(null)}
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
      {adjusting && (
        <Modal title={`This month only · ${adjusting.employeeName}`} onClose={() => setAdjusting(null)}>
          <AdjustForm
            payslip={adjusting}
            onCancel={() => setAdjusting(null)}
            onSaved={(updated) => {
              setAdjusting(null);
              setRun(updated);
              onChanged(`${adjusting.employeeName}'s payslip updated.`);
            }}
          />
        </Modal>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{formatPeriod(period)}</h2>
          <p className="text-sm text-muted">
            {draft
              ? "Check the figures, then pay each person. Their payslip is issued as soon as you confirm."
              : `Everyone paid${run.paidAt ? ` by ${formatDay(run.paidAt.slice(0, 10))}` : ""}. This month is locked.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => void downloadCsv()} className={SECONDARY_BUTTON}>
            <Icon name="download" className="h-4 w-4" />
            Bank file (CSV)
          </button>
          {draft && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      apiSend(`/payroll/${period}/recalculate`, "POST", {}, "Could not recalculate"),
                    `${formatPeriod(period)} recalculated from the latest salaries and leave.`,
                  )
                }
                className={SECONDARY_BUTTON}
              >
                <Icon name="refresh" className="h-4 w-4" />
                Recalculate
              </button>
              {run.paidCount === 0 && (
                <button disabled={busy} onClick={() => setConfirm("delete")} className={SECONDARY_BUTTON}>
                  Delete draft
                </button>
              )}
              <button disabled={busy} onClick={() => setConfirm("paid")} className={SECONDARY_BUTTON}>
                <Icon name="check" className="h-4 w-4" />
                Mark all paid
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {missingBank.length > 0 && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          No bank account saved for {missingBank.map((p) => p.employeeName).join(", ")}.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Total label="People" value={String(run.employees)} tint="bg-violet-100 text-violet-700" icon="users" />
        <Total label="Gross pay" value={money.format(run.gross)} tint="bg-amber-100 text-amber-800" icon="wallet" />
        <Total label="Net pay to send" value={money.format(run.net)} tint="bg-emerald-100 text-emerald-800" icon="check" highlight />
      </div>

      <div className="mt-4 rounded-3xl bg-white p-5 shadow-soft ring-1 ring-line">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <p className="font-semibold">
            {run.paidCount} of {run.employees} paid
          </p>
          <p className="text-muted">
            {money.format(paidNet)} sent · {money.format(run.net - paidNet)} to go
          </p>
        </div>
        <div aria-hidden className="mt-2 h-2.5 overflow-hidden rounded-full bg-brand-soft/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
            style={{ width: `${run.employees ? (run.paidCount / run.employees) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className={`mt-4 ${TABLE_CARD}`}><table className={TABLE}>
        <thead className={THEAD}>
          <tr>
            <th className="px-5 py-3.5">Employee</th>
            <th className="px-5 py-3.5 text-right">Days paid</th>
            <th className="px-5 py-3.5 text-right">Gross</th>
            <th className="px-5 py-3.5 text-right">Deductions</th>
            <th className="px-5 py-3.5 text-right">Net</th>
            <th className="px-5 py-3.5">Status</th>
            <th className="px-5 py-3.5" />
          </tr>
        </thead>
        <tbody className={TBODY}>
          {run.payslips.map((p) => (
            <tr key={p.employeeId} className="align-top">
              <td className="px-5 py-4">
                <Person name={p.employeeName} detail={`${p.employeeNo} · ${p.jobTitle}`} />
                {(p.bonus > 0 || p.otherDeduction > 0) && (
                  <p className="text-xs text-brand-deep">
                    {[
                      p.bonus > 0 && `Bonus ${money.format(p.bonus)}`,
                      p.otherDeduction > 0 && `Deduction ${money.format(p.otherDeduction)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </td>
              <td className="px-5 py-4 text-right">
                {p.daysPaid} / {p.workingDays}
              </td>
              <td className="px-5 py-4 text-right">{money.format(p.gross)}</td>
              <td className="px-5 py-4 text-right">{money.format(p.totalDeductions)}</td>
              <td className="px-5 py-4 text-right font-semibold">{money.format(p.net)}</td>
              <td className="whitespace-nowrap px-5 py-4">
                {p.paidAt ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                      <Icon name="check" className="h-3.5 w-3.5" />
                      Paid {formatDay(p.paidAt.slice(0, 10))}
                    </span>
                    <p className="mt-1 font-mono text-xs text-muted">{p.paymentReference}</p>
                  </>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                    Not paid
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-right">
                <div className="flex items-center justify-end gap-3">
                  {draft && !p.paidAt && (
                    <button
                      onClick={() => setPaying(p)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-ink shadow-md shadow-brand/30 transition hover:-translate-y-0.5 hover:bg-brand-hover"
                    >
                      <Icon name="wallet" className="h-3.5 w-3.5" />
                      Pay salary
                    </button>
                  )}
                  <button
                    onClick={() => setViewing(p)}
                    className="font-medium text-brand-deep hover:underline"
                  >
                    Payslip
                  </button>
                  {draft && p.paidAt && (
                    <button
                      onClick={() => setUndoing(p)}
                      className="font-medium text-muted hover:text-red-700 hover:underline"
                    >
                      Undo
                    </button>
                  )}
                  {draft && !p.paidAt && (
                    <button
                      onClick={() => setAdjusting(p)}
                      className="font-medium text-brand-deep hover:underline"
                    >
                      Bonus / deduct
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function Total({
  label,
  value,
  tint,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  tint: string;
  icon: IconName;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 rounded-3xl p-5 shadow-soft ring-1 ${
        highlight
          ? "bg-gradient-to-br from-brand-soft to-white ring-brand-soft"
          : "bg-white ring-line"
      }`}
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tint}`}>
        <Icon name={icon} />
      </span>
      <div>
        <p className="text-sm text-muted">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </div>
    </div>
  );
}

/** A one-off bonus or deduction on one payslip of a draft payroll. */
function AdjustForm({
  payslip,
  onSaved,
  onCancel,
}: {
  payslip: Payslip;
  onSaved: (run: PayrollRunDetail) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    bonus: payslip.bonus ? String(payslip.bonus) : "",
    otherDeduction: payslip.otherDeduction ? String(payslip.otherDeduction) : "",
    note: payslip.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await apiSend<PayrollRunDetail>(
          `/payroll/${payslip.period}/payslips/${payslip.employeeId}`,
          "PUT",
          form,
          "Could not update payslip",
        ),
      );
    } catch (e) {
      setError(describeError(e, "Could not update payslip"));
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
      <p className="text-sm text-muted">
        For {formatPeriod(payslip.period)} only. Fixed monthly allowances and
        deductions are set on the Employees page.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Bonus
          <input
            autoFocus
            type="number"
            min={0}
            step={0.01}
            value={form.bonus}
            onChange={(e) => setForm({ ...form, bonus: e.target.value })}
            className={INPUT}
          />
        </label>
        <label className="text-sm font-medium">
          Deduction
          <input
            type="number"
            min={0}
            step={0.01}
            value={form.otherDeduction}
            onChange={(e) => setForm({ ...form, otherDeduction: e.target.value })}
            className={INPUT}
          />
        </label>
      </div>
      <label className="text-sm font-medium">
        Note on the payslip <span className="font-normal text-muted">(optional)</span>
        <input
          placeholder="e.g. Sales target bonus"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          className={INPUT}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

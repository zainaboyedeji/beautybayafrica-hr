"use client";

import { useState } from "react";
import { salaryReference, type Payslip, type PayrollRunDetail } from "@hr/types";
import { apiSend, describeError, money } from "../lib/api";
import { formatPeriod } from "../lib/format";
import Avatar from "./avatar";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./form-styles";
import Icon from "./icons";
import Modal from "./modal";

type Step = "review" | "confirm" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "review", label: "Send" },
  { key: "confirm", label: "Confirm" },
  { key: "done", label: "Payslip" },
];

/**
 * Pays one person by hand: shows the transfer details to send from the bank,
 * asks whether it went through, then records it and issues the payslip.
 */
export default function PaySalary({
  payslip,
  next,
  onPaid,
  onViewPayslip,
  onPayNext,
  onClose,
}: {
  payslip: Payslip;
  /** The next person still to pay, if any. */
  next?: Payslip;
  onPaid: (run: PayrollRunDetail) => void;
  onViewPayslip: (payslip: Payslip) => void;
  onPayNext: (payslip: Payslip) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("review");
  const [bankReference, setBankReference] = useState("");
  const [paid, setPaid] = useState<Payslip | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reference = salaryReference(payslip.period, payslip.employeeNo);
  const canPay = !!payslip.bankAccountNumber;

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const run = await apiSend<PayrollRunDetail>(
        `/payroll/${payslip.period}/payslips/${payslip.employeeId}/paid`,
        "POST",
        { reference: bankReference },
        "Could not record the payment",
      );
      setPaid(run.payslips.find((p) => p.employeeId === payslip.employeeId) ?? null);
      setStep("done");
      onPaid(run);
    } catch (e) {
      setError(describeError(e, "Could not record the payment"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Pay salary" onClose={onClose}>
      <ol className="mb-5 grid grid-cols-3 gap-2 text-xs font-semibold">
        {STEPS.map((s, i) => {
          const reached = STEPS.findIndex((x) => x.key === step) >= i;
          return (
            <li key={s.key} className="flex flex-col gap-1.5">
              <span
                className={`h-1.5 rounded-full transition ${reached ? "bg-gradient-to-r from-brand to-brand-hover" : "bg-line"}`}
              />
              <span className={reached ? "text-brand-deep" : "text-muted"}>
                {i + 1}. {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {step === "review" && (
        <div className="animate-fade-up">
          <div className="rounded-3xl bg-gradient-to-br from-brand-soft via-surface-alt to-violet-100 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brand-deep">
              Amount to send
            </p>
            <p className="mt-1 text-4xl font-semibold">{money.format(payslip.net)}</p>
            <p className="mt-1 text-sm text-muted">{formatPeriod(payslip.period)} net salary</p>
          </div>

          <div className="mt-4 rounded-3xl p-4 ring-1 ring-line">
            <div className="flex items-center gap-3">
              <Avatar name={payslip.employeeName} />
              <div>
                <p className="font-semibold">{payslip.employeeName}</p>
                <p className="text-sm text-muted">
                  {payslip.employeeNo} · {payslip.jobTitle}
                </p>
              </div>
            </div>
            {canPay ? (
              <dl className="mt-4 divide-y divide-line text-sm">
                <Row label="Bank" value={payslip.bankName ?? "—"} />
                <Row label="Account number" value={payslip.bankAccountNumber!} copy mono />
                <Row label="Account name" value={payslip.bankAccountName ?? payslip.employeeName} />
                <Row label="Narration" value={`${formatPeriod(payslip.period)} salary`} copy />
                <Row label="Reference" value={reference} copy mono />
              </dl>
            ) : (
              <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
                No bank account is saved for {payslip.employeeName}. Add it on the Employees page
                (Edit), then click Recalculate before paying.
              </p>
            )}
          </div>

          <details className="mt-3 rounded-2xl bg-surface-alt px-4 py-3 text-sm">
            <summary className="cursor-pointer font-semibold">How this was worked out</summary>
            <dl className="mt-2 grid gap-1">
              <Line label="Gross pay" value={money.format(payslip.gross)} />
              {payslip.deductions.map((d, i) => (
                <Line key={i} label={d.name} value={`− ${money.format(d.amount)}`} />
              ))}
              <Line label="Net pay" value={money.format(payslip.net)} strong />
            </dl>
          </details>

          <p className="mt-4 text-sm text-muted">
            Send this amount from the company bank account (or bank app), then come back and confirm.
          </p>
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
              Cancel
            </button>
            <button
              type="button"
              disabled={!canPay}
              onClick={() => setStep("confirm")}
              className={PRIMARY_BUTTON}
            >
              I&apos;ve sent the money →
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <form
          className="animate-fade-up"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <div className="flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-800">
              <Icon name="clock" className="h-8 w-8" />
            </span>
            <p className="mt-4 font-display text-2xl font-semibold">Has the transfer gone through?</p>
            <p className="mt-2 text-sm text-muted">
              Check that your bank shows{" "}
              <span className="font-semibold text-ink">{money.format(payslip.net)}</span> sent
              successfully to{" "}
              <span className="font-semibold text-ink">
                {payslip.bankAccountName ?? payslip.employeeName}
              </span>{" "}
              ({payslip.bankName} {payslip.bankAccountNumber}).
            </p>
          </div>
          <label className="mt-5 block text-sm font-medium">
            Bank reference or session ID{" "}
            <span className="font-normal text-muted">(optional, from the bank receipt)</span>
            <input
              autoFocus
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
              placeholder={reference}
              className={INPUT}
            />
          </label>
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={() => setStep("review")} className={SECONDARY_BUTTON}>
              Not yet
            </button>
            <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
              <Icon name="check" className="h-4 w-4" />
              {saving ? "Recording…" : "Yes, it's been sent"}
            </button>
          </div>
        </form>
      )}

      {step === "done" && paid && (
        <div className="flex animate-pop-in flex-col items-center text-center">
          <span className="relative flex h-20 w-20 items-center justify-center">
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-emerald-200 opacity-60 [animation-iteration-count:2]" />
            <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/40">
              <Icon name="check" className="h-10 w-10" />
            </span>
          </span>
          <p className="mt-5 font-display text-3xl font-semibold">Salary paid</p>
          <p className="mt-2 text-sm text-muted">
            {money.format(paid.net)} to {paid.employeeName}
            <br />
            Ref: <span className="font-mono text-ink">{paid.paymentReference}</span>
          </p>
          <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
            Payslip generated. {paid.employeeName.split(" ")[0]} can see it in the staff portal now.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={() => onViewPayslip(paid)} className={SECONDARY_BUTTON}>
              View payslip
            </button>
            {next ? (
              <button onClick={() => onPayNext(next)} className={PRIMARY_BUTTON}>
                Pay next: {next.employeeName} →
              </button>
            ) : (
              <button onClick={onClose} className={PRIMARY_BUTTON}>
                Done
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({
  label,
  value,
  copy,
  mono,
}: {
  label: string;
  value: string;
  copy?: boolean;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="flex items-center gap-2 text-right font-semibold">
        <span className={mono ? "font-mono tracking-wide" : undefined}>{value}</span>
        {copy && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${
              copied ? "bg-emerald-100 text-emerald-800" : "bg-brand-soft text-brand-deep hover:bg-brand hover:text-ink"
            }`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </dd>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-line-strong pt-1 font-semibold" : ""}`}>
      <dt className={strong ? undefined : "text-muted"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

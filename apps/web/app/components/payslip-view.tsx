"use client";

import { createPortal } from "react-dom";
import type { PayLine, Payslip } from "@hr/types";
import { money } from "../lib/api";
import { formatDay, formatPeriod } from "../lib/format";

const COMPANY = process.env.NEXT_PUBLIC_COMPANY_NAME ?? "Beauty Bay Africa";

/**
 * A payslip, as shown in a pop-up. It also puts a print copy straight on the
 * page, outside the pop-up, so printing gives the whole payslip on one A4
 * sheet rather than whatever part of the pop-up was on screen.
 */
export default function PayslipView({ payslip }: { payslip: Payslip }) {
  return (
    <>
      <Slip payslip={payslip} />
      {typeof document !== "undefined" &&
        createPortal(
          <div className="print-root">
            <Slip payslip={payslip} forPrint />
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Prints the payslip that is open, or saves it as a PDF. The file is named
 * after the person and month, e.g. "Payslip 2026-11 Amaka Obi".
 */
export function printPayslip(p: Payslip) {
  const title = document.title;
  document.title = `Payslip ${p.period} ${p.employeeName}`;
  window.print();
  document.title = title;
}

function Slip({ payslip: p, forPrint }: { payslip: Payslip; forPrint?: boolean }) {
  // On paper the two columns always sit side by side, at a size that reads well.
  const twoColumns = forPrint ? "grid-cols-2" : "sm:grid-cols-2";
  return (
    <div className={`text-sm text-ink ${forPrint ? "mx-auto max-w-[180mm] text-[13px]" : ""}`}>
      <div className="print-keep flex items-start justify-between border-b border-line pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-deep">
            {COMPANY}
          </p>
          <p className={`mt-1 font-semibold ${forPrint ? "text-2xl" : "text-lg"}`}>
            Payslip · {formatPeriod(p.period)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {p.paidAt ? (
            <span className="-rotate-6 rounded-lg border-2 border-emerald-600 px-3 py-1 text-center text-emerald-700">
              <span className="block text-sm font-bold tracking-[0.2em]">PAID</span>
              <span className="block text-[10px] font-semibold">{formatDay(p.paidAt.slice(0, 10))}</span>
            </span>
          ) : (
            <span className="rounded-lg border-2 border-dashed border-amber-500 px-3 py-1 text-xs font-bold tracking-[0.15em] text-amber-700">
              NOT PAID YET
            </span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-12 w-12" />
        </div>
      </div>

      <dl className="print-keep mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
        <Detail label="Name" value={p.employeeName} />
        <Detail label="Staff number" value={p.employeeNo} />
        <Detail label="Job title" value={p.jobTitle} />
        <Detail label="Department" value={p.departmentName ?? "—"} />
        <Detail label="Days paid" value={`${p.daysPaid} of ${p.workingDays} working days`} />
        <Detail
          label="Paid to"
          value={
            p.bankAccountNumber ? `${p.bankName ?? ""} ${p.bankAccountNumber}`.trim() : "—"
          }
        />
        {p.taxId && <Detail label="Tax ID" value={p.taxId} />}
        {p.pensionPin && (
          <Detail
            label="Pension"
            value={[p.pensionProvider, p.pensionPin].filter(Boolean).join(" · ")}
          />
        )}
      </dl>

      <div className={`print-keep mt-5 grid gap-5 ${twoColumns}`}>
        <Lines title="Earnings" lines={p.earnings} total={p.gross} totalLabel="Gross pay" />
        <Lines
          title="Deductions"
          lines={p.deductions}
          total={p.totalDeductions}
          totalLabel="Total deductions"
        />
      </div>

      <div className="print-keep mt-5 flex items-center justify-between rounded-lg bg-brand-soft px-4 py-3">
        <span className="font-semibold">Net pay</span>
        <span className="text-xl font-semibold">{money.format(p.net)}</span>
      </div>
      {p.employerPension > 0 && (
        <p className="mt-3 text-muted">
          The company also paid {money.format(p.employerPension)} into your pension.
        </p>
      )}
      {p.paymentReference && (
        <p className="mt-3 text-muted">
          Payment reference: <span className="font-mono text-ink">{p.paymentReference}</span>
        </p>
      )}
      {p.note && <p className="mt-3 text-muted">Note: {p.note}</p>}

      {forPrint && (
        <p className="mt-10 border-t border-line pt-3 text-[11px] text-muted">
          Issued by {COMPANY} HR. This payslip was produced electronically and needs no
          signature. Printed{" "}
          {new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}.
        </p>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Lines({
  title,
  lines,
  total,
  totalLabel,
}: {
  title: string;
  lines: PayLine[];
  total: number;
  totalLabel: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="mt-2 divide-y divide-line">
        {lines.length === 0 && <li className="py-1.5 text-muted">None</li>}
        {lines.map((line, i) => (
          <li key={i} className="flex justify-between gap-3 py-1.5">
            <span>{line.name}</span>
            <span className="whitespace-nowrap">{money.format(line.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 flex justify-between border-t border-line-strong pt-2 font-semibold">
        <span>{totalLabel}</span>
        <span className="whitespace-nowrap">{money.format(total)}</span>
      </p>
    </div>
  );
}

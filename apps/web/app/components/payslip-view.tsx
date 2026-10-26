import type { PayLine, Payslip } from "@hr/types";
import { money } from "../lib/api";
import { formatDay, formatPeriod } from "../lib/format";

const COMPANY = process.env.NEXT_PUBLIC_COMPANY_NAME ?? "Beauty Bay Africa";

/** A printable payslip. */
export default function PayslipView({ payslip: p }: { payslip: Payslip }) {
  return (
    <div className="print-area text-sm">
      <div className="flex items-start justify-between border-b border-line pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-deep">
            {COMPANY}
          </p>
          <p className="mt-1 text-lg font-semibold">
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

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
        <Detail label="Name" value={p.employeeName} />
        <Detail label="Staff number" value={p.employeeNo} />
        <Detail label="Job title" value={p.jobTitle} />
        <Detail label="Department" value={p.departmentName ?? "—"} />
        <Detail
          label="Days paid"
          value={`${p.daysPaid} of ${p.workingDays} working days`}
        />
        <Detail
          label="Paid to"
          value={
            p.bankAccountNumber
              ? `${p.bankName ?? ""} ${p.bankAccountNumber}`.trim()
              : "—"
          }
        />
      </dl>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Lines title="Earnings" lines={p.earnings} total={p.gross} totalLabel="Gross pay" />
        <Lines
          title="Deductions"
          lines={p.deductions}
          total={p.totalDeductions}
          totalLabel="Total deductions"
        />
      </div>

      <div className="mt-5 flex items-center justify-between rounded-lg bg-brand-soft px-4 py-3">
        <span className="font-semibold">Net pay</span>
        <span className="text-xl font-semibold">{money.format(p.net)}</span>
      </div>
      {p.paymentReference && (
        <p className="mt-3 text-muted">
          Payment reference: <span className="font-mono text-ink">{p.paymentReference}</span>
        </p>
      )}
      {p.note && <p className="mt-3 text-muted">Note: {p.note}</p>}
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
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </p>
      <ul className="mt-2 divide-y divide-line">
        {lines.length === 0 && <li className="py-1.5 text-muted">None</li>}
        {lines.map((line, i) => (
          <li key={i} className="flex justify-between py-1.5">
            <span>{line.name}</span>
            <span>{money.format(line.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 flex justify-between border-t border-line-strong pt-2 font-semibold">
        <span>{totalLabel}</span>
        <span>{money.format(total)}</span>
      </p>
    </div>
  );
}

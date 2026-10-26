"use client";

import { useState } from "react";
import type { Employee, LeaveRequest, LeaveType } from "@hr/types";
import { apiSend, describeError } from "../lib/api";
import { formatDays, LEAVE_LABELS, today } from "../lib/format";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./form-styles";

// Monday-to-Friday days between two dates, both included (the API has the
// final say; this is only a preview).
const weekdays = (start: string, end: string) => {
  if (!start || !end || end < start) return 0;
  let count = 0;
  for (
    let d = new Date(`${start}T00:00:00Z`);
    d <= new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
};

/**
 * Asks for leave. Given `employees`, the admin picks who it is for and the
 * leave is approved straight away; otherwise it is the logged-in employee's.
 */
export default function LeaveForm({
  employees,
  onSaved,
  onCancel,
}: {
  employees?: Employee[];
  onSaved: (leave: LeaveRequest) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    employeeId: "",
    type: "annual" as LeaveType,
    startDate: today(),
    endDate: today(),
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = weekdays(form.startDate, form.endDate);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await apiSend<LeaveRequest>("/leave", "POST", form, "Could not save leave"),
      );
    } catch (e) {
      setError(describeError(e, "Could not save leave"));
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
      {employees && (
        <label className="text-sm font-medium">
          Employee
          <select
            required
            value={form.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
            className={INPUT}
          >
            <option value="">Choose…</option>
            {employees
              .filter((e) => !e.endDate || e.endDate >= today())
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <label className="text-sm font-medium">
        Type of leave
        <select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as LeaveType })}
          className={INPUT}
        >
          {(Object.keys(LEAVE_LABELS) as LeaveType[]).map((t) => (
            <option key={t} value={t}>
              {LEAVE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          First day
          <input
            required
            type="date"
            value={form.startDate}
            onChange={(e) =>
              setForm({
                ...form,
                startDate: e.target.value,
                endDate:
                  form.endDate < e.target.value ? e.target.value : form.endDate,
              })
            }
            className={INPUT}
          />
        </label>
        <label className="text-sm font-medium">
          Last day
          <input
            required
            type="date"
            min={form.startDate}
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className={INPUT}
          />
        </label>
      </div>
      <p className="text-sm text-muted">
        {days > 0
          ? `${formatDays(days)} off work (weekends aren't counted).`
          : "Those dates don't include a working day."}
      </p>
      <label className="text-sm font-medium">
        Reason <span className="font-normal text-muted">(optional)</span>
        <textarea
          rows={2}
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          className={INPUT}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving || days === 0} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : employees ? "Record leave" : "Send request"}
        </button>
      </div>
    </form>
  );
}

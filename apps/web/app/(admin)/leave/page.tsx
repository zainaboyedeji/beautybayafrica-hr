"use client";

import { useState } from "react";
import type { LeaveRequest, LeaveStatus } from "@hr/types";
import ConfirmDialog from "../../components/confirm-dialog";
import { Person } from "../../components/avatar";
import { PRIMARY_BUTTON, TABLE, TABLE_CARD, TBODY, THEAD } from "../../components/form-styles";
import Icon from "../../components/icons";
import PageHeader from "../../components/page-header";
import LeaveForm from "../../components/leave-form";
import Modal from "../../components/modal";
import { Notice } from "../../components/notice";
import SearchBox, { matches, NoMatches } from "../../components/search-box";
import StatusBadge from "../../components/status-badge";
import {
  apiSend,
  describeError,
  fetchEmployees,
  fetchLeave,
  useLoad,
} from "../../lib/api";
import { formatDay, formatDays, LEAVE_LABELS } from "../../lib/format";
import { LoadError, Loading } from "../../lib/status";

type Decision = { leave: LeaveRequest; action: "approved" | "rejected" | "cancel" };

const FILTERS: { value: LeaveStatus | ""; label: string }[] = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "", label: "All" },
];

export default function LeavePage() {
  const leave = useLoad(fetchLeave);
  const employees = useLoad(fetchEmployees);
  const [status, setStatus] = useState<LeaveStatus | "">("pending");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = leave.data?.filter(
    (l) =>
      (!status || l.status === status) &&
      matches(search, l.employeeName, LEAVE_LABELS[l.type], l.reason),
  );

  const decide = async ({ leave: request, action }: Decision, note: string) => {
    setDeciding(null);
    setError(null);
    try {
      if (action === "cancel")
        await apiSend(`/leave/${request.id}/cancel`, "PUT", {}, "Could not cancel leave");
      else
        await apiSend(
          `/leave/${request.id}/status`,
          "PUT",
          { status: action, note },
          "Could not update leave",
        );
      setNotice(
        `${request.employeeName}'s ${LEAVE_LABELS[request.type].toLowerCase()} ${
          action === "cancel" ? "cancelled" : action
        }.`,
      );
      await leave.reload();
    } catch (e) {
      setError(describeError(e, "Could not update leave"));
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        icon="calendar"
        eyebrow="Time off"
        title="Leave"
        description="Approve requests from the staff portal, or record leave yourself."
      >
        <button onClick={() => setAdding(true)} className={PRIMARY_BUTTON}>
          <Icon name="plus" className="h-4 w-4" />
          Record leave
        </button>
      </PageHeader>
      <Notice text={notice} />
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {adding && (
        <Modal title="Record leave" onClose={() => setAdding(false)}>
          {employees.failed ? (
            <LoadError />
          ) : !employees.data ? (
            <Loading />
          ) : (
            <LeaveForm
              employees={employees.data}
              onCancel={() => setAdding(false)}
              onSaved={(saved) => {
                setAdding(false);
                setNotice(
                  `${LEAVE_LABELS[saved.type]} for ${saved.employeeName} recorded and approved.`,
                );
                void leave.reload();
              }}
            />
          )}
        </Modal>
      )}
      {deciding && (
        <ConfirmDialog
          title={
            deciding.action === "approved"
              ? "Approve leave"
              : deciding.action === "rejected"
                ? "Reject leave"
                : "Cancel leave"
          }
          message={`${deciding.leave.employeeName}: ${LEAVE_LABELS[deciding.leave.type]}, ${formatDay(deciding.leave.startDate)} to ${formatDay(deciding.leave.endDate)} (${formatDays(deciding.leave.days)}).`}
          confirmLabel={
            deciding.action === "approved"
              ? "Approve"
              : deciding.action === "rejected"
                ? "Reject"
                : "Cancel leave"
          }
          withNote={deciding.action !== "cancel"}
          danger={deciding.action !== "approved"}
          onConfirm={(note) => decide(deciding, note)}
          onClose={() => setDeciding(null)}
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Show"
          className="flex gap-1 rounded-full bg-white p-1 text-sm font-semibold shadow-soft ring-1 ring-line"
        >
          {FILTERS.map((f) => (
            <button
              key={f.label}
              role="tab"
              aria-selected={status === f.value}
              onClick={() => setStatus(f.value)}
              className={`rounded-full px-4 py-1.5 transition ${
                status === f.value
                  ? "bg-brand text-ink shadow-md shadow-brand/30"
                  : "text-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="min-w-64 flex-1">
          <SearchBox value={search} onChange={setSearch} placeholder="Search by name or reason" />
        </div>
      </div>

      <div className="mt-4">
        {leave.failed ? (
          <LoadError />
        ) : !leave.data || !visible ? (
          <Loading />
        ) : visible.length === 0 ? (
          search ? (
            <NoMatches />
          ) : (
            <p className="text-sm text-muted">
              {status === "pending" ? "No leave is waiting for a decision." : "No leave here yet."}
            </p>
          )
        ) : (
          <div className={TABLE_CARD}><table className={TABLE}>
            <thead className={THEAD}>
              <tr>
                <th className="px-5 py-3.5">Employee</th>
                <th className="px-5 py-3.5">Leave</th>
                <th className="px-5 py-3.5">Dates</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className={TBODY}>
              {visible.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-5 py-4">
                    <Person name={l.employeeName} />
                  </td>
                  <td className="px-5 py-4">
                    {LEAVE_LABELS[l.type]}
                    {l.reason && (
                      <p className="mt-0.5 whitespace-pre-line text-muted">{l.reason}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    {formatDay(l.startDate)} – {formatDay(l.endDate)}
                    <p className="text-muted">{formatDays(l.days)}</p>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={l.status} />
                    {l.decisionNote && <p className="mt-1 text-muted">{l.decisionNote}</p>}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right">
                    <div className="flex justify-end gap-3">
                      {l.status === "pending" && (
                        <>
                          <button
                            onClick={() => setDeciding({ leave: l, action: "approved" })}
                            className="font-medium text-emerald-700 hover:underline"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setDeciding({ leave: l, action: "rejected" })}
                            className="font-medium text-red-700 hover:underline"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {l.status === "approved" && (
                        <button
                          onClick={() => setDeciding({ leave: l, action: "cancel" })}
                          className="font-medium text-red-700 hover:underline"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

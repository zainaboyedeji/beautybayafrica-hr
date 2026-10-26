"use client";

import { useState } from "react";
import type { StaffRequest } from "@hr/types";
import { Person } from "../../components/avatar";
import { CARD, INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../components/form-styles";
import Modal from "../../components/modal";
import { timeAgo } from "../../components/notice-card";
import { Notice } from "../../components/notice";
import PageHeader from "../../components/page-header";
import { apiSend, describeError, fetchRequests, useLoad } from "../../lib/api";
import { REQUEST_STATUS_STYLES, REQUEST_TYPES } from "../../lib/format";
import { LoadError, Loading } from "../../lib/status";

type Filter = "open" | "all";

/** What staff have asked HR for, waiting ones first. */
export default function RequestsPage() {
  const requests = useLoad(fetchRequests);
  const [filter, setFilter] = useState<Filter>("open");
  const [handling, setHandling] = useState<StaffRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const open = requests.data?.filter((r) => r.status === "open") ?? [];
  const shown = filter === "open" ? open : requests.data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon="inbox"
        eyebrow="Staff"
        title="Requests"
        description="What staff have asked HR for: new passwords, bank changes, letters and more."
      />
      <Notice text={notice} />
      {handling && (
        <Modal title={REQUEST_TYPES[handling.type].label} onClose={() => setHandling(null)}>
          <HandleForm
            request={handling}
            onCancel={() => setHandling(null)}
            onSaved={(message) => {
              setHandling(null);
              setNotice(message);
              void requests.reload();
            }}
          />
        </Modal>
      )}

      <div
        role="tablist"
        className="mt-6 inline-grid grid-cols-2 gap-1 rounded-full bg-white p-1 text-sm font-semibold shadow-soft ring-1 ring-line"
      >
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-5 py-2 transition ${
              filter === f ? "bg-brand-soft text-brand-deep" : "text-muted hover:text-ink"
            }`}
          >
            {f === "open" ? `Waiting (${open.length})` : "All"}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {requests.failed ? (
          <LoadError />
        ) : !requests.data ? (
          <Loading />
        ) : shown.length === 0 ? (
          <p className={`${CARD} text-center text-sm text-muted`}>
            {filter === "open" ? "Nothing waiting. All caught up." : "No requests yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((r) => (
              <li key={r.id} className={`${CARD} text-sm`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Person
                    name={r.employeeName}
                    detail={`${r.employeeNo} · ${REQUEST_TYPES[r.type].label} · ${timeAgo(r.createdAt)}`}
                  />
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${REQUEST_STATUS_STYLES[r.status]}`}
                  >
                    {r.status === "open" ? "Waiting" : r.status}
                  </span>
                </div>
                {r.details && <p className="mt-3 whitespace-pre-line">{r.details}</p>}
                {r.response && (
                  <p className="mt-3 rounded-2xl bg-surface-alt px-4 py-3">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                      {r.resolvedBy} replied {r.resolvedAt && timeAgo(r.resolvedAt)}
                    </span>
                    <span className="mt-1 block whitespace-pre-line">{r.response}</span>
                  </p>
                )}
                {r.status === "open" && (
                  <button onClick={() => setHandling(r)} className={`${PRIMARY_BUTTON} mt-4`}>
                    {r.type === "password_reset" ? "Give a temporary password" : "Deal with it"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Closes a request as done or declined, with a reply the employee sees. */
function HandleForm({
  request,
  onSaved,
  onCancel,
}: {
  request: StaffRequest;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const isPassword = request.type === "password_reset";
  const [password, setPassword] = useState("");
  const [response, setResponse] = useState(
    isPassword ? "Your temporary password is ready. Ask HR for it in person." : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (status: "done" | "declined") => {
    if (status === "done" && isPassword && password.length < 8) {
      setError("Give a temporary password of at least 8 characters");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiSend(
        `/requests/${request.id}`,
        "PUT",
        { status, response, ...(isPassword && status === "done" ? { password } : {}) },
        "Could not save",
      );
      onSaved(
        status === "declined"
          ? `${request.employeeName}'s request declined.`
          : isPassword
            ? `${request.employeeName} has a temporary password. Tell them it in person; they choose their own when they log in.`
            : `${request.employeeName}'s request done.`,
      );
    } catch (e) {
      setError(describeError(e, "Could not save"));
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send("done");
      }}
    >
      <p className="text-sm">
        <span className="font-semibold">{request.employeeName}</span> ({request.employeeNo})
      </p>
      {request.details && (
        <p className="whitespace-pre-line rounded-2xl bg-surface-alt px-4 py-3 text-sm">{request.details}</p>
      )}
      {request.type === "bank_change" && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Check the new account with {request.employeeName.split(" ")[0]} in person or by phone
          before changing it on the Employees page; requests to move a salary are a common fraud.
        </p>
      )}
      {isPassword && (
        <label className="text-sm font-medium">
          Temporary password{" "}
          <span className="font-normal text-muted">(at least 8 characters; they replace it when they log in)</span>
          <input
            autoFocus
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </label>
      )}
      <label className="text-sm font-medium">
        Reply to {request.employeeName.split(" ")[0]}{" "}
        <span className="font-normal text-muted">(they see this; needed if you decline)</span>
        <textarea
          rows={3}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          className={INPUT}
        />
      </label>
      {isPassword && (
        <p className="text-xs text-muted">
          Don&apos;t put the password in the reply. Tell them it in person or by phone.
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void send("declined")}
          className={`${SECONDARY_BUTTON} text-red-700`}
        >
          Decline
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : isPassword ? "Set password and close" : "Mark done"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useCallback, useState } from "react";
import type { Guarantor } from "@hr/types";
import { apiSend, describeError, fetchGuarantors, useLoad } from "../lib/api";
import { formatDay } from "../lib/format";
import { LoadError, Loading } from "../lib/status";
import ConfirmDialog from "./confirm-dialog";
import { INPUT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./form-styles";
import Icon from "./icons";
import Avatar from "./avatar";

const MAX_GUARANTORS = 3;
const RELATIONSHIPS = ["Parent", "Sibling", "Spouse", "Uncle", "Aunt", "Former employer", "Pastor / Imam", "Family friend"];

type Props = {
  /** Where this person's guarantors are listed and added. */
  path: string;
  /** HR can mark guarantors verified; employees see the mark. */
  isAdmin: boolean;
  /** Called after any change, e.g. to refresh counts elsewhere. */
  onChanged?: () => void;
};

/** A person's guarantors, with adding, editing and removing in place. */
export default function Guarantors({ path, isAdmin, onChanged }: Props) {
  const loader = useCallback(() => fetchGuarantors(path), [path]);
  const { data: list, failed, reload } = useLoad(loader);
  // `null` while adding a new one.
  const [editing, setEditing] = useState<Guarantor | null | undefined>();
  const [removing, setRemoving] = useState<Guarantor | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changed = async () => {
    await reload();
    onChanged?.();
  };

  const remove = async (g: Guarantor) => {
    setRemoving(null);
    setError(null);
    try {
      await apiSend(`/guarantors/${g.id}`, "DELETE", undefined, "Could not remove guarantor");
      await changed();
    } catch (e) {
      setError(describeError(e, "Could not remove guarantor"));
    }
  };

  const setVerified = async (g: Guarantor, verified: boolean) => {
    setError(null);
    try {
      await apiSend(`/guarantors/${g.id}/verified`, "PUT", { verified }, "Could not update guarantor");
      await changed();
    } catch (e) {
      setError(describeError(e, "Could not update guarantor"));
    }
  };

  if (failed) return <LoadError />;
  if (!list) return <Loading />;

  if (editing !== undefined)
    return (
      <GuarantorForm
        guarantor={editing}
        path={path}
        isAdmin={isAdmin}
        onCancel={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          void changed();
        }}
      />
    );

  return (
    <div>
      {removing && (
        <ConfirmDialog
          title="Remove guarantor"
          message={`Remove ${removing.name} as a guarantor?`}
          confirmLabel="Remove"
          danger
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {list.length === 0 ? (
        <p className="rounded-2xl bg-surface-alt px-4 py-6 text-center text-sm text-muted">
          {isAdmin
            ? "No guarantors on file yet. Add them here, or the employee can add them in the staff portal."
            : "You haven't added a guarantor yet. Add up to three people who can vouch for you."}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((g) => (
            <li key={g.id} className="rounded-3xl bg-white p-5 text-sm shadow-soft ring-1 ring-line">
              <div className="flex items-start gap-3">
                <Avatar name={g.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{g.name}</p>
                  <p className="text-muted">{g.relationship}</p>
                </div>
                {g.verifiedAt ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    <Icon name="check" className="h-3.5 w-3.5" />
                    Verified
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                    Not verified
                  </span>
                )}
              </div>
              <dl className="mt-4 grid gap-1.5">
                <Line label="Phone" value={g.phone} />
                {g.email && <Line label="Email" value={g.email} />}
                <Line label="Address" value={g.address} />
                {(g.occupation || g.workplace) && (
                  <Line label="Work" value={[g.occupation, g.workplace].filter(Boolean).join(" at ")} />
                )}
              </dl>
              <p className="mt-3 text-xs text-muted">
                Added by {g.addedBy === "admin" ? "HR" : "the employee"}
                {g.verifiedAt && ` · verified ${formatDay(g.verifiedAt.slice(0, 10))}`}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3 font-semibold">
                <button onClick={() => setEditing(g)} className="text-brand-deep hover:underline">
                  Edit
                </button>
                {isAdmin && (
                  <button
                    onClick={() => void setVerified(g, !g.verifiedAt)}
                    className={g.verifiedAt ? "text-muted hover:underline" : "text-emerald-700 hover:underline"}
                  >
                    {g.verifiedAt ? "Mark not verified" : "Mark verified"}
                  </button>
                )}
                <button onClick={() => setRemoving(g)} className="ml-auto text-red-700 hover:underline">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.length < MAX_GUARANTORS && (
        <button onClick={() => setEditing(null)} className={`${PRIMARY_BUTTON} mt-4`}>
          <Icon name="plus" className="h-4 w-4" />
          Add guarantor
        </button>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function GuarantorForm({
  guarantor,
  path,
  isAdmin,
  onSaved,
  onCancel,
}: {
  guarantor: Guarantor | null;
  path: string;
  isAdmin: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: guarantor?.name ?? "",
    relationship: guarantor?.relationship ?? "",
    phone: guarantor?.phone ?? "",
    email: guarantor?.email ?? "",
    address: guarantor?.address ?? "",
    occupation: guarantor?.occupation ?? "",
    workplace: guarantor?.workplace ?? "",
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
      await apiSend(
        guarantor ? `/guarantors/${guarantor.id}` : path,
        guarantor ? "PUT" : "POST",
        form,
        "Could not save guarantor",
      );
      onSaved();
    } catch (e) {
      setError(describeError(e, "Could not save guarantor"));
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
      <p className="font-display text-xl font-semibold">
        {guarantor ? `Edit ${guarantor.name}` : "New guarantor"}
      </p>
      {guarantor?.verifiedAt && !isAdmin && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          HR has verified this guarantor. If you change their details, HR will need to check them again.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Full name
          <input autoFocus required {...field("name")} />
        </label>
        <label className="text-sm font-medium">
          Relationship
          <input required list="relationships" placeholder="e.g. Uncle" {...field("relationship")} />
          <datalist id="relationships">
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label className="text-sm font-medium">
          Phone
          <input required type="tel" {...field("phone")} />
        </label>
        <label className="text-sm font-medium">
          Email <span className="font-normal text-muted">(optional)</span>
          <input type="email" {...field("email")} />
        </label>
      </div>
      <label className="text-sm font-medium">
        Home address
        <textarea required rows={2} {...field("address")} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Occupation <span className="font-normal text-muted">(optional)</span>
          <input placeholder="e.g. Civil servant" {...field("occupation")} />
        </label>
        <label className="text-sm font-medium">
          Place of work <span className="font-normal text-muted">(optional)</span>
          <input {...field("workplace")} />
        </label>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : "Save guarantor"}
        </button>
      </div>
    </form>
  );
}

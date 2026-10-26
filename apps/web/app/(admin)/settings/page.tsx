"use client";

import { useState } from "react";
import type { Admin } from "@hr/types";
import ConfirmDialog from "../../components/confirm-dialog";
import {
  CARD,
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "../../components/form-styles";
import Icon from "../../components/icons";
import Modal from "../../components/modal";
import { Notice } from "../../components/notice";
import PageHeader from "../../components/page-header";
import {
  apiSend,
  describeError,
  downloadFile,
  fetchAdmins,
  fetchHolidays,
  useLoad,
} from "../../lib/api";
import { useSession } from "../../lib/auth";
import { formatDay, today } from "../../lib/format";
import { LoadError, Loading } from "../../lib/status";

export default function SettingsPage() {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon="key"
        eyebrow="Office"
        title="Settings"
        description="Who can use the HR office, public holidays, and backups."
      />
      <Notice text={notice} />
      <div className="mt-6 flex flex-col gap-6">
        <Admins onNotice={setNotice} />
        <Holidays onNotice={setNotice} />
        <Backup onNotice={setNotice} />
      </div>
    </div>
  );
}

type SectionProps = { onNotice: (message: string) => void };

function Section({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// --- Admins -----------------------------------------------------------------

type AdminDialog =
  | { kind: "add" }
  | { kind: "password"; admin: Admin }
  | { kind: "active"; admin: Admin };

function Admins({ onNotice }: SectionProps) {
  const admins = useLoad(fetchAdmins);
  const session = useSession(["admin"]);
  const [dialog, setDialog] = useState<AdminDialog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const done = (message: string) => {
    setDialog(null);
    onNotice(message);
    void admins.reload();
  };

  const setActive = async (admin: Admin, active: boolean) => {
    setDialog(null);
    setError(null);
    try {
      await apiSend(`/admins/${admin.id}/active`, "PUT", { active }, "Could not save");
      done(active ? `${admin.name} can log in again.` : `${admin.name} is deactivated and logged out.`);
    } catch (e) {
      setError(describeError(e, "Could not save"));
    }
  };

  return (
    <Section
      title="Admins"
      description="Give each person who runs HR their own login, so the activity log shows who did what. The owner password (ADMIN_PASSWORD) always works too; keep it for emergencies."
    >
      {dialog?.kind === "add" && (
        <Modal title="Add admin" onClose={() => setDialog(null)}>
          <AdminForm onCancel={() => setDialog(null)} onSaved={done} />
        </Modal>
      )}
      {dialog?.kind === "password" && (
        <Modal title={`New password · ${dialog.admin.name}`} onClose={() => setDialog(null)}>
          <PasswordForm admin={dialog.admin} onCancel={() => setDialog(null)} onSaved={done} />
        </Modal>
      )}
      {dialog?.kind === "active" && (
        <ConfirmDialog
          title={dialog.admin.deactivatedAt ? "Reactivate admin" : "Deactivate admin"}
          message={
            dialog.admin.deactivatedAt
              ? `Let ${dialog.admin.name} log in to the HR office again?`
              : `Shut ${dialog.admin.name} out of the HR office now? They are logged out straight away.`
          }
          confirmLabel={dialog.admin.deactivatedAt ? "Reactivate" : "Deactivate"}
          danger={!dialog.admin.deactivatedAt}
          onConfirm={() => setActive(dialog.admin, !!dialog.admin.deactivatedAt)}
          onClose={() => setDialog(null)}
        />
      )}
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {admins.failed ? (
        <LoadError />
      ) : !admins.data ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-line">
          {admins.data.length === 0 && (
            <li className="py-2 text-sm text-muted">
              No admins yet: only the owner password can log in.
            </li>
          )}
          {admins.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className={a.deactivatedAt ? "text-muted" : ""}>
                <p className="font-medium">
                  {a.name}
                  {session?.name === a.name && <span className="text-muted"> (you)</span>}
                </p>
                <p className="text-sm text-muted">
                  {a.email}
                  {a.deactivatedAt && ` · deactivated ${formatDay(new Date(a.deactivatedAt).toLocaleDateString("en-CA"))}`}
                </p>
              </div>
              <div className="flex gap-3 text-sm">
                <button
                  onClick={() => setDialog({ kind: "password", admin: a })}
                  className="font-medium text-brand-deep hover:underline"
                >
                  New password
                </button>
                <button
                  onClick={() => setDialog({ kind: "active", admin: a })}
                  className={`font-medium hover:underline ${a.deactivatedAt ? "text-brand-deep" : "text-red-700"}`}
                >
                  {a.deactivatedAt ? "Reactivate" : "Deactivate"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => setDialog({ kind: "add" })} className={`${PRIMARY_BUTTON} mt-4`}>
        <Icon name="plus" className="h-4 w-4" />
        Add admin
      </button>
    </Section>
  );
}

function AdminForm({ onSaved, onCancel }: { onSaved: (m: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend("/admins", "POST", form, "Could not add admin");
      onSaved(`${form.name} can now log in on the Admin tab with ${form.email.trim().toLowerCase()}. Tell them the password in person.`);
    } catch (e) {
      setError(describeError(e, "Could not add admin"));
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
        Name
        <input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />
      </label>
      <label className="text-sm font-medium">
        Email <span className="font-normal text-muted">(they log in with it)</span>
        <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT} />
      </label>
      <label className="text-sm font-medium">
        Password <span className="font-normal text-muted">(at least 8 characters)</span>
        <input required minLength={8} type="text" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={INPUT} />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>Cancel</button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>{saving ? "Adding…" : "Add admin"}</button>
      </div>
    </form>
  );
}

function PasswordForm({ admin, onSaved, onCancel }: {
  admin: Admin;
  onSaved: (m: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend(`/admins/${admin.id}/password`, "PUT", { password }, "Could not save password");
      onSaved(`New password saved for ${admin.name}. Their other logins have ended.`);
    } catch (e) {
      setError(describeError(e, "Could not save password"));
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
        {admin.name} is logged out everywhere and logs in again with the new password.
      </p>
      <label className="text-sm font-medium">
        New password <span className="font-normal text-muted">(at least 8 characters)</span>
        <input autoFocus required minLength={8} type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>Cancel</button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>{saving ? "Saving…" : "Set password"}</button>
      </div>
    </form>
  );
}

// --- Public holidays --------------------------------------------------------

function Holidays({ onNotice }: SectionProps) {
  const holidays = useLoad(fetchHolidays);
  const [form, setForm] = useState({ day: today(), name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const year = today().slice(0, 4);
  const upcoming = holidays.data?.filter((h) => h.day.slice(0, 4) >= year);

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend("/holidays", "POST", form, "Could not add holiday");
      onNotice(`${form.name} added on ${formatDay(form.day)}.`);
      setForm({ day: form.day, name: "" });
      await holidays.reload();
    } catch (e) {
      setError(describeError(e, "Could not add holiday"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (day: string, name: string) => {
    setError(null);
    try {
      await apiSend(`/holidays/${day}`, "DELETE", undefined, "Could not remove holiday");
      onNotice(`${name} removed.`);
      await holidays.reload();
    } catch (e) {
      setError(describeError(e, "Could not remove holiday"));
    }
  };

  return (
    <Section
      title="Public holidays"
      description="These days don't count as leave, and aren't taken off for unpaid leave. Add the Eid and Mawlid holidays once the government announces them, and move any holiday it moves off a weekend. Leave already booked keeps its day count."
    >
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {holidays.failed ? (
        <LoadError />
      ) : !upcoming ? (
        <Loading />
      ) : (
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {upcoming.map((h) => (
            <li key={h.day} className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm">
              <span>
                <span className="font-medium">{h.name}</span>
                <span className="text-muted"> · {formatDay(h.day)}</span>
              </span>
              <button
                onClick={() => void remove(h.day, h.name)}
                aria-label={`Remove ${h.name}`}
                className="rounded-md px-2 text-lg leading-none text-muted hover:bg-brand-soft hover:text-red-700"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="text-sm font-medium">
          Day
          <input required type="date" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} className={INPUT} />
        </label>
        <label className="min-w-56 flex-1 text-sm font-medium">
          Holiday
          <input required placeholder="e.g. Eid-el-Fitr" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />
        </label>
        <button type="submit" disabled={saving} className={SECONDARY_BUTTON}>
          <Icon name="plus" className="h-4 w-4" />
          {saving ? "Adding…" : "Add holiday"}
        </button>
      </form>
    </Section>
  );
}

// --- Backup -----------------------------------------------------------------

function Backup({ onNotice }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadFile("/backup", `hr-backup-${today()}.json`, "Could not download the backup");
      onNotice("Backup downloaded. Keep it somewhere safe, away from this computer.");
    } catch (e) {
      setError(describeError(e, "Could not download the backup"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Backup"
      description="A copy of all HR data (staff, pay, leave, payslips, guarantors and the activity log) in one file. Download one at least once a month and after each payroll, and keep it somewhere safe, e.g. a company cloud drive. It contains salaries and bank details, so treat it like a payslip. Passwords aren't included."
    >
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} onClick={() => void download()} className={SECONDARY_BUTTON}>
        <Icon name="download" className="h-4 w-4" />
        {busy ? "Preparing…" : "Download backup"}
      </button>
    </Section>
  );
}

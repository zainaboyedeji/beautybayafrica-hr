"use client";

import { useRef, useState } from "react";
import {
  COMPANY_EMAIL_DOMAIN,
  type Admin,
  type ContractTemplate,
  type OutboxEmail,
} from "@hr/types";
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
  fetchContractTemplates,
  fetchEmails,
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
        description="Who can use the HR office, contracts, emails, public holidays and backups."
      />
      <Notice text={notice} />
      <div className="mt-6 flex flex-col gap-6">
        <Admins onNotice={setNotice} />
        <ContractTemplates onNotice={setNotice} />
        <EmailsSent />
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
      description={`Give each person who runs HR their own login, so the activity log shows who did what. Admins log in with their @${COMPANY_EMAIL_DOMAIN} email. The owner's login is set on the server (ADMIN_EMAIL and ADMIN_PASSWORD), so it can always be recovered there.`}
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
              No admins yet. Set ADMIN_EMAIL and ADMIN_PASSWORD on the server for the owner.
            </li>
          )}
          {admins.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className={a.deactivatedAt ? "text-muted" : ""}>
                <p className="font-medium">
                  {a.name}
                  {a.isOwner && (
                    <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-deep">
                      Owner
                    </span>
                  )}
                  {session?.name === a.name && <span className="text-muted"> (you)</span>}
                </p>
                <p className="text-sm text-muted">
                  {a.email}
                  {a.deactivatedAt && ` · deactivated ${formatDay(new Date(a.deactivatedAt).toLocaleDateString("en-CA"))}`}
                </p>
              </div>
              {a.isOwner ? (
                <p className="text-xs text-muted">Changed on the server only</p>
              ) : (
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
              )}
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
        Email <span className="font-normal text-muted">(@{COMPANY_EMAIL_DOMAIN} only; they log in with it)</span>
        <input required type="email" placeholder={`name@${COMPANY_EMAIL_DOMAIN}`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT} />
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

// --- Contract templates -----------------------------------------------------

// The blanks a template can use; each is filled in for the person it's sent to.
const BLANKS: [string, string][] = [
  ["name", "Full name"],
  ["first_name", "First name"],
  ["job_title", "Job title"],
  ["department", "Department"],
  ["employment_type", "Full-time, part-time…"],
  ["start_date", "Start date"],
  ["basic_salary", "Basic salary"],
  ["allowances", "Allowances, listed"],
  ["monthly_pay", "Basic + allowances"],
  ["annual_leave_days", "Leave days a year"],
  ["work_email", "Work email"],
  ["staff_number", "Staff number"],
  ["company", "Company name"],
  ["today", "Date it's sent"],
];

function ContractTemplates({ onNotice }: SectionProps) {
  const templates = useLoad(fetchContractTemplates);
  const [editing, setEditing] = useState<ContractTemplate | "new" | null>(null);
  const [removing, setRemoving] = useState<ContractTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (t: ContractTemplate) => {
    setRemoving(null);
    setError(null);
    try {
      await apiSend(`/contract-templates/${t.id}`, "DELETE", undefined, "Could not delete it");
      onNotice(`"${t.name}" deleted. Contracts already sent keep their wording.`);
      await templates.reload();
    } catch (e) {
      setError(describeError(e, "Could not delete it"));
    }
  };

  return (
    <Section
      title="Contract templates"
      description="The terms and conditions new staff are sent. Blanks like {{name}} or {{basic_salary}} are filled in for each person. Editing a template doesn't change contracts already sent. Have the wording checked by a lawyer."
    >
      {editing && (
        <Modal wide title={editing === "new" ? "New contract template" : `Edit · ${editing.name}`} onClose={() => setEditing(null)}>
          <TemplateForm
            template={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={(message) => {
              setEditing(null);
              onNotice(message);
              void templates.reload();
            }}
          />
        </Modal>
      )}
      {removing && (
        <ConfirmDialog
          title="Delete template"
          message={`Delete "${removing.name}"? Contracts already sent with it are kept.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {templates.failed ? (
        <LoadError />
      ) : !templates.data ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-line">
          {templates.data.length === 0 && (
            <li className="py-2 text-sm text-muted">No templates yet. Add one to send contracts.</li>
          )}
          {templates.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-sm text-muted">
                  Last changed {formatDay(new Date(t.updatedAt).toLocaleDateString("en-CA"))}
                </p>
              </div>
              <div className="flex gap-3 text-sm">
                <button onClick={() => setEditing(t)} className="font-medium text-brand-deep hover:underline">
                  Edit
                </button>
                <button onClick={() => setRemoving(t)} className="font-medium text-red-700 hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => setEditing("new")} className={`${PRIMARY_BUTTON} mt-4`}>
        <Icon name="plus" className="h-4 w-4" />
        New template
      </button>
    </Section>
  );
}

function TemplateForm({
  template,
  onSaved,
  onCancel,
}: {
  template: ContractTemplate | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const unknown = [...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((b) => !BLANKS.some(([key]) => key === b) && b !== "personal_email");

  // Puts a blank where the cursor is.
  const insert = (blank: string) => {
    const area = text.current;
    const at = area?.selectionStart ?? body.length;
    const next = `${body.slice(0, at)}{{${blank}}}${body.slice(area?.selectionEnd ?? at)}`;
    setBody(next);
    requestAnimationFrame(() => {
      area?.focus();
      const end = at + blank.length + 4;
      area?.setSelectionRange(end, end);
    });
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend(
        template ? `/contract-templates/${template.id}` : "/contract-templates",
        template ? "PUT" : "POST",
        { name, body },
        "Could not save the template",
      );
      onSaved(`"${name}" saved.`);
    } catch (e) {
      setError(describeError(e, "Could not save the template"));
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
        Name <span className="font-normal text-muted">(also the contract&apos;s title)</span>
        <input required autoFocus placeholder="e.g. Full-time employment" value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
      </label>
      <div>
        <p className="text-sm font-medium">Blanks <span className="font-normal text-muted">(click to add where the cursor is)</span></p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {BLANKS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => insert(key)}
              title={label}
              className="rounded-full border border-line-strong bg-white px-2.5 py-1 font-mono text-xs transition hover:border-brand hover:bg-brand-soft/40"
            >
              {`{{${key}}}`}
            </button>
          ))}
        </div>
      </div>
      <label className="text-sm font-medium">
        Terms and conditions{" "}
        <span className="font-normal text-muted">
          (leave a blank line between paragraphs; a short line in CAPITALS or starting &quot;1.&quot; becomes a heading)
        </span>
        <textarea
          ref={text}
          required
          rows={18}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={`${INPUT} font-mono text-sm leading-relaxed`}
        />
      </label>
      {unknown.length > 0 && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Not a known blank, so it will show as typed: {unknown.map((u) => `{{${u}}}`).join(", ")}
        </p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>Cancel</button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>{saving ? "Saving…" : "Save template"}</button>
      </div>
    </form>
  );
}

// --- Emails sent -------------------------------------------------------------

const EMAIL_STATUS: Record<OutboxEmail["status"], { label: string; tint: string }> = {
  sent: { label: "Sent", tint: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Failed", tint: "bg-red-100 text-red-700" },
  not_sent: { label: "Not sent", tint: "bg-amber-100 text-amber-800" },
};

function EmailsSent() {
  const emails = useLoad(fetchEmails);
  const [open, setOpen] = useState<string | null>(null);
  const unsent = emails.data?.some((e) => e.status === "not_sent");

  return (
    <Section
      title="Emails sent"
      description="Contracts and account set-up emails to staff's personal addresses, newest first."
    >
      {unsent && (
        <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Email isn&apos;t set up on the server yet, so emails marked &quot;Not sent&quot; didn&apos;t go out.
          Open one to copy its link and send it yourself, or set up email (SMTP) on the server.
        </p>
      )}
      {emails.failed ? (
        <LoadError />
      ) : !emails.data ? (
        <Loading />
      ) : emails.data.length === 0 ? (
        <p className="text-sm text-muted">No emails yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {emails.data.map((m) => (
            <li key={m.id} className="py-3 text-sm">
              <button onClick={() => setOpen(open === m.id ? null : m.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                <span className="min-w-0">
                  <span className="block font-medium">{m.subject}</span>
                  <span className="block text-muted">
                    To {m.to} · {new Date(m.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${EMAIL_STATUS[m.status].tint}`}>
                  {EMAIL_STATUS[m.status].label}
                </span>
              </button>
              {open === m.id && (
                <div className="mt-3 rounded-2xl bg-surface-alt p-4">
                  {m.error && <p className="mb-2 text-red-700">{m.error}</p>}
                  <pre className="whitespace-pre-wrap break-words font-sans">{m.body}</pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

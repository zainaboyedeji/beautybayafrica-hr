"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import type { Employee, EmploymentType, PayeMode, PayItem, PayItemKind } from "@hr/types";
import ConfirmDialog from "../../components/confirm-dialog";
import PhotoPicker from "../../components/photo-picker";
import Guarantors from "../../components/guarantors";
import { Person } from "../../components/avatar";
import {
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SELECT,
  TABLE, TABLE_CARD, TBODY, THEAD,
} from "../../components/form-styles";
import Icon from "../../components/icons";
import PageHeader from "../../components/page-header";
import Modal from "../../components/modal";
import { Notice } from "../../components/notice";
import SearchBox, { matches, NoMatches } from "../../components/search-box";
import {
  apiSend,
  describeError,
  fetchDepartments,
  fetchEmployees,
  fetchPayItems,
  money,
  useLoad,
} from "../../lib/api";
import { EMPLOYMENT_LABELS, formatDay, today } from "../../lib/format";
import { LoadError, Loading } from "../../lib/status";

// For inputs on one row, without the gap under a label.
const INLINE_INPUT = INPUT.replace("mt-1 ", "");

const hasLeft = (e: Employee) => !!e.endDate && e.endDate < today();

type Dialog =
  | { kind: "edit"; employee: Employee | null }
  | { kind: "login"; employee: Employee }
  | { kind: "guarantors"; employee: Employee }
  | { kind: "active"; employee: Employee }
  | { kind: "delete"; employee: Employee };

export default function EmployeesPage() {
  const employees = useLoad(fetchEmployees);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [showLeavers, setShowLeavers] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = employees.data?.filter(
    (e) =>
      (showLeavers || !hasLeft(e)) &&
      (!department || e.departmentId === department) &&
      matches(search, e.name, e.employeeNo, e.email, e.jobTitle, e.phone),
  );
  const departments = [
    ...new Map(
      (employees.data ?? [])
        .filter((e) => e.departmentId)
        .map((e) => [e.departmentId!, e.departmentName!]),
    ),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const close = () => setDialog(null);
  // A photo is saved as soon as it is chosen, so show it even if the form is cancelled.
  const closeAndReload = () => {
    setDialog(null);
    void employees.reload();
  };
  const saved = (message: string) => {
    setDialog(null);
    setNotice(message);
    void employees.reload();
  };

  const setActive = async (employee: Employee, active: boolean) => {
    setDialog(null);
    setError(null);
    try {
      await apiSend(`/employees/${employee.id}/active`, "PUT", { active }, "Could not save");
      setNotice(
        active
          ? `${employee.name} is active again.`
          : `${employee.name} is deactivated and has been logged out of the staff portal.`,
      );
      await employees.reload();
    } catch (e) {
      setError(describeError(e, "Could not save"));
    }
  };

  const remove = async (employee: Employee) => {
    setDialog(null);
    setError(null);
    try {
      await apiSend(`/employees/${employee.id}`, "DELETE", undefined, "Could not delete employee");
      setNotice(`${employee.name} deleted.`);
      await employees.reload();
    } catch (e) {
      setError(describeError(e, "Could not delete employee"));
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        icon="users"
        eyebrow="People"
        title="Employees"
        description={
          employees.data
            ? `${employees.data.filter((e) => !hasLeft(e)).length} people on the team`
            : undefined
        }
      >
        <button
          onClick={() => setDialog({ kind: "edit", employee: null })}
          className={PRIMARY_BUTTON}
        >
          <Icon name="plus" className="h-4 w-4" />
          Add employee
        </button>
      </PageHeader>
      <Notice text={notice} />
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {dialog?.kind === "edit" && (
        <Modal
          wide
          title={dialog.employee ? `Edit ${dialog.employee.name}` : "Add employee"}
          onClose={closeAndReload}
        >
          <EmployeeForm employee={dialog.employee} onCancel={closeAndReload} onSaved={saved} />
        </Modal>
      )}
      {dialog?.kind === "login" && (
        <Modal title={`Staff portal · ${dialog.employee.name}`} onClose={close}>
          <LoginForm employee={dialog.employee} onCancel={close} onSaved={saved} />
        </Modal>
      )}
      {dialog?.kind === "guarantors" && (
        <Modal wide title={`Guarantors · ${dialog.employee.name}`} onClose={close}>
          <Guarantors
            path={`/employees/${dialog.employee.id}/guarantors`}
            isAdmin
            onChanged={() => void employees.reload()}
          />
        </Modal>
      )}
      {dialog?.kind === "active" && (
        <ConfirmDialog
          title={dialog.employee.deactivatedAt ? "Reactivate employee" : "Deactivate employee"}
          message={
            dialog.employee.deactivatedAt
              ? `Let ${dialog.employee.name} use the staff portal again?`
              : `Shut ${dialog.employee.name} out of the staff portal now? They are logged out straight away. Their records and pay stay as they are; to stop their pay, set a leaving date.`
          }
          confirmLabel={dialog.employee.deactivatedAt ? "Reactivate" : "Deactivate"}
          danger={!dialog.employee.deactivatedAt}
          onConfirm={() => setActive(dialog.employee, !!dialog.employee.deactivatedAt)}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="Delete employee"
          message={`Delete ${dialog.employee.name} and their leave records? Only do this for someone added by mistake; for someone who has left, set a leaving date instead.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(dialog.employee)}
          onClose={close}
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search by name, staff number, email or job"
          />
        </div>
        <select
          aria-label="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className={SELECT}
        >
          <option value="">All departments</option>
          {departments.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showLeavers}
            onChange={(e) => setShowLeavers(e.target.checked)}
            className="accent-brand-deep"
          />
          Show people who have left
        </label>
      </div>

      <div className="mt-4">
        {employees.failed ? (
          <LoadError />
        ) : !employees.data || !visible ? (
          <Loading />
        ) : employees.data.length === 0 ? (
          <p className="text-sm text-muted">No employees yet. Add your first one.</p>
        ) : visible.length === 0 ? (
          <NoMatches />
        ) : (
          <div className={TABLE_CARD}><table className={TABLE}>
            <thead className={THEAD}>
              <tr>
                <th className="px-5 py-3.5">Employee</th>
                <th className="px-5 py-3.5">Job</th>
                <th className="px-5 py-3.5">Started</th>
                <th className="px-5 py-3.5 text-right">Monthly pay</th>
                <th className="px-5 py-3.5 text-right">Annual leave left</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className={TBODY}>
              {visible.map((e) => (
                <tr key={e.id} className={`align-top ${hasLeft(e) ? "text-muted" : ""}`}>
                  <td className="px-5 py-4">
                    <Person
                      name={e.name}
                      detail={`${e.employeeNo} · ${e.email}`}
                      employeeId={e.id}
                      photoVersion={e.photoVersion}
                    />
                    {e.deactivatedAt && (
                      <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Deactivated {formatDay(new Date(e.deactivatedAt).toLocaleDateString("en-CA"))}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {e.jobTitle}
                    <p className="text-muted">
                      {[e.departmentName, EMPLOYMENT_LABELS[e.employmentType]]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    {formatDay(e.startDate)}
                    {e.endDate && (
                      <p className="text-muted">
                        {hasLeft(e) ? "Left" : "Leaving"} {formatDay(e.endDate)}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right">
                    <span className="font-medium">
                      {money.format(e.baseSalary + e.monthlyAllowances)}
                    </span>
                    <p className="text-xs text-muted">
                      Basic {money.format(e.baseSalary)}
                      {e.monthlyAllowances > 0 &&
                        ` + ${money.format(e.monthlyAllowances)} allowances`}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <LeaveMeter left={e.annualLeaveDays - e.annualLeaveTaken} of={e.annualLeaveDays} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setDialog({ kind: "edit", employee: e })}
                        className="font-medium text-brand-deep hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDialog({ kind: "guarantors", employee: e })}
                        className="font-medium text-brand-deep hover:underline"
                        title={`${e.verifiedGuarantors} of ${e.guarantors} verified`}
                      >
                        Guarantors
                        <span
                          className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${
                            e.guarantors === 0
                              ? "bg-red-50 text-red-700"
                              : e.verifiedGuarantors === e.guarantors
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {e.guarantors}
                        </span>
                      </button>
                      <button
                        onClick={() => setDialog({ kind: "login", employee: e })}
                        className="font-medium text-brand-deep hover:underline"
                        title={
                          e.deactivatedAt
                            ? "Deactivated: can't use the staff portal"
                            : e.canLogIn
                              ? "Can use the staff portal"
                              : "No portal access yet"
                        }
                      >
                        Portal{e.canLogIn && !e.deactivatedAt ? " ✓" : ""}
                      </button>
                      <button
                        onClick={() => setDialog({ kind: "active", employee: e })}
                        className={`font-medium hover:underline ${e.deactivatedAt ? "text-brand-deep" : "text-red-700"}`}
                      >
                        {e.deactivatedAt ? "Reactivate" : "Deactivate"}
                      </button>
                      <button
                        onClick={() => setDialog({ kind: "delete", employee: e })}
                        className="font-medium text-red-700 hover:underline"
                      >
                        Delete
                      </button>
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

/** Days of annual leave left, with a small bar showing how much is left. */
function LeaveMeter({ left, of }: { left: number; of: number }) {
  const share = of === 0 ? 0 : Math.max(0, Math.min(1, left / of));
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span>
        <span className="font-semibold">{left}</span>
        <span className="text-muted"> of {of}</span>
      </span>
      <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-brand-soft/60">
        <span
          className="block h-full rounded-full bg-gradient-to-r from-brand to-brand-hover"
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </span>
  );
}

type FormProps = {
  employee: Employee;
  onSaved: (message: string) => void;
  onCancel: () => void;
};

function EmployeeForm({
  employee,
  onSaved,
  onCancel,
}: Omit<FormProps, "employee"> & { employee: Employee | null }) {
  const departments = useLoad(fetchDepartments);
  const [form, setForm] = useState({
    employeeNo: employee?.employeeNo ?? "",
    name: employee?.name ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    jobTitle: employee?.jobTitle ?? "",
    departmentId: employee?.departmentId ?? "",
    employmentType: employee?.employmentType ?? ("full_time" as EmploymentType),
    startDate: employee?.startDate ?? today(),
    endDate: employee?.endDate ?? "",
    baseSalary: employee ? String(employee.baseSalary) : "",
    annualLeaveDays: String(employee?.annualLeaveDays ?? 20),
    bankName: employee?.bankName ?? "",
    bankAccountNumber: employee?.bankAccountNumber ?? "",
    bankAccountName: employee?.bankAccountName ?? "",
    pensionPercent: String(employee?.pensionPercent ?? 0),
    paye: employee?.paye ?? ("none" as PayeMode),
    payeAmount: employee?.payeAmount ? String(employee.payeAmount) : "",
    employerPensionPercent: String(employee?.employerPensionPercent ?? 0),
    taxId: employee?.taxId ?? "",
    pensionProvider: employee?.pensionProvider ?? "",
    pensionPin: employee?.pensionPin ?? "",
    dateOfBirth: employee?.dateOfBirth ?? "",
    homeAddress: employee?.homeAddress ?? "",
    emergencyName: employee?.emergencyName ?? "",
    emergencyRelationship: employee?.emergencyRelationship ?? "",
    emergencyPhone: employee?.emergencyPhone ?? "",
    password: "",
  });
  // The photo is saved straight away, so it shows the latest version.
  const [photoVersion, setPhotoVersion] = useState(employee?.photoVersion);
  const [nhf, setNhf] = useState(employee?.nhf ?? false);
  // A new employee starts with no allowances; an existing one's are loaded.
  const [items, setItems] = useState<DraftItem[] | null>(employee ? null : []);
  const [itemsFailed, setItemsFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    fetchPayItems(employee.id)
      .then((found: PayItem[]) =>
        setItems(found.map((i) => ({ ...i, amount: String(i.amount) }))),
      )
      .catch(() => setItemsFailed(true));
  }, [employee]);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (
      e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    ) => setForm({ ...form, [key]: e.target.value }),
    className: INPUT,
  });

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await apiSend<Employee>(
        employee ? `/employees/${employee.id}` : "/employees",
        employee ? "PUT" : "POST",
        {
          ...form,
          baseSalary: Number(form.baseSalary),
          annualLeaveDays: Number(form.annualLeaveDays),
          pensionPercent: Number(form.pensionPercent || 0),
          payeAmount: Number(form.payeAmount || 0),
          employerPensionPercent: Number(form.employerPensionPercent || 0),
          nhf,
          // Left out while still loading, so the saved lines stay as they are.
          ...(items ? { items: items.map((i) => ({ ...i, amount: Number(i.amount) })) } : {}),
        },
        "Could not save employee",
      );
      onSaved(`${saved.name} saved.`);
    } catch (e) {
      setError(describeError(e, "Could not save employee"));
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
      {employee && (
        <PhotoPicker
          employee={{ ...employee, photoVersion }}
          path={`/employees/${employee.id}/photo`}
          onChanged={(updated) => setPhotoVersion(updated.photoVersion)}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Staff number
          <input required autoFocus placeholder="e.g. BBA-014" {...field("employeeNo")} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Full name
          <input required {...field("name")} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Work email
          <input required type="email" {...field("email")} />
        </label>
        <label className="text-sm font-medium">
          Phone <span className="font-normal text-muted">(optional)</span>
          <input type="tel" {...field("phone")} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Job title
          <input required placeholder="e.g. Sales attendant" {...field("jobTitle")} />
        </label>
        <label className="text-sm font-medium">
          Department
          <select {...field("departmentId")}>
            <option value="">None</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Employment
          <select {...field("employmentType")}>
            {(Object.keys(EMPLOYMENT_LABELS) as EmploymentType[]).map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Start date
          <input required type="date" {...field("startDate")} />
        </label>
        <label className="text-sm font-medium">
          Leaving date <span className="font-normal text-muted">(if any)</span>
          <input type="date" min={form.startDate} {...field("endDate")} />
        </label>
        <label className="text-sm font-medium">
          Annual leave (days/year)
          <input required type="number" min={0} max={365} step={1} {...field("annualLeaveDays")} />
        </label>
      </div>

      <p className="mt-2 text-sm font-semibold">
        Monthly pay <span className="font-normal text-muted">(you decide every line)</span>
      </p>
      <label className="text-sm font-medium">
        Basic salary
        <input required type="number" min={0} step={0.01} {...field("baseSalary")} />
      </label>
      {itemsFailed ? (
        <LoadError />
      ) : !items ? (
        <Loading />
      ) : (
        <>
          <PayLines kind="allowance" title="Allowances" ideas={ALLOWANCE_IDEAS} items={items} onChange={setItems} />
          <PayLines kind="deduction" title="Deductions" ideas={DEDUCTION_IDEAS} items={items} onChange={setItems} />
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Pension <span className="font-normal text-muted">(% of basic + allowances)</span>
          <input type="number" min={0} max={100} step={0.01} placeholder="0 = none" {...field("pensionPercent")} />
        </label>
        <label className="text-sm font-medium">
          PAYE tax
          <select {...field("paye")}>
            <option value="none">None</option>
            <option value="fixed">Fixed amount I enter</option>
            <option value="auto">Work it out (Nigeria tax bands)</option>
          </select>
        </label>
        {form.paye === "fixed" && (
          <label className="text-sm font-medium">
            PAYE per month
            <input required type="number" min={0.01} step={0.01} {...field("payeAmount")} />
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Employer pension <span className="font-normal text-muted">(% paid on top)</span>
          <input type="number" min={0} max={100} step={0.01} placeholder="0 = none" {...field("employerPensionPercent")} />
        </label>
        <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium sm:col-span-2">
          <input
            type="checkbox"
            checked={nhf}
            onChange={(e) => setNhf(e.target.checked)}
            className="h-4 w-4 accent-brand-deep"
          />
          Take NHF <span className="font-normal text-muted">(2.5% of basic salary)</span>
        </label>
      </div>
      <PaySummary form={form} nhf={nhf} items={items ?? []} />

      <p className="mt-2 text-sm font-semibold">
        Personal details <span className="font-normal text-muted">(the employee can also update these in the staff portal)</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Date of birth
          <input type="date" max={today()} {...field("dateOfBirth")} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Home address
          <input {...field("homeAddress")} />
        </label>
        <label className="text-sm font-medium">
          Emergency contact
          <input {...field("emergencyName")} />
        </label>
        <label className="text-sm font-medium">
          Their relationship
          <input placeholder="e.g. Sister" {...field("emergencyRelationship")} />
        </label>
        <label className="text-sm font-medium">
          Their phone
          <input type="tel" {...field("emergencyPhone")} />
        </label>
      </div>

      <p className="mt-2 text-sm font-semibold">
        Tax and pension details{" "}
        <span className="font-normal text-muted">(for the PAYE and pension schedules)</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Tax ID (TIN)
          <input {...field("taxId")} />
        </label>
        <label className="text-sm font-medium">
          Pension provider (PFA)
          <input placeholder="e.g. Stanbic IBTC Pension" {...field("pensionProvider")} />
        </label>
        <label className="text-sm font-medium">
          RSA PIN
          <input placeholder="e.g. PEN100…" {...field("pensionPin")} />
        </label>
      </div>
      <p className="mt-2 text-sm font-semibold">
        Bank account <span className="font-normal text-muted">(where salary is paid)</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Bank
          <input {...field("bankName")} />
        </label>
        <label className="text-sm font-medium">
          Account number
          <input inputMode="numeric" {...field("bankAccountNumber")} />
        </label>
        <label className="text-sm font-medium">
          Account name
          <input {...field("bankAccountName")} />
        </label>
      </div>
      {!employee && (
        <label className="text-sm font-medium">
          Staff portal password{" "}
          <span className="font-normal text-muted">
            (optional, at least 8 characters; you can set it later)
          </span>
          <input type="text" autoComplete="new-password" {...field("password")} />
        </label>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : "Save employee"}
        </button>
      </div>
    </form>
  );
}

type DraftItem = { kind: PayItemKind; name: string; amount: string };

const ALLOWANCE_IDEAS = ["Housing", "Transport", "Meal", "Phone", "Commission"];
const DEDUCTION_IDEAS = ["Staff loan", "Salary advance", "Cooperative"];

/** One list of fixed monthly lines (allowances or deductions), edited in place. */
function PayLines({
  kind,
  title,
  ideas,
  items,
  onChange,
}: {
  kind: PayItemKind;
  title: string;
  ideas: string[];
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
}) {
  const update = (index: number, change: Partial<DraftItem>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  const has = (name: string) =>
    items.some((i) => i.kind === kind && i.name.trim().toLowerCase() === name.toLowerCase());
  const add = (name: string) => onChange([...items, { kind, name, amount: "" }]);

  return (
    <div>
      <p className="text-sm font-medium">
        {title}{" "}
        <span className="font-normal text-muted">
          {kind === "allowance"
            ? "(paid for the days worked)"
            : "(taken in full each month, e.g. loans)"}
        </span>
      </p>
      {/* One click adds a common line; "Other" adds one to name yourself. */}
      <div className="mt-2 flex flex-wrap gap-2">
        {ideas.map((idea) => (
          <button
            key={idea}
            type="button"
            disabled={has(idea)}
            onClick={() => add(idea)}
            className="rounded-full border border-line-strong bg-white px-3.5 py-1.5 text-sm font-medium transition hover:border-brand hover:bg-brand-soft/40 disabled:opacity-40"
          >
            + {idea}
          </button>
        ))}
        <button
          type="button"
          onClick={() => add("")}
          className="rounded-full border border-dashed border-line-strong bg-white px-3.5 py-1.5 text-sm font-medium transition hover:border-brand hover:bg-brand-soft/40"
        >
          + Other
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {items.map(
          (item, index) =>
            item.kind === kind && (
              <div key={index} className="flex items-center gap-2">
                <input
                  required
                  autoFocus={item.name === ""}
                  aria-label="Name"
                  placeholder={kind === "allowance" ? "e.g. Housing" : "e.g. Staff loan"}
                  value={item.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  className={`${INLINE_INPUT} flex-1`}
                />
                <input
                  required
                  autoFocus={item.name !== "" && item.amount === ""}
                  aria-label="Amount per month"
                  type="number"
                  min={0.01}
                  step={0.01}
                  placeholder="Per month"
                  value={item.amount}
                  onChange={(e) => update(index, { amount: e.target.value })}
                  className={`${INLINE_INPUT} w-40`}
                />
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                  className="rounded-md px-2 py-1 text-xl leading-none text-muted hover:bg-brand-soft"
                >
                  ×
                </button>
              </div>
            ),
        )}
      </div>
    </div>
  );
}

/** What a full month's pay comes to with the lines entered so far. */
function PaySummary({
  form,
  nhf: takesNhf,
  items,
}: {
  form: {
    baseSalary: string;
    pensionPercent: string;
    paye: string;
    payeAmount: string;
    employerPensionPercent: string;
  };
  nhf: boolean;
  items: DraftItem[];
}) {
  const total = (kind: PayItemKind) =>
    items.filter((i) => i.kind === kind).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const gross = (Number(form.baseSalary) || 0) + total("allowance");
  const pension = (gross * (Number(form.pensionPercent) || 0)) / 100;
  const nhf = takesNhf ? (Number(form.baseSalary) || 0) * 0.025 : 0;
  const paye = form.paye === "fixed" ? Number(form.payeAmount) || 0 : 0;
  const net = gross - pension - nhf - paye - total("deduction");
  const employerPension = (gross * (Number(form.employerPensionPercent) || 0)) / 100;

  return (
    <dl className="grid gap-1 rounded-lg bg-surface-alt px-4 py-3 text-sm">
      <SummaryLine label="Gross (basic + allowances)" value={money.format(gross)} />
      {pension > 0 && (
        <SummaryLine label={`Pension (${Number(form.pensionPercent)}%)`} value={`− ${money.format(pension)}`} />
      )}
      {nhf > 0 && <SummaryLine label="NHF (2.5%)" value={`− ${money.format(nhf)}`} />}
      {form.paye === "fixed" && <SummaryLine label="PAYE" value={`− ${money.format(paye)}`} />}
      {form.paye === "auto" && (
        <SummaryLine label="PAYE" value="worked out when payroll runs" />
      )}
      {total("deduction") > 0 && (
        <SummaryLine label="Deductions" value={`− ${money.format(total("deduction"))}`} />
      )}
      <SummaryLine
        label={form.paye === "auto" ? "Net, before PAYE" : "Net pay for a full month"}
        value={money.format(net)}
        strong
      />
      {employerPension > 0 && (
        <p className="text-xs text-muted">
          Plus {money.format(employerPension)} employer pension, paid by the company to their PFA.
        </p>
      )}
    </dl>
  );
}

function SummaryLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t border-line pt-1 font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Sets or removes an employee's password for the staff portal. */
function LoginForm({ employee, onSaved, onCancel }: FormProps) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (method: "PUT" | "DELETE") => {
    setSaving(true);
    setError(null);
    try {
      await apiSend(
        `/employees/${employee.id}/password`,
        method,
        method === "PUT" ? { password } : undefined,
        "Could not save password",
      );
      onSaved(
        method === "PUT"
          ? `${employee.name} can log in with ${employee.email} and the new password. Tell them in person.`
          : `${employee.name} can no longer use the staff portal.`,
      );
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
        void send("PUT");
      }}
    >
      <p className="text-sm text-muted">
        In the staff portal, {employee.name} can see their payslips and leave,
        and ask for leave. They log in with <span className="font-medium text-ink">{employee.email}</span>.
      </p>
      <label className="text-sm font-medium">
        {employee.canLogIn ? "New password" : "Password"}{" "}
        <span className="font-normal text-muted">(at least 8 characters)</span>
        <input
          autoFocus
          required
          minLength={8}
          type="text"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex items-center justify-end gap-3">
        {employee.canLogIn && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void send("DELETE")}
            className="mr-auto text-sm font-medium text-red-700 hover:underline"
          >
            Remove access
          </button>
        )}
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : "Set password"}
        </button>
      </div>
    </form>
  );
}

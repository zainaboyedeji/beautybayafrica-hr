"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import type {
  ContractStatus,
  Employee,
  EmploymentType,
  PayeMode,
  PayItem,
  PayItemKind,
} from "@hr/types";
import { COMPANY_EMAIL_DOMAIN } from "@hr/types";
import ConfirmDialog from "../../components/confirm-dialog";
import PhotoPicker from "../../components/photo-picker";
import RowMenu from "../../components/row-menu";
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
  downloadFile,
  fetchContractTemplates,
  fetchContracts,
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
  | { kind: "contract"; employee: Employee }
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
      {dialog?.kind === "contract" && (
        <Modal wide title={`Contract · ${dialog.employee.name}`} onClose={closeAndReload}>
          <ContractPanel
            employee={employees.data?.find((x) => x.id === dialog.employee.id) ?? dialog.employee}
            onChanged={() => void employees.reload()}
          />
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
                <th className="px-4 py-3.5">Employee</th>
                <th className="px-4 py-3.5">Job</th>
                <th className="px-4 py-3.5 text-right">Monthly pay</th>
                <th className="px-4 py-3.5 text-right">Annual leave left</th>
                <th className="px-4 py-3.5 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {visible.map((e) => (
                <tr key={e.id} className={`align-top ${hasLeft(e) ? "text-muted" : ""}`}>
                  <td className="px-4 py-4">
                    <Person
                      name={e.name}
                      detail={
                        <>
                          {e.employeeNo}
                          <br />
                          {e.email}
                        </>
                      }
                      employeeId={e.id}
                      photoVersion={e.photoVersion}
                    />
                    {e.deactivatedAt && (
                      <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Deactivated {formatDay(new Date(e.deactivatedAt).toLocaleDateString("en-CA"))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {e.jobTitle}
                    <p className="text-muted">
                      {[e.departmentName, EMPLOYMENT_LABELS[e.employmentType]]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="whitespace-nowrap text-xs text-muted">
                      Started {formatDay(e.startDate)}
                      {e.endDate && ` · ${hasLeft(e) ? "left" : "leaving"} ${formatDay(e.endDate)}`}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="whitespace-nowrap font-medium">
                      {money.format(e.baseSalary + e.monthlyAllowances)}
                    </span>
                    <p className="whitespace-nowrap text-xs text-muted">
                      Basic {money.format(e.baseSalary)}
                    </p>
                    {e.monthlyAllowances > 0 && (
                      <p className="whitespace-nowrap text-xs text-muted">
                        + {money.format(e.monthlyAllowances)} allowances
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <LeaveMeter left={e.annualLeaveDays - e.annualLeaveTaken} of={e.annualLeaveDays} />
                  </td>
                  {/* The everyday actions, with the rest under "More", so a row fits a laptop screen. */}
                  <td className="whitespace-nowrap px-4 py-4 text-right">
                    <div className="flex justify-end gap-2.5">
                      <button
                        onClick={() => setDialog({ kind: "edit", employee: e })}
                        className="font-medium text-brand-deep hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDialog({ kind: "contract", employee: e })}
                        className="font-medium text-brand-deep hover:underline"
                        title={e.contractStatus ? CONTRACT_STATUS[e.contractStatus].label : "No contract sent yet"}
                      >
                        Contract
                        {e.contractStatus && (
                          <span
                            className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${CONTRACT_STATUS[e.contractStatus].tint}`}
                          >
                            {e.contractStatus === "accepted" ? "✓" : "…"}
                          </span>
                        )}
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
                      <RowMenu
                        items={[
                          {
                            label: (
                              <>
                                Guarantors
                                <span
                                  className={`ml-auto rounded-full px-1.5 py-0.5 text-xs ${
                                    e.guarantors === 0
                                      ? "bg-red-50 text-red-700"
                                      : e.verifiedGuarantors === e.guarantors
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {e.verifiedGuarantors}/{e.guarantors} verified
                                </span>
                              </>
                            ),
                            onSelect: () => setDialog({ kind: "guarantors", employee: e }),
                          },
                          {
                            label: e.deactivatedAt ? "Reactivate" : "Deactivate",
                            danger: !e.deactivatedAt,
                            onSelect: () => setDialog({ kind: "active", employee: e }),
                          },
                          {
                            label: "Delete",
                            danger: true,
                            onSelect: () => setDialog({ kind: "delete", employee: e }),
                          },
                        ]}
                      />
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
    personalEmail: employee?.personalEmail ?? "",
    password: "",
  });
  // A new starter's contract can be emailed as soon as they are added.
  const templates = useLoad(fetchContractTemplates);
  const [sendContract, setSendContract] = useState(true);
  const [templateId, setTemplateId] = useState("");
  const chosenTemplate = templateId || templates.data?.[0]?.id || "";
  const emailingContract = !employee && sendContract && !!chosenTemplate;
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
          ...(emailingContract ? { contractTemplateId: chosenTemplate, password: "" } : {}),
        },
        "Could not save employee",
      );
      onSaved(
        emailingContract
          ? `${saved.name} added. Their contract was emailed to ${saved.personalEmail}; once they accept, they get a second email to set up their account. (See Settings → Emails sent.)`
          : `${saved.name} saved.`,
      );
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
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Work email <span className="font-normal text-muted">(@{COMPANY_EMAIL_DOMAIN})</span>
          <input
            required
            type="email"
            placeholder={`name@${COMPANY_EMAIL_DOMAIN}`}
            {...field("email")}
          />
        </label>
        <label className="text-sm font-medium">
          Personal email{" "}
          <span className="font-normal text-muted">(contract and set-up go here)</span>
          <input
            required={emailingContract}
            type="email"
            placeholder="e.g. name@gmail.com"
            {...field("personalEmail")}
          />
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
        <div className="mt-2 rounded-3xl bg-surface-alt/70 p-4 ring-1 ring-line">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={sendContract}
              disabled={!templates.data?.length}
              onChange={(e) => setSendContract(e.target.checked)}
              className="h-4 w-4 accent-brand-deep"
            />
            Email their contract now
          </label>
          {templates.data && templates.data.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Add a contract template under Settings to email contracts.
            </p>
          ) : sendContract ? (
            <div className="mt-3 flex flex-col gap-2">
              <label className="text-sm font-medium">
                Contract
                <select value={chosenTemplate} onChange={(e) => setTemplateId(e.target.value)} className={INPUT}>
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted">
                They get it at their personal email with a link to read and accept it. Once they
                accept, a second email shows them how to set up their HR account and choose their
                password.
              </p>
            </div>
          ) : null}
          {!emailingContract && (
            <label className="mt-3 block text-sm font-medium">
              Or a temporary staff portal password{" "}
              <span className="font-normal text-muted">
                (optional; tell them in person and they choose their own when they first log in)
              </span>
              <input type="text" autoComplete="new-password" {...field("password")} />
            </label>
          )}
        </div>
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
          ? `${employee.name} can log in with ${employee.email} and this temporary password. Tell them in person; they choose their own when they log in.`
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
        The password you set here is temporary: they choose their own the first time they log in.
      </p>
      {employee.canLogIn && (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            employee.mustChangePassword
              ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
              : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
          }`}
        >
          {employee.mustChangePassword
            ? "They haven't logged in to choose their own password yet."
            : "They have chosen their own password."}
        </p>
      )}
      <label className="text-sm font-medium">
        {employee.canLogIn ? "New temporary password" : "Temporary password"}{" "}
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

const CONTRACT_STATUS: Record<ContractStatus, { label: string; tint: string }> = {
  sent: { label: "Contract sent", tint: "bg-sky-100 text-sky-800" },
  viewed: { label: "Contract opened", tint: "bg-amber-100 text-amber-800" },
  accepted: { label: "Contract accepted", tint: "bg-emerald-100 text-emerald-800" },
  withdrawn: { label: "Withdrawn", tint: "bg-surface-alt text-muted" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });

/** An employee's contracts: progress, resending, and sending a new one. */
function ContractPanel({ employee, onChanged }: { employee: Employee; onChanged: () => void }) {
  const loader = useCallback(() => fetchContracts(employee.id), [employee.id]);
  const contracts = useLoad(loader);
  const templates = useLoad(fetchContractTemplates);
  const [templateId, setTemplateId] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const chosen = templateId || templates.data?.[0]?.id || "";
  const latest = contracts.data?.find((c) => c.status !== "withdrawn");
  const waiting = latest && latest.status !== "accepted";

  const act = async (work: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      await contracts.reload();
      onChanged();
    } catch (e) {
      setError(describeError(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const preview = () =>
    act(
      async () => {
        const answer = await apiSend<{ body: string }>(
          `/employees/${employee.id}/contract-preview`,
          "POST",
          { templateId: chosen },
          "Could not prepare the contract",
        );
        setDraft(answer.body);
      },
      "Here's their contract. Change anything for them only, then send it.",
      "Could not prepare the contract",
    );

  if (!employee.personalEmail)
    return (
      <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
        Add {employee.name.split(" ")[0]}&apos;s personal email (Edit) first: their contract and
        account set-up are emailed there.
      </p>
    );

  return (
    <div className="flex flex-col gap-5 text-sm">
      <p className="text-muted">
        Emails go to <span className="font-medium text-ink">{employee.personalEmail}</span>.
      </p>
      {notice && <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-emerald-800 ring-1 ring-emerald-200">{notice}</p>}
      {error && <p className="text-red-700">{error}</p>}

      {contracts.failed ? (
        <LoadError />
      ) : !contracts.data ? (
        <Loading />
      ) : latest ? (
        <section className="rounded-3xl p-4 ring-1 ring-line">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{latest.title}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONTRACT_STATUS[latest.status].tint}`}>
              {CONTRACT_STATUS[latest.status].label}
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-0.5 text-muted">
            <li>Sent {when(latest.sentAt)} by {latest.sentBy}</li>
            {latest.viewedAt && <li>Opened {when(latest.viewedAt)}</li>}
            {latest.acceptedAt ? (
              <li className="text-emerald-800">
                Accepted {when(latest.acceptedAt)}, signed &quot;{latest.acceptedName}&quot;
                {latest.acceptedIp && ` from ${latest.acceptedIp}`}
              </li>
            ) : (
              <li>Link works until {when(latest.expiresAt)}</li>
            )}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () => downloadFile(`/contracts/${latest.id}/pdf`, `Contract ${employee.name}.pdf`, "Could not download it"),
                  "Contract downloaded.",
                  "Could not download it",
                )
              }
              className={SECONDARY_BUTTON}
            >
              <Icon name="download" className="h-4 w-4" />
              PDF
            </button>
            {waiting && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => apiSend(`/contracts/${latest.id}/resend`, "POST", {}, "Could not resend it"),
                      `Contract emailed again to ${employee.personalEmail} with a new link.`,
                      "Could not resend it",
                    )
                  }
                  className={SECONDARY_BUTTON}
                >
                  <Icon name="refresh" className="h-4 w-4" />
                  Resend
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => apiSend(`/contracts/${latest.id}/withdraw`, "PUT", {}, "Could not withdraw it"),
                      "Contract withdrawn. Its link no longer works.",
                      "Could not withdraw it",
                    )
                  }
                  className={`${SECONDARY_BUTTON} text-red-700`}
                >
                  Withdraw
                </button>
              </>
            )}
          </div>
        </section>
      ) : (
        <p className="text-muted">No contract sent yet.</p>
      )}

      {!employee.canLogIn && (
        <section className="rounded-3xl bg-surface-alt/70 p-4 ring-1 ring-line">
          <p className="font-semibold">HR account</p>
          <p className="mt-1 text-muted">
            {employee.setupPending
              ? "They have a set-up link and haven't used it yet."
              : latest?.status === "accepted"
                ? "Their set-up link has expired or wasn't sent."
                : "The set-up email is sent automatically once they accept their contract."}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void act(
                () => apiSend(`/employees/${employee.id}/setup-email`, "POST", {}, "Could not send it"),
                `Set-up email sent to ${employee.personalEmail}.`,
                "Could not send it",
              )
            }
            className={`${SECONDARY_BUTTON} mt-3`}
          >
            {employee.setupPending ? "Send the set-up email again" : "Send the set-up email now"}
          </button>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <p className="font-semibold">{latest ? "Send a new contract" : "Send their contract"}</p>
        {templates.data && templates.data.length === 0 ? (
          <p className="text-muted">Add a contract template under Settings first.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-56 flex-1 font-medium">
                Template
                <select
                  value={chosen}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setDraft(null);
                  }}
                  className={INPUT}
                >
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy || !chosen} onClick={() => void preview()} className={SECONDARY_BUTTON}>
                Preview
              </button>
            </div>
            {draft !== null && (
              <label className="font-medium">
                Their contract{" "}
                <span className="font-normal text-muted">(changes here are for {employee.name.split(" ")[0]} only)</span>
                <textarea
                  rows={14}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className={`${INPUT} font-mono text-sm leading-relaxed`}
                />
              </label>
            )}
            {waiting && (
              <p className="text-xs text-muted">Sending a new one withdraws the contract still waiting.</p>
            )}
            <button
              disabled={busy || !chosen}
              onClick={() =>
                void act(
                  () =>
                    apiSend(
                      `/employees/${employee.id}/contracts`,
                      "POST",
                      { templateId: chosen, ...(draft !== null ? { body: draft } : {}) },
                      "Could not send the contract",
                    ).then(() => setDraft(null)),
                  `Contract emailed to ${employee.personalEmail}.`,
                  "Could not send the contract",
                )
              }
              className={`${PRIMARY_BUTTON} self-start`}
            >
              {busy ? "Sending…" : "Email the contract"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

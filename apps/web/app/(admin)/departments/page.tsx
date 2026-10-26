"use client";

import { useState } from "react";
import type { Department } from "@hr/types";
import ConfirmDialog from "../../components/confirm-dialog";
import {
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TABLE, TABLE_CARD, TBODY, THEAD,
} from "../../components/form-styles";
import Icon from "../../components/icons";
import PageHeader from "../../components/page-header";
import Modal from "../../components/modal";
import { Notice } from "../../components/notice";
import { apiSend, describeError, fetchDepartments, useLoad } from "../../lib/api";
import { LoadError, Loading } from "../../lib/status";

export default function DepartmentsPage() {
  const departments = useLoad(fetchDepartments);
  // `null` for a new department.
  const [editing, setEditing] = useState<Department | null | undefined>();
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (department: Department) => {
    setDeleting(null);
    setError(null);
    try {
      await apiSend(`/departments/${department.id}`, "DELETE", undefined, "Could not delete department");
      setNotice(`${department.name} deleted.`);
      await departments.reload();
    } catch (e) {
      setError(describeError(e, "Could not delete department"));
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon="building" eyebrow="Teams" title="Departments">
        <button onClick={() => setEditing(null)} className={PRIMARY_BUTTON}>
          <Icon name="plus" className="h-4 w-4" />
          Add department
        </button>
      </PageHeader>
      <Notice text={notice} />
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {editing !== undefined && (
        <Modal
          title={editing ? "Rename department" : "Add department"}
          onClose={() => setEditing(undefined)}
        >
          <DepartmentForm
            department={editing}
            onCancel={() => setEditing(undefined)}
            onSaved={(message) => {
              setEditing(undefined);
              setNotice(message);
              void departments.reload();
            }}
          />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete department"
          message={`Delete ${deleting.name}? Its ${deleting.headcount} employee(s) stay, without a department.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}

      <div className="mt-6">
        {departments.failed ? (
          <LoadError />
        ) : !departments.data ? (
          <Loading />
        ) : departments.data.length === 0 ? (
          <p className="text-sm text-muted">
            No departments yet. Add one, such as Sales or Salon.
          </p>
        ) : (
          <div className={TABLE_CARD}><table className={TABLE}>
            <thead className={THEAD}>
              <tr>
                <th className="px-5 py-3.5">Department</th>
                <th className="px-5 py-3.5 text-right">Employees</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className={TBODY}>
              {departments.data.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-4">
                    <span className="flex items-center gap-3 font-semibold">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-800">
                        <Icon name="building" className="h-[18px] w-[18px]" />
                      </span>
                      {d.name}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">{d.headcount}</td>
                  <td className="space-x-4 px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(d)}
                      className="font-medium text-brand-deep hover:underline"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => setDeleting(d)}
                      className="font-medium text-red-700 hover:underline"
                    >
                      Delete
                    </button>
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

function DepartmentForm({
  department,
  onSaved,
  onCancel,
}: {
  department: Department | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(department?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend(
        department ? `/departments/${department.id}` : "/departments",
        department ? "PUT" : "POST",
        { name },
        "Could not save department",
      );
      onSaved(`${name.trim()} saved.`);
    } catch (e) {
      setError(describeError(e, "Could not save department"));
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
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
        />
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={PRIMARY_BUTTON}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useRef, useState } from "react";
import type { Employee } from "@hr/types";
import { apiSend, describeError } from "../lib/api";
import { resizePhoto } from "../lib/photo";
import Avatar from "./avatar";
import Icon from "./icons";

/**
 * Shows someone's photo with buttons to upload, change or remove it. `path` is
 * where the photo is saved: "/me/photo" in the staff portal, or the
 * employee's own path for HR.
 */
export default function PhotoPicker({
  employee,
  path,
  onChanged,
  light,
}: {
  employee: Pick<Employee, "id" | "name" | "photoVersion">;
  path: string;
  onChanged: (employee: Employee) => void;
  /** White buttons, for use on the brand gradient. */
  light?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (work: () => Promise<Employee>) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await work());
    } catch (e) {
      setError(describeError(e, "Could not save the photo"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const upload = (file: File) =>
    save(async () =>
      apiSend<Employee>(path, "PUT", { photo: await resizePhoto(file) }, "Could not save the photo"),
    );

  const button = light
    ? "rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/40 transition hover:bg-white/30"
    : "rounded-full border border-line-strong bg-white px-3 py-1.5 text-xs font-semibold transition hover:border-brand hover:bg-brand-soft/40";

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar
          name={employee.name}
          size="xl"
          employeeId={employee.id}
          photoVersion={employee.photoVersion}
          className={light ? "ring-4 ring-white/60" : "ring-4 ring-brand-soft"}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          aria-label={employee.photoVersion ? "Change photo" : "Upload photo"}
          className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand-deep shadow-md ring-1 ring-line transition hover:scale-105"
        >
          <Icon name="camera" className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={button}>
            {busy ? "Saving…" : employee.photoVersion ? "Change photo" : "Upload photo"}
          </button>
          {employee.photoVersion && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(() => apiSend<Employee>(path, "DELETE", undefined, "Could not remove the photo"))}
              className={button}
            >
              Remove
            </button>
          )}
        </div>
        {error && (
          <p className={`text-xs ${light ? "rounded bg-white/90 px-2 py-1 text-red-700" : "text-red-700"}`}>
            {error}
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

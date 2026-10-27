"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CARD, INPUT, PRIMARY_BUTTON } from "../components/form-styles";
import Icon from "../components/icons";
import PasswordInput from "../components/password-input";
import { describeError, publicCall } from "../lib/api";

/** Where a new starter chooses their password, from the set-up email's link. */
export default function SetupPage() {
  return (
    <Suspense>
      <SetupFromLink />
    </Suspense>
  );
}

function SetupFromLink() {
  const token = useSearchParams().get("t") ?? "";
  const [who, setWho] = useState<{ name: string; workEmail: string; company: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [form, setForm] = useState({ password: "", repeat: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    publicCall<{ name: string; workEmail: string; company: string }>(
      `/public/setup/${encodeURIComponent(token)}`,
    )
      .then(setWho)
      .catch((e) => setFailed(describeError(e, "This link isn't valid")));
  }, [token]);

  const submit = async () => {
    if (form.password !== form.repeat) {
      setError("The passwords don't match");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const answer = await publicCall<{ workEmail: string }>(
        `/public/setup/${encodeURIComponent(token)}`,
        { method: "POST", body: { password: form.password } },
      );
      setDone(answer.workEmail);
    } catch (e) {
      setError(describeError(e, "Could not save your password"));
      setSaving(false);
    }
  };

  const problem = !token ? "This link is missing its code. Open it again from your email." : failed;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 text-ink">
      <div className={`${CARD} w-full max-w-md`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-12 w-12" />
        {problem ? (
          <>
            <h1 className="mt-4 text-2xl font-semibold">Link not working</h1>
            <p className="mt-2 text-sm text-muted">{problem}</p>
          </>
        ) : done ? (
          <>
            <p className="mt-4 flex items-center gap-2 text-2xl font-semibold">
              <Icon name="check" className="h-6 w-6 text-emerald-700" />
              You&apos;re all set
            </p>
            <p className="mt-2 text-sm text-muted">
              Log in on the <strong>Employee</strong> tab with your work email{" "}
              <strong className="text-ink">{done}</strong> and the password you just chose.
            </p>
            <a href="/login" className={`${PRIMARY_BUTTON} mt-6 h-12 w-full`}>
              Go to log in
            </a>
          </>
        ) : !who ? (
          <p className="mt-4 text-sm text-muted">Checking your link…</p>
        ) : (
          <>
            <h1 className="mt-4 text-3xl font-semibold">Set up your HR account</h1>
            <p className="mt-2 text-sm text-muted">
              Welcome, {who.name.split(" ")[0]}. You&apos;ll log in to {who.company} HR with your
              work email:
            </p>
            <p className={`${INPUT} mt-3 bg-surface-alt font-medium`}>{who.workEmail}</p>
            <form
              className="mt-5 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label className="text-sm font-medium">
                Choose a password <span className="font-normal text-muted">(at least 8 characters)</span>
                <PasswordInput
                  autoFocus
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={INPUT}
                />
              </label>
              <label className="text-sm font-medium">
                Password again
                <PasswordInput
                  required
                  autoComplete="new-password"
                  value={form.repeat}
                  onChange={(e) => setForm({ ...form, repeat: e.target.value })}
                  className={INPUT}
                />
              </label>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={saving} className={`${PRIMARY_BUTTON} mt-2 h-12`}>
                {saving ? "Saving…" : "Save password"}
              </button>
              <p className="text-xs text-muted">Only you will know this password. HR can&apos;t see it.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

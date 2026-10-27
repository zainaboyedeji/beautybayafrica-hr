"use client";

import { useEffect, useState } from "react";
import { COMPANY_EMAIL_DOMAIN } from "@hr/types";
import { INPUT, PRIMARY_BUTTON } from "../components/form-styles";
import { API_URL, describeError } from "../lib/api";
import { homeOf, saveSession, type Session } from "../lib/auth";
import Icon from "../components/icons";
import PasswordInput from "../components/password-input";

type Mode = "employee" | "admin";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("employee");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Forgot password?": asks HR for a new one instead of logging in.
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const waking = useWakeServer();

  const askForPassword = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/password-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not send the request");
      setSent(body.message);
    } catch (e) {
      setError(describeError(e, "Could not send the request"));
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "admin" ? { role: "admin", email, password } : { email, password },
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not log in");
      saveSession(body as Session);
      window.location.replace(homeOf(body.role));
    } catch (e) {
      setError(describeError(e, "Could not log in"));
      setPassword("");
      setSaving(false);
    }
  };

  const isEmployee = mode === "employee";

  return (
    <div className="flex min-h-screen text-ink">
      <Showcase />
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <form
          className="w-full max-w-sm animate-fade-up"
          onSubmit={(e) => {
            e.preventDefault();
            void (forgot ? askForPassword() : submit());
          }}
        >
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-14 w-14 lg:hidden" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-brand-deep">
              Beauty Bay Africa HR
            </p>
            <h1 className="mt-2 text-4xl">Welcome back</h1>
            <p className="mt-2 text-sm text-muted">
              {isEmployee
                ? "See your payslips and ask for leave."
                : "Manage staff, leave and payroll."}
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Log in as"
            className="mt-7 grid grid-cols-2 gap-1 rounded-full bg-surface-alt p-1 text-sm font-semibold ring-1 ring-line"
          >
            {(["employee", "admin"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setForgot(false);
                  setSent(null);
                  setEmail("");
                  setPassword("");
                  setError(null);
                }}
                className={`rounded-full py-2 transition ${
                  mode === m
                    ? "bg-white text-brand-deep shadow-md shadow-brand/15"
                    : "text-muted hover:text-ink"
                }`}
              >
                {m === "employee" ? "Employee" : "Admin"}
              </button>
            ))}
          </div>

          <label className="mt-6 block text-sm font-medium">
            Work email
            <input
              autoFocus
              required
              type="email"
              autoComplete="username"
              placeholder={`name@${COMPANY_EMAIL_DOMAIN}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${INPUT} h-12`}
            />
          </label>
          {forgot && (
            <p className="mt-3 text-sm text-muted">
              Enter your work email and HR will be asked to give you a new password. They tell
              you it in person, then you choose your own when you log in.
            </p>
          )}
          <label className={`mt-4 block text-sm font-medium ${forgot ? "hidden" : ""}`}>
            Password
            <PasswordInput
              key={mode}
              required={!forgot}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${INPUT} h-12`}
            />
          </label>
          {sent && (
            <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {sent}
            </p>
          )}
          {waking && !error && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Waking up the server. The first visit after a quiet spell can take up to a
              minute.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className={`${PRIMARY_BUTTON} mt-7 h-12 w-full`}
          >
            {forgot
              ? saving ? "Sending…" : "Ask HR for a new password"
              : saving ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="mt-6 w-full max-w-sm text-xs text-muted">
          {isEmployee ? (
            <button
              type="button"
              onClick={() => {
                setForgot(!forgot);
                setSent(null);
                setError(null);
              }}
              className="font-semibold text-brand-deep hover:underline"
            >
              {forgot ? "← Back to log in" : "Forgotten your password?"}
            </button>
          ) : (
            "Forgotten your password? Ask another admin to set a new one. The owner's is set on the server (ADMIN_PASSWORD)."
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Pings the API as soon as the page opens: on a free host it sleeps when no one
 * uses it, so this starts waking it while the person types. True while it's
 * taking a while to answer.
 */
function useWakeServer() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let done = false;
    const timer = setTimeout(() => !done && setSlow(true), 2000);
    fetch(`${API_URL}/health`)
      .catch(() => {})
      .finally(() => {
        done = true;
        clearTimeout(timer);
        setSlow(false);
      });
    return () => clearTimeout(timer);
  }, []);
  return slow;
}

// Little cards that drift on the brand panel, hinting at what the app does.
const MOMENTS = [
  { text: "Leave approved", detail: "Annual leave · 5 days", tint: "bg-emerald-100 text-emerald-800", icon: "check", place: "left-12 top-[20%]" },
  { text: "Payslip ready", detail: "October salary", tint: "bg-violet-100 text-violet-700", icon: "wallet", place: "right-12 top-[34%] [animation-delay:-2s]" },
  { text: "Welcome to the team!", detail: "New starter on Monday", tint: "bg-amber-100 text-amber-800", icon: "sparkle", place: "left-24 top-[48%] [animation-delay:-4s]" },
] as const;

function Showcase() {
  return (
    <div className="relative hidden flex-1 overflow-hidden bg-gradient-to-tr from-brand-deep via-brand-hover to-brand p-12 text-white lg:flex lg:flex-col">
      <div aria-hidden className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-white/10" />
      <div aria-hidden className="absolute -bottom-32 -right-16 h-96 w-96 rounded-full bg-violet-300/25" />
      <div className="relative flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-12 w-12 rounded-full bg-white p-1" />
        <span className="font-display text-xl font-semibold">Beauty Bay Africa</span>
      </div>
      <h2 className="relative mt-auto max-w-md text-5xl font-semibold leading-tight">
        Look after the people who look after our customers.
      </h2>
      <p className="relative mt-4 max-w-md text-white/85">
        Staff records, leave and payroll in one place, with a portal for every employee.
      </p>
      <div aria-hidden>
        {MOMENTS.map((m) => (
          <div
            key={m.text}
            className={`absolute flex animate-float items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-ink shadow-xl ${m.place}`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${m.tint}`}>
              <Icon name={m.icon} className="h-[18px] w-[18px]" />
            </span>
            <span>
              <span className="block text-sm font-semibold">{m.text}</span>
              <span className="block text-xs text-muted">{m.detail}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { INPUT, PRIMARY_BUTTON } from "../components/form-styles";
import { API_URL, describeError } from "../lib/api";
import { homeOf, saveSession, type Session } from "../lib/auth";
import Icon from "../components/icons";

type Mode = "employee" | "admin";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("employee");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "admin" ? { password } : { email, password },
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
            void submit();
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

          {isEmployee && (
            <label className="mt-6 block text-sm font-medium">
              Work email
              <input
                autoFocus
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${INPUT} h-12`}
              />
            </label>
          )}
          <label className={`${isEmployee ? "mt-4" : "mt-6"} block text-sm font-medium`}>
            Password
            <input
              key={mode}
              autoFocus={!isEmployee}
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${INPUT} h-12`}
            />
          </label>
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
            {saving ? "Logging in…" : "Log in"}
          </button>
        </form>
        <p className="mt-6 w-full max-w-sm text-xs text-muted">
          {isEmployee
            ? "Forgotten your password? Ask HR to set a new one."
            : "Employees log in on the Employee tab."}
        </p>
      </div>
    </div>
  );
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

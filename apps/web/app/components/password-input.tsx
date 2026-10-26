"use client";

import { useState, type InputHTMLAttributes } from "react";
import Icon from "./icons";

/** A password box with an eye button to show or hide what was typed. */
export default function PasswordInput({
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input {...props} type={shown ? "text" : "password"} className={`${className} pr-12`} />
      <button
        type="button"
        onClick={() => setShown(!shown)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"}
        className="absolute bottom-0 right-1 top-1.5 flex w-10 items-center justify-center rounded-full text-muted transition hover:text-brand-deep"
      >
        <Icon name={shown ? "eyeOff" : "eye"} className="h-5 w-5" />
      </button>
    </span>
  );
}

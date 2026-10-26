"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

export default function Modal({ title, onClose, children, wide }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Rendered on <body>: the page's fade-in animation uses a transform, which
  // would otherwise pin this "fixed" overlay to the page area and crop it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-full w-full animate-pop-in overflow-auto rounded-3xl bg-white text-ink shadow-2xl ${
          wide ? "max-w-3xl" : "max-w-md"
        }`}
      >
        {/* A strip of brand colour along the top. */}
        <div aria-hidden className="h-1.5 bg-gradient-to-r from-brand via-brand-hover to-violet-400" />
        <div className="p-7">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-muted transition hover:bg-brand-soft hover:text-brand-deep"
            >
              ×
            </button>
          </div>
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

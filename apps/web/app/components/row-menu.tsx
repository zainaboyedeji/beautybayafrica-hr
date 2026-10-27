"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type RowMenuItem = { label: ReactNode; onSelect: () => void; danger?: boolean };

/**
 * A "More" button opening a small menu of less-used actions. The menu is drawn
 * over the page (not inside the table), so a scrolling table can't cut it off.
 */
export default function RowMenu({ items, label = "More" }: { items: RowMenuItem[]; label?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; right: number } | null>(null);

  useEffect(() => {
    if (!place) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "mousedown" && (menu.current?.contains(e.target as Node) || button.current?.contains(e.target as Node))) return;
      setPlace(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [place]);

  const toggle = () => {
    if (place) return setPlace(null);
    const r = button.current!.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    // Opens upwards near the bottom of the screen, so it's never cut off.
    const roomBelow = window.innerHeight - r.bottom;
    setPlace(roomBelow < 60 + items.length * 44 ? { bottom: window.innerHeight - r.top + 6, right } : { top: r.bottom + 6, right });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={!!place}
        className="font-medium text-brand-deep hover:underline"
      >
        {label} ▾
      </button>
      {place &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: "fixed", top: place.top, bottom: place.bottom, right: place.right }}
            className="z-40 min-w-44 animate-pop-in rounded-2xl bg-white p-1.5 text-left text-sm shadow-xl ring-1 ring-line"
          >
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => {
                  setPlace(null);
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-1 rounded-xl px-3 py-2 font-medium transition hover:bg-surface-alt ${
                  item.danger ? "text-red-700" : "text-ink"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

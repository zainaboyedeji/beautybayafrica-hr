"use client";

import { useState, type ReactNode } from "react";
import type { Announcement, AnnouncementCategory } from "@hr/types";
import Icon, { type IconName } from "./icons";

/** How each type of notice looks: label, icon, badge tint and side stripe. */
export const NOTICE_TYPES: Record<
  AnnouncementCategory,
  { label: string; icon: IconName; tint: string; stripe: string; glow: string }
> = {
  general: {
    label: "General",
    icon: "megaphone",
    tint: "bg-sky-100 text-sky-800",
    stripe: "bg-sky-400",
    glow: "from-white to-sky-50/60",
  },
  important: {
    label: "Important",
    icon: "alert",
    tint: "bg-red-100 text-red-700",
    stripe: "bg-red-500",
    glow: "from-white to-red-50/70",
  },
  event: {
    label: "Event",
    icon: "calendar",
    tint: "bg-violet-100 text-violet-700",
    stripe: "bg-violet-400",
    glow: "from-white to-violet-50/60",
  },
  celebration: {
    label: "Celebration",
    icon: "sparkle",
    tint: "bg-amber-100 text-amber-800",
    stripe: "bg-amber-400",
    glow: "from-white to-amber-50/70",
  },
};

/** "just now", "3 hours ago", "yesterday", "4 days ago", or the date. */
export function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

const isNew = (iso: string) => Date.now() - Date.parse(iso) < 3 * 86_400_000;

// Long messages start folded, so one notice doesn't push the rest away.
const LONG = 280;

/** One notice, as staff see it. `actions` adds HR's buttons along the bottom. */
export default function NoticeCard({
  notice,
  actions,
}: {
  notice: Pick<Announcement, "title" | "body" | "category" | "pinned" | "postedBy" | "createdAt" | "updatedAt">;
  actions?: ReactNode;
}) {
  const type = NOTICE_TYPES[notice.category];
  const [open, setOpen] = useState(false);
  const long = notice.body.length > LONG || notice.body.split("\n").length > 5;

  return (
    <article
      className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${type.glow} p-5 pl-6 shadow-soft ring-1 ${
        notice.pinned ? "ring-brand/40" : "ring-line"
      }`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${type.stripe}`} />
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${type.tint}`}>
          <Icon name={type.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${type.tint}`}>
              {type.label}
            </span>
            {notice.pinned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-deep">
                <Icon name="pin" className="h-3 w-3" />
                Pinned
              </span>
            )}
            {isNew(notice.createdAt) && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                New
              </span>
            )}
          </div>
          <h3 className="mt-1.5 text-lg font-semibold leading-snug">{notice.title}</h3>
          <p
            className={`mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink/90 ${
              long && !open ? "line-clamp-4" : ""
            }`}
          >
            {notice.body}
          </p>
          {long && (
            <button
              onClick={() => setOpen(!open)}
              className="mt-1 text-sm font-semibold text-brand-deep hover:underline"
            >
              {open ? "Show less" : "Read more"}
            </button>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {notice.postedBy.replace(/ \(admin\)$/, "")} · {timeAgo(notice.createdAt)}
              {notice.updatedAt && " · edited"}
            </p>
            {actions && <div className="flex gap-3 text-sm">{actions}</div>}
          </div>
        </div>
      </div>
    </article>
  );
}

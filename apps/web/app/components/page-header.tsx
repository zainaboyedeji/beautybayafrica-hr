import type { ReactNode } from "react";
import Icon, { type IconName } from "./icons";

/** The title block at the top of each HR office page. */
export default function PageHeader({
  icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: IconName;
  eyebrow: string;
  title: string;
  description?: string;
  /** Buttons shown on the right. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-deep text-white shadow-lg shadow-brand/30">
          <Icon name={icon} className="h-7 w-7" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-deep">
            {eyebrow}
          </p>
          <h1 className="text-4xl font-semibold">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

// Soft tints, picked by name so each person keeps the same colour everywhere.
const TINTS = [
  "bg-brand-soft text-brand-deep",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-rose-100 text-rose-700",
];

const tintOf = (name: string) =>
  TINTS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS.length];

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/** A round badge with someone's initials. */
export default function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const dimensions = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg",
  }[size];
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dimensions} ${tintOf(name)}`}
    >
      {initialsOf(name)}
    </span>
  );
}

/** A name with its avatar, and an optional second line. */
export function Person({ name, detail }: { name: string; detail?: string }) {
  return (
    <span className="flex items-center gap-3">
      <Avatar name={name} />
      <span>
        <span className="block whitespace-nowrap font-semibold">{name}</span>
        {detail && <span className="block text-muted">{detail}</span>}
      </span>
    </span>
  );
}

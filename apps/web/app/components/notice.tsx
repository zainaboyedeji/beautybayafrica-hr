import Icon from "./icons";

/** A green confirmation line after something was saved. */
export function Notice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p
      role="status"
      className="mt-5 flex animate-pop-in items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Icon name="check" className="h-4 w-4" />
      </span>
      {text}
    </p>
  );
}

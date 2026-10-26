import { API_URL } from "./api";

export function LoadError() {
  return (
    <p className="rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-200 text-sm text-red-800">
      Cannot reach the HR API at {API_URL}. Is it running?
    </p>
  );
}

export function Loading() {
  return <p className="text-sm text-muted">Loading…</p>;
}

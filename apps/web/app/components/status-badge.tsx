import type { LeaveStatus } from "@hr/types";
import { LEAVE_STATUS_STYLES } from "../lib/format";

export default function StatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${LEAVE_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

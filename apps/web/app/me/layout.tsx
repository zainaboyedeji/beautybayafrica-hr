import type { ReactNode } from "react";
import RequireLogin from "../components/require-login";

// The staff portal, for employees the admin has given a password.
export default function MeLayout({ children }: { children: ReactNode }) {
  return <RequireLogin allowed={["employee"]}>{children}</RequireLogin>;
}

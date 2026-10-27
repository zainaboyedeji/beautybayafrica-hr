import RequireLogin from "../components/require-login";
import Sidebar from "./sidebar";

export default function AdminLayout({ children }: LayoutProps<"/">) {
  return (
    <RequireLogin allowed={["admin"]}>
      <div className="flex h-screen flex-col gap-2 p-2 text-ink sm:p-4 lg:flex-row">
        <Sidebar />
        <main className="flex-1 overflow-auto px-1 py-3 sm:px-6 sm:py-4">
          <div className="animate-fade-up">{children}</div>
        </main>
      </div>
    </RequireLogin>
  );
}

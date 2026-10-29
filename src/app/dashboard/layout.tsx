import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { switchToOrganizationAction } from "@/app/actions/org";
import { getSession, listUserOrganizations } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/rbac";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/tournaments", label: "Tournaments" },
  { href: "/dashboard/teams", label: "Teams & players" },
  { href: "/dashboard/members", label: "Members" },
  { href: "/dashboard/sync", label: "Sync" },
  { href: "/dashboard/audit", label: "Audit log" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.organizationId) {
    redirect("/onboarding");
  }

  const organizations = listUserOrganizations(session.userId);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-orange-600 text-sm font-black">C</span>
            <span className="text-sm font-black uppercase tracking-[0.2em]">CourtSide</span>
          </Link>

          <div className="flex-1" />

          <form action={switchToOrganizationAction} className="flex items-center gap-2">
            {organizations.length > 1 ? (
              <select
                name="organizationId"
                defaultValue={session.organizationId}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-semibold"
                aria-label="Active organization"
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-semibold text-slate-300">{session.organizationName}</span>
            )}
            {organizations.length > 1 ? (
              <button className="rounded-lg bg-slate-700 px-2 py-1.5 text-xs font-semibold hover:bg-slate-600">
                Switch
              </button>
            ) : null}
          </form>

          <div className="text-right text-xs leading-tight">
            <p className="font-semibold">{session.userName}</p>
            <p className="text-slate-400">{session.roles.map((role) => ROLE_LABELS[role]).join(", ") || "No role"}</p>
          </div>

          <form action={logoutAction}>
            <button className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-800">
              Sign out
            </button>
          </form>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 pb-1" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

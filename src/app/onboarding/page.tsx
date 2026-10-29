import Link from "next/link";
import { redirect } from "next/navigation";
import { createOrganizationForUserAction, switchToOrganizationAction } from "@/app/actions/org";
import { logoutAction } from "@/app/actions/auth";
import { getSession, listUserOrganizations } from "@/lib/auth/session";
import { Alert, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.organizationId) redirect("/dashboard");

  const organizations = listUserOrganizations(session.userId);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-orange-600">CourtSide</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Choose an organization</h1>
          <p className="muted mt-1">Signed in as {session.userName}.</p>
        </div>
        <form action={logoutAction}>
          <button className="btn-outline btn-sm">Sign out</button>
        </form>
      </div>

      <Card>
        <h2 className="section-title mb-3">Your organizations</h2>
        {organizations.length === 0 ? (
          <Alert tone="warning">
            You are not a member of any organization yet. Create one below, or ask an administrator to add your email.
          </Alert>
        ) : (
          <ul className="divide-y divide-slate-200">
            {organizations.map((organization) => (
              <li key={organization.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{organization.name}</p>
                  <p className="text-xs text-slate-500">/{organization.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link className="btn-outline btn-sm" href={`/organizations/${organization.slug}`}>
                    Public page
                  </Link>
                  <form action={switchToOrganizationAction}>
                    <input type="hidden" name="organizationId" value={organization.id} />
                    <button className="btn-primary btn-sm">Open</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="section-title mb-1">Create another organization</h2>
        <p className="muted mb-4">Useful for a different league or a separate venue group.</p>
        <form action={createOrganizationForUserAction} className="space-y-3">
          <div>
            <label className="label" htmlFor="org-name">
              Organization name
            </label>
            <input id="org-name" name="name" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="org-location">
              Location (optional)
            </label>
            <input id="org-location" name="location" className="input" />
          </div>
          <button className="btn-primary">Create organization</button>
        </form>
      </Card>
    </main>
  );
}

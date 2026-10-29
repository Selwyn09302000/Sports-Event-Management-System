import { updateOrganizationAction } from "@/app/actions/org";
import { requireOrganization } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { getOrganizationById } from "@/lib/repos/orgs";
import { Card, Flash, SectionHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireOrganization();
  const { error, notice } = await searchParams;
  const organization = getOrganizationById(session.organizationId);
  const canManage = hasPermission(session.roles, "org.manage");

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <SectionHeader title="Organization settings" description="Public identity and contact details for this organization." />

      <Card className="max-w-2xl">
        {canManage && organization ? (
          <form action={updateOrganizationAction} className="space-y-3">
            <input type="hidden" name="returnTo" value="/dashboard/settings" />
            <div>
              <label className="label" htmlFor="org-name">
                Name
              </label>
              <input id="org-name" name="name" className="input" defaultValue={organization.name} required />
            </div>
            <div>
              <label className="label" htmlFor="org-description">
                Description
              </label>
              <textarea id="org-description" name="description" rows={3} className="input" defaultValue={organization.description ?? ""} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="org-location">
                  Location
                </label>
                <input id="org-location" name="location" className="input" defaultValue={organization.location ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="org-email">
                  Contact email
                </label>
                <input id="org-email" name="contactEmail" type="email" className="input" defaultValue={organization.contactEmail ?? ""} />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Public URL: <code className="rounded bg-slate-100 px-1">/organizations/{organization.slug}</code>
            </p>
            <button className="btn-primary">Save settings</button>
          </form>
        ) : (
          <p className="muted">You do not have permission to edit organization settings.</p>
        )}
      </Card>
    </div>
  );
}

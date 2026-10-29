import { addMemberAction, setMemberStatusAction, updateMemberRolesAction } from "@/app/actions/org";
import { requireOrganization } from "@/lib/auth/session";
import { ASSIGNABLE_ROLES, ROLE_LABELS, hasPermission } from "@/lib/auth/rbac";
import { listMembers } from "@/lib/repos/orgs";
import { Badge, Card, Flash, SectionHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireOrganization();
  const { error, notice } = await searchParams;
  const members = listMembers(session.organizationId);
  const canManage = hasPermission(session.roles, "member.manage");

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <SectionHeader
        title="Members & roles"
        description="Roles decide what each person can do. Offline devices keep their last known roles until they can reach the server again."
      />

      <div className="space-y-4">
        {members.map((member) => (
          <Card key={member.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">
                  {member.name} {member.status === "suspended" ? <Badge tone="danger">suspended</Badge> : null}
                </p>
                <p className="text-xs text-slate-500">{member.email}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {member.roles.map((role) => (
                    <Badge key={role} tone="info">
                      {ROLE_LABELS[role]}
                    </Badge>
                  ))}
                </div>
              </div>

              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={setMemberStatusAction}>
                    <input type="hidden" name="memberId" value={member.id} />
                    <input type="hidden" name="status" value={member.status === "active" ? "suspended" : "active"} />
                    <input type="hidden" name="returnTo" value="/dashboard/members" />
                    <button className="btn-outline btn-sm">
                      {member.status === "active" ? "Suspend" : "Reactivate"}
                    </button>
                  </form>
                </div>
              ) : null}
            </div>

            {canManage ? (
              <form action={updateMemberRolesAction} className="mt-3 border-t border-slate-200 pt-3">
                <input type="hidden" name="memberId" value={member.id} />
                <input type="hidden" name="returnTo" value="/dashboard/members" />
                <p className="label">Roles</p>
                <div className="grid gap-1 sm:grid-cols-3">
                  {ASSIGNABLE_ROLES.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="roles"
                        value={role}
                        defaultChecked={member.roles.includes(role)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      {ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
                <button className="btn-outline btn-sm mt-3">Save roles</button>
              </form>
            ) : null}
          </Card>
        ))}
      </div>

      {canManage ? (
        <Card>
          <h2 className="section-title mb-1">Add a member</h2>
          <p className="muted mb-3">
            The person must already have an account on this server. Ask them to register, then add their email here.
          </p>
          <form action={addMemberAction} className="space-y-3">
            <input type="hidden" name="returnTo" value="/dashboard/members" />
            <div>
              <label className="label" htmlFor="member-email">
                Email
              </label>
              <input id="member-email" name="email" type="email" className="input" required />
            </div>
            <fieldset>
              <legend className="label">Roles</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {ASSIGNABLE_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="roles" value={role} className="h-4 w-4 rounded border-slate-300" />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn-primary">Add member</button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}

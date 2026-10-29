import { createPlayerAction, createTeamAction } from "@/app/actions/tournaments";
import { requireOrganization } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { listPlayers, listTeams } from "@/lib/repos/tournaments";
import { Card, EmptyState, Flash, SectionHeader, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireOrganization();
  const { error, notice } = await searchParams;
  const teams = listTeams(session.organizationId);
  const players = listPlayers(session.organizationId);
  const canManage = hasPermission(session.roles, "roster.manage");

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />
      <SectionHeader
        title="Teams & players"
        description="Teams and players belong to the organization. Register them into a tournament from the tournament page."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="section-title mb-3">Teams ({teams.length})</h2>
          {teams.length === 0 ? (
            <EmptyState title="No teams yet" />
          ) : (
            <ul className="mb-4 divide-y divide-slate-200">
              {teams.map((team) => (
                <li key={team.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: team.color ?? "#1d4ed8" }} />
                    <span className="font-semibold">{team.name}</span>
                  </div>
                  <span className="text-xs text-slate-500">{team.shortName}</span>
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <form action={createTeamAction} className="space-y-2 border-t border-slate-200 pt-3">
              <div>
                <label className="label" htmlFor="team-name">
                  Team name
                </label>
                <input id="team-name" name="name" className="input" required />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="team-short">
                    Short name
                  </label>
                  <input id="team-short" name="shortName" className="input" maxLength={6} />
                </div>
                <div>
                  <label className="label" htmlFor="team-color">
                    Colour
                  </label>
                  <input id="team-color" name="color" type="color" defaultValue="#1d4ed8" className="input h-10" />
                </div>
              </div>
              <button className="btn-primary w-full">Add team</button>
            </form>
          ) : null}
        </Card>

        <Card>
          <h2 className="section-title mb-3">Players ({players.length})</h2>
          {players.length === 0 ? (
            <EmptyState title="No players registered" />
          ) : (
            <div className="mb-4 max-h-72 overflow-y-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Birth date</th>
                    <th>Guardian</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => (
                    <tr key={player.id}>
                      <td className="font-semibold">{player.fullName}</td>
                      <td className="text-xs text-slate-600">{player.birthDate ? formatDate(player.birthDate) : "—"}</td>
                      <td className="text-xs text-slate-600">{player.guardianName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canManage ? (
            <form action={createPlayerAction} className="space-y-2 border-t border-slate-200 pt-3">
              <div>
                <label className="label" htmlFor="player-name">
                  Full name
                </label>
                <input id="player-name" name="fullName" className="input" required />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="player-birth">
                    Birth date (private)
                  </label>
                  <input id="player-birth" name="birthDate" type="date" className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="player-guardian">
                    Guardian (minors)
                  </label>
                  <input id="player-guardian" name="guardianName" className="input" />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Birth dates and guardian details are never shown on public pages.
              </p>
              <button className="btn-primary w-full">Register player</button>
            </form>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

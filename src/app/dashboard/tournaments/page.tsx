import Link from "next/link";
import { createTournamentAction } from "@/app/actions/tournaments";
import { requireOrganization } from "@/lib/auth/session";
import { listTournaments } from "@/lib/repos/tournaments";
import { Badge, Card, EmptyState, Flash, SectionHeader, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireOrganization();
  const { error, notice } = await searchParams;
  const tournaments = listTournaments(session.organizationId);

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />

      <SectionHeader
        title="Tournaments"
        description="Create a tournament, then add divisions, register teams and build the schedule."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {tournaments.length === 0 ? (
            <EmptyState
              title="No tournaments yet"
              description="Use the form to create the first tournament for this organization."
            />
          ) : (
            tournaments.map((tournament) => (
              <div key={tournament.id} className="card-pad">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold">{tournament.name}</h3>
                    <p className="muted mt-1">
                      {tournament.format === "single_elimination"
                        ? "Single elimination"
                        : tournament.format === "double_round_robin"
                          ? "Double round robin"
                          : "Single round robin"}
                      {" · "}
                      {tournament.location ?? "Location TBD"}
                      {" · "}
                      {formatDate(tournament.startsOn)} – {formatDate(tournament.endsOn)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={tournament.status === "published" ? "success" : tournament.status === "archived" ? "neutral" : "warning"}>
                      {tournament.status}
                    </Badge>
                    <Link className="btn-primary btn-sm" href={`/dashboard/tournaments/${tournament.id}`}>
                      Manage
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <Card className="h-fit">
          <h2 className="section-title mb-1">New tournament</h2>
          <p className="muted mb-4">You can change these settings later.</p>
          <form action={createTournamentAction} className="space-y-3">
            <div>
              <label className="label" htmlFor="name">
                Name
              </label>
              <input id="name" name="name" className="input" required placeholder="Summer League 2026" />
            </div>
            <div>
              <label className="label" htmlFor="format">
                Format
              </label>
              <select id="format" name="format" className="input" defaultValue="round_robin">
                <option value="round_robin">Single round robin</option>
                <option value="double_round_robin">Double round robin</option>
                <option value="single_elimination">Single elimination</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="startsOn">
                  Starts
                </label>
                <input id="startsOn" name="startsOn" type="date" className="input" />
              </div>
              <div>
                <label className="label" htmlFor="endsOn">
                  Ends
                </label>
                <input id="endsOn" name="endsOn" type="date" className="input" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="location">
                Location
              </label>
              <input id="location" name="location" className="input" placeholder="Covered court" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="periodMinutes">
                  Period minutes
                </label>
                <input id="periodMinutes" name="periodMinutes" type="number" min={1} max={30} defaultValue={10} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="periodCount">
                  Periods
                </label>
                <input id="periodCount" name="periodCount" type="number" min={1} max={8} defaultValue={4} className="input" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="description">
                Description (optional)
              </label>
              <textarea id="description" name="description" rows={2} className="input" />
            </div>
            <button className="btn-primary w-full">Create tournament</button>
          </form>
        </Card>
      </div>
    </div>
  );
}

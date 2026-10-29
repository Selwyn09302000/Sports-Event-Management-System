import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { EmptyState } from "@/components/ui";
import { getDivisionStandings } from "@/lib/repos/standings";
import { getPublicTournamentBySlug, listDivisions } from "@/lib/repos/tournaments";

export const dynamic = "force-dynamic";

export default async function PublicStandingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tournament = getPublicTournamentBySlug(slug);
  if (!tournament) notFound();

  const divisions = listDivisions(tournament.organizationId, tournament.id);
  const standings = divisions.map((division) =>
    getDivisionStandings(tournament.organizationId, division.id),
  );

  return (
    <div className="min-h-screen">
      <PublicHeader subtitle={tournament.name} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black">Standings</h1>
          <nav className="flex gap-2 text-sm">
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}`}>
              Overview
            </Link>
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}/schedule`}>
              Schedule
            </Link>
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}/bracket`}>
              Bracket
            </Link>
          </nav>
        </div>

        <p className="muted mt-2">
          Standings are derived from approved results only. A game awaiting review does not change the table.
        </p>

        {standings.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No divisions published" />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {standings.map((division) => (
              <section key={division.divisionId}>
                <h2 className="mb-2 text-lg font-bold">{division.divisionName}</h2>
                {division.rows.length === 0 ? (
                  <p className="muted">No teams registered.</p>
                ) : (
                  <div className="card overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Team</th>
                          <th className="text-right">P</th>
                          <th className="text-right">W</th>
                          <th className="text-right">L</th>
                          <th className="text-right">PF</th>
                          <th className="text-right">PA</th>
                          <th className="text-right">+/-</th>
                          <th className="text-right">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {division.rows.map((row) => (
                          <tr key={row.teamId}>
                            <td className="font-mono text-xs text-slate-500">{row.rank}</td>
                            <td className="font-semibold">{row.teamName}</td>
                            <td className="text-right font-mono">{row.played}</td>
                            <td className="text-right font-mono">{row.wins}</td>
                            <td className="text-right font-mono">{row.losses}</td>
                            <td className="text-right font-mono">{row.pointsFor}</td>
                            <td className="text-right font-mono">{row.pointsAgainst}</td>
                            <td className="text-right font-mono">{row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}</td>
                            <td className="text-right font-mono font-bold">{row.leaguePoints}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

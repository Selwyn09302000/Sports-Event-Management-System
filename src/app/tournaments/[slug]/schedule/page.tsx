import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { Badge, EmptyState, formatDateTime } from "@/components/ui";
import { GAME_STATUS_LABELS, type GameStatus } from "@/lib/domain/game-state";
import { listPublicGames } from "@/lib/repos/schedule";
import { getPublicTournamentBySlug, listDivisions } from "@/lib/repos/tournaments";

export const dynamic = "force-dynamic";

export default async function PublicSchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tournament = getPublicTournamentBySlug(slug);
  if (!tournament) notFound();

  const divisions = listDivisions(tournament.organizationId, tournament.id);
  const games = listPublicGames(tournament.id);

  return (
    <div className="min-h-screen">
      <PublicHeader subtitle={tournament.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black">Schedule</h1>
          <nav className="flex gap-2 text-sm">
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}`}>
              Overview
            </Link>
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}/standings`}>
              Standings
            </Link>
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}/bracket`}>
              Bracket
            </Link>
          </nav>
        </div>

        {games.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No games scheduled yet" description="The organizer has not published a schedule." />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {divisions.map((division) => {
              const divisionGames = games.filter((game) => game.divisionId === division.id);
              if (divisionGames.length === 0) return null;
              return (
                <section key={division.id}>
                  <h2 className="mb-2 text-lg font-bold">{division.name}</h2>
                  <div className="card overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Matchup</th>
                          <th>Venue</th>
                          <th className="text-right">Score</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {divisionGames.map((game) => (
                          <tr key={game.id}>
                            <td className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(game.scheduledAt)}</td>
                            <td>
                              <Link className="font-semibold hover:underline" href={`/games/${game.id}/live`}>
                                {game.homeTeamName} <span className="text-slate-400">vs</span> {game.awayTeamName}
                              </Link>
                              {game.stage !== "group" ? (
                                <span className="ml-2 text-[11px] uppercase tracking-wide text-orange-700">{game.stage}</span>
                              ) : null}
                            </td>
                            <td className="text-xs text-slate-600">{game.venueName ?? "—"}</td>
                            <td className="text-right font-mono font-bold">
                              {game.lastEventSeq > 0 || game.status === "final" ? `${game.homeScore}–${game.awayScore}` : "—"}
                            </td>
                            <td>
                              <Badge tone={game.status === "live" ? "live" : game.status === "final" ? "success" : "neutral"}>
                                {GAME_STATUS_LABELS[game.status as GameStatus] ?? game.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

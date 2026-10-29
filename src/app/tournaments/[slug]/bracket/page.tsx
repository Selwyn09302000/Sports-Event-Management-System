import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { Badge, EmptyState } from "@/components/ui";
import { GAME_STATUS_LABELS, type GameStatus } from "@/lib/domain/game-state";
import { getDivisionBracket } from "@/lib/repos/standings";
import { getPublicTournamentBySlug, listDivisions } from "@/lib/repos/tournaments";

export const dynamic = "force-dynamic";

export default async function PublicBracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tournament = getPublicTournamentBySlug(slug);
  if (!tournament) notFound();

  const divisions = listDivisions(tournament.organizationId, tournament.id);

  return (
    <div className="min-h-screen">
      <PublicHeader subtitle={tournament.name} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black">Bracket</h1>
          <nav className="flex gap-2 text-sm">
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}`}>
              Overview
            </Link>
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}/schedule`}>
              Schedule
            </Link>
            <Link className="btn-outline btn-sm" href={`/tournaments/${slug}/standings`}>
              Standings
            </Link>
          </nav>
        </div>

        {tournament.format !== "single_elimination" ? (
          <div className="mt-4">
            <EmptyState
              title="This tournament uses a round-robin format"
              description="Brackets apply to single-elimination tournaments. See standings for the current table."
            />
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {divisions.map((division) => {
              const bracket = getDivisionBracket(tournament.organizationId, division.id);
              return (
                <section key={division.id}>
                  <h2 className="mb-3 text-lg font-bold">{division.name}</h2>
                  {bracket.rounds.length === 0 ? (
                    <p className="muted">Bracket not generated yet.</p>
                  ) : (
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {bracket.rounds.map((round) => (
                        <div key={round.round} className="min-w-64 flex-1 space-y-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{round.name}</p>
                          {round.slots.map((slot) => (
                            <div
                              key={`${round.round}-${slot.slot}`}
                              className={`rounded-lg border bg-white p-3 text-sm shadow-sm ${
                                slot.winnerTeamId ? "border-emerald-300" : "border-slate-200"
                              }`}
                            >
                              {slot.game ? (
                                <Link href={`/games/${slot.game.id}/live`} className="block">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={slot.winnerTeamId === slot.homeTeamId ? "font-bold" : ""}>
                                      {slot.homeName ?? "TBD"}
                                    </span>
                                    <span className="font-mono">{slot.game.homeScore}</span>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between gap-2">
                                    <span className={slot.winnerTeamId === slot.awayTeamId ? "font-bold" : ""}>
                                      {slot.awayName ?? "TBD"}
                                    </span>
                                    <span className="font-mono">{slot.game.awayScore}</span>
                                  </div>
                                  <div className="mt-2">
                                    <Badge tone={slot.game.status === "final" ? "success" : slot.game.status === "live" ? "live" : "neutral"}>
                                      {GAME_STATUS_LABELS[slot.game.status as GameStatus] ?? slot.game.status}
                                    </Badge>
                                  </div>
                                </Link>
                              ) : (
                                <div className="text-slate-600">
                                  <p className="font-semibold">{slot.homeName ?? "TBD"}</p>
                                  <p className="text-xs text-slate-400">{slot.status === "bye" ? "Bye — advances" : "Awaiting winner"}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
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

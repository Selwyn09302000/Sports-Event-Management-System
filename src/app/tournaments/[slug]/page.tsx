import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { EmptyState, formatDate, formatDateTime } from "@/components/ui";
import { GAME_STATUS_LABELS, type GameStatus } from "@/lib/domain/game-state";
import { listPublicGames } from "@/lib/repos/schedule";
import { getPublicTournamentBySlug, listDivisions } from "@/lib/repos/tournaments";

export const dynamic = "force-dynamic";

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tournament = getPublicTournamentBySlug(slug);
  if (!tournament) notFound();

  const divisions = listDivisions(tournament.organizationId, tournament.id);
  const games = listPublicGames(tournament.id);
  const liveGames = games.filter((game) => ["live", "paused", "halftime", "period_ended"].includes(game.status));
  const upcoming = games.filter((game) => ["scheduled", "ready"].includes(game.status)).slice(0, 6);

  const tabs = [
    { href: `/tournaments/${slug}/schedule`, label: "Schedule" },
    { href: `/tournaments/${slug}/standings`, label: "Standings" },
    { href: `/tournaments/${slug}/bracket`, label: "Bracket" },
  ];

  return (
    <div className="min-h-screen">
      <PublicHeader subtitle={tournament.organizationName} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-2xl bg-slate-900 px-6 py-8 text-white">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-orange-400">
            {tournament.format.replaceAll("_", " ")}
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">{tournament.name}</h1>
          <p className="mt-2 text-slate-300">
            {tournament.location ?? "Location TBD"} · {formatDate(tournament.startsOn)} – {formatDate(tournament.endsOn)}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20"
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>

        {tournament.description ? <p className="mt-6 max-w-3xl text-slate-700">{tournament.description}</p> : null}

        <section className="mt-8">
          <h2 className="text-xl font-bold">Live now</h2>
          {liveGames.length === 0 ? (
            <p className="muted mt-2">No game is being scored right now.</p>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {liveGames.map((game) => (
                <li key={game.id}>
                  <Link href={`/games/${game.id}/live`} className="card-pad block border-red-200 bg-red-50 hover:border-red-400">
                    <p className="text-xs font-bold uppercase tracking-wide text-red-700">
                      {GAME_STATUS_LABELS[game.status as GameStatus] ?? game.status}
                    </p>
                    <p className="mt-1 text-lg font-black">
                      {game.homeTeamName} {game.homeScore} – {game.awayScore} {game.awayTeamName}
                    </p>
                    <p className="text-xs text-slate-600">
                      {game.divisionName} · Period {game.currentPeriod}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Divisions</h2>
          {divisions.length === 0 ? (
            <p className="muted mt-2">No divisions published.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {divisions.map((division) => (
                <li key={division.id} className="rounded-full bg-white px-3 py-1 text-sm font-semibold shadow-sm">
                  {division.name}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Upcoming games</h2>
          {upcoming.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="No upcoming games scheduled" />
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 rounded-xl bg-white shadow-sm">
              {upcoming.map((game) => (
                <li key={game.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="font-semibold">
                      {game.homeTeamName} <span className="text-slate-400">vs</span> {game.awayTeamName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {game.divisionName} · {game.venueName ?? "Venue TBD"}
                    </p>
                  </div>
                  <span className="text-xs text-slate-600">{formatDateTime(game.scheduledAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

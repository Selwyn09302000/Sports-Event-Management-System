import Link from "next/link";
import { getDashboard } from "@/lib/repos/dashboard";
import { requireOrganization } from "@/lib/auth/session";
import { Badge, Card, EmptyState, Flash, LinkButton, SectionHeader, Stat, formatDateTime } from "@/components/ui";
import { GAME_STATUS_LABELS, type GameStatus } from "@/lib/domain/game-state";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  live: "live",
  paused: "warning",
  halftime: "warning",
  period_ended: "warning",
  awaiting_review: "info",
  final: "success",
  corrected: "success",
  scheduled: "neutral",
  ready: "neutral",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireOrganization();
  const { error, notice } = await searchParams;
  const data = getDashboard(session.organizationId);

  return (
    <div className="space-y-6">
      <Flash error={error} notice={notice} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{session.organizationName}</p>
          <h1 className="text-2xl font-black text-slate-900">Tournament control</h1>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/dashboard/tournaments" variant="primary">
            Manage tournaments
          </LinkButton>
          <LinkButton href="/dashboard/sync">Sync status</LinkButton>
        </div>
      </div>

      {data.sync.pending > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{data.sync.pending} change(s) waiting to sync.</strong> The local record is safe and the tournament can
          continue.{" "}
          <Link className="font-semibold underline" href="/dashboard/sync">
            Open sync queue
          </Link>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tournaments" value={data.tournaments} hint={`${data.publishedTournaments} published`} />
        <Stat label="Teams" value={data.teams} hint={`${data.players} registered players`} />
        <Stat label="Games" value={data.games} hint={`${data.liveGames} live now`} />
        <Stat label="Awaiting review" value={data.awaitingReview} hint="Needs an approving official" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionHeader title="Next up" description="Open a game to run the scorer console." />
          {data.upcomingGames.length === 0 ? (
            <EmptyState
              title="No scheduled games"
              description="Create a tournament, register teams, then generate a schedule."
              action={<LinkButton href="/dashboard/tournaments">Go to tournaments</LinkButton>}
            />
          ) : (
            <div className="card overflow-hidden">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Matchup</th>
                    <th>When</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.upcomingGames.map((game) => (
                    <tr key={game.id}>
                      <td>
                        <p className="font-semibold">
                          {game.homeTeamName} <span className="text-slate-400">vs</span> {game.awayTeamName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {game.divisionName} · {game.venueName ?? "Venue TBD"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(game.scheduledAt)}</td>
                      <td className="text-right">
                        <Link className="btn-primary btn-sm" href={`/dashboard/games/${game.id}`}>
                          Score
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <SectionHeader title="Recently active" description="Games with recorded events." />
          {data.recentGames.length === 0 ? (
            <EmptyState title="Nothing recorded yet" description="Live games will appear here once scoring starts." />
          ) : (
            <ul className="space-y-2">
              {data.recentGames.map((game) => (
                <li key={game.id} className="card-pad flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {game.homeTeamName} {game.homeScore} – {game.awayScore} {game.awayTeamName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {game.divisionName} · updated {formatDateTime(game.updatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={TONE[game.status] ?? "neutral"}>
                      {GAME_STATUS_LABELS[game.status as GameStatus] ?? game.status}
                    </Badge>
                    <Link className="btn-outline btn-sm" href={`/dashboard/games/${game.id}`}>
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Card>
        <SectionHeader
          title="Device and network access"
          description="Laptop B and officials' phones should open the address shown by the server at startup, not localhost."
        />
        <ul className="muted list-disc space-y-1 pl-5">
          <li>Projector: /scoreboard/&lt;game-id&gt; — read-only, updates over the local network.</li>
          <li>Officials: sign in and use the scorer console or the review screen.</li>
          <li>Offline: scoring keeps working with no internet; changes queue for sync automatically.</li>
        </ul>
      </Card>
    </div>
  );
}

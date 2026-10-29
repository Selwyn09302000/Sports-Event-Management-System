import Link from "next/link";
import { notFound } from "next/navigation";
import { BoxScoreTable } from "@/components/box-score-table";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { Badge, formatDateTime } from "@/components/ui";
import { GAME_STATUS_LABELS, type GameStatus } from "@/lib/domain/game-state";
import { isGamePublic, loadGameState } from "@/lib/repos/games";

export const dynamic = "force-dynamic";

export default async function PublicBoxScorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isGamePublic(id)) notFound();

  const state = loadGameState({ gameId: id, organizationId: null });
  const game = state.game;
  const approved = state.result?.status === "approved";

  return (
    <div className="min-h-screen">
      <PublicHeader subtitle={`${state.tournament.name} · ${game.divisionName}`} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black">
              {game.homeTeamName} {game.homeScore} – {game.awayScore} {game.awayTeamName}
            </h1>
            <p className="muted mt-1">
              {formatDateTime(game.scheduledAt)} · {game.venueName ?? "Venue TBD"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={approved ? "success" : "warning"}>
              {approved ? "Approved result" : GAME_STATUS_LABELS[game.status as GameStatus] ?? game.status}
            </Badge>
            <Link className="btn-outline btn-sm" href={`/games/${id}/live`}>
              Live view
            </Link>
          </div>
        </div>

        {!approved ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            This box score is not yet an approved result. It is calculated from recorded events and may still change.
          </p>
        ) : null}

        <section className="mt-6 space-y-4">
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-bold">{game.homeTeamName}</div>
            <BoxScoreTable boxScore={state.boxScore} teamId={game.homeTeamId} teamName={game.homeTeamName} players={state.roster.home} />
          </div>
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-bold">{game.awayTeamName}</div>
            <BoxScoreTable boxScore={state.boxScore} teamId={game.awayTeamId} teamName={game.awayTeamName} players={state.roster.away} />
          </div>
        </section>

        <p className="mt-4 text-xs text-slate-500">
          Player playing time is not published because it requires complete substitution tracking. No personal
          information (birth date, contact details, documents) is exposed on public pages.
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}

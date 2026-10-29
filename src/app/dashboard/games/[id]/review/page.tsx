import Link from "next/link";
import { notFound } from "next/navigation";
import { BoxScoreTable } from "@/components/box-score-table";
import { ReviewPanel } from "@/components/review-panel";
import { Badge, Card, SectionHeader } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/domain/errors";
import { GAME_STATUS_LABELS, type GameStatus } from "@/lib/domain/game-state";
import { loadGameState } from "@/lib/repos/games";
import { listAuditLogs } from "@/lib/repos/audit";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganization();
  const { id } = await params;

  let state;
  try {
    state = loadGameState({ gameId: id, organizationId: session.organizationId });
  } catch (caught) {
    if (caught instanceof AppError && caught.code === "not_found") notFound();
    throw caught;
  }

  const game = state.game;
  const audit = listAuditLogs(session.organizationId, 60).filter((entry) => entry.entity_id === game.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:underline"
            href={`/dashboard/tournaments/${game.tournamentId}`}
          >
            ← Back to tournament
          </Link>
          <h1 className="mt-1 text-2xl font-black">
            {game.homeTeamName} {game.homeScore} – {game.awayScore} {game.awayTeamName}
          </h1>
          <p className="muted mt-1">
            {state.tournament.name} · {game.divisionName} · Period {state.clock.period}/{game.periodCount}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={game.status === "final" ? "success" : "warning"}>
            {GAME_STATUS_LABELS[game.status as GameStatus] ?? game.status}
          </Badge>
          <Link className="btn-outline btn-sm" href={`/dashboard/games/${game.id}`}>
            Scorer console
          </Link>
        </div>
      </div>

      <Card>
        <SectionHeader
          title="Official review"
          description="Check the score sheet and player totals, then submit and approve the result. Approval updates standings and bracket progression."
        />
        <ReviewPanel
          gameId={game.id}
          status={game.status}
          resultStatus={state.result?.status ?? null}
          resultId={state.result?.id ?? null}
          homeScore={game.homeScore}
          awayScore={game.awayScore}
          canSubmit={hasPermission(session.roles, "game.score")}
          canApprove={hasPermission(session.roles, "result.approve")}
          pendingSyncEvents={state.pendingSyncEvents}
        />
        {state.result?.rejectionReason ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Last rejection: {state.result.rejectionReason}
          </p>
        ) : null}
      </Card>

      <section className="space-y-4">
        <h2 className="section-title">Box score</h2>
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-bold">{game.homeTeamName}</div>
          <BoxScoreTable
            boxScore={state.boxScore}
            teamId={game.homeTeamId}
            teamName={game.homeTeamName}
            players={state.roster.home}
          />
        </div>
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-bold">{game.awayTeamName}</div>
          <BoxScoreTable
            boxScore={state.boxScore}
            teamId={game.awayTeamId}
            teamName={game.awayTeamName}
            players={state.roster.away}
          />
        </div>
      </section>

      <section>
        <h2 className="section-title mb-3">Game audit trail</h2>
        {audit.length === 0 ? (
          <p className="muted">No audit entries for this game yet.</p>
        ) : (
          <ul className="space-y-2">
            {audit.map((entry) => (
              <li key={entry.id} className="card-pad text-sm">
                <p className="font-semibold">
                  {entry.action} <span className="font-normal text-slate-500">by {entry.actor_name ?? "system"}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(entry.created_at).toLocaleString()} · {entry.entity_type}
                </p>
                {entry.reason ? <p className="mt-1 text-xs text-slate-700">Reason: {entry.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

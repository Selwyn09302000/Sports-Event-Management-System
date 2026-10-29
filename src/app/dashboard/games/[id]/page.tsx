import Link from "next/link";
import { notFound } from "next/navigation";
import { ScorerConsole } from "@/components/scorer-console";
import { requireOrganization } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/domain/errors";
import { loadGameState } from "@/lib/repos/games";

export const dynamic = "force-dynamic";

export default async function ScorerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganization();
  const { id } = await params;

  let state;
  try {
    state = loadGameState({ gameId: id, organizationId: session.organizationId });
  } catch (caught) {
    if (caught instanceof AppError && caught.code === "not_found") notFound();
    throw caught;
  }

  return (
    <div className="space-y-4">
      <Link
        className="text-xs font-semibold uppercase tracking-wide text-slate-500 hover:underline"
        href={`/dashboard/tournaments/${state.game.tournamentId}`}
      >
        ← Back to tournament
      </Link>
      <ScorerConsole
        initialState={state}
        canScore={hasPermission(session.roles, "game.score")}
        canReview={hasPermission(session.roles, "game.review")}
        canFinalize={hasPermission(session.roles, "result.approve")}
      />
    </div>
  );
}

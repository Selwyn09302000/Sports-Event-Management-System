import { notFound } from "next/navigation";
import { ProjectorBoard } from "@/components/projector-board";
import { getSession } from "@/lib/auth/session";
import { one } from "@/lib/db/sql";
import { isGamePublic } from "@/lib/repos/games";
import { buildScoreboardView } from "@/lib/repos/scoreboard";

export const dynamic = "force-dynamic";

/**
 * Read-only projector display. Reachable from Laptop B over the local network
 * without internet access. It never writes to game data.
 */
export default async function ScoreboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let organizationId: string | null = null;
  if (session?.organizationId) {
    const owned = one<{ id: string }>("SELECT id FROM games WHERE id = ? AND organization_id = ?", [
      id,
      session.organizationId,
    ]);
    if (owned) organizationId = session.organizationId;
  }

  if (!organizationId && !isGamePublic(id)) notFound();

  const view = buildScoreboardView({ gameId: id, organizationId });
  return <ProjectorBoard gameId={id} initial={view} />;
}

import { jsonError, jsonOk } from "@/lib/api/http";
import { getSession } from "@/lib/auth/session";
import { one } from "@/lib/db/sql";
import { loadGameState } from "@/lib/repos/games";
import { notFound } from "@/lib/domain/errors";

export const dynamic = "force-dynamic";

/**
 * Full game state for the scorer console. Requires membership, or a published
 * tournament (public viewers get a read-only projection through /live).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await getSession();
    const organizationId = session?.organizationId;

    if (!organizationId) throw notFound("Game");
    const owned = one<{ id: string }>("SELECT id FROM games WHERE id = ? AND organization_id = ?", [
      id,
      organizationId,
    ]);
    if (!owned) throw notFound("Game");

    return jsonOk(loadGameState({ gameId: id, organizationId }));
  } catch (error) {
    return jsonError(error);
  }
}

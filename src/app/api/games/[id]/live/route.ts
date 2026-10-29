import { jsonError, jsonOk, clientKey } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { getSession } from "@/lib/auth/session";
import { notFound } from "@/lib/domain/errors";
import { isGamePublic } from "@/lib/repos/games";
import { buildScoreboardView } from "@/lib/repos/scoreboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    enforceRateLimit(`live:${clientKey(request)}`, { limit: 240, windowMs: 60_000 });
    const { id } = await context.params;
    const session = await getSession();

    if (!session?.organizationId && !isGamePublic(id)) throw notFound("Game");

    return jsonOk(buildScoreboardView({ gameId: id, organizationId: session?.organizationId ?? null }));
  } catch (error) {
    return jsonError(error);
  }
}

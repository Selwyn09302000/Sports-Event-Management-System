import { z } from "zod";
import { assertSameOrigin, clientKey, jsonError, jsonOk, readJson } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requireOrganization } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/rbac";
import { correctEvent } from "@/lib/repos/games";

export const dynamic = "force-dynamic";

const schema = z.object({
  playerId: z.string().min(1).nullish(),
  teamId: z.string().min(1).nullish(),
  reason: z.string().min(3).max(500),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireOrganization();
    requirePermission(session.roles, "game.review");
    enforceRateLimit(`correct:${clientKey(request)}`, { limit: 60, windowMs: 60_000 });

    const { id, eventId } = await context.params;
    const body = schema.parse(await readJson(request));

    const state = correctEvent({
      organizationId: session.organizationId,
      gameId: id,
      eventId,
      replacement: { playerId: body.playerId ?? null, teamId: body.teamId ?? null },
      reason: body.reason,
      actor: { userId: session.userId, name: session.userName },
    });

    return jsonOk({ ok: true, state });
  } catch (error) {
    return jsonError(error);
  }
}

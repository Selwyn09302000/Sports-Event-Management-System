import { z } from "zod";
import { assertSameOrigin, clientKey, jsonError, jsonOk, readJson } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requireOrganization } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/rbac";
import { voidEvent } from "@/lib/repos/games";

export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().min(3).max(500) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireOrganization();
    requirePermission(session.roles, "game.review");
    enforceRateLimit(`void:${clientKey(request)}`, { limit: 60, windowMs: 60_000 });

    const { id, eventId } = await context.params;
    const body = schema.parse(await readJson(request));

    const state = voidEvent({
      organizationId: session.organizationId,
      gameId: id,
      eventId,
      reason: body.reason,
      actor: { userId: session.userId, name: session.userName },
    });

    return jsonOk({ ok: true, state });
  } catch (error) {
    return jsonError(error);
  }
}

import { z } from "zod";
import { assertSameOrigin, clientKey, jsonError, jsonOk, readJson } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requirePermissionSession } from "@/lib/auth/session";
import { recordEvent } from "@/lib/repos/games";

export const dynamic = "force-dynamic";

const schema = z.object({
  eventType: z.string().min(1).max(64),
  teamId: z.string().min(1).nullish(),
  playerId: z.string().min(1).nullish(),
  payload: z.record(z.unknown()).optional(),
  clientActionId: z.string().min(8).max(120).nullish(),
  deviceId: z.string().max(120).nullish(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requirePermissionSession("game.score");
    // Generous but bounded: a busy scorer can record several actions a second.
    enforceRateLimit(`events:${clientKey(request)}`, { limit: 240, windowMs: 60_000 });

    const { id } = await context.params;
    const body = schema.parse(await readJson(request));

    const result = recordEvent({
      organizationId: session.organizationId,
      gameId: id,
      event: {
        eventType: body.eventType,
        teamId: body.teamId ?? null,
        playerId: body.playerId ?? null,
        payload: body.payload,
      },
      clientActionId: body.clientActionId ?? null,
      deviceId: body.deviceId ?? null,
      actor: { userId: session.userId, name: session.userName },
    });

    return jsonOk({
      ok: true,
      duplicate: result.duplicate,
      eventId: result.eventId,
      state: result.state,
    });
  } catch (error) {
    return jsonError(error);
  }
}

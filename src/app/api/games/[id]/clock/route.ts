import { z } from "zod";
import { assertSameOrigin, clientKey, jsonError, jsonOk, readJson } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requirePermissionSession } from "@/lib/auth/session";
import { runClockCommand } from "@/lib/repos/games";

export const dynamic = "force-dynamic";

const schema = z.object({
  command: z.discriminatedUnion("type", [
    z.object({ type: z.literal("start") }),
    z.object({ type: z.literal("pause") }),
    z.object({ type: z.literal("toggle") }),
    z.object({ type: z.literal("set"), remainingMs: z.number().int().min(0).max(60 * 60 * 1000) }),
    z.object({ type: z.literal("next_period") }),
    z.object({ type: z.literal("reset_period") }),
  ]),
  deviceId: z.string().max(120).nullish(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requirePermissionSession("game.score");
    enforceRateLimit(`clock:${clientKey(request)}`, { limit: 60, windowMs: 60_000 });

    const { id } = await context.params;
    const body = schema.parse(await readJson(request));

    const state = runClockCommand({
      organizationId: session.organizationId,
      gameId: id,
      command: body.command,
      actor: { userId: session.userId, name: session.userName },
      deviceId: body.deviceId ?? null,
    });

    return jsonOk({ ok: true, state });
  } catch (error) {
    return jsonError(error);
  }
}

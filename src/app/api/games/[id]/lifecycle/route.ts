import { z } from "zod";
import { assertSameOrigin, clientKey, jsonError, jsonOk, readJson } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requireOrganization } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/rbac";
import { AppError } from "@/lib/domain/errors";
import {
  approveResult,
  correctFinalResult,
  endGame,
  endPeriod,
  rejectResult,
  submitResult,
} from "@/lib/repos/games";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("end_period") }),
  z.object({ action: z.literal("end_game") }),
  z.object({ action: z.literal("submit") }),
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().min(3).max(500) }),
  z.object({
    action: z.literal("correct_final"),
    homeScore: z.number().int().min(0).max(500),
    awayScore: z.number().int().min(0).max(500),
    reason: z.string().min(3).max(500),
  }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireOrganization();
    enforceRateLimit(`lifecycle:${clientKey(request)}`, { limit: 60, windowMs: 60_000 });

    const { id } = await context.params;
    const body = schema.parse(await readJson(request));
    const actor = { userId: session.userId, name: session.userName };

    if (body.action === "approve" || body.action === "reject" || body.action === "correct_final") {
      requirePermission(session.roles, "result.approve");
    } else {
      requirePermission(session.roles, "game.score");
    }

    let state;
    switch (body.action) {
      case "end_period":
        state = endPeriod({ organizationId: session.organizationId, gameId: id, actor });
        break;
      case "end_game":
        state = endGame({ organizationId: session.organizationId, gameId: id, actor });
        break;
      case "submit":
        state = submitResult({ organizationId: session.organizationId, gameId: id, actor });
        break;
      case "approve":
        state = approveResult({ organizationId: session.organizationId, gameId: id, actor });
        break;
      case "reject":
        state = rejectResult({ organizationId: session.organizationId, gameId: id, reason: body.reason, actor });
        break;
      case "correct_final":
        state = correctFinalResult({
          organizationId: session.organizationId,
          gameId: id,
          homeScore: body.homeScore,
          awayScore: body.awayScore,
          reason: body.reason,
          actor,
        });
        break;
      default:
        throw new AppError("validation", "Unknown lifecycle action.");
    }

    return jsonOk({ ok: true, state });
  } catch (error) {
    return jsonError(error);
  }
}

import { assertSameOrigin, clientKey, jsonError, jsonOk } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requirePermissionSession } from "@/lib/auth/session";
import { runSync } from "@/lib/sync/runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requirePermissionSession("sync.manage");
    enforceRateLimit(`sync:${clientKey(request)}`, { limit: 30, windowMs: 60_000 });

    const result = await runSync(session.organizationId, { limit: 50 });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}

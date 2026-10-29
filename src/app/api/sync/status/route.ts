import { jsonError, jsonOk } from "@/lib/api/http";
import { requirePermissionSession } from "@/lib/auth/session";
import { listSyncOperations, syncSummary } from "@/lib/repos/sync";
import { syncConfigured } from "@/lib/sync/transport";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requirePermissionSession("sync.manage");
    return jsonOk({
      configured: syncConfigured(),
      summary: syncSummary(session.organizationId),
      recent: listSyncOperations(session.organizationId, { limit: 50 }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

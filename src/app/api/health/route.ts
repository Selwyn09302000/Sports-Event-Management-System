import { one } from "@/lib/db/sql";
import { LATEST_SCHEMA_VERSION } from "@/lib/db/migrations";
import { syncConfigured } from "@/lib/sync/transport";

export const dynamic = "force-dynamic";

export async function GET() {
  const migrations = one<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
  );
  return Response.json({
    ok: true,
    mode: "local-first",
    schemaVersion: migrations?.version ?? null,
    expectedSchemaVersion: LATEST_SCHEMA_VERSION,
    cloudSyncConfigured: syncConfigured(),
    serverTime: new Date().toISOString(),
  });
}

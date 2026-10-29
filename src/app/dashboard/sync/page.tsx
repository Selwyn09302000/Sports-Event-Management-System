import { requirePermissionSession } from "@/lib/auth/session";
import { listSyncOperations, syncSummary } from "@/lib/repos/sync";
import { syncConfigured } from "@/lib/sync/transport";
import { Alert, Badge, Card, EmptyState, SectionHeader, Stat, formatDateTime } from "@/components/ui";
import { SyncRunButton } from "@/components/sync-run-button";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  pending: "warning",
  pushed: "info",
  synchronized: "success",
  conflicted: "danger",
  rejected: "danger",
};

export default async function SyncPage() {
  const session = await requirePermissionSession("sync.manage");
  const summary = syncSummary(session.organizationId);
  const operations = listSyncOperations(session.organizationId, { limit: 100 });
  const configured = syncConfigured();

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Cloud synchronization"
        description="The local SQLite record on this laptop is authoritative. Pushing to the cloud never changes a local game."
      />

      {!configured ? (
        <Alert tone="warning">
          Cloud sync is not configured. Set <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code> and{" "}
          <code>SYNC_ENABLED=true</code> in <code>.env</code>, then restart the server. Offline operation is unaffected.
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting" value={summary.pending + summary.pushed} hint="Queued operations" />
        <Stat label="Synchronized" value={summary.synchronized} hint="Confirmed by the cloud" />
        <Stat label="Conflicted" value={summary.conflicted} hint="Needs a human decision" />
        <Stat label="Unsynced events" value={summary.pendingEvents} hint={`${summary.gamesWithPendingEvents} game(s)`} />
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="section-title">Sync now</h2>
            <p className="muted mt-1 max-w-xl">
              Retries are safe: each queued operation carries a unique idempotency key and the cloud rejects duplicate
              event ids, so a score can never be counted twice.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Last confirmed by the cloud: {summary.lastConfirmedAt ? formatDateTime(summary.lastConfirmedAt) : "never"}
            </p>
          </div>
          <SyncRunButton disabled={!configured} />
        </div>
      </Card>

      <section>
        <h2 className="section-title mb-2">Queue</h2>
        {operations.length === 0 ? (
          <EmptyState title="Nothing queued" description="Every recorded event on this laptop has been pushed." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Entity</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((operation) => (
                  <tr key={operation.id}>
                    <td className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(operation.createdAt)}</td>
                    <td className="text-xs">
                      <span className="font-mono">{operation.entityType}</span>
                      <span className="ml-2 text-slate-400">{operation.entityId.slice(0, 10)}…</span>
                    </td>
                    <td>
                      <Badge tone={TONE[operation.status] ?? "neutral"}>{operation.status}</Badge>
                    </td>
                    <td className="text-xs">{operation.attempts}</td>
                    <td className="max-w-xs truncate text-xs text-red-700" title={operation.lastError ?? ""}>
                      {operation.lastError ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Card>
        <h2 className="section-title mb-2">Recovery</h2>
        <ul className="muted list-disc space-y-1 pl-5">
          <li>Network failures stay pending and retry later; they are never marked synchronized without a receipt.</li>
          <li>
            A conflict means the cloud already holds a different official record. Open the review screen, decide the
            correct result, and record the correction — do not delete the queue.
          </li>
          <li>Export or back up the local database before changing laptops (see docs/BACKUP_RECOVERY.md).</li>
        </ul>
      </Card>
    </div>
  );
}

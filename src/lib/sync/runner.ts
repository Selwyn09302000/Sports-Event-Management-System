import { markEventSyncStatus, markSyncResult, nextPendingOperations, syncSummary, type SyncSummary } from "../repos/sync";
import { getSyncTransport, syncConfigured } from "./transport";

export type SyncRunResult = {
  configured: boolean;
  attempted: number;
  synchronized: number;
  conflicted: number;
  rejected: number;
  stillPending: number;
  summary: SyncSummary;
  errors: string[];
};

/**
 * Pushes queued operations to the cloud and records exactly what the cloud
 * confirmed. Nothing is ever reported as synchronized without a confirmation
 * from the transport.
 */
export async function runSync(organizationId: string, options: { limit?: number } = {}): Promise<SyncRunResult> {
  const transport = getSyncTransport();
  const before = syncSummary(organizationId);

  if (!syncConfigured()) {
    return {
      configured: false,
      attempted: 0,
      synchronized: 0,
      conflicted: 0,
      rejected: 0,
      stillPending: before.pending,
      summary: before,
      errors: ["Cloud sync is not configured. The local record is unaffected."],
    };
  }

  const operations = nextPendingOperations(organizationId, options.limit ?? 25);
  if (operations.length === 0) {
    return {
      configured: true,
      attempted: 0,
      synchronized: 0,
      conflicted: 0,
      rejected: 0,
      stillPending: 0,
      summary: before,
      errors: [],
    };
  }

  const results = await transport.push(
    operations.map((operation) => ({
      operationId: operation.id,
      entityType: operation.entityType,
      entityId: operation.entityId,
      operation: operation.operation,
      idempotencyKey: operation.idempotencyKey,
      payload: operation.payload as Record<string, unknown>,
    })),
  );

  let synchronized = 0;
  let conflicted = 0;
  let rejected = 0;
  const errors: string[] = [];

  for (const result of results) {
    const operation = operations.find((entry) => entry.id === result.operationId);
    if (!operation) continue;

    if (result.status === "synchronized") {
      markSyncResult({
        operationId: operation.id,
        status: "synchronized",
        confirmedAt: result.confirmedAt ?? new Date().toISOString(),
      });
      if (operation.entityType === "game_event") markEventSyncStatus([operation.entityId], "synchronized");
      if (operation.entityType === "game_event_void") {
        // The referenced event keeps its existing status; the void operation is
        // what the cloud confirmed.
      }
      synchronized += 1;
    } else if (result.status === "conflicted") {
      markSyncResult({ operationId: operation.id, status: "conflicted", error: result.error ?? null });
      if (operation.entityType === "game_event") markEventSyncStatus([operation.entityId], "conflicted");
      conflicted += 1;
      if (result.error) errors.push(result.error);
    } else if (result.status === "rejected") {
      markSyncResult({ operationId: operation.id, status: "rejected", error: result.error ?? null });
      if (operation.entityType === "game_event") markEventSyncStatus([operation.entityId], "rejected");
      rejected += 1;
      if (result.error) errors.push(result.error);
    } else {
      markSyncResult({ operationId: operation.id, status: "pending", error: result.error ?? null });
      if (result.error) errors.push(result.error);
    }
  }

  return {
    configured: true,
    attempted: operations.length,
    synchronized,
    conflicted,
    rejected,
    stillPending: operations.length - synchronized,
    summary: syncSummary(organizationId),
    errors: [...new Set(errors)].slice(0, 5),
  };
}

import { newId, nowIso } from "../domain/ids";
import { all, one, run } from "../db/sql";

export type SyncStatus = "pending" | "pushed" | "synchronized" | "conflicted" | "rejected";

export type SyncOperation = {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
  idempotencyKey: string;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  remoteConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SyncRow = {
  id: string;
  organization_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload_json: string;
  idempotency_key: string;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  remote_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapSync(row: SyncRow): SyncOperation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payload: JSON.parse(row.payload_json),
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    remoteConfirmedAt: row.remote_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Queue work for the cloud. `idempotencyKey` is unique, so enqueueing the same
 * event twice is a no-op — this is what makes retries safe.
 */
export function enqueueSyncOperation(input: {
  organizationId: string;
  entityType: string;
  entityId: string;
  operation?: string;
  payload: unknown;
  idempotencyKey: string;
}): void {
  const now = nowIso();
  run(
    `INSERT OR IGNORE INTO sync_operations
       (id, organization_id, entity_type, entity_id, operation, payload_json, idempotency_key, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [
      newId("sop"),
      input.organizationId,
      input.entityType,
      input.entityId,
      input.operation ?? "upsert",
      JSON.stringify(input.payload),
      input.idempotencyKey,
      now,
      now,
    ],
  );
}

export function listSyncOperations(
  organizationId: string,
  options: { status?: SyncStatus; limit?: number } = {},
): SyncOperation[] {
  if (options.status) {
    return all<SyncRow>(
      "SELECT * FROM sync_operations WHERE organization_id = ? AND status = ? ORDER BY created_at LIMIT ?",
      [organizationId, options.status, options.limit ?? 100],
    ).map(mapSync);
  }
  return all<SyncRow>("SELECT * FROM sync_operations WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?", [
    organizationId,
    options.limit ?? 100,
  ]).map(mapSync);
}

export function nextPendingOperations(organizationId: string, limit = 50): SyncOperation[] {
  return all<SyncRow>(
    `SELECT * FROM sync_operations
      WHERE organization_id = ? AND status IN ('pending', 'pushed')
      ORDER BY created_at LIMIT ?`,
    [organizationId, limit],
  ).map(mapSync);
}

export type SyncSummary = {
  pending: number;
  pushed: number;
  synchronized: number;
  conflicted: number;
  rejected: number;
  pendingEvents: number;
  lastConfirmedAt: string | null;
  gamesWithPendingEvents: number;
};

export function syncSummary(organizationId: string): SyncSummary {
  const counts = all<{ status: SyncStatus; n: number }>(
    "SELECT status, COUNT(*) AS n FROM sync_operations WHERE organization_id = ? GROUP BY status",
    [organizationId],
  );
  const byStatus = new Map(counts.map((row) => [row.status, row.n]));

  // Conflicted events are still not in the cloud, so they must count as
  // unsynced. Only events the cloud has confirmed are excluded.
  const pendingEvents = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM game_events WHERE organization_id = ? AND sync_status IN ('pending', 'conflicted')",
    [organizationId],
  );
  const gamesWithPending = one<{ n: number }>(
    `SELECT COUNT(DISTINCT game_id) AS n FROM game_events
      WHERE organization_id = ? AND sync_status IN ('pending', 'conflicted')`,
    [organizationId],
  );
  const lastConfirmed = one<{ at: string | null }>(
    "SELECT MAX(remote_confirmed_at) AS at FROM sync_operations WHERE organization_id = ? AND status = 'synchronized'",
    [organizationId],
  );

  return {
    pending: byStatus.get("pending") ?? 0,
    pushed: byStatus.get("pushed") ?? 0,
    synchronized: byStatus.get("synchronized") ?? 0,
    conflicted: byStatus.get("conflicted") ?? 0,
    rejected: byStatus.get("rejected") ?? 0,
    pendingEvents: pendingEvents?.n ?? 0,
    lastConfirmedAt: lastConfirmed?.at ?? null,
    gamesWithPendingEvents: gamesWithPending?.n ?? 0,
  };
}

export function markSyncResult(input: {
  operationId: string;
  status: SyncStatus;
  error?: string | null;
  confirmedAt?: string | null;
}): void {
  run(
    `UPDATE sync_operations
        SET status = ?, attempts = attempts + 1, last_error = ?, remote_confirmed_at = ?, updated_at = ?
      WHERE id = ?`,
    [input.status, input.error ?? null, input.confirmedAt ?? null, nowIso(), input.operationId],
  );
}

export function markEventSyncStatus(eventIds: string[], status: "pending" | "synchronized" | "conflicted" | "rejected"): void {
  for (const eventId of eventIds) {
    run("UPDATE game_events SET sync_status = ? WHERE id = ?", [status, eventId]);
  }
}

/** Used by the review screen to warn before finalizing an unsynced game. */
export function countPendingEvents(gameId: string): number {
  return (
    one<{ n: number }>("SELECT COUNT(*) AS n FROM game_events WHERE game_id = ? AND sync_status = 'pending'", [
      gameId,
    ])?.n ?? 0
  );
}

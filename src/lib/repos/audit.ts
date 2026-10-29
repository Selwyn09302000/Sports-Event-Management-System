import { newId, nowIso } from "../domain/ids";
import { all, one, run } from "../db/sql";

export type AuditInput = {
  organizationId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

export type AuditRow = {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  created_at: string;
};

export function recordAudit(entry: AuditInput): void {
  run(
    `INSERT INTO audit_logs (id, organization_id, actor_user_id, actor_name, action, entity_type, entity_id, before_json, after_json, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("aud"),
      entry.organizationId,
      entry.actorUserId ?? null,
      entry.actorName ?? null,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.reason ?? null,
      nowIso(),
    ],
  );
}

export function listAuditLogs(organizationId: string, limit = 200): AuditRow[] {
  return all<AuditRow>(
    "SELECT * FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?",
    [organizationId, limit],
  );
}

export function countAuditLogs(organizationId: string): number {
  return (
    one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ?", [organizationId])?.n ?? 0
  );
}

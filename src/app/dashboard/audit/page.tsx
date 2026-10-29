import { requirePermissionSession } from "@/lib/auth/session";
import { countAuditLogs, listAuditLogs } from "@/lib/repos/audit";
import { EmptyState, SectionHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await requirePermissionSession("audit.read");
  const entries = listAuditLogs(session.organizationId, 200);
  const total = countAuditLogs(session.organizationId);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Audit log"
        description={`${total} recorded action(s). Every correction, approval and roster change is retained.`}
      />

      {entries.length === 0 ? (
        <EmptyState title="No audit entries yet" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Entity</th>
                <th>Reason / details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-xs text-slate-600">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="font-mono text-xs font-semibold">{entry.action}</td>
                  <td className="text-xs">{entry.actor_name ?? "system"}</td>
                  <td className="text-xs text-slate-600">
                    {entry.entity_type}
                    <span className="ml-1 text-slate-400">{entry.entity_id.slice(0, 10)}…</span>
                  </td>
                  <td className="max-w-sm text-xs text-slate-700">
                    {entry.reason ?? entry.before_json ? entry.reason ?? "changed" : "—"}
                    {entry.before_json ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-slate-500">before / after</summary>
                        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[10px]">
                          {entry.before_json}
                          {"\n→\n"}
                          {entry.after_json ?? "—"}
                        </pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

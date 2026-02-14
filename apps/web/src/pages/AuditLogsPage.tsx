import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";

type AuditLogsResponse = {
  data: Array<{
    id: string;
    action: string;
    project_id: string | null;
    user_name: string | null;
    user_email: string | null;
    created_at: string;
  }>;
  meta: {
    total: number;
  };
};

export function AuditLogsPage() {
  const { accessToken, user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);

  const auditLogsQuery = useQuery({
    queryKey: ["audit-logs-page"],
    queryFn: () =>
      apiRequest<AuditLogsResponse>("/users/audit-logs?page=1&pageSize=100&sortBy=createdAt&sortOrder=desc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken && isAdmin)
  });

  if (!isAdmin) {
    return <div className="state-card">Audit logs are restricted to owner/high-clearance users.</div>;
  }

  return (
    <section>
      <div className="section-head">
        <h2>Audit Logs</h2>
        <p className="muted">{auditLogsQuery.data?.meta.total ?? 0} entries</p>
      </div>
      <div className="card">
        {auditLogsQuery.isLoading ? (
          <p>Loading audit logs...</p>
        ) : auditLogsQuery.isError ? (
          <p>Could not load audit logs.</p>
        ) : !auditLogsQuery.data?.data.length ? (
          <p className="muted">No audit entries.</p>
        ) : (
          <div className="activity-list">
            {auditLogsQuery.data.data.map((entry) => (
              <article key={entry.id} className="activity-item">
                <p className="notice-title">{entry.action}</p>
                <p className="muted">
                  by {entry.user_name ?? entry.user_email ?? "system"} at{" "}
                  {new Date(entry.created_at).toLocaleString()}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}


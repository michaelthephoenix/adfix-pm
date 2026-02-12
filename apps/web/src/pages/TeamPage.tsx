import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";

type UsersResponse = {
  data: Array<{
    id: string;
    name: string;
    email: string;
    is_active: boolean;
    is_admin: boolean;
    last_login_at: string | null;
    created_at: string;
  }>;
  meta: {
    total: number;
  };
};

type AuditLogsResponse = {
  data: Array<{
    id: string;
    action: string;
    created_at: string;
    user_name: string | null;
    user_email: string | null;
  }>;
};

export function TeamPage() {
  const { accessToken, user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = Boolean(user?.isAdmin);

  const usersQuery = useQuery({
    queryKey: ["team-users"],
    queryFn: () =>
      apiRequest<UsersResponse>("/users?page=1&pageSize=100&sortBy=name&sortOrder=asc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const auditLogsQuery = useQuery({
    queryKey: ["team-audit-logs"],
    queryFn: () =>
      apiRequest<AuditLogsResponse>("/users/audit-logs?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken && isAdmin)
  });

  const toggleUserStatusMutation = useMutation({
    mutationFn: (input: { userId: string; isActive: boolean }) =>
      apiRequest(`/users/${input.userId}/status`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined,
        body: { isActive: input.isActive }
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["team-users"] }),
        queryClient.invalidateQueries({ queryKey: ["team-audit-logs"] })
      ]);
    }
  });

  return (
    <section>
      <div className="section-head">
        <h2>Team</h2>
        <p className="muted">{usersQuery.data?.meta.total ?? 0} users</p>
      </div>

      <div className="card table-wrap">
        {usersQuery.isLoading ? (
          <p>Loading users...</p>
        ) : usersQuery.isError ? (
          <p>Could not load users.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Admin</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersQuery.data?.data.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.email}</td>
                  <td>{item.is_admin ? "yes" : "no"}</td>
                  <td>{item.is_active ? "active" : "inactive"}</td>
                  <td>{item.last_login_at ? new Date(item.last_login_at).toLocaleString() : "-"}</td>
                  <td>
                    {isAdmin ? (
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={toggleUserStatusMutation.isPending}
                        onClick={() =>
                          toggleUserStatusMutation.mutate({
                            userId: item.id,
                            isActive: !item.is_active
                          })
                        }
                      >
                        {item.is_active ? "Deactivate" : "Activate"}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Audit Log</h3>
        {!isAdmin ? (
          <p className="muted">Admin access required for audit log view.</p>
        ) : auditLogsQuery.isLoading ? (
          <p>Loading audit logs...</p>
        ) : auditLogsQuery.isError ? (
          <p>Could not load audit logs.</p>
        ) : (
          <div className="activity-list">
            {auditLogsQuery.data?.data.length ? (
              auditLogsQuery.data.data.map((entry) => (
                <article key={entry.id} className="activity-item">
                  <p className="notice-title">{entry.action}</p>
                  <p className="muted">
                    by {entry.user_name ?? entry.user_email ?? "system"} at{" "}
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                </article>
              ))
            ) : (
              <p className="muted">No audit entries.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

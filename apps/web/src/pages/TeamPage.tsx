import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

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

export function TeamPage() {
  const { accessToken, user } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const isAdmin = Boolean(user?.isAdmin);
  const [processingUserUpdate, setProcessingUserUpdate] = useState<{
    userId: string;
    nextIsActive: boolean;
  } | null>(null);

  const usersQuery = useQuery({
    queryKey: ["team-users"],
    queryFn: () =>
      apiRequest<UsersResponse>("/users?page=1&pageSize=100&sortBy=name&sortOrder=asc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const toggleUserStatusMutation = useMutation({
    onMutate: async (input: { userId: string; isActive: boolean }) => {
      setProcessingUserUpdate({ userId: input.userId, nextIsActive: input.isActive });
      const filter = { queryKey: ["team-users"] as const };
      await queryClient.cancelQueries(filter);
      const snapshots = queryClient.getQueriesData<UsersResponse>(filter);

      snapshots.forEach(([queryKey, previous]) => {
        if (!previous) return;
        queryClient.setQueryData<UsersResponse>(queryKey, {
          ...previous,
          data: previous.data.map((row) =>
            row.id === input.userId ? { ...row, is_active: input.isActive } : row
          )
        });
      });

      return { snapshots };
    },
    mutationFn: (input: { userId: string; isActive: boolean }) =>
      apiRequest(`/users/${input.userId}/status`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined,
        body: { isActive: input.isActive }
      }),
    onSuccess: async (_result, input) => {
      ui.success(input.isActive ? "User activated." : "User deactivated.");
      await queryClient.invalidateQueries({ queryKey: ["team-users"] });
    },
    onError: (_error, _input, context) => {
      context?.snapshots?.forEach(([queryKey, previous]) => {
        queryClient.setQueryData(queryKey, previous);
      });
      ui.error("Could not update user status.");
    },
    onSettled: () => {
      setProcessingUserUpdate(null);
    }
  });

  return (
    <section>
      <div className="section-head">
        <h2>Team</h2>
        <div className="inline-actions">
          <p className="muted">{usersQuery.data?.meta.total ?? 0} users</p>
          {isAdmin ? (
            <Link to="/audit-logs" className="ghost-button">
              View audit logs
            </Link>
          ) : null}
        </div>
      </div>

      <div className="card table-wrap">
        {usersQuery.isLoading ? (
          <LoadingState message="Loading users..." />
        ) : usersQuery.isError ? (
          <ErrorState message="Could not load users." onRetry={() => void usersQuery.refetch()} />
        ) : (usersQuery.data?.data.length ?? 0) === 0 ? (
          <EmptyState message="No users found." />
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
                        disabled={Boolean(processingUserUpdate)}
                        onClick={() =>
                          toggleUserStatusMutation.mutate({
                            userId: item.id,
                            isActive: !item.is_active
                          })
                        }
                      >
                        {processingUserUpdate?.userId === item.id
                          ? processingUserUpdate.nextIsActive
                            ? "Activating..."
                            : "Deactivating..."
                          : item.is_active
                            ? "Deactivate"
                            : "Activate"}
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
    </section>
  );
}

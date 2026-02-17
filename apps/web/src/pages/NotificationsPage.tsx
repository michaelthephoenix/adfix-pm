import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type NotificationsResponse = {
  data: Notification[];
  meta: {
    total: number;
    unreadCount: number;
  };
};

export function NotificationsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      apiRequest<NotificationsResponse>("/notifications?page=1&pageSize=50&sortOrder=desc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/notifications/${id}/read`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  const markAllReadMutation = useMutation({
    mutationFn: () =>
      apiRequest("/notifications/read-all", {
        method: "POST",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  if (notificationsQuery.isLoading) {
    return <LoadingState message="Loading notifications..." />;
  }

  if (notificationsQuery.isError) {
    return <ErrorState message="Could not load notifications." />;
  }

  return (
    <section>
      <div className="section-head">
        <h2>Notifications</h2>
        <div className="inline-actions">
          <p className="muted">{notificationsQuery.data?.meta.unreadCount ?? 0} unread</p>
          <button className="ghost-button" onClick={() => markAllReadMutation.mutate()}>
            Mark all read
          </button>
        </div>
      </div>
      <div className="card notifications-list">
        {notificationsQuery.data?.data.length ? (
          notificationsQuery.data.data.map((notification) => (
            <article key={notification.id} className={notification.is_read ? "notice read" : "notice"}>
              <div>
                <p className="notice-title">{notification.title}</p>
                <p>{notification.message}</p>
              </div>
              {!notification.is_read ? (
                <button
                  className="ghost-button"
                  onClick={() => markReadMutation.mutate(notification.id)}
                  disabled={markReadMutation.isPending}
                >
                  Mark read
                </button>
              ) : null}
            </article>
          ))
        ) : (
          <EmptyState message="No notifications yet." />
        )}
      </div>
    </section>
  );
}

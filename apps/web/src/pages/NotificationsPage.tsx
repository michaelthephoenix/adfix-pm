import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
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
  const ui = useUI();
  const queryClient = useQueryClient();
  const [processingNotificationId, setProcessingNotificationId] = useState<string | null>(null);

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      apiRequest<NotificationsResponse>("/notifications?page=1&pageSize=50&sortOrder=desc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const markReadMutation = useMutation({
    onMutate: async (id: string) => {
      setProcessingNotificationId(id);
      const filter = { queryKey: ["notifications"] as const };
      await queryClient.cancelQueries(filter);
      const snapshots = queryClient.getQueriesData<NotificationsResponse>(filter);

      snapshots.forEach(([queryKey, previous]) => {
        if (!previous) return;
        queryClient.setQueryData<NotificationsResponse>(queryKey, {
          ...previous,
          data: previous.data.map((item) =>
            item.id === id ? { ...item, is_read: true } : item
          ),
          meta: {
            ...previous.meta,
            unreadCount: Math.max(
              0,
              previous.meta.unreadCount - (previous.data.some((item) => item.id === id && !item.is_read) ? 1 : 0)
            )
          }
        });
      });

      return { snapshots };
    },
    mutationFn: (id: string) =>
      apiRequest(`/notifications/${id}/read`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: () => {
      ui.success("Notification marked as read.");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (_error, _id, context) => {
      context?.snapshots?.forEach(([queryKey, previous]) => {
        queryClient.setQueryData(queryKey, previous);
      });
      ui.error("Could not mark notification as read.");
    },
    onSettled: () => {
      setProcessingNotificationId(null);
    }
  });

  const markAllReadMutation = useMutation({
    onMutate: async () => {
      const filter = { queryKey: ["notifications"] as const };
      await queryClient.cancelQueries(filter);
      const snapshots = queryClient.getQueriesData<NotificationsResponse>(filter);

      snapshots.forEach(([queryKey, previous]) => {
        if (!previous) return;
        queryClient.setQueryData<NotificationsResponse>(queryKey, {
          ...previous,
          data: previous.data.map((item) => ({ ...item, is_read: true })),
          meta: {
            ...previous.meta,
            unreadCount: 0
          }
        });
      });

      return { snapshots };
    },
    mutationFn: () =>
      apiRequest("/notifications/read-all", {
        method: "POST",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: () => {
      ui.success("All notifications marked as read.");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (_error, _input, context) => {
      context?.snapshots?.forEach(([queryKey, previous]) => {
        queryClient.setQueryData(queryKey, previous);
      });
      ui.error("Could not mark all notifications as read.");
    }
  });

  if (notificationsQuery.isLoading) {
    return <LoadingState message="Loading notifications..." />;
  }

  if (notificationsQuery.isError) {
    return (
      <ErrorState message="Could not load notifications." onRetry={() => void notificationsQuery.refetch()} />
    );
  }

  return (
    <section>
      <div className="section-head">
        <h2>Notifications</h2>
        <div className="inline-actions">
          <p className="muted">{notificationsQuery.data?.meta.unreadCount ?? 0} unread</p>
          <button
            className="ghost-button"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            {markAllReadMutation.isPending ? "Marking all..." : "Mark all read"}
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
                  disabled={Boolean(processingNotificationId) || markAllReadMutation.isPending}
                >
                  {processingNotificationId === notification.id ? "Marking..." : "Mark read"}
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

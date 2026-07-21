import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ArrowRight, ArrowUpRight, CircleOff, RotateCcw } from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";

type NotificationView = "all" | "unread" | "action_required" | "resolved" | "archived";
type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  project_id: string | null;
  task_id: string | null;
  metadata: Record<string, unknown>;
  action_required: boolean;
  action_status: "open" | "resolved" | "superseded";
  resolution_reason: string | null;
  archived_at: string | null;
  target_available: boolean;
};

type NotificationsResponse = {
  data: Notification[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    unreadCount: number;
    openActionCount: number;
  };
};

type CountResponse = { meta: { unreadCount: number } };

const notificationViews: Array<{ value: NotificationView; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "action_required", label: "Action required" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" }
];

function isNotificationView(value: string | null): value is NotificationView {
  return notificationViews.some((view) => view.value === value);
}

function safePage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function notificationHref(notification: Notification, accountType: "staff" | "client") {
  if (!notification.target_available) return null;
  const metadataHref = typeof notification.metadata?.href === "string" ? notification.metadata.href : null;
  if (accountType === "client") {
    if (notification.project_id) return `/portal/projects/${notification.project_id}`;
    if (metadataHref?.startsWith("/portal/") || metadataHref === "/settings" || metadataHref === "/notifications") return metadataHref;
    return null;
  }
  if (notification.project_id) {
    if (notification.task_id) return `/projects/${notification.project_id}?tab=tasks&task=${notification.task_id}`;
    if (metadataHref?.startsWith(`/projects/${notification.project_id}`)) return metadataHref;
    return `/projects/${notification.project_id}`;
  }
  if (metadataHref && ["/dashboard", "/projects", "/tasks", "/clients", "/team", "/notifications", "/settings"].some((path) => metadataHref === path || metadataHref.startsWith(`${path}?`))) {
    return metadataHref;
  }
  return null;
}

export function NotificationsPage() {
  const { accessToken, user } = useAuth();
  const ui = useUI();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = isNotificationView(searchParams.get("view")) ? searchParams.get("view") as NotificationView : "all";
  const page = safePage(searchParams.get("page"));
  const pageSize = 20;

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "list", view, page],
    queryFn: () => apiRequest<NotificationsResponse>(`/notifications?view=${view}&page=${page}&pageSize=${pageSize}&sortOrder=desc`, {
      accessToken: accessToken ?? undefined
    }),
    enabled: Boolean(accessToken)
  });

  const updateUnreadCount = (change: number) => {
    queryClient.setQueryData<CountResponse>(["notifications", "unread-count"], (previous) => previous ? {
      ...previous,
      meta: { ...previous.meta, unreadCount: Math.max(0, previous.meta.unreadCount + change) }
    } : previous);
  };

  const markReadMutation = useMutation({
    onMutate: async (id: string) => {
      const filter = { queryKey: ["notifications", "list"] as const };
      await queryClient.cancelQueries(filter);
      const snapshots = queryClient.getQueriesData<NotificationsResponse>(filter);
      let unreadChanged = false;
      snapshots.forEach(([queryKey, previous]) => {
        if (!previous) return;
        const wasUnread = previous.data.some((item) => item.id === id && !item.is_read);
        unreadChanged ||= wasUnread;
        queryClient.setQueryData<NotificationsResponse>(queryKey, {
          ...previous,
          data: previous.data.map((item) => item.id === id ? { ...item, is_read: true } : item),
          meta: { ...previous.meta, unreadCount: Math.max(0, previous.meta.unreadCount - (wasUnread ? 1 : 0)) }
        });
      });
      if (unreadChanged) updateUnreadCount(-1);
      return { snapshots, unreadChanged };
    },
    mutationFn: (id: string) => apiRequest(`/notifications/${id}/read`, {
      method: "PATCH",
      accessToken: accessToken ?? undefined
    }),
    onError: (_error, _id, context) => {
      context?.snapshots.forEach(([queryKey, previous]) => queryClient.setQueryData(queryKey, previous));
      if (context?.unreadChanged) updateUnreadCount(1);
      ui.error("Could not mark notification as read.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  const markAllReadMutation = useMutation({
    onMutate: async () => {
      const filter = { queryKey: ["notifications", "list"] as const };
      await queryClient.cancelQueries(filter);
      const snapshots = queryClient.getQueriesData<NotificationsResponse>(filter);
      const countSnapshot = queryClient.getQueryData<CountResponse>(["notifications", "unread-count"]);
      snapshots.forEach(([queryKey, previous]) => {
        if (!previous) return;
        queryClient.setQueryData<NotificationsResponse>(queryKey, {
          ...previous,
          data: previous.data.map((item) => ({ ...item, is_read: true })),
          meta: { ...previous.meta, unreadCount: 0 }
        });
      });
      queryClient.setQueryData<CountResponse>(["notifications", "unread-count"], (previous) => previous ? { ...previous, meta: { ...previous.meta, unreadCount: 0 } } : previous);
      return { snapshots, countSnapshot };
    },
    mutationFn: () => apiRequest("/notifications/read-all", {
      method: "POST",
      accessToken: accessToken ?? undefined
    }),
    onSuccess: () => ui.success("All notifications marked as read."),
    onError: (_error, _input, context) => {
      context?.snapshots.forEach(([queryKey, previous]) => queryClient.setQueryData(queryKey, previous));
      if (context?.countSnapshot) queryClient.setQueryData(["notifications", "unread-count"], context.countSnapshot);
      ui.error("Could not mark all notifications as read.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  const archiveMutation = useMutation({
    mutationFn: (notification: Notification) => apiRequest(`/notifications/${notification.id}/archive`, {
      method: "PATCH",
      accessToken: accessToken ?? undefined
    }),
    onMutate: async (notification) => {
      const queryKey = ["notifications", "list", view, page] as const;
      await queryClient.cancelQueries({ queryKey });
      const snapshot = queryClient.getQueryData<NotificationsResponse>(queryKey);
      if (snapshot) queryClient.setQueryData<NotificationsResponse>(queryKey, {
        ...snapshot,
        data: snapshot.data.filter((item) => item.id !== notification.id),
        meta: {
          ...snapshot.meta,
          total: Math.max(0, snapshot.meta.total - 1),
          unreadCount: Math.max(0, snapshot.meta.unreadCount - (notification.is_read ? 0 : 1))
        }
      });
      if (!notification.is_read) updateUnreadCount(-1);
      return { queryKey, snapshot, changedUnread: !notification.is_read };
    },
    onSuccess: () => ui.success("Notification archived."),
    onError: (_error, _notification, context) => {
      if (context?.snapshot) queryClient.setQueryData(context.queryKey, context.snapshot);
      if (context?.changedUnread) updateUnreadCount(1);
      ui.error("Could not archive this notification.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/notifications/${id}/restore`, {
      method: "PATCH",
      accessToken: accessToken ?? undefined
    }),
    onSuccess: () => ui.success("Notification restored."),
    onError: () => ui.error("Could not restore this notification."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  const setView = (nextView: NotificationView) => {
    const next = new URLSearchParams(searchParams);
    next.set("view", nextView);
    next.delete("page");
    setSearchParams(next);
  };

  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("view", view);
    next.set("page", String(nextPage));
    setSearchParams(next);
  };

  const openNotification = (notification: Notification) => {
    const href = notificationHref(notification, user?.accountType ?? "staff");
    if (!href) return;
    if (!notification.is_read) markReadMutation.mutate(notification.id);
    navigate(href);
  };

  if (notificationsQuery.isLoading) return <LoadingState message="Loading notifications..." />;
  if (notificationsQuery.isError) return <ErrorState message="Could not load notifications." onRetry={() => void notificationsQuery.refetch()} />;

  const response = notificationsQuery.data;
  const unreadCount = response?.meta.unreadCount ?? 0;
  const openActionCount = response?.meta.openActionCount ?? 0;
  const pageCount = Math.max(1, Math.ceil((response?.meta.total ?? 0) / pageSize));

  return (
    <section>
      <PageHeader
        title="Notifications"
        description="Approval requests, assignments, and client feedback that need your attention."
        meta={<span>{openActionCount} awaiting action · {unreadCount} unread</span>}
        actions={unreadCount > 0 && view !== "archived" ? (
          <Button onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending}>
            {markAllReadMutation.isPending ? "Marking..." : "Mark all read"}
          </Button>
        ) : null}
      />

      <div className="notification-filter-bar" role="tablist" aria-label="Notification filter">
        {notificationViews.map((filter) => (
          <button key={filter.value} type="button" role="tab" aria-selected={view === filter.value} onClick={() => setView(filter.value)}>
            {filter.label}
            {filter.value === "unread" && unreadCount > 0 ? <span>{unreadCount}</span> : null}
            {filter.value === "action_required" && openActionCount > 0 ? <span>{openActionCount}</span> : null}
          </button>
        ))}
      </div>

      <div className="card notifications-list">
        {response?.data.length ? response.data.map((notification) => {
          const href = notificationHref(notification, user?.accountType ?? "staff");
          const canArchive = !notification.target_available || !notification.action_required || notification.action_status !== "open";
          return (
            <article key={notification.id} className={`${notification.is_read ? "notice read" : "notice"}${notification.target_available ? "" : " stale"}`}>
              <div>
                <p className="notice-title">{notification.title}</p>
                <p>{notification.message}</p>
                {notification.action_required ? <span className={`status-chip status-${notification.action_status}`}>{notification.action_status === "open" ? "Action needed" : notification.action_status === "resolved" ? "Resolved" : "Superseded"}</span> : null}
                {!notification.target_available ? <span className="notification-stale-label"><CircleOff size={13} /> Target no longer available</span> : null}
                <time className="notice-time" dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString()}</time>
              </div>
              <div className="notice-actions">
                {href ? <Button size="sm" icon={<ArrowUpRight size={14} />} onClick={() => openNotification(notification)}>Open</Button> : null}
                {!notification.is_read && view !== "archived" ? <Button variant="ghost" size="sm" onClick={() => markReadMutation.mutate(notification.id)}>Mark read</Button> : null}
                {view === "archived" ? (
                  <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => restoreMutation.mutate(notification.id)} disabled={restoreMutation.isPending}>Restore</Button>
                ) : canArchive ? (
                  <Button variant="ghost" size="sm" icon={<Archive size={14} />} onClick={() => archiveMutation.mutate(notification)} disabled={archiveMutation.isPending}>Archive</Button>
                ) : null}
              </div>
            </article>
          );
        }) : <EmptyState message={view === "archived" ? "No archived notifications." : view === "action_required" ? "No actions are waiting for you." : "No notifications in this view."} />}
      </div>

      {pageCount > 1 ? (
        <nav className="pagination-bar" aria-label="Notification pages">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => setPage(page - 1)} disabled={page <= 1}>Previous</Button>
          <span>Page {page} of {pageCount} · {response?.meta.total ?? 0} notifications</span>
          <Button variant="ghost" size="sm" icon={<ArrowRight size={14} />} onClick={() => setPage(page + 1)} disabled={page >= pageCount}>Next</Button>
        </nav>
      ) : null}
    </section>
  );
}

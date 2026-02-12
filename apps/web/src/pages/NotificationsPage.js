import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
export function NotificationsPage() {
    const { accessToken } = useAuth();
    const queryClient = useQueryClient();
    const notificationsQuery = useQuery({
        queryKey: ["notifications"],
        queryFn: () => apiRequest("/notifications?page=1&pageSize=50&sortOrder=desc", {
            accessToken: accessToken ?? undefined
        }),
        enabled: Boolean(accessToken)
    });
    const markReadMutation = useMutation({
        mutationFn: (id) => apiRequest(`/notifications/${id}/read`, {
            method: "PATCH",
            accessToken: accessToken ?? undefined
        }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
    });
    const markAllReadMutation = useMutation({
        mutationFn: () => apiRequest("/notifications/read-all", {
            method: "POST",
            accessToken: accessToken ?? undefined
        }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
    });
    if (notificationsQuery.isLoading) {
        return _jsx("div", { className: "state-card", children: "Loading notifications..." });
    }
    if (notificationsQuery.isError) {
        return _jsx("div", { className: "state-card", children: "Could not load notifications." });
    }
    return (_jsxs("section", { children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "Notifications" }), _jsxs("div", { className: "inline-actions", children: [_jsxs("p", { className: "muted", children: [notificationsQuery.data?.meta.unreadCount ?? 0, " unread"] }), _jsx("button", { className: "ghost-button", onClick: () => markAllReadMutation.mutate(), children: "Mark all read" })] })] }), _jsx("div", { className: "card notifications-list", children: notificationsQuery.data?.data.map((notification) => (_jsxs("article", { className: notification.is_read ? "notice read" : "notice", children: [_jsxs("div", { children: [_jsx("p", { className: "notice-title", children: notification.title }), _jsx("p", { children: notification.message })] }), !notification.is_read ? (_jsx("button", { className: "ghost-button", onClick: () => markReadMutation.mutate(notification.id), disabled: markReadMutation.isPending, children: "Mark read" })) : null] }, notification.id))) })] }));
}

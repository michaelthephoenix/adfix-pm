import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
export function DashboardPage() {
    const { accessToken } = useAuth();
    const dashboardQuery = useQuery({
        queryKey: ["dashboard"],
        queryFn: () => apiRequest("/analytics/dashboard", {
            accessToken: accessToken ?? undefined
        }),
        enabled: Boolean(accessToken)
    });
    if (dashboardQuery.isLoading) {
        return _jsx("div", { className: "state-card", children: "Loading dashboard..." });
    }
    if (dashboardQuery.isError) {
        return _jsx("div", { className: "state-card", children: "Could not load dashboard." });
    }
    const metrics = dashboardQuery.data?.data;
    if (!metrics) {
        return _jsx("div", { className: "state-card", children: "No metrics available." });
    }
    const totalProjects = metrics.projectsByPhase.reduce((sum, phase) => sum + phase.count, 0);
    return (_jsxs("section", { children: [_jsx("h2", { children: "Dashboard" }), _jsxs("div", { className: "kpi-grid", children: [_jsxs("article", { className: "card", children: [_jsx("p", { className: "eyebrow", children: "Total projects" }), _jsx("p", { className: "kpi-value", children: totalProjects })] }), _jsxs("article", { className: "card", children: [_jsx("p", { className: "eyebrow", children: "Overdue tasks" }), _jsx("p", { className: "kpi-value", children: metrics.overdueTasksCount })] }), _jsxs("article", { className: "card", children: [_jsx("p", { className: "eyebrow", children: "Delivered this month" }), _jsx("p", { className: "kpi-value", children: metrics.projectsCompletedThisMonth })] }), _jsxs("article", { className: "card", children: [_jsx("p", { className: "eyebrow", children: "Delivered this quarter" }), _jsx("p", { className: "kpi-value", children: metrics.projectsCompletedThisQuarter })] })] }), _jsxs("article", { className: "card", children: [_jsx("h3", { children: "Projects by phase" }), _jsx("div", { className: "phase-list", children: metrics.projectsByPhase.map((phase) => (_jsxs("p", { children: [_jsx("strong", { children: phase.phase }), ": ", phase.count] }, phase.phase))) })] })] }));
}

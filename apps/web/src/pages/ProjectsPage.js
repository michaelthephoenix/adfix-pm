import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
export function ProjectsPage() {
    const { accessToken } = useAuth();
    const projectsQuery = useQuery({
        queryKey: ["projects"],
        queryFn: () => apiRequest("/projects?page=1&pageSize=25&sortBy=updatedAt&sortOrder=desc", {
            accessToken: accessToken ?? undefined
        }),
        enabled: Boolean(accessToken)
    });
    if (projectsQuery.isLoading) {
        return _jsx("div", { className: "state-card", children: "Loading projects..." });
    }
    if (projectsQuery.isError) {
        return _jsx("div", { className: "state-card", children: "Could not load projects." });
    }
    return (_jsxs("section", { children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "Projects" }), _jsxs("p", { className: "muted", children: [projectsQuery.data?.meta.total ?? 0, " visible projects"] })] }), _jsx("div", { className: "card table-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Name" }), _jsx("th", { children: "Client" }), _jsx("th", { children: "Phase" }), _jsx("th", { children: "Priority" }), _jsx("th", { children: "Deadline" }), _jsx("th", { children: "Role" })] }) }), _jsx("tbody", { children: projectsQuery.data?.data.map((project) => (_jsxs("tr", { children: [_jsx("td", { children: project.name }), _jsx("td", { children: project.client_name }), _jsx("td", { children: project.current_phase }), _jsx("td", { children: project.priority }), _jsx("td", { children: project.deadline }), _jsx("td", { children: project.current_user_role ?? "-" })] }, project.id))) })] }) })] }));
}

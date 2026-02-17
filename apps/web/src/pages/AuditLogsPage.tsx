import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type AuditLogsResponse = {
  data: Array<{
    id: string;
    action: string;
    project_id: string | null;
    details: Record<string, unknown>;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = Boolean(user?.isAdmin);

  const page = Number(searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? "20") || 20;
  const sortBy = searchParams.get("sortBy") ?? "createdAt";
  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const action = searchParams.get("action") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const search = searchParams.get("search") ?? "";

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortOrder
    });
    if (action) params.set("action", action);
    if (from) params.set("from", `${from}T00:00:00.000Z`);
    if (to) params.set("to", `${to}T23:59:59.999Z`);
    if (search) params.set("search", search);
    return params.toString();
  }, [action, from, page, pageSize, search, sortBy, sortOrder, to]);

  const setParam = (
    key: "page" | "pageSize" | "sortBy" | "sortOrder" | "action" | "from" | "to" | "search",
    value: string
  ) => {
    const next = new URLSearchParams(searchParams);
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    if (key !== "page") {
      next.set("page", "1");
    }
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    next.delete("from");
    next.delete("to");
    next.delete("search");
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  const formatAction = (value: string) =>
    value
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const auditLogsQuery = useQuery({
    queryKey: ["audit-logs-page", queryString],
    queryFn: () =>
      apiRequest<AuditLogsResponse>(`/users/audit-logs?${queryString}`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken && isAdmin)
  });

  if (!isAdmin) {
    return <ErrorState message="Audit logs are restricted to owner/high-clearance users." />;
  }

  return (
    <section>
      <div className="section-head">
        <h2>Audit Logs</h2>
        <p className="muted">{auditLogsQuery.data?.meta.total ?? 0} total entries</p>
      </div>
      <div className="card tasks-toolbar">
        <input
          placeholder="Search logs (action, user, project, details)"
          value={search}
          onChange={(event) => setParam("search", event.target.value)}
        />
        <input placeholder="Action filter (exact)" value={action} onChange={(event) => setParam("action", event.target.value)} />
        <input type="date" value={from} onChange={(event) => setParam("from", event.target.value)} />
        <input type="date" value={to} onChange={(event) => setParam("to", event.target.value)} />
        <select value={sortBy} onChange={(event) => setParam("sortBy", event.target.value)}>
          <option value="createdAt">Sort by createdAt</option>
          <option value="action">Sort by action</option>
        </select>
        <select value={sortOrder} onChange={(event) => setParam("sortOrder", event.target.value)}>
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
      </div>
      <div className="inline-actions" style={{ marginBottom: "10px" }}>
        <select value={String(pageSize)} onChange={(event) => setParam("pageSize", event.target.value)}>
          <option value="20">20 / page</option>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
        </select>
        <button type="button" className="ghost-button" onClick={clearFilters}>
          Clear filters
        </button>
      </div>
      <div className="card">
        {auditLogsQuery.isLoading ? (
          <LoadingState message="Loading audit logs..." />
        ) : auditLogsQuery.isError ? (
          <ErrorState message="Could not load audit logs." />
        ) : !auditLogsQuery.data?.data.length ? (
          <EmptyState message="No audit entries." />
        ) : (
          <div className="activity-list">
            {auditLogsQuery.data.data.map((entry) => (
              <article key={entry.id} className="activity-item">
                <p className="notice-title">{formatAction(entry.action)}</p>
                <p className="muted">
                  by {entry.user_name ?? entry.user_email ?? "system"} at{" "}
                  {new Date(entry.created_at).toLocaleString()}
                </p>
                {entry.project_id ? <p className="muted">Project: {entry.project_id}</p> : null}
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="inline-actions" style={{ marginTop: "10px" }}>
        <button
          type="button"
          className="ghost-button"
          disabled={page <= 1}
          onClick={() => setParam("page", String(Math.max(1, page - 1)))}
        >
          Previous
        </button>
        <p className="muted">Page {page}</p>
        <button
          type="button"
          className="ghost-button"
          disabled={(auditLogsQuery.data?.data.length ?? 0) < pageSize}
          onClick={() => setParam("page", String(page + 1))}
        >
          Next
        </button>
      </div>
    </section>
  );
}

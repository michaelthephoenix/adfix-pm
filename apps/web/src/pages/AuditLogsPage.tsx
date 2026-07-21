import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowUpDown, Search, SlidersHorizontal, X } from "lucide-react";
import { apiRequest } from "../lib/api";
import { formatLocalDateTime } from "../lib/format";
import { useAuth } from "../state/auth";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { PageHeader } from "../components/ui/PageHeader";

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
  meta: { total: number };
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftAction, setDraftAction] = useState(action);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy, sortOrder });
    if (action) params.set("action", action);
    if (from) params.set("from", `${from}T00:00:00.000Z`);
    if (to) params.set("to", `${to}T23:59:59.999Z`);
    if (search) params.set("search", search);
    return params.toString();
  }, [action, from, page, pageSize, search, sortBy, sortOrder, to]);

  const setParam = (key: "page" | "pageSize" | "sortBy" | "sortOrder" | "action" | "from" | "to" | "search", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    next.delete("from");
    next.delete("to");
    next.set("page", "1");
    setSearchParams(next, { replace: true });
    setDraftAction("");
    setDraftFrom("");
    setDraftTo("");
  };

  const openFilters = () => {
    setDraftAction(action);
    setDraftFrom(from);
    setDraftTo(to);
    setFilterOpen(true);
  };

  const applyFilters = () => {
    const next = new URLSearchParams(searchParams);
    [["action", draftAction], ["from", draftFrom], ["to", draftTo]].forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    next.set("page", "1");
    setSearchParams(next, { replace: true });
    setFilterOpen(false);
  };

  const setSort = (value: string) => {
    const [field, order] = value.split(":");
    const next = new URLSearchParams(searchParams);
    next.set("sortBy", field);
    next.set("sortOrder", order);
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  const activeFilterCount = [action, from, to].filter(Boolean).length;
  const formatAction = (value: string) => value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

  const auditLogsQuery = useQuery({
    queryKey: ["audit-logs-page", queryString],
    queryFn: () => apiRequest<AuditLogsResponse>(`/users/audit-logs?${queryString}`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken && isAdmin)
  });

  if (!isAdmin) return <ErrorState message="Audit logs are restricted to owner/high-clearance users." />;

  return (
    <section className="audit-page">
      <PageHeader title="Audit log" description="Administrative changes and security-relevant workspace activity." meta={<span>{auditLogsQuery.data?.meta.total ?? 0}</span>} />

      <div className="audit-toolbar">
        <label className="audit-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search audit log</span>
          <input placeholder="Search activity" value={search} onChange={(event) => setParam("search", event.target.value)} />
          {search ? <button type="button" aria-label="Clear search" onClick={() => setParam("search", "")}><X size={14} /></button> : null}
        </label>
        <Button variant="secondary" icon={<SlidersHorizontal size={16} />} onClick={openFilters}>Filters {activeFilterCount ? <span className="filter-count">{activeFilterCount}</span> : null}</Button>
        <label className="audit-sort-control">
          <ArrowUpDown size={15} aria-hidden="true" />
          <span className="sr-only">Sort audit log</span>
          <select value={`${sortBy}:${sortOrder}`} onChange={(event) => setSort(event.target.value)}>
            <option value="createdAt:desc">Newest first</option>
            <option value="createdAt:asc">Oldest first</option>
            <option value="action:asc">Action A–Z</option>
          </select>
        </label>
      </div>

      {activeFilterCount ? <div className="active-filter-summary"><span>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied</span><Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button></div> : null}

      <Dialog
        open={filterOpen}
        onOpenChange={setFilterOpen}
        title="Filter audit activity"
        description="Narrow the log by action or a specific date range."
        footer={<div className="dialog-footer-split"><Button variant="ghost" onClick={() => { setDraftAction(""); setDraftFrom(""); setDraftTo(""); }}>Reset</Button><div className="inline-actions"><Button variant="ghost" onClick={() => setFilterOpen(false)}>Cancel</Button><Button variant="primary" onClick={applyFilters}>Apply filters</Button></div></div>}
      >
        <div className="modal-form">
          <label className="field"><span>Action contains <small>Optional</small></span><input autoFocus placeholder="e.g. file uploaded" value={draftAction} onChange={(event) => setDraftAction(event.target.value)} /></label>
          <div className="modal-form-row">
            <label className="field"><span>From date</span><input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></label>
            <label className="field"><span>To date</span><input type="date" min={draftFrom || undefined} value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></label>
          </div>
        </div>
      </Dialog>

      <div className="card">
        {auditLogsQuery.isLoading ? <LoadingState message="Loading audit logs..." /> : auditLogsQuery.isError ? <ErrorState message="Could not load audit logs." /> : !auditLogsQuery.data?.data.length ? <EmptyState message="No audit entries." /> : (
          <div className="activity-list">
            {auditLogsQuery.data.data.map((entry) => <article key={entry.id} className="activity-item"><p className="notice-title">{formatAction(entry.action)}</p><p className="muted">by {entry.user_name ?? entry.user_email ?? "system"} at <time dateTime={entry.created_at}>{formatLocalDateTime(entry.created_at)}</time></p></article>)}
          </div>
        )}
      </div>

      <div className="pagination">
        <Button size="sm" disabled={page <= 1} onClick={() => setParam("page", String(Math.max(1, page - 1)))}>Previous</Button>
        <span>Page {page}</span>
        <Button size="sm" disabled={(auditLogsQuery.data?.data.length ?? 0) < pageSize} onClick={() => setParam("page", String(page + 1))}>Next</Button>
      </div>
    </section>
  );
}

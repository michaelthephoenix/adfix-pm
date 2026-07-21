import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FilterX } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type TaskRow = {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  phase: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: string;
  due_date: string | null;
  updated_at: string;
};

type TasksResponse = {
  data: TaskRow[];
  meta: { page: number; pageSize: number; sortBy: string; sortOrder: string; total: number };
};

const humanize = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function TasksPage() {
  const { accessToken } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const phase = searchParams.get("phase") ?? "";
  const overdue = searchParams.get("overdue") ?? "";
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const sortBy = searchParams.get("sortBy") ?? "updatedAt";
  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const pageSize = 25;
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<"" | "start" | "complete" | "delete">("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy, sortOrder });
    if (status) params.set("status", status);
    if (phase) params.set("phase", phase);
    if (overdue) params.set("overdue", overdue);
    return params.toString();
  }, [overdue, page, phase, sortBy, sortOrder, status]);

  const tasksQuery = useQuery({
    queryKey: ["tasks-global", queryString],
    queryFn: () => apiRequest<TasksResponse>(`/tasks?${queryString}`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken)
  });

  const refreshTasks = async () => {
    setSelectedTaskIds([]);
    setBulkAction("");
    await queryClient.invalidateQueries({ queryKey: ["tasks-global"] });
  };

  const bulkStatusMutation = useMutation({
    mutationFn: (nextStatus: TaskRow["status"]) => apiRequest("/tasks/bulk/status", { method: "POST", accessToken: accessToken ?? undefined, body: { taskIds: selectedTaskIds, status: nextStatus } }),
    onSuccess: async (_, nextStatus) => { await refreshTasks(); ui.success(`Tasks updated to ${humanize(nextStatus).toLowerCase()}.`); },
    onError: () => ui.error("Could not update selected tasks.")
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => apiRequest("/tasks/bulk/delete", { method: "POST", accessToken: accessToken ?? undefined, body: { taskIds: selectedTaskIds } }),
    onSuccess: async () => { await refreshTasks(); ui.success("Selected tasks deleted."); },
    onError: () => ui.error("Could not delete selected tasks.")
  });

  const applyBulkAction = async () => {
    if (!bulkAction || selectedTaskIds.length === 0) return;
    if (bulkAction === "start") return bulkStatusMutation.mutate("in_progress");
    if (bulkAction === "complete") return bulkStatusMutation.mutate("completed");
    const confirmed = await ui.confirm({ title: "Delete selected tasks", message: `Delete ${selectedTaskIds.length} selected tasks? This cannot be undone.`, confirmLabel: "Delete" });
    if (confirmed) bulkDeleteMutation.mutate();
  };

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((current) => current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]);
  };

  const setFilterParam = (key: "status" | "phase" | "overdue" | "page", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  const setSort = (value: string) => {
    const [nextSortBy, nextSortOrder] = value.split(":");
    const next = new URLSearchParams(searchParams);
    next.set("sortBy", nextSortBy);
    next.set("sortOrder", nextSortOrder);
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    setSearchParams(next, { replace: true });
  };

  const allVisibleSelected = Boolean(tasksQuery.data?.data.length) && tasksQuery.data?.data.every((task) => selectedTaskIds.includes(task.id));
  const hasFilters = Boolean(status || phase || overdue);
  const isApplying = bulkDeleteMutation.isPending || bulkStatusMutation.isPending;

  return (
    <section>
      <PageHeader title="Tasks" description="Work across all projects, ordered by what needs attention." meta={<span>{tasksQuery.data?.meta.total ?? 0}</span>} />

      <div className="list-toolbar task-filters">
        <select aria-label="Filter by status" value={status} onChange={(event) => setFilterParam("status", event.target.value)}>
          <option value="">All statuses</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option>
        </select>
        <select aria-label="Filter by phase" value={phase} onChange={(event) => setFilterParam("phase", event.target.value)}>
          <option value="">All phases</option><option value="client_acquisition">Acquisition</option><option value="strategy_planning">Strategy</option><option value="production">Production</option><option value="post_production">Post-production</option><option value="delivery">Delivery</option>
        </select>
        <select aria-label="Filter by due date" value={overdue} onChange={(event) => setFilterParam("overdue", event.target.value)}>
          <option value="">Any due date</option><option value="true">Overdue</option><option value="false">Not overdue</option>
        </select>
        <span className="toolbar-spacer" />
        {hasFilters ? <Button variant="ghost" size="sm" icon={<FilterX size={14} />} onClick={clearFilters}>Clear</Button> : null}
        <select aria-label="Sort tasks" value={`${sortBy}:${sortOrder}`} onChange={(event) => setSort(event.target.value)}>
          <option value="updatedAt:desc">Recently updated</option><option value="dueDate:asc">Due date</option><option value="priority:desc">Priority</option><option value="title:asc">Title A–Z</option>
        </select>
      </div>

      {selectedTaskIds.length > 0 ? (
        <div className="selection-toolbar" role="region" aria-label="Selected task actions">
          <strong>{selectedTaskIds.length} selected</strong>
          <select aria-label="Bulk action" value={bulkAction} onChange={(event) => setBulkAction(event.target.value as typeof bulkAction)}>
            <option value="">Choose action</option><option value="start">Start</option><option value="complete">Complete</option><option value="delete">Delete</option>
          </select>
          <Button variant={bulkAction === "delete" ? "danger" : "primary"} size="sm" disabled={!bulkAction || isApplying} onClick={() => void applyBulkAction()}>{isApplying ? "Applying…" : "Apply"}</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedTaskIds([])}>Cancel</Button>
        </div>
      ) : null}

      <div className="data-view mobile-card-table tasks-data-view">
        {tasksQuery.isLoading ? <LoadingState message="Loading tasks…" />
          : tasksQuery.isError ? <ErrorState message="Could not load tasks." onRetry={() => void tasksQuery.refetch()} />
          : (tasksQuery.data?.data.length ?? 0) === 0 ? <EmptyState message={hasFilters ? "No tasks match these filters." : "No tasks have been created yet."} />
          : (
            <table>
              <thead><tr><th className="checkbox-cell"><input aria-label="Select all visible tasks" type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedTaskIds(allVisibleSelected ? [] : tasksQuery.data?.data.map((task) => task.id) ?? [])} /></th><th>Task</th><th>Status</th><th>Phase</th><th>Priority</th><th>Due</th></tr></thead>
              <tbody>
                {tasksQuery.data?.data.map((task) => (
                  <tr key={task.id}>
                    <td className="checkbox-cell"><input aria-label={`Select ${task.title}`} type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTaskSelection(task.id)} /></td>
                    <td><Link className="row-title task-deep-link" to={`/projects/${task.project_id}?tab=tasks&task=${task.id}`}>{task.title}</Link><Link className="row-subtitle" to={`/projects/${task.project_id}?tab=tasks`}>{task.project_name}</Link></td>
                    <td><span className={`status-chip status-${task.status}`}>{humanize(task.status)}</span></td>
                    <td>{humanize(task.phase)}</td>
                    <td><span className={`priority-dot priority-${task.priority}`} />{humanize(task.priority)}</td>
                    <td className={task.due_date && new Date(task.due_date) < new Date() && task.status !== "completed" ? "deadline-overdue" : ""}>{task.due_date ? new Date(task.due_date).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {(tasksQuery.data?.meta.total ?? 0) > pageSize ? (
        <div className="pagination"><Button size="sm" disabled={page <= 1} onClick={() => setFilterParam("page", String(Math.max(1, page - 1)))}>Previous</Button><span>Page {page}</span><Button size="sm" disabled={(tasksQuery.data?.data.length ?? 0) < pageSize} onClick={() => setFilterParam("page", String(page + 1))}>Next</Button></div>
      ) : null}
    </section>
  );
}

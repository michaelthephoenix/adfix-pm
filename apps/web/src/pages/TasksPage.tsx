import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  phase: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: string;
  due_date: string | null;
  updated_at: string;
};

type TasksResponse = {
  data: TaskRow[];
  meta: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: string;
    total: number;
  };
};

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
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortOrder
    });
    if (status) params.set("status", status);
    if (phase) params.set("phase", phase);
    if (overdue) params.set("overdue", overdue);
    return params.toString();
  }, [overdue, page, pageSize, phase, sortBy, sortOrder, status]);

  const tasksQuery = useQuery({
    queryKey: ["tasks-global", queryString],
    queryFn: () =>
      apiRequest<TasksResponse>(`/tasks?${queryString}`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const refreshTasks = async () => {
    setSelectedTaskIds([]);
    await queryClient.invalidateQueries({ queryKey: ["tasks-global"] });
  };

  const bulkStatusMutation = useMutation({
    mutationFn: (nextStatus: TaskRow["status"]) =>
      apiRequest("/tasks/bulk/status", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          taskIds: selectedTaskIds,
          status: nextStatus
        }
      }),
    onSuccess: async (_, nextStatus) => {
      await refreshTasks();
      ui.success(`Tasks updated to ${nextStatus}.`);
    },
    onError: () => {
      ui.error("Could not update selected tasks.");
    }
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () =>
      apiRequest("/tasks/bulk/delete", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          taskIds: selectedTaskIds
        }
      }),
    onSuccess: async () => {
      await refreshTasks();
      ui.success("Selected tasks deleted.");
    },
    onError: () => {
      ui.error("Could not delete selected tasks.");
    }
  });

  const applyBulkAction = async () => {
    if (!bulkAction || selectedTaskIds.length === 0) return;

    if (bulkAction === "start") {
      bulkStatusMutation.mutate("in_progress");
      return;
    }

    if (bulkAction === "complete") {
      bulkStatusMutation.mutate("completed");
      return;
    }

    const shouldDelete = await ui.confirm({
      title: "Delete selected tasks",
      message: `Delete ${selectedTaskIds.length} selected tasks? This cannot be undone.`,
      confirmLabel: "Delete"
    });
    if (!shouldDelete) return;
    bulkDeleteMutation.mutate();
  };

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((previous) =>
      previous.includes(taskId) ? previous.filter((id) => id !== taskId) : [...previous, taskId]
    );
  };

  const setFilterParam = (
    key: "status" | "phase" | "overdue" | "page" | "sortBy" | "sortOrder",
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
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const allVisibleSelected =
    Boolean(tasksQuery.data?.data.length) &&
    tasksQuery.data?.data.every((task) => selectedTaskIds.includes(task.id));

  return (
    <section>
      <div className="section-head">
        <h2>Tasks</h2>
        <p className="muted">{tasksQuery.data?.meta.total ?? 0} tasks</p>
      </div>

      <div className="card tasks-toolbar">
        <select value={status} onChange={(event) => setFilterParam("status", event.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
          <option value="blocked">blocked</option>
        </select>
        <select value={phase} onChange={(event) => setFilterParam("phase", event.target.value)}>
          <option value="">All phases</option>
          <option value="client_acquisition">client_acquisition</option>
          <option value="strategy_planning">strategy_planning</option>
          <option value="production">production</option>
          <option value="post_production">post_production</option>
          <option value="delivery">delivery</option>
        </select>
        <select value={overdue} onChange={(event) => setFilterParam("overdue", event.target.value)}>
          <option value="">Any due state</option>
          <option value="true">overdue only</option>
          <option value="false">not overdue</option>
        </select>
        <select value={sortBy} onChange={(event) => setFilterParam("sortBy", event.target.value)}>
          <option value="updatedAt">Sort: updatedAt</option>
          <option value="createdAt">Sort: createdAt</option>
          <option value="dueDate">Sort: dueDate</option>
          <option value="priority">Sort: priority</option>
          <option value="status">Sort: status</option>
          <option value="title">Sort: title</option>
        </select>
        <select value={sortOrder} onChange={(event) => setFilterParam("sortOrder", event.target.value)}>
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
        <select value={bulkAction} onChange={(event) => setBulkAction(event.target.value as "" | "start" | "complete" | "delete")}>
          <option value="">Select action</option>
          <option value="start">Start selected</option>
          <option value="complete">Complete selected</option>
          <option value="delete">Delete selected</option>
        </select>
        <button
          className="ghost-button"
          disabled={
            selectedTaskIds.length === 0 ||
            !bulkAction ||
            bulkDeleteMutation.isPending ||
            bulkStatusMutation.isPending
          }
          onClick={applyBulkAction}
        >
          {bulkDeleteMutation.isPending || bulkStatusMutation.isPending ? "Applying..." : "Apply"}
        </button>
        <button type="button" className="ghost-button" onClick={clearFilters}>
          Clear filters
        </button>
        <p className="muted">{selectedTaskIds.length} selected</p>
      </div>

      <div className="card table-wrap">
        {tasksQuery.isLoading ? (
          <LoadingState message="Loading tasks..." />
        ) : tasksQuery.isError ? (
          <ErrorState message="Could not load tasks." onRetry={() => void tasksQuery.refetch()} />
        ) : (tasksQuery.data?.data.length ?? 0) === 0 ? (
          <EmptyState message="No tasks found for current filters." />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={Boolean(allVisibleSelected)}
                      onChange={() =>
                        setSelectedTaskIds(
                          allVisibleSelected ? [] : (tasksQuery.data?.data.map((task) => task.id) ?? [])
                        )
                      }
                    />
                  </th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Phase</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th>Project</th>
                </tr>
              </thead>
              <tbody>
                {tasksQuery.data?.data.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedTaskIds.includes(task.id)}
                        onChange={() => toggleTaskSelection(task.id)}
                      />
                    </td>
                    <td>{task.title}</td>
                    <td>{task.status}</td>
                    <td>{task.phase}</td>
                    <td>{task.priority}</td>
                    <td>{task.due_date ?? "-"}</td>
                    <td className="mono-cell">{task.project_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="inline-actions" style={{ marginTop: "10px" }}>
              <button
                type="button"
                className="ghost-button"
                disabled={page <= 1}
                onClick={() => setFilterParam("page", String(Math.max(1, page - 1)))}
              >
                Previous
              </button>
              <p className="muted">Page {page}</p>
              <button
                type="button"
                className="ghost-button"
                disabled={(tasksQuery.data?.data.length ?? 0) < pageSize}
                onClick={() => setFilterParam("page", String(page + 1))}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

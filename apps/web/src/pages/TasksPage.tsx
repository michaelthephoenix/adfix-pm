import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";

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
    total: number;
  };
};

export function TasksPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [phase, setPhase] = useState<string>("");
  const [overdue, setOverdue] = useState<string>("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<"" | "start" | "complete" | "delete">("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: "1",
      pageSize: "100",
      sortBy: "updatedAt",
      sortOrder: "desc"
    });
    if (status) params.set("status", status);
    if (phase) params.set("phase", phase);
    if (overdue) params.set("overdue", overdue);
    return params.toString();
  }, [overdue, phase, status]);

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
    onSuccess: refreshTasks
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
    onSuccess: refreshTasks
  });

  const applyBulkAction = () => {
    if (!bulkAction || selectedTaskIds.length === 0) return;

    if (bulkAction === "start") {
      bulkStatusMutation.mutate("in_progress");
      return;
    }

    if (bulkAction === "complete") {
      bulkStatusMutation.mutate("completed");
      return;
    }

    bulkDeleteMutation.mutate();
  };

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((previous) =>
      previous.includes(taskId) ? previous.filter((id) => id !== taskId) : [...previous, taskId]
    );
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
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
          <option value="blocked">blocked</option>
        </select>
        <select value={phase} onChange={(event) => setPhase(event.target.value)}>
          <option value="">All phases</option>
          <option value="client_acquisition">client_acquisition</option>
          <option value="strategy_planning">strategy_planning</option>
          <option value="production">production</option>
          <option value="post_production">post_production</option>
          <option value="delivery">delivery</option>
        </select>
        <select value={overdue} onChange={(event) => setOverdue(event.target.value)}>
          <option value="">Any due state</option>
          <option value="true">overdue only</option>
          <option value="false">not overdue</option>
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
          Apply
        </button>
      </div>

      <div className="card table-wrap">
        {tasksQuery.isLoading ? (
          <p>Loading tasks...</p>
        ) : tasksQuery.isError ? (
          <p>Could not load tasks.</p>
        ) : (
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
        )}
      </div>
    </section>
  );
}

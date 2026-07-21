export type TaskLabelColor = "violet" | "blue" | "green" | "amber" | "rose" | "slate";

export type TaskLabel = { id?: string; name: string; color: TaskLabelColor };

export const taskPhases = [
  { id: "client_acquisition", label: "Client acquisition" },
  { id: "strategy_planning", label: "Strategic planning" },
  { id: "production", label: "Production" },
  { id: "post_production", label: "Post-production" },
  { id: "delivery", label: "Delivery" }
] as const;

export type TaskPhase = (typeof taskPhases)[number]["id"];

type TaskDeliverableRef = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
};

export type Task = {
  id: string;
  title: string;
  phase: TaskPhase;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  assignees: Array<{ id: string; name: string; avatar_url: string | null }>;
  labels: TaskLabel[];
  deliverables: TaskDeliverableRef[];
  deliverable_required: boolean;
};

export type TaskDraft = {
  assigneeIds: string[];
  dueDate: string;
  priority: string;
  labels: TaskLabel[];
  deliverableRequired: boolean;
};

export type DeliverableSelection =
  | { mode: "existing"; deliverableId: string }
  | { mode: "new"; title: string; description?: string | null };

export const taskLabelColors: Array<{ id: TaskLabelColor; label: string }> = [
  { id: "violet", label: "Violet" },
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "amber", label: "Amber" },
  { id: "rose", label: "Rose" },
  { id: "slate", label: "Slate" }
];

export function createTaskDraft(task: Task): TaskDraft {
  return {
    assigneeIds: (task.assignees ?? []).map((assignee) => assignee.id),
    dueDate: task.due_date?.slice(0, 10) ?? "",
    priority: task.priority,
    labels: task.labels ?? [],
    deliverableRequired: task.deliverable_required
  };
}

export function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

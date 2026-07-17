import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DndContext, DragOverlay, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { CalendarDays, GripVertical, Link2, MessageSquare, Plus, UploadCloud, UserPlus, UserRound } from "lucide-react";
import { apiDownload, apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { ProjectFileUpload } from "../components/ProjectFileUpload";
import { ProjectDeliverablesPanel } from "../components/ProjectDeliverablesPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";

type ProjectDetailResponse = {
  data: {
    id: string;
    name: string;
    description: string | null;
    client_name: string;
    current_phase: string;
    priority: string;
    deadline: string;
    current_user_role: "owner" | "manager" | "member" | "viewer" | null;
    task_summary: {
      total: number;
      pending: number;
      in_progress: number;
      completed: number;
      blocked: number;
      overdue: number;
    };
  };
};

type TasksListResponse = {
  data: Task[];
  meta: {
    total: number;
  };
};

type Task = {
  id: string;
  title: string;
  phase: TaskPhase;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  assignees: Array<{ id: string; name: string; avatar_url: string | null }>;
  labels: TaskLabel[];
};

type TaskLabelColor = "violet" | "blue" | "green" | "amber" | "rose" | "slate";
type TaskLabel = { id?: string; name: string; color: TaskLabelColor };
type TaskDraft = { assigneeIds: string[]; dueDate: string; priority: string; labels: TaskLabel[] };

const taskLabelColors: Array<{ id: TaskLabelColor; label: string }> = [
  { id: "violet", label: "Violet" },
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "amber", label: "Amber" },
  { id: "rose", label: "Rose" },
  { id: "slate", label: "Slate" }
];

const taskPhases = [
  { id: "client_acquisition", label: "Client acquisition" },
  { id: "strategy_planning", label: "Strategic planning" },
  { id: "production", label: "Production" },
  { id: "post_production", label: "Post-production" },
  { id: "delivery", label: "Delivery" }
] as const;

type TaskPhase = (typeof taskPhases)[number]["id"];

type TaskCommentsResponse = {
  data: Array<{
    id: string;
    user_id: string;
    body: string;
    created_at: string;
  }>;
  meta: {
    total: number;
  };
};

type FilesListResponse = {
  data: ProjectFile[];
  meta: {
    total: number;
  };
};

type ProjectFile = {
  id: string;
  file_name: string;
  file_type: string;
  storage_type: string;
  external_url: string | null;
  file_size: string;
  created_at: string;
};

type ActivityListResponse = {
  data: Array<{
    id: string;
    action: string;
    details: Record<string, unknown>;
    created_at: string;
    user_name: string | null;
  }>;
};

type ProjectTeamResponse = {
  data: Array<{
    user_id: string;
    role: "manager" | "member" | "viewer";
    user_name: string;
    user_email: string;
    created_at: string;
  }>;
};

type UsersResponse = {
  data: Array<{
    id: string;
    name: string;
    email: string;
  }>;
  meta: {
    total: number;
  };
};

function getStatusActions(status: Task["status"]) {
  if (status === "pending") return [{ status: "in_progress" as const, label: "Start" }];
  if (status === "in_progress") {
    return [
      { status: "completed" as const, label: "Complete" },
      { status: "blocked" as const, label: "Block" }
    ];
  }
  if (status === "blocked") return [{ status: "in_progress" as const, label: "Resume" }];
  return [];
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getTaskBadgeClass(kind: "status" | "priority", value: string) {
  const normalized = value.replaceAll("_", "-");
  return `badge badge-${kind} badge-${kind}-${normalized}`;
}

type TaskAssignee = Task["assignees"][number];

function getAssigneeInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";
}

function getAssigneeTone(name: string) {
  const checksum = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
  return checksum % 5;
}

function AssigneeAvatar({ assignee, stackOrder }: { assignee: TaskAssignee; stackOrder: number }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [assignee.avatar_url]);

  if (assignee.avatar_url && !imageFailed) {
    return (
      <img
        className="task-assignee-avatar"
        src={assignee.avatar_url}
        alt=""
        title={assignee.name}
        style={{ zIndex: stackOrder }}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={`task-assignee-avatar task-assignee-avatar-fallback task-assignee-avatar-tone-${getAssigneeTone(assignee.name)}`}
      title={assignee.name}
      style={{ zIndex: stackOrder }}
    >
      {getAssigneeInitials(assignee.name)}
    </span>
  );
}

function TaskAssigneeGroup({ task }: { task: Task }) {
  const assignees = task.assignees ?? [];
  if (assignees.length === 0) {
    return <span className="task-assignee-empty"><UserRound size={13} /> Unassigned</span>;
  }

  const visibleAssignees = assignees.slice(0, 3);
  const surplus = assignees.length - visibleAssignees.length;
  const assigneeNames = assignees.map((assignee) => assignee.name).join(", ");
  const surplusNames = assignees.slice(3).map((assignee) => assignee.name).join(", ");

  return (
    <span className="task-assignee-group" role="img" aria-label={`Assigned to ${assigneeNames}`}>
      <span className="task-assignee-stack" aria-hidden="true">
        {visibleAssignees.map((assignee, index) => (
          <AssigneeAvatar key={assignee.id} assignee={assignee} stackOrder={visibleAssignees.length - index + 1} />
        ))}
        {surplus > 0 ? (
          <span className="task-assignee-avatar task-assignee-surplus" title={surplusNames} style={{ zIndex: 1 }}>
            +{surplus}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function createTaskDraft(task: Task): TaskDraft {
  return {
    assigneeIds: (task.assignees ?? []).map((assignee) => assignee.id),
    dueDate: task.due_date?.slice(0, 10) ?? "",
    priority: task.priority,
    labels: task.labels ?? []
  };
}

type TaskCardProps = {
  task: Task;
  canWrite: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
  onStatusChange: (status: Task["status"]) => void;
};

function TaskKanbanCard({ task, canWrite, selected, onToggleSelected, onOpen, onStatusChange }: TaskCardProps) {
  const draggable = useDraggable({ id: `task:${task.id}`, data: { task }, disabled: !canWrite });
  const overdue = Boolean(task.due_date && new Date(task.due_date).getTime() < Date.now() && task.status !== "completed");

  return (
    <article ref={draggable.setNodeRef} className={`task-kanban-card ${draggable.isDragging ? "dragging" : ""}`}>
      <div className="task-kanban-card-topline">
        <label className="task-select-control">
          <input type="checkbox" checked={selected} disabled={!canWrite} onChange={onToggleSelected} />
          <span className={`badge badge-priority badge-priority-${task.priority}`}>{task.priority}</span>
        </label>
        <button className="drag-handle" type="button" aria-label={`Move ${task.title}`} disabled={!canWrite} {...draggable.listeners} {...draggable.attributes}>
          <GripVertical size={16} />
        </button>
      </div>
      <button type="button" className="task-kanban-title" onClick={onOpen}>{task.title}</button>
      {(task.labels?.length ?? 0) > 0 ? (
        <div className="task-card-labels" aria-label="Task labels">
          {task.labels.slice(0, 3).map((label) => <span key={label.id ?? label.name} className={`task-label task-label-${label.color}`}>{label.name}</span>)}
          {task.labels.length > 3 ? <span className="task-label task-label-more">+{task.labels.length - 3}</span> : null}
        </div>
      ) : null}
      <span className={getTaskBadgeClass("status", task.status)}>{formatLabel(task.status)}</span>
      <div className="task-kanban-meta">
        <span className={overdue ? "deadline-overdue" : ""}><CalendarDays size={13} /> {task.due_date ? new Date(task.due_date).toLocaleDateString() : "No due date"}</span>
        <TaskAssigneeGroup task={task} />
      </div>
      <div className="task-kanban-actions">
        {getStatusActions(task.status).map((action) => (
          <Button key={action.status} variant="ghost" size="sm" disabled={!canWrite} onClick={() => onStatusChange(action.status)}>{action.label}</Button>
        ))}
        <Button variant="ghost" size="sm" icon={<MessageSquare size={13} />} onClick={onOpen}>Details</Button>
      </div>
    </article>
  );
}

function TaskDragPreview({ task }: { task: Task }) {
  return (
    <article className="task-kanban-card task-drag-overlay" aria-hidden="true">
      <div className="task-kanban-card-topline"><span className={`badge badge-priority badge-priority-${task.priority}`}>{task.priority}</span><GripVertical size={16} /></div>
      <div className="task-kanban-title">{task.title}</div>
      <span className={getTaskBadgeClass("status", task.status)}>{formatLabel(task.status)}</span>
      {(task.labels?.length ?? 0) > 0 ? <div className="task-card-labels">{task.labels.slice(0, 2).map((label) => <span key={label.id ?? label.name} className={`task-label task-label-${label.color}`}>{label.name}</span>)}</div> : null}
      <div className="task-kanban-meta"><TaskAssigneeGroup task={task} /></div>
    </article>
  );
}

type TaskPhaseColumnProps = {
  phase: (typeof taskPhases)[number];
  tasks: Task[];
  canWrite: boolean;
  selectedTaskIds: string[];
  onToggleSelected: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onStatusChange: (taskId: string, status: Task["status"]) => void;
};

function TaskPhaseColumn({ phase, tasks, canWrite, selectedTaskIds, onToggleSelected, onOpenTask, onStatusChange }: TaskPhaseColumnProps) {
  const droppable = useDroppable({ id: phase.id });
  return (
    <section ref={droppable.setNodeRef} className={`task-phase-column phase-${phase.id} ${droppable.isOver ? "drop-target" : ""}`}>
      <header className="task-phase-column-header"><span className="phase-dot" /><h3>{phase.label}</h3><span className="phase-count">{tasks.length}</span></header>
      <div className="task-phase-column-body">
        {tasks.map((task) => (
          <TaskKanbanCard
            key={task.id}
            task={task}
            canWrite={canWrite}
            selected={selectedTaskIds.includes(task.id)}
            onToggleSelected={() => onToggleSelected(task.id)}
            onOpen={() => onOpenTask(task.id)}
            onStatusChange={(status) => onStatusChange(task.id, status)}
          />
        ))}
        {tasks.length === 0 ? <p className="phase-empty">Drop a task here</p> : null}
      </div>
    </section>
  );
}

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "tasks" | "files" | "deliverables" | "activity" | "team">("tasks");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<TaskPhase>("production");
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({});
  const [taskActionState, setTaskActionState] = useState<Record<string, "idle" | "saving" | "saved" | "error">>(
    {}
  );
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [optimisticTaskPhases, setOptimisticTaskPhases] = useState<Record<string, TaskPhase>>({});
  const [bulkTaskAction, setBulkTaskAction] = useState<"" | "start" | "complete" | "delete">("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [newTaskLabelName, setNewTaskLabelName] = useState("");
  const [newTaskLabelColor, setNewTaskLabelColor] = useState<TaskLabelColor>("violet");
  const [fileLinkName, setFileLinkName] = useState("");
  const [fileLinkUrl, setFileLinkUrl] = useState("");
  const [fileLinkType, setFileLinkType] = useState("asset");
  const [fileLinkStorage, setFileLinkStorage] = useState("google_drive");
  const [fileFormError, setFileFormError] = useState<string | null>(null);
  const [fileUploadOpen, setFileUploadOpen] = useState(false);
  const [fileLinkDialogOpen, setFileLinkDialogOpen] = useState(false);
  const [teamUserId, setTeamUserId] = useState("");
  const [teamRole, setTeamRole] = useState<"manager" | "member" | "viewer">("member");
  const [teamFormError, setTeamFormError] = useState<string | null>(null);
  const [teamMemberDialogOpen, setTeamMemberDialogOpen] = useState(false);

  const projectQuery = useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: () =>
      apiRequest<ProjectDetailResponse>(`/projects/${projectId}`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(projectId && accessToken)
  });

  const tasksQuery = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: () =>
      apiRequest<TasksListResponse>(`/tasks?projectId=${projectId}&page=1&pageSize=100&sortBy=updatedAt&sortOrder=desc`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(projectId && accessToken)
  });

  const filesQuery = useQuery({
    queryKey: ["project-files", projectId],
    queryFn: () =>
      apiRequest<FilesListResponse>(`/files/project/${projectId}?page=1&pageSize=100&sortBy=createdAt&sortOrder=desc`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(projectId && accessToken)
  });

  const activityQuery = useQuery({
    queryKey: ["project-activity", projectId],
    queryFn: () =>
      apiRequest<ActivityListResponse>(`/projects/${projectId}/activity`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(projectId && accessToken)
  });

  const teamQuery = useQuery({
    queryKey: ["project-team", projectId],
    queryFn: () =>
      apiRequest<ProjectTeamResponse>(`/projects/${projectId}/team`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(projectId && accessToken)
  });

  const usersQuery = useQuery({
    queryKey: ["users-for-team-picker"],
    queryFn: () =>
      apiRequest<UsersResponse>("/users?page=1&pageSize=100&sortBy=name&sortOrder=asc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(projectId && accessToken)
  });

  const commentsQuery = useQuery({
    queryKey: ["task-comments", selectedTaskId],
    queryFn: () =>
      apiRequest<TaskCommentsResponse>(`/tasks/${selectedTaskId}/comments?page=1&pageSize=100&sortOrder=desc`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(selectedTaskId && accessToken)
  });

  const canWriteTask = useMemo(() => {
    const role = projectQuery.data?.data.current_user_role;
    return role === "owner" || role === "manager" || role === "member";
  }, [projectQuery.data?.data.current_user_role]);
  const canWriteFile = canWriteTask;
  const canUpdateProject = useMemo(() => {
    const role = projectQuery.data?.data.current_user_role;
    return role === "owner" || role === "manager";
  }, [projectQuery.data?.data.current_user_role]);
  const canManageTeam = useMemo(() => {
    const role = projectQuery.data?.data.current_user_role;
    return role === "owner" || role === "manager";
  }, [projectQuery.data?.data.current_user_role]);

  const refreshData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-files", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-team", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] })
    ]);
  };

  const refreshComments = async () => {
    if (!selectedTaskId) return;
    await queryClient.invalidateQueries({ queryKey: ["task-comments", selectedTaskId] });
  };

  const createTaskMutation = useMutation({
    mutationFn: (payload: { title: string; phase: TaskPhase }) =>
      apiRequest(`/tasks`, {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          projectId,
          title: payload.title,
          phase: payload.phase
        }
      }),
    onSuccess: async () => {
      setTitle("");
      setFormError(null);
      setTaskCreateOpen(false);
      await refreshData();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.message);
        return;
      }
      setFormError("Task creation failed");
    }
  });

  const statusMutation = useMutation({
    mutationFn: (input: { taskId: string; status: Task["status"] }) =>
      apiRequest(`/tasks/${input.taskId}/status`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined,
        body: { status: input.status }
      }),
    onSuccess: async (_, variables) => {
      setTaskActionState((previous) => ({ ...previous, [variables.taskId]: "saved" }));
      await refreshData();
    },
    onError: (_error, variables) => {
      setTaskActionState((previous) => ({ ...previous, [variables.taskId]: "error" }));
    }
  });

  const updateTaskMutation = useMutation({
    mutationFn: (input: { taskId: string; assigneeIds: string[]; dueDate: string; priority: string; labels: TaskLabel[] }) =>
      apiRequest(`/tasks/${input.taskId}`, {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: {
          assigneeIds: input.assigneeIds,
          dueDate: input.dueDate ? input.dueDate : null,
          priority: input.priority,
          labels: input.labels.map(({ name, color }) => ({ name, color }))
        }
      }),
    onSuccess: async (_, variables) => {
      setTaskActionState((previous) => ({ ...previous, [variables.taskId]: "saved" }));
      await refreshData();
    },
    onError: (_error, variables) => {
      setTaskActionState((previous) => ({ ...previous, [variables.taskId]: "error" }));
    }
  });

  const moveTaskPhaseMutation = useMutation({
    mutationFn: (input: { taskId: string; phase: TaskPhase }) =>
      apiRequest(`/tasks/${input.taskId}`, {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: { phase: input.phase }
      }),
    onSuccess: async (_result, variables) => {
      setOptimisticTaskPhases((previous) => {
        const next = { ...previous };
        delete next[variables.taskId];
        return next;
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] })
      ]);
    },
    onError: (_error, variables) => {
      setOptimisticTaskPhases((previous) => {
        const next = { ...previous };
        delete next[variables.taskId];
        return next;
      });
      ui.error("Could not move that task.");
    }
  });

  const createFileLinkMutation = useMutation({
    mutationFn: (payload: {
      fileName: string;
      fileType: string;
      storageType: string;
      externalUrl: string;
    }) =>
      apiRequest("/files/link", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          projectId,
          fileName: payload.fileName,
          fileType: payload.fileType,
          storageType: payload.storageType,
          externalUrl: payload.externalUrl,
          mimeType: "application/octet-stream",
          fileSize: 1
        }
      }),
    onSuccess: async () => {
      setFileLinkName("");
      setFileLinkUrl("");
      setFileFormError(null);
      setFileLinkDialogOpen(false);
      await refreshData();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFileFormError(error.message);
        return;
      }
      setFileFormError("File link creation failed");
    }
  });

  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) =>
      apiRequest(`/files/${fileId}`, {
        method: "DELETE",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: async () => {
      await refreshData();
      ui.success("File removed.");
    },
    onError: () => {
      ui.error("Could not remove file.");
    }
  });

  const openFileMutation = useMutation({
    mutationFn: async (file: ProjectFile) => {
      if (file.external_url) {
        window.open(file.external_url, "_blank", "noopener,noreferrer");
        return;
      }

      await apiDownload(`/files/${file.id}/content`, file.file_name, accessToken ?? undefined);
    }
  });

  const addTeamMemberMutation = useMutation({
    mutationFn: (payload: { userId: string; role: "manager" | "member" | "viewer" }) =>
      apiRequest(`/projects/${projectId}/team`, {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          userId: payload.userId,
          role: payload.role
        }
      }),
    onSuccess: async () => {
      setTeamFormError(null);
      setTeamUserId("");
      setTeamMemberDialogOpen(false);
      await refreshData();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setTeamFormError(error.message);
        return;
      }
      setTeamFormError("Could not add team member.");
    }
  });

  const removeTeamMemberMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest(`/projects/${projectId}/team/${userId}`, {
        method: "DELETE",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: async () => {
      await refreshData();
      ui.success("Team member removed.");
    },
    onError: () => {
      ui.error("Could not remove team member.");
    }
  });

  const phaseTransitionMutation = useMutation({
    mutationFn: (nextPhase: string) =>
      apiRequest(`/projects/${projectId}/phase`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined,
        body: {
          phase: nextPhase,
          reason: null
        }
      }),
    onSuccess: async () => {
      setPhaseError(null);
      await refreshData();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setPhaseError(error.message);
        return;
      }
      setPhaseError("Could not transition project phase.");
    }
  });

  const createCommentMutation = useMutation({
    mutationFn: (input: { taskId: string; body: string }) =>
      apiRequest(`/tasks/${input.taskId}/comments`, {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: { body: input.body }
      }),
    onSuccess: async () => {
      setCommentBody("");
      await Promise.all([refreshComments(), refreshData()]);
    }
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (input: { taskId: string; commentId: string }) =>
      apiRequest(`/tasks/${input.taskId}/comments/${input.commentId}`, {
        method: "DELETE",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: async () => {
      await Promise.all([refreshComments(), refreshData()]);
      ui.success("Comment deleted.");
    },
    onError: () => {
      ui.error("Could not delete comment.");
    }
  });

  const bulkStatusMutation = useMutation({
    mutationFn: (nextStatus: Task["status"]) =>
      apiRequest("/tasks/bulk/status", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          taskIds: selectedTaskIds,
          status: nextStatus
        }
      }),
    onSuccess: async (_, nextStatus) => {
      setSelectedTaskIds([]);
      await refreshData();
      ui.success(`Selected tasks updated to ${formatLabel(nextStatus)}.`);
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
      setSelectedTaskIds([]);
      if (selectedTaskId && selectedTaskIds.includes(selectedTaskId)) {
        setSelectedTaskId(null);
      }
      await refreshData();
      ui.success("Selected tasks deleted.");
    },
    onError: () => {
      ui.error("Could not delete selected tasks.");
    }
  });

  useEffect(() => {
    if (!tasksQuery.data?.data) return;
    setTaskDrafts((previous) => {
      const next = { ...previous };
      for (const task of tasksQuery.data.data) {
        if (!next[task.id]) {
          next[task.id] = {
            assigneeIds: (task.assignees ?? []).map((assignee) => assignee.id),
            dueDate: task.due_date ? task.due_date.slice(0, 10) : "",
            priority: task.priority,
            labels: task.labels ?? []
          };
        } else {
          next[task.id] = {
            ...next[task.id],
            priority: next[task.id].priority || task.priority,
            assigneeIds: next[task.id].assigneeIds ?? (task.assignees ?? []).map((assignee) => assignee.id),
            labels: next[task.id].labels ?? (task.labels ?? [])
          };
        }
      }
      return next;
    });
  }, [tasksQuery.data]);

  useEffect(() => {
    if (!tasksQuery.data?.data) return;
    const availableIds = new Set(tasksQuery.data.data.map((task) => task.id));
    setSelectedTaskIds((previous) => previous.filter((id) => availableIds.has(id)));
  }, [tasksQuery.data?.data]);

  if (!projectId) {
    return <div className="state-card">Missing project id.</div>;
  }

  if (projectQuery.isLoading) {
    return <div className="state-card">Loading project...</div>;
  }

  if (projectQuery.isError || !projectQuery.data) {
    return <div className="state-card">Could not load project.</div>;
  }

  const project = projectQuery.data.data;
  const phaseFlow = [
    "client_acquisition",
    "strategy_planning",
    "production",
    "post_production",
    "delivery"
  ] as const;
  const currentPhaseIndex = phaseFlow.indexOf(project.current_phase as (typeof phaseFlow)[number]);
  const nextPhase = currentPhaseIndex >= 0 && currentPhaseIndex < phaseFlow.length - 1 ? phaseFlow[currentPhaseIndex + 1] : null;

  const handleDeleteFile = async (file: ProjectFile) => {
    const shouldDelete = await ui.confirm({
      title: "Delete file",
      message: `Delete "${file.file_name}" from this project?`,
      confirmLabel: "Delete"
    });
    if (!shouldDelete) return;
    deleteFileMutation.mutate(file.id);
  };

  const handleRemoveTeamMember = async (member: ProjectTeamResponse["data"][number]) => {
    const shouldRemove = await ui.confirm({
      title: "Remove team member",
      message: `Remove ${member.user_name} from this project team?`,
      confirmLabel: "Remove"
    });
    if (!shouldRemove) return;
    removeTeamMemberMutation.mutate(member.user_id);
  };

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((previous) =>
      previous.includes(taskId) ? previous.filter((id) => id !== taskId) : [...previous, taskId]
    );
  };

  const displayedTasks = (tasksQuery.data?.data ?? []).map((task) => ({
    ...task,
    phase: optimisticTaskPhases[task.id] ?? task.phase
  }));
  const selectedTask = displayedTasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedTaskDraft = selectedTask ? taskDrafts[selectedTask.id] ?? createTaskDraft(selectedTask) : null;

  const toggleTaskAssignee = (userId: string) => {
    if (!selectedTask || !selectedTaskDraft) return;
    const assigneeIds = selectedTaskDraft.assigneeIds.includes(userId)
      ? selectedTaskDraft.assigneeIds.filter((id) => id !== userId)
      : [...selectedTaskDraft.assigneeIds, userId];
    setTaskDrafts((previous) => ({ ...previous, [selectedTask.id]: { ...selectedTaskDraft, assigneeIds } }));
  };

  const addTaskLabel = () => {
    if (!selectedTask || !selectedTaskDraft) return;
    const name = newTaskLabelName.trim();
    if (!name) return;
    if (selectedTaskDraft.labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
      ui.error("That label is already on this task.");
      return;
    }
    if (selectedTaskDraft.labels.length >= 12) {
      ui.error("A task can have up to 12 labels.");
      return;
    }
    setTaskDrafts((previous) => ({
      ...previous,
      [selectedTask.id]: {
        ...selectedTaskDraft,
        labels: [...selectedTaskDraft.labels, { name, color: newTaskLabelColor }]
      }
    }));
    setNewTaskLabelName("");
  };

  const removeTaskLabel = (labelName: string) => {
    if (!selectedTask || !selectedTaskDraft) return;
    setTaskDrafts((previous) => ({
      ...previous,
      [selectedTask.id]: {
        ...selectedTaskDraft,
        labels: selectedTaskDraft.labels.filter((label) => label.name !== labelName)
      }
    }));
  };

  const handleTaskDragEnd = (event: DragEndEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    const nextPhase = event.over?.id ? String(event.over.id) as TaskPhase : null;
    setActiveTask(null);
    if (!task || !nextPhase || nextPhase === task.phase || !canWriteTask) return;
    if (!taskPhases.some((phaseOption) => phaseOption.id === nextPhase)) return;
    setOptimisticTaskPhases((previous) => ({ ...previous, [task.id]: nextPhase }));
    moveTaskPhaseMutation.mutate({ taskId: task.id, phase: nextPhase });
  };

  const applyBulkTaskAction = async () => {
    if (!bulkTaskAction || selectedTaskIds.length === 0) return;

    if (bulkTaskAction === "start") {
      bulkStatusMutation.mutate("in_progress");
      return;
    }

    if (bulkTaskAction === "complete") {
      bulkStatusMutation.mutate("completed");
      return;
    }

    const shouldDelete = await ui.confirm({
      title: "Delete selected tasks",
      message: `Delete ${selectedTaskIds.length} selected tasks from this project?`,
      confirmLabel: "Delete"
    });
    if (!shouldDelete) return;
    bulkDeleteMutation.mutate();
  };

  const advanceProjectPhase = async () => {
    if (!nextPhase) return;
    if (nextPhase === "delivery") {
      const result = await apiRequest<{ data: Array<{ status: string }> }>(`/deliverables/project/${projectId}`, { accessToken: accessToken ?? undefined });
      const unresolved = result.data.filter((item) => item.status !== "approved").length;
      const confirmed = await ui.confirm({
        title: "Move project to Delivery?",
        message: unresolved > 0
          ? `${unresolved} deliverable review${unresolved === 1 ? " is" : "s are"} unresolved. Client approval and change requests will close, but files and review history will stay visible.`
          : "Client approval and change requests will close. Files and review history will remain visible.",
        confirmLabel: "Move to Delivery",
        cancelLabel: "Keep in review",
        tone: "warning"
      });
      if (!confirmed) return;
    }
    phaseTransitionMutation.mutate(nextPhase);
  };

  return (
    <section className="project-detail-page">
      <PageHeader
        title={project.name}
        description={project.client_name}
        meta={<span className={`phase-pill phase-pill-${project.current_phase}`}>{formatLabel(project.current_phase)}</span>}
        actions={<><Link to="/projects" className="ghost-button">Back</Link>{canUpdateProject && nextPhase ? <Button variant="primary" disabled={phaseTransitionMutation.isPending} onClick={() => void advanceProjectPhase()}>{phaseTransitionMutation.isPending ? "Moving…" : `Move to ${formatLabel(nextPhase)}`}</Button> : null}</>}
      />

      <div className="tab-strip">
        <button
          className={activeTab === "overview" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={activeTab === "tasks" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("tasks")}
        >
          Task board ({tasksQuery.data?.meta.total ?? 0})
        </button>
        <button
          className={activeTab === "deliverables" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("deliverables")}
        >
          Deliverables
        </button>
        <button
          className={activeTab === "files" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("files")}
        >
          Files ({filesQuery.data?.meta.total ?? 0})
        </button>
        <button
          className={activeTab === "activity" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("activity")}
        >
          Activity ({activityQuery.data?.data.length ?? 0})
        </button>
        <button
          className={activeTab === "team" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("team")}
        >
          Team ({teamQuery.data?.data.length ?? 0})
        </button>
      </div>

      {activeTab === "overview" ? (
        <div className="tasks-pane">
          <div className="project-summary-bar">
            <div><span>Priority</span><strong>{formatLabel(project.priority)}</strong></div>
            <div><span>Deadline</span><strong>{new Date(project.deadline).toLocaleDateString()}</strong></div>
            <div><span>Tasks</span><strong>{project.task_summary.completed} / {project.task_summary.total} complete</strong></div>
            <div><span>Open work</span><strong>{project.task_summary.pending + project.task_summary.in_progress}</strong></div>
          </div>
          {phaseError ? <p className="board-error">{phaseError}</p> : null}
        </div>
      ) : activeTab === "tasks" ? (
        <div className="tasks-pane">
          <div className="section-action-bar task-board-action-bar">
            <div>
              <p className="eyebrow">Project workflow</p>
              <h2>Task board</h2>
              <p className="muted">Move tasks through the five delivery phases.</p>
            </div>
            {canWriteTask ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setTaskCreateOpen(true)}>New task</Button> : <p className="muted">You have read-only task access.</p>}
          </div>

          {selectedTaskIds.length > 0 ? <div className="selection-toolbar">
            <strong>{selectedTaskIds.length} selected</strong>
            <select
              value={bulkTaskAction}
              onChange={(event) => setBulkTaskAction(event.target.value as "" | "start" | "complete" | "delete")}
              disabled={!canWriteTask}
            >
              <option value="">Bulk action</option>
              <option value="start">Start selected</option>
              <option value="complete">Complete selected</option>
              <option value="delete">Delete selected</option>
            </select>
            <button
              type="button"
              className="ghost-button"
              onClick={applyBulkTaskAction}
              disabled={
                !canWriteTask ||
                !bulkTaskAction ||
                selectedTaskIds.length === 0 ||
                bulkDeleteMutation.isPending ||
                bulkStatusMutation.isPending
              }
            >
              Apply
            </button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedTaskIds([])}>Cancel</Button>
          </div> : null}

          <Dialog
            open={taskCreateOpen}
            onOpenChange={setTaskCreateOpen}
            title="Create a task"
            description="Add the task to the delivery phase where work should begin."
            footer={<div className="inline-actions"><Button variant="ghost" onClick={() => setTaskCreateOpen(false)}>Cancel</Button><Button variant="primary" type="submit" form="create-project-task-form" icon={<Plus size={16} />} disabled={!title.trim() || createTaskMutation.isPending}>{createTaskMutation.isPending ? "Creating…" : "Create task"}</Button></div>}
          >
            <form id="create-project-task-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); if (title.trim()) createTaskMutation.mutate({ title: title.trim(), phase }); }}>
              <label className="field"><span>Task title</span><input autoFocus placeholder="e.g. Prepare campaign storyboard" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="field"><span>Starting phase</span><select value={phase} onChange={(event) => setPhase(event.target.value as TaskPhase)}>
                {taskPhases.map((phaseOption) => <option key={phaseOption.id} value={phaseOption.id}>{phaseOption.label}</option>)}
              </select></label>
              {formError ? <p className="error-text">{formError}</p> : null}
            </form>
          </Dialog>

          {tasksQuery.isLoading ? (
            <div className="state-card card">Loading task board...</div>
          ) : tasksQuery.isError ? (
            <div className="state-card card">Could not load the task board.</div>
          ) : (
            <DndContext
              onDragStart={(event) => setActiveTask(event.active.data.current?.task as Task | null)}
              onDragCancel={() => setActiveTask(null)}
              onDragEnd={handleTaskDragEnd}
            >
              <div className="task-kanban-board" aria-label={`${project.name} task board`}>
                {taskPhases.map((phaseOption) => (
                  <TaskPhaseColumn
                    key={phaseOption.id}
                    phase={phaseOption}
                    tasks={displayedTasks.filter((task) => task.phase === phaseOption.id)}
                    canWrite={canWriteTask}
                    selectedTaskIds={selectedTaskIds}
                    onToggleSelected={toggleTaskSelection}
                    onOpenTask={(taskId) => setSelectedTaskId(taskId)}
                    onStatusChange={(taskId, status) => {
                      setTaskActionState((previous) => ({ ...previous, [taskId]: "saving" }));
                      statusMutation.mutate({ taskId, status });
                    }}
                  />
                ))}
              </div>
              <DragOverlay zIndex={1200} dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
                {activeTask ? <TaskDragPreview task={activeTask} /> : null}
              </DragOverlay>
            </DndContext>
          )}

          <Dialog
            open={Boolean(selectedTask)}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedTaskId(null);
                setCommentBody("");
                setAssigneePickerOpen(false);
                setNewTaskLabelName("");
              }
            }}
            title={selectedTask?.title ?? "Task details"}
            description="Review the task, update its ownership and timing, or leave a comment."
            size="lg"
            footer={selectedTask ? (
              <div className="inline-actions">
                <Button variant="ghost" onClick={() => {
                  setSelectedTaskId(null);
                  setCommentBody("");
                  setAssigneePickerOpen(false);
                  setNewTaskLabelName("");
                }}>Close</Button>
                {canWriteTask ? (
                  <Button variant="primary" type="submit" form="edit-task-details-form" disabled={updateTaskMutation.isPending}>
                    {updateTaskMutation.isPending ? "Saving…" : "Save changes"}
                  </Button>
                ) : null}
              </div>
            ) : undefined}
          >
            {selectedTask && selectedTaskDraft ? (
              <div className="task-detail-modal">
                <div className="task-detail-summary" aria-label="Task summary">
                  <span className={`phase-pill phase-pill-${selectedTask.phase}`}>
                    {taskPhases.find((phaseOption) => phaseOption.id === selectedTask.phase)?.label}
                  </span>
                  <span className={`status-chip status-${selectedTask.status}`}>{formatLabel(selectedTask.status)}</span>
                  <span className={`badge badge-priority badge-priority-${selectedTask.priority}`}>{selectedTask.priority}</span>
                </div>

                <form
                  id="edit-task-details-form"
                  className="task-detail-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setTaskActionState((previous) => ({ ...previous, [selectedTask.id]: "saving" }));
                    updateTaskMutation.mutate({
                      taskId: selectedTask.id,
                      assigneeIds: selectedTaskDraft.assigneeIds,
                      dueDate: selectedTaskDraft.dueDate,
                      priority: selectedTaskDraft.priority,
                      labels: selectedTaskDraft.labels
                    });
                  }}
                >
                  <div className="field task-assignee-field">
                    <span>Assignees <small>{selectedTaskDraft.assigneeIds.length || "None"} selected</small></span>
                    <div className="task-assignee-picker">
                      <div className="task-assignee-selection">
                        {selectedTaskDraft.assigneeIds.length ? selectedTaskDraft.assigneeIds.map((userId) => {
                          const user = usersQuery.data?.data.find((candidate) => candidate.id === userId);
                          return user ? (
                            <span key={user.id} className="assignee-chip">
                              <span className="avatar avatar-fallback">{user.name.slice(0, 1).toUpperCase()}</span>
                              {user.name}
                              {canWriteTask ? <button type="button" aria-label={`Remove ${user.name}`} onClick={() => toggleTaskAssignee(user.id)}>×</button> : null}
                            </span>
                          ) : null;
                        }) : <span className="task-picker-placeholder">No one assigned yet</span>}
                        {canWriteTask ? <Button variant="secondary" size="sm" type="button" icon={<UserPlus size={14} />} onClick={() => setAssigneePickerOpen((open) => !open)}>{assigneePickerOpen ? "Done" : "Add people"}</Button> : null}
                      </div>
                      {assigneePickerOpen && canWriteTask ? (
                        <div className="task-assignee-options" role="group" aria-label="Choose task assignees">
                          {usersQuery.data?.data.map((user) => (
                            <label key={user.id} className="task-assignee-option">
                              <input type="checkbox" checked={selectedTaskDraft.assigneeIds.includes(user.id)} onChange={() => toggleTaskAssignee(user.id)} />
                              <span className="avatar avatar-fallback">{user.name.slice(0, 1).toUpperCase()}</span>
                              <span><strong>{user.name}</strong><small>{user.email}</small></span>
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <label className="field"><span>Priority</span><select
                    value={selectedTaskDraft.priority}
                    onChange={(event) => setTaskDrafts((previous) => ({ ...previous, [selectedTask.id]: { ...selectedTaskDraft, priority: event.target.value } }))}
                    disabled={!canWriteTask}
                  ><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
                  <label className="field"><span>Due date</span><input
                    type="date"
                    value={selectedTaskDraft.dueDate}
                    onChange={(event) => setTaskDrafts((previous) => ({ ...previous, [selectedTask.id]: { ...selectedTaskDraft, dueDate: event.target.value } }))}
                    disabled={!canWriteTask}
                  /></label>
                  <div className="field task-label-field">
                    <span>Labels <small>Use labels to classify and find related work</small></span>
                    <div className="task-label-editor">
                      <div className="task-label-selection">
                        {selectedTaskDraft.labels.length ? selectedTaskDraft.labels.map((label) => (
                          <span key={label.name} className={`task-label task-label-${label.color}`}>
                            {label.name}
                            {canWriteTask ? <button type="button" aria-label={`Remove ${label.name} label`} onClick={() => removeTaskLabel(label.name)}>×</button> : null}
                          </span>
                        )) : <span className="task-picker-placeholder">No custom labels</span>}
                      </div>
                      {canWriteTask ? (
                        <div className="task-label-create">
                          <input aria-label="New label name" maxLength={50} placeholder="Add a label" value={newTaskLabelName} onChange={(event) => setNewTaskLabelName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTaskLabel(); } }} />
                          <div className="task-label-colors" role="radiogroup" aria-label="Label color">
                            {taskLabelColors.map((color) => <button key={color.id} type="button" role="radio" aria-checked={newTaskLabelColor === color.id} aria-label={color.label} className={`label-color-option label-color-${color.id} ${newTaskLabelColor === color.id ? "selected" : ""}`} onClick={() => setNewTaskLabelColor(color.id)} />)}
                          </div>
                          <Button variant="secondary" size="sm" type="button" disabled={!newTaskLabelName.trim()} onClick={addTaskLabel}>Add label</Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </form>

                <section className="task-detail-comments" aria-labelledby="task-comments-title">
                  <div className="task-detail-comments-heading">
                    <div>
                      <h3 id="task-comments-title">Comments</h3>
                      <p>Keep discussion and decisions with the task.</p>
                    </div>
                    <MessageSquare size={17} aria-hidden="true" />
                  </div>
                  {canWriteTask ? (
                    <form
                      className="comment-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!commentBody.trim()) return;
                        createCommentMutation.mutate({ taskId: selectedTask.id, body: commentBody.trim() });
                      }}
                    >
                      <input aria-label="New comment" placeholder="Write a comment…" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} />
                      <Button variant="secondary" type="submit" disabled={!commentBody.trim() || createCommentMutation.isPending}>
                        {createCommentMutation.isPending ? "Adding…" : "Add comment"}
                      </Button>
                    </form>
                  ) : null}
                  <div className="task-comment-list">
                    {commentsQuery.isLoading ? (
                      <p className="muted">Loading comments…</p>
                    ) : commentsQuery.isError ? (
                      <p className="muted">Could not load comments.</p>
                    ) : commentsQuery.data?.data.length ? (
                      commentsQuery.data.data.map((comment) => (
                        <article key={comment.id} className="task-comment-item">
                          <div>
                            <p>{comment.body}</p>
                            <time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString()}</time>
                          </div>
                          {canWriteTask ? (
                            <Button variant="ghost" size="sm" onClick={() => deleteCommentMutation.mutate({ taskId: selectedTask.id, commentId: comment.id })} disabled={deleteCommentMutation.isPending}>
                              Delete
                            </Button>
                          ) : null}
                        </article>
                      ))
                    ) : (
                      <div className="task-comment-empty">
                        <MessageSquare size={18} aria-hidden="true" />
                        <p>No comments yet. Start the conversation above.</p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </Dialog>
        </div>
      ) : activeTab === "files" ? (
        <div className="tasks-pane">
          <div className="section-action-bar">
            <div>
              <p className="eyebrow">Project library</p>
              <h2>Files</h2>
              <p className="muted">Keep uploaded assets and links to external files in one place.</p>
            </div>
            {canWriteFile ? (
              <div className="section-action-buttons">
                <Button variant="secondary" icon={<Link2 size={16} />} onClick={() => setFileLinkDialogOpen(true)}>Add external link</Button>
                <Button variant="primary" icon={<UploadCloud size={16} />} onClick={() => setFileUploadOpen(true)}>Upload file</Button>
              </div>
            ) : <p className="muted">You have read-only file access.</p>}
          </div>

          <ProjectFileUpload projectId={projectId ?? ""} disabled={!canWriteFile} open={fileUploadOpen} onOpenChange={setFileUploadOpen} />

          <Dialog
            open={fileLinkDialogOpen}
            onOpenChange={setFileLinkDialogOpen}
            title="Add an external file"
            description="Save a link to a file that lives in Google Drive, Dropbox, or OneDrive."
            footer={<div className="inline-actions"><Button variant="ghost" onClick={() => setFileLinkDialogOpen(false)}>Cancel</Button><Button variant="primary" type="submit" form="external-file-link-form" icon={<Link2 size={16} />} disabled={!fileLinkName.trim() || !fileLinkUrl.trim() || createFileLinkMutation.isPending}>{createFileLinkMutation.isPending ? "Adding…" : "Add link"}</Button></div>}
          >
            <form
              id="external-file-link-form"
              className="modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!fileLinkName.trim() || !fileLinkUrl.trim()) return;
                createFileLinkMutation.mutate({
                  fileName: fileLinkName.trim(),
                  fileType: fileLinkType,
                  storageType: fileLinkStorage,
                  externalUrl: fileLinkUrl.trim()
                });
              }}
            >
              <label className="field"><span>File name</span><input autoFocus placeholder="e.g. Campaign source files" value={fileLinkName} onChange={(event) => setFileLinkName(event.target.value)} /></label>
              <label className="field"><span>File URL</span><input type="url" placeholder="https://..." value={fileLinkUrl} onChange={(event) => setFileLinkUrl(event.target.value)} /></label>
              <div className="modal-form-row">
                <label className="field"><span>Category</span><select value={fileLinkType} onChange={(event) => setFileLinkType(event.target.value)}>
                  <option value="client_profile">Client profile</option>
                  <option value="proposal">Proposal</option>
                  <option value="creative_brief">Creative brief</option>
                  <option value="nda">NDA</option>
                  <option value="contract">Contract</option>
                  <option value="asset">Asset</option>
                  <option value="deliverable">Deliverable</option>
                  <option value="other">Other</option>
                </select></label>
                <label className="field"><span>Storage provider</span><select value={fileLinkStorage} onChange={(event) => setFileLinkStorage(event.target.value)}>
                  <option value="google_drive">Google Drive</option>
                  <option value="dropbox">Dropbox</option>
                  <option value="onedrive">OneDrive</option>
                </select></label>
              </div>
              {fileFormError ? <p className="error-text">{fileFormError}</p> : null}
            </form>
          </Dialog>

          <div className="card table-wrap">
            {filesQuery.isLoading ? (
              <p>Loading files...</p>
            ) : filesQuery.isError ? (
              <p>Could not load files.</p>
            ) : !filesQuery.data?.data.length ? (
              <p className="muted">No files linked yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Storage</th>
                    <th>Size</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filesQuery.data?.data.map((file) => (
                    <tr key={file.id}>
                      <td>{file.file_name}</td>
                      <td>{formatLabel(file.file_type)}</td>
                      <td>{formatLabel(file.storage_type)}</td>
                      <td>{file.file_size}</td>
                      <td>{new Date(file.created_at).toLocaleString()}</td>
                      <td>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => openFileMutation.mutate(file)}
                            disabled={openFileMutation.isPending}
                          >
                            Open
                          </button>
                          {canWriteFile ? (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={() => handleDeleteFile(file)}
                              disabled={deleteFileMutation.isPending}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : activeTab === "deliverables" ? (
        <ProjectDeliverablesPanel
          projectId={projectId ?? ""}
          canWrite={canWriteFile}
          deliveryLocked={project.current_phase === "delivery"}
        />
      ) : activeTab === "activity" ? (
        <div className="card">
          {activityQuery.isLoading ? (
            <p>Loading activity...</p>
          ) : activityQuery.isError ? (
            <p>Could not load activity.</p>
          ) : (
            <div className="activity-list">
              {activityQuery.data?.data.length ? (
                activityQuery.data.data.map((entry) => (
                  <article key={entry.id} className="activity-item">
                    <p className="notice-title">{formatLabel(entry.action)}</p>
                    <p className="muted">
                      by {entry.user_name ?? "system"} at {new Date(entry.created_at).toLocaleString()}
                    </p>
                  </article>
                ))
              ) : (
                <p className="muted">No activity yet.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="tasks-pane">
          <div className="section-action-bar">
            <div>
              <p className="eyebrow">Project access</p>
              <h2>Team</h2>
              <p className="muted">Manage the staff members assigned to this project.</p>
            </div>
            {canManageTeam ? <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setTeamMemberDialogOpen(true)}>Add team member</Button> : <p className="muted">Only owners and managers can manage this team.</p>}
          </div>

          <Dialog
            open={teamMemberDialogOpen}
            onOpenChange={setTeamMemberDialogOpen}
            title="Add a team member"
            description="Choose a staff member and the access level they should have on this project."
            footer={<div className="inline-actions"><Button variant="ghost" onClick={() => setTeamMemberDialogOpen(false)}>Cancel</Button><Button variant="primary" type="submit" form="add-project-team-member-form" icon={<UserPlus size={16} />} disabled={!teamUserId || addTeamMemberMutation.isPending}>{addTeamMemberMutation.isPending ? "Adding…" : "Add member"}</Button></div>}
          >
            <form id="add-project-team-member-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); if (teamUserId) addTeamMemberMutation.mutate({ userId: teamUserId, role: teamRole }); }}>
              <label className="field"><span>Staff member</span><select autoFocus value={teamUserId} onChange={(event) => setTeamUserId(event.target.value)} disabled={usersQuery.isLoading}>
                <option value="">Select user</option>
                {usersQuery.data?.data.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select></label>
              <label className="field"><span>Project role</span><select value={teamRole} onChange={(event) => setTeamRole(event.target.value as "manager" | "member" | "viewer")}>
                <option value="manager">Manager — manage work and team</option>
                <option value="member">Member — create and update work</option>
                <option value="viewer">Viewer — read-only access</option>
              </select></label>
              {teamFormError ? <p className="error-text">{teamFormError}</p> : null}
            </form>
          </Dialog>

          <div className="card table-wrap">
            {teamQuery.isLoading ? (
              <p>Loading team...</p>
            ) : teamQuery.isError ? (
              <p>Could not load team.</p>
            ) : !teamQuery.data?.data.length ? (
              <p className="muted">No team members assigned yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teamQuery.data?.data.map((member) => (
                    <tr key={member.user_id}>
                      <td>{member.user_name}</td>
                      <td>{member.user_email}</td>
                      <td>{formatLabel(member.role)}</td>
                      <td>{new Date(member.created_at).toLocaleString()}</td>
                      <td>
                        {canManageTeam ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => handleRemoveTeamMember(member)}
                            disabled={removeTeamMemberMutation.isPending}
                          >
                            Remove
                          </button>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

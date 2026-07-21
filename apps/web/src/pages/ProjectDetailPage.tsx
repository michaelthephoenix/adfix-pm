import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DndContext, DragOverlay, type DragEndEvent } from "@dnd-kit/core";
import { FileCheck2, Link2, MessageSquare, Plus, UploadCloud, UserPlus } from "lucide-react";
import { apiDownload, apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { ProjectFileUpload } from "../components/ProjectFileUpload";
import { ProjectDeliverablesPanel } from "../components/ProjectDeliverablesPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { TaskDragPreview, TaskPhaseColumn } from "../features/project-tasks/TaskBoard";
import {
  createTaskDraft,
  formatLabel,
  taskLabelColors,
  taskPhases,
  type DeliverableSelection,
  type Task,
  type TaskDraft,
  type TaskLabel,
  type TaskLabelColor,
  type TaskPhase
} from "../features/project-tasks/model";

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

type ProjectDeliverablesResponse = {
  data: Array<{ id: string; title: string; status: string }>;
};

type ProjectTab = "overview" | "tasks" | "files" | "deliverables" | "activity" | "team";
const projectTabs: ProjectTab[] = ["overview", "tasks", "files", "deliverables", "activity", "team"];

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
    role: "owner" | "manager" | "member" | "viewer";
    user_name: string;
    user_email: string;
    created_at: string;
    assigned_task_count: string;
    open_task_count: string;
    overdue_task_count: string;
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

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { accessToken } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<ProjectTab>(projectTabs.includes(initialTab as ProjectTab) ? initialTab as ProjectTab : "tasks");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<TaskPhase>("production");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskAssigneeIds, setTaskAssigneeIds] = useState<string[]>([]);
  const [taskPriority, setTaskPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskLabels, setTaskLabels] = useState<TaskLabel[]>([]);
  const [taskNewLabelName, setTaskNewLabelName] = useState("");
  const [taskNewLabelColor, setTaskNewLabelColor] = useState<TaskLabelColor>("violet");
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [taskDeliverableMode, setTaskDeliverableMode] = useState<"none" | "existing" | "new">("none");
  const [taskDeliverableId, setTaskDeliverableId] = useState("");
  const [taskDeliverableTitle, setTaskDeliverableTitle] = useState("");
  const [taskDeliverableRequired, setTaskDeliverableRequired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({});
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [optimisticTaskPhases, setOptimisticTaskPhases] = useState<Record<string, TaskPhase>>({});
  const [bulkTaskAction, setBulkTaskAction] = useState<"" | "start" | "complete" | "delete" | "assign" | "phase" | "priority" | "label">("");
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [bulkPhase, setBulkPhase] = useState<TaskPhase>("production");
  const [bulkPriority, setBulkPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [bulkLabelName, setBulkLabelName] = useState("");
  const [bulkLabelColor, setBulkLabelColor] = useState<TaskLabelColor>("violet");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [mobileTaskPhase, setMobileTaskPhase] = useState<TaskPhase>("production");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDeliverableDialogOpen, setTaskDeliverableDialogOpen] = useState(false);
  const [detailDeliverableMode, setDetailDeliverableMode] = useState<"existing" | "new">("existing");
  const [detailDeliverableId, setDetailDeliverableId] = useState("");
  const [detailDeliverableTitle, setDetailDeliverableTitle] = useState("");
  const [detailDeliverableError, setDetailDeliverableError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [newTaskLabelName, setNewTaskLabelName] = useState("");
  const [newTaskLabelColor, setNewTaskLabelColor] = useState<TaskLabelColor>("violet");
  const [taskDetailError, setTaskDetailError] = useState<string | null>(null);
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
  const [teamActionError, setTeamActionError] = useState<string | null>(null);

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

  const deliverablesQuery = useQuery({
    queryKey: ["project-deliverables", projectId],
    queryFn: () => apiRequest<ProjectDeliverablesResponse>(`/deliverables/project/${projectId}`, {
      accessToken: accessToken ?? undefined
    }),
    enabled: Boolean(projectId && accessToken && (taskCreateOpen || selectedTaskId || taskDeliverableDialogOpen))
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
      queryClient.invalidateQueries({ queryKey: ["project-deliverables", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] })
    ]);
  };

  const refreshComments = async () => {
    if (!selectedTaskId) return;
    await queryClient.invalidateQueries({ queryKey: ["task-comments", selectedTaskId] });
  };

  const createTaskMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      description: string | null;
      phase: TaskPhase;
      priority: "low" | "medium" | "high" | "urgent";
      dueDate: string | null;
      assigneeIds: string[];
      labels: TaskLabel[];
      deliverableRequired: boolean;
      deliverable?: DeliverableSelection;
    }) =>
      apiRequest(`/tasks`, {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          projectId,
          title: payload.title,
          description: payload.description,
          phase: payload.phase,
          priority: payload.priority,
          dueDate: payload.dueDate,
          assigneeIds: payload.assigneeIds,
          labels: payload.labels.map(({ name, color }) => ({ name, color })),
          deliverableRequired: payload.deliverableRequired,
          deliverable: payload.deliverable
        }
      }),
    onSuccess: async () => {
      resetTaskCreateFields();
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

  const attachTaskDeliverableMutation = useMutation({
    mutationFn: (input: { taskId: string; selection: DeliverableSelection }) =>
      apiRequest(`/tasks/${input.taskId}/deliverables`, {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: input.selection
      }),
    onSuccess: async () => {
      setTaskDeliverableDialogOpen(false);
      setDetailDeliverableMode("existing");
      setDetailDeliverableId("");
      setDetailDeliverableTitle("");
      setDetailDeliverableError(null);
      ui.success("Deliverable connected to this task.");
      await refreshData();
    },
    onError: (error) => {
      setDetailDeliverableError(error instanceof ApiError ? error.message : "Could not connect the deliverable.");
    }
  });

  const statusMutation = useMutation({
    mutationFn: (input: { taskId: string; status: Task["status"] }) =>
      apiRequest(`/tasks/${input.taskId}/status`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined,
        body: { status: input.status }
    }),
    onSuccess: async () => {
      await refreshData();
    },
    onError: (error) => ui.error(error instanceof ApiError ? error.message : "Could not update task status.")
  });

  const updateTaskMutation = useMutation({
    mutationFn: (input: { taskId: string; assigneeIds: string[]; dueDate: string; priority: string; labels: TaskLabel[]; deliverableRequired: boolean }) =>
      apiRequest(`/tasks/${input.taskId}`, {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: {
          assigneeIds: input.assigneeIds,
          dueDate: input.dueDate ? input.dueDate : null,
          priority: input.priority,
          deliverableRequired: input.deliverableRequired,
          labels: input.labels.map(({ name, color }) => ({ name, color }))
        }
    }),
    onSuccess: async () => {
      setTaskDetailError(null);
      await refreshData();
      ui.success("Task details saved.");
    },
    onError: (error) => {
      setTaskDetailError(error instanceof ApiError ? error.message : "Could not save task details.");
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
      setTeamActionError(null);
      setTeamUserId("");
      setTeamRole("member");
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

  const updateTeamRoleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "manager" | "member" | "viewer" }) =>
      apiRequest(`/projects/${projectId}/team/${input.userId}`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined,
        body: { role: input.role }
      }),
    onSuccess: async () => {
      setTeamActionError(null);
      await refreshData();
      ui.success("Project role updated.");
    },
    onError: (error) => {
      setTeamActionError(error instanceof ApiError ? error.message : "Could not update this project role.");
    }
  });

  const removeTeamMemberMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest(`/projects/${projectId}/team/${userId}`, {
        method: "DELETE",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: async () => {
      setTeamActionError(null);
      await refreshData();
      ui.success("Team member removed.");
    },
    onError: (error) => {
      setTeamActionError(error instanceof ApiError ? error.message : "Could not remove team member.");
    }
  });

  const phaseTransitionMutation = useMutation({
    mutationFn: (input: { nextPhase: string; confirmUnresolvedReviews: boolean }) =>
      apiRequest(`/projects/${projectId}/phase`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined,
        body: {
          phase: input.nextPhase,
          reason: null,
          clientUpdate: null,
          confirmUnresolvedReviews: input.confirmUnresolvedReviews
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
      setBulkError(null);
      await refreshData();
      ui.success(`Selected tasks updated to ${formatLabel(nextStatus)}.`);
    },
    onError: (error) => {
      setBulkError(error instanceof ApiError ? error.message : "Could not update selected tasks.");
    }
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: (updates: {
      assigneeIds?: string[];
      phase?: TaskPhase;
      priority?: "low" | "medium" | "high" | "urgent";
      addLabels?: Array<{ name: string; color: TaskLabelColor }>;
    }) => apiRequest("/tasks/bulk/update", {
      method: "POST",
      accessToken: accessToken ?? undefined,
      body: { taskIds: selectedTaskIds, ...updates }
    }),
    onSuccess: async () => {
      setSelectedTaskIds([]);
      setBulkTaskAction("");
      setBulkAssigneeId("");
      setBulkLabelName("");
      setBulkError(null);
      await refreshData();
      ui.success("Selected tasks updated.");
    },
    onError: (error) => {
      setBulkError(error instanceof ApiError ? error.message : "Could not update selected tasks.");
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
      setBulkError(null);
      if (selectedTaskId && selectedTaskIds.includes(selectedTaskId)) {
        setSelectedTaskId(null);
      }
      await refreshData();
      ui.success("Selected tasks deleted.");
    },
    onError: (error) => {
      setBulkError(error instanceof ApiError ? error.message : "Could not delete selected tasks.");
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
            labels: task.labels ?? [],
            deliverableRequired: task.deliverable_required
          };
        } else {
          next[task.id] = {
            ...next[task.id],
            priority: next[task.id].priority || task.priority,
            assigneeIds: next[task.id].assigneeIds ?? (task.assignees ?? []).map((assignee) => assignee.id),
            labels: next[task.id].labels ?? (task.labels ?? []),
            deliverableRequired: next[task.id].deliverableRequired ?? task.deliverable_required
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

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (projectTabs.includes(requestedTab as ProjectTab)) setActiveTab(requestedTab as ProjectTab);
    const requestedTask = searchParams.get("task");
    if (requestedTask && tasksQuery.data?.data.some((task) => task.id === requestedTask)) {
      setActiveTab("tasks");
      setSelectedTaskId(requestedTask);
    }
  }, [searchParams, tasksQuery.data?.data]);

  useEffect(() => {
    const currentPhase = projectQuery.data?.data.current_phase as TaskPhase | undefined;
    if (!currentPhase || !taskPhases.some((option) => option.id === currentPhase)) return;
    setMobileTaskPhase(currentPhase);
    if (!taskCreateOpen) setPhase(currentPhase);
  }, [projectQuery.data?.data.current_phase, taskCreateOpen]);

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
  const assignableProjectMembers = (teamQuery.data?.data ?? []).filter((member) => member.role !== "viewer");
  const availableTeamUsers = (usersQuery.data?.data ?? []).filter(
    (user) => !(teamQuery.data?.data ?? []).some((member) => member.user_id === user.id)
  );
  const availableDeliverables = deliverablesQuery.data?.data ?? [];
  const unlinkedDeliverables = selectedTask
    ? availableDeliverables.filter((deliverable) => !selectedTask.deliverables.some((linked) => linked.id === deliverable.id))
    : availableDeliverables;
  const taskCreateValid = Boolean(
    title.trim()
    && (taskDeliverableMode === "none"
      || (taskDeliverableMode === "existing" && taskDeliverableId)
      || (taskDeliverableMode === "new" && taskDeliverableTitle.trim()))
  );

  const taskCreateDirty = Boolean(
    title.trim()
    || taskDescription.trim()
    || taskAssigneeIds.length
    || taskPriority !== "medium"
    || taskDueDate
    || taskLabels.length
    || taskNewLabelName.trim()
    || phase !== project.current_phase
    || taskDeliverableMode !== "none"
    || taskDeliverableRequired
  );
  const taskDetailDirty = Boolean(selectedTask && selectedTaskDraft && (
    selectedTaskDraft.priority !== selectedTask.priority
    || selectedTaskDraft.dueDate !== (selectedTask.due_date?.slice(0, 10) ?? "")
    || selectedTaskDraft.deliverableRequired !== selectedTask.deliverable_required
    || JSON.stringify([...selectedTaskDraft.assigneeIds].sort()) !== JSON.stringify(selectedTask.assignees.map((assignee) => assignee.id).sort())
    || JSON.stringify(selectedTaskDraft.labels.map(({ name, color }) => ({ name, color })).sort((a, b) => a.name.localeCompare(b.name)))
      !== JSON.stringify(selectedTask.labels.map(({ name, color }) => ({ name, color })).sort((a, b) => a.name.localeCompare(b.name)))
  )) || Boolean(newTaskLabelName.trim() || commentBody.trim());
  const taskDeliverableDirty = Boolean(detailDeliverableMode !== "existing" || detailDeliverableId || detailDeliverableTitle.trim());
  const teamMemberDirty = Boolean(teamUserId || teamRole !== "member");
  const supervisorCount = (teamQuery.data?.data ?? []).filter((member) => member.role === "owner" || member.role === "manager").length;

  const confirmDiscard = async (dirty: boolean) => {
    if (!dirty) return true;
    return ui.confirm({
      title: "Discard unsaved changes?",
      message: "The information entered in this dialog has not been saved.",
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      tone: "warning"
    });
  };

  function resetTaskCreateFields() {
    setTaskCreateOpen(false);
    setTitle("");
    setTaskDescription("");
    setTaskAssigneeIds([]);
    setTaskPriority("medium");
    setTaskDueDate("");
    setTaskLabels([]);
    setTaskNewLabelName("");
    setTaskNewLabelColor("violet");
    setPhase((project.current_phase as TaskPhase) ?? "production");
    setTaskDeliverableMode("none");
    setTaskDeliverableId("");
    setTaskDeliverableTitle("");
    setTaskDeliverableRequired(false);
    setFormError(null);
  }

  const requestCloseTaskCreate = async () => {
    if (await confirmDiscard(taskCreateDirty)) resetTaskCreateFields();
  };

  const closeTaskDetails = () => {
    setSelectedTaskId(null);
    setTaskDetailError(null);
    setCommentBody("");
    setAssigneePickerOpen(false);
    setNewTaskLabelName("");
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    setSearchParams(next, { replace: true });
  };

  const requestCloseTaskDetails = async () => {
    if (await confirmDiscard(taskDetailDirty)) closeTaskDetails();
  };

  const openDeliverablesFromTask = async () => {
    if (!await confirmDiscard(taskDetailDirty)) return;
    closeTaskDetails();
    selectTab("deliverables");
  };

  const resetTaskDeliverableDialog = () => {
    setTaskDeliverableDialogOpen(false);
    setDetailDeliverableMode("existing");
    setDetailDeliverableId("");
    setDetailDeliverableTitle("");
    setDetailDeliverableError(null);
  };

  const requestCloseTaskDeliverableDialog = async () => {
    if (await confirmDiscard(taskDeliverableDirty)) resetTaskDeliverableDialog();
  };

  const resetTeamMemberDialog = () => {
    setTeamMemberDialogOpen(false);
    setTeamUserId("");
    setTeamRole("member");
    setTeamFormError(null);
  };

  const requestCloseTeamMemberDialog = async () => {
    if (await confirmDiscard(teamMemberDirty)) resetTeamMemberDialog();
  };

  const openTaskDetails = (taskId: string) => {
    setTaskDetailError(null);
    setActiveTab("tasks");
    setSelectedTaskId(taskId);
    const next = new URLSearchParams(searchParams);
    next.set("tab", "tasks");
    next.set("task", taskId);
    setSearchParams(next, { replace: true });
  };

  const selectTab = (tab: ProjectTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    if (tab !== "tasks") next.delete("task");
    if (tab !== "tasks") setSelectedTaskId(null);
    setSearchParams(next, { replace: true });
  };

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
    setBulkError(null);

    if (bulkTaskAction === "start") {
      bulkStatusMutation.mutate("in_progress");
      return;
    }

    if (bulkTaskAction === "complete") {
      const selectedTasks = displayedTasks.filter((task) => selectedTaskIds.includes(task.id));
      if (selectedTasks.some((task) => task.deliverable_required)) {
        ui.error("Tasks that require a deliverable complete through the submission workflow.");
        return;
      }
      bulkStatusMutation.mutate("completed");
      return;
    }

    if (bulkTaskAction === "assign") {
      if (!bulkAssigneeId) {
        setBulkError("Choose the team member who should own these tasks.");
        return;
      }
      bulkUpdateMutation.mutate({ assigneeIds: [bulkAssigneeId] });
      return;
    }
    if (bulkTaskAction === "phase") {
      bulkUpdateMutation.mutate({ phase: bulkPhase });
      return;
    }
    if (bulkTaskAction === "priority") {
      bulkUpdateMutation.mutate({ priority: bulkPriority });
      return;
    }
    if (bulkTaskAction === "label") {
      if (!bulkLabelName.trim()) {
        setBulkError("Enter the label to add to the selected tasks.");
        return;
      }
      bulkUpdateMutation.mutate({ addLabels: [{ name: bulkLabelName.trim(), color: bulkLabelColor }] });
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
    let confirmUnresolvedReviews = false;
    if (nextPhase === "delivery") {
      let unresolved = 0;
      try {
        const result = await apiRequest<{ data: Array<{ status: string }> }>(`/deliverables/project/${projectId}`, { accessToken: accessToken ?? undefined });
        unresolved = result.data.filter((item) => item.status !== "approved").length;
      } catch (error) {
        setPhaseError(error instanceof ApiError ? error.message : "Could not check project readiness for Delivery.");
        return;
      }
      const incompleteTasks = Math.max(0, project.task_summary.total - project.task_summary.completed);
      const confirmed = await ui.confirm({
        title: "Move project to Delivery?",
        message: unresolved > 0 || incompleteTasks > 0
          ? `${unresolved} deliverable review${unresolved === 1 ? " is" : "s are"} unresolved and ${incompleteTasks} task${incompleteTasks === 1 ? " is" : "s are"} incomplete. Client approval and change requests will close, but files and review history will stay visible.`
          : "All recorded work is complete. Client approval and change requests will close; files and review history will remain visible.",
        confirmLabel: "Move to Delivery",
        cancelLabel: "Keep in review",
        tone: "warning"
      });
      if (!confirmed) return;
      confirmUnresolvedReviews = true;
    }
    phaseTransitionMutation.mutate({ nextPhase, confirmUnresolvedReviews });
  };

  const toggleTaskCreateAssignee = (userId: string) => {
    setTaskAssigneeIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  };

  const addTaskCreateLabel = () => {
    const name = taskNewLabelName.trim();
    if (!name || taskLabels.some((label) => label.name.toLowerCase() === name.toLowerCase()) || taskLabels.length >= 12) return;
    setTaskLabels((current) => [...current, { name, color: taskNewLabelColor }]);
    setTaskNewLabelName("");
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
          onClick={() => selectTab("overview")}
        >
          Overview
        </button>
        <button
          className={activeTab === "tasks" ? "tab-button active" : "tab-button"}
          onClick={() => selectTab("tasks")}
        >
          Task board ({tasksQuery.data?.meta.total ?? 0})
        </button>
        <button
          className={activeTab === "deliverables" ? "tab-button active" : "tab-button"}
          onClick={() => selectTab("deliverables")}
        >
          Deliverables
        </button>
        <button
          className={activeTab === "files" ? "tab-button active" : "tab-button"}
          onClick={() => selectTab("files")}
        >
          Files ({filesQuery.data?.meta.total ?? 0})
        </button>
        <button
          className={activeTab === "activity" ? "tab-button active" : "tab-button"}
          onClick={() => selectTab("activity")}
        >
          Activity ({activityQuery.data?.data.length ?? 0})
        </button>
        <button
          className={activeTab === "team" ? "tab-button active" : "tab-button"}
          onClick={() => selectTab("team")}
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
            {canWriteTask ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => { setFormError(null); setPhase(project.current_phase as TaskPhase); setTaskCreateOpen(true); }}>New task</Button> : <p className="muted">You have read-only task access.</p>}
          </div>

          {selectedTaskIds.length > 0 ? <div className="selection-toolbar">
            <strong>{selectedTaskIds.length} selected</strong>
            <select
              value={bulkTaskAction}
              aria-label="Bulk task action"
              onChange={(event) => { setBulkTaskAction(event.target.value as typeof bulkTaskAction); setBulkError(null); }}
              disabled={!canWriteTask}
            >
              <option value="">Bulk action</option>
              <option value="start">Start selected</option>
              <option value="complete">Complete selected</option>
              <option value="assign">Assign to one person</option>
              <option value="phase">Move to phase</option>
              <option value="priority">Set priority</option>
              <option value="label">Add label</option>
              <option value="delete">Delete selected</option>
            </select>
            {bulkTaskAction === "assign" ? <select aria-label="Assign selected tasks" value={bulkAssigneeId} onChange={(event) => setBulkAssigneeId(event.target.value)}><option value="">Choose team member</option>{assignableProjectMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.user_name}</option>)}</select> : null}
            {bulkTaskAction === "phase" ? <select aria-label="Move selected tasks to phase" value={bulkPhase} onChange={(event) => setBulkPhase(event.target.value as TaskPhase)}>{taskPhases.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : null}
            {bulkTaskAction === "priority" ? <select aria-label="Set selected task priority" value={bulkPriority} onChange={(event) => setBulkPriority(event.target.value as typeof bulkPriority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select> : null}
            {bulkTaskAction === "label" ? <><input aria-label="Label selected tasks" placeholder="Label name" maxLength={50} value={bulkLabelName} onChange={(event) => setBulkLabelName(event.target.value)} /><select aria-label="Bulk label color" value={bulkLabelColor} onChange={(event) => setBulkLabelColor(event.target.value as TaskLabelColor)}>{taskLabelColors.map((color) => <option key={color.id} value={color.id}>{color.label}</option>)}</select></> : null}
            <button
              type="button"
              className="ghost-button"
              onClick={applyBulkTaskAction}
              disabled={
                !canWriteTask ||
                !bulkTaskAction ||
                selectedTaskIds.length === 0 ||
                bulkDeleteMutation.isPending ||
                bulkStatusMutation.isPending ||
                bulkUpdateMutation.isPending
              }
            >
              Apply
            </button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedTaskIds([])}>Cancel</Button>
            {bulkError ? <p className="error-text" role="alert">{bulkError}</p> : null}
          </div> : null}

          <Dialog
            open={taskCreateOpen}
            onOpenChange={(open) => open ? setTaskCreateOpen(true) : void requestCloseTaskCreate()}
            title="Create a task"
            description="Define the work, owners, timing, and output before it enters the board."
            size="lg"
            footer={<div className="inline-actions"><Button variant="ghost" onClick={() => void requestCloseTaskCreate()}>Cancel</Button><Button variant="primary" type="submit" form="create-project-task-form" icon={<Plus size={16} />} disabled={!taskCreateValid || createTaskMutation.isPending}>{createTaskMutation.isPending ? "Creating…" : "Create task"}</Button></div>}
          >
            <form id="create-project-task-form" className="modal-form" onSubmit={(event) => {
              event.preventDefault();
              if (!taskCreateValid) return;
              const deliverable = taskDeliverableMode === "existing"
                ? { mode: "existing" as const, deliverableId: taskDeliverableId }
                : taskDeliverableMode === "new"
                  ? { mode: "new" as const, title: taskDeliverableTitle.trim() }
                  : undefined;
              createTaskMutation.mutate({
                title: title.trim(),
                description: taskDescription.trim() || null,
                phase,
                priority: taskPriority,
                dueDate: taskDueDate || null,
                assigneeIds: taskAssigneeIds,
                labels: taskLabels,
                deliverableRequired: taskDeliverableRequired || Boolean(deliverable),
                deliverable
              });
            }}>
              <label className="field"><span>Task title</span><input autoFocus placeholder="e.g. Prepare campaign storyboard" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label className="field"><span>Description <small>Optional</small></span><textarea rows={3} placeholder="Add context, acceptance criteria, or links the team needs." value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} /></label>
              <div className="modal-form-row">
                <label className="field"><span>Starting phase</span><select value={phase} onChange={(event) => setPhase(event.target.value as TaskPhase)}>
                  {taskPhases.map((phaseOption) => <option key={phaseOption.id} value={phaseOption.id}>{phaseOption.label}</option>)}
                </select><small>Defaults to the project’s current phase.</small></label>
                <label className="field"><span>Priority</span><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as typeof taskPriority)}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                </select></label>
              </div>
              <label className="field"><span>Due date <small>Optional</small></span><input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /></label>

              <div className="field task-assignee-field">
                <span>Assignees <small>{taskAssigneeIds.length ? `${taskAssigneeIds.length} selected` : "Optional"}</small></span>
                <div className="task-assignee-options task-create-assignee-options" role="group" aria-label="Choose task assignees">
                  {assignableProjectMembers.map((member) => (
                    <label key={member.user_id} className="task-assignee-option">
                      <input type="checkbox" checked={taskAssigneeIds.includes(member.user_id)} onChange={() => toggleTaskCreateAssignee(member.user_id)} />
                      <span className="avatar avatar-fallback">{member.user_name.slice(0, 1).toUpperCase()}</span>
                      <span><strong>{member.user_name}</strong><small>{formatLabel(member.role)} · {member.open_task_count} open task{member.open_task_count === "1" ? "" : "s"}</small></span>
                    </label>
                  ))}
                  {!teamQuery.isLoading && assignableProjectMembers.length === 0 ? <p className="muted">Add staff to this project’s Team before assigning the task.</p> : null}
                </div>
              </div>

              <div className="field task-label-field">
                <span>Labels <small>Optional</small></span>
                <div className="task-label-editor">
                  <div className="task-label-selection">
                    {taskLabels.length ? taskLabels.map((label) => (
                      <span key={label.name} className={`task-label task-label-${label.color}`}>
                        {label.name}
                        <button type="button" aria-label={`Remove ${label.name} label`} onClick={() => setTaskLabels((current) => current.filter((item) => item.name !== label.name))}>×</button>
                      </span>
                    )) : <span className="task-picker-placeholder">No custom labels</span>}
                  </div>
                  <div className="task-label-create">
                    <input aria-label="New task label" maxLength={50} placeholder="Add a label" value={taskNewLabelName} onChange={(event) => setTaskNewLabelName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTaskCreateLabel(); } }} />
                    <select aria-label="New task label color" value={taskNewLabelColor} onChange={(event) => setTaskNewLabelColor(event.target.value as TaskLabelColor)}>{taskLabelColors.map((color) => <option key={color.id} value={color.id}>{color.label}</option>)}</select>
                    <Button variant="secondary" size="sm" type="button" disabled={!taskNewLabelName.trim() || taskLabels.length >= 12} onClick={addTaskCreateLabel}>Add label</Button>
                  </div>
                </div>
              </div>
              <div className="task-deliverable-create-option">
                <div className="task-deliverable-option-heading">
                  <FileCheck2 size={17} aria-hidden="true" />
                  <div><strong>Deliverable <span>Optional</span></strong><p>Connect the work output now, or add it later from task details.</p></div>
                </div>
                <label className="field"><span>How should this task connect?</span><select value={taskDeliverableMode} onChange={(event) => {
                  setTaskDeliverableMode(event.target.value as "none" | "existing" | "new");
                  setTaskDeliverableId("");
                  setTaskDeliverableTitle("");
                  if (event.target.value !== "none") setTaskDeliverableRequired(true);
                }}>
                  <option value="none">No deliverable yet</option>
                  <option value="existing">Link an existing deliverable</option>
                  <option value="new">Create a deliverable placeholder</option>
                </select></label>
                {taskDeliverableMode === "existing" ? (
                  <label className="field"><span>Existing deliverable</span><select value={taskDeliverableId} onChange={(event) => setTaskDeliverableId(event.target.value)}>
                    <option value="">Select a deliverable</option>
                    {availableDeliverables.map((deliverable) => <option key={deliverable.id} value={deliverable.id}>{deliverable.title} · {formatLabel(deliverable.status)}</option>)}
                  </select>{!deliverablesQuery.isLoading && !availableDeliverables.length ? <small>No deliverables exist yet. Choose “Create a deliverable placeholder” instead.</small> : null}</label>
                ) : null}
                {taskDeliverableMode === "new" ? (
                  <label className="field"><span>Deliverable title</span><input placeholder="e.g. Final campaign storyboard" value={taskDeliverableTitle} onChange={(event) => setTaskDeliverableTitle(event.target.value)} /></label>
                ) : null}
                <label className="task-deliverable-requirement">
                  <input type="checkbox" checked={taskDeliverableRequired} onChange={(event) => setTaskDeliverableRequired(event.target.checked)} />
                  <span><strong>Require a deliverable for completion</strong><small>The task completes only when work is submitted for internal approval.</small></span>
                </label>
              </div>
              {formError ? <p className="error-text" role="alert">{formError}</p> : null}
            </form>
          </Dialog>

          <label className="mobile-task-phase-selector">
            <span>Task phase</span>
            <select value={mobileTaskPhase} onChange={(event) => setMobileTaskPhase(event.target.value as TaskPhase)}>
              {taskPhases.map((phaseOption) => <option key={phaseOption.id} value={phaseOption.id}>{phaseOption.label} ({displayedTasks.filter((task) => task.phase === phaseOption.id).length})</option>)}
            </select>
          </label>

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
              <div className="task-kanban-board" data-mobile-active-phase={mobileTaskPhase} aria-label={`${project.name} task board`}>
                {taskPhases.map((phaseOption) => (
                  <TaskPhaseColumn
                    key={phaseOption.id}
                    phase={phaseOption}
                    tasks={displayedTasks.filter((task) => task.phase === phaseOption.id)}
                    canWrite={canWriteTask}
                    selectedTaskIds={selectedTaskIds}
                    onToggleSelected={toggleTaskSelection}
                    onOpenTask={openTaskDetails}
                    onStatusChange={(taskId, status) => statusMutation.mutate({ taskId, status })}
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
              if (!open) void requestCloseTaskDetails();
            }}
            title={selectedTask?.title ?? "Task details"}
            description="Review the task, update its ownership and timing, or leave a comment."
            size="lg"
            footer={selectedTask ? (
              <div className="inline-actions">
                <Button variant="ghost" onClick={() => void requestCloseTaskDetails()}>Close</Button>
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
                    updateTaskMutation.mutate({
                      taskId: selectedTask.id,
                      assigneeIds: selectedTaskDraft.assigneeIds,
                      dueDate: selectedTaskDraft.dueDate,
                      priority: selectedTaskDraft.priority,
                      labels: selectedTaskDraft.labels,
                      deliverableRequired: selectedTaskDraft.deliverableRequired
                    });
                  }}
                >
                  <div className="field task-assignee-field">
                    <span>Assignees <small>{selectedTaskDraft.assigneeIds.length || "None"} selected</small></span>
                    <div className="task-assignee-picker">
                      <div className="task-assignee-selection">
                        {selectedTaskDraft.assigneeIds.length ? selectedTaskDraft.assigneeIds.map((userId) => {
                          const member = assignableProjectMembers.find((candidate) => candidate.user_id === userId);
                          const existingAssignee = selectedTask.assignees.find((candidate) => candidate.id === userId);
                          const user = member
                            ? { id: member.user_id, name: member.user_name }
                            : existingAssignee;
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
                          {assignableProjectMembers.map((member) => (
                            <label key={member.user_id} className="task-assignee-option">
                              <input type="checkbox" checked={selectedTaskDraft.assigneeIds.includes(member.user_id)} onChange={() => toggleTaskAssignee(member.user_id)} />
                              <span className="avatar avatar-fallback">{member.user_name.slice(0, 1).toUpperCase()}</span>
                              <span><strong>{member.user_name}</strong><small>{formatLabel(member.role)} · {member.user_email}</small></span>
                            </label>
                          ))}
                          {!teamQuery.isLoading && assignableProjectMembers.length === 0 ? <p className="muted">Add staff to the project Team before assigning this task.</p> : null}
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
                  <label className="task-deliverable-requirement">
                    <input
                      type="checkbox"
                      checked={selectedTaskDraft.deliverableRequired}
                      onChange={(event) => setTaskDrafts((previous) => ({
                        ...previous,
                        [selectedTask.id]: { ...selectedTaskDraft, deliverableRequired: event.target.checked }
                      }))}
                      disabled={!canWriteTask}
                    />
                    <span><strong>Deliverable required</strong><small>Completion is recorded when a linked deliverable enters internal review.</small></span>
                  </label>
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
                  {taskDetailError ? <p className="error-text" role="alert">{taskDetailError}</p> : null}
                </form>

                <section className="task-detail-deliverables" aria-labelledby="task-deliverables-title">
                  <div className="task-detail-deliverables-heading">
                    <div className="task-detail-section-title">
                      <FileCheck2 size={17} aria-hidden="true" />
                      <div><h3 id="task-deliverables-title">Deliverables</h3><p>The submitted output that proves this task is complete.</p></div>
                    </div>
                    {canWriteTask ? <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setTaskDeliverableDialogOpen(true)}>Add deliverable</Button> : null}
                  </div>
                  {selectedTask.deliverables.length ? (
                    <div className="task-deliverable-list">
                      {selectedTask.deliverables.map((deliverable) => (
                        <article key={deliverable.id} className="task-deliverable-row">
                          <div className="deliverable-icon"><FileCheck2 size={16} aria-hidden="true" /></div>
                          <div><strong>{deliverable.title}</strong><p>{formatLabel(deliverable.status)}{deliverable.latest_version_number ? ` · Version ${deliverable.latest_version_number}` : " · Awaiting first version"}</p></div>
                          <Button variant="ghost" size="sm" onClick={() => void openDeliverablesFromTask()}>Open</Button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="task-deliverable-empty"><p>No deliverable connected yet.</p><span>You can link existing work or create a placeholder without leaving this task.</span></div>
                  )}
                  <p className="task-completion-note">The task completes automatically when a linked deliverable version is submitted for internal approval.</p>
                </section>

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

          <Dialog
            open={taskDeliverableDialogOpen}
            onOpenChange={(open) => {
              if (open) setTaskDeliverableDialogOpen(true);
              else void requestCloseTaskDeliverableDialog();
            }}
            title="Add a deliverable"
            description={`Connect the output that will complete ${selectedTask?.title ?? "this task"}.`}
            footer={<div className="inline-actions"><Button variant="ghost" onClick={() => void requestCloseTaskDeliverableDialog()}>Cancel</Button><Button variant="primary" type="submit" form="attach-task-deliverable-form" icon={<FileCheck2 size={16} />} disabled={!selectedTask || attachTaskDeliverableMutation.isPending || (detailDeliverableMode === "existing" ? !detailDeliverableId : !detailDeliverableTitle.trim())}>{attachTaskDeliverableMutation.isPending ? "Connecting…" : "Connect deliverable"}</Button></div>}
          >
            <form id="attach-task-deliverable-form" className="modal-form" onSubmit={(event) => {
              event.preventDefault();
              if (!selectedTask) return;
              const selection: DeliverableSelection = detailDeliverableMode === "existing"
                ? { mode: "existing", deliverableId: detailDeliverableId }
                : { mode: "new", title: detailDeliverableTitle.trim() };
              attachTaskDeliverableMutation.mutate({ taskId: selectedTask.id, selection });
            }}>
              <label className="field"><span>Connection</span><select value={detailDeliverableMode} onChange={(event) => {
                setDetailDeliverableMode(event.target.value as "existing" | "new");
                setDetailDeliverableId("");
                setDetailDeliverableTitle("");
              }}><option value="existing">Link an existing deliverable</option><option value="new">Create a deliverable placeholder</option></select></label>
              {detailDeliverableMode === "existing" ? (
                <label className="field"><span>Existing deliverable</span><select value={detailDeliverableId} onChange={(event) => setDetailDeliverableId(event.target.value)}><option value="">Select a deliverable</option>{unlinkedDeliverables.map((deliverable) => <option key={deliverable.id} value={deliverable.id}>{deliverable.title} · {formatLabel(deliverable.status)}</option>)}</select>{!deliverablesQuery.isLoading && !unlinkedDeliverables.length ? <small>Every current deliverable is already linked. Create a new placeholder instead.</small> : null}</label>
              ) : (
                <label className="field"><span>Deliverable title</span><input autoFocus placeholder="e.g. Approved social media artwork" value={detailDeliverableTitle} onChange={(event) => setDetailDeliverableTitle(event.target.value)} /></label>
              )}
              <p className="task-completion-note">Creating a placeholder does not complete the task. Submitting its first version for internal approval does.</p>
              {detailDeliverableError ? <p className="error-text" role="alert">{detailDeliverableError}</p> : null}
            </form>
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
          canSupervise={canUpdateProject}
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
            {canManageTeam ? <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => { setTeamFormError(null); setTeamMemberDialogOpen(true); }}>Add team member</Button> : <p className="muted">Only owners and managers can manage this team.</p>}
          </div>

          <Dialog
            open={teamMemberDialogOpen}
            onOpenChange={(open) => open ? setTeamMemberDialogOpen(true) : void requestCloseTeamMemberDialog()}
            title="Add a team member"
            description="Choose a staff member and the access level they should have on this project."
            footer={<div className="inline-actions"><Button variant="ghost" onClick={() => void requestCloseTeamMemberDialog()}>Cancel</Button><Button variant="primary" type="submit" form="add-project-team-member-form" icon={<UserPlus size={16} />} disabled={!teamUserId || addTeamMemberMutation.isPending}>{addTeamMemberMutation.isPending ? "Adding…" : "Add member"}</Button></div>}
          >
            <form id="add-project-team-member-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); if (teamUserId) addTeamMemberMutation.mutate({ userId: teamUserId, role: teamRole }); }}>
              <label className="field"><span>Staff member</span><select autoFocus value={teamUserId} onChange={(event) => setTeamUserId(event.target.value)} disabled={usersQuery.isLoading}>
                <option value="">Select user</option>
                {availableTeamUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>{!usersQuery.isLoading && availableTeamUsers.length === 0 ? <small>Every active staff member is already on this project.</small> : null}</label>
              <label className="field"><span>Project role</span><select value={teamRole} onChange={(event) => setTeamRole(event.target.value as "manager" | "member" | "viewer")}>
                <option value="manager">Supervisor / project manager — approve work and manage team</option>
                <option value="member">Member — create and update work</option>
                <option value="viewer">Viewer — read-only access</option>
              </select></label>
              {teamFormError ? <p className="error-text" role="alert">{teamFormError}</p> : null}
            </form>
          </Dialog>

          {teamActionError ? <p className="board-error" role="alert">{teamActionError}</p> : null}
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
                    <th>Workload</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teamQuery.data?.data.map((member) => (
                    <tr key={member.user_id}>
                      <td>{member.user_name}</td>
                      <td>{member.user_email}</td>
                      <td>
                        {member.role === "owner" ? (
                          <span className="role-badge role-owner">Project owner</span>
                        ) : canManageTeam ? (
                          <select
                            className="team-role-select"
                            aria-label={`Project role for ${member.user_name}`}
                            title={member.role === "manager" && supervisorCount <= 1 ? "A project must retain at least one supervisor." : "Change project role"}
                            value={member.role}
                            disabled={updateTeamRoleMutation.isPending || (member.role === "manager" && supervisorCount <= 1)}
                            onChange={(event) => updateTeamRoleMutation.mutate({ userId: member.user_id, role: event.target.value as "manager" | "member" | "viewer" })}
                          >
                            <option value="manager">Supervisor / manager</option>
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : <span className="role-badge">{formatLabel(member.role)}</span>}
                      </td>
                      <td>
                        <div className="team-workload" aria-label={`${member.open_task_count} open tasks, ${member.overdue_task_count} overdue`}>
                          <strong>{member.open_task_count}</strong><span>open</span>
                          {Number(member.overdue_task_count) > 0 ? <span className="team-workload-overdue">{member.overdue_task_count} overdue</span> : null}
                        </div>
                      </td>
                      <td>{new Date(member.created_at).toLocaleString()}</td>
                      <td>
                        {canManageTeam && member.role !== "owner" ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => handleRemoveTeamMember(member)}
                            title={Number(member.assigned_task_count) > 0 ? "Reassign this member’s tasks before removing them." : member.role === "manager" && supervisorCount <= 1 ? "A project must retain at least one supervisor." : "Remove from project"}
                            disabled={removeTeamMemberMutation.isPending || Number(member.assigned_task_count) > 0 || (member.role === "manager" && supervisorCount <= 1)}
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

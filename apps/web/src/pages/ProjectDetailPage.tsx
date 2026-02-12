import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";

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
  phase: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
};

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

type DownloadUrlResponse = {
  data: {
    downloadUrl: string;
  };
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

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "tasks" | "files" | "activity" | "team">("overview");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState("production");
  const [formError, setFormError] = useState<string | null>(null);
  const [phaseReason, setPhaseReason] = useState("");
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [taskDrafts, setTaskDrafts] = useState<Record<string, { assignedTo: string; dueDate: string }>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [fileLinkName, setFileLinkName] = useState("");
  const [fileLinkUrl, setFileLinkUrl] = useState("");
  const [fileLinkType, setFileLinkType] = useState("asset");
  const [fileLinkStorage, setFileLinkStorage] = useState("google_drive");
  const [fileFormError, setFileFormError] = useState<string | null>(null);
  const [teamUserId, setTeamUserId] = useState("");
  const [teamRole, setTeamRole] = useState<"manager" | "member" | "viewer">("member");
  const [teamFormError, setTeamFormError] = useState<string | null>(null);

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
    mutationFn: (payload: { title: string; phase: string }) =>
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
    onSuccess: refreshData
  });

  const updateTaskMutation = useMutation({
    mutationFn: (input: { taskId: string; assignedTo: string; dueDate: string }) =>
      apiRequest(`/tasks/${input.taskId}`, {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: {
          assignedTo: input.assignedTo ? input.assignedTo : null,
          dueDate: input.dueDate ? input.dueDate : null
        }
      }),
    onSuccess: refreshData
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
    onSuccess: refreshData
  });

  const openFileMutation = useMutation({
    mutationFn: async (file: ProjectFile) => {
      if (file.external_url) {
        window.open(file.external_url, "_blank", "noopener,noreferrer");
        return;
      }

      const result = await apiRequest<DownloadUrlResponse>(`/files/${file.id}/download-url`, {
        accessToken: accessToken ?? undefined
      });
      window.open(result.data.downloadUrl, "_blank", "noopener,noreferrer");
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
    onSuccess: refreshData
  });

  const phaseTransitionMutation = useMutation({
    mutationFn: (nextPhase: string) =>
      apiRequest(`/projects/${projectId}/phase`, {
        method: "PATCH",
        accessToken: accessToken ?? undefined,
        body: {
          phase: nextPhase,
          reason: phaseReason.trim() ? phaseReason.trim() : null
        }
      }),
    onSuccess: async () => {
      setPhaseReason("");
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
    }
  });

  useEffect(() => {
    if (!tasksQuery.data?.data) return;
    setTaskDrafts((previous) => {
      const next = { ...previous };
      for (const task of tasksQuery.data.data) {
        if (!next[task.id]) {
          next[task.id] = {
            assignedTo: task.assigned_to ?? "",
            dueDate: task.due_date ? task.due_date.slice(0, 10) : ""
          };
        }
      }
      return next;
    });
  }, [tasksQuery.data]);

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

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>{project.name}</h2>
          <p className="muted">{project.client_name}</p>
        </div>
        <p className="badge">{project.current_user_role ?? "n/a"}</p>
      </div>

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
          Tasks
        </button>
        <button
          className={activeTab === "files" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("files")}
        >
          Files
        </button>
        <button
          className={activeTab === "activity" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("activity")}
        >
          Activity
        </button>
        <button
          className={activeTab === "team" ? "tab-button active" : "tab-button"}
          onClick={() => setActiveTab("team")}
        >
          Team
        </button>
      </div>

      {activeTab === "overview" ? (
        <div className="tasks-pane">
          <div className="kpi-grid">
            <article className="card">
              <p className="eyebrow">Phase</p>
              <p className="kpi-value short">{project.current_phase}</p>
            </article>
            <article className="card">
              <p className="eyebrow">Priority</p>
              <p className="kpi-value short">{project.priority}</p>
            </article>
            <article className="card">
              <p className="eyebrow">Deadline</p>
              <p className="kpi-value short">{project.deadline}</p>
            </article>
            <article className="card">
              <p className="eyebrow">Tasks</p>
              <p className="kpi-value">{project.task_summary.total}</p>
              <p className="muted">
                pending {project.task_summary.pending} / in-progress {project.task_summary.in_progress} / done{" "}
                {project.task_summary.completed}
              </p>
            </article>
          </div>
          <article className="card task-create-form">
            <h3>Project phase transition</h3>
            <p className="muted">
              Current phase: <strong>{project.current_phase}</strong>
            </p>
            <div className="task-form-grid">
              <input
                placeholder="Reason (optional)"
                value={phaseReason}
                onChange={(event) => setPhaseReason(event.target.value)}
                disabled={!canUpdateProject || !nextPhase}
              />
              <input value={nextPhase ?? "No next phase"} disabled />
              <button
                type="button"
                className="primary-button"
                disabled={!canUpdateProject || !nextPhase || phaseTransitionMutation.isPending}
                onClick={() => {
                  if (!nextPhase) return;
                  phaseTransitionMutation.mutate(nextPhase);
                }}
              >
                Move to next phase
              </button>
            </div>
            {!canUpdateProject ? <p className="muted">Only owner/manager can change project phase.</p> : null}
            {!nextPhase ? <p className="muted">Project is already at the final phase.</p> : null}
            {phaseError ? <p className="error-text">{phaseError}</p> : null}
          </article>
        </div>
      ) : activeTab === "tasks" ? (
        <div className="tasks-pane">
          <form
            className="card task-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim()) return;
              createTaskMutation.mutate({ title: title.trim(), phase });
            }}
          >
            <h3>Create task</h3>
            <div className="task-form-grid">
              <input
                placeholder="Task title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={!canWriteTask}
              />
              <select value={phase} onChange={(event) => setPhase(event.target.value)} disabled={!canWriteTask}>
                <option value="client_acquisition">client_acquisition</option>
                <option value="strategy_planning">strategy_planning</option>
                <option value="production">production</option>
                <option value="post_production">post_production</option>
                <option value="delivery">delivery</option>
              </select>
              <button className="primary-button" type="submit" disabled={!canWriteTask || createTaskMutation.isPending}>
                Add task
              </button>
            </div>
            {!canWriteTask ? <p className="muted">You have read-only task access.</p> : null}
            {formError ? <p className="error-text">{formError}</p> : null}
          </form>

          <div className="card table-wrap">
            {tasksQuery.isLoading ? (
              <p>Loading tasks...</p>
            ) : tasksQuery.isError ? (
              <p>Could not load tasks.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Phase</th>
                    <th>Status</th>
                    <th>Assignee</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasksQuery.data?.data.map((task) => (
                    <tr key={task.id}>
                      <td>{task.title}</td>
                      <td>{task.phase}</td>
                      <td>{task.status}</td>
                      <td>
                        <select
                          value={taskDrafts[task.id]?.assignedTo ?? ""}
                          onChange={(event) =>
                            setTaskDrafts((previous) => ({
                              ...previous,
                              [task.id]: {
                                assignedTo: event.target.value,
                                dueDate: previous[task.id]?.dueDate ?? (task.due_date ? task.due_date.slice(0, 10) : "")
                              }
                            }))
                          }
                          disabled={!canWriteTask}
                        >
                          <option value="">Unassigned</option>
                          {usersQuery.data?.data.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{task.priority}</td>
                      <td>
                        <input
                          type="date"
                          value={taskDrafts[task.id]?.dueDate ?? ""}
                          onChange={(event) =>
                            setTaskDrafts((previous) => ({
                              ...previous,
                              [task.id]: {
                                assignedTo: previous[task.id]?.assignedTo ?? (task.assigned_to ?? ""),
                                dueDate: event.target.value
                              }
                            }))
                          }
                          disabled={!canWriteTask}
                        />
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={!canWriteTask || updateTaskMutation.isPending}
                            onClick={() =>
                              updateTaskMutation.mutate({
                                taskId: task.id,
                                assignedTo: taskDrafts[task.id]?.assignedTo ?? "",
                                dueDate: taskDrafts[task.id]?.dueDate ?? ""
                              })
                            }
                          >
                            Save
                          </button>
                          {getStatusActions(task.status).map((action) => (
                            <button
                              type="button"
                              key={`${task.id}-${action.status}`}
                              className="ghost-button"
                              disabled={!canWriteTask || statusMutation.isPending}
                              onClick={() => statusMutation.mutate({ taskId: task.id, status: action.status })}
                            >
                              {action.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => setSelectedTaskId((previous) => (previous === task.id ? null : task.id))}
                          >
                            Comments
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selectedTaskId ? (
            <div className="card">
              <h3>Task comments</h3>
              {canWriteTask ? (
                <form
                  className="comment-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!commentBody.trim()) return;
                    createCommentMutation.mutate({ taskId: selectedTaskId, body: commentBody.trim() });
                  }}
                >
                  <input
                    placeholder="Add comment"
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                  />
                  <button className="primary-button" type="submit" disabled={createCommentMutation.isPending}>
                    Add
                  </button>
                </form>
              ) : null}
              <div className="activity-list">
                {commentsQuery.isLoading ? (
                  <p>Loading comments...</p>
                ) : commentsQuery.isError ? (
                  <p>Could not load comments.</p>
                ) : commentsQuery.data?.data.length ? (
                  commentsQuery.data.data.map((comment) => (
                    <article key={comment.id} className="activity-item">
                      <p>{comment.body}</p>
                      <p className="muted">{new Date(comment.created_at).toLocaleString()}</p>
                      {canWriteTask ? (
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => deleteCommentMutation.mutate({ taskId: selectedTaskId, commentId: comment.id })}
                            disabled={deleteCommentMutation.isPending}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="muted">No comments yet.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : activeTab === "files" ? (
        <div className="tasks-pane">
          <form
            className="card task-create-form"
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
            <h3>Link external file</h3>
            <div className="task-form-grid files-grid">
              <input
                placeholder="File name"
                value={fileLinkName}
                onChange={(event) => setFileLinkName(event.target.value)}
                disabled={!canWriteFile}
              />
              <select value={fileLinkType} onChange={(event) => setFileLinkType(event.target.value)} disabled={!canWriteFile}>
                <option value="client_profile">client_profile</option>
                <option value="proposal">proposal</option>
                <option value="creative_brief">creative_brief</option>
                <option value="nda">nda</option>
                <option value="contract">contract</option>
                <option value="asset">asset</option>
                <option value="deliverable">deliverable</option>
                <option value="other">other</option>
              </select>
              <select value={fileLinkStorage} onChange={(event) => setFileLinkStorage(event.target.value)} disabled={!canWriteFile}>
                <option value="google_drive">google_drive</option>
                <option value="dropbox">dropbox</option>
                <option value="onedrive">onedrive</option>
              </select>
              <input
                placeholder="https://..."
                value={fileLinkUrl}
                onChange={(event) => setFileLinkUrl(event.target.value)}
                disabled={!canWriteFile}
              />
              <button
                className="primary-button"
                type="submit"
                disabled={!canWriteFile || createFileLinkMutation.isPending}
              >
                Add link
              </button>
            </div>
            {!canWriteFile ? <p className="muted">You have read-only file access.</p> : null}
            {fileFormError ? <p className="error-text">{fileFormError}</p> : null}
          </form>

          <div className="card table-wrap">
            {filesQuery.isLoading ? (
              <p>Loading files...</p>
            ) : filesQuery.isError ? (
              <p>Could not load files.</p>
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
                      <td>{file.file_type}</td>
                      <td>{file.storage_type}</td>
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
                              onClick={() => deleteFileMutation.mutate(file.id)}
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
                    <p className="notice-title">{entry.action}</p>
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
          <form
            className="card task-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!teamUserId) return;
              addTeamMemberMutation.mutate({ userId: teamUserId, role: teamRole });
            }}
          >
            <h3>Add team member</h3>
            <div className="task-form-grid">
              <select
                value={teamUserId}
                onChange={(event) => setTeamUserId(event.target.value)}
                disabled={!canManageTeam || usersQuery.isLoading}
              >
                <option value="">Select user</option>
                {usersQuery.data?.data.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
              <select
                value={teamRole}
                onChange={(event) => setTeamRole(event.target.value as "manager" | "member" | "viewer")}
                disabled={!canManageTeam}
              >
                <option value="manager">manager</option>
                <option value="member">member</option>
                <option value="viewer">viewer</option>
              </select>
              <button className="primary-button" type="submit" disabled={!canManageTeam || addTeamMemberMutation.isPending}>
                Save member
              </button>
            </div>
            {!canManageTeam ? <p className="muted">Only owner/manager can manage team.</p> : null}
            {teamFormError ? <p className="error-text">{teamFormError}</p> : null}
          </form>

          <div className="card table-wrap">
            {teamQuery.isLoading ? (
              <p>Loading team...</p>
            ) : teamQuery.isError ? (
              <p>Could not load team.</p>
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
                      <td>{member.role}</td>
                      <td>{new Date(member.created_at).toLocaleString()}</td>
                      <td>
                        {canManageTeam ? (
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => removeTeamMemberMutation.mutate(member.user_id)}
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

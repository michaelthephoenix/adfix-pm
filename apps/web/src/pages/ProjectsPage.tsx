import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, Check, Plus, Users } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { ErrorState, LoadingState } from "../components/States";

type Project = {
  id: string;
  name: string;
  client_name: string;
  current_phase: string;
  priority: string;
  deadline: string;
  current_user_role: "owner" | "manager" | "member" | "viewer" | null;
};

type ProjectsResponse = {
  data: Project[];
  meta: {
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: string;
    total: number;
  };
};

type ClientsResponse = {
  data: Array<{
    id: string;
    name: string;
  }>;
};

type UsersResponse = {
  data: Array<{
    id: string;
    name: string;
    email: string;
  }>;
};

const createSteps = [
  { label: "Client", description: "Choose who this work is for" },
  { label: "Project", description: "Name and describe the work" },
  { label: "Schedule", description: "Set priority and delivery dates" },
  { label: "Team", description: "Assign the initial project team" }
] as const;

function toIsoDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ProjectsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clientSelection, setClientSelection] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientCompany, setNewClientCompany] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(toIsoDateString(new Date()));
  const [deadline, setDeadline] = useState(
    toIsoDateString(new Date(Date.now() + 1000 * 60 * 60 * 24 * 30))
  );
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");
  const [teamUserId, setTeamUserId] = useState("");
  const [teamRole, setTeamRole] = useState<"manager" | "member" | "viewer">("member");
  const [teamAssignments, setTeamAssignments] = useState<Array<{ userId: string; role: "manager" | "member" | "viewer" }>>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState(0);

  const listPage = Number(searchParams.get("page") ?? "1") || 1;
  const listSortBy = searchParams.get("sortBy") ?? "updatedAt";
  const listSortOrder = searchParams.get("sortOrder") ?? "desc";
  const listClientId = searchParams.get("clientId") ?? "";
  const listPhase = searchParams.get("phase") ?? "";
  const listPriority = searchParams.get("priority") ?? "";

  const listQueryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(listPage),
      pageSize: "100",
      sortBy: listSortBy,
      sortOrder: listSortOrder
    });
    if (listClientId) params.set("clientId", listClientId);
    if (listPhase) params.set("phase", listPhase);
    if (listPriority) params.set("priority", listPriority);
    return params.toString();
  }, [listClientId, listPage, listPhase, listPriority, listSortBy, listSortOrder]);

  const projectsQuery = useQuery({
    queryKey: ["projects", listQueryString],
    queryFn: () =>
      apiRequest<ProjectsResponse>(`/projects?${listQueryString}`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const clientsQuery = useQuery({
    queryKey: ["clients-for-project-form"],
    queryFn: () =>
      apiRequest<ClientsResponse>("/clients?page=1&pageSize=100&sortBy=name&sortOrder=asc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const usersQuery = useQuery({
    queryKey: ["users-for-project-create"],
    queryFn: () =>
      apiRequest<UsersResponse>("/users?page=1&pageSize=100&sortBy=name&sortOrder=asc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const creatingNewClient = clientSelection === "__new__";
  const deadlineIsValid = !startDate || !deadline || deadline >= startDate;

  const canSubmit = useMemo(() => {
    const hasClient = creatingNewClient ? Boolean(newClientName.trim()) : Boolean(clientSelection);
    return Boolean(hasClient && name.trim() && startDate && deadline && deadlineIsValid);
  }, [clientSelection, creatingNewClient, deadline, deadlineIsValid, name, newClientName, startDate]);

  const selectedClientName = creatingNewClient
    ? newClientName.trim() || "New client"
    : clientsQuery.data?.data.find((client) => client.id === clientSelection)?.name ?? "Not selected";

  const createStepIsValid = [
    creatingNewClient ? Boolean(newClientName.trim()) : Boolean(clientSelection),
    Boolean(name.trim()),
    Boolean(startDate && deadline && deadlineIsValid),
    true
  ][createStep];

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      const createdProject = await apiRequest<{ data: { id: string } }>("/projects/setup", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          clientId: creatingNewClient ? undefined : clientSelection,
          newClient: creatingNewClient ? {
            name: newClientName.trim(),
            company: newClientCompany.trim() ? newClientCompany.trim() : null
          } : undefined,
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
          startDate,
          deadline,
          priority,
          team: teamAssignments
        }
      });

      return { projectId: createdProject.data.id, projectName: name.trim() };
    },
    onSuccess: async () => {
      setName("");
      setDescription("");
      setPriority("medium");
      setTeamAssignments([]);
      setTeamUserId("");
      setTeamRole("member");
      setClientSelection("");
      setNewClientName("");
      setNewClientCompany("");
      setFormError(null);
      setShowCreate(false);
      setCreateStep(0);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["clients-for-project-form"] })
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.message);
        return;
      }
      setFormError("Could not create project.");
    }
  });

  const handleCreateProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deadlineIsValid) {
      setFormError("Deadline must be on or after the start date.");
      return;
    }
    if (!canSubmit) return;
    createProjectMutation.mutate();
  };

  const addTeamAssignment = () => {
    if (!teamUserId) return;
    setTeamAssignments((previous) => {
      const filtered = previous.filter((item) => item.userId !== teamUserId);
      return [...filtered, { userId: teamUserId, role: teamRole }];
    });
    setTeamUserId("");
    setTeamRole("member");
  };

  const openCreateProject = () => {
    setFormError(null);
    setCreateStep(0);
    setShowCreate(true);
  };

  const handleCreateDialogChange = (open: boolean) => {
    setShowCreate(open);
    if (!open) {
      setCreateStep(0);
      setFormError(null);
    }
  };

  const continueCreateProject = () => {
    if (!createStepIsValid) return;
    setFormError(null);
    setCreateStep((current) => Math.min(current + 1, createSteps.length - 1));
  };

  const setListParam = (key: "page" | "sortBy" | "sortOrder" | "clientId" | "phase" | "priority", value: string) => {
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

  const clearListFilters = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("clientId");
    next.delete("phase");
    next.delete("priority");
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  const setListSort = (value: string) => {
    const [sortByValue, sortOrderValue] = value.split(":");
    const next = new URLSearchParams(searchParams);
    next.set("sortBy", sortByValue);
    next.set("sortOrder", sortOrderValue);
    next.set("page", "1");
    setSearchParams(next, { replace: true });
  };

  if (projectsQuery.isLoading) {
    return <LoadingState message="Loading projects..." />;
  }

  if (projectsQuery.isError) {
    return <ErrorState message="Could not load projects." onRetry={() => void projectsQuery.refetch()} />;
  }

  return (
    <section>
      <PageHeader
        title="Projects"
        description="Open a project to manage its tasks across the five delivery phases."
        meta={<span>{projectsQuery.data?.meta.total ?? 0}</span>}
        actions={<Button variant="primary" icon={<Plus size={15} />} onClick={openCreateProject}>Create project</Button>}
      />

      <Dialog
        open={showCreate}
        onOpenChange={handleCreateDialogChange}
        title="Create a project"
        description={`Step ${createStep + 1} of ${createSteps.length} · ${createSteps[createStep].description}`}
        size="lg"
        footer={
          <div className="dialog-footer-split project-wizard-footer">
            <Button variant="ghost" onClick={() => handleCreateDialogChange(false)}>Cancel</Button>
            <div className="inline-actions">
              {createStep > 0 ? <Button onClick={() => setCreateStep((current) => current - 1)}>Back</Button> : null}
              {createStep < createSteps.length - 1 ? (
                <Button variant="primary" onClick={continueCreateProject} disabled={!createStepIsValid}>Continue</Button>
              ) : (
                <Button variant="primary" type="submit" form="project-create-form" disabled={!canSubmit || createProjectMutation.isPending}>
                  {createProjectMutation.isPending ? "Creating…" : "Create project"}
                </Button>
              )}
            </div>
          </div>
        }
      >
      <form id="project-create-form" className="ui-form project-wizard" onSubmit={handleCreateProject}>
        <ol className="project-create-steps" aria-label="Project creation progress">
          {createSteps.map((step, index) => (
            <li key={step.label} className={index === createStep ? "active" : index < createStep ? "complete" : ""} aria-current={index === createStep ? "step" : undefined}>
              <span>{index < createStep ? <Check size={13} /> : index + 1}</span>
              <div><strong>{step.label}</strong><small>{step.description}</small></div>
            </li>
          ))}
        </ol>
        {createStep === 0 ? (
          <section className="project-create-step" aria-labelledby="project-client-step">
            <div className="wizard-step-heading"><h3 id="project-client-step">Select a client</h3><p>Choose an existing client or create a new one without leaving this flow.</p></div>
            {clientsQuery.isError ? <p className="error-text">Could not load clients for selection.</p> : null}
            <label className="field"><span>Client</span><select value={clientSelection} onChange={(event) => setClientSelection(event.target.value)} required>
              <option value="">Select client</option>
              <option value="__new__">+ Create new client</option>
              {clientsQuery.data?.data.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select></label>
            {creatingNewClient ? (
              <div className="ui-form-row">
                <label className="field"><span>Client name</span><input value={newClientName} onChange={(event) => setNewClientName(event.target.value)} required /></label>
                <label className="field"><span>Company</span><input value={newClientCompany} onChange={(event) => setNewClientCompany(event.target.value)} /></label>
              </div>
            ) : null}
          </section>
        ) : null}
        {createStep === 1 ? (
          <section className="project-create-step" aria-labelledby="project-details-step">
            <div className="wizard-step-heading"><h3 id="project-details-step">Project details</h3><p>Give the team a clear name and enough context to understand the work.</p></div>
            <label className="field"><span>Project name</span><input value={name} onChange={(event) => setName(event.target.value)} required placeholder="e.g. Summer campaign launch" /></label>
            <label className="field"><span>Description</span><textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What should the team deliver?" /></label>
          </section>
        ) : null}
        {createStep === 2 ? (
          <section className="project-create-step" aria-labelledby="project-schedule-step">
            <div className="wizard-step-heading"><h3 id="project-schedule-step">Schedule and priority</h3><p>Set the working window and how urgently this project should be handled.</p></div>
            <div className="ui-form-row ui-form-row-three">
              <label className="field"><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
              <label className="field"><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
              <label className="field"><span>Deadline</span><input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} required /></label>
            </div>
            {!deadlineIsValid ? <p className="error-text">Deadline must be on or after the start date.</p> : null}
          </section>
        ) : null}
        {createStep === 3 ? (
          <section className="project-create-step" aria-labelledby="project-team-step">
            <div className="wizard-step-heading"><h3 id="project-team-step">Team and review</h3><p>Assign teammates now, or create the project and add them later.</p></div>
            {usersQuery.isError ? <p className="error-text">Could not load users for team assignment.</p> : null}
            <div className="project-team-builder">
              <p className="field-label">Initial team <span>Optional</span></p>
              <div className="team-assignment-row">
                <select aria-label="Team member" value={teamUserId} onChange={(event) => setTeamUserId(event.target.value)}>
                  <option value="">Choose a team member</option>
                  {usersQuery.data?.data.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}
                </select>
                <select aria-label="Project role" value={teamRole} onChange={(event) => setTeamRole(event.target.value as "manager" | "member" | "viewer")}>
                  <option value="manager">Manager</option><option value="member">Member</option><option value="viewer">Viewer</option>
                </select>
                <Button size="sm" onClick={addTeamAssignment} disabled={!teamUserId}>Add</Button>
              </div>
              {teamAssignments.length > 0 ? (
                <div className="assignment-list">
                  {teamAssignments.map((assignment) => {
                    const user = usersQuery.data?.data.find((item) => item.id === assignment.userId);
                    return <div key={assignment.userId} className="assignment-item"><p>{user?.name ?? assignment.userId} <span>{assignment.role}</span></p><Button variant="ghost" size="sm" onClick={() => setTeamAssignments((previous) => previous.filter((item) => item.userId !== assignment.userId))}>Remove</Button></div>;
                  })}
                </div>
              ) : <p className="wizard-empty-note">No teammates assigned yet.</p>}
            </div>
            <div className="project-create-review" aria-label="Project summary">
              <div><span>Client</span><strong>{selectedClientName}</strong></div>
              <div><span>Project</span><strong>{name}</strong></div>
              <div><span>Timeline</span><strong>{startDate} → {deadline}</strong></div>
              <div><span>Priority</span><strong className={`badge badge-priority badge-priority-${priority}`}>{priority}</strong></div>
            </div>
          </section>
        ) : null}
        {formError ? <p className="error-text" role="alert">{formError}</p> : null}
      </form>
      </Dialog>

      <div className="list-toolbar project-filters">
        <select aria-label="Filter by client" value={listClientId} onChange={(event) => setListParam("clientId", event.target.value)}>
          <option value="">All clients</option>
          {clientsQuery.data?.data.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by project stage" value={listPhase} onChange={(event) => setListParam("phase", event.target.value)}>
          <option value="">All project stages</option>
          <option value="client_acquisition">Acquisition</option><option value="strategy_planning">Strategy</option><option value="production">Production</option><option value="post_production">Post-production</option><option value="delivery">Delivery</option>
        </select>
        <select aria-label="Filter by priority" value={listPriority} onChange={(event) => setListParam("priority", event.target.value)}>
          <option value="">All priorities</option>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <span className="toolbar-spacer" />
        {(listClientId || listPhase || listPriority) ? <Button variant="ghost" size="sm" onClick={clearListFilters}>Clear</Button> : null}
        <select aria-label="Sort projects" value={`${listSortBy}:${listSortOrder}`} onChange={(event) => setListSort(event.target.value)}>
          <option value="updatedAt:desc">Recently updated</option><option value="deadline:asc">Deadline</option><option value="name:asc">Name A–Z</option><option value="priority:desc">Priority</option>
        </select>
      </div>
      {formError && !showCreate ? <p className="board-error" role="alert">{formError}</p> : null}
      {(projectsQuery.data?.data.length ?? 0) === 0 ? (
        <div className="state-card card"><p>No projects match these filters.</p><Button variant="primary" onClick={openCreateProject}>Create a project</Button></div>
      ) : (
        <div className="project-directory" aria-label="Projects">
          {projectsQuery.data?.data.map((project) => {
            const deadline = new Date(project.deadline);
            const overdue = deadline.getTime() < Date.now() && project.current_phase !== "delivery";
            return (
              <Link key={project.id} to={`/projects/${project.id}`} className="project-directory-card">
                <div className="project-directory-card-topline">
                  <span className={`phase-pill phase-pill-${project.current_phase}`}>{project.current_phase.replaceAll("_", " ")}</span>
                  <span className={`badge badge-priority badge-priority-${project.priority}`}>{project.priority}</span>
                </div>
                <div><h3>{project.name}</h3><p>{project.client_name}</p></div>
                <div className="project-directory-meta">
                  <span className={overdue ? "deadline-overdue" : ""}><CalendarDays size={14} /> {deadline.toLocaleDateString()}</span>
                  <span><Users size={14} /> {project.current_user_role ?? "viewer"}</span>
                </div>
                <div className="project-directory-open"><span>Open task board</span><span aria-hidden="true">→</span></div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";

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

function toIsoDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function ProjectsPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
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

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      apiRequest<ProjectsResponse>("/projects?page=1&pageSize=25&sortBy=updatedAt&sortOrder=desc", {
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

  const canSubmit = useMemo(() => {
    const hasClient = creatingNewClient ? Boolean(newClientName.trim()) : Boolean(clientSelection);
    return Boolean(hasClient && name.trim() && startDate && deadline);
  }, [clientSelection, creatingNewClient, deadline, name, newClientName, startDate]);

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      let resolvedClientId = clientSelection;

      if (creatingNewClient) {
        const createdClient = await apiRequest<{ data: { id: string } }>("/clients", {
          method: "POST",
          accessToken: accessToken ?? undefined,
          body: {
            name: newClientName.trim(),
            company: newClientCompany.trim() ? newClientCompany.trim() : null
          }
        });
        resolvedClientId = createdClient.data.id;
      }

      const createdProject = await apiRequest<{ data: { id: string } }>("/projects", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          clientId: resolvedClientId,
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
          startDate,
          deadline,
          priority
        }
      });

      if (teamAssignments.length > 0) {
        await Promise.all(
          teamAssignments.map((assignment) =>
            apiRequest(`/projects/${createdProject.data.id}/team`, {
              method: "POST",
              accessToken: accessToken ?? undefined,
              body: {
                userId: assignment.userId,
                role: assignment.role
              }
            })
          )
        );
      }
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

  if (projectsQuery.isLoading) {
    return <div className="state-card">Loading projects...</div>;
  }

  if (projectsQuery.isError) {
    return <div className="state-card">Could not load projects.</div>;
  }

  return (
    <section>
      <div className="section-head">
        <h2>Projects</h2>
        <p className="muted">{projectsQuery.data?.meta.total ?? 0} visible projects</p>
      </div>
      <form className="card task-create-form" onSubmit={handleCreateProject}>
        <h3>Create project</h3>
        <div className="project-form-grid">
          <select value={clientSelection} onChange={(event) => setClientSelection(event.target.value)} required>
            <option value="">Select client</option>
            <option value="__new__">+ Create new client</option>
            {clientsQuery.data?.data.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          {creatingNewClient ? (
            <>
              <input
                placeholder="New client name"
                value={newClientName}
                onChange={(event) => setNewClientName(event.target.value)}
                required
              />
              <input
                placeholder="Client company (optional)"
                value={newClientCompany}
                onChange={(event) => setNewClientCompany(event.target.value)}
              />
            </>
          ) : null}
          <input
            placeholder="Project name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <select value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
          <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} required />
          <button className="primary-button" type="submit" disabled={!canSubmit || createProjectMutation.isPending}>
            Create
          </button>
        </div>
        <div className="project-team-builder">
          <div className="task-form-grid">
            <select value={teamUserId} onChange={(event) => setTeamUserId(event.target.value)}>
              <option value="">Add team member (optional)</option>
              {usersQuery.data?.data.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
            <select value={teamRole} onChange={(event) => setTeamRole(event.target.value as "manager" | "member" | "viewer")}>
              <option value="manager">manager</option>
              <option value="member">member</option>
              <option value="viewer">viewer</option>
            </select>
            <button type="button" className="ghost-button" onClick={addTeamAssignment} disabled={!teamUserId}>
              Add member
            </button>
          </div>
          {teamAssignments.length > 0 ? (
            <div className="assignment-list">
              {teamAssignments.map((assignment) => {
                const user = usersQuery.data?.data.find((item) => item.id === assignment.userId);
                return (
                  <div key={assignment.userId} className="assignment-item">
                    <p>
                      {user?.name ?? assignment.userId} ({assignment.role})
                    </p>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setTeamAssignments((previous) =>
                          previous.filter((item) => item.userId !== assignment.userId)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        <input
          placeholder="Description (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {formError ? <p className="error-text">{formError}</p> : null}
      </form>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Client</th>
              <th>Phase</th>
              <th>Priority</th>
              <th>Deadline</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {projectsQuery.data?.data.map((project) => (
              <tr key={project.id}>
                <td>
                  <Link to={`/projects/${project.id}`} className="inline-link">
                    {project.name}
                  </Link>
                </td>
                <td>{project.client_name}</td>
                <td>{project.current_phase}</td>
                <td>{project.priority}</td>
                <td>{project.deadline}</td>
                <td>{project.current_user_role ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

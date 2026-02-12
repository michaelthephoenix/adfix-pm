import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";

type ClientDetailResponse = {
  data: {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
};

type ProjectsResponse = {
  data: Array<{
    id: string;
    name: string;
    current_phase: string;
    priority: string;
    deadline: string;
  }>;
  meta: {
    total: number;
  };
};

type ClientActivityResponse = {
  data: Array<{
    id: string;
    project_id: string | null;
    action: string;
    details: Record<string, unknown>;
    created_at: string;
    user_name: string | null;
    project_name: string | null;
  }>;
};

export function ClientDetailPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const clientQuery = useQuery({
    queryKey: ["client-detail", clientId],
    queryFn: () =>
      apiRequest<ClientDetailResponse>(`/clients/${clientId}`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(clientId && accessToken)
  });

  const projectsQuery = useQuery({
    queryKey: ["client-projects", clientId],
    queryFn: () =>
      apiRequest<ProjectsResponse>(
        `/projects?clientId=${clientId}&page=1&pageSize=100&sortBy=updatedAt&sortOrder=desc`,
        {
          accessToken: accessToken ?? undefined
        }
      ),
    enabled: Boolean(clientId && accessToken)
  });

  const activityQuery = useQuery({
    queryKey: ["client-activity", clientId],
    queryFn: () =>
      apiRequest<ClientActivityResponse>(`/clients/${clientId}/activity?limit=25`, {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(clientId && accessToken)
  });

  const saveClientMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/clients/${clientId}`, {
        method: "PUT",
        accessToken: accessToken ?? undefined,
        body: {
          name: name.trim(),
          company: company.trim() ? company.trim() : null,
          email: email.trim() ? email.trim() : null,
          phone: phone.trim() ? phone.trim() : null,
          notes: notes.trim() ? notes.trim() : null
        }
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client-detail", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["clients-page"] });
      await queryClient.invalidateQueries({ queryKey: ["clients-for-project-form"] });
      setIsEditing(false);
      setFormError(null);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError("Could not update client.");
      }
    }
  });

  const deleteClientMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/clients/${clientId}`, {
        method: "DELETE",
        accessToken: accessToken ?? undefined
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["clients-page"] });
      await queryClient.invalidateQueries({ queryKey: ["clients-for-project-form"] });
      navigate("/clients");
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError("Could not delete client.");
      }
    }
  });

  if (!clientId) {
    return <div className="state-card">Missing client id.</div>;
  }

  if (clientQuery.isLoading) {
    return <div className="state-card">Loading client...</div>;
  }

  if (clientQuery.isError || !clientQuery.data) {
    return <div className="state-card">Could not load client details.</div>;
  }

  const client = clientQuery.data.data;
  const projects = projectsQuery.data?.data ?? [];
  const openProjectsCount = projects.filter((project) => project.current_phase !== "delivery").length;
  const highPriorityCount = projects.filter(
    (project) => project.priority === "high" || project.priority === "urgent"
  ).length;

  const formatValue = (value: string | null) => value ?? "-";
  const formatDateTime = (value: string) => new Date(value).toLocaleString();
  const formatDate = (value: string) => new Date(value).toLocaleDateString();
  const formatPhaseLabel = (phase: string) =>
    phase
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const formatActionLabel = (action: string) =>
    action
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const beginEdit = () => {
    setIsEditing(true);
    setName(client.name);
    setCompany(client.company ?? "");
    setEmail(client.email ?? "");
    setPhone(client.phone ?? "");
    setNotes(client.notes ?? "");
    setFormError(null);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setFormError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    saveClientMutation.mutate();
  };

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>{client.name}</h2>
          <p className="muted">{client.company ?? "No company set"}</p>
        </div>
        <Link to="/clients" className="ghost-button">
          Back to clients
        </Link>
      </div>

      <div className="card">
        <div className="section-head">
          <h3>Client profile</h3>
          {isEditing ? (
            <button type="button" className="ghost-button" onClick={cancelEdit}>
              Cancel
            </button>
          ) : (
            <button type="button" className="ghost-button" onClick={beginEdit}>
              Edit client
            </button>
          )}
        </div>
        {isEditing ? (
          <form className="task-create-form" onSubmit={onSubmit}>
            <div className="client-edit-grid">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" required />
              <input
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="Company"
              />
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" />
              <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes" />
            </div>
            <div className="inline-actions">
              <button type="submit" className="primary-button" disabled={saveClientMutation.isPending}>
                Save changes
              </button>
              <button type="button" className="ghost-button" onClick={cancelEdit}>
                Cancel
              </button>
            </div>
            {formError ? <p className="error-text">{formError}</p> : null}
          </form>
        ) : null}
        {isConfirmingDelete ? (
          <div className="state-card">
            <p className="notice-title">Delete this client?</p>
            <p className="muted">This will remove the client from active lists.</p>
            <div className="inline-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => deleteClientMutation.mutate()}
                disabled={deleteClientMutation.isPending}
              >
                Confirm delete
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setIsConfirmingDelete(false)}
                disabled={deleteClientMutation.isPending}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="ghost-button" onClick={() => setIsConfirmingDelete(true)}>
            Delete client
          </button>
        )}
        {!isEditing && formError ? <p className="error-text">{formError}</p> : null}
      </div>

      <div className="kpi-grid">
        <div className="card">
          <p className="eyebrow">Projects</p>
          <p className="kpi-value short">{projects.length}</p>
        </div>
        <div className="card">
          <p className="eyebrow">Open projects</p>
          <p className="kpi-value short">{openProjectsCount}</p>
        </div>
        <div className="card">
          <p className="eyebrow">High priority</p>
          <p className="kpi-value short">{highPriorityCount}</p>
        </div>
      </div>

      <div className="card detail-grid">
        <div>
          <p className="eyebrow">Contact email</p>
          <p>{formatValue(client.email)}</p>
        </div>
        <div>
          <p className="eyebrow">Contact phone</p>
          <p>{formatValue(client.phone)}</p>
        </div>
        <div>
          <p className="eyebrow">Created</p>
          <p>{formatDateTime(client.created_at)}</p>
        </div>
        <div>
          <p className="eyebrow">Updated</p>
          <p>{formatDateTime(client.updated_at)}</p>
        </div>
        <div className="detail-notes">
          <p className="eyebrow">Notes</p>
          <p>{client.notes ?? "No notes"}</p>
        </div>
      </div>

      <div className="card table-wrap">
        <div className="section-head">
          <h3>Projects</h3>
          <p className="muted">{projectsQuery.data?.meta.total ?? 0} projects</p>
        </div>
        {projectsQuery.isLoading ? (
          <p>Loading projects...</p>
        ) : projectsQuery.isError ? (
          <p>Could not load related projects.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Phase</th>
                <th>Priority</th>
                <th>Deadline</th>
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
                  <td>{formatPhaseLabel(project.current_phase)}</td>
                  <td>{formatPhaseLabel(project.priority)}</td>
                  <td>{formatDate(project.deadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="section-head">
          <h3>Recent Activity</h3>
          <p className="muted">{activityQuery.data?.data.length ?? 0} items</p>
        </div>
        {activityQuery.isLoading ? (
          <p>Loading activity...</p>
        ) : activityQuery.isError ? (
          <p>Could not load activity.</p>
        ) : !activityQuery.data?.data.length ? (
          <p className="muted">No recent activity for this client.</p>
        ) : (
          <div className="activity-list">
            {activityQuery.data.data.map((item) => (
              <div key={item.id} className="activity-item">
                <div className="section-head">
                  <p className="notice-title">{formatActionLabel(item.action)}</p>
                  <p className="muted">{formatDateTime(item.created_at)}</p>
                </div>
                <p className="muted">
                  By {item.user_name ?? "System"}
                  {item.project_name ? ` in ${item.project_name}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
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

export function ProjectsPage() {
  const { accessToken } = useAuth();

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () =>
      apiRequest<ProjectsResponse>("/projects?page=1&pageSize=25&sortBy=updatedAt&sortOrder=desc", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

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
                <td>{project.name}</td>
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

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Clock3, FileCheck2 } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type ClientProject = {
  id: string; name: string; client_name: string; description: string | null; current_phase: string;
  client_role: "reviewer" | "viewer"; priority: string; deadline: string; deliverable_count: number; pending_review_count: number;
};

export function ClientProjectsPage() {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ["client-portal-projects"],
    queryFn: () => apiRequest<{ data: ClientProject[] }>("/client-portal/projects", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken)
  });
  if (query.isLoading) return <LoadingState message="Loading your projects..." />;
  if (query.isError) return <ErrorState message="Could not load your projects." onRetry={() => void query.refetch()} />;
  const projects = query.data?.data ?? [];
  const pendingReviews = projects.reduce((total, project) => total + (project.client_role === "reviewer" ? project.pending_review_count : 0), 0);
  return (
    <section>
      <PageHeader title="Projects" description="Shared work, deliverables, and review requests." meta={pendingReviews > 0 ? <span className="ui-badge ui-badge-warning">{pendingReviews} to review</span> : <span>{projects.length}</span>} />
      {projects.length === 0 ? <EmptyState message="No projects have been shared with you yet." /> : (
        <div className="portal-project-grid">
          {projects.map((project) => (
            <article key={project.id} className="card portal-project-card">
              <div className="project-card-topline"><span className={`phase-pill phase-pill-${project.current_phase}`}>{project.current_phase.replaceAll("_", " ")}</span><span className={`badge badge-priority badge-priority-${project.priority}`}>{project.priority}</span></div>
              <h3><Link to={`/portal/projects/${project.id}`}>{project.name}</Link></h3><p className="muted">{project.description ?? "Project work and deliverables"}</p>
              <div className="portal-project-stats"><span><CalendarDays size={16} /> Due {new Date(project.deadline).toLocaleDateString()}</span><span><FileCheck2 size={16} /> {project.deliverable_count} deliverables</span>{project.client_role === "reviewer" && project.pending_review_count > 0 ? <span className="review-needed"><Clock3 size={16} /> {project.pending_review_count} awaiting review</span> : <span>{project.client_role === "viewer" ? "Read-only access" : "No reviews waiting"}</span>}</div>
              <Link className="portal-card-link" to={`/portal/projects/${project.id}`}>Open project <ArrowRight size={16} /></Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

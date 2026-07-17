import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, CircleAlert, FolderKanban } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel } from "../components/ui/Panel";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type DashboardResponse = {
  data: {
    projectsByPhase: Array<{ phase: string; count: number }>;
    overdueTasksCount: number;
    projectsCompletedThisMonth: number;
    projectsCompletedThisQuarter: number;
  };
};

const phaseLabels: Record<string, string> = {
  client_acquisition: "Acquisition",
  strategy_planning: "Strategy",
  production: "Production",
  post_production: "Post-production",
  delivery: "Delivery"
};

export function DashboardPage() {
  const { accessToken } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiRequest<DashboardResponse>("/analytics/dashboard", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken)
  });

  if (dashboardQuery.isLoading) return <LoadingState message="Loading overview…" />;
  if (dashboardQuery.isError) return <ErrorState message="Could not load the overview." onRetry={() => void dashboardQuery.refetch()} />;

  const metrics = dashboardQuery.data?.data;
  if (!metrics) return <EmptyState message="No workspace activity yet." />;

  const totalProjects = metrics.projectsByPhase.reduce((sum, phase) => sum + phase.count, 0);
  const maxPhaseCount = Math.max(1, ...metrics.projectsByPhase.map((phase) => phase.count));

  return (
    <section>
      <PageHeader title="Overview" description="Current workload and the work that needs attention." />

      <div className="metric-strip" aria-label="Workspace metrics">
        <Link className="metric-item" to="/projects">
          <span className="metric-icon"><FolderKanban size={16} /></span>
          <span><strong>{totalProjects}</strong><small>Active projects</small></span>
          <ArrowUpRight size={14} />
        </Link>
        <Link className={`metric-item ${metrics.overdueTasksCount > 0 ? "attention" : ""}`} to="/tasks?overdue=true">
          <span className="metric-icon"><CircleAlert size={16} /></span>
          <span><strong>{metrics.overdueTasksCount}</strong><small>Overdue tasks</small></span>
          <ArrowUpRight size={14} />
        </Link>
        <Link className="metric-item" to="/projects?phase=delivery">
          <span className="metric-icon"><CheckCircle2 size={16} /></span>
          <span><strong>{metrics.projectsCompletedThisMonth}</strong><small>Delivered this month</small></span>
          <ArrowUpRight size={14} />
        </Link>
      </div>

      <Panel
        title="Project pipeline"
        description="Active projects grouped by current phase."
        action={<Link className="text-link" to="/projects">Open board <ArrowUpRight size={13} /></Link>}
      >
        {metrics.projectsByPhase.length === 0 ? (
          <EmptyState message="Create a project to start the pipeline." />
        ) : (
          <div className="pipeline-list">
            {metrics.projectsByPhase.map((phase) => (
              <Link key={phase.phase} className="pipeline-row" to={`/projects?phase=${phase.phase}`}>
                <span className={`phase-dot phase-dot-${phase.phase}`} />
                <span className="pipeline-label">{phaseLabels[phase.phase] ?? phase.phase.replaceAll("_", " ")}</span>
                <span className="pipeline-track"><span style={{ width: `${Math.max(6, (phase.count / maxPhaseCount) * 100)}%` }} /></span>
                <strong>{phase.count}</strong>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </section>
  );
}

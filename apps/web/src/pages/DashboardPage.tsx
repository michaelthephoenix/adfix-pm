import { useQuery } from "@tanstack/react-query";
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

export function DashboardPage() {
  const { accessToken } = useAuth();

  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () =>
      apiRequest<DashboardResponse>("/analytics/dashboard", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  if (dashboardQuery.isLoading) {
    return <LoadingState message="Loading dashboard..." />;
  }

  if (dashboardQuery.isError) {
    return <ErrorState message="Could not load dashboard." onRetry={() => void dashboardQuery.refetch()} />;
  }

  const metrics = dashboardQuery.data?.data;
  if (!metrics) {
    return <EmptyState message="No metrics available." />;
  }

  const totalProjects = metrics.projectsByPhase.reduce((sum, phase) => sum + phase.count, 0);

  return (
    <section>
      <h2>Dashboard</h2>
      <div className="kpi-grid">
        <article className="card">
          <p className="eyebrow">Total projects</p>
          <p className="kpi-value">{totalProjects}</p>
        </article>
        <article className="card">
          <p className="eyebrow">Overdue tasks</p>
          <p className="kpi-value">{metrics.overdueTasksCount}</p>
        </article>
        <article className="card">
          <p className="eyebrow">Delivered this month</p>
          <p className="kpi-value">{metrics.projectsCompletedThisMonth}</p>
        </article>
        <article className="card">
          <p className="eyebrow">Delivered this quarter</p>
          <p className="kpi-value">{metrics.projectsCompletedThisQuarter}</p>
        </article>
      </div>
      <article className="card">
        <h3>Projects by phase</h3>
        <div className="phase-list">
          {metrics.projectsByPhase.map((phase) => (
            <p key={phase.phase}>
              <strong>{phase.phase}</strong>: {phase.count}
            </p>
          ))}
        </div>
      </article>
    </section>
  );
}

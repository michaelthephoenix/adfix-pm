import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs, type TabOption } from "../components/ui/Tabs";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";

type ProjectsAnalyticsResponse = { data: Array<{ projectId: string; projectName: string; currentPhase: string; totalTasks: number; completedTasks: number; completionRatePct: number }> };
type TeamAnalyticsResponse = { data: Array<{ userId: string; userName: string; userEmail: string; totalTasks: number; completedTasks: number; overdueTasks: number }> };
type TimelineAnalyticsResponse = { data: Array<{ projectId: string; projectName: string; currentPhase: string; startDate: string; deadline: string; daysRemaining: number }> };
type ReportView = "projects" | "team" | "timeline";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const humanize = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function ReportsPage() {
  const { accessToken } = useAuth();
  const [activeView, setActiveView] = useState<ReportView>("projects");

  const projectsQuery = useQuery({
    queryKey: ["reports-projects"],
    queryFn: () => apiRequest<ProjectsAnalyticsResponse>("/analytics/projects", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken && activeView === "projects")
  });
  const teamQuery = useQuery({
    queryKey: ["reports-team"],
    queryFn: () => apiRequest<TeamAnalyticsResponse>("/analytics/team", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken && activeView === "team")
  });
  const timelineQuery = useQuery({
    queryKey: ["reports-timeline"],
    queryFn: () => apiRequest<TimelineAnalyticsResponse>("/analytics/timeline", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken && activeView === "timeline")
  });

  const downloadCsv = async (path: "/analytics/projects.csv" | "/analytics/team.csv") => {
    if (!accessToken) return;
    const response = await fetch(`${API_BASE_URL}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
    const blob = new Blob([await response.text()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = path.includes("projects") ? "project-performance.csv" : "team-throughput.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportAction = activeView === "timeline" ? null : (
    <Button icon={<Download size={14} />} onClick={() => void downloadCsv(activeView === "projects" ? "/analytics/projects.csv" : "/analytics/team.csv")}>Export CSV</Button>
  );

  const reportTabs: TabOption<ReportView>[] = [
    {
      value: "projects",
      label: "Projects",
      content: (
        <div className="data-view report-view">
          {projectsQuery.isLoading ? <LoadingState message="Loading project performance…" />
            : projectsQuery.isError ? <ErrorState message="Could not load project performance." onRetry={() => void projectsQuery.refetch()} />
            : (projectsQuery.data?.data.length ?? 0) === 0 ? <EmptyState message="Project performance will appear after tasks are created." />
            : <table><thead><tr><th>Project</th><th>Phase</th><th>Tasks</th><th>Completed</th><th>Progress</th></tr></thead><tbody>{projectsQuery.data?.data.map((row) => <tr key={row.projectId}><td><span className="row-title">{row.projectName}</span></td><td>{humanize(row.currentPhase)}</td><td>{row.totalTasks}</td><td>{row.completedTasks}</td><td><div className="progress-cell"><span><span style={{ width: `${row.completionRatePct}%` }} /></span><strong>{Math.round(row.completionRatePct)}%</strong></div></td></tr>)}</tbody></table>}
        </div>
      )
    },
    {
      value: "team",
      label: "Team",
      content: (
        <div className="data-view report-view">
          {teamQuery.isLoading ? <LoadingState message="Loading team throughput…" />
            : teamQuery.isError ? <ErrorState message="Could not load team throughput." onRetry={() => void teamQuery.refetch()} />
            : (teamQuery.data?.data.length ?? 0) === 0 ? <EmptyState message="Team throughput will appear after tasks are assigned." />
            : <table><thead><tr><th>Person</th><th>Tasks</th><th>Completed</th><th>Overdue</th></tr></thead><tbody>{teamQuery.data?.data.map((row) => <tr key={row.userId}><td><span className="row-title">{row.userName}</span><span className="row-subtitle">{row.userEmail}</span></td><td>{row.totalTasks}</td><td>{row.completedTasks}</td><td className={row.overdueTasks > 0 ? "deadline-overdue" : ""}>{row.overdueTasks}</td></tr>)}</tbody></table>}
        </div>
      )
    },
    {
      value: "timeline",
      label: "Timeline",
      content: (
        <div className="data-view report-view">
          {timelineQuery.isLoading ? <LoadingState message="Loading delivery timeline…" />
            : timelineQuery.isError ? <ErrorState message="Could not load the timeline." onRetry={() => void timelineQuery.refetch()} />
            : (timelineQuery.data?.data.length ?? 0) === 0 ? <EmptyState message="Delivery dates will appear after projects are scheduled." />
            : <table><thead><tr><th>Project</th><th>Phase</th><th>Start</th><th>Deadline</th><th>Remaining</th></tr></thead><tbody>{timelineQuery.data?.data.map((row) => <tr key={row.projectId}><td><span className="row-title">{row.projectName}</span></td><td>{humanize(row.currentPhase)}</td><td><time dateTime={row.startDate}>{new Date(row.startDate).toLocaleDateString()}</time></td><td><time dateTime={row.deadline}>{new Date(row.deadline).toLocaleDateString()}</time></td><td className={row.daysRemaining < 0 ? "deadline-overdue" : ""}>{row.daysRemaining < 0 ? `${Math.abs(row.daysRemaining)}d overdue` : `${row.daysRemaining}d`}</td></tr>)}</tbody></table>}
        </div>
      )
    }
  ];

  return (
    <section>
      <PageHeader title="Reports" description="Performance, workload, and delivery timing." actions={exportAction} />
      <Tabs label="Report view" value={activeView} onValueChange={setActiveView} options={reportTabs} />
    </section>
  );
}

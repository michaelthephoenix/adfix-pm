import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";

type ProjectsAnalyticsResponse = {
  data: Array<{
    projectId: string;
    projectName: string;
    currentPhase: string;
    totalTasks: number;
    completedTasks: number;
    completionRatePct: number;
  }>;
};

type TeamAnalyticsResponse = {
  data: Array<{
    userId: string;
    userName: string;
    userEmail: string;
    totalTasks: number;
    completedTasks: number;
    overdueTasks: number;
  }>;
};

type TimelineAnalyticsResponse = {
  data: Array<{
    projectId: string;
    projectName: string;
    currentPhase: string;
    startDate: string;
    deadline: string;
    daysRemaining: number;
  }>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

export function ReportsPage() {
  const { accessToken } = useAuth();

  const projectsQuery = useQuery({
    queryKey: ["reports-projects"],
    queryFn: () =>
      apiRequest<ProjectsAnalyticsResponse>("/analytics/projects", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const teamQuery = useQuery({
    queryKey: ["reports-team"],
    queryFn: () =>
      apiRequest<TeamAnalyticsResponse>("/analytics/team", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const timelineQuery = useQuery({
    queryKey: ["reports-timeline"],
    queryFn: () =>
      apiRequest<TimelineAnalyticsResponse>("/analytics/timeline", {
        accessToken: accessToken ?? undefined
      }),
    enabled: Boolean(accessToken)
  });

  const openCsv = async (path: "/analytics/projects.csv" | "/analytics/team.csv") => {
    if (!accessToken) return;

    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    const text = await response.text();
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = path === "/analytics/projects.csv" ? "projects-analytics.csv" : "team-analytics.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <div className="section-head">
        <h2>Reports</h2>
        <div className="inline-actions">
          <button className="ghost-button" onClick={() => openCsv("/analytics/projects.csv")}>
            Export Projects CSV
          </button>
          <button className="ghost-button" onClick={() => openCsv("/analytics/team.csv")}>
            Export Team CSV
          </button>
        </div>
      </div>

      <div className="card table-wrap">
        <h3>Project Performance</h3>
        {projectsQuery.isLoading ? (
          <p>Loading project analytics...</p>
        ) : projectsQuery.isError ? (
          <p>Could not load project analytics.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Phase</th>
                <th>Total Tasks</th>
                <th>Completed</th>
                <th>Completion %</th>
              </tr>
            </thead>
            <tbody>
              {projectsQuery.data?.data.map((row) => (
                <tr key={row.projectId}>
                  <td>{row.projectName}</td>
                  <td>{row.currentPhase}</td>
                  <td>{row.totalTasks}</td>
                  <td>{row.completedTasks}</td>
                  <td>{row.completionRatePct.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card table-wrap">
        <h3>Team Throughput</h3>
        {teamQuery.isLoading ? (
          <p>Loading team analytics...</p>
        ) : teamQuery.isError ? (
          <p>Could not load team analytics.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Total Tasks</th>
                <th>Completed</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {teamQuery.data?.data.map((row) => (
                <tr key={row.userId}>
                  <td>{row.userName}</td>
                  <td>{row.userEmail}</td>
                  <td>{row.totalTasks}</td>
                  <td>{row.completedTasks}</td>
                  <td>{row.overdueTasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card table-wrap">
        <h3>Delivery Timeline</h3>
        {timelineQuery.isLoading ? (
          <p>Loading timeline...</p>
        ) : timelineQuery.isError ? (
          <p>Could not load timeline.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Phase</th>
                <th>Start</th>
                <th>Deadline</th>
                <th>Days Remaining</th>
              </tr>
            </thead>
            <tbody>
              {timelineQuery.data?.data.map((row) => (
                <tr key={row.projectId}>
                  <td>{row.projectName}</td>
                  <td>{row.currentPhase}</td>
                  <td>{row.startDate}</td>
                  <td>{row.deadline}</td>
                  <td>{row.daysRemaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

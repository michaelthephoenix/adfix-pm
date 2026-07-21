import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarClock,
  CircleAlert,
  Clock3,
  FileCheck2,
  MessageSquareText,
  ShieldCheck,
  Users
} from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel } from "../components/ui/Panel";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";

type Assignee = { id: string; name: string; avatarUrl: string | null };
type DashboardTask = {
  id: string;
  title: string;
  priority: string;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  clientName: string;
  assignees: Assignee[];
};

type DashboardResponse = {
  data: {
    projectsByPhase: Array<{ phase: string; count: number }>;
    overdueTasksCount: number;
    projectsCompletedThisMonth: number;
    projectsCompletedThisQuarter: number;
    attentionCounts: {
      internalReviews: number;
      clientFeedback: number;
      dueToday: number;
      blockedTasks: number;
      unresolvedClientReviews: number;
    };
    internalReviewsAwaitingDecision: Array<{
      versionId: string;
      deliverableTitle: string;
      projectId: string;
      projectName: string;
      clientName: string;
      versionNumber: number;
      submittedAt: string;
      submittedByName: string;
    }>;
    clientFeedbackAwaitingResponse: Array<{
      notificationId: string;
      type: string;
      title: string;
      message: string;
      createdAt: string;
      versionId: string;
      deliverableTitle: string;
      projectId: string;
      projectName: string;
      clientName: string;
    }>;
    dueTodayAssignments: DashboardTask[];
    blockedTasks: DashboardTask[];
    unresolvedClientReviews: Array<{
      versionId: string;
      deliverableTitle: string;
      projectId: string;
      projectName: string;
      clientName: string;
      versionNumber: number;
      clientSubmittedAt: string;
    }>;
    workload: Array<{
      userId: string;
      userName: string;
      avatarUrl: string | null;
      activeTasks: number;
      dueToday: number;
      overdueTasks: number;
      blockedTasks: number;
    }>;
  };
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function AssigneeGroup({ assignees }: { assignees: Assignee[] }) {
  if (assignees.length === 0) return <span className="muted">Unassigned</span>;
  return (
    <span className="dashboard-assignees" aria-label={`Assigned to ${assignees.map((assignee) => assignee.name).join(", ")}`}>
      {assignees.slice(0, 3).map((assignee) => assignee.avatarUrl ? (
        <img key={assignee.id} src={assignee.avatarUrl} alt="" title={assignee.name} />
      ) : (
        <span key={assignee.id} title={assignee.name}>{initials(assignee.name)}</span>
      ))}
      {assignees.length > 3 ? <span title={assignees.slice(3).map((assignee) => assignee.name).join(", ")}>+{assignees.length - 3}</span> : null}
    </span>
  );
}

function ageLabel(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Less than an hour ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DashboardPage() {
  const { accessToken } = useAuth();
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", "supervisor-actions"],
    queryFn: () => apiRequest<DashboardResponse>("/analytics/dashboard", { accessToken: accessToken ?? undefined }),
    enabled: Boolean(accessToken)
  });

  if (dashboardQuery.isLoading) return <LoadingState message="Loading your action desk..." />;
  if (dashboardQuery.isError) return <ErrorState message="Could not load the supervisor dashboard." onRetry={() => void dashboardQuery.refetch()} />;

  const dashboard = dashboardQuery.data?.data;
  if (!dashboard) return <EmptyState message="No workspace activity yet." />;

  const internalCount = dashboard.attentionCounts.internalReviews;
  const feedbackCount = dashboard.attentionCounts.clientFeedback;
  const pendingActionCount = internalCount + feedbackCount;

  return (
    <section className="supervisor-dashboard">
      <PageHeader
        title="Supervisor desk"
        description="Decisions, client responses, and delivery risks across the projects you lead."
        meta={<span>{pendingActionCount} action{pendingActionCount === 1 ? "" : "s"} need attention</span>}
      />

      <div className="metric-strip" aria-label="Supervisor action counts">
        <a className={`metric-item ${internalCount > 0 ? "attention" : ""}`} href="#internal-reviews">
          <span className="metric-icon"><ShieldCheck size={16} /></span>
          <span><strong>{internalCount}</strong><small>Internal decisions</small></span>
          <ArrowUpRight size={14} />
        </a>
        <a className={`metric-item ${feedbackCount > 0 ? "attention" : ""}`} href="#client-feedback">
          <span className="metric-icon"><MessageSquareText size={16} /></span>
          <span><strong>{feedbackCount}</strong><small>Client responses</small></span>
          <ArrowUpRight size={14} />
        </a>
        <a className={`metric-item ${dashboard.blockedTasks.length > 0 ? "attention" : ""}`} href="#delivery-risks">
          <span className="metric-icon"><CircleAlert size={16} /></span>
          <span><strong>{dashboard.attentionCounts.blockedTasks}</strong><small>Blocked tasks</small></span>
          <ArrowUpRight size={14} />
        </a>
        <a className="metric-item" href="#today">
          <span className="metric-icon"><CalendarClock size={16} /></span>
          <span><strong>{dashboard.attentionCounts.dueToday}</strong><small>Due today</small></span>
          <ArrowUpRight size={14} />
        </a>
      </div>

      <div className="dashboard-action-grid">
        <Panel
          id="internal-reviews"
          title="Internal reviews awaiting decision"
          description="Approve for client submission or return clear changes to the team."
        >
          {internalCount === 0 ? <EmptyState message="No internal reviews are waiting for you." /> : (
            <div className="dashboard-action-list">
              {dashboard.internalReviewsAwaitingDecision.map((review) => (
                <Link className="dashboard-action-row" key={review.versionId} to={`/projects/${review.projectId}?tab=deliverables&version=${review.versionId}`}>
                  <span className="dashboard-action-icon review"><FileCheck2 size={17} /></span>
                  <span className="dashboard-action-copy">
                    <strong>{review.deliverableTitle}</strong>
                    <small>{review.projectName} · {review.clientName}</small>
                    <span>Version {review.versionNumber} from {review.submittedByName} · {ageLabel(review.submittedAt)}</span>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          id="client-feedback"
          title="Client feedback awaiting response"
          description="Reply to the client or route their feedback to the delivery team."
        >
          {feedbackCount === 0 ? <EmptyState message="No client feedback is waiting for a response." /> : (
            <div className="dashboard-action-list">
              {dashboard.clientFeedbackAwaitingResponse.map((feedback) => (
                <Link className="dashboard-action-row" key={feedback.notificationId} to={`/projects/${feedback.projectId}?tab=deliverables&version=${feedback.versionId}`}>
                  <span className="dashboard-action-icon feedback"><MessageSquareText size={17} /></span>
                  <span className="dashboard-action-copy">
                    <strong>{feedback.deliverableTitle}</strong>
                    <small>{feedback.projectName} · {feedback.clientName}</small>
                    <span>{feedback.message} · {ageLabel(feedback.createdAt)}</span>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="dashboard-action-grid secondary">
        <Panel id="today" title="Due today" description="Assignments that should move before the day closes.">
          {dashboard.dueTodayAssignments.length === 0 ? <EmptyState message="Nothing is due today." /> : (
            <div className="dashboard-task-list">
              {dashboard.dueTodayAssignments.map((task) => (
                <Link key={task.id} to={`/projects/${task.projectId}?tab=tasks&task=${task.id}`} className="dashboard-task-row">
                  <span><strong>{task.title}</strong><small>{task.projectName} · {task.clientName}</small></span>
                  <AssigneeGroup assignees={task.assignees} />
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel id="delivery-risks" title="Blocked work" description="Remove blockers before they affect review or delivery.">
          {dashboard.blockedTasks.length === 0 ? <EmptyState message="No blocked tasks across your projects." /> : (
            <div className="dashboard-task-list">
              {dashboard.blockedTasks.map((task) => (
                <Link key={task.id} to={`/projects/${task.projectId}?tab=tasks&task=${task.id}`} className="dashboard-task-row blocked">
                  <span><strong>{task.title}</strong><small>{task.projectName} · {task.clientName}</small></span>
                  <AssigneeGroup assignees={task.assignees} />
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="dashboard-action-grid secondary">
        <Panel title="Waiting on the client" description="Submitted reviews that have not received a client decision yet.">
          {dashboard.unresolvedClientReviews.length === 0 ? <EmptyState message="No client reviews are currently outstanding." /> : (
            <div className="dashboard-action-list compact">
              {dashboard.unresolvedClientReviews.map((review) => (
                <Link className="dashboard-action-row" key={review.versionId} to={`/projects/${review.projectId}?tab=deliverables&version=${review.versionId}`}>
                  <span className="dashboard-action-icon waiting"><Clock3 size={17} /></span>
                  <span className="dashboard-action-copy">
                    <strong>{review.deliverableTitle}</strong>
                    <small>{review.projectName} · {review.clientName}</small>
                    <span>Version {review.versionNumber} submitted {ageLabel(review.clientSubmittedAt)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Team workload" description="Active work and pressure points across your project teams." action={<Link className="text-link" to="/team">Open team <ArrowUpRight size={13} /></Link>}>
          {dashboard.workload.length === 0 ? <EmptyState message="Assign a project team to see workload." /> : (
            <div className="workload-list">
              {dashboard.workload.map((member) => (
                <div className="workload-row" key={member.userId}>
                  <span className="workload-avatar">{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : initials(member.userName)}</span>
                  <span className="workload-person"><strong>{member.userName}</strong><small>{member.activeTasks} active task{member.activeTasks === 1 ? "" : "s"}</small></span>
                  <span className="workload-signal"><strong>{member.dueToday}</strong><small>today</small></span>
                  <span className={member.blockedTasks > 0 ? "workload-signal danger" : "workload-signal"}><strong>{member.blockedTasks}</strong><small>blocked</small></span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <p className="dashboard-footnote"><Users size={14} /> Showing work only from projects you can access.</p>
    </section>
  );
}

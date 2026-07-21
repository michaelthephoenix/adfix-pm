import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { LoginPage } from "./pages/LoginPage";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { RequireRole } from "./components/RequireRole";

const RoleHome = lazy(() => import("./components/RoleHome").then((module) => ({ default: module.RoleHome })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const ClientsPage = lazy(() => import("./pages/ClientsPage").then((module) => ({ default: module.ClientsPage })));
const ClientDetailPage = lazy(() => import("./pages/ClientDetailPage").then((module) => ({ default: module.ClientDetailPage })));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage").then((module) => ({ default: module.ProjectDetailPage })));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const SearchPage = lazy(() => import("./pages/SearchPage").then((module) => ({ default: module.SearchPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const TeamPage = lazy(() => import("./pages/TeamPage").then((module) => ({ default: module.TeamPage })));
const TasksPage = lazy(() => import("./pages/TasksPage").then((module) => ({ default: module.TasksPage })));
const AuditLogsPage = lazy(() => import("./pages/AuditLogsPage").then((module) => ({ default: module.AuditLogsPage })));
const ClientProjectsPage = lazy(() => import("./pages/ClientProjectsPage").then((module) => ({ default: module.ClientProjectsPage })));
const ClientProjectDetailPage = lazy(() => import("./pages/ClientProjectDetailPage").then((module) => ({ default: module.ClientProjectDetailPage })));
const ClientReviewsPage = lazy(() => import("./pages/ClientReviewsPage").then((module) => ({ default: module.ClientReviewsPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));

function PageFallback() {
  return <div className="state-card" role="status">Loading page...</div>;
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<RoleHome />} />
        <Route path="/dashboard" element={<RequireRole role="staff"><DashboardPage /></RequireRole>} />
        <Route path="/clients" element={<RequireRole role="staff"><ClientsPage /></RequireRole>} />
        <Route path="/clients/:clientId" element={<RequireRole role="staff"><ClientDetailPage /></RequireRole>} />
        <Route path="/projects" element={<RequireRole role="staff"><ProjectsPage /></RequireRole>} />
        <Route path="/projects/:projectId" element={<RequireRole role="staff"><ProjectDetailPage /></RequireRole>} />
        <Route path="/tasks" element={<RequireRole role="staff"><TasksPage /></RequireRole>} />
        <Route path="/reports" element={<RequireRole role="staff"><ReportsPage /></RequireRole>} />
        <Route path="/search" element={<RequireRole role="staff"><SearchPage /></RequireRole>} />
        <Route path="/team" element={<RequireRole role="staff"><TeamPage /></RequireRole>} />
        <Route path="/audit-logs" element={<RequireRole role="staff"><AuditLogsPage /></RequireRole>} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/portal/projects" element={<RequireRole role="client"><ClientProjectsPage /></RequireRole>} />
        <Route path="/portal/projects/:projectId" element={<RequireRole role="client"><ClientProjectDetailPage /></RequireRole>} />
        <Route path="/portal/reviews" element={<RequireRole role="client"><ClientReviewsPage /></RequireRole>} />
      </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

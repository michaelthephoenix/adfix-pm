import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ClientsPage } from "./pages/ClientsPage";
import { ClientDetailPage } from "./pages/ClientDetailPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamPage } from "./pages/TeamPage";
import { TasksPage } from "./pages/TasksPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { SignupPage } from "./pages/SignupPage";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { ClientProjectsPage } from "./pages/ClientProjectsPage";
import { ClientProjectDetailPage } from "./pages/ClientProjectDetailPage";
import { RoleHome } from "./components/RoleHome";
import { RequireRole } from "./components/RequireRole";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
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
        <Route path="/portal/reviews" element={<RequireRole role="client"><ClientProjectsPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

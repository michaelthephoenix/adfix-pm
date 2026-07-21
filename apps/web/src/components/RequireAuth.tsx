import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../state/auth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isInitializing, user } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return <div className="state-card">Loading session...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.mustChangePassword && location.pathname !== "/settings") {
    return <Navigate to="/settings?passwordChange=required" replace />;
  }

  return <>{children}</>;
}

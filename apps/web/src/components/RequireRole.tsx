import { Navigate } from "react-router-dom";
import { useAuth } from "../state/auth";

export function RequireRole({ role, children }: { role: "staff" | "client"; children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.accountType !== role) {
    return <Navigate to={user?.accountType === "client" ? "/portal/projects" : "/dashboard"} replace />;
  }
  return <>{children}</>;
}

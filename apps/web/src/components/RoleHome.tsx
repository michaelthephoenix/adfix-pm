import { Navigate } from "react-router-dom";
import { useAuth } from "../state/auth";

export function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={user?.accountType === "client" ? "/portal/projects" : "/dashboard"} replace />;
}

import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { Navigate } from "react-router-dom";
import { useAuth } from "../state/auth";
export function RequireAuth({ children }) {
    const { isAuthenticated, isInitializing } = useAuth();
    if (isInitializing) {
        return _jsx("div", { className: "state-card", children: "Loading session..." });
    }
    if (!isAuthenticated) {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return _jsx(_Fragment, { children: children });
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../state/auth";
const navItems = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/projects", label: "Projects" },
    { to: "/notifications", label: "Notifications" }
];
export function AppShell() {
    const { user, logout } = useAuth();
    return (_jsxs("div", { className: "layout", children: [_jsxs("aside", { className: "sidebar", children: [_jsx("h1", { children: "Adfix PM" }), _jsx("nav", { children: navItems.map((item) => (_jsx(NavLink, { to: item.to, className: ({ isActive }) => (isActive ? "nav-link active" : "nav-link"), children: item.label }, item.to))) })] }), _jsxs("main", { className: "content", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Signed in as" }), _jsx("p", { children: user?.name })] }), _jsx("button", { onClick: () => logout(), className: "ghost-button", children: "Logout" })] }), _jsx(Outlet, {})] })] }));
}

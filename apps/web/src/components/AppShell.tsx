import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../state/auth";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/clients", label: "Clients" },
  { to: "/projects", label: "Projects" },
  { to: "/tasks", label: "Tasks" },
  { to: "/reports", label: "Reports" },
  { to: "/search", label: "Search" },
  { to: "/team", label: "Team" },
  { to: "/notifications", label: "Notifications" },
  { to: "/settings", label: "Settings" }
];

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Adfix PM</h1>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Signed in as</p>
            <div className="user-chip">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={`${user.name} avatar`} className="avatar" />
              ) : (
                <div className="avatar avatar-fallback">{(user?.name ?? "?").slice(0, 1).toUpperCase()}</div>
              )}
              <p>{user?.name}</p>
            </div>
          </div>
          <button onClick={() => logout()} className="ghost-button">
            Logout
          </button>
        </header>
        <Outlet />
      </main>
    </div>
  );
}

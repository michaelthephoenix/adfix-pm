import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../state/auth";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/projects", label: "Projects" },
  { to: "/notifications", label: "Notifications" }
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
            <p>{user?.name}</p>
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

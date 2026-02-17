import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/clients", label: "Clients" },
  { to: "/projects", label: "Projects" },
  { to: "/tasks", label: "Tasks" },
  { to: "/reports", label: "Reports" },
  { to: "/team", label: "Team" },
  { to: "/audit-logs", label: "Audit Logs", adminOnly: true }
];

function resolveHealthUrl() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
  const parsed = new URL(baseUrl);
  parsed.pathname = "/api/health";
  parsed.search = "";
  return parsed.toString();
}

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("adfix.sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [isApiHealthy, setIsApiHealthy] = useState<boolean | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const healthUrlRef = useRef(resolveHealthUrl());

  const checkApiHealth = useCallback(async () => {
    try {
      const response = await fetch(healthUrlRef.current, { method: "GET" });
      setIsApiHealthy(response.ok);
    } catch {
      setIsApiHealthy(false);
    }
  }, []);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!profileMenuRef.current) return;
      if (profileMenuRef.current.contains(event.target as Node)) return;
      setIsProfileMenuOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (location.pathname === "/search") {
      setSearchText(params.get("q") ?? "");
      return;
    }
    setSearchText("");
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsProfileMenuOpen(false);
      setIsMobileNavOpen(false);
      setIsMobileSearchOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setIsMobileNavOpen(false);
    setIsMobileSearchOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    try {
      localStorage.setItem("adfix.sidebar.collapsed", isSidebarCollapsed ? "1" : "0");
    } catch {
      // ignore persistence errors
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    void checkApiHealth();
    const intervalId = window.setInterval(() => {
      void checkApiHealth();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [checkApiHealth]);

  const onSubmitGlobalSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchText.trim();
    const params = new URLSearchParams();
    if (trimmed) params.set("q", trimmed);
    navigate(`/search${params.toString() ? `?${params.toString()}` : ""}`);
    setIsMobileSearchOpen(false);
  };

  const layoutClassName = [
    "layout",
    isSidebarCollapsed ? "sidebar-collapsed" : "",
    isMobileNavOpen ? "mobile-nav-open" : "",
    isMobileSearchOpen ? "mobile-search-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={layoutClassName}>
      <aside className="sidebar" id="app-sidebar">
        <div className="sidebar-head">
          <h1>{isSidebarCollapsed ? "AP" : "Adfix PM"}</h1>
          <button
            type="button"
            className="ghost-button sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((previous) => !previous)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isSidebarCollapsed}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? ">" : "<"}
          </button>
        </div>
        <nav>
          {navItems
            .filter((item) => !item.adminOnly || user?.isAdmin)
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
                title={item.label}
                onClick={() => setIsMobileNavOpen(false)}
              >
                <span className="nav-link-text">{item.label}</span>
              </NavLink>
            ))}
        </nav>
      </aside>
      <main className="content">
        <header className="topbar">
          <button
            type="button"
            className="icon-button mobile-menu-button"
            onClick={() => setIsMobileNavOpen((previous) => !previous)}
            aria-label={isMobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMobileNavOpen}
            aria-controls="app-sidebar"
            title={isMobileNavOpen ? "Close menu" : "Open menu"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {isMobileNavOpen ? (
                <path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 0 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z" />
              ) : (
                <path d="M4 6.5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm0 5.5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm1 4.5a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5Z" />
              )}
            </svg>
          </button>
          <form className="topbar-search" onSubmit={onSubmitGlobalSearch} id="global-search-form">
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search..."
              aria-label="Global search"
            />
          </form>
          <div className="topbar-actions">
            <div className={`api-health-pill ${isApiHealthy === false ? "offline" : "online"}`}>
              <span className="api-health-dot" />
              <span>{isApiHealthy === false ? "API Offline" : "API Online"}</span>
              {isApiHealthy === false ? (
                <button type="button" className="ghost-button health-retry" onClick={() => void checkApiHealth()}>
                  Retry
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="icon-button mobile-search-button"
              onClick={() => setIsMobileSearchOpen((previous) => !previous)}
              aria-label={isMobileSearchOpen ? "Hide search" : "Show search"}
              aria-expanded={isMobileSearchOpen}
              aria-controls="global-search-form"
              title={isMobileSearchOpen ? "Hide search" : "Show search"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10.5 3a7.5 7.5 0 0 1 5.98 12.03l4.74 4.74a1 1 0 1 1-1.42 1.42l-4.74-4.74A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" />
              </svg>
            </button>
            <NavLink
              to="/notifications"
              className={({ isActive }) => (isActive ? "icon-button active" : "icon-button")}
              aria-label="Notifications"
              title="Notifications"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-5H5a1 1 0 0 1-.8-1.6l1.3-1.73V10a6.5 6.5 0 0 1 5-6.3V3a1.5 1.5 0 0 1 3 0v.7a6.5 6.5 0 0 1 5 6.3v3.67l1.3 1.73A1 1 0 0 1 19 17Z" />
              </svg>
            </NavLink>
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                type="button"
                className="profile-trigger"
                onClick={() => setIsProfileMenuOpen((previous) => !previous)}
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
                aria-controls="profile-menu"
              >
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={`${user.name} avatar`} className="avatar" />
                ) : (
                  <div className="avatar avatar-fallback">{(user?.name ?? "?").slice(0, 1).toUpperCase()}</div>
                )}
                <span>{user?.name}</span>
              </button>
              {isProfileMenuOpen ? (
                <div className="profile-menu" id="profile-menu">
                  <button
                    type="button"
                    className="profile-menu-item"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      navigate("/settings");
                    }}
                  >
                    Settings
                  </button>
                  <button
                    type="button"
                    className="profile-menu-item"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      logout();
                    }}
                  >
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <Outlet />
      </main>
      {isMobileNavOpen ? (
        <button
          type="button"
          className="mobile-nav-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setIsMobileNavOpen(false)}
        />
      ) : null}
    </div>
  );
}

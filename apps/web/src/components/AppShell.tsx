import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../state/auth";
import { apiRequest } from "../lib/api";

type NavItem = { to: string; label: string; icon: LucideIcon; adminOnly?: boolean };

const staffNavItems: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: ClipboardList },
  { to: "/tasks", label: "Tasks", icon: FileCheck2 },
  { to: "/clients", label: "Clients", icon: BriefcaseBusiness },
  { to: "/team", label: "Team", icon: Users },
  { to: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  { to: "/audit-logs", label: "Audit log", icon: ShieldCheck, adminOnly: true }
];

const clientNavItems: NavItem[] = [
  { to: "/portal/projects", label: "Projects", icon: ClipboardList },
  { to: "/portal/reviews", label: "Reviews", icon: FileCheck2 },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/settings", label: "Profile", icon: Settings }
];

function resolveHealthUrl() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
  const parsed = new URL(baseUrl, window.location.origin);
  parsed.pathname = "/api/health";
  parsed.search = "";
  return parsed.toString();
}

export function AppShell() {
  const { user, accessToken, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const healthUrlRef = useRef(resolveHealthUrl());
  const isClient = user?.accountType === "client";
  const navItems = isClient ? clientNavItems : staffNavItems;
  const unreadNotificationsQuery = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiRequest<{ meta: { unreadCount: number } }>("/notifications?page=1&pageSize=1&unreadOnly=true", {
      accessToken: accessToken ?? undefined
    }),
    enabled: Boolean(accessToken),
    refetchInterval: 10_000
  });
  const unreadCount = unreadNotificationsQuery.data?.meta.unreadCount ?? 0;

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
      if (profileMenuRef.current?.contains(event.target as Node)) return;
      setIsProfileMenuOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setSearchText(location.pathname === "/search" ? params.get("q") ?? "" : "");
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !isClient) {
        event.preventDefault();
        setIsMobileSearchOpen(true);
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
        setIsMobileNavOpen(false);
        setIsMobileSearchOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isClient]);

  useEffect(() => {
    setIsMobileNavOpen(false);
    setIsMobileSearchOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    try {
      localStorage.setItem("adfix.sidebar.collapsed", isSidebarCollapsed ? "1" : "0");
    } catch {
      // The preference is optional.
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    void checkApiHealth();
    const intervalId = window.setInterval(() => void checkApiHealth(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [checkApiHealth]);

  const onSubmitGlobalSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchText.trim();
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
    setIsMobileSearchOpen(false);
  };

  const layoutClassName = [
    "layout",
    isSidebarCollapsed ? "sidebar-collapsed" : "",
    isMobileNavOpen ? "mobile-nav-open" : "",
    isMobileSearchOpen ? "mobile-search-open" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className={layoutClassName}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar" id="app-sidebar">
        <div className="sidebar-head">
          <NavLink to={isClient ? "/portal/projects" : "/dashboard"} className="brand-link" aria-label="Adfix home">
            <span className="brand-mark">A</span>
            <span className="brand-name">Adfix</span>
          </NavLink>
          <button
            type="button"
            className="ui-icon-button sidebar-toggle"
            onClick={() => setIsSidebarCollapsed((previous) => !previous)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isSidebarCollapsed}
          >
            {isSidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>
        <p className="sidebar-section-label">Workspace</p>
        <nav aria-label={isClient ? "Client navigation" : "Staff navigation"}>
          {navItems
            .filter((item) => !item.adminOnly || user?.isAdmin)
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}
                title={item.label}
              >
                <item.icon size={16} aria-hidden="true" />
                <span className="nav-link-text">{item.label}</span>
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-footer">
          <span className="workspace-dot" />
          <span className="nav-link-text">{isClient ? "Client portal" : "Adfix workspace"}</span>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <button
            type="button"
            className="ui-icon-button mobile-menu-button"
            onClick={() => setIsMobileNavOpen((previous) => !previous)}
            aria-label={isMobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={isMobileNavOpen}
            aria-controls="app-sidebar"
          >
            {isMobileNavOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {!isClient ? (
            <form className="topbar-search" onSubmit={onSubmitGlobalSearch} id="global-search-form">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search workspace"
                aria-label="Global search"
              />
              <kbd>Ctrl K</kbd>
            </form>
          ) : <div className="topbar-spacer" />}

          <div className="topbar-actions">
            {isApiHealthy === false ? (
              <button type="button" className="api-offline" onClick={() => void checkApiHealth()}>
                <span className="api-health-dot" /> Offline · Retry
              </button>
            ) : null}
            {!isClient ? (
              <button
                type="button"
                className="ui-icon-button mobile-search-button"
                onClick={() => setIsMobileSearchOpen((previous) => !previous)}
                aria-label={isMobileSearchOpen ? "Hide search" : "Show search"}
                aria-expanded={isMobileSearchOpen}
                aria-controls="global-search-form"
              >
                <Search size={17} />
              </button>
            ) : null}
            <NavLink to="/notifications" className="ui-icon-button notification-trigger" aria-label={`${unreadCount} unread notifications`} title="Notifications">
              <Bell size={17} />
              {unreadCount > 0 ? <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
            </NavLink>
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                type="button"
                className="profile-trigger"
                onClick={() => setIsProfileMenuOpen((previous) => !previous)}
                aria-label={user?.name ?? "Account"}
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
                aria-controls="profile-menu"
              >
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="avatar" />
                ) : (
                  <span className="avatar avatar-fallback">{(user?.name ?? "?").slice(0, 1).toUpperCase()}</span>
                )}
              </button>
              {isProfileMenuOpen ? (
                <div className="profile-menu" id="profile-menu" role="menu">
                  <div className="profile-menu-identity">
                    <strong>{user?.name}</strong>
                    <span>{user?.email}</span>
                  </div>
                  <button type="button" className="profile-menu-item" role="menuitem" onClick={() => { setIsProfileMenuOpen(false); navigate("/settings"); }}>Settings</button>
                  <button type="button" className="profile-menu-item danger" role="menuitem" onClick={() => { setIsProfileMenuOpen(false); logout(); }}>Logout</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="page-frame" id="main-content" tabIndex={-1}><Outlet /></div>
      </main>

      {isMobileNavOpen ? (
        <button type="button" className="mobile-nav-backdrop" aria-label="Close navigation menu" onClick={() => setIsMobileNavOpen(false)} />
      ) : null}
    </div>
  );
}

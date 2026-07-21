import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "./RequireAuth";

let authState = {
  isAuthenticated: true,
  isInitializing: false,
  user: {
    id: "user-1",
    email: "user@example.com",
    name: "User",
    isAdmin: false,
    accountType: "staff" as const,
    mustChangePassword: false
  }
};

vi.mock("../state/auth", () => ({ useAuth: () => authState }));

function renderProtected(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/dashboard" element={<RequireAuth><p>Dashboard</p></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><p>Security settings</p></RequireAuth>} />
        <Route path="/login" element={<p>Login</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    authState = {
      isAuthenticated: true,
      isInitializing: false,
      user: { ...authState.user, mustChangePassword: false }
    };
  });

  it("redirects an unauthenticated visitor to login", () => {
    authState = { ...authState, isAuthenticated: false };
    renderProtected("/dashboard");
    expect(screen.getByText("Login")).toBeInTheDocument();
  });

  it("redirects a temporary-password session to security settings", () => {
    authState = { ...authState, user: { ...authState.user, mustChangePassword: true } };
    renderProtected("/dashboard");
    expect(screen.getByText("Security settings")).toBeInTheDocument();
  });

  it("allows a temporary-password session to reach security settings", () => {
    authState = { ...authState, user: { ...authState.user, mustChangePassword: true } };
    renderProtected("/settings");
    expect(screen.getByText("Security settings")).toBeInTheDocument();
  });
});

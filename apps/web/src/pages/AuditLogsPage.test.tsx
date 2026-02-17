import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuditLogsPage } from "./AuditLogsPage";

const apiRequestMock = vi.fn();

vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args)
}));

vi.mock("../state/auth", () => ({
  useAuth: vi.fn(() => ({
    accessToken: "token",
    user: {
      id: "u2",
      email: "member@adfix.local",
      name: "Member User",
      isAdmin: false
    }
  }))
}));

describe("AuditLogsPage", () => {
  it("shows restricted message for non-admin users", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuditLogsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      screen.getByText("Audit logs are restricted to owner/high-clearance users.")
    ).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});

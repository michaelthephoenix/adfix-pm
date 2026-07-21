import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api";
import { useAuth } from "../state/auth";
import { InviteAcceptPage } from "./InviteAcceptPage";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock("../state/auth", () => ({ useAuth: vi.fn() }));

function renderInvitation() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/invite/a-secure-invitation-token"]}>
        <Routes>
          <Route path="/invite/:token" element={<InviteAcceptPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("client invitation acceptance", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      adoptSession: vi.fn(),
      logout: vi.fn()
    } as unknown as ReturnType<typeof useAuth>);
  });

  it("directs an existing client account through sign-in instead of account creation", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: {
        clientName: "Acme",
        email: "client@acme.test",
        role: "reviewer",
        expiresAt: "2026-07-28T10:00:00.000Z",
        isValid: true,
        accountExists: true
      }
    });

    renderInvitation();

    expect(await screen.findByRole("button", { name: "Sign in to accept" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Create password")).not.toBeInTheDocument();
    expect(screen.getAllByText("client@acme.test")).toHaveLength(2);
  });

  it("blocks acceptance while signed in with a different account", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: "wrong-user",
        email: "wrong@acme.test",
        name: "Wrong User",
        isAdmin: false,
        accountType: "client",
        mustChangePassword: false
      },
      accessToken: "access-token",
      adoptSession: vi.fn(),
      logout: vi.fn()
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(apiRequest).mockResolvedValue({
      data: {
        clientName: "Acme",
        email: "client@acme.test",
        role: "reviewer",
        expiresAt: "2026-07-28T10:00:00.000Z",
        isValid: true,
        accountExists: true
      }
    });

    renderInvitation();

    expect(await screen.findByRole("button", { name: "Sign in with invited email" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("wrong@acme.test");
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });
});

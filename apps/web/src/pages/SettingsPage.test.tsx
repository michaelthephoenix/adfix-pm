import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

const apiRequestMock = vi.fn();
const updateLocalUserMock = vi.fn();
const logoutMock = vi.fn();
let authUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Old name",
  isAdmin: false,
  accountType: "staff" as const,
  mustChangePassword: false
};

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: (...args: unknown[]) => apiRequestMock(...args)
}));

vi.mock("../state/auth", () => ({
  useAuth: () => ({
    user: authUser,
    accessToken: "access-token",
    updateLocalUser: updateLocalUserMock,
    logout: logoutMock
  })
}));

const profileResponse = {
  data: {
    id: "user-1",
    email: "user@example.com",
    name: "Current name",
    avatar_url: null,
    is_active: true,
    is_admin: false
  }
};

function renderPage(initialEntry = "/settings") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<p>Password change complete</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    updateLocalUserMock.mockReset();
    logoutMock.mockReset().mockResolvedValue(undefined);
    authUser = {
      id: "user-1",
      email: "user@example.com",
      name: "Old name",
      isAdmin: false,
      accountType: "staff",
      mustChangePassword: false
    };
  });

  it("loads profile data without rewriting the auth session in a render loop", async () => {
    apiRequestMock.mockResolvedValue(profileResponse);
    renderPage();

    await waitFor(
      () => expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Current name"),
      { timeout: 5_000 }
    );
    expect(updateLocalUserMock).not.toHaveBeenCalled();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it("updates the local session only after a successful save", async () => {
    apiRequestMock
      .mockResolvedValueOnce(profileResponse)
      .mockResolvedValueOnce({ data: { ...profileResponse.data, name: "Updated name" } });

    renderPage();
    const nameInput = await screen.findByRole("textbox", { name: "Name" });
    fireEvent.change(nameInput, { target: { value: "Updated name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateLocalUserMock).toHaveBeenCalledWith({
      name: "Updated name",
      avatarUrl: null
    }));
  });

  it("keeps forced-reset users on the password form and signs out every session after success", async () => {
    authUser = { ...authUser, mustChangePassword: true };
    apiRequestMock.mockResolvedValue(undefined);
    renderPage("/settings?passwordChange=required");

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a permanent password");
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "TemporaryPassword123!" } });
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "PermanentPassword456!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "PermanentPassword456!" } });
    fireEvent.click(screen.getByRole("button", { name: "Set permanent password" }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith("/users/me/change-password", expect.objectContaining({
      method: "POST",
      body: { currentPassword: "TemporaryPassword123!", newPassword: "PermanentPassword456!" }
    })));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Password change complete")).toBeInTheDocument();
  });

  it("does not submit mismatched new passwords", async () => {
    apiRequestMock.mockResolvedValue(profileResponse);
    renderPage();
    await screen.findByRole("textbox", { name: "Name" });

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "CurrentPassword123!" } });
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: "PermanentPassword456!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "DifferentPassword789!" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("New passwords do not match");
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  it("lets administrators issue a one-time temporary password", async () => {
    authUser = { ...authUser, isAdmin: true };
    apiRequestMock.mockImplementation((path: string) => path.startsWith("/users/user-")
      ? Promise.resolve(profileResponse)
      : Promise.resolve({
        data: {
          id: "target-1",
          email: "target@example.com",
          name: "Target user",
          accountType: "staff",
          temporaryPassword: "OneTimePassword123!",
          mustChangePassword: true
        }
      }));
    renderPage();
    await screen.findByRole("textbox", { name: "Name" });

    fireEvent.change(screen.getByRole("textbox", { name: "Account email" }), { target: { value: "target@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue temporary password" }));

    expect(await screen.findByText("OneTimePassword123!")).toBeInTheDocument();
    expect(apiRequestMock).toHaveBeenCalledWith("/users/admin/password-reset", expect.objectContaining({
      method: "POST",
      body: { email: "target@example.com" }
    }));
  });
});

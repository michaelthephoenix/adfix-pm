import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";

const apiRequestMock = vi.fn();
const setRefreshHandlerMock = vi.fn();

vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  setRefreshHandler: (...args: unknown[]) => setRefreshHandlerMock(...args),
  setUnauthorizedHandler: vi.fn()
}));

function TestHarness() {
  const { isAuthenticated, isInitializing, login, user } = useAuth();
  return <div>
    <p data-testid="initializing">{String(isInitializing)}</p>
    <p data-testid="is-authenticated">{String(isAuthenticated)}</p>
    <p data-testid="user-email">{user?.email ?? ""}</p>
    <button type="button" onClick={() => login("admin@adfix.local", "ChangeMe123!")}>login</button>
  </div>;
}

const loginSession = {
  accessToken: "access-login",
  user: { id: "u1", email: "admin@adfix.local", name: "Adfix Admin", isAdmin: true, accountType: "staff" }
};

describe("AuthProvider", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    setRefreshHandlerMock.mockReset();
    localStorage.clear();
  });

  it("keeps access credentials in memory after login", async () => {
    apiRequestMock.mockImplementation((path: string) => path === "/auth/refresh" ? Promise.reject(new Error("no cookie")) : Promise.resolve(loginSession));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<AuthProvider><TestHarness /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("initializing")).toHaveTextContent("false"));
    await userEvent.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => expect(screen.getByTestId("is-authenticated")).toHaveTextContent("true"));
    expect(screen.getByTestId("user-email")).toHaveTextContent("admin@adfix.local");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("restores a session using the refresh cookie", async () => {
    apiRequestMock.mockResolvedValue(loginSession);
    render(<AuthProvider><TestHarness /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("initializing")).toHaveTextContent("false"));
    expect(screen.getByTestId("is-authenticated")).toHaveTextContent("true");
    expect(apiRequestMock).toHaveBeenCalledWith("/auth/refresh", expect.objectContaining({ skipAuthRetry: true }));
    expect(setRefreshHandlerMock).toHaveBeenCalled();
  });
});

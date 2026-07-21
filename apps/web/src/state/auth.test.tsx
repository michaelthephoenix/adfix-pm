import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { AuthProvider, useAuth } from "./auth";

const apiRequestMock = vi.fn();
const setRefreshHandlerMock = vi.fn();

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code: string | null;

    constructor(message: string, status: number, code: string | null = null) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
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
  user: {
    id: "u1",
    email: "admin@adfix.local",
    name: "Adfix Admin",
    isAdmin: true,
    accountType: "staff",
    mustChangePassword: false
  }
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

  it("retries session restoration once after another tab rotates the cookie", async () => {
    apiRequestMock
      .mockRejectedValueOnce(new ApiError("Already rotated", 409, "REFRESH_ALREADY_ROTATED"))
      .mockResolvedValueOnce(loginSession);

    render(<AuthProvider><TestHarness /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId("initializing")).toHaveTextContent("false"));
    expect(screen.getByTestId("is-authenticated")).toHaveTextContent("true");
    expect(apiRequestMock).toHaveBeenCalledTimes(2);
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth";

const apiRequestMock = vi.fn();
let storageBacking: Record<string, string> = {};

vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  setUnauthorizedHandler: vi.fn()
}));

function TestHarness() {
  const { isAuthenticated, login, signup, user } = useAuth();

  return (
    <div>
      <p data-testid="is-authenticated">{String(isAuthenticated)}</p>
      <p data-testid="user-email">{user?.email ?? ""}</p>
      <button type="button" onClick={() => login("admin@adfix.local", "ChangeMe123!")}>
        login
      </button>
      <button
        type="button"
        onClick={() =>
          signup({
            email: "new-user@adfix.local",
            name: "New User",
            password: "SignupPass123!"
          })
        }
      >
        signup
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    storageBacking = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key in storageBacking ? storageBacking[key] : null),
      setItem: (key: string, value: string) => {
        storageBacking[key] = value;
      },
      removeItem: (key: string) => {
        delete storageBacking[key];
      }
    });
  });

  it("persists tokens/user in localStorage after login", async () => {
    const user = userEvent.setup();
    apiRequestMock.mockResolvedValueOnce({
      accessToken: "access-login",
      refreshToken: "refresh-login",
      user: {
        id: "u1",
        email: "admin@adfix.local",
        name: "Adfix Admin",
        isAdmin: true
      }
    });

    render(
      <AuthProvider>
        <TestHarness />
      </AuthProvider>
    );

    await user.click(screen.getByRole("button", { name: "login" }));

    await waitFor(() => {
      expect(screen.getByTestId("is-authenticated")).toHaveTextContent("true");
      expect(screen.getByTestId("user-email")).toHaveTextContent("admin@adfix.local");
    });

    const stored = JSON.parse(localStorage.getItem("adfix.auth.v1") ?? "{}") as {
      accessToken?: string;
      refreshToken?: string;
      user?: { email?: string };
    };
    expect(stored.accessToken).toBe("access-login");
    expect(stored.refreshToken).toBe("refresh-login");
    expect(stored.user?.email).toBe("admin@adfix.local");
  });

  it("persists tokens/user in localStorage after signup", async () => {
    const user = userEvent.setup();
    apiRequestMock.mockResolvedValueOnce({
      accessToken: "access-signup",
      refreshToken: "refresh-signup",
      user: {
        id: "u2",
        email: "new-user@adfix.local",
        name: "New User",
        isAdmin: false
      }
    });

    render(
      <AuthProvider>
        <TestHarness />
      </AuthProvider>
    );

    await user.click(screen.getByRole("button", { name: "signup" }));

    await waitFor(() => {
      expect(screen.getByTestId("is-authenticated")).toHaveTextContent("true");
      expect(screen.getByTestId("user-email")).toHaveTextContent("new-user@adfix.local");
    });

    const stored = JSON.parse(localStorage.getItem("adfix.auth.v1") ?? "{}") as {
      accessToken?: string;
      refreshToken?: string;
      user?: { email?: string };
    };
    expect(stored.accessToken).toBe("access-signup");
    expect(stored.refreshToken).toBe("refresh-signup");
    expect(stored.user?.email).toBe("new-user@adfix.local");
  });
});

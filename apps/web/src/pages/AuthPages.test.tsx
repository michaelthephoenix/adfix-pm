import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

vi.mock("../state/auth", () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: false,
    login: vi.fn()
  }))
}));

describe("auth pages", () => {
  it("explains that client access is invitation-only", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/secure invitation/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign up/i })).not.toBeInTheDocument();
  });

  it("prefills an invited email without exposing demo credentials", () => {
    render(
      <MemoryRouter initialEntries={["/login?email=client%40example.com&returnTo=%2Finvite%2Fsecure-token"]}>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.getByLabelText("Email")).toHaveValue("client@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const logoutMock = vi.fn();

vi.mock("../state/auth", () => ({
  useAuth: vi.fn(() => ({
    user: {
      id: "u1",
      email: "admin@adfix.local",
      name: "Adfix Admin",
      isAdmin: true
    },
    logout: logoutMock
  }))
}));

describe("AppShell", () => {
  it("opens profile dropdown and calls logout", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<div>Dashboard Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: /adfix admin/i }));
    await user.click(screen.getByRole("button", { name: /logout/i }));

    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it("toggles mobile search class when search icon is clicked", async () => {
    const user = userEvent.setup();

    const { container } = render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<div>Dashboard Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const layout = container.querySelector(".layout");
    expect(layout).not.toBeNull();
    expect(layout?.classList.contains("mobile-search-open")).toBe(false);

    const searchButtons = within(container).getAllByRole("button", { name: /show search/i });
    await user.click(searchButtons[0]);
    expect(layout?.classList.contains("mobile-search-open")).toBe(true);
  });
});

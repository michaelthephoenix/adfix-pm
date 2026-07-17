import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { UIProvider, useUI } from "./ui";

function ConfirmHarness() {
  const ui = useUI();
  const [result, setResult] = useState("pending");

  const openConfirmation = async () => {
    const confirmed = await ui.confirm({
      title: "Move project to Delivery?",
      message: "Client review actions will close.",
      confirmLabel: "Move to Delivery",
      cancelLabel: "Keep in review",
      tone: "warning"
    });
    setResult(String(confirmed));
  };

  return (
    <>
      <button type="button" onClick={() => void openConfirmation()}>Open confirmation</button>
      <output>{result}</output>
    </>
  );
}

describe("UIProvider confirmation", () => {
  it("renders the Delivery warning in-app and resolves both actions", async () => {
    const user = userEvent.setup();
    render(<UIProvider><ConfirmHarness /></UIProvider>);

    await user.click(screen.getByRole("button", { name: "Open confirmation" }));
    expect(screen.getByRole("dialog", { name: "Move project to Delivery?" })).toHaveClass("confirm-warning");
    expect(screen.getByRole("button", { name: "Keep in review" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Keep in review" }));
    expect(screen.getByRole("status")).toHaveTextContent("false");

    await user.click(screen.getByRole("button", { name: "Open confirmation" }));
    await user.click(screen.getByRole("button", { name: "Move to Delivery" }));
    expect(screen.getByRole("status")).toHaveTextContent("true");
  });
});

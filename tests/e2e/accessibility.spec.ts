import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function expectNoSeriousAccessibilityIssues(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
}

test.describe("primary-route accessibility", () => {
  test.describe.configure({ timeout: 90_000 });
  test("staff can use keyboard login and primary workspace routes pass axe", async ({ page }) => {
    await page.goto("/login");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.keyboard.type("admin@adfix.local");
    await page.keyboard.press("Tab");
    await page.keyboard.type("ChangeMe123!");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dashboard$/);

    for (const route of ["/dashboard", "/projects", "/tasks", "/team", "/notifications", "/settings"]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expectNoSeriousAccessibilityIssues(page);
    }
  });

  test("client navigation is isolated and review routes pass axe", async ({ page }) => {
    await signIn(page, "client@adfix.local", "DemoUser123!");
    await expect(page.getByRole("navigation", { name: "Client navigation" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0);

    for (const route of ["/portal/projects", "/portal/reviews", "/notifications", "/settings"]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expectNoSeriousAccessibilityIssues(page);
    }
  });
});

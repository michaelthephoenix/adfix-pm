import { expect, test } from "@playwright/test";

test("login screen visual baseline", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("login.png", {
    animations: "disabled",
    fullPage: true,
    maxDiffPixelRatio: 0.01
  });
});

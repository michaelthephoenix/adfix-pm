import { expect, test } from "@playwright/test";

test("unknown authenticated routes show a useful 404 instead of redirecting", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@adfix.local");
  await page.getByLabel("Password").fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/this-route-does-not-exist");
  await expect(page.getByRole("heading", { name: "That page is not part of this workspace" })).toBeVisible();
  await expect(page).toHaveURL(/this-route-does-not-exist/);
});

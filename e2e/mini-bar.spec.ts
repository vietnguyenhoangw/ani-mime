import { test, expect } from "@playwright/test";
import { tauriMockScript } from "./tauri-mock";

async function loadWithMock(page: import("@playwright/test").Page) {
  await page.addInitScript(tauriMockScript);
  await page.goto("/");
}

test("minimize collapses the pet into a bar, restore brings it back", async ({ page }) => {
  await loadWithMock(page);
  // Enter mini mode.
  await page.getByTestId("pill-action-minimize").click();
  const bar = page.getByTestId("mini-bar");
  await expect(bar).toBeVisible();
  // Pet column is gone.
  await expect(page.getByTestId("status-pill")).toHaveCount(0);
  // Restore.
  await page.getByTestId("mini-bar-restore").click();
  await expect(page.getByTestId("status-pill")).toBeVisible();
  await expect(page.getByTestId("mini-bar")).toHaveCount(0);
});

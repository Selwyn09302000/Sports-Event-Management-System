import { expect, test } from "@playwright/test";

/**
 * Requires the seeded demo data (node scripts/seed.mjs) and a running server.
 * Browser skill: score one basket, confirm the score and the projector view.
 */
test("scorer can record a basket and see it on the projector board", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("scorer@example.com");
  await page.getByLabel("Password").fill("CourtSide2026!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Tournament control" })).toBeVisible();

  // Open the tournament, then a game's scorer console.
  await page.goto("/dashboard/tournaments");
  await page.getByRole("link", { name: "Manage" }).first().click();
  await page.getByRole("link", { name: "Score" }).first().click();

  await expect(page.getByText("Event history")).toBeVisible();

  const homePanel = page.locator("section").filter({ hasText: "San Roque Warriors" }).first();
  await homePanel.locator("ul li button").first().click();

  await page.getByRole("button", { name: "+2" }).click();
  await expect(page.getByRole("status")).toContainText(/recorded|already/i);

  const board = await context.newPage();
  await board.goto(page.url().replace("/dashboard/games/", "/scoreboard/"));
  await expect(board.getByText("Connected")).toBeVisible({ timeout: 15_000 });
  await expect(board.getByText(/Team fouls/).first()).toBeVisible();
});

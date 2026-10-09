import { expect, test } from "@playwright/test";

test("legal pages identify themselves as drafts", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText("Draft awaiting operator approval.")).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms" })).toBeVisible();
});

test("activity share does not invent private participants", async ({ page }) => {
  await page.goto("/a/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");
  await expect(page.getByRole("heading")).toBeVisible();
  await expect(page.getByText("Participant lists and chats stay in the app.")).toBeVisible();
});

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows the configured day and initial range", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Zeitfenster planen" }),
  ).toBeVisible();
  await expect(page.getByText("09:00–10:30")).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Beginn anpassen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Ende anpassen" }),
  ).toBeVisible();
});

test("allows keyboard users to adjust both boundaries", async ({ page }) => {
  const start = page.getByRole("slider", { name: "Beginn anpassen" });
  const end = page.getByRole("slider", { name: "Ende anpassen" });

  await start.focus();
  await start.press("ArrowDown");
  await expect(page.getByText("08:45–10:30")).toBeVisible();

  await end.focus();
  await end.press("ArrowUp");
  await expect(page.getByText("08:45–10:45")).toBeVisible();
});

test("switches to fine resolution when dragging inward from the left", async ({
  page,
}) => {
  const surface = page.getByTestId("time-range-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("Time range surface is not visible");

  await page.mouse.move(box.x + 10, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + 18, box.y + box.height * 0.5);
  await expect(page.getByText(/Feinmodus/)).toHaveCount(0);
  await page.mouse.move(box.x + 100, box.y + box.height * 0.51);
  await expect(page.getByText("Feinmodus · 3 min")).toBeVisible();
  await expect(page.getByText("09:00–12:06")).toBeVisible();
  await page.mouse.move(box.x + 20, box.y + box.height * 0.5);
  await expect(page.getByText(/Feinmodus/)).toHaveCount(0);
  await page.mouse.up();
});

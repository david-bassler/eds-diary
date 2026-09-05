import { expect, test } from "@playwright/test";

test("exposes an installable web app manifest", async ({ page, request }) => {
  await page.goto("/");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBeTruthy();

  const manifestResponse = await request.get(manifestHref!);
  expect(manifestResponse.ok()).toBe(true);

  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    name: "EDS Schmerztagebuch",
    short_name: "EDS Tagebuch",
    display: "standalone",
    start_url: "./",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ purpose: "any" }),
      expect.objectContaining({ purpose: "maskable" }),
    ]),
  );
});

test("serves the service worker", async ({ request }) => {
  const serviceWorkerResponse = await request.get("/sw.js");

  expect(serviceWorkerResponse.ok()).toBe(true);
  expect(await serviceWorkerResponse.text()).toContain(
    "eds-diary-shell-v1",
  );
});

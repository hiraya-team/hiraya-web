import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("renders an accessible responsive shell", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your local workspace is ready." })).toBeVisible();
  const control = page.getByRole("button", { name: "Reload shell" });
  await control.focus();
  const box = await control.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 195, height: 422 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("shows an explicit unsupported-storage state", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(navigator.storage, "getDirectory", { configurable: true, value: undefined }));
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "This browser cannot open Hiraya yet." })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("origin-private file storage");
  await context.close();
});

test("reports service-worker installation failure", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Offline setup needs attention." })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("could not be installed");
  await context.close();
});

test("preserves caches outside this shell scope", async ({ page }) => {
  await page.goto("/icon.svg");
  await page.evaluate(async () => { await caches.open("hiraya-shell-unrelated-scope"); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your local workspace is ready." })).toBeVisible();
  expect(await page.evaluate(async () => (await caches.keys()).includes("hiraya-shell-unrelated-scope"))).toBe(true);
});

test("installs the manifest and reloads offline without caching API requests", async ({ page, context }) => {
  const failures: string[] = [];
  page.on("requestfailed", (request) => failures.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  await page.goto("/");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).icons[0].src).toBe("icon.svg");
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active && navigator.serviceWorker.controller);
  })).toBe(true);
  const precached = await page.evaluate(async () => (await Promise.all((await caches.keys()).filter((name) => name.startsWith("hiraya-shell-")).map(async (name) => (await caches.open(name)).keys()))).flat().map((request) => new URL(request.url).pathname));
  expect(precached).toContain("/index.html");
  expect(precached).toContain("/manifest.webmanifest");
  expect(precached.some((pathname) => pathname.startsWith("/assets/") && pathname.endsWith(".js"))).toBe(true);
  await expect(page.request.get("/icon.svg")).resolves.toBeTruthy();
  await context.setOffline(true);
  await page.reload();
  expect(failures).toEqual([]);
  await expect(page.getByRole("heading", { name: "Your local workspace is ready." })).toBeVisible();
  expect(await page.evaluate(async () => {
    try { await fetch("/api/e2e-service-worker-exclusion"); return false; } catch { return true; }
  })).toBe(true);
  expect(await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await caches.open(name)).keys()))).flat().every((request) => !new URL(request.url).pathname.startsWith("/api/")))).toBe(true);
  await context.setOffline(false);
});

test("removes nonessential motion when requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(await page.getByRole("button").evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
});

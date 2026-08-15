import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openShell(page: Page) {
  await page.goto("/");
  if (new URL(page.url()).pathname !== "/login") return;
  const email = process.env.HIRAYA_E2E_EMAIL;
  const password = process.env.HIRAYA_E2E_PASSWORD;
  if (!email || !password) throw new Error("The server redirected to login without HIRAYA_E2E_EMAIL and HIRAYA_E2E_PASSWORD.");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([page.waitForURL((url) => url.pathname === "/"), page.getByRole("button", { name: "Sign in" }).click()]);
}

test("renders an accessible responsive shell", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await openShell(page);
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
  await openShell(page);
  await expect(page.getByRole("heading", { name: "This browser cannot open Hiraya yet." })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("origin-private file storage");
  await context.close();
});

test("reports service-worker installation failure", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await openShell(page);
  await expect(page.getByRole("heading", { name: "Offline setup needs attention." })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("could not be installed");
  await context.close();
});

test("preserves caches outside this shell scope", async ({ page }) => {
  await page.goto("/icon.svg");
  await page.evaluate(async () => { await caches.open("hiraya-shell-unrelated-scope"); });
  await openShell(page);
  await expect(page.getByRole("heading", { name: "Your local workspace is ready." })).toBeVisible();
  expect(await page.evaluate(async () => (await caches.keys()).includes("hiraya-shell-unrelated-scope"))).toBe(true);
});

test("installs the manifest and reloads offline without caching API requests", async ({ page, context }) => {
  const failures: string[] = [];
  page.on("requestfailed", (request) => failures.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  await openShell(page);
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
  await openShell(page);
  expect(await page.getByRole("button").evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
});

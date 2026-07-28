import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";

async function openLocalDesktop(page: Page) {
  await page.goto("/");
  await expect(page.locator(".desktop-shell")).toBeVisible();
  const onboarding = page.getByRole("button", { name: "Open desktop" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();
  await expect(onboarding).toBeHidden();
}

test("keyboard modal traps focus, closes with Escape, and restores its invoker", async ({ page }) => {
  await openLocalDesktop(page);
  const search = page.getByRole("button", { name: "Search files, windows, and commands" });
  await search.focus();
  await expect(search).toBeFocused();
  await search.click();
  const dialog = page.getByRole("dialog", { name: /Search/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("input")).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  const results = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(search).toBeFocused();
});

test("local mutation persists through reload", async ({ page }) => {
  await openLocalDesktop(page);
  const name = `e2e-${Date.now()}.txt`;
  await page.getByRole("button", { name: "New", exact: true }).click();
  const createTextFile = page.locator(".mobile-header-menu__panel").getByRole("button", { name: "New text file" });
  await expect(createTextFile).toBeEnabled();
  await createTextFile.click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
});

test("reduced motion disables desktop transitions and animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLocalDesktop(page);
  const motion = await page.locator(".desktop-minimap").evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  expect(parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.001);
  expect(parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.001);
});

test("service worker excludes API responses from navigation fallback and caches", async ({ page }) => {
  await openLocalDesktop(page);
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("Service workers are unavailable.");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/e2e-service-worker-exclusion", { cache: "no-store" });
    const text = await response.text();
    const cachedApiRequests = (await Promise.all((await caches.keys()).map(async (key) => (await caches.open(key)).keys()))).flat().filter((request) => new URL(request.url).pathname.startsWith("/api/"));
    return { status: response.status, text, cachedApiCount: cachedApiRequests.length };
  });
  expect(result.status).not.toBe(200);
  expect(result.text).not.toContain("Hiraya Desktop");
  expect(result.cachedApiCount).toBe(0);
});

test("collapsed area switcher passes edge swipes through to the desktop", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await openLocalDesktop(page);

  const switcher = page.locator(".desktop-minimap");
  const handle = page.locator(".desktop-minimap__handle");
  const body = page.locator(".desktop-minimap__body");
  await expect(switcher).toHaveCSS("pointer-events", "none");
  await expect(handle).toHaveCSS("pointer-events", "auto");
  await expect(body).toHaveCSS("pointer-events", "none");

  const blockedStripPoint = await switcher.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: window.innerWidth - 22, y: bounds.top + 20 };
  });
  await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".desktop")?.classList.contains("desktop") ?? false, blockedStripPoint)).toBe(true);

  const initialLabel = await handle.getAttribute("aria-label");
  const client = await context.newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [blockedStripPoint] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: blockedStripPoint.x - 40, y: blockedStripPoint.y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: blockedStripPoint.x - 100, y: blockedStripPoint.y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(handle).not.toHaveAttribute("aria-label", initialLabel ?? "");

  await handle.click();
  await expect(switcher).toHaveAttribute("data-expanded", "true");
  await expect(body).toHaveCSS("pointer-events", "auto");
  await context.close();
});

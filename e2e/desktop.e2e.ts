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

test("mobile Start and area controls own distinct shell actions", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await openLocalDesktop(page);

  const start = page.getByRole("button", { name: /Start; account, system, and windows/ });
  await start.click();
  const startMenu = page.getByRole("dialog", { name: /Start; account, system, and windows/ });
  await expect(startMenu).toBeVisible();
  await expect(startMenu.getByRole("button", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(start).toBeFocused();

  const switcher = page.locator(".desktop-minimap");
  const body = page.locator(".desktop-minimap__body");
  const trigger = page.getByRole("button", { name: /Open area switcher/ });
  await expect(switcher).toHaveCSS("pointer-events", "none");
  await expect(body).toHaveCSS("pointer-events", "none");
  await expect(page.locator(".desktop-minimap__handle")).toHaveCount(0);
  await trigger.click();
  await expect(switcher).toHaveAttribute("data-expanded", "true");
  await expect(body).toHaveCSS("pointer-events", "auto");
  await expect(switcher).toHaveCSS("visibility", "visible");
  await expect.poll(() => switcher.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(44);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await context.close();
});

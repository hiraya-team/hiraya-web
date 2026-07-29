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
  const trigger = page.locator(".mobile-area-switcher-trigger");
  await expect(switcher).toHaveCount(0);
  await expect(page.locator(".desktop-minimap__handle")).toHaveCount(0);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(switcher).toHaveAttribute("data-expanded", "true");
    await expect(switcher).toHaveCSS("animation-name", "notification-panel-in");
    await expect(page.locator(".desktop-minimap__body")).toHaveCSS("pointer-events", "auto");
    await expect.poll(() => switcher.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(44);
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(switcher).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }

  await trigger.click();
  await start.click();
  await expect(switcher).toHaveCount(0);
  await expect(startMenu).toBeVisible();
  await page.keyboard.press("Escape");

  await trigger.click();
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(switcher).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  await page.keyboard.press("Escape");

  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(switcher).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.tap();
  await page.getByRole("button", { name: /1 right of Home/ }).tap();
  await expect(page).toHaveURL(/\/areas\/1\/0$/);
  await expect(switcher).toHaveCount(0);

  await trigger.tap();
  await trigger.tap();
  await expect(page).toHaveURL(/\/areas\/0\/0$/);
  await expect(switcher).toHaveCount(0);
  await context.close();
});

test("mobile taps select the full desktop icon footprint", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await openLocalDesktop(page);

  await page.getByRole("region", { name: "Desktop desktop" }).getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill("touch-target.txt");
  await page.getByRole("button", { name: "Create file" }).click();

  const icon = page.locator('.file-icon[data-entry-id]').filter({ hasText: "touch-target.txt" });
  await expect(icon).toBeVisible();
  const bounds = await icon.boundingBox();
  expect(bounds).not.toBeNull();
  await page.touchscreen.tap(bounds!.x + bounds!.width / 2, bounds!.y + 3);
  await expect(icon).toHaveAttribute("aria-pressed", "true");

  await context.close();
});

test("taskbar popups stay above the mobile action pill", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 360 } });
  const page = await context.newPage();
  await openLocalDesktop(page);

  const toolbar = page.getByRole("toolbar", { name: "File actions" });
  await expect(toolbar).toBeVisible();
  await page.getByRole("button", { name: /Start; account, system, and windows/ }).click();
  const panel = page.getByRole("dialog", { name: /Start; account, system, and windows/ });
  await expect(panel).toBeVisible();

  const toolbarElement = await toolbar.elementHandle();
  if (!toolbarElement) throw new Error("Mobile action toolbar was not mounted.");
  const overlap = await panel.evaluate((element, actionToolbar) => {
    const panelBounds = element.getBoundingClientRect();
    const toolbarBounds = actionToolbar.getBoundingClientRect();
    return {
      left: Math.max(panelBounds.left, toolbarBounds.left),
      right: Math.min(panelBounds.right, toolbarBounds.right),
      top: Math.max(panelBounds.top, toolbarBounds.top),
      bottom: Math.min(panelBounds.bottom, toolbarBounds.bottom),
    };
  }, toolbarElement);
  expect(overlap.right).toBeGreaterThan(overlap.left);
  expect(overlap.bottom).toBeGreaterThan(overlap.top);
  await expect.poll(() => page.evaluate(({ left, right, top, bottom }) => {
    const target = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return target?.closest(".mobile-header-menu__panel") !== null;
  }, overlap)).toBe(true);

  await context.close();
});

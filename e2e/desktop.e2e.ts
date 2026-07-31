import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Locator, type Page } from "@playwright/test";

async function openLocalDesktop(page: Page) {
  await page.goto("/");
  await expect(page.locator(".desktop-shell")).toBeVisible();
  const onboarding = page.getByRole("button", { name: "Open desktop" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();
  await expect(onboarding).toBeHidden();
}

async function resizeWindowWidth(page: Page, appWindow: Locator, width: number) {
  for (let step = 0; step < 30 && ((await appWindow.boundingBox())?.width ?? 0) > width + 2; step += 1) {
    await page.keyboard.press("Alt+Control+ArrowLeft");
  }
  await expect.poll(async () => Math.round((await appWindow.boundingBox())?.width ?? 0)).toBeLessThanOrEqual(width + 2);
}

test("keyboard modal traps focus, closes with Escape, and restores its invoker", async ({ page }) => {
  await openLocalDesktop(page);
  const search = page.getByRole("button", { name: "Search apps, files, windows, and commands" });
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

test("search launches installed apps from the keyboard", async ({ page }) => {
  await openLocalDesktop(page);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Text Editor");
  await expect(search.getByRole("group", { name: "Apps" }).getByRole("option", { name: /Text Editor/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Text Editor" })).toBeVisible();
});

test("app file picker expands folders and keeps hidden selections", async ({ page }) => {
  await openLocalDesktop(page);
  const folderName = `picker-${Date.now()}`;
  const fileName = "nested.txt";
  const fileActions = page.getByRole("toolbar", { name: "File actions" });

  await fileActions.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(folderName);
  await page.getByRole("button", { name: "Create folder" }).click();
  await page.locator(".file-icon").filter({ hasText: folderName }).dblclick();

  const folderWindow = page.getByRole("dialog", { name: folderName });
  await folderWindow.getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(fileName);
  await page.getByRole("button", { name: "Create file" }).click();

  await page.getByRole("button", { name: "Search apps, files, windows, and commands" }).click();
  const search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Text Editor");
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Text Editor" });
  await editor.frameLocator("iframe").getByRole("button", { name: "Open" }).click();

  const picker = page.getByRole("dialog", { name: "Choose file" });
  const folder = picker.getByRole("button", { name: folderName });
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await expect(picker.getByRole("radio", { name: fileName })).toHaveCount(0);
  await folder.click();
  await picker.getByRole("radio", { name: fileName }).check();
  await folder.click();
  await expect(picker.getByText(fileName, { exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Choose file" })).toBeEnabled();
});

test("app save picker creates and selects a folder", async ({ page }) => {
  await openLocalDesktop(page);
  const parentName = `picker-parent-${Date.now()}`;
  const folderName = "Nested destination";
  const fileActions = page.getByRole("toolbar", { name: "File actions" });

  await fileActions.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(parentName);
  await page.getByRole("button", { name: "Create folder" }).click();
  await page.getByRole("button", { name: "Search apps, files, windows, and commands" }).click();
  const search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Text Editor");
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Text Editor" });
  const saveAs = editor.frameLocator("iframe").getByRole("button", { name: "Save as" });
  await expect(saveAs).toBeEnabled();
  await saveAs.click();

  const picker = page.getByRole("dialog", { name: "Save file" });
  await picker.getByRole("radio", { name: parentName }).check();
  await picker.getByRole("button", { name: `New folder in ${parentName}` }).click();
  const folderDialog = page.getByRole("dialog", { name: "New folder" });
  await folderDialog.getByLabel("Folder name").fill(folderName);
  await folderDialog.getByRole("button", { name: "Create folder" }).click();

  await expect(folderDialog).toBeHidden();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("radio", { name: folderName })).toBeChecked();
  await expect(picker.getByText(`${folderName} selected`, { exact: true })).toBeVisible();
});

test("local mutation persists through reload", async ({ page }) => {
  await openLocalDesktop(page);
  const name = `e2e-${Date.now()}.txt`;
  const createTextFile = page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New text file" });
  await expect(createTextFile).toBeEnabled();
  await createTextFile.click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
});

test("fine pointers use overlapping window chrome and positioned context menus", async ({ page }) => {
  await openLocalDesktop(page);
  const shell = page.locator(".desktop-shell");
  await expect(shell).toHaveAttribute("data-windowed", "true");

  const name = `windowed-${Date.now()}.txt`;
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  const icon = page.locator(".file-icon").filter({ hasText: name });
  await icon.dblclick();

  const windowTitle = `${name} - Text Editor`;
  const appWindow = page.getByRole("dialog", { name: windowTitle });
  await expect(appWindow).toBeVisible();
  await expect(appWindow).not.toHaveAttribute("data-full-surface", "true");
  await expect(appWindow.getByRole("button", { name: `Minimize ${windowTitle}` })).toBeVisible();
  await expect(appWindow.getByRole("button", { name: `Maximize ${windowTitle}` })).toBeVisible();
  await expect(appWindow.getByRole("button", { name: `Close ${windowTitle}` })).toBeVisible();
  await expect(appWindow.locator("[data-window-resize]")).toHaveCount(8);

  await appWindow.getByRole("button", { name: `Close ${windowTitle}` }).click();
  await icon.focus();
  const historyBefore = await page.evaluate(() => history.state?.hirayaActionSheet ?? null);
  await icon.click({ button: "right" });
  const menu = page.getByRole("menu", { name: `Actions for ${name}` });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-positioned", "true");
  await expect(page.locator(".action-sheet-backdrop")).toHaveCount(0);
  expect(await page.evaluate(() => history.state?.hirayaActionSheet ?? null)).toBe(historyBefore);
  await page.keyboard.press("Escape");
  await expect(icon).toBeFocused();

  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(icon).toBeFocused();

  await page.getByRole("button", { name: "More actions" }).click();
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-positioned", "true");
  await expect(page.locator(".action-sheet-backdrop")).toHaveCount(0);
});

test("Settings adapts to its window and preserves subpage navigation", async ({ page, browser }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Start; account, system, and windows/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and windows/ }).getByRole("button", { name: "Settings" }).click();

  const settingsWindow = page.locator('[data-app-window="settings"]');
  const settingsContent = settingsWindow.locator(".settings-window__content");
  const categories = settingsWindow.getByRole("navigation", { name: "Settings categories" });
  await expect(settingsWindow).toBeVisible();
  await expect(settingsWindow.locator(".settings-window__content--main")).toHaveCSS("display", "grid");
  await expect(categories).toHaveCSS("display", "grid");
  await expect.poll(() => categories.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await resizeWindowWidth(page, settingsWindow, 600);
  await expect(settingsWindow.locator(".settings-window__content--main")).toHaveCSS("display", "block");
  await expect(categories).toHaveCSS("display", "flex");
  await expect.poll(() => settingsContent.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const themesLauncher = settingsWindow.locator('[aria-labelledby="themes-link-heading"] .settings-row--navigation');
  await themesLauncher.focus();
  await page.keyboard.press("Enter");
  await expect(settingsWindow.locator(".settings-page__header h3")).toBeFocused();
  await expect(settingsWindow.locator(".wallpaper-options")).toHaveCSS("grid-template-columns", /^(?!.*\s).+$/);
  await settingsWindow.getByRole("button", { name: "Duplicate / edit" }).first().click();
  await expect.poll(() => settingsWindow.locator(".theme-control").first().evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  await settingsWindow.getByRole("button", { name: "Back to settings" }).click();
  await expect(themesLauncher).toBeFocused();

  await categories.getByRole("button", { name: "Apps & permissions" }).click();
  const appsLauncher = settingsWindow.locator('[aria-labelledby="apps-link-heading"] .settings-row--navigation');
  await appsLauncher.click();
  await expect(settingsWindow.locator(".settings-page__header h3")).toBeFocused();
  await expect(settingsWindow.locator(".installed-app__actions").first()).toHaveCSS("flex-wrap", "wrap");
  await settingsWindow.getByRole("button", { name: "Back to settings" }).click();
  await expect(appsLauncher).toBeFocused();

  await resizeWindowWidth(page, settingsWindow, 360);
  await expect.poll(() => settingsContent.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await categories.getByRole("button", { name: "Data & admin" }).click();
  const activityLauncher = settingsWindow.locator('[aria-labelledby="activity-link-heading"] .settings-row--navigation');
  await activityLauncher.click();
  await expect(settingsWindow.locator(".settings-page__header h3")).toBeFocused();
  const narrowResults = await new AxeBuilder({ page }).include(".settings-window").analyze();
  expect(narrowResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const mobilePage = await mobileContext.newPage();
  await openLocalDesktop(mobilePage);
  await mobilePage.getByRole("button", { name: /Start; account, system, and windows/ }).click();
  await mobilePage.getByRole("dialog", { name: /Start; account, system, and windows/ }).getByRole("button", { name: "Settings" }).click();
  const mobileSettings = mobilePage.locator('[data-app-window="settings"]');
  const mobileThemesLauncher = mobileSettings.locator('[aria-labelledby="themes-link-heading"] .settings-row--navigation');
  await mobileThemesLauncher.click();
  const mobileBack = mobilePage.getByRole("button", { name: "Back to settings" });
  await expect(mobileBack).toBeVisible();
  await expect(mobileBack).toBeFocused();
  await mobileBack.click();
  await expect(mobileThemesLauncher).toBeFocused();
  await mobileContext.close();
});

test("reduced motion disables desktop transitions and animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Open area switcher/ }).click();
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

test("touch More actions uses an action sheet and browser history", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await openLocalDesktop(page);
  await expect(page.locator(".desktop-shell")).not.toHaveAttribute("data-windowed", "true");

  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill("touch-actions.txt");
  await page.getByRole("button", { name: "Create file" }).click();
  await page.locator(".file-icon").filter({ hasText: "touch-actions.txt" }).tap();
  await page.getByRole("button", { name: "More actions" }).tap();

  await expect(page.locator(".action-sheet-backdrop")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Actions for touch-actions.txt" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof history.state?.hirayaActionSheet === "string")).toBe(true);
  await page.goBack();
  await expect(page.locator(".action-sheet-backdrop")).toHaveCount(0);
  await context.close();
});

test("shell popups stay above the file action pill", async ({ browser }) => {
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

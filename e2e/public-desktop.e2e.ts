import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const publicDesktop = {
  schemaVersion: 2,
  id: "public-desk",
  name: "Published work",
  owner: { id: "owner-1", displayName: "Hiraya Owner", avatar: null },
  entries: Array.from({ length: 12 }, (_, index) => ({
    kind: "file",
    id: `file-${index}`,
    name: `Public document ${index + 1}.txt`,
    parentId: null,
    createdAt: 1,
    modifiedAt: 1,
    position: index === 0 ? { x: 120, y: 84 } : index === 1 ? { x: 1400, y: 84 } : { x: 120, y: 84 + index * 100 },
    mimeType: "text/plain",
    size: 4,
    revision: 0,
    contentRevision: 0,
  })),
  layout: { snapToGrid: false, wallpaper: { source: "dusk", fit: "cover", positionX: 50, positionY: 50, blur: 0, dim: 0, overlayColor: "#172329", overlayOpacity: 0 } },
  layoutRevision: 0,
  editorSettings: { autoSave: true, autoFormat: false, fontSize: 13, language: "auto", lineWrap: true },
  settingsRevision: 0,
  appearance: { selectedThemeId: "hiraya-dusk", selectionRevision: 0, customThemes: [] },
};

async function mockPublicDesktop(page: Page) {
	await page.route("**/api/public/desktops/e2e-desk", (route) => route.fulfill({ json: publicDesktop }));
	await page.route("**/api/public/desktops/e2e-desk/entries/*/content", (route) => route.fulfill({ body: "test", headers: { "content-type": "text/plain" } }));
}

async function overflow(page: Page) {
  return page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
}

test("public desktop reflows without page overflow at 390px", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === "(any-hover: hover) and (any-pointer: fine)" ? { ...nativeMatchMedia(query), matches: false, addEventListener() {}, removeEventListener() {} } : nativeMatchMedia(query);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPublicDesktop(page);
	await page.goto("/published/e2e-desk");
  await expect(page.getByLabel("Published work public desktop")).toBeVisible();
  const size = await overflow(page);
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("public desktop hides descendants of dot-prefixed folders", async ({ page }) => {
  await page.route("**/api/public/desktops/e2e-desk", (route) => route.fulfill({ json: {
    ...publicDesktop,
    entries: [
      { kind: "folder", id: "hidden", name: ".private", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 10, y: 10 }, revision: 1, contentRevision: 0 },
      { kind: "file", id: "hidden-child", name: "leak.txt", parentId: "hidden", createdAt: 1, modifiedAt: 1, position: { x: 20, y: 20 }, mimeType: "text/plain", size: 4, revision: 1, contentRevision: 1 },
      { ...publicDesktop.entries[0], id: "visible", name: "visible.txt" },
    ],
  } }));
  await page.goto("/published/e2e-desk");
  await expect(page.getByRole("button", { name: "visible.txt, text/plain" })).toBeVisible();
  await expect(page.getByRole("button", { name: "leak.txt, text/plain" })).toHaveCount(0);
});

test("public desktop preserves positions and navigates to a non-Home area", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockPublicDesktop(page);
  await page.goto("/published/e2e-desk");
  const homeIcon = page.getByRole("button", { name: "Public document 1.txt, text/plain" });
  await expect(homeIcon).toHaveCSS("left", "120px");
  await expect(homeIcon).toHaveCSS("top", "84px");
  await page.getByRole("button", { name: /Open public desktop area navigator/ }).click();
  const navigator = page.getByRole("navigation", { name: "Published work public desktop areas" });
  await expect(navigator).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigator).toBeHidden();
  await expect(page.getByRole("button", { name: /Open public desktop area navigator/ })).toBeFocused();
  await page.getByRole("button", { name: /Open public desktop area navigator/ }).click();
  await navigator.getByRole("button", { name: "Go to Right area" }).click();
  await expect(page.getByRole("button", { name: "Public document 2.txt, text/plain" })).toBeVisible();
});

test("fine pointers open draggable and resizable public windows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockPublicDesktop(page);
  await page.goto("/published/e2e-desk");
  await page.getByRole("button", { name: "Public document 1.txt, text/plain" }).dblclick();
  const appWindow = page.locator('[data-app-window="public-view"]');
  await expect(appWindow).toBeVisible();
  await expect(appWindow).not.toHaveAttribute("data-full-surface", "true");
  await expect(appWindow.locator("[data-window-drag-handle]")).toBeVisible();
  await expect(appWindow.locator("[data-window-resize]")).toHaveCount(8);
  await expect(page.locator(".public-menu").getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(appWindow).toBeFocused();
  await page.setViewportSize({ width: 700, height: 520 });
  await expect.poll(async () => {
    const [windowBox, desktopBox] = await Promise.all([appWindow.boundingBox(), page.getByLabel("Published work public desktop").boundingBox()]);
    return Boolean(windowBox && desktopBox && windowBox.x >= desktopBox.x && windowBox.y >= desktopBox.y && windowBox.x + windowBox.width <= desktopBox.x + desktopBox.width && windowBox.y + windowBox.height <= desktopBox.y + desktopBox.height);
  }).toBe(true);
});

test("coarse-only public windows use the focused full-surface header", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => query === "(any-hover: hover) and (any-pointer: fine)" ? { ...nativeMatchMedia(query), matches: false, addEventListener() {}, removeEventListener() {} } : nativeMatchMedia(query);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPublicDesktop(page);
  await page.goto("/published/e2e-desk");
  await page.getByRole("button", { name: "Public document 1.txt, text/plain" }).dblclick();
  const appWindow = page.locator('[data-app-window="public-view"]');
  await expect(appWindow).toHaveAttribute("data-full-surface", "true");
  await expect(page.getByRole("button", { name: "Back to public desktop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close public window" })).toBeVisible();
  await expect(appWindow).toBeFocused();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("public desktop reflows at 200 percent zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await mockPublicDesktop(page);
	await page.goto("/published/e2e-desk");
  await page.context().newCDPSession(page).then((session) => session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 }));
  const size = await overflow(page);
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
  const signIn = page.getByRole("link", { name: "Sign in" });
  await signIn.focus();
  await expect(signIn).toBeFocused();
  await expect(signIn).toBeInViewport();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && Boolean(document.activeElement))).toBe(true);
});

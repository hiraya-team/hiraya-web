import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const publicDesktop = {
  schemaVersion: 1,
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
    position: { x: 0, y: index * 100 },
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
}

async function overflow(page: Page) {
  return page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
}

test("public desktop reflows without page overflow at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPublicDesktop(page);
	await page.goto("/published/e2e-desk");
  await expect(page.getByLabel("Published work public desktop")).toBeVisible();
  const size = await overflow(page);
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
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

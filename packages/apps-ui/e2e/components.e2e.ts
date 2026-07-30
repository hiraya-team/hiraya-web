import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("hiraya-status-bar")).toContainText("Component fixture ready");
});

test("registers primitives and emits composed menu selections", async ({ page }) => {
  await expect(page.locator("hiraya-button#primary")).toBeVisible();
  await expect(page.locator("#body-only-panel").locator("header")).toBeHidden();
  await expect(page.locator("#body-only-panel").locator("footer")).toBeHidden();
  await page.getByText("Open popover", { exact: true }).click();
  await page.getByText("Open", { exact: true }).click();
  await expect(page.locator("#selection")).toHaveText("open");
});

test("supports keyboard menu navigation and skips disabled items", async ({ page }) => {
  await page.getByText("Open popover", { exact: true }).click();
  await page.locator("hiraya-menu-item[value=open]").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#selection")).toHaveText("rename");
});

test("restores focus after dialog and action-sheet dismissal", async ({ page }) => {
  const dialogTrigger = page.locator("#dialog-trigger");
  await dialogTrigger.click();
  await expect(page.locator("hiraya-dialog")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(dialogTrigger).toBeFocused();

  const sheetTrigger = page.locator("#sheet-trigger");
  await sheetTrigger.click();
  await page.keyboard.press("Escape");
  await expect(sheetTrigger).toBeFocused();
});

test("loads and operates the image viewer", async ({ page }) => {
  const image = page.locator("hiraya-image-viewer");
  await expect(image).toBeVisible();
  await image.focus();
  await page.keyboard.press("+");
  await expect(image).toHaveAttribute("zoom", /.+/);
  await page.keyboard.press("f");
  await expect(image).toHaveAttribute("zoom", "fit");
});

test("has no automatically detectable accessibility violations", async ({ page }) => {
  await page.getByText("Open popover", { exact: true }).click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("keeps controls usable in a narrow app window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page.locator("hiraya-selection-toolbar")).toBeVisible();
  await expect(page.getByText("Primary action", { exact: true })).toBeVisible();
});

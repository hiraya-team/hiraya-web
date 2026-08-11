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

test("supports item-list selection, activation, navigation, and keyboard reorder", async ({ page }) => {
  const first = page.locator("[data-item-id=first]");
  await first.click();
  await expect(page.locator("#item-event")).toHaveText("selected first");
  await first.dblclick();
  await expect(page.locator("#item-event")).toHaveText("activated first");
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-item-id=second]")).toBeFocused();

  const handle = page.getByRole("button", { name: "Reorder third item" });
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#item-event")).toHaveText("moved third to 0");

  const select = page.getByLabel("Other setting");
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(select).toHaveValue("b");
});

test("recognizes item-list touch activation and long press once", async ({ page }) => {
  const second = page.locator("[data-item-id=second]");
  await page.evaluate(() => {
    (window as typeof window & { itemActivationCount: number }).itemActivationCount = 0;
    document.querySelector("#item-list")?.addEventListener("hiraya-item-activate", () => {
      (window as typeof window & { itemActivationCount: number }).itemActivationCount += 1;
    });
  });
  const bounds = await second.boundingBox();
  expect(bounds).not.toBeNull();
  const point = { clientX: bounds!.x + bounds!.width / 2, clientY: bounds!.y + bounds!.height / 2, pointerId: 7, pointerType: "touch", button: 0 };

  await second.dispatchEvent("pointerdown", point);
  await second.dispatchEvent("pointerup", point);
  await second.dispatchEvent("pointerdown", { ...point, pointerId: 8 });
  await second.dispatchEvent("pointerup", { ...point, pointerId: 8 });
  await second.dispatchEvent("dblclick", point);
  await expect(page.locator("#item-event")).toHaveText("activated second");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { itemActivationCount: number }).itemActivationCount)).toBe(1);

  await page.evaluate(() => {
    const mounted = document.createElement("hiraya-item-list");
    mounted.id = "newly-mounted-list";
    mounted.innerHTML = '<button data-item-id="new-child" data-item-activate>New child</button>';
    (window as typeof window & { retargetedActivationCount: number }).retargetedActivationCount = 0;
    mounted.addEventListener("hiraya-item-activate", () => {
      (window as typeof window & { retargetedActivationCount: number }).retargetedActivationCount += 1;
    });
    document.body.append(mounted);
  });
  await page.locator("#newly-mounted-list [data-item-id=new-child]").dispatchEvent("dblclick", point);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { retargetedActivationCount: number }).retargetedActivationCount)).toBe(0);

  await second.dispatchEvent("pointerdown", { ...point, pointerId: 9 });
  await page.waitForTimeout(550);
  await expect(page.locator("#item-event")).toHaveText("context second");
  await second.dispatchEvent("contextmenu", point);
  await second.dispatchEvent("pointerup", { ...point, pointerId: 9 });
  await expect(page.locator("#item-event")).toHaveText("context second");
});

test("does not reorder on pointer jitter and keeps context actions item-scoped", async ({ page }) => {
  const output = page.locator("#item-event");
  const handle = page.getByRole("button", { name: "Reorder third item" });
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const point = { clientX: bounds!.x + bounds!.width / 2, clientY: bounds!.y + bounds!.height / 2, pointerId: 10, pointerType: "mouse", button: 0 };
  await handle.dispatchEvent("pointerdown", point);
  await handle.dispatchEvent("pointermove", { ...point, clientY: point.clientY + 1 });
  await handle.dispatchEvent("pointerup", { ...point, clientY: point.clientY + 1 });
  await expect(output).toHaveText("No item action");

  await handle.dispatchEvent("pointerdown", { ...point, pointerId: 11 });
  await handle.dispatchEvent("pointermove", { ...point, pointerId: 11, clientY: point.clientY + 5 });
  await handle.dispatchEvent("pointerup", { ...point, pointerId: 11, clientY: point.clientY + 5 });
  await expect(output).toHaveText("No item action");

  const firstRow = await page.locator("[data-item-id=other]").boundingBox();
  expect(firstRow).not.toBeNull();
  await page.mouse.move(point.clientX, point.clientY);
  await page.mouse.down();
  await page.mouse.move(point.clientX, firstRow!.y);
  await page.mouse.up();
  await expect(output).toHaveText("moved third to 0");

  await page.locator("[data-item-id=first]").dispatchEvent("contextmenu", { clientX: 10, clientY: 10 });
  await page.locator("[data-item-id=second]").dispatchEvent("contextmenu", { clientX: 12, clientY: 12 });
  await expect(output).toHaveText("context second");
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

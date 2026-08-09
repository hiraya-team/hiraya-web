import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Locator, type Page } from "@playwright/test";

async function openLocalDesktop(page: Page, timeout = 5_000) {
  await page.goto("/");
  await expect(page.locator(".desktop-shell")).toBeVisible({ timeout });
  await expect(page.getByText("Loading desktop...", { exact: true })).toBeHidden({ timeout });
  const onboarding = page.getByRole("dialog", { name: "Know where your work lives" });
  await expect(onboarding).toBeVisible({ timeout });
  await onboarding.getByRole("button", { name: "Close Getting Started" }).click();
  await expect(onboarding).toBeHidden();
}

async function resizeWindowWidth(page: Page, appWindow: Locator, width: number) {
  for (let step = 0; step < 30 && ((await appWindow.boundingBox())?.width ?? 0) > width + 2; step += 1) {
    await page.keyboard.press("Alt+Control+ArrowLeft");
  }
  await expect.poll(async () => Math.round((await appWindow.boundingBox())?.width ?? 0)).toBeLessThanOrEqual(width + 2);
}

async function beginDragPointerTo(page: Page, source: Locator, clientX: number, clientY: number) {
  const bounds = await source.boundingBox();
  if (!bounds) throw new Error("The drag source is not visible.");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(clientX, clientY, { steps: 12 });
}

async function dragPointerTo(page: Page, source: Locator, clientX: number, clientY: number) {
  await beginDragPointerTo(page, source, clientX, clientY);
  await page.mouse.up();
}

const pngFile = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

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

test("close-window shortcut closes the focused window without claiming the empty desktop", async ({ page }) => {
  await openLocalDesktop(page);
  const emptyDesktopEventWasCanceled = await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "x", code: "KeyX", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(emptyDesktopEventWasCanceled).toBe(false);

  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Settings");
  await search.getByRole("group", { name: "Commands" }).getByRole("option", { name: "Open Settings" }).click();
  const settings = page.locator('[data-app-window="settings"]');
  await expect(settings).toBeVisible();

  await page.keyboard.press("Control+Shift+x");
  await expect(settings).toBeHidden();
});

test("copy-link shortcut copies a deep link for the selected item", async ({ page, context }) => {
  await openLocalDesktop(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  const name = `copy-link-${Date.now()}.txt`;
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  const icon = page.locator(".file-icon").filter({ hasText: name });
  const entryId = await icon.getAttribute("data-entry-id");
  await icon.click();

  await page.keyboard.press("Control+Shift+c");

  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`/file/${entryId}`);
  await expect(page.getByText(`Link to ${name} copied`)).toBeVisible();
});

test("search launches installed apps", async ({ page }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: "Search apps, files, windows, and commands" }).click();
  const search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Integrated Editor");
  await expect(search.getByRole("group", { name: "Apps" }).getByRole("option", { name: /Integrated Editor/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(search).toBeHidden();
  const editor = page.getByRole("dialog", { name: /Integrated Editor/ });
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.locator("iframe").evaluate((frame) => ({ width: frame.clientWidth, height: frame.clientHeight }))).toEqual({ width: 818, height: 572 });
});

test("application shortcuts launch from the desktop and persist", async ({ page }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  const startMenu = page.getByRole("dialog", { name: /Start; account, system, and applications/ });
  await startMenu.locator(".mobile-start-applications > summary").click();
  await startMenu.getByRole("button", { name: "App Store" }).click();
  const appStore = page.locator('[data-app-window="store"]');
  const editorRow = appStore.getByRole("listitem").filter({ hasText: "Integrated Editor" });
  await editorRow.getByRole("button", { name: "Add to desktop" }).click();
  await expect(page.getByText("Integrated Editor added to the desktop")).toBeVisible();
  await page.getByRole("button", { name: "Close App Store" }).click();

  const shortcut = page.locator('.file-icon[data-entry-id]').filter({ hasText: "Integrated Editor" });
  await expect(shortcut).toBeVisible();
  await page.reload();
  await expect(shortcut).toBeVisible();
  await shortcut.dblclick();
  await expect(page.getByRole("dialog", { name: /Integrated Editor/ })).toBeVisible();
});

test("terminal runs pipelines against Hiraya files and stops foreground work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalDesktop(page, 30_000);
  await page.getByRole("button", { name: "Search apps, files, windows, and commands" }).click();
  const search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Terminal");
  await search.getByRole("group", { name: "Apps" }).getByRole("option", { name: /Terminal/ }).click();

  const terminal = page.getByRole("dialog", { name: "Terminal" });
  const frame = terminal.frameLocator("iframe");
  const command = frame.locator("#command");
  await expect(frame.getByText("Hiraya Terminal 1.0")).toBeVisible();
  await expect(command).toHaveAccessibleName("Command");
  await expect.poll(async () => (await terminal.getByRole("button", { name: "More Terminal actions" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await command.fill("mkdir work; echo beta > work/list.txt; echo alpha >> work/list.txt; cat work/list.txt | sort | uniq");
  await command.press("Enter");
  await expect(frame.getByRole("log")).toContainText("alpha\nbeta");
  await expect(frame.locator("#status")).toHaveText("Ready.");

  await command.fill("sleep 30");
  await command.press("Enter");
  await terminal.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(frame.getByRole("log")).toContainText("^C");
  await expect(frame.locator("#status")).toContainText("status 130");
  await expect.poll(async () => (await frame.getByRole("button", { name: "Run command" }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("search combines commands with other results", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalDesktop(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: /Search/ });
  const input = palette.locator("input");
  const scope = palette.getByRole("group", { name: "Search scope" });
  const current = scope.getByRole("button", { name: "Current" });

  await expect(input).toHaveValue("");
  await expect(current).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await current.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(palette.getByRole("group", { name: "Commands" })).toBeVisible();
  await input.fill("Settings");
  await expect(palette.getByRole("group", { name: "Commands" }).getByRole("option", { name: "Open Settings" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
});

test("auto-arrange packs current-area icons and persists their positions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalDesktop(page);
  const names = [`arrange-first-${Date.now()}.txt`, `arrange-second-${Date.now()}.txt`];
  const fileActions = page.getByRole("toolbar", { name: "File actions" });
  for (const name of names) {
    await fileActions.getByRole("button", { name: "New text file" }).click();
    await page.getByLabel("File name").fill(name);
    await page.getByRole("button", { name: "Create file" }).click();
    await page.locator(".desktop").click({ position: { x: 300, y: 500 } });
  }
  const first = page.locator(".file-icon").filter({ hasText: names[0] });
  const second = page.locator(".file-icon").filter({ hasText: names[1] });
  const desktop = await page.locator(".desktop").boundingBox();
  if (!desktop) throw new Error("The desktop is not visible.");
  await dragPointerTo(page, first, desktop.x + desktop.width - 140, desktop.y + desktop.height - 140);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: /Search/ });
  await palette.locator("input").fill("Auto-arrange desktop icons");
  await palette.getByRole("group", { name: "Commands" }).getByRole("option", { name: /Auto-arrange desktop icons/ }).click();
  await expect.poll(async () => {
    const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    return a && b ? { sameColumn: Math.abs(a.x - b.x) < 2, visualOrder: b.y < a.y } : null;
  }).toEqual({ sameColumn: true, visualOrder: true });

  const beforeReload = await Promise.all([first.boundingBox(), second.boundingBox()]);
  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect(page.getByText("Loading desktop...", { exact: true })).toBeHidden();
  await expect.poll(async () => {
    const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    return a && b && beforeReload[0] && beforeReload[1]
      ? [Math.round(a.x - beforeReload[0].x), Math.round(a.y - beforeReload[0].y), Math.round(b.x - beforeReload[1].x), Math.round(b.y - beforeReload[1].y)]
      : null;
  }).toEqual([0, 0, 0, 0]);
});

test("dragging shifts overlapping icons live and persists the arrangement", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalDesktop(page);
  const names = [`live-arrange-first-${Date.now()}.txt`, `live-arrange-second-${Date.now()}.txt`];
  const fileActions = page.getByRole("toolbar", { name: "File actions" });
  for (const name of names) {
    await fileActions.getByRole("button", { name: "New text file" }).click();
    await page.getByLabel("File name").fill(name);
    await page.getByRole("button", { name: "Create file" }).click();
    await page.locator(".desktop").click({ position: { x: 300, y: 500 } });
  }
  const first = page.locator(".file-icon").filter({ hasText: names[0] });
  const second = page.locator(".file-icon").filter({ hasText: names[1] });
  const target = await second.boundingBox();
  if (!target) throw new Error("The target icon is not visible.");
  const originalSecond = { x: target.x, y: target.y };

  await beginDragPointerTo(page, first, target.x + target.width / 2, target.y + target.height / 2);
  await expect(second).toHaveAttribute("data-auto-arrange-dragging", "true");
  await first.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 });
  await page.mouse.up();
  await expect(second).not.toHaveAttribute("data-auto-arrange-dragging", "true");
  await expect.poll(async () => {
    const restored = await second.boundingBox();
    return restored ? [Math.round(restored.x - originalSecond.x), Math.round(restored.y - originalSecond.y)] : null;
  }).toEqual([0, 0]);

  await beginDragPointerTo(page, first, target.x + target.width / 2, target.y + target.height / 2);
  await expect(second).toHaveAttribute("data-auto-arrange-dragging", "true");
  await page.mouse.up();
  await expect(second).not.toHaveAttribute("data-auto-arrange-dragging", "true");
  await expect.poll(async () => {
    const moved = await second.boundingBox();
    return moved ? { x: Math.round(moved.x - originalSecond.x), down: moved.y > originalSecond.y } : null;
  }).toEqual({ x: 0, down: true });

  const beforeReload = await Promise.all([first.boundingBox(), second.boundingBox()]);
  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect(page.getByText("Loading desktop...", { exact: true })).toBeHidden();
  await expect.poll(async () => {
    const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    return a && b && beforeReload[0] && beforeReload[1]
      ? [Math.round(a.x - beforeReload[0].x), Math.round(a.y - beforeReload[0].y), Math.round(b.x - beforeReload[1].x), Math.round(b.y - beforeReload[1].y)]
      : null;
  }).toEqual([0, 0, 0, 0]);
});

test("auto-arrange while dragging defaults on and persists an opt-out", async ({ page }) => {
  await openLocalDesktop(page);
  const openDesktopSettings = async () => {
    await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
    await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Desktop", exact: true }).click();
    return settings;
  };
  let settings = await openDesktopSettings();
  const toggle = settings.getByRole("checkbox", { name: /Auto-arrange while dragging/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await settings.getByRole("button", { name: "Close Settings" }).click();

  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  settings = await openDesktopSettings();
  await expect(settings.getByRole("checkbox", { name: /Auto-arrange while dragging/ })).not.toBeChecked();
});

test("clicking inside a sandbox app focuses and raises its window", async ({ page }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: "Search apps, files, windows, and commands" }).click();
  let search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Integrated Editor");
  await search.getByRole("group", { name: "Apps" }).getByRole("option", { name: /Integrated Editor/ }).click();
  const editor = page.getByRole("dialog", { name: /Integrated Editor/ });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeVisible();

  await page.keyboard.press("Control+k");
  search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Settings");
  await search.getByRole("group", { name: "Commands" }).getByRole("option", { name: "Open Settings" }).click();
  const settings = page.locator('[data-app-window="settings"]');
  await expect(settings).toHaveAttribute("data-focused", "true");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The viewport is unavailable.");
  await dragPointerTo(page, settings.locator(".app-window__header"), viewport.width - 80, 80);
  await expect(settings).toHaveAttribute("data-focused", "true");

  await editor.frameLocator("iframe").locator("body").click({ position: { x: 12, y: 12 } });
  await expect(editor).toHaveAttribute("data-focused", "true");
  await expect.poll(async () => Number(await editor.evaluate((element) => getComputedStyle(element).zIndex))).toBeGreaterThan(Number(await settings.evaluate((element) => getComputedStyle(element).zIndex)));
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
  await search.locator("input").fill("Integrated Editor");
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: /Integrated Editor/ });
  await editor.getByRole("button", { name: "More Integrated Editor actions" }).click();
  await editor.getByRole("dialog", { name: "More Integrated Editor actions" }).getByRole("button", { name: /^Open/ }).click();

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

test("Integrated Editor browses and manages a selected workspace", async ({ page }) => {
  await openLocalDesktop(page);
  const stamp = Date.now();
  const folderName = `editor-workspace-${stamp}`;
  const firstName = `first-${stamp}.txt`;
  const secondName = `second-${stamp}.ts`;
  const renamedName = `renamed-${stamp}.txt`;
  const imageName = `z-preview-${stamp}.png`;
  const fileActions = page.getByRole("toolbar", { name: "File actions" });

  await fileActions.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(folderName);
  await page.getByRole("button", { name: "Create folder" }).click();
  await page.locator(".file-icon").filter({ hasText: folderName }).dblclick();
  const folderWindow = page.getByRole("dialog", { name: folderName });
  await folderWindow.getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(firstName);
  await page.getByRole("button", { name: "Create file" }).click();
  const upload = page.waitForEvent("filechooser");
  await folderWindow.getByRole("button", { name: "Upload files" }).click();
  await (await upload).setFiles({ name: imageName, mimeType: "image/png", buffer: pngFile });

  await page.getByRole("button", { name: "Search apps, files, windows, and commands" }).click();
  const launcher = page.getByRole("dialog", { name: /Search/ });
  await launcher.locator("input").fill("Integrated Editor");
  await page.keyboard.press("Enter");
  const app = page.getByRole("dialog", { name: /Integrated Editor/ });
  const frame = app.frameLocator("iframe");

  await frame.getByRole("button", { name: "Settings" }).click();
  await expect(frame.getByLabel("Editor font size")).toHaveValue("13");
  await frame.getByLabel("Editor font size").selectOption("15");
  await frame.getByRole("button", { name: "Explorer" }).click();

  await frame.getByRole("button", { name: "Open workspace" }).click();
  const picker = page.getByRole("dialog", { name: "Choose folder" });
  await picker.getByRole("radio", { name: folderName }).check();
  await picker.getByRole("button", { name: "Choose folder" }).click();
  await expect(frame.getByRole("tree", { name: "Workspace files" }).getByRole("treeitem", { name: new RegExp(firstName) })).toBeVisible();

  await frame.getByRole("treeitem", { name: new RegExp(firstName) }).click();
  await expect(app).toHaveAccessibleName(`${firstName} - Integrated Editor`);
  const openFiles = frame.getByRole("toolbar", { name: "Open files" });
  const firstTab = openFiles.getByRole("button", { name: firstName, exact: true });
  await expect(firstTab).toHaveAttribute("aria-pressed", "true");
  const activeTabBackground = await firstTab.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(frame.locator("#breadcrumbs")).not.toContainText(firstName);
  await frame.getByRole("button", { name: "New file" }).click();
  const create = frame.getByRole("dialog", { name: "New file" });
  await create.getByLabel("File name").fill(secondName);
  await create.getByRole("button", { name: "Create" }).click();
  const firstRow = frame.getByRole("tree", { name: "Workspace files" }).getByRole("treeitem", { name: firstName, exact: true });
  const secondRow = frame.getByRole("tree", { name: "Workspace files" }).getByRole("treeitem", { name: secondName, exact: true });
  await firstRow.press("ArrowDown");
  await expect(secondRow).toHaveAttribute("aria-selected", "true");
  await frame.getByLabel("Workspace sidebar").getByRole("button", { name: folderName, exact: true }).click();
  await expect(frame.getByRole("button", { name: "Rename selected item" })).toBeDisabled();
  await secondRow.click();
  await expect(firstTab).toBeVisible();
  await expect(openFiles.getByRole("button", { name: secondName, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => firstTab.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(activeTabBackground);

  await frame.getByRole("button", { name: "Search workspace" }).click();
  await frame.getByRole("searchbox", { name: "Search files by name" }).fill("first-");
  await expect(frame.getByRole("option", { name: new RegExp(firstName) })).toBeVisible();
  await frame.getByRole("button", { name: "Explorer" }).click();

  await frame.getByRole("button", { name: "Rename selected item" }).click();
  const rename = frame.getByRole("dialog", { name: "Rename item" });
  await rename.getByLabel("Name").fill(renamedName);
  await rename.getByRole("button", { name: "Rename" }).click();
  const tree = frame.getByRole("tree", { name: "Workspace files" });
  await expect(tree.getByRole("treeitem", { name: renamedName, exact: true })).toBeVisible();
  await frame.getByRole("button", { name: "Delete selected item" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(tree.getByRole("treeitem", { name: renamedName, exact: true })).toHaveCount(0);
  await tree.getByRole("treeitem", { name: imageName, exact: true }).click();
  await expect(frame.locator(`img[alt="Preview of ${imageName}"]`)).toBeVisible();
  await expect(app.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
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
  await search.locator("input").fill("Integrated Editor");
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: /Integrated Editor/ });
  const saveAs = editor.getByRole("button", { name: "Save As", exact: true });
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
  const stored = await page.evaluate(async () => {
    const databaseName = (await indexedDB.databases()).find((database) => database.name?.startsWith("hiraya-indexeddb-v1-"))?.name;
    if (!databaseName) throw new Error("The Hiraya IndexedDB database is unavailable.");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("desktops", "readonly");
    const desktops = await new Promise<Array<{ state: { entries: Array<{ name: string }> } }>>((resolve, reject) => {
      const request = transaction.objectStore("desktops").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [...database.objectStoreNames].sort();
    database.close();
    return { stores, names: desktops.flatMap((desktop) => desktop.state.entries.map((entry) => entry.name)) };
  });
  expect(stored.stores).toEqual(["account-app-client-state", "account-app-outbox", "account-apps", "activity", "app-storage", "client-state", "desktops", "file-associations", "installed-apps", "outbox", "preferences", "quarantined-apps", "sessions"]);
  expect(stored.names).toContain(name);
});

test("concurrent tabs serialize the first IndexedDB reset", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/"), second.goto("/")]);
  await expect(first.locator(".desktop-shell")).toBeVisible();
  await expect(second.locator(".desktop-shell")).toBeVisible();
  await expect.poll(() => first.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("hiraya-indexeddb-reset-v1-")).length)).toBe(1);
  await context.close();
});

test("shows image thumbnails on the desktop and in folders", async ({ page }) => {
  await openLocalDesktop(page);
  const actions = page.getByRole("toolbar", { name: "File actions" });
  const desktopName = `desktop-${Date.now()}.png`;
  let chooser = page.waitForEvent("filechooser");
  await actions.getByRole("button", { name: "Upload files" }).click();
  await (await chooser).setFiles({ name: desktopName, mimeType: "image/png", buffer: pngFile });

  const desktopIcon = page.locator(".file-icon").filter({ hasText: desktopName });
  await expect(desktopIcon.locator(".entry-thumbnail")).toHaveAttribute("src", /^blob:/);
  await expect(desktopIcon.locator(".entry-thumbnail")).toHaveAttribute("data-loaded", "true");

  await page.getByRole("region", { name: "Desktop desktop" }).click({ position: { x: 600, y: 300 } });
  await expect(actions).toBeVisible();
  await actions.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Pictures");
  await page.getByRole("button", { name: "Create folder" }).click();
  await page.locator(".file-icon").filter({ hasText: "Pictures" }).dblclick();
  const folder = page.getByRole("dialog", { name: "Pictures" });
  const folderName = `folder-${Date.now()}.png`;
  chooser = page.waitForEvent("filechooser");
  await folder.getByRole("button", { name: "Upload files" }).click();
  await (await chooser).setFiles({ name: folderName, mimeType: "image/png", buffer: pngFile });

  const folderRow = folder.locator(".folder-explorer__row").filter({ hasText: folderName });
  await expect(folderRow).toBeVisible();
  await expect(folderRow.locator(".entry-thumbnail")).toHaveAttribute("src", /^blob:/, { timeout: 15_000 });
  await expect(folderRow.locator(".entry-thumbnail")).toHaveAttribute("data-loaded", "true");
});

test("opens an imported RTF document in the document viewer", async ({ page }) => {
  const pageErrors: string[] = [];
  const cycleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Package asset dependency cycle")) cycleErrors.push(message.text());
  });
  await openLocalDesktop(page);
  const name = `preview-${Date.now()}.rtf`;
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".empty-state__actions").getByRole("button", { name: "Upload files" }).click();
  await (await chooser).setFiles({
    name,
    mimeType: "application/rtf",
    buffer: Buffer.from(String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Calibri;}}\viewkind4\uc1\pard\f0\fs24 Hiraya RTF preview smoke.\par}`),
  });

  const icon = page.locator(".file-icon").filter({ hasText: name });
  await expect(icon).toBeVisible();
  await icon.dblclick();
  const viewer = page.getByRole("dialog", { name: "Document & Media Viewer" });
  await expect(viewer).toBeVisible();
  await expect(viewer.frameLocator("iframe").getByLabel("Document preview")).toContainText("Hiraya RTF preview smoke.", { timeout: 30_000 });
  await expect(viewer.frameLocator("iframe").getByText("application/rtf", { exact: false })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(cycleErrors).toEqual([]);
});

test("opens GFM Markdown with safe relative and external images in the document viewer", async ({ page }) => {
  await openLocalDesktop(page);
  const actions = page.getByRole("toolbar", { name: "File actions" });
  await actions.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill("Markdown preview");
  await page.getByRole("button", { name: "Create folder" }).click();
  await page.locator(".file-icon").filter({ hasText: "Markdown preview" }).dblclick();

  const folder = page.getByRole("dialog", { name: "Markdown preview" });
  const chooser = page.waitForEvent("filechooser");
  await folder.getByRole("button", { name: "Upload files" }).click();
  await (await chooser).setFiles([
    { name: "pixel.png", mimeType: "image/png", buffer: pngFile },
    {
      name: "README.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# GFM preview\n\n~~complete~~\n\n- [x] Safe task\n\n| File | State |\n| --- | --- |\n| README | ready |\n\n![Local pixel](pixel.png)\n\n![Remote pixel](https://example.com/pixel.png)\n\n<script>window.markdownExecuted = true</script>"),
    },
  ]);

  await folder.locator(".folder-explorer__row").filter({ hasText: "README.md" }).dblclick();
  const viewer = page.getByRole("dialog", { name: "Document & Media Viewer" });
  const frame = viewer.frameLocator("iframe");
  await expect(frame.getByLabel("Markdown preview")).toBeVisible({ timeout: 30_000 });
  await expect(frame.locator("del")).toHaveText("complete");
  await expect(frame.locator("table")).toContainText("README");
  await expect(frame.locator('input[type="checkbox"]')).toBeChecked();
  await expect(frame.getByAltText("Local pixel")).toHaveAttribute("src", /^blob:/);
  await expect(frame.getByRole("group", { name: "External image from example.com blocked" })).toBeVisible();
  await expect(frame.getByLabel("Markdown preview")).toContainText("<script>window.markdownExecuted = true</script>");
  expect(await frame.locator("body").evaluate(() => "markdownExecuted" in window)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(frame.getByLabel("Markdown preview")).toBeVisible();
  await expect(frame.locator("table")).toBeVisible();
});

test("pastes clipboard URL text as a named Internet Shortcut", async ({ page, context }) => {
  await openLocalDesktop(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.evaluate(() => navigator.clipboard.writeText("https://example.com/search?q=a=b"));
  await page.keyboard.press("Control+v");
  const dialog = page.getByRole("dialog", { name: "Paste link" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("File name")).toHaveValue("example.com.url");
  await dialog.getByRole("button", { name: "Create shortcut" }).click();

  const icon = page.locator(".file-icon").filter({ hasText: "example.com.url" });
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() => navigator.clipboard.writeText("This is not a URL."));
  await page.keyboard.press("Control+v");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".file-icon")).toHaveCount(1);

  await page.keyboard.press("Control+c");
  await expect(page.getByText("1 item copied", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", "<strong>Not a URL</strong>");
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(page.locator("[role=dialog]")).toHaveCount(0);

  await page.evaluate(() => navigator.clipboard.writeText("This is still not a URL."));
  await page.keyboard.press("Control+v");
  const conflictDialog = page.getByRole("dialog", { name: "Choose new names" });
  await expect(conflictDialog).toBeVisible();
  await conflictDialog.getByRole("button", { name: "Close paste dialog" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => navigator.clipboard.writeText("https://example.com/another"));
  await page.keyboard.press("Control+v");
  await dialog.getByRole("button", { name: "Create shortcut" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await dialog.getByLabel("File name").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("example.com 2");
  await dialog.getByRole("button", { name: "Create shortcut" }).click();
  await expect(dialog.getByRole("alert")).toContainText("must end in .url");
  await dialog.getByLabel("File name").fill("example.com 2.url");
  await dialog.getByRole("button", { name: "Create shortcut" }).click();
  await expect(page.locator(".file-icon").filter({ hasText: "example.com 2.url" })).toBeVisible();
});

test("opens imported audio from a local Blob preview source", async ({ page }) => {
  await openLocalDesktop(page);
  const name = `preview-${Date.now()}.wav`;
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".empty-state__actions").getByRole("button", { name: "Upload files" }).click();
  await (await chooser).setFiles({
    name,
    mimeType: "audio/wav",
    buffer: Buffer.from("UklGRiUAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQEAAACA", "base64"),
  });

  const icon = page.locator(".file-icon").filter({ hasText: name });
  await expect(icon).toBeVisible();
  await icon.dblclick();
  const viewer = page.getByRole("dialog", { name: "Document & Media Viewer" });
  const audio = viewer.frameLocator("iframe").locator("audio");
  await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate((element: HTMLMediaElement) => element.readyState)).toBeGreaterThan(0);
  await expect(audio).toHaveAttribute("src", /^blob:/);
});

test("undo after opening a text file preserves its loaded contents", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocalDesktop(page);
  const name = `undo-open-${Date.now()}.txt`;
  const contents = "Loaded text must not be undoable.";
  const fileActions = page.getByRole("toolbar", { name: "File actions" });

  await fileActions.getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  const icon = page.locator(".file-icon").filter({ hasText: name });
  await icon.dblclick();

  let app = page.getByRole("dialog", { name: /Integrated Editor/ });
  let editor = app.frameLocator("iframe");
  await editor.locator(".cm-content").fill(contents);
  await app.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator("#status")).toHaveText(`Saved ${name}.`);
  await app.getByRole("button", { name: /Close .*Integrated Editor/ }).click();
  const discard = page.getByRole("alertdialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard and close" });
  await expect.poll(async () => await app.isHidden() || await discard.isVisible()).toBe(true);
  if (await discard.isVisible()) await discard.click();
  await expect(app).toBeHidden();

  await icon.dblclick();
  app = page.getByRole("dialog", { name: /Integrated Editor/ });
  editor = app.frameLocator("iframe");
  await expect(editor.locator(".cm-content")).toHaveText(contents);
  await expect(editor.getByRole("button", { name: "Explorer" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await editor.getByRole("toolbar", { name: "Open files" }).getByRole("button", { name, exact: true }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect.poll(async () => (await editor.getByRole("button", { name: `Close ${name}` }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await editor.locator(".cm-content").focus();
  await page.keyboard.press("Control+z");
  await expect(editor.locator(".cm-content")).toHaveText(contents);
});

test("rapid icon releases cannot accumulate snap previews", async ({ page }) => {
  await openLocalDesktop(page);

  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Desktop", exact: true }).click();
  await settings.getByRole("checkbox", { name: /Snap to grid/ }).check();
  await settings.getByRole("button", { name: "Close Settings" }).click();

  const names = [`capture-race-one-${Date.now()}.txt`, `capture-race-two-${Date.now()}.txt`];
  const fileActions = page.getByRole("toolbar", { name: "File actions" });
  for (const name of names) {
    await fileActions.getByRole("button", { name: "New text file" }).click();
    await page.getByLabel("File name").fill(name);
    await page.getByRole("button", { name: "Create file" }).click();
    await page.locator(".desktop").click({ position: { x: 900, y: 500 } });
  }
  for (const name of names) {
    const icon = page.locator(".file-icon").filter({ hasText: name });
    await icon.click();
    await icon.evaluate((element) => {
      element.releasePointerCapture = () => { throw new DOMException("Pointer capture was already released.", "NotFoundError"); };
    });

    const iconBounds = await icon.boundingBox();
    const desktopBounds = await page.locator(".desktop").boundingBox();
    if (!iconBounds || !desktopBounds) throw new Error("The desktop item is not visible.");
    const releasePoint = {
      x: Math.min(desktopBounds.x + desktopBounds.width - 100, iconBounds.x + iconBounds.width / 2 + 150),
      y: Math.min(desktopBounds.y + desktopBounds.height - 100, iconBounds.y + iconBounds.height / 2 + 80),
    };
    await page.mouse.move(iconBounds.x + iconBounds.width / 2, iconBounds.y + iconBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(releasePoint.x, releasePoint.y, { steps: 2 });
    await expect(icon).toHaveAttribute("data-dragging", "true");
    await expect(page.locator(".file-icon-snap-preview[data-visible]")).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator(".file-icon-snap-preview[data-visible]")).toHaveCount(0);
    await expect(page.locator(".desktop-canvas[data-icon-dragging]")).toHaveCount(0);
    await expect(icon).not.toHaveAttribute("data-dragging");
  }
});

test("moves selected items between the desktop and folder explorer", async ({ page }) => {
  await openLocalDesktop(page);
  const stamp = Date.now();
  const folderName = `drag-folder-${stamp}`;
  const nestedFolderName = `drag-nested-${stamp}`;
  const firstName = `drag-first-${stamp}.txt`;
  const secondName = `drag-second-${stamp}.txt`;
  const fileActions = page.getByRole("toolbar", { name: "File actions" });

  await fileActions.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(folderName);
  await page.getByRole("button", { name: "Create folder" }).click();
  for (const name of [firstName, secondName]) {
    await page.locator(".desktop").click({ position: { x: 600, y: 300 } });
    await fileActions.getByRole("button", { name: "New text file" }).click();
    await page.getByLabel("File name").fill(name);
    await page.getByRole("button", { name: "Create file" }).click();
  }

  await page.locator(".file-icon").filter({ hasText: folderName }).dblclick();
  const explorer = page.getByRole("dialog", { name: folderName });
  const explorerBounds = await explorer.boundingBox();
  const explorerHeader = explorer.locator(".app-window__header");
  const explorerHeaderBounds = await explorerHeader.boundingBox();
  if (!explorerBounds || !explorerHeaderBounds) throw new Error("The folder explorer is not visible.");
  await dragPointerTo(page, explorerHeader, explorerBounds.x + explorerBounds.width / 2 + 260, explorerHeaderBounds.y + explorerHeaderBounds.height / 2);
  const firstIcon = page.locator(".file-icon").filter({ hasText: firstName });
  const secondIcon = page.locator(".file-icon").filter({ hasText: secondName });
  await firstIcon.click();
  await secondIcon.click({ modifiers: ["Control"] });
  const explorerContent = await explorer.locator(".folder-explorer__content").boundingBox();
  if (!explorerContent) throw new Error("The folder explorer is not visible.");
  await beginDragPointerTo(page, firstIcon, explorerContent.x + explorerContent.width - 28, explorerContent.y + explorerContent.height - 28);
  const dragPreview = page.locator(".entry-drag-preview");
  await expect(dragPreview).toBeVisible();
  await expect(dragPreview).toHaveCSS("z-index", "18");
  await page.mouse.up();

  const firstRow = explorer.locator(".folder-explorer__row").filter({ hasText: firstName });
  const secondRow = explorer.locator(".folder-explorer__row").filter({ hasText: secondName });
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();
  await expect(firstIcon).toHaveCount(0);
  await expect(secondIcon).toHaveCount(0);

  await firstRow.click();
  await secondRow.click({ modifiers: ["Control"] });
  const desktop = await page.locator(".desktop").boundingBox();
  if (!desktop) throw new Error("The desktop is not visible.");
  const dropPoint = { x: desktop.x + 90, y: desktop.y + desktop.height - 90 };
  await beginDragPointerTo(page, firstRow, dropPoint.x, dropPoint.y);
  await expect(dragPreview).toBeVisible();
  const dropPreview = page.locator(".entry-drop-preview");
  await expect(dropPreview).toBeVisible();
  const dropPreviewBounds = await dropPreview.boundingBox();
  expect(Math.abs((dropPreviewBounds?.x ?? 0) + (dropPreviewBounds?.width ?? 0) / 2 - dropPoint.x)).toBeLessThan(50);
  await page.mouse.up();
  await expect(dropPreview).toHaveCount(0);

  await expect(firstRow).toHaveCount(0);
  await expect(secondRow).toHaveCount(0);
  await expect(firstIcon).toBeVisible();
  await expect(secondIcon).toBeVisible();
  const movedFirst = await firstIcon.boundingBox();
  expect(Math.abs((movedFirst?.x ?? 0) + (movedFirst?.width ?? 0) / 2 - dropPoint.x)).toBeLessThan(50);

  await explorer.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(nestedFolderName);
  await page.getByRole("button", { name: "Create folder" }).click();
  const nestedFolderRow = explorer.locator(".folder-explorer__row").filter({ hasText: nestedFolderName });
  const nestedFolderBounds = await nestedFolderRow.boundingBox();
  if (!nestedFolderBounds) throw new Error("The nested destination folder is not visible.");
  await firstIcon.click();
  await dragPointerTo(page, firstIcon, nestedFolderBounds.x + nestedFolderBounds.width / 2, nestedFolderBounds.y + nestedFolderBounds.height / 2);
  await expect(firstIcon).toHaveCount(0);
  await nestedFolderRow.dblclick();
  const nestedExplorer = page.getByRole("dialog", { name: nestedFolderName });
  const nestedFirstRow = nestedExplorer.locator(".folder-explorer__row").filter({ hasText: firstName });
  await expect(nestedFirstRow).toBeVisible();
  await beginDragPointerTo(page, nestedFirstRow, dropPoint.x, dropPoint.y);
  await expect(dropPreview).toBeVisible();
  await nestedFirstRow.dispatchEvent("lostpointercapture", { pointerId: 1, clientX: dropPoint.x, clientY: dropPoint.y });
  await expect(dropPreview).toHaveCount(0);
  await page.mouse.up();

  await dragPointerTo(page, nestedFirstRow, dropPoint.x, dropPoint.y);
  await expect(firstIcon).toBeVisible();

  await page.reload();
  await expect(page.locator(".file-icon").filter({ hasText: firstName })).toBeVisible();
  await expect(page.locator(".file-icon").filter({ hasText: secondName })).toBeVisible();
});

test("edge dwell guards item and window moves between areas", async ({ page }) => {
  await openLocalDesktop(page);
  const folderName = `edge-dwell-${Date.now()}`;
  const fileActions = page.getByRole("toolbar", { name: "File actions" });
  await fileActions.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(folderName);
  await page.getByRole("button", { name: "Create folder" }).click();

  const desktop = page.locator(".desktop");
  const desktopBounds = await desktop.boundingBox();
  const folder = page.locator(".file-icon").filter({ hasText: folderName });
  const folderBounds = await folder.boundingBox();
  if (!desktopBounds || !folderBounds) throw new Error("The desktop item is not visible.");
  await page.mouse.move(folderBounds.x + folderBounds.width / 2, folderBounds.y + folderBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(desktopBounds.x + 2, desktopBounds.y + desktopBounds.height / 2, { steps: 12 });
  const indicator = page.locator('.desktop-edge-dwell[data-direction="left"]');
  await expect(indicator).toBeVisible();
  await expect(indicator.locator(".desktop-edge-dwell__rail > span")).toHaveCSS("animation-duration", "0.7s");
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/\/areas\/-1\/0$/);

  await page.mouse.move(desktopBounds.x + desktopBounds.width / 2, desktopBounds.y + desktopBounds.height / 2, { steps: 4 });
  await expect(indicator).toHaveCount(0);
  await page.mouse.move(desktopBounds.x + 2, desktopBounds.y + desktopBounds.height / 2, { steps: 4 });
  await expect(indicator).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/areas\/-1\/0$/);
  await expect(folder).toBeVisible();
  await page.mouse.up();

  await folder.dblclick();
  const explorer = page.getByRole("dialog", { name: folderName });
  const header = explorer.locator("[data-window-drag-handle]");
  const headerBounds = await header.boundingBox();
  if (!headerBounds) throw new Error("The folder window is not visible.");
  await page.mouse.move(headerBounds.x + headerBounds.width / 2, headerBounds.y + headerBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(desktopBounds.x + desktopBounds.width - 2, desktopBounds.y + desktopBounds.height / 2, { steps: 12 });
  await expect(page.locator('.desktop-edge-dwell[data-direction="right"]')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/areas\/0\/0(?:\/|$)/);
  await page.mouse.up();
});

test("desktop wheel gestures switch one area while app scrolling stays native", async ({ page }) => {
  await openLocalDesktop(page);
  const desktop = page.locator(".desktop");

  for (let step = 0; step < 4; step += 1) await desktop.dispatchEvent("wheel", { deltaX: 4 });
  await expect(page).toHaveURL(/\/areas\/1\/0$/);
  await page.waitForTimeout(200);

  await desktop.dispatchEvent("wheel", { deltaY: 20 });
  await expect(page).toHaveURL(/\/areas\/1\/1$/);
  await page.waitForTimeout(200);
  await desktop.dispatchEvent("wheel", { deltaY: -20 });
  await expect(page).toHaveURL(/\/areas\/1\/0$/);
  await page.waitForTimeout(200);
  await desktop.dispatchEvent("wheel", { deltaX: -20 });
  await expect(page).toHaveURL(/\/areas\/0\/0$/);
  await page.waitForTimeout(200);

  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Settings");
  await search.getByRole("group", { name: "Commands" }).getByRole("option", { name: "Open Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.dispatchEvent("wheel", { deltaY: 100 });
  await expect(page).toHaveURL(/\/areas\/0\/0\/settings\/desktop$/);

  await desktop.dispatchEvent("wheel", { deltaY: 100, ctrlKey: true });
  await expect(page).toHaveURL(/\/areas\/0\/0\/settings\/desktop$/);
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

  const windowTitle = `${name} - Integrated Editor`;
  const appWindow = page.getByRole("dialog", { name: windowTitle });
  await expect(appWindow).toBeVisible();
  await expect(appWindow).not.toHaveAttribute("data-full-surface", "true");
  await expect(appWindow.getByRole("button", { name: `Minimize ${windowTitle}` })).toBeVisible();
  await expect(appWindow.getByRole("button", { name: `Maximize ${windowTitle}` })).toBeVisible();
  await expect(appWindow.getByRole("button", { name: `Close ${windowTitle}` })).toBeVisible();
  await expect(appWindow.getByRole("button", { name: `Window actions for ${windowTitle}` })).toHaveCount(0);
  const moreActions = appWindow.getByRole("button", { name: "More Integrated Editor actions" });
  await expect(moreActions).toContainText("More");
  await moreActions.click();
  const appActions = appWindow.getByRole("dialog", { name: "More Integrated Editor actions" });
  await expect(appActions.getByRole("button", { name: /^Open/ })).toBeVisible();
  await expect(appActions.getByRole("button", { name: "Format", exact: true })).toBeHidden();
  await expect(appActions.getByRole("button", { name: /^Save As/ })).toBeHidden();
  await page.keyboard.press("Escape");
  const closeBox = await appWindow.getByRole("button", { name: `Close ${windowTitle}` }).boundingBox();
  const minimizeBox = await appWindow.getByRole("button", { name: `Minimize ${windowTitle}` }).boundingBox();
  const maximizeBox = await appWindow.getByRole("button", { name: `Maximize ${windowTitle}` }).boundingBox();
  expect(closeBox!.x).toBeLessThan(minimizeBox!.x);
  expect(minimizeBox!.x).toBeLessThan(maximizeBox!.x);
  await expect(appWindow.locator("[data-window-resize]")).toHaveCount(8);

  await appWindow.getByRole("button", { name: `Maximize ${windowTitle}` }).click();
  await expect(appWindow.locator(".app-window__header")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: `${windowTitle} window controls` }).getByRole("button", { name: `Close ${windowTitle}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "System" })).toContainText("System");
  const restore = page.getByRole("button", { name: `Restore ${windowTitle}` });
  await expect(restore).toBeFocused();
  await restore.click();
  await expect(appWindow.locator(".app-window__header")).toBeVisible();
  await expect(appWindow.getByRole("button", { name: `Maximize ${windowTitle}` })).toBeFocused();
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

test("desktop widgets and icon groups persist and remain usable on mobile", async ({ page }) => {
  await openLocalDesktop(page);
  const desktop = page.locator(".desktop");

  await desktop.click({ button: "right", position: { x: 420, y: 220 } });
  const desktopMenu = page.getByRole("menu", { name: "Create and desktop actions" });
  await desktopMenu.getByRole("menuitem", { name: "Add widget" }).click();
  await page.getByRole("menuitem", { name: "Clock", exact: true }).click();
  const clock = page.locator(".shell-item", { has: page.getByRole("button", { name: "Move Clock", exact: true }) });
  await expect(clock).toBeVisible();
  await expect(clock.locator(".shell-item__header")).toHaveCount(0);
  await expect(clock.getByRole("button", { name: "Resize Clock", exact: true })).toBeVisible();
  await expect(clock.getByRole("button", { name: "Remove Clock", exact: true })).toBeVisible();
  await desktop.click({ position: { x: 700, y: 500 } });
  await expect(clock.getByRole("button", { name: "Resize Clock", exact: true })).toHaveCount(0);
  await expect(clock.getByRole("button", { name: "Remove Clock", exact: true })).toHaveCount(0);
  const moveClock = clock.getByRole("button", { name: "Move Clock", exact: true });
  const moveBounds = await moveClock.boundingBox();
  const contentTop = await clock.locator(".shell-item__content").evaluate((element) => element.getBoundingClientRect().top);
  if (!moveBounds) throw new Error("The clock move control is not visible.");
  const touch = await page.context().newCDPSession(page);
  const touchPoint = { x: moveBounds.x + moveBounds.width / 2, y: moveBounds.y + moveBounds.height / 2, id: 0 };
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touchPoint, y: touchPoint.y - 6 }] });
  await expect.poll(() => clock.evaluate((element) => element.style.transform)).toBe("");
  await expect.poll(() => clock.locator(".shell-item__content").evaluate((element) => element.getBoundingClientRect().top)).toBe(contentTop);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const initialLeft = await clock.evaluate((element) => element.getBoundingClientRect().left);
  await moveClock.focus();
  await expect(clock.getByRole("button", { name: "Resize Clock", exact: true })).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => clock.evaluate((element) => element.getBoundingClientRect().left)).toBeGreaterThan(initialLeft);
  const initialWidth = await clock.evaluate((element) => element.getBoundingClientRect().width);
  const resizeClock = clock.getByRole("button", { name: "Resize Clock", exact: true });
  await expect(resizeClock).toBeEnabled();
  await resizeClock.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => clock.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(initialWidth);
  const beforeVerticalResize = await clock.boundingBox();
  const resizeBounds = await resizeClock.boundingBox();
  if (!beforeVerticalResize || !resizeBounds) throw new Error("The clock resize control is not visible.");
  await dragPointerTo(page, resizeClock, resizeBounds.x + resizeBounds.width / 2, resizeBounds.y + resizeBounds.height / 2 + 48);
  await expect.poll(async () => (await clock.boundingBox())?.width).toBe(beforeVerticalResize.width);
  await expect.poll(async () => (await clock.boundingBox())?.height ?? 0).toBeGreaterThan(beforeVerticalResize.height);
  const resizedClockBounds = await clock.boundingBox();
  if (!resizedClockBounds) throw new Error("The resized clock is not visible.");

  await desktop.click({ button: "right", position: { x: 120, y: 420 } });
  await page.getByRole("menu", { name: "Create and desktop actions" }).getByRole("menuitem", { name: "New icon group" }).click();
  const groupName = `Projects ${Date.now()}`;
  await page.getByLabel("Folder name").fill(groupName);
  await page.getByRole("button", { name: "Create folder" }).click();
  const group = page.locator(".shell-item", { has: page.getByRole("button", { name: `Move ${groupName}` }) });
  await expect(group.getByRole("button", { name: "Open in Explorer" })).toBeVisible();

  await page.waitForTimeout(200);
  await page.reload();
  const reloadedClock = page.locator(".shell-item", { has: page.getByRole("button", { name: "Move Clock", exact: true }) });
  await expect(reloadedClock).toBeVisible();
  await expect.poll(async () => await reloadedClock.boundingBox()).toMatchObject({ width: resizedClockBounds.width, height: resizedClockBounds.height });
  const reloadedWidgetTrack = reloadedClock.locator("xpath=ancestor::div[contains(@class, 'desktop-area-track')]");
  await expect(reloadedWidgetTrack).toHaveCSS("transform", "none");
  await expect(reloadedWidgetTrack).toHaveCSS("will-change", "auto");
  const reloadedClockContent = reloadedClock.locator(".shell-item__content");
  await expect(reloadedClockContent).toHaveCSS("position", "absolute");
  await expect(reloadedClockContent).toHaveCSS("inset", "0px");
  await page.addStyleTag({ content: ".shell-item--widget[data-selected], .shell-item__widget-drag:focus-visible { outline: 0 !important; } .shell-item__remove--widget, .shell-item--widget .shell-item__resize { display: none !important; }" });
  const beforeSelection = await reloadedClockContent.screenshot();
  const reloadedMoveBounds = await reloadedClock.getByRole("button", { name: "Move Clock", exact: true }).boundingBox();
  const beforeTapBounds = await reloadedClock.boundingBox();
  if (!reloadedMoveBounds || !beforeTapBounds) throw new Error("The reloaded clock is not visible.");
  const reloadedTouchPoint = { x: reloadedMoveBounds.x + reloadedMoveBounds.width / 2, y: reloadedMoveBounds.y + reloadedMoveBounds.height / 2, id: 0 };
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [reloadedTouchPoint] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await reloadedClock.boundingBox())?.height).toBe(beforeTapBounds.height);
  const afterSelection = await reloadedClockContent.screenshot();
  expect(afterSelection.equals(beforeSelection)).toBe(true);
  await expect(page.locator(".shell-item", { has: page.getByRole("button", { name: `Move ${groupName}` }) })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include(".desktop").analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("adding a widget rearranges overlapping icons and persists both positions", async ({ page }) => {
  await openLocalDesktop(page);
  const name = `widget-arrange-${Date.now()}.txt`;
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  const desktop = page.locator(".desktop");
  const desktopBounds = await desktop.boundingBox();
  const icon = page.locator(".file-icon").filter({ hasText: name });
  if (!desktopBounds) throw new Error("The desktop is not visible.");
  await dragPointerTo(page, icon, desktopBounds.x + 420, desktopBounds.y + 260);
  const before = await icon.boundingBox();
  if (!before) throw new Error("The test icon is not visible.");

  await desktop.click({ button: "right", position: { x: before.x - desktopBounds.x - 10, y: before.y - desktopBounds.y + before.height / 2 } });
  const desktopMenu = page.getByRole("menu", { name: "Create and desktop actions" });
  await desktopMenu.getByRole("menuitem", { name: "Add widget" }).click();
  await page.getByRole("menuitem", { name: "Clock", exact: true }).click();
  const clock = page.locator(".shell-item--widget", { has: page.getByRole("button", { name: "Move Clock", exact: true }) });
  await expect(clock).toBeVisible();
  await expect.poll(async () => {
    const moved = await icon.boundingBox();
    return moved ? Math.round(moved.y - before.y) : 0;
  }).toBeGreaterThan(0);

  await dragPointerTo(page, icon, desktopBounds.x + 800, desktopBounds.y + 260);
  const iconTarget = await icon.boundingBox();
  if (!iconTarget) throw new Error("The arranged icon is not visible.");
  await beginDragPointerTo(page, clock.getByRole("button", { name: "Move Clock", exact: true }), iconTarget.x + iconTarget.width / 2, iconTarget.y + iconTarget.height / 2);
  await expect(icon).toHaveAttribute("data-widget-arrange-dragging", "true");
  await page.mouse.up();
  await expect(icon).not.toHaveAttribute("data-widget-arrange-dragging", "true");
  await expect.poll(async () => {
    const moved = await icon.boundingBox();
    return moved ? Math.round(moved.y - iconTarget.y) : 0;
  }).toBeGreaterThan(0);

  await page.waitForTimeout(200);
  await expect(clock.getByRole("button", { name: "Move Clock", exact: true })).toBeEnabled();
  const saved = await Promise.all([
    icon.evaluate((element) => [element.style.getPropertyValue("--file-x"), element.style.getPropertyValue("--file-y")]),
    clock.evaluate((element) => [element.style.getPropertyValue("--shell-x"), element.style.getPropertyValue("--shell-y")]),
  ]);
  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect.poll(async () => {
    const reloadedClock = page.locator(".shell-item--widget", { hasText: /\d/ });
    return Promise.all([
      icon.evaluate((element) => [element.style.getPropertyValue("--file-x"), element.style.getPropertyValue("--file-y")]),
      reloadedClock.evaluate((element) => [element.style.getPropertyValue("--shell-x"), element.style.getPropertyValue("--shell-y")]),
    ]);
  }).toEqual(saved);
});

test("icon groups reserve space, follow the grid, and persist arranged icons", async ({ page }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Desktop", exact: true }).click();
  await settings.getByRole("checkbox", { name: /Snap to grid/ }).check();
  await settings.getByRole("button", { name: "Close Settings" }).click();

  const name = `group-arrange-${Date.now()}.txt`;
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  const desktop = page.locator(".desktop");
  const desktopBounds = await desktop.boundingBox();
  const icon = page.locator(".file-icon").filter({ hasText: name });
  if (!desktopBounds) throw new Error("The desktop is not visible.");
  await dragPointerTo(page, icon, desktopBounds.x + 420, desktopBounds.y + 260);
  const before = await icon.boundingBox();
  if (!before) throw new Error("The test icon is not visible.");

  await desktop.click({ button: "right", position: { x: before.x - desktopBounds.x - 10, y: before.y - desktopBounds.y + before.height / 2 } });
  await page.getByRole("menu", { name: "Create and desktop actions" }).getByRole("menuitem", { name: "New icon group" }).click();
  const groupName = `Grid group ${Date.now()}`;
  await page.getByLabel("Folder name").fill(groupName);
  await page.getByRole("button", { name: "Create folder" }).click();
  const group = page.locator(".shell-item", { has: page.getByRole("button", { name: `Move ${groupName}` }) });
  await expect(group).toBeVisible();
  await expect.poll(async () => {
    const moved = await icon.boundingBox();
    return moved ? Math.round(moved.y - before.y) : 0;
  }).toBeGreaterThan(0);

  const alignedBounds = await group.boundingBox();
  if (!alignedBounds) throw new Error("The icon group is not visible.");
  const alignedPosition = await group.evaluate((element) => [parseFloat(element.style.getPropertyValue("--shell-x")), parseFloat(element.style.getPropertyValue("--shell-y"))]);
  expect((alignedPosition[0] - 22) % 24).toBe(0);
  expect((alignedPosition[1] - 22) % 24).toBe(0);
  expect(Math.round(alignedBounds.width) % 24).toBe(0);
  expect(Math.round(alignedBounds.height) % 24).toBe(0);
  const initialLeft = alignedBounds.x;
  const moveGroup = group.getByRole("button", { name: `Move ${groupName}` });
  await expect(moveGroup).toBeEnabled();
  await moveGroup.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Math.round((await group.boundingBox())?.x ?? 0) - Math.round(initialLeft)).toBe(24);
  const initialWidth = (await group.boundingBox())?.width ?? 0;
  const resizeGroup = group.getByRole("button", { name: `Resize ${groupName}` });
  await expect(resizeGroup).toBeEnabled();
  await resizeGroup.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Math.round((await group.boundingBox())?.width ?? 0) - Math.round(initialWidth)).toBe(24);

  await page.waitForTimeout(200);
  const saved = await Promise.all([
    icon.evaluate((element) => [element.style.getPropertyValue("--file-x"), element.style.getPropertyValue("--file-y")]),
    group.evaluate((element) => [element.style.getPropertyValue("--shell-x"), element.style.getPropertyValue("--shell-y"), element.getBoundingClientRect().width, element.getBoundingClientRect().height]),
  ]);
  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect.poll(async () => {
    const reloadedGroup = page.locator(".shell-item", { has: page.getByRole("button", { name: `Move ${groupName}` }) });
    return Promise.all([
      icon.evaluate((element) => [element.style.getPropertyValue("--file-x"), element.style.getPropertyValue("--file-y")]),
      reloadedGroup.evaluate((element) => [element.style.getPropertyValue("--shell-x"), element.style.getPropertyValue("--shell-y"), element.getBoundingClientRect().width, element.getBoundingClientRect().height]),
    ]);
  }).toEqual(saved);
});

test("widgets and icon groups preview snapped pointer placement", async ({ page }) => {
  await openLocalDesktop(page);
  const openLayoutSettings = async () => {
    await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
    await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Desktop", exact: true }).click();
    return settings;
  };
  let settings = await openLayoutSettings();
  await settings.getByRole("checkbox", { name: /Snap to grid/ }).check();
  await settings.getByRole("button", { name: "Close Settings" }).click();

  const desktop = page.locator(".desktop");
  await desktop.click({ button: "right", position: { x: 700, y: 180 } });
  let desktopMenu = page.getByRole("menu", { name: "Create and desktop actions" });
  await desktopMenu.getByRole("menuitem", { name: "Add widget" }).click();
  await page.getByRole("menuitem", { name: "Clock", exact: true }).click();
  const clock = page.locator(".shell-item--widget", { has: page.getByRole("button", { name: "Move Clock", exact: true }) });
  const moveClock = clock.getByRole("button", { name: "Move Clock", exact: true });
  await expect(moveClock).toBeEnabled();
  const moveBounds = await moveClock.boundingBox();
  if (!moveBounds) throw new Error("The clock move control is not visible.");
  await beginDragPointerTo(page, moveClock, moveBounds.x + moveBounds.width / 2 + 35, moveBounds.y + moveBounds.height / 2 + 17);
  const placeholder = page.locator(".shell-item-snap-preview[data-visible]");
  await expect(placeholder).toHaveCount(1);
  await expect(placeholder).toHaveAttribute("data-grid", "24");
  const clockTarget = await placeholder.evaluate((element) => [parseFloat(element.style.left), parseFloat(element.style.top), parseFloat(element.style.width), parseFloat(element.style.height)]);
  expect((clockTarget[0] - 22) % 24).toBe(0);
  expect((clockTarget[1] - 22) % 24).toBe(0);
  expect(clockTarget[2] % 24).toBe(0);
  expect(clockTarget[3] % 24).toBe(0);
  await page.mouse.up();
  await expect(placeholder).toHaveCount(0);

  await desktop.click({ button: "right", position: { x: 120, y: 380 } });
  desktopMenu = page.getByRole("menu", { name: "Create and desktop actions" });
  await desktopMenu.getByRole("menuitem", { name: "New icon group" }).click();
  const groupName = `Preview group ${Date.now()}`;
  await page.getByLabel("Folder name").fill(groupName);
  await page.getByRole("button", { name: "Create folder" }).click();
  const group = page.locator(".shell-item", { has: page.getByRole("button", { name: `Move ${groupName}` }) });
  const resizeGroup = group.getByRole("button", { name: `Resize ${groupName}` });
  await expect(resizeGroup).toBeEnabled();
  const resizeBounds = await resizeGroup.boundingBox();
  const groupBounds = await group.boundingBox();
  if (!resizeBounds || !groupBounds) throw new Error("The icon group resize control is not visible.");
  await beginDragPointerTo(page, resizeGroup, resizeBounds.x + resizeBounds.width / 2 + 31, resizeBounds.y + resizeBounds.height / 2 + 19);
  await expect(placeholder).toHaveCount(1);
  const resizedTarget = await placeholder.boundingBox();
  if (!resizedTarget) throw new Error("The icon group placeholder is not visible.");
  expect(Math.round(resizedTarget.width) % 24).toBe(0);
  expect(Math.round(resizedTarget.height) % 24).toBe(0);
  expect(resizedTarget.width).toBeGreaterThan(groupBounds.width);
  await resizeGroup.dispatchEvent("pointercancel", { pointerId: 1, clientX: resizeBounds.x + resizeBounds.width / 2 + 31, clientY: resizeBounds.y + resizeBounds.height / 2 + 19 });
  await expect(placeholder).toHaveCount(0);
  await expect(group).not.toHaveAttribute("data-dragging", "true");
  await page.mouse.up();

  settings = await openLayoutSettings();
  await settings.getByRole("checkbox", { name: /Snap to grid/ }).uncheck();
  await settings.getByRole("button", { name: "Close Settings" }).click();
  const unsnappedMoveBounds = await moveClock.boundingBox();
  if (!unsnappedMoveBounds) throw new Error("The clock move control is not visible.");
  await beginDragPointerTo(page, moveClock, unsnappedMoveBounds.x + unsnappedMoveBounds.width / 2 + 31, unsnappedMoveBounds.y + unsnappedMoveBounds.height / 2 + 13);
  await expect(placeholder).toHaveCount(0);
  await page.mouse.up();
});

test("Theme Editor selects a wallpaper with the Hiraya file picker", async ({ page, browser }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  const settings = page.locator('[data-app-window="settings"]');
  await settings.getByRole("button", { name: /Theme Editor/ }).click();
  const themeEditor = page.getByRole("dialog", { name: "Theme Editor" });
  const frame = themeEditor.frameLocator("iframe");
  await frame.getByRole("tab", { name: "Wallpaper" }).click();

  const wallpaperName = `wallpaper-${Date.now()}.png`;
  const chooser = page.waitForEvent("filechooser");
  await frame.getByRole("button", { name: "Upload image" }).click();
  await (await chooser).setFiles({ name: wallpaperName, mimeType: "image/png", buffer: pngFile });
  await expect(frame.getByText(`${wallpaperName} added and applied.`)).toBeVisible();
  await frame.getByRole("button", { name: "Grove" }).click();

  await frame.getByRole("button", { name: "Choose Hiraya image" }).click();
  const picker = page.getByRole("dialog", { name: "Choose file" });
  await expect(picker.getByRole("radio", { name: wallpaperName })).toBeVisible();
  await picker.getByRole("radio", { name: wallpaperName }).check();
  await picker.getByRole("button", { name: "Choose file" }).click();
  await expect(frame.getByText(`${wallpaperName} applied.`)).toBeVisible();

  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const mobilePage = await mobileContext.newPage();
  await openLocalDesktop(mobilePage);
  await mobilePage.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await mobilePage.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  await mobilePage.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: /Theme Editor/ }).click();
  const mobileFrame = mobilePage.getByRole("dialog", { name: "Theme Editor" }).frameLocator("iframe");
  await mobileFrame.getByRole("tab", { name: "Wallpaper" }).click();
  await expect(mobileFrame.getByRole("button", { name: "Choose Hiraya image" })).toBeVisible();
  await expect.poll(() => mobileFrame.locator(".app-shell").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await mobileContext.close();
});

test("Settings adapts to its window and preserves subpage navigation", async ({ page, browser }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();

  const settingsWindow = page.locator('[data-app-window="settings"]');
  const settingsContent = settingsWindow.locator(".settings-window__content");
  const categories = settingsWindow.getByRole("navigation", { name: "Settings categories" });
  await expect(settingsWindow).toBeVisible();
  await expect(settingsWindow.locator(".settings-window__content--main")).toHaveCSS("display", "grid");
  await expect(categories).toHaveCSS("display", "grid");
  await expect.poll(() => categories.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await resizeWindowWidth(page, settingsWindow, 580);
  await expect(settingsWindow.locator(".settings-window__content--main")).toHaveCSS("display", "block");
  await expect(categories).toHaveCSS("display", "grid");
  await expect.poll(() => settingsContent.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const desktopsLauncher = settingsWindow.getByRole("button", { name: /Desktops/ });
  await desktopsLauncher.click();
  await expect(settingsWindow.locator(".settings-page__header h3")).toHaveText("Desktops");
  const pinDesktop = settingsWindow.locator('.desktop-settings__arrange button[aria-pressed]').first();
  await pinDesktop.click();
  await expect(pinDesktop).toHaveAttribute("aria-pressed", "true");
  await settingsWindow.getByRole("button", { name: "Back to Desktop" }).click();
  await expect(desktopsLauncher).toBeFocused();

  const themesLauncher = settingsWindow.getByRole("button", { name: /Theme Editor/ });
  await themesLauncher.focus();
  await page.keyboard.press("Enter");
  const themeEditor = page.getByRole("dialog", { name: "Theme Editor" });
  const themeEditorFrame = themeEditor.frameLocator("iframe");
  await expect(themeEditorFrame.getByRole("heading", { name: "Theme library" })).toBeVisible();
  await themeEditorFrame.getByRole("tab", { name: "Wallpaper" }).click();
  await expect(themeEditorFrame.getByRole("heading", { name: "Desktop background" })).toBeVisible();
  await expect(themeEditorFrame.getByRole("button", { name: "Dusk" })).toHaveAttribute("aria-pressed", "true");
  await themeEditorFrame.getByRole("button", { name: "Grove" }).click();
  await expect(themeEditorFrame.getByText("Grove wallpaper applied.")).toBeVisible();
  await themeEditor.getByRole("button", { name: "Close Theme Editor" }).click();
  const discardThemeChanges = page.getByRole("alertdialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard and close" });
  await discardThemeChanges.click();
  await expect(themeEditor).toBeHidden();
  await themesLauncher.click();
  const reopenedThemeEditor = page.getByRole("dialog", { name: "Theme Editor" });
  const reopenedFrame = reopenedThemeEditor.frameLocator("iframe");
  await reopenedFrame.getByRole("tab", { name: "Wallpaper" }).click();
  await expect(reopenedFrame.getByRole("button", { name: "Grove" })).toHaveAttribute("aria-pressed", "true");
  await reopenedThemeEditor.getByRole("button", { name: "Close Theme Editor" }).click();
  await discardThemeChanges.click();
  await expect(reopenedThemeEditor).toBeHidden();
  await categories.getByRole("button", { name: "Files & apps" }).click();
  const appsLauncher = settingsWindow.getByRole("button", { name: /File type defaults/ });
  await appsLauncher.click();
  await expect(settingsWindow.locator(".settings-page__header h3")).toBeFocused();
  await expect(settingsWindow.locator(".settings-page__header h3")).toHaveText("File type defaults");
  await expect(settingsWindow.locator(".installed-app__actions")).toHaveCount(0);
  await settingsWindow.getByRole("button", { name: "Back to Files & apps" }).click();
  await expect(appsLauncher).toBeFocused();

  await resizeWindowWidth(page, settingsWindow, 360);
  await expect.poll(() => settingsContent.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await categories.getByRole("button", { name: "Sync & storage" }).click();
  const activityLauncher = settingsWindow.getByRole("button", { name: /Activity/ });
  await activityLauncher.click();
  await expect(settingsWindow.locator(".settings-page__header h3")).toBeFocused();
  const narrowResults = await new AxeBuilder({ page }).include(".settings-window").analyze();
  expect(narrowResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  const mobileContext = await browser.newContext({ ...devices["Pixel 7"] });
  const mobilePage = await mobileContext.newPage();
  await openLocalDesktop(mobilePage);
  await mobilePage.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await mobilePage.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  const mobileSettings = mobilePage.locator('[data-app-window="settings"]');
  const mobileDesktopsLauncher = mobileSettings.getByRole("button", { name: /Desktops/ });
  await mobileDesktopsLauncher.click();
  await expect(mobileSettings.locator(".settings-page__header h3")).toHaveText("Desktops");
  await expect.poll(() => mobileSettings.locator(".settings-window__content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await mobilePage.goBack();
  await expect(mobileDesktopsLauncher).toBeFocused();
  const mobileThemesLauncher = mobileSettings.getByRole("button", { name: /Theme Editor/ });
  await mobileThemesLauncher.click();
  const mobileThemeEditor = mobilePage.getByRole("dialog", { name: "Theme Editor" });
  const mobileThemeEditorFrame = mobileThemeEditor.frameLocator("iframe");
  await expect(mobileThemeEditorFrame.getByRole("option", { name: /Hiraya Dusk/ })).toBeVisible();
  await mobileThemeEditorFrame.getByRole("tab", { name: "Wallpaper" }).click();
  await expect(mobileThemeEditorFrame.getByRole("heading", { name: "Image treatment" })).toBeVisible();
  const mobileThemeEditorBack = mobilePage.getByRole("button", { name: "Back from Theme Editor" });
  await mobileThemeEditorBack.click();
  await mobilePage.getByRole("alertdialog", { name: "Discard theme changes?" }).getByRole("button", { name: "Discard", exact: true }).click();
  await mobileThemeEditorBack.click();
  await expect(mobileThemeEditorFrame.getByRole("tab", { name: "Theme", exact: true })).toHaveAttribute("aria-selected", "true");
  await mobileThemeEditorBack.click();
  await expect(mobileThemeEditor).toHaveCount(0);
  await mobileContext.close();
});

test("Settings routes survive history navigation and reload", async ({ page }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  const settings = page.locator('[data-app-window="settings"]');

  await expect(page).toHaveURL(/\/settings\/desktop$/);
  await settings.getByRole("button", { name: "Files & apps" }).click();
  await settings.getByRole("button", { name: /File type defaults/ }).click();
  await expect(page).toHaveURL(/\/settings\/files-apps\/file-types$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/files-apps$/);
  await expect(settings.getByRole("heading", { name: "Files & apps" })).toBeVisible();
  await page.goForward();
  await expect(settings.locator(".settings-page__header h3")).toHaveText("File type defaults");

  await page.reload();
  await expect(page.locator('[data-app-window="settings"]')).toBeVisible();
  await expect(page.locator('[data-app-window="settings"] .settings-page__header h3')).toHaveText("File type defaults");
});

test("Show hidden files persists in the account IndexedDB preferences", async ({ page }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  let settings = page.locator('[data-app-window="settings"]');
  await settings.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Files & apps" }).click();
  const toggle = settings.getByRole("checkbox", { name: /Show hidden files/ });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect.poll(() => page.evaluate(async () => {
    const databaseName = (await indexedDB.databases()).find((database) => database.name?.startsWith("hiraya-indexeddb-v1-"))?.name;
    if (!databaseName) return false;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<{ showHiddenFiles?: boolean } | undefined>((resolve, reject) => {
      const request = db.transaction("preferences").objectStore("preferences").get("singleton");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value?.showHiddenFiles === true;
  })).toBe(true);
  await settings.getByRole("button", { name: "Close Settings" }).click();

  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect(page.getByText("Loading desktop...", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  settings = page.locator('[data-app-window="settings"]');
  await settings.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Files & apps" }).click();
  await expect(settings.getByRole("checkbox", { name: /Show hidden files/ })).toBeChecked();
});

test("reduced motion disables desktop transitions and animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Open desktop and area switcher/ }).click();
  const motion = await page.locator(".desktop-minimap").evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  expect(parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.001);
  expect(parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.001);
});

test("desktop switcher rows use their full width", async ({ page }) => {
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Switch desktop, current desktop/ }).click();
  const target = page.locator("[data-desktop-switch-target]").first();
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("The desktop switch target is not visible.");
  await target.click({ position: { x: bounds.width - 4, y: bounds.height / 2 } });
  await expect(page.locator(".desktop-minimap")).toHaveCount(0);
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

test("mobile Start and the unified switcher own distinct shell actions", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await openLocalDesktop(page);

  const start = page.getByRole("button", { name: /Start; account, system, and applications/ });
  await start.click();
  const startMenu = page.getByRole("dialog", { name: /Start; account, system, and applications/ });
  await expect(startMenu).toBeVisible();
  await expect(startMenu.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(startMenu.getByRole("button", { name: "Switch Window" })).toHaveCount(0);
  await expect(startMenu.getByRole("button", { name: "Back to Desktop" })).toHaveCount(0);
  await expect(page.locator(".menu-bar__store")).toHaveCount(0);
  await startMenu.locator(".mobile-start-applications > summary").click();
  await expect(startMenu.getByRole("button", { name: "Integrated Editor" })).toBeVisible();
  await expect(startMenu.getByRole("button", { name: "App Store" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(start).toBeFocused();

  const switcher = page.locator(".desktop-minimap");
  const trigger = page.locator(".mobile-area-switcher-trigger");
  const desktopTrigger = page.getByRole("button", { name: /Switch desktop, current desktop/ });
  await desktopTrigger.click();
  await expect(page.getByRole("complementary", { name: "Desktops" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(desktopTrigger).toBeFocused();
  await start.click();
  await startMenu.locator(".mobile-start-applications > summary").click();
  await startMenu.getByRole("button", { name: "App Store" }).click();
  const appStore = page.locator('[data-app-window="store"]');
  await expect(appStore.getByRole("heading", { name: "Applications" })).toBeVisible();
  await expect(appStore.getByRole("heading", { name: "Installed" })).toBeVisible();
  await expect(appStore.getByText("Integrated Editor", { exact: true })).toBeVisible();
  await expect(appStore.getByRole("button", { name: "Add to desktop" }).first()).toBeVisible();
  await expect(appStore.getByRole("heading", { name: "Administrator store unavailable" })).toBeVisible();
  await expect(appStore.getByText("The App Store requires a synchronized Hiraya account.")).toBeVisible();
  await expect(start).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back from App Store" })).toBeVisible();
  const system = page.getByRole("button", { name: "System" });
  const openIntegratedSwitcher = async () => {
    await system.click();
    await page.getByRole("dialog", { name: "System" }).getByRole("button", { name: "Desktops and areas" }).click();
  };
  await system.click();
  await page.getByRole("dialog", { name: "System" }).getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("dialog", { name: "System" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Notifications" })).toHaveCount(0);
  await expect(system).toBeFocused();
  await openIntegratedSwitcher();
  await expect(switcher.getByRole("button", { name: "Back to desktop" })).toBeVisible();
  await switcher.getByRole("button", { name: "Back to desktop" }).click();
  await expect(switcher).toHaveCount(0);

  await trigger.click();
  await switcher.getByRole("button", { name: "Switch to App Store" }).click();
  await expect(switcher).toHaveCount(0);

  await openIntegratedSwitcher();
  await switcher.getByRole("button", { name: "Minimize App Store" }).click();
  await expect(switcher).toHaveCount(0);

  await trigger.click();
  await switcher.getByRole("button", { name: "Switch to App Store" }).click();
  await expect(switcher).toHaveCount(0);

  await openIntegratedSwitcher();
  await switcher.getByRole("button", { name: "Close App Store" }).click();
  await expect(switcher).toHaveCount(0);
  await expect(appStore).toHaveCount(0);
  await expect(page.locator(".desktop-minimap__handle")).toHaveCount(0);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(switcher).toHaveAttribute("data-expanded", "true");
    await expect(switcher.locator(".desktop-minimap__area")).toHaveCount(5);
    await expect(switcher.locator(".desktop-minimap__direction")).toHaveCount(4);
    await expect.poll(() => switcher.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(340);
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
  await page.getByRole("button", { name: "Add Right area" }).tap();
  await expect(page).toHaveURL(/\/areas\/1\/0$/);
  await expect(switcher).toHaveCount(0);

  await trigger.tap();
  await trigger.tap();
  await expect(page).toHaveURL(/\/areas\/0\/0$/);
  await expect(switcher).toHaveCount(0);
  await context.close();
});

test("mobile Back climbs Settings before closing it", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await openLocalDesktop(page);
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  const settings = page.locator('[data-app-window="settings"]');
  await settings.getByRole("button", { name: "Files & apps" }).click();
  await settings.getByRole("button", { name: /File type defaults/ }).click();

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/files-apps$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/settings\/desktop$/);
  await page.goBack();
  await expect(settings).toHaveCount(0);
  await context.close();
});

test("mobile Back dismisses transient surfaces before navigating", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await openLocalDesktop(page);
  const url = page.url();

  await page.getByRole("button", { name: "Search apps, files, windows, and commands" }).click();
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0);
  await expect(page).toHaveURL(url);

  const start = page.getByRole("button", { name: /Start; account, system, and applications/ });
  await start.click();
  await expect(page.getByRole("dialog", { name: /Start; account, system, and applications/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: /Start; account, system, and applications/ })).toHaveCount(0);

  const areaSwitcher = page.locator(".mobile-area-switcher-trigger");
  await areaSwitcher.click();
  await expect(page.locator(".desktop-minimap")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".desktop-minimap")).toHaveCount(0);

  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toHaveCount(0);
  await expect(page).toHaveURL(url);
  await expect(page.getByRole("status").filter({ hasText: "Press Back" })).toHaveCount(0);

  await context.close();
});

test("mobile root Back requires two additional presses and resets", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  await openLocalDesktop(page);
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);

  await page.goBack();
  await expect(page.getByRole("status").filter({ hasText: "Press Back twice more to quit Hiraya." })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("status").filter({ hasText: "Press Back once more to quit Hiraya." })).toBeVisible();
  await page.waitForTimeout(3_100);
  await page.goBack();
  await expect(page.getByRole("status").filter({ hasText: "Press Back twice more to quit Hiraya." })).toBeVisible();
  await page.reload();
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await expect(page.getByText("Loading desktop...", { exact: true })).toBeHidden();
  await page.goBack();
  await expect(page.getByRole("status").filter({ hasText: "Press Back twice more to quit Hiraya." })).toBeVisible();
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
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  const panel = page.getByRole("dialog", { name: /Start; account, system, and applications/ });
  await expect(panel).toBeVisible();

  const toolbarElement = await toolbar.elementHandle();
  if (!toolbarElement) throw new Error("Mobile action toolbar was not mounted.");
  const stacking = await panel.evaluate((element, actionToolbar) => {
    const panelBounds = element.getBoundingClientRect();
    return {
      panelZ: Number(getComputedStyle(element.closest(".menu-bar")!).zIndex),
      toolbarZ: Number(getComputedStyle(actionToolbar).zIndex),
      x: panelBounds.left + panelBounds.width / 2,
      y: panelBounds.top + panelBounds.height / 2,
    };
  }, toolbarElement);
  expect(stacking.panelZ).toBeGreaterThan(stacking.toolbarZ);
  await expect.poll(() => page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return target?.closest(".mobile-header-menu__panel") !== null;
  }, stacking)).toBe(true);

  await context.close();
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

const sceneFile = Buffer.from("UEsDBBQAAAAIAAAAIQAwgXF/LwAAAC0AAAARAAAAaGlyYXlhLnNjZW5lLmpzb26rVipOzkjNTQxLLSrOzM9TsjLUUUrNKymqLMjPzCtRslLKzEtJrdDLKMnNUaoFAFBLAwQUAAAACAAAACEAHP6KseYAAABXAQAACgAAAGluZGV4Lmh0bWxVUMFOxSAQ/JXaU0l8POPRFi7GizGa2KPxQGG1G3mAsFSJ8d/F18b4brszOzOZHc6M11QCNDMdrBymTOSdfMyuGTU4GPYbMiQdMZDU3iVqVlBUbT6AI/6eIZYRLGjysWtXumX9OnDvtEX9Jjom5AYRfNK1d1TVoj1GNRE04AKmQRcytf0a5acEcVGEdRNPz70y5mapqjtMVQw1bcaoirr6UNYGFSDugsdqHNtz+D0U8uu/Bw85zd2R4QZIoWX9X4/Jm8KNIpWA+GaTxO34cM8TRXSv+FK6E7dUi0G3u7xg7JsN++1LP1BLAQIUABQAAAAIAAAAIQAwgXF/LwAAAC0AAAARAAAAAAAAAAAAAAAAAAAAAABoaXJheWEuc2NlbmUuanNvblBLAQIUABQAAAAIAAAAIQAc/oqx5gAAAFcBAAAKAAAAAAAAAAAAAAAAAF4AAABpbmRleC5odG1sUEsFBgAAAAACAAIAdwAAAGwBAAAAAA==", "base64");

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
    revision: 1,
    contentRevision: 1,
  })),
  layout: { snapToGrid: false, wallpaper: { source: "dusk", fit: "cover", positionX: 50, positionY: 50, blur: 0, dim: 0, overlayColor: "#172329", overlayOpacity: 0 } },
  layoutRevision: 0,
  editorSettings: { autoSave: true, autoFormat: false, fontSize: 13, language: "auto", lineWrap: true },
  settingsRevision: 0,
  appearance: { selectedThemeId: "hiraya-dusk", selectionRevision: 0, customThemes: [] },
};

async function mockPublicDesktop(page: Page) {
	await page.route("**/api/public/desktops/e2e-desk", (route) => route.fulfill({ json: publicDesktop }));
	await page.route("**/api/public/desktops/e2e-desk/entries/*/content?*", (route) => {
    const requestUrl = new URL(route.request().url());
    const entryId = requestUrl.pathname.split("/").at(-2)!;
    return route.fulfill({ json: {
      entryId,
      contentRevision: 1,
      size: 4,
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      access: { url: `${requestUrl.origin}/__public-content/${entryId}`, method: "GET", headers: {}, expiresAt: 2_000_000_000_000 },
    } });
  });
  await page.route("**/__public-content/*", (route) => route.fulfill({ body: "test", headers: { "content-type": "text/plain" } }));
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
  const editor = appWindow.frameLocator('iframe[title="Integrated Editor"]');
  await expect(editor.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(appWindow.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to public desktop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close public window" })).toBeVisible();
  await expect(appWindow).toBeFocused();
  await page.getByRole("button", { name: "Back to public desktop" }).click();
  await expect(appWindow).toBeHidden();
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

test("whole public desktops render widgets and folder-backed groups read only", async ({ page }) => {
  const folder = { kind: "folder", id: "public-group", name: "Reference", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 420, y: 90 }, revision: 1, contentRevision: 0 };
  const child = { ...publicDesktop.entries[0], id: "group-child", name: "Inside.txt", parentId: folder.id, position: { x: 0, y: 0 } };
  await page.route("**/api/public/desktops/e2e-desk", (route) => route.fulfill({ json: {
    ...publicDesktop,
    entries: [folder, child],
    layout: {
      ...publicDesktop.layout,
      widgets: [{ id: "status", kind: "status", x: 90, y: 90, width: 240, height: 150 }],
      iconGroups: [{ folderId: folder.id, width: 320, height: 240 }],
    },
  } }));
  await page.goto("/published/e2e-desk");

  await expect(page.getByText("Shared desktop", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Published work public desktop").getByText("Read only", { exact: true })).toBeVisible();
  const group = page.locator(".shell-item", { hasText: "Reference" });
  await expect(group.getByRole("listbox", { name: "Contents of Reference" })).not.toHaveAttribute("aria-multiselectable");
  const childOption = group.getByRole("option", { name: "Inside.txt, text/plain" });
  await expect(childOption).toBeVisible();
  await childOption.click();
  await expect(childOption).toHaveAttribute("aria-selected", "true");
  await expect(group.getByRole("button", { name: "Open in Explorer" })).toBeVisible();
  await expect(group.getByRole("button", { name: "Move Reference" })).toBeDisabled();
  await expect(group.getByRole("button", { name: "Resize Reference" })).toHaveCount(0);
});

test("public desktop keeps overlapping icons and shell items usable in each area", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const folder = { kind: "folder", id: "overlap-group", name: "Cross-area reference", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 350, y: 360 }, revision: 1, contentRevision: 0 };
  const child = { ...publicDesktop.entries[0], id: "overlap-child", name: "Inside overlap.txt", parentId: folder.id, position: { x: 0, y: 0 } };
  const icon = { ...publicDesktop.entries[0], id: "overlap-icon", name: "Cross-area.txt", position: { x: 350, y: 84 } };
  await page.route("**/api/public/desktops/e2e-desk", (route) => route.fulfill({ json: {
    ...publicDesktop,
    entries: [folder, child, icon],
    layout: {
      ...publicDesktop.layout,
      widgets: [{ id: "status", kind: "status", x: 250, y: 160, width: 300, height: 150 }],
      iconGroups: [{ folderId: folder.id, width: 500, height: 240 }],
    },
  } }));
  await page.goto("/published/e2e-desk");
  await page.getByRole("button", { name: /Open public desktop area navigator/ }).click();
  const navigator = page.getByRole("navigation", { name: "Published work public desktop areas" });
  await navigator.getByRole("button", { name: "Go to Right area" }).click();

  await expect(page.getByRole("button", { name: "Cross-area.txt, text/plain" })).toBeVisible();
  await page.getByRole("button", { name: "Cross-area.txt, text/plain" }).click();
  await expect(page.getByText("Shared desktop", { exact: true })).toBeVisible();
  const group = page.locator(".shell-item", { hasText: "Cross-area reference" });
  const childOption = group.getByRole("option", { name: "Inside overlap.txt, text/plain" });
  await expect(childOption).toBeVisible();
  await childOption.click();
  await expect(childOption).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("This area is empty.")).toHaveCount(0);
});

test("whole public desktops render linked Todo widgets read only", async ({ page }) => {
  const body = JSON.stringify({ schemaVersion: 2, tasks: [{ id: "public-task", title: "Read public notes", completed: false, priority: "normal", subitems: [] }] });
  const file = { ...publicDesktop.entries[0], id: "public-todo", name: "Shared.hiraya.todo", mimeType: "application/vnd.hiraya.todo+json", size: new TextEncoder().encode(body).byteLength };
  await page.route("**/api/public/desktops/e2e-desk", (route) => route.fulfill({ json: {
    ...publicDesktop,
    entries: [file],
    layout: { ...publicDesktop.layout, widgets: [{ id: "todo", kind: "todo", fileId: file.id, x: 90, y: 90, width: 340, height: 300 }], iconGroups: [] },
  } }));
  await page.route("**/api/public/desktops/e2e-desk/entries/public-todo/content?*", (route) => route.fulfill({ json: {
    entryId: file.id,
    contentRevision: 1,
    size: file.size,
    sha256: createHash("sha256").update(body).digest("hex"),
    access: { url: `${new URL(route.request().url()).origin}/__public-todo`, method: "GET", headers: {}, expiresAt: 2_000_000_000_000 },
  } }));
  await page.route("**/__public-todo", (route) => route.fulfill({ body, headers: { "content-type": file.mimeType } }));
  await page.goto("/published/e2e-desk");

  await expect(page.getByText("Read public notes", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Read public notes" })).toBeDisabled();
});

test("whole public desktops run Scene widgets and interactive Scene wallpaper", async ({ page }) => {
  const file = { ...publicDesktop.entries[0], id: "public-scene", name: "Public.hiraya.scene", mimeType: "application/vnd.hiraya.scene+zip", size: sceneFile.byteLength };
  await page.route("**/api/public/desktops/e2e-desk", (route) => route.fulfill({ json: {
    ...publicDesktop,
    entries: [file],
    layout: {
      ...publicDesktop.layout,
      wallpaper: { ...publicDesktop.layout.wallpaper, source: `file:${file.id}` },
      widgets: [{ id: "scene", kind: "scene", fileId: file.id, x: 90, y: 90, width: 420, height: 300 }],
      iconGroups: [],
    },
  } }));
  await page.route("**/api/public/desktops/e2e-desk/entries/public-scene/content?*", (route) => route.fulfill({ json: {
    entryId: file.id,
    contentRevision: 1,
    size: file.size,
    sha256: createHash("sha256").update(sceneFile).digest("hex"),
    access: { url: `${new URL(route.request().url()).origin}/__public-scene`, method: "GET", headers: {}, expiresAt: 2_000_000_000_000 },
  } }));
  await page.route("**/__public-scene", (route) => route.fulfill({ body: sceneFile, headers: { "content-type": file.mimeType } }));
  await page.goto("/published/e2e-desk");

  const widget = page.frameLocator('iframe[title="Public.hiraya.scene widget"]');
  await widget.getByRole("button", { name: "Run Scene" }).click();
  await expect(widget.getByRole("button", { name: "Scene received input" })).toBeVisible();
  const wallpaper = page.frameLocator('iframe[title="Public.hiraya.scene wallpaper"]');
  await page.locator(".public-desktop__surface").click({ position: { x: 700, y: 400 } });
  await expect.poll(async () => JSON.parse(await wallpaper.locator("body").getAttribute("data-pointers") ?? "[]")).toContainEqual(expect.objectContaining({ phase: "pointerup", x: 700, y: 400, pointerType: "mouse" }));
});

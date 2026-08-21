import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "../src/lib/themes";

/** Provides the scene file test fixture. */
const sceneFile = Buffer.from("UEsDBBQAAAAIAAAAIQAwgXF/LwAAAC0AAAARAAAAaGlyYXlhLnNjZW5lLmpzb26rVipOzkjNTQxLLSrOzM9TsjLUUUrNKymqLMjPzCtRslLKzEtJrdDLKMnNUaoFAFBLAwQUAAAACAAAACEAHP6KseYAAABXAQAACgAAAGluZGV4Lmh0bWxVUMFOxSAQ/JXaU0l8POPRFi7GizGa2KPxQGG1G3mAsFSJ8d/F18b4brszOzOZHc6M11QCNDMdrBymTOSdfMyuGTU4GPYbMiQdMZDU3iVqVlBUbT6AI/6eIZYRLGjysWtXumX9OnDvtEX9Jjom5AYRfNK1d1TVoj1GNRE04AKmQRcytf0a5acEcVGEdRNPz70y5mapqjtMVQw1bcaoirr6UNYGFSDugsdqHNtz+D0U8uu/Bw85zd2R4QZIoWX9X4/Jm8KNIpWA+GaTxO34cM8TRXSv+FK6E7dUi0G3u7xg7JsN++1LP1BLAQIUABQAAAAIAAAAIQAwgXF/LwAAAC0AAAARAAAAAAAAAAAAAAAAAAAAAABoaXJheWEuc2NlbmUuanNvblBLAQIUABQAAAAIAAAAIQAc/oqx5gAAAFcBAAAKAAAAAAAAAAAAAAAAAF4AAABpbmRleC5odG1sUEsFBgAAAAACAAIAdwAAAGwBAAAAAA==", "base64");

/** Provides the public desktop test fixture. */
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

type PublicFixture = {
  name: string;
  entries: Array<{ kind: string; id: string; name: string; parentId: string | null; createdAt: number; modifiedAt: number; position: { x: number; y: number }; mimeType?: string; size?: number }>;
  layout?: { autoArrangeIcons?: boolean; snapToGrid: boolean; gridSize?: number; wallpaper: unknown; widgets?: unknown[]; iconGroups?: unknown[] };
  appearance?: { selectedThemeId: string; customThemes: Array<{ id: string; revision?: number; [key: string]: unknown }> };
};

/** Builds the stable ID test fixture. */
function stableId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Mocks a public desktop and its file responses. */
async function mockPublicDesktop(page: Page, desktop: PublicFixture = publicDesktop, contents: ReadonlyMap<string, Uint8Array> = new Map()) {
  const workspaceId = stableId("public-workspace");
  const chunks = new Map<string, Uint8Array>();
  const files = new Map<string, { manifestHash: string; manifest: { schemaVersion: number; size: number; chunkSize: number; chunks: Array<{ hash: string; size: number }> } }>();
  const nodes = desktop.entries.map((entry) => {
    const id = stableId(`node:${entry.id}`);
    const operationId = stableId(`operation:${entry.id}`);
    const tuple = { logicalTime: 1, operationId };
    const base = { workspaceId, id, kind: entry.kind, name: entry.name, parentId: entry.parentId ? stableId(`node:${entry.parentId}`) : null, lifecycle: { kind: "active" }, position: entry.position, createdAt: entry.createdAt, modifiedAt: entry.modifiedAt, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: entry.kind === "file" ? tuple : null } };
    if (entry.kind !== "file") return base;
    const content = contents.get(entry.id) ?? Buffer.from("test");
    const chunkHash = createHash("sha256").update(content).digest("hex");
    const manifest = { schemaVersion: 1, size: content.byteLength, chunkSize: 1_048_576, chunks: content.byteLength === 0 ? [] : [{ hash: chunkHash, size: content.byteLength }] };
    const manifestHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    if (content.byteLength > 0) chunks.set(chunkHash, content);
    files.set(id, { manifestHash, manifest });
    return { ...base, mimeType: entry.mimeType ?? "application/octet-stream", size: content.byteLength, manifestHash };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const layout = desktop.layout ?? publicDesktop.layout;
  const appearance = desktop.appearance ?? publicDesktop.appearance;
  const wallpaper = layout.wallpaper as Record<string, unknown>;
  const publicWallpaper = typeof wallpaper.source === "string" && wallpaper.source.startsWith("file:")
    ? { ...wallpaper, source: `file:${stableId(`node:${wallpaper.source.slice(5)}`)}` }
    : wallpaper;
  const publicWidgets = (layout.widgets ?? []).map((value) => {
    const widget = value as Record<string, unknown>;
    return typeof widget.fileId === "string" ? { ...widget, fileId: stableId(`node:${widget.fileId}`) } : widget;
  });
  const publicGroups = (layout.iconGroups ?? []).map((value) => {
    const group = value as Record<string, unknown>;
    return typeof group.folderId === "string" ? { ...group, folderId: stableId(`node:${group.folderId}`) } : group;
  });
  const setting = (namespace: string, key: string, value: unknown) => ({ workspaceId, namespace, key, deleted: false, value, logicalTime: 1, operationId: stableId(`setting:${namespace}:${key}`) });
  const settings = [
    ...appearance.customThemes.map((storedTheme) => {
      const theme = { ...storedTheme };
      delete theme.revision;
      const packaged = theme.wallpaper as Record<string, unknown> | undefined;
      return setting("custom-themes", theme.id, packaged && typeof packaged.assetId === "string" ? { ...theme, wallpaper: { ...packaged, assetId: stableId(`node:${packaged.assetId}`) } } : theme);
    }),
    setting("desktop-grid", "auto-arrange-icons", layout.autoArrangeIcons ?? true),
    setting("desktop-grid", "grid-size", layout.gridSize ?? 24),
    setting("desktop-grid", "snap-to-grid", layout.snapToGrid),
    setting("icon-groups", "layout", publicGroups),
    setting("theme-selection", "selected", appearance.selectedThemeId),
    setting("wallpaper", "layout", publicWallpaper),
    setting("widgets", "layout", publicWidgets),
  ].sort((left, right) => {
    const leftIdentity = `${left.namespace}\0${left.key}`;
    const rightIdentity = `${right.namespace}\0${right.key}`;
    return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
  });
  await page.route("**/api/public/workspaces/e2e-desk?*", (route) => route.fulfill({ json: {
    schemaVersion: 1,
    protocol: "web2-sync-v1",
    workspaceAlias: "e2e-desk",
    itemAlias: null,
    workspaceId,
    workspaceName: desktop.name,
    publishedRootId: null,
    asOf: 1,
    owner: { id: stableId("public-owner"), displayName: "Hiraya Owner", avatar: "identicon:0123456789abcdef" },
    nodes,
    settings,
    nextAfter: null,
  } }));
  await page.route("**/api/public/workspaces/e2e-desk/nodes/*/content?*", (route) => {
    const requestUrl = new URL(route.request().url());
    const nodeId = requestUrl.pathname.split("/").at(-2)!;
    const file = files.get(nodeId);
    if (!file) return route.fulfill({ status: 404 });
    return route.fulfill({ json: {
      schemaVersion: 1,
      protocol: "web2-sync-v1",
      workspaceAlias: "e2e-desk",
      itemAlias: null,
      nodeId,
      asOf: 1,
      manifestHash: file.manifestHash,
      manifest: file.manifest,
      chunks: file.manifest.chunks.map(({ hash, size }) => ({ hash, size, method: "GET", url: `${requestUrl.origin}/__public-chunk/${hash}`, headers: {} })),
    } });
  });
  await page.route("**/__public-chunk/*", (route) => {
    const chunk = chunks.get(new URL(route.request().url()).pathname.split("/").at(-1)!);
    return chunk ? route.fulfill({ body: Buffer.from(chunk) }) : route.fulfill({ status: 404 });
  });
}

/** Measures viewport overflow in the test page. */
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
  await mockPublicDesktop(page, {
    ...publicDesktop,
    entries: [
      { kind: "folder", id: "hidden", name: ".private", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 10, y: 10 }, revision: 1, contentRevision: 0 },
      { kind: "file", id: "hidden-child", name: "leak.txt", parentId: "hidden", createdAt: 1, modifiedAt: 1, position: { x: 20, y: 20 }, mimeType: "text/plain", size: 4, revision: 1, contentRevision: 1 },
      { ...publicDesktop.entries[0], id: "visible", name: "visible.txt" },
    ],
  });
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
  const customTheme = { id: "public-theme", name: "Public theme", definition: { ...BUILTIN_THEMES[DEFAULT_THEME_ID].definition, iconSize: 72 }, revision: 4 };
  await mockPublicDesktop(page, {
    ...publicDesktop,
    entries: [folder, child],
    appearance: { selectedThemeId: customTheme.id, customThemes: [customTheme] },
    layout: {
      ...publicDesktop.layout,
      widgets: [{ id: "status", kind: "status", x: 90, y: 90, width: 240, height: 150 }],
      iconGroups: [{ folderId: folder.id, width: 320, height: 240 }],
    },
  });
  await page.goto("/published/e2e-desk");

  await expect(page.getByText("Shared desktop", { exact: true })).toBeVisible();
  await expect(page.locator("main.public-desktop")).toHaveAttribute("data-theme", "custom");
  await expect.poll(() => page.locator("main.public-desktop").evaluate((element) => getComputedStyle(element).getPropertyValue("--theme-icon-size"))).toBe("72px");
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
  await mockPublicDesktop(page, {
    ...publicDesktop,
    entries: [folder, child, icon],
    layout: {
      ...publicDesktop.layout,
      widgets: [{ id: "status", kind: "status", x: 250, y: 160, width: 300, height: 150 }],
      iconGroups: [{ folderId: folder.id, width: 500, height: 240 }],
    },
  });
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
  await mockPublicDesktop(page, {
    ...publicDesktop,
    entries: [file],
    layout: { ...publicDesktop.layout, widgets: [{ id: "todo", kind: "todo", fileId: file.id, x: 90, y: 90, width: 340, height: 300 }], iconGroups: [] },
  }, new Map([[file.id, Buffer.from(body)]]));
  await page.goto("/published/e2e-desk");

  await expect(page.getByText("Read public notes", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Read public notes" })).toBeDisabled();
});

test("whole public desktops run Scene widgets and interactive Scene wallpaper", async ({ page }) => {
  const file = { ...publicDesktop.entries[0], id: "public-scene", name: "Public.hiraya.scene", mimeType: "application/vnd.hiraya.scene+zip", size: sceneFile.byteLength };
  await mockPublicDesktop(page, {
    ...publicDesktop,
    entries: [file],
    layout: {
      ...publicDesktop.layout,
      wallpaper: { ...publicDesktop.layout.wallpaper, source: `file:${file.id}` },
      widgets: [{ id: "scene", kind: "scene", fileId: file.id, x: 90, y: 90, width: 420, height: 300 }],
      iconGroups: [],
    },
  }, new Map([[file.id, sceneFile]]));
  await page.goto("/published/e2e-desk");

  const widget = page.frameLocator('iframe[title="Public.hiraya.scene widget"]');
  await widget.getByRole("button", { name: "Run Scene" }).click();
  await expect(widget.getByRole("button", { name: "Scene received input" })).toBeVisible();
  const wallpaper = page.frameLocator('iframe[title="Public.hiraya.scene wallpaper"]');
  await page.locator(".public-desktop__surface").click({ position: { x: 700, y: 400 } });
  await expect.poll(async () => JSON.parse(await wallpaper.locator("body").getAttribute("data-pointers") ?? "[]")).toContainEqual(expect.objectContaining({ phase: "pointerup", x: 700, y: 400, pointerType: "mouse" }));
});

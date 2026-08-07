import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

const email = process.env.HIRAYA_SERVER_E2E_EMAIL ?? "e2e-admin@example.test";
const password = process.env.HIRAYA_SERVER_E2E_PASSWORD ?? "release-gate-e2e-password";
const onlineFolder = "E2E cross-browser folder";
const offlineFolder = "E2E persisted offline folder";
const sandboxRuntimeFile = "E2E sandbox runtime.txt";
const mergeFile = "E2E merge conflict.txt";
const mediaFile = "E2E direct preview.wav";
const publicDesktopAlias = "e2e-public-desk";
const publicItemAlias = "public-folder";
const accountAppId = "dev.hiraya.release-e2e";
const accountAppName = "Release E2E App";
const accountAppPackageName = "release-e2e.hiraya.app";
const accountAppStorageKey = "shared-value";
const accountAppStorageValue = "written by session A";
const accountAppMatcher = ".release-e2e";
const accountAppFile = `handler${accountAppMatcher}`;

function accountAppPackage() {
  const manifest = { schemaVersion: 2, uiRuntime: 1, id: accountAppId, name: accountAppName, version: "1.0.0", entrypoint: "index.html", description: "Exercises account app synchronization.", permissions: ["files:read", "storage"], fileTypes: [accountAppMatcher] };
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${accountAppName}</title></head><body><main><h1>${accountAppName}</h1><label>Shared value <input id="value" value="${accountAppStorageValue}"></label><button id="write" disabled>Write synchronized value</button><button id="refresh" disabled>Refresh synchronized value</button><output id="current" role="status">Connecting...</output></main><script type="module" src="./app.js"></script></body></html>`;
  const script = `
const appId = "${accountAppId}";
const pending = new Map();
let port;
let sequence = 0;
const current = document.querySelector("#current");
const write = document.querySelector("#write");
const refresh = document.querySelector("#refresh");
function request(method, params = {}) {
  const id = String(++sequence);
  port.postMessage({ protocolVersion: 1, type: "request", id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function readValue() {
  const value = await request("storage.get", { key: "${accountAppStorageKey}" });
  current.textContent = value === undefined ? "No synchronized value" : String(value);
}
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.type !== "hiraya:init" || event.data.appId !== appId || event.ports.length !== 1) return;
  port = event.ports[0];
  port.addEventListener("message", (message) => {
    if (message.data?.type !== "response") return;
    const selected = pending.get(message.data.id);
    if (!selected) return;
    pending.delete(message.data.id);
    if (message.data.ok) selected.resolve(message.data.result);
    else selected.reject(new Error(message.data.error?.message ?? "Host request failed"));
  });
  port.start();
  port.postMessage({ protocolVersion: 1, type: "hiraya:ready", appId, nonce: event.data.nonce });
  void request("app.getLaunchContext").then(async () => { write.disabled = false; refresh.disabled = false; await readValue(); }).catch((error) => { current.textContent = error.message; });
});
write.addEventListener("click", async () => { write.disabled = true; try { const value = document.querySelector("#value").value; await request("storage.set", { key: "${accountAppStorageKey}", value }); current.textContent = value; } catch (error) { current.textContent = error.message; } finally { write.disabled = false; } });
refresh.addEventListener("click", () => void readValue().catch((error) => { current.textContent = error.message; }));
parent.postMessage({ protocolVersion: 1, type: "hiraya:connect", appId }, "*");
`;
  return Buffer.from(zipSync({ "hiraya.app.json": strToU8(JSON.stringify(manifest)), "index.html": strToU8(html), "app.js": strToU8(script) }));
}

function wavFile(byteLength = 2 * 1024 * 1024) {
  const dataLength = byteLength - 44;
  const buffer = Buffer.alloc(byteLength, 128);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(byteLength - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(8_000, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([page.waitForURL("/"), page.getByRole("button", { name: "Sign in" }).click()]);
  await expect(page.locator(".desktop-shell")).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Know where your work lives" });
  const onboarding = dialog.getByRole("button", { name: "Open desktop" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();
  await expect(dialog).toBeHidden();
  return page;
}

async function createFolder(page: Page, name: string) {
  await page.getByRole("region", { name: "Desktop desktop" }).click({ position: { x: 500, y: 300 } });
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("button", { name: `${name}, folder` })).toBeVisible();
}

async function createTextFile(page: Page, name: string) {
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function openAppStore(page: Page) {
  const existing = page.getByRole("dialog", { name: "App Store" });
  if (await existing.isVisible()) return existing;
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  const menu = page.getByRole("dialog", { name: /Start; account, system, and applications/ });
  await menu.locator("summary").filter({ hasText: "Applications" }).click();
  await menu.getByRole("button", { name: "App Store" }).click();
  await expect(existing).toBeVisible();
  return existing;
}

async function accountInventory(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/apps", { cache: "no-store", headers: { "X-Hiraya-Protocol": "entry-transactions-v2" } });
    if (!response.ok) throw new Error(`Account inventory failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<{ apps: Array<{ appId: string; package: { sha256: string }; data: Array<{ key: string }> }>; handlerHints: Record<string, string> }>;
  });
}

async function setAccountHandler(page: Page) {
  await page.evaluate(async ({ matcher, appId }) => {
    const response = await fetch("/api/apps/handlers", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", "X-Hiraya-Protocol": "entry-transactions-v2", "X-Hiraya-Client-ID": "server-e2e-apps", "X-Hiraya-Operation-ID": crypto.randomUUID() }, body: JSON.stringify({ hints: { [matcher]: appId } }) });
    if (!response.ok) throw new Error(`Handler update failed (${response.status}): ${await response.text()}`);
  }, { matcher: accountAppMatcher, appId: accountAppId });
}

async function inspectProtectedLayout(page: Page) {
  await page.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await page.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "Files & apps" }).click();
  await settings.getByRole("checkbox", { name: /Show hidden files/ }).check();
  await settings.getByRole("button", { name: "Close Settings" }).click();
  await page.locator(".file-icon").filter({ hasText: ".hiraya" }).dblclick();
  await page.getByRole("dialog", { name: ".hiraya" }).getByRole("button", { name: "desktop, folder" }).dblclick();
  await page.getByRole("dialog", { name: "desktop" }).getByRole("button", { name: "settings, folder" }).dblclick();
  await page.getByRole("dialog", { name: "settings" }).getByRole("button", { name: "layout.json, application/json" }).dblclick();
  const layout = page.getByRole("dialog", { name: "layout.json" });
  await expect(layout.locator(".cm-content")).toContainText("gridSize");
  await expect(layout.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("button", { name: "Download file" })).toBeVisible();
  await expect(layout.getByRole("button", { name: /Save/ })).toHaveCount(0);
  await layout.getByRole("button", { name: "Close layout.json" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
}

async function exerciseAccountApps(first: Page, second: Page) {
  const chooser = first.waitForEvent("filechooser");
  await first.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "Upload files" }).click();
  await (await chooser).setFiles({ name: accountAppPackageName, mimeType: "application/vnd.hiraya.app+zip", buffer: accountAppPackage() });
  await expect(first.getByText(accountAppPackageName, { exact: true })).toBeVisible();
  await first.locator(".file-icon").filter({ hasText: accountAppPackageName }).dblclick();
  const confirmation = first.getByRole("alertdialog", { name: `Install ${accountAppName}?` });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Install and run" }).click();
  const firstApp = first.getByRole("dialog", { name: accountAppName });
  await expect(firstApp).toBeVisible({ timeout: 30_000 });
  const firstFrame = firstApp.frameLocator("iframe.sandbox-app-frame");
  await expect(firstFrame.getByRole("button", { name: "Write synchronized value" })).toBeEnabled();
  await firstFrame.getByRole("button", { name: "Write synchronized value" }).click();
  await expect(firstFrame.getByRole("status")).toHaveText(accountAppStorageValue);
  await first.getByRole("button", { name: `Close ${accountAppName}` }).click();

  await createTextFile(first, accountAppFile);
  await expect(second.getByText(accountAppFile, { exact: true })).toBeVisible({ timeout: 30_000 });
  await setAccountHandler(first);
  await expect.poll(async () => {
    const inventory = await accountInventory(second);
    const app = inventory.apps.find((candidate) => candidate.appId === accountAppId);
    return { app: Boolean(app), data: app?.data.some((item) => item.key === accountAppStorageKey) ?? false, handler: inventory.handlerHints[accountAppMatcher] };
  }, { timeout: 30_000 }).toEqual({ app: true, data: true, handler: accountAppId });
  await second.reload();
  await expect(second.locator(".desktop-shell")).toBeVisible();
  const store = await openAppStore(second);
  const accountRow = store.locator("article").filter({ hasText: accountAppName });
  const openApproved = accountRow.getByRole("button", { name: "Open" });
  await expect(openApproved).toBeVisible({ timeout: 30_000 });
  await openApproved.click();
  const secondApp = second.getByRole("dialog", { name: accountAppName });
  await expect(secondApp).toBeVisible();
  await expect(secondApp.frameLocator("iframe.sandbox-app-frame").getByRole("status")).toHaveText(accountAppStorageValue, { timeout: 30_000 });
  await second.getByRole("button", { name: `Close ${accountAppName}` }).click();
  await second.getByRole("button", { name: "Close App Store" }).click();

  await second.locator(".file-icon").filter({ hasText: accountAppFile }).dblclick();
  await expect(second.getByRole("dialog", { name: accountAppName })).toBeVisible({ timeout: 30_000 });
  await second.getByRole("button", { name: `Close ${accountAppName}` }).click();
}

async function replaceEditorText(page: Page, text: string) {
  const frame = page.frameLocator("iframe.sandbox-app-frame");
  const editor = frame.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(text);
  await frame.locator("#save").click();
  await expect(frame.locator("#status")).toContainText("Saved", { timeout: 10_000 });
}

async function remoteText(page: Page, name: string) {
  return page.evaluate(async (fileName) => {
    const protocol = { "X-Hiraya-Protocol": "entry-transactions-v2" };
    const requireOk = async (response: Response, label: string) => {
      if (response.ok) return response;
      throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
    };
    const catalog = await (await requireOk(await fetch("/api/desktops", { cache: "no-store", headers: protocol }), "Catalog request")).json() as { desktops: Array<{ id: string }> };
    const desktopId = catalog.desktops[0].id;
    const desktop = await (await requireOk(await fetch(`/api/desktops/${desktopId}?projection=web`, { cache: "no-store", headers: protocol }), "Desktop request")).json() as { entries: Array<{ id: string; name: string; contentRevision: number }> };
    const entry = desktop.entries.find((candidate) => candidate.name === fileName);
    if (!entry) return "";
    const content = await requireOk(await fetch(`/api/desktops/${desktopId}/entries/${entry.id}/content?revision=${entry.contentRevision}`, { cache: "no-store", headers: protocol }), "Content descriptor request");
    const descriptor = await content.json() as { access: { url: string; method: string; headers: Record<string, string> } };
    return (await requireOk(await fetch(descriptor.access.url, { method: descriptor.access.method, headers: descriptor.access.headers, credentials: "omit" }), "Direct content request")).text();
  }, name);
}

async function verifyDirectDesktopLogin(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requestedPath = "/desktops/unavailable/areas/-2/3/settings?view=compact";
  await page.goto(requestedPath);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(requestedPath);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL(/\/desktops\/[^/]+\/areas\/-2\/3\/settings$/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  await expect(page.locator(".desktop-shell")).toBeVisible();
  await context.close();
}

async function primary(browser: Browser) {
  await verifyDirectDesktopLogin(browser);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await signIn(firstContext);
  const second = await signIn(secondContext);

  await inspectProtectedLayout(first);
  await exerciseAccountApps(first, second);

  await first.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await first.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  const settings = first.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Sharing" }).click();
  await settings.getByRole("button", { name: "Desktop & item sharing" }).click();
  const sharingDialog = first.getByRole("dialog", { name: /^Share / });
  const aliasInput = sharingDialog.getByLabel("Desktop alias");
  await expect(aliasInput).not.toHaveValue("");
  let sharingReloads = 0;
  first.on("request", (request) => {
    if (request.method() === "GET" && request.url().endsWith("/sharing")) sharingReloads += 1;
  });
  await aliasInput.fill("draft-public-alias");
  await first.waitForTimeout(250);
  await expect(aliasInput).toHaveValue("draft-public-alias");
  expect(sharingReloads).toBe(0);
  await sharingDialog.getByRole("button", { name: "Close sharing" }).click();
  await settings.getByRole("button", { name: "Close Settings" }).click();

  await createFolder(first, onlineFolder);
  await expect(second.getByRole("button", { name: `${onlineFolder}, folder` })).toBeVisible({ timeout: 30_000 });

  await firstContext.setOffline(true);
  await createFolder(first, offlineFolder);
  await expect(second.getByRole("button", { name: `${offlineFolder}, folder` })).toBeHidden();
  await firstContext.setOffline(false);
  await first.reload();
  await expect(second.getByRole("button", { name: `${offlineFolder}, folder` })).toBeVisible({ timeout: 30_000 });

  await createTextFile(first, sandboxRuntimeFile);
  await first.locator(".file-icon").filter({ hasText: sandboxRuntimeFile }).dblclick();
  await expect(first.getByRole("dialog", { name: `${sandboxRuntimeFile} - Text Editor` })).toBeVisible();
  const appFrame = first.frameLocator("iframe.sandbox-app-frame");
  await expect(appFrame.locator("#status")).toContainText(new RegExp(`^(Opened|Reloaded) ${sandboxRuntimeFile}`));
  await expect.poll(() => appFrame.locator("hiraya-toolbar").evaluate((toolbar) => ({
    foundation: document.body.classList.contains("hiraya-app"),
    toolbarDefined: Boolean(customElements.get("hiraya-toolbar")),
    toolbarShadow: Boolean(toolbar.shadowRoot),
    buttonDefined: Boolean(customElements.get("hiraya-button")),
    buttonShadow: Boolean(document.querySelector("hiraya-button")?.shadowRoot),
  }))).toEqual({ foundation: true, toolbarDefined: true, toolbarShadow: true, buttonDefined: true, buttonShadow: true });
  await first.getByRole("button", { name: `Close ${sandboxRuntimeFile} - Text Editor` }).click();

  await createTextFile(first, mergeFile);
  await expect(second.getByText(mergeFile, { exact: true })).toBeVisible({ timeout: 20_000 });
  await first.locator(".file-icon").filter({ hasText: mergeFile }).dblclick();
  await second.locator(".file-icon").filter({ hasText: mergeFile }).dblclick();
  await expect(first.getByRole("dialog", { name: `${mergeFile} - Text Editor` })).toBeVisible();
  await expect(second.getByRole("dialog", { name: `${mergeFile} - Text Editor` })).toBeVisible();
  await expect(first.frameLocator("iframe.sandbox-app-frame").locator("#status")).toContainText("Opened");
  await expect(second.frameLocator("iframe.sandbox-app-frame").locator("#status")).toContainText("Opened");
  await first.waitForTimeout(1_000);

  await firstContext.setOffline(true);
  await replaceEditorText(first, "Mine from the offline browser\n");
  await replaceEditorText(second, "Server from the online browser\n");
  await expect.poll(() => remoteText(second, mergeFile), { timeout: 30_000 }).toBe("Server from the online browser\n");
  await firstContext.setOffline(false);
  await first.reload();
  await expect(first.locator(".desktop-shell")).toBeVisible();

  await first.getByRole("button", { name: /^Notifications/ }).click();
  const reviewVersions = first.getByRole("button", { name: "Review versions" }).first();
  await expect(reviewVersions).toBeVisible({ timeout: 30_000 });
  await reviewVersions.click();
  const merge = first.getByRole("dialog", { name: `Merge · ${mergeFile}` });
  await expect(merge.getByText("Review versions", { exact: true })).toBeVisible();
  await expect(merge.getByRole("heading", { name: "Base" })).toBeVisible();
  await expect(merge.getByRole("heading", { name: "Mine" })).toBeVisible();
  await expect(merge.getByRole("heading", { name: "Server" })).toBeVisible();
  await first.setViewportSize({ width: 390, height: 844 });
  await expect(merge.getByRole("tab", { name: "Mine" })).toBeVisible();
  await merge.getByRole("tab", { name: "Server" }).click();
  await expect(merge.getByRole("heading", { name: "Server" })).toBeVisible();
  expect(await first.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await merge.getByRole("button", { name: "Use mine" }).click();
  await merge.locator("textarea").fill("Resolved by Merge\n");
  await merge.getByRole("button", { name: "Save merged" }).click();
  await expect(merge).toBeHidden({ timeout: 30_000 });
  await first.setViewportSize({ width: 1280, height: 720 });
  const restoredEditor = first.getByRole("dialog", { name: "Text Editor" });
  if (await restoredEditor.isVisible()) await first.getByRole("button", { name: "Close Text Editor" }).click();

  await expect.poll(() => remoteText(second, mergeFile), { timeout: 30_000 }).toBe("Resolved by Merge\n");
  await second.getByRole("button", { name: `Close ${mergeFile} - Text Editor` }).click();

  const chooser = first.waitForEvent("filechooser");
  await first.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "Upload files" }).click();
  await (await chooser).setFiles({ name: mediaFile, mimeType: "audio/wav", buffer: wavFile() });
  await expect(second.getByText(mediaFile, { exact: true })).toBeVisible({ timeout: 20_000 });
  await second.setViewportSize({ width: 390, height: 844 });
  await second.locator(".file-icon").filter({ hasText: mediaFile }).dblclick();
  const mediaViewer = second.getByRole("dialog", { name: "Document & Media Viewer" });
  const audio = mediaViewer.frameLocator("iframe").locator("audio");
  await expect(audio).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => audio.getAttribute("src")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);

  const staleConflict = await second.evaluate(async () => {
    const protocol = { "X-Hiraya-Protocol": "entry-transactions-v2" };
    const catalog = await fetch("/api/desktops", { cache: "no-store", headers: protocol }).then((response) => response.json()) as { desktops: Array<{ id: string }> };
    const desktop = await fetch(`/api/desktops/${catalog.desktops[0].id}?projection=web`, { cache: "no-store", headers: protocol }).then((response) => response.json()) as { id: string; layout: unknown; layoutRevision: number };
    const mutate = (operationId: string) => fetch(`/api/desktops/${desktop.id}/entries/transactions`, {
      method: "POST",
      headers: { ...protocol, "Content-Type": "application/json", "X-Hiraya-Client-ID": "server-e2e", "X-Hiraya-Operation-ID": operationId },
      body: JSON.stringify({ operations: [{ type: "entry.content.write", entryId: `${desktop.id}:system:layout`, systemRole: "layout", content: desktop.layout, baseRevision: desktop.layoutRevision }] }),
    });
    const firstResponse = await mutate("layout-first");
    const staleResponse = await mutate("layout-stale");
    return { first: firstResponse.status, stale: staleResponse.status, body: await staleResponse.json() };
  });
  expect(staleConflict).toMatchObject({ first: 200, stale: 409, body: { code: "revision_conflict", conflict: { resourceKind: "layout" } } });

  const publication = await first.evaluate(async ({ folderName, desktopAlias, itemAlias }) => {
    const protocol = { "X-Hiraya-Protocol": "entry-transactions-v2" };
    const catalog = await fetch("/api/desktops", { cache: "no-store", headers: protocol }).then((response) => response.json()) as { desktops: Array<{ id: string }> };
    const desktop = await fetch(`/api/desktops/${catalog.desktops[0].id}?projection=web`, { cache: "no-store", headers: protocol }).then((response) => response.json()) as { id: string; entries: Array<{ id: string; name: string }> };
    const folder = desktop.entries.find((entry) => entry.name === folderName);
    if (!folder) throw new Error("public folder was not found");
    const mutate = (path: string, body: unknown) => fetch(path, {
      method: "PUT",
      headers: { ...protocol, "Content-Type": "application/json", "X-Hiraya-Client-ID": "server-e2e-publication", "X-Hiraya-Operation-ID": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    const desktopResponse = await mutate(`/api/desktops/${desktop.id}/publication`, { alias: desktopAlias, shareEntire: false });
    const itemResponse = await mutate(`/api/desktops/${desktop.id}/publication/items/${folder.id}`, { alias: itemAlias });
    return { desktop: desktopResponse.status, item: itemResponse.status };
  }, { folderName: onlineFolder, desktopAlias: publicDesktopAlias, itemAlias: publicItemAlias });
  expect(publication).toEqual({ desktop: 200, item: 200 });

  const anonymousContext = await browser.newContext();
  const anonymous = await anonymousContext.newPage();
  const retired = await anonymous.goto("/shared/old-public-token");
  expect(retired?.status()).toBe(404);
  expect(await retired?.text()).not.toContain("<!doctype html>");
  await anonymous.goto(`/r/${publicDesktopAlias}/${publicItemAlias}`);
  await expect(anonymous).toHaveURL(`/published/${publicDesktopAlias}/${publicItemAlias}`);
  await expect(anonymous.getByRole("dialog", { name: onlineFolder })).toBeVisible();
  await expect(anonymous.getByText(sandboxRuntimeFile, { exact: true })).toBeHidden();
  await expect.poll(() => anonymous.evaluate(async ({ desktopAlias, itemAlias }) => {
    const response = await fetch(`/api/public/desktops/${desktopAlias}/${itemAlias}`, { cache: "no-store", credentials: "omit" });
    const body = await response.json() as { entries: Array<{ name: string }> };
    return body.entries.map((entry) => entry.name);
  }, { desktopAlias: publicDesktopAlias, itemAlias: publicItemAlias })).toEqual([onlineFolder]);
  await anonymousContext.close();

  await Promise.all([firstContext.close(), secondContext.close()]);
}

async function afterRestart(browser: Browser) {
  const context = await browser.newContext();
  const page = await signIn(context);
  await expect(page.getByRole("button", { name: `${onlineFolder}, folder` })).toBeVisible();
  await expect(page.getByRole("button", { name: `${offlineFolder}, folder` })).toBeVisible();

  const inventory = await accountInventory(page);
  const persistedApp = inventory.apps.find((app) => app.appId === accountAppId);
  expect(persistedApp?.package.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(persistedApp?.data.some((item) => item.key === accountAppStorageKey)).toBe(true);
  expect(inventory.handlerHints[accountAppMatcher]).toBe(accountAppId);
  const store = await openAppStore(page);
  const open = store.locator("article").filter({ hasText: accountAppName }).getByRole("button", { name: "Open" });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  const app = page.getByRole("dialog", { name: accountAppName });
  await expect(app.frameLocator("iframe.sandbox-app-frame").getByRole("status")).toHaveText(accountAppStorageValue, { timeout: 30_000 });
  await page.getByRole("button", { name: `Close ${accountAppName}` }).click();
  await page.getByRole("button", { name: "Close App Store" }).click();
  await page.locator(".file-icon").filter({ hasText: accountAppFile }).dblclick();
  await expect(page.getByRole("dialog", { name: accountAppName })).toBeVisible({ timeout: 30_000 });
  await context.close();

  const anonymousContext = await browser.newContext();
  const anonymous = await anonymousContext.newPage();
  await anonymous.goto(`/r/${publicDesktopAlias}/${publicItemAlias}`);
  await expect(anonymous).toHaveURL(`/published/${publicDesktopAlias}/${publicItemAlias}`);
  await expect(anonymous.getByRole("dialog", { name: onlineFolder })).toBeVisible();
  await expect(anonymous.getByText(sandboxRuntimeFile, { exact: true })).toBeHidden();
  await anonymousContext.close();
}

test("server-backed authentication, convergence, replay, conflict, and restart persistence", async ({ browser }) => {
  test.setTimeout(240_000);
  if (process.env.HIRAYA_SERVER_E2E_PHASE === "restart") await afterRestart(browser);
  else await primary(browser);
});

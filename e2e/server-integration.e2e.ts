import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const email = process.env.HIRAYA_SERVER_E2E_EMAIL ?? "e2e-admin@example.test";
const password = process.env.HIRAYA_SERVER_E2E_PASSWORD ?? "release-gate-e2e-password";
const onlineFolder = "E2E cross-browser folder";
const offlineFolder = "E2E persisted offline folder";
const sandboxRuntimeFile = "E2E sandbox runtime.txt";
const mediaFile = "E2E direct preview.wav";
const publicDesktopAlias = "e2e-public-desk";
const publicItemAlias = "public-folder";

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
    const catalog = await fetch("/api/desktops", { cache: "no-store" }).then((response) => response.json()) as { desktops: Array<{ id: string }> };
    const desktop = await fetch(`/api/desktops/${catalog.desktops[0].id}`, { cache: "no-store" }).then((response) => response.json()) as { id: string; layout: unknown; layoutRevision: number };
    const mutate = (operationId: string) => fetch(`/api/desktops/${desktop.id}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Hiraya-Client-ID": "server-e2e", "X-Hiraya-Operation-ID": operationId },
      body: JSON.stringify({ layout: desktop.layout, baseRevision: desktop.layoutRevision }),
    });
    const firstResponse = await mutate("layout-first");
    const staleResponse = await mutate("layout-stale");
    return { first: firstResponse.status, stale: staleResponse.status, body: await staleResponse.json() };
  });
  expect(staleConflict).toMatchObject({ first: 200, stale: 409, body: { code: "revision_conflict", conflict: { resourceKind: "layout" } } });

  const publication = await first.evaluate(async ({ folderName, desktopAlias, itemAlias }) => {
    const catalog = await fetch("/api/desktops", { cache: "no-store" }).then((response) => response.json()) as { desktops: Array<{ id: string }> };
    const desktop = await fetch(`/api/desktops/${catalog.desktops[0].id}`, { cache: "no-store" }).then((response) => response.json()) as { id: string; entries: Array<{ id: string; name: string }> };
    const folder = desktop.entries.find((entry) => entry.name === folderName);
    if (!folder) throw new Error("public folder was not found");
    const mutate = (path: string, body: unknown) => fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Hiraya-Client-ID": "server-e2e-publication", "X-Hiraya-Operation-ID": crypto.randomUUID() },
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
  test.setTimeout(90_000);
  if (process.env.HIRAYA_SERVER_E2E_PHASE === "restart") await afterRestart(browser);
  else await primary(browser);
});

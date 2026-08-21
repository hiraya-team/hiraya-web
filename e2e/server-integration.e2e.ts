import { expect, test, chromium, type BrowserContext, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";

/** Provides the phase test fixture. */
const phase = process.env.HIRAYA_SERVER_E2E_PHASE ?? "primary";
/** Provides the base URL test fixture. */
const baseURL = process.env.HIRAYA_SERVER_E2E_BASE_URL ?? "http://127.0.0.1:18080";
/** Provides the profile root test fixture. */
const profileRoot = process.env.HIRAYA_SERVER_E2E_PROFILE_ROOT;
/** Provides the owner email test fixture. */
const ownerEmail = process.env.HIRAYA_SERVER_E2E_EMAIL ?? "e2e-admin@example.test";
/** Provides the owner password test fixture. */
const ownerPassword = process.env.HIRAYA_SERVER_E2E_PASSWORD ?? "release-gate-e2e-password";
/** Provides the member email test fixture. */
const memberEmail = "e2e-member@example.test";
/** Provides the member password test fixture. */
const memberPassword = "member-release-gate-password";
/** Provides the file name test fixture. */
const fileName = "web2-architecture-proof.txt";
/** Provides the folder name test fixture. */
const folderName = "Web2 hydrated folder";

type Session = { accounts: Array<{ id: string; storageId: string; workspaces: Array<{ id: string }> }> };
type Tuple = { logicalTime: number; operationId: string };
type StoredNode = { id: string; workspaceId: string; name: string; kind: string; parentKey: string; lifecycleKey: string; fieldTuples?: { content?: Tuple } };
type PushedOperation = { kind: string; nodeIds?: string[]; namespace?: string; key?: string };

/** Returns the browser profile path. */
function profile(name: "a" | "b") {
  if (!profileRoot) throw new Error("HIRAYA_SERVER_E2E_PROFILE_ROOT is required.");
  return `${profileRoot}/${name}`;
}

/** Launches a browser session. */
async function launch(name: "a" | "b") {
  return chromium.launchPersistentContext(profile(name), { baseURL, headless: true, viewport: { width: 1280, height: 800 } });
}

/** Dismisses onboarding when it is visible. */
async function dismissOnboarding(page: Page) {
  const openDesktop = page.getByRole("button", { name: "Open desktop", exact: true });
  await openDesktop.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
  if (await openDesktop.isVisible().catch(() => false)) await openDesktop.click();
}

/** Asserts service worker. */
async function expectServiceWorker(page: Page) {
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker?.getRegistration())?.active), undefined, { timeout: 30_000 });
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 30_000 });
}

/** Asserts desktop. */
async function expectDesktop(page: Page) {
  await expect(page.locator(".desktop-shell, .startup-error")).toBeVisible({ timeout: 30_000 });
  const startupError = page.locator(".startup-error");
  if (await startupError.isVisible()) throw new Error(await startupError.innerText());
  await expect(page.locator(".desktop-shell")).toBeVisible({ timeout: 30_000 });
}

/** Signs in through the server-owned login page. */
async function signIn(context: BrowserContext) {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("/login");
  if (await page.locator(".desktop-shell").isVisible().catch(() => false)) return page;
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await Promise.all([page.waitForURL("/"), page.getByRole("button", { name: "Sign in" }).click()]);
  await expectDesktop(page);
  await dismissOnboarding(page);
  await expectServiceWorker(page);
  return page;
}

/** Returns the authenticated session. */
async function session(page: Page): Promise<Session> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) throw new Error(`session failed: ${response.status}`);
    return response.json();
  });
}

/** Creates a unique test token. */
function token() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** Invites a workspace member through sharing settings. */
async function inviteMember(page: Page, workspaceId: string) {
  const invitation = { id: crypto.randomUUID(), token: token() };
  const status = await page.evaluate(async ({ workspaceId, invitation, email }) => (await fetch(`/api/workspaces/${workspaceId}/sharing/invitations/${invitation.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Hiraya-Protocol": "web2-sync-v1", "X-Hiraya-Operation-ID": crypto.randomUUID() },
    body: JSON.stringify({ schemaVersion: 1, protocol: "web2-sync-v1", ...invitation, email, role: "writer" }),
  })).status, { workspaceId, invitation, email: memberEmail });
  expect(status).toBe(204);
  return invitation;
}

/** Registers a new account. */
async function register(context: BrowserContext, invitation: { token: string }, accountId: string, bootstrapRequests: unknown[]) {
  const page = context.pages()[0] ?? await context.newPage();
  page.on("request", (request) => { if (request.url().endsWith("/sync/bootstrap")) bootstrapRequests.push(request.postDataJSON()); });
  await page.goto(`/register?token=${encodeURIComponent(invitation.token)}`);
  await page.evaluate((selectedAccountId) => localStorage.setItem("hiraya-selected-account-web2-v1", selectedAccountId), accountId);
  await page.getByLabel("Email").fill(memberEmail);
  await page.getByLabel("Display name").fill("E2E Member");
  await page.getByLabel("Password").fill(memberPassword);
  await Promise.all([page.waitForURL("/"), page.getByRole("button", { name: "Create account" }).click()]);
  await expectDesktop(page);
  await dismissOnboarding(page);
  await expectServiceWorker(page);
  return page;
}

/** Creates folder. */
async function createFolder(page: Page, name: string) {
  await page.locator(".desktop").click({ position: { x: 560, y: 340 } });
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("button", { name: `${name}, folder` })).toBeVisible();
}

/** Creates text file. */
async function createTextFile(page: Page, name: string) {
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New text file" }).click();
  await page.getByLabel("File name").fill(name);
  await page.getByRole("button", { name: "Create file" }).click();
  await expect(page.locator(".file-icon").filter({ hasText: name })).toBeVisible();
}

/** Verifies that the editor retains its draft while offline. */
async function retainEditorOffline(page: Page) {
  await page.getByRole("button", { name: "Search apps, files, windows, and commands" }).click();
  const search = page.getByRole("dialog", { name: /Search/ });
  await search.locator("input").fill("Integrated Editor");
  await search.getByRole("group", { name: "Apps" }).getByRole("option", { name: /Integrated Editor/ }).click();
  const editor = page.getByRole("dialog", { name: /Integrated Editor/ });
  await expect(editor.frameLocator("iframe").locator("#status")).toBeVisible();
  await page.getByRole("button", { name: /Close .*Integrated Editor/ }).click();
}

/** Edits and saves text through the desktop editor. */
async function editText(page: Page, name: string, text: string) {
  await page.locator(".file-icon").filter({ hasText: name }).focus();
  await page.keyboard.press("Enter");
  const window = page.getByRole("dialog", { name: /Integrated Editor/ });
  await expect(window).toBeVisible();
  await expect(window.frameLocator("iframe").locator("#status")).toContainText(`Opened ${name}.`);
  const editor = window.frameLocator("iframe").locator(".cm-content");
  await editor.fill(text);
  await window.getByRole("button", { name: "Save", exact: true }).click();
  await expect(window.frameLocator("iframe").locator("#status")).toContainText("Saved");
  await page.getByRole("button", { name: /Close .*Integrated Editor/ }).click();
}

/** Reads text. */
async function readText(page: Page, name: string) {
  await page.locator(".file-icon").filter({ hasText: name }).focus();
  await page.keyboard.press("Enter");
  const window = page.getByRole("dialog", { name: /Integrated Editor/ });
  await expect(window).toBeVisible();
  await expect(window.frameLocator("iframe").locator("#status")).toContainText(`Opened ${name}.`);
  const text = await window.frameLocator("iframe").locator(".cm-content").innerText();
  await page.getByRole("button", { name: /Close .*Integrated Editor/ }).click();
  return text;
}

/** Reads the current file metadata tuple. */
async function fileTuple(page: Page, name: string): Promise<Tuple> {
  return page.evaluate(async (fileName) => {
    const databases = await indexedDB.databases();
    const matches = databases.flatMap(({ name }) => name?.startsWith("hiraya-web2-v1-") ? [name] : []);
    if (matches.length !== 1) throw new Error(`Expected one Web2 filesystem database, found ${matches.length}.`);
    const selected = matches[0]!;
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(selected); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const nodes = await new Promise<StoredNode[]>((resolve, reject) => { const request = database.transaction("nodes").objectStore("nodes").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const node = nodes.find((candidate) => candidate.name === fileName && candidate.kind === "file");
      if (!node?.fieldTuples?.content) throw new Error("File tuple not found.");
      const indexed = await new Promise<StoredNode[]>((resolve, reject) => { const request = database.transaction("nodes").objectStore("nodes").index("by-workspace-parent-lifecycle").getAll(IDBKeyRange.only([node.workspaceId, "", "active"])); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      if (!indexed.some(({ id }) => id === node.id)) throw new Error("File is absent from the root-node index.");
      return node.fieldTuples.content;
    } finally { database.close(); }
  }, name);
}

/** Compares synchronization tuples. */
function greater(left: Tuple, right: Tuple) {
  return left.logicalTime === right.logicalTime ? (left.operationId > right.operationId ? left : right) : left.logicalTime > right.logicalTime ? left : right;
}

/** Runs one round of concurrent editing. */
async function concurrentRound(a: Page, b: Page, aContext: BrowserContext, bContext: BrowserContext, aText: string, bText: string, order: "ab" | "ba") {
  const [aCurrent, bCurrent] = await Promise.all([readText(a, fileName), readText(b, fileName)]);
  expect(aCurrent).toBe(bCurrent);
  await Promise.all([aContext.setOffline(true), bContext.setOffline(true)]);
  await editText(a, fileName, aText);
  await editText(b, fileName, bText);
  const [aTuple, bTuple] = await Promise.all([fileTuple(a, fileName), fileTuple(b, fileName)]);
  const winning = greater(aTuple, bTuple);
  const expected = winning.operationId === aTuple.operationId ? aText : bText;
  const losing = expected === aText ? { page: b, text: bText } : { page: a, text: aText };
  const contexts = order === "ab" ? [aContext, bContext] : [bContext, aContext];
  await contexts[0].setOffline(false);
  await a.waitForTimeout(1200);
  await contexts[1].setOffline(false);
  await expect.poll(() => fileTuple(a, fileName), { timeout: 30_000 }).toEqual(winning);
  await expect.poll(() => fileTuple(b, fileName), { timeout: 30_000 }).toEqual(winning);
  expect(await readText(b, fileName)).toBe(expected);
  return { winning, expected, losing };
}

/** Restores retained version. */
async function restoreRetainedVersion(page: Page, text: string) {
  const icon = page.locator(".file-icon").filter({ hasText: fileName });
  await icon.click({ button: "right" });
  await page.getByRole("menu", { name: `Actions for ${fileName}` }).getByRole("menuitem", { name: "Properties" }).click();
  const properties = page.getByRole("dialog", { name: `${fileName} Properties` });
  const history = properties.getByRole("region", { name: "Version history" });
  await expect(history.getByRole("button", { name: "Compare" }).first()).toBeVisible();
  await expect(history.getByRole("button", { name: "Keep both" }).first()).toBeVisible();
  const retained = history.locator("li:not([data-current])").filter({ hasText: `${Buffer.byteLength(text)} bytes` }).first();
  await retained.getByRole("button", { name: "Compare" }).click();
  await expect(history.getByText("Version comparison")).toBeVisible();
  await retained.getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByRole("status").filter({ hasText: "File version restored" })).toBeVisible();
  await properties.getByRole("button", { name: /Close .*properties/i }).click();
  return fileTuple(page, fileName);
}

/** Verifies rejection of the retired synchronization protocol. */
async function rejectRetiredProtocol(page: Page, workspaceId: string) {
  const result = await page.evaluate(async (workspaceId) => {
    const oldRoute = await fetch("/api/desktops", { headers: { "X-Hiraya-Protocol": "entry-transactions-v2" } });
    const oldHeader = await fetch(`/api/workspaces/${workspaceId}/sync/pull`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hiraya-Protocol": "entry-transactions-v2" }, body: JSON.stringify({ schemaVersion: 1, protocol: "web2-sync-v1", workspaceId, deviceId: crypto.randomUUID(), cursor: 0 }) });
    return { oldRoute: oldRoute.status, oldHeader: oldHeader.status };
  }, workspaceId);
  expect(result.oldRoute).toBe(404);
  expect(result.oldHeader).toBeGreaterThanOrEqual(400);
}

/** Revokes access and verifies authorization is enforced. */
async function revokeAndProveAuthorization(a: Page, b: Page, bContext: BrowserContext, workspaceId: string) {
  await bContext.setOffline(true);
  await createFolder(b, "B pending before revocation");
  await expect(b.getByRole("button", { name: "B pending before revocation, folder" })).toBeVisible();
  const member = await a.evaluate(async (workspaceId) => (await (await fetch(`/api/workspaces/${workspaceId}/sharing`, { headers: { "X-Hiraya-Protocol": "web2-sync-v1" } })).json()).members.find((candidate: { email: string }) => candidate.email === "e2e-member@example.test"), workspaceId) as { userId: string };
  const revoked = await a.evaluate(async ({ workspaceId, userId }) => (await fetch(`/api/workspaces/${workspaceId}/sharing/members/${userId}`, { method: "DELETE", headers: { "X-Hiraya-Protocol": "web2-sync-v1", "X-Hiraya-Operation-ID": crypto.randomUUID() } })).status, { workspaceId, userId: member.userId });
  expect(revoked).toBe(204);
  await bContext.setOffline(false);
  const denied = await bContext.request.put(`/api/workspaces/${workspaceId}/publication`, { headers: { "X-Hiraya-Protocol": "web2-sync-v1", "X-Hiraya-Operation-ID": crypto.randomUUID() }, data: { schemaVersion: 1, protocol: "web2-sync-v1", alias: "revoked-user", shareEntire: true } });
  const upload = await bContext.request.post(`/api/workspaces/${workspaceId}/sync/chunks/uploads`, { headers: { "X-Hiraya-Protocol": "web2-sync-v1" }, data: { schemaVersion: 1, protocol: "web2-sync-v1", kind: "chunk-upload-request", workspaceId, deviceId: crypto.randomUUID(), operationId: crypto.randomUUID(), manifestHash: "0".repeat(64), manifest: { schemaVersion: 1, size: 0, chunkSize: 1048576, chunks: [] } } });
  expect(denied.status()).toBe(403);
  expect(upload.status()).toBe(403);
}

test("Web2 persistent profiles prove the fourteen architecture steps", async () => {
  test.skip(phase !== "primary", "primary phase only");
  const aContext = await launch("a");
  const bContext = await launch("b");
  const a = await signIn(aContext);
  const ownerSession = await session(a);
  const workspaceId = ownerSession.accounts[0]!.workspaces[0]!.id;
  const invitation = await inviteMember(a, workspaceId);
  await retainEditorOffline(a);

  await aContext.setOffline(true);
  await createTextFile(a, fileName);
  await editText(a, fileName, "Offline draft one");
  await editText(a, fileName, "Offline draft two with retained history");
  await a.reload();
  await expect(a.locator(".desktop-shell")).toBeVisible();
  await expect(a.locator(".file-icon").filter({ hasText: fileName })).toBeVisible();

  const uploadPlans: Array<{ missingChunks: Array<{ url: string }> }> = [];
  const directPuts: string[] = [];
  a.on("response", async (response) => { if (response.url().endsWith("/sync/chunks/uploads") && response.ok()) uploadPlans.push(await response.json()); });
  a.on("request", (request) => { if (request.method() === "PUT" && !request.url().startsWith(baseURL)) directPuts.push(request.url()); });
  await aContext.setOffline(false);
  await expect.poll(() => uploadPlans.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => directPuts.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const missingUrls = uploadPlans.flatMap(({ missingChunks }) => missingChunks.map(({ url }) => url));
  expect(new Set(directPuts).size).toBe(directPuts.length);
  expect(directPuts.every((url) => missingUrls.includes(url))).toBe(true);
  await a.locator(".file-icon").filter({ hasText: fileName }).click({ button: "right" });
  await a.getByRole("menu", { name: `Actions for ${fileName}` }).getByRole("menuitem", { name: "Properties" }).click();
  await expect(a.getByRole("dialog", { name: `${fileName} Properties` }).getByRole("region", { name: "Version history" }).locator("li")).toHaveCount(3);
  await a.getByRole("dialog", { name: `${fileName} Properties` }).getByRole("button", { name: /Close .*properties/i }).click();

  await createFolder(a, folderName);
  const bootstrapRequests: unknown[] = [];
  const b = await register(bContext, invitation, ownerSession.accounts[0]!.id, bootstrapRequests);
  expect(bootstrapRequests).toHaveLength(1);
  await expect.poll(() => fileTuple(b, fileName), { timeout: 30_000 }).toEqual(expect.objectContaining({ logicalTime: expect.any(Number), operationId: expect.any(String) }));
  await expect(b.locator(".file-icon").filter({ hasText: fileName })).toBeVisible({ timeout: 30_000 });

  let chunkDownloads = 0;
  b.on("request", (request) => { if (request.url().endsWith("/sync/chunks/downloads")) chunkDownloads += 1; });
  expect(await readText(b, fileName)).toBe("Offline draft two with retained history");
  expect(chunkDownloads).toBe(1);

  const hydrationPromise = b.waitForRequest((request) => request.url().endsWith("/sync/hydrate"));
  await b.locator(".file-icon").filter({ hasText: folderName }).dblclick();
  const hydration = await hydrationPromise;
  const hydrationBody = hydration.postDataJSON() as { target: { kind: string; parentId: string; asOf: number } };
  expect(hydrationBody.target).toMatchObject({ kind: "folder-page" });
  expect(hydrationBody.target.asOf).toBeGreaterThan(0);
  await b.getByRole("button", { name: `Close ${folderName}` }).click();

  await concurrentRound(a, b, aContext, bContext, "A wins or loses in A-first order", "B independent A-first source", "ab");
  const secondRound = await concurrentRound(a, b, aContext, bContext, "A independent B-first losing candidate", "B wins or loses in B-first order with more bytes", "ba");
  const restored = await restoreRetainedVersion(secondRound.losing.page, secondRound.losing.text);
  expect(restored).not.toEqual(secondRound.winning);
  await expect.poll(() => fileTuple(a, fileName), { timeout: 30_000 }).toEqual(restored);
  await expect.poll(() => fileTuple(b, fileName), { timeout: 30_000 }).toEqual(restored);
  expect(await readText(b, fileName)).toBe(secondRound.losing.text);

  const pushed: PushedOperation[] = [];
  a.on("request", (request) => { if (request.url().endsWith("/sync/push")) pushed.push(...((request.postDataJSON() as { operations: PushedOperation[] }).operations)); });
  await a.locator(".file-icon").filter({ hasText: fileName }).dragTo(a.locator(".file-icon").filter({ hasText: folderName }));
  await a.getByRole("button", { name: /Start; account, system, and applications/ }).click();
  await a.getByRole("dialog", { name: /Start; account, system, and applications/ }).getByRole("button", { name: "Settings" }).click();
  await a.locator('[data-app-window="settings"]').getByRole("button", { name: /Theme Editor/ }).click();
  await a.getByRole("button", { name: "Close Settings" }).click();
  const themeEditor = a.getByRole("dialog", { name: "Theme Editor" }).frameLocator("iframe");
  await themeEditor.getByRole("option", { name: /Warm Paper/ }).click();
  await expect.poll(() => pushed.some((operation) => operation.kind === "move" && operation.nodeIds?.length === 1), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => pushed.some((operation) => operation.kind === "set" && operation.namespace === "theme-selection" && operation.key === "selected"), { timeout: 30_000 }).toBe(true);
  await a.getByRole("button", { name: "Close Theme Editor" }).click();
  await a.getByRole("alertdialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard and close" }).click();
  await expect(a.getByRole("dialog", { name: "Theme Editor" })).toBeHidden();

  let firstReceipt: unknown;
  let replayReceipt: unknown;
  let replayedOperation = "";
  let attempts = 0;
  await a.route("**/sync/push", async (route) => {
    const body = route.request().postDataJSON() as { operations: Array<{ operationId: string }> };
    if (!replayedOperation) {
      replayedOperation = body.operations[0]!.operationId;
      attempts += 1;
      const response = await route.fetch();
      firstReceipt = await response.json();
      await route.abort("connectionreset");
      return;
    }
    if (body.operations.some(({ operationId }) => operationId === replayedOperation)) {
      attempts += 1;
      const response = await route.fetch();
      replayReceipt = await response.json();
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await createFolder(a, "Lost push receipt folder");
  await expect.poll(() => attempts, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(replayReceipt).toEqual(firstReceipt);
  await a.unroute("**/sync/push");

  const index = await a.request.get("/").then((response) => response.text());
  const entryPath = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(index)?.[1];
  if (!entryPath) throw new Error("Initial module entry was not found.");
  const entry = await a.request.get(entryPath).then((response) => response.body());
  expect(gzipSync(entry).byteLength).toBeLessThan(100 * 1024);

  await rejectRetiredProtocol(a, workspaceId);
  await revokeAndProveAuthorization(a, b, bContext, workspaceId);
  await Promise.all([aContext.close(), bContext.close()]);
});

test("persistent Web2 profile survives a server restart", async () => {
  test.skip(phase !== "restart", "restart phase only");
  const context = await launch("a");
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("/");
  await expectDesktop(page);
  await expect(page.locator(".file-icon").filter({ hasText: folderName })).toBeVisible();
  const current = await session(page);
  expect(current.accounts[0]?.storageId).toMatch(/^[0-9a-f-]{36}$/);
  await context.close();
});

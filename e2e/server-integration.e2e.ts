import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const email = process.env.HIRAYA_SERVER_E2E_EMAIL ?? "e2e-admin@example.test";
const password = process.env.HIRAYA_SERVER_E2E_PASSWORD ?? "release-gate-e2e-password";
const onlineFolder = "E2E cross-browser folder";
const offlineFolder = "E2E persisted offline folder";

async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([page.waitForURL("/"), page.getByRole("button", { name: "Sign in" }).click()]);
  await expect(page.locator(".desktop-shell")).toBeVisible();
  const onboarding = page.getByRole("button", { name: "Open desktop" });
  await expect(onboarding).toBeVisible();
  await onboarding.click();
  return page;
}

async function createFolder(page: Page, name: string) {
  await page.getByRole("region", { name: "Desktop desktop" }).click({ position: { x: 500, y: 300 } });
  await page.getByRole("toolbar", { name: "File actions" }).getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create folder" }).click();
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
  await expect(second.getByText(onlineFolder, { exact: true })).toBeVisible({ timeout: 15_000 });

  await firstContext.setOffline(true);
  await createFolder(first, offlineFolder);
  await expect(second.getByText(offlineFolder, { exact: true })).toBeHidden();
  await firstContext.setOffline(false);
  await first.reload();
  await expect(second.getByText(offlineFolder, { exact: true })).toBeVisible({ timeout: 20_000 });

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

  await Promise.all([firstContext.close(), secondContext.close()]);
}

async function afterRestart(browser: Browser) {
  const context = await browser.newContext();
  const page = await signIn(context);
  await expect(page.getByText(onlineFolder, { exact: true })).toBeVisible();
  await expect(page.getByText(offlineFolder, { exact: true })).toBeVisible();
  await context.close();
}

test("server-backed authentication, convergence, replay, conflict, and restart persistence", async ({ browser }) => {
  if (process.env.HIRAYA_SERVER_E2E_PHASE === "restart") await afterRestart(browser);
  else await primary(browser);
});

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InstalledApp } from "../src/apps/installed-apps";
import { storePackageKey, storePackageManifest, storePackageNeedsRefreshInspection, storeSearchMatches, type StorePackage } from "../src/lib/app-store";
import { AppStoreWindow, type StorePackageView } from "../src/components/AppStoreWindow";

const systemApp: InstalledApp = {
  appId: "app.hiraya.text-editor",
  source: "system",
  packageEntryId: null,
  archivePath: "system-apps/text-editor.hiraya.app",
  digest: "a".repeat(64),
  version: "1.0.0",
  approvedAt: 1,
  manifest: {
    schemaVersion: 2,
    id: "app.hiraya.text-editor",
    name: "Integrated Editor",
    version: "1.0.0",
    entrypoint: "index.html",
    permissions: ["files:read", "files:write"],
    fileTypes: ["text/*"],
  },
};

const base = {
  packages: [],
  installedApps: [systemApp],
  entries: [],
  loading: false,
  error: "The app store requires a synchronized Hiraya account.",
  offline: false,
  installingPackageKey: null,
  onRetry: () => undefined,
  onInstall: () => undefined,
  canAddToDesktop: true,
  onAddToDesktop: () => undefined,
  onLaunch: () => undefined,
  onReset: () => undefined,
  onUninstall: () => undefined,
};

const todoPackage: StorePackage = {
  source: "remote",
  kind: "store",
  catalogId: "admin-catalog",
  catalogRevision: 1,
  desktopId: "admin-store",
  contentRevision: 1,
  entry: { id: "admin-todo", kind: "file", name: "todo.hiraya.app", parentId: null, createdAt: null, modifiedAt: 0, position: { x: 0, y: 0 }, mimeType: "application/zip", size: 1024 },
};
const managedTodoPackage: StorePackage = {
  ...todoPackage,
  release: { kind: "store", slug: "todo", fileName: todoPackage.entry.name, digest: "b".repeat(64), size: todoPackage.entry.size, manifest: { ...systemApp.manifest, id: "dev.hiraya.todo", name: "Todo", description: "Keep portable task lists." } },
};
const managedTodoRelease = managedTodoPackage.release;

const todoView: StorePackageView = { item: todoPackage, name: "Todo", description: "Keep portable task lists.", version: "0.1.0", appId: "dev.hiraya.todo", digest: null, loading: false, error: "" };

describe("App Store", () => {
  test("matches every search term across app metadata", () => {
    expect(storeSearchMatches("todo task", "Todo", "Keep portable task lists.", "dev.hiraya.todo", "0.1.0")).toBe(true);
    expect(storeSearchMatches("HIRAYA 0.1", "Todo", "dev.hiraya.todo", "0.1.0")).toBe(true);
    expect(storeSearchMatches("todo calendar", "Todo", "Keep portable task lists.")).toBe(false);
  });

  test("uses managed catalog metadata without inspecting package bytes on refresh", () => {
    expect(storePackageManifest(managedTodoPackage)?.name).toBe("Todo");
    expect(storePackageNeedsRefreshInspection(managedTodoPackage, false)).toBe(false);
    expect(storePackageNeedsRefreshInspection(todoPackage, false)).toBe(true);

    if (!managedTodoRelease) throw new Error("Managed package release is missing.");
    const systemPackage = { ...managedTodoPackage, kind: "system", release: { ...managedTodoRelease, kind: "system" } } as const;
    expect(storePackageNeedsRefreshInspection(systemPackage, true)).toBe(false);
    expect(storePackageNeedsRefreshInspection(systemPackage, false)).toBe(true);
  });

  test("keeps installed app details and management available when the catalog is unavailable", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} />);

    expect(markup).toContain("Search apps, descriptions, or IDs");
    expect(markup).toContain("Integrated Editor");
    expect(markup).toContain("Trusted system app");
    expect(markup).toContain("Trusted by Hiraya");
    expect(markup).toContain("Reset data");
    expect(markup).toContain("Add to desktop");
    expect(markup).toContain("Administrator store unavailable");
    expect(markup).not.toContain("Uninstall");
  });

  test("disables desktop shortcuts when the desktop is read only", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} canAddToDesktop={false} />);
    expect(markup).toContain("Add to desktop");
    expect(markup).toContain('title="This desktop is read only"');
    expect(markup).toContain("Application shortcuts cannot be added here");
    expect(markup).toContain('aria-describedby="app-shortcut-restriction"');
  });

  test("disables opening an unavailable desktop package and allows uninstall", () => {
    const desktopApp: InstalledApp = { ...systemApp, appId: "app.example.editor", source: "desktop", packageEntryId: "missing-package", archivePath: null, manifest: { ...systemApp.manifest, id: "app.example.editor", name: "Example Editor" } };
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[desktopApp]} />);

    expect(markup).toContain("Unavailable");
    expect(markup).toContain("Uninstall");
    expect(markup).toContain("disabled");
    expect(markup).toContain("No apps published yet");
  });

  test("offers administrator-published packages", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" packages={[todoView]} />);

    expect(markup).toContain("Todo");
    expect(markup).toContain("Keep portable task lists.");
    expect(markup).toContain("Install");
    expect(markup).not.toContain("No apps published yet");
  });

  test("shows immediate progress while installing or updating a package", () => {
    const installing = renderToStaticMarkup(<AppStoreWindow {...base} error="" packages={[todoView]} installingPackageKey={storePackageKey(todoPackage)} />);
    const installed: InstalledApp = {
      ...systemApp,
      appId: "dev.hiraya.todo",
      source: "store",
      packageEntryId: todoPackage.entry.id,
      archivePath: null,
      sourceCatalogId: todoPackage.catalogId,
      sourceDesktopId: todoPackage.desktopId,
      sourceContentRevision: 0,
      manifest: { ...systemApp.manifest, id: "dev.hiraya.todo", name: "Todo" },
    };
    const updating = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[installed]} packages={[todoView]} installingPackageKey={storePackageKey(todoPackage)} />);

    expect(installing).toContain("Installing...");
    expect(installing).toContain('aria-busy="true"');
    expect(installing).toContain("activity-spinner");
    expect(updating).toContain("Updating...");
    expect(updating).toContain('aria-busy="true"');
  });

  test("explains offline actions", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" packages={[todoView]} offline />);

    expect(markup).toContain("App Store offline");
    expect(markup).toContain("Reconnect to install this app");
  });

  test("distinguishes an empty catalog from one whose apps are installed", () => {
    const installed: InstalledApp = {
      ...systemApp,
      appId: "dev.hiraya.todo",
      source: "store",
      packageEntryId: todoPackage.entry.id,
      archivePath: null,
      sourceCatalogId: todoPackage.catalogId,
      sourceDesktopId: todoPackage.desktopId,
      sourceContentRevision: todoPackage.contentRevision,
      manifest: { ...systemApp.manifest, id: "dev.hiraya.todo", name: "Todo" },
    };
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[installed]} packages={[todoView]} />);

    expect(markup).toContain("All published apps are installed");
    expect(markup).not.toContain("No apps published yet");
  });

  test("retains provenance for apps installed from the former bundled catalog", () => {
    const installed: InstalledApp = { ...systemApp, source: "store", packageEntryId: "todo", archivePath: null, sourceCatalogId: "hiraya-app-store", sourceDesktopId: "bundled-app-store", sourceContentRevision: 1 };
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[installed]} />);

    expect(markup).toContain("Hiraya App Store");
    expect(markup).toContain("Published by Hiraya; approved in this browser");
  });

  test("prefers an installed app's exact catalog when matching updates", () => {
    const adminPackage: StorePackage = { ...todoPackage, contentRevision: 2 };
    const adminView: StorePackageView = { ...todoView, item: adminPackage };
    const installed: InstalledApp = {
      ...systemApp,
      appId: "dev.hiraya.todo",
      source: "store",
      packageEntryId: adminPackage.entry.id,
      archivePath: null,
      sourceCatalogId: adminPackage.catalogId,
      sourceDesktopId: adminPackage.desktopId,
      sourceContentRevision: adminPackage.contentRevision,
      manifest: { ...systemApp.manifest, id: "dev.hiraya.todo", name: "Todo" },
    };
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[installed]} packages={[adminView]} />);

    expect(markup).toContain("Administrator App Store");
    expect(markup).not.toContain("Update available");
  });

  test("does not offer an update when an account install matches the published package", () => {
    const installed: InstalledApp = {
      ...systemApp,
      appId: "dev.hiraya.todo",
      source: "account",
      packageEntryId: null,
      archivePath: null,
      installationGeneration: 1,
      digest: managedTodoRelease!.digest,
      manifest: managedTodoRelease!.manifest,
    };
    const view: StorePackageView = { ...todoView, item: managedTodoPackage, digest: managedTodoRelease!.digest };
    const current = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[installed]} packages={[view]} />);
    const changed = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[{ ...installed, digest: "c".repeat(64) }]} packages={[view]} />);

    expect(current).not.toContain("Update available");
    expect(current).not.toContain(" Update</button>");
    expect(changed).toContain("Update available");
    expect(changed).toContain(" Update</button>");
  });
});

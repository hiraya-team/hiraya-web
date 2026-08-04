import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InstalledApp } from "../src/apps/installed-apps";
import type { StorePackage } from "../src/lib/app-store";
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
    name: "Text Editor",
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
  onRetry: () => undefined,
  onInstall: () => undefined,
  onLaunch: () => undefined,
  onReset: () => undefined,
  onUninstall: () => undefined,
};

const todoPackage: StorePackage = {
  source: "bundled",
  kind: "store",
  archivePath: "app-store/todo.hiraya.app",
  digest: "b".repeat(64),
  catalogId: "hiraya-app-store",
  catalogRevision: 0,
  desktopId: "bundled-app-store",
  contentRevision: 1,
  entry: { id: "bundled:todo", kind: "file", name: "todo.hiraya.app", parentId: null, createdAt: null, modifiedAt: 0, position: { x: 0, y: 0 }, mimeType: "application/zip", size: 1024 },
};

const todoView: StorePackageView = { item: todoPackage, name: "Todo", description: "Keep portable task lists.", version: "0.1.0", appId: "dev.hiraya.todo", loading: false, error: "" };

describe("App Store", () => {
  test("keeps installed app details and management available when the catalog is unavailable", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} />);

    expect(markup).toContain("Text Editor");
    expect(markup).toContain("Trusted system app");
    expect(markup).toContain("Trusted by Hiraya");
    expect(markup).toContain("Reset data");
    expect(markup).toContain("Administrator store unavailable");
    expect(markup).not.toContain("Uninstall");
  });

  test("disables opening an unavailable desktop package and allows uninstall", () => {
    const desktopApp: InstalledApp = { ...systemApp, appId: "app.example.editor", source: "desktop", packageEntryId: "missing-package", archivePath: null, manifest: { ...systemApp.manifest, id: "app.example.editor", name: "Example Editor" } };
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[desktopApp]} />);

    expect(markup).toContain("Unavailable");
    expect(markup).toContain("Uninstall");
    expect(markup).toContain("disabled");
  });

  test("offers first-party packages without an administrator store", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" packages={[todoView]} />);

    expect(markup).toContain("Todo");
    expect(markup).toContain("Keep portable task lists.");
    expect(markup).toContain("Install");
    expect(markup).not.toContain("No apps published yet");
  });

  test("prefers an installed app's exact catalog when matching updates", () => {
    const adminPackage: StorePackage = { ...todoPackage, source: "remote", catalogId: "admin-catalog", desktopId: "admin-store", contentRevision: 2, entry: { ...todoPackage.entry, id: "admin-todo" } };
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
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[installed]} packages={[todoView, adminView]} />);

    expect(markup).toContain("Administrator App Store");
    expect(markup).not.toContain("Update available");
  });
});

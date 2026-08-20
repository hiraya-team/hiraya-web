import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InstalledApp } from "../src/apps/installed-apps";
import { AppStoreWindow } from "../src/components/AppStoreWindow";

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
  installedApps: [systemApp],
  entries: [],
  offline: false,
  canAddToDesktop: true,
  onAddToDesktop: () => undefined,
  onLaunch: () => undefined,
  onReset: () => undefined,
  onUninstall: () => undefined,
};

describe("Applications", () => {
  test("shows installed app details and management", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} />);
    expect(markup).toContain("Search apps, descriptions, or IDs");
    expect(markup).toContain("Integrated Editor");
    expect(markup).toContain("Trusted system app");
    expect(markup).toContain("Trusted by Hiraya");
    expect(markup).toContain("Reset data");
    expect(markup).toContain("Add to desktop");
    expect(markup).not.toContain("Uninstall");
  });

  test("disables desktop shortcuts when the desktop is read only", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} canAddToDesktop={false} />);
    expect(markup).toContain('title="This desktop is read only"');
    expect(markup).toContain("Application shortcuts cannot be added here");
    expect(markup).toContain('aria-describedby="app-shortcut-restriction"');
  });

  test("disables opening an unavailable desktop package and allows uninstall", () => {
    const desktopApp: InstalledApp = { ...systemApp, appId: "app.example.editor", source: "desktop", packageEntryId: "missing-package", archivePath: null, manifest: { ...systemApp.manifest, id: "app.example.editor", name: "Example Editor" } };
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} installedApps={[desktopApp]} />);
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("Uninstall");
    expect(markup).toContain("disabled");
  });

  test("explains account synchronization while offline", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} offline accountPending={1} />);
    expect(markup).toContain("Account sync offline");
    expect(markup).toContain("Account changes pending");
  });
});

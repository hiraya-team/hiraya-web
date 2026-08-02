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

describe("App Store", () => {
  test("keeps installed app details and management available when the catalog is unavailable", () => {
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} />);

    expect(markup).toContain("Text Editor");
    expect(markup).toContain("Bundled system app");
    expect(markup).toContain("Trusted by Hiraya");
    expect(markup).toContain("Reset data");
    expect(markup).toContain("Store unavailable");
    expect(markup).not.toContain("Uninstall");
  });

  test("disables opening an unavailable desktop package and allows uninstall", () => {
    const desktopApp: InstalledApp = { ...systemApp, appId: "app.example.editor", source: "desktop", packageEntryId: "missing-package", archivePath: null, manifest: { ...systemApp.manifest, id: "app.example.editor", name: "Example Editor" } };
    const markup = renderToStaticMarkup(<AppStoreWindow {...base} error="" installedApps={[desktopApp]} />);

    expect(markup).toContain("Unavailable");
    expect(markup).toContain("Uninstall");
    expect(markup).toContain("disabled");
  });
});

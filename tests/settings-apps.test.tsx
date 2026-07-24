import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsWindow } from "../src/components/SettingsWindow";
import { DEFAULT_THEME_STATE } from "../src/lib/themes";
import { DEFAULT_WALLPAPER } from "../src/types";
import type { InstalledApp } from "../src/apps/installed-apps";

const systemApp: InstalledApp = {
  appId: "app.hiraya.text-editor",
  source: "system",
  packageEntryId: null,
  archivePath: "system-apps/text-editor.hiraya.app",
  digest: "a".repeat(64),
  version: "1.0.0",
  approvedAt: 1,
  manifest: {
    schemaVersion: 1,
    id: "app.hiraya.text-editor",
    name: "Text Editor",
    version: "1.0.0",
    entrypoint: "index.html",
    permissions: ["files:read", "files:write"],
    fileTypes: ["text/*"],
  },
};

describe("Settings apps UI", () => {
  test("shows bundled trust, reset, and file defaults without an uninstall action", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "apps",
      onPageChange: () => undefined,
      layout: { snapToGrid: false, wallpaper: DEFAULT_WALLPAPER },
      activeDesktopId: "desktop",
      entries: [],
      appearance: DEFAULT_THEME_STATE,
      canMutate: true,
      installedApps: [systemApp],
      quarantinedApps: [],
      fileAssociations: [{ matcher: ".txt", appId: systemApp.appId, createdAt: 1 }],
      onLaunchApp: () => undefined,
      onUninstallApp: () => undefined,
      onExportQuarantinedApp: () => undefined,
      onRemoveQuarantinedApp: () => undefined,
      onResetApp: () => undefined,
      onSetFileAssociation: () => undefined,
      onRemoveFileAssociation: () => undefined,
      onResetFileAssociations: () => undefined,
      onOpenHelp: () => undefined,
    } as Parameters<typeof SettingsWindow>[0])} />);

    expect(markup).toContain("Bundled system app");
    expect(markup).toContain("Installed bundled apps, user-approved packages");
    expect(markup).toContain("Trusted by Hiraya");
    expect(markup).toContain("Reset data");
    expect(markup).toContain("Text and source files");
    expect(markup).toContain("Preferred app for .txt");
    expect(markup).not.toContain("Uninstall");
  });

  test("surfaces quarantined app storage with download and removal controls", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "apps", onPageChange: () => undefined, layout: { snapToGrid: false, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], appearance: DEFAULT_THEME_STATE, canMutate: true,
      installedApps: [systemApp], fileAssociations: [], quarantinedApps: [{ appId: systemApp.appId, packageEntryId: "old-package", digest: "b".repeat(64), version: "0.9.0", manifest: { name: "Old editor" }, approvedAt: 1, storage: [{ key: "draft", value: { text: "kept" }, bytes: 15 }] }],
      onLaunchApp: () => undefined, onUninstallApp: () => undefined, onResetApp: () => undefined, onExportQuarantinedApp: () => undefined, onRemoveQuarantinedApp: () => undefined, onSetFileAssociation: () => undefined, onRemoveFileAssociation: () => undefined, onResetFileAssociations: () => undefined, onOpenHelp: () => undefined,
    } as Parameters<typeof SettingsWindow>[0])} />);
    expect(markup).toContain("Recovered app data");
    expect(markup).toContain("Download export");
    expect(markup).toContain("15 bytes");
    expect(markup).toContain("Remove");
  });
});

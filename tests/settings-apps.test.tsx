import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsWindow } from "../src/components/SettingsWindow";
import { DEFAULT_THEME_STATE } from "../src/lib/themes";
import { DEFAULT_GRID_SIZE, DEFAULT_WALLPAPER } from "../src/types";
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
    name: "Integrated Editor",
    version: "1.0.0",
    entrypoint: "index.html",
    permissions: ["files:read", "files:write"],
    fileTypes: ["text/*"],
  },
};

describe("Settings app data UI", () => {
  test("keeps file defaults without duplicating installed-app management", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "files-apps/file-types",
      onPageChange: () => undefined,
      layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: DEFAULT_WALLPAPER },
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

    expect(markup).toContain("File type defaults");
    expect(markup).toContain("Text and source files");
    expect(markup).toContain("Preferred app for .txt");
    expect(markup).not.toContain("Bundled system app");
    expect(markup).not.toContain("Reset data");
    expect(markup).not.toContain("Uninstall");
  });

  test("surfaces quarantined app storage with download and removal controls", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "files-apps/recovered-data", onPageChange: () => undefined, layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], appearance: DEFAULT_THEME_STATE, canMutate: true,
      installedApps: [systemApp], fileAssociations: [], quarantinedApps: [{ appId: systemApp.appId, packageEntryId: "old-package", digest: "b".repeat(64), version: "0.9.0", manifest: { name: "Old editor" }, approvedAt: 1, storage: [{ key: "draft", value: { text: "kept" }, bytes: 15 }] }],
      onLaunchApp: () => undefined, onUninstallApp: () => undefined, onResetApp: () => undefined, onExportQuarantinedApp: () => undefined, onRemoveQuarantinedApp: () => undefined, onSetFileAssociation: () => undefined, onRemoveFileAssociation: () => undefined, onResetFileAssociations: () => undefined, onOpenHelp: () => undefined,
    } as Parameters<typeof SettingsWindow>[0])} />);
    expect(markup).toContain("Recovered app data");
    expect(markup).toContain("Download export");
    expect(markup).toContain("15 bytes");
    expect(markup).toContain("Remove");
  });

  test("shows an empty recovered-data state", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "files-apps/recovered-data", onPageChange: () => undefined, layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], appearance: DEFAULT_THEME_STATE, canMutate: true,
      installedApps: [], fileAssociations: [], quarantinedApps: [],
    } as Parameters<typeof SettingsWindow>[0])} />);
    expect(markup).toContain("No recovered app data.");
  });

  test("offers the synchronized icon grid presets", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "desktop", onPageChange: () => undefined, layout: { autoArrangeIcons: true, snapToGrid: true, gridSize: 36, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], appearance: DEFAULT_THEME_STATE, canMutate: true,
      installedApps: [], fileAssociations: [], quarantinedApps: [], onLayoutChange: () => Promise.resolve(), onOpenHelp: () => undefined,
    } as Parameters<typeof SettingsWindow>[0])} />);
    expect(markup).toContain("Grid size");
    expect(markup).toContain("Auto-arrange while dragging");
    expect(markup).toContain('<option value="36" selected="">36px</option>');
    expect(markup).toContain('<option value="48">48px</option>');
  });

  test("shows account short links only when the session advertises support", () => {
    const props = {
      page: "sharing", onPageChange: () => undefined, layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], appearance: DEFAULT_THEME_STATE, canMutate: false,
      installedApps: [], fileAssociations: [], quarantinedApps: [], onLayoutChange: () => Promise.resolve(), onOpenHelp: () => undefined, shortLinkBaseUrl: "https://go.example.test/r/",
    } as Parameters<typeof SettingsWindow>[0];
    expect(renderToStaticMarkup(<SettingsWindow {...props} shortLinksAvailable={false} />)).not.toContain("Create and manage account-wide redirect URLs.");
    expect(renderToStaticMarkup(<SettingsWindow {...props} shortLinksAvailable />)).toContain("Create and manage account-wide redirect URLs.");
  });

  test("groups appearance with desktop settings and sharing tools together", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "desktop", onPageChange: () => undefined, layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], appearance: DEFAULT_THEME_STATE, canMutate: true,
      installedApps: [], fileAssociations: [], quarantinedApps: [], onLayoutChange: () => Promise.resolve(), onOpenHelp: () => undefined, sharingAvailable: true, shortLinksAvailable: true,
    } as Parameters<typeof SettingsWindow>[0])} />);
    expect(markup).toContain('aria-pressed="true">Desktop</button>');
    expect(markup).toContain('aria-pressed="false">Sharing</button>');
    expect(markup).not.toContain(">Appearance</button>");
    expect(markup).not.toContain("Desktop &amp; sharing");
    expect(markup).toContain("Appearance");
    expect(markup).toContain("Desktops");
  });
});

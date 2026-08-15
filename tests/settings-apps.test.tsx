import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsWindow } from "../src/components/SettingsWindow";
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
      canMutate: true,
      installedApps: [systemApp],
      fileAssociations: [{ matcher: ".txt", appId: systemApp.appId, createdAt: 1 }],
      onLaunchApp: () => undefined,
      onUninstallApp: () => undefined,
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

  test("offers the synchronized icon grid presets", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "desktop", onPageChange: () => undefined, layout: { autoArrangeIcons: true, snapToGrid: true, gridSize: 36, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], canMutate: true,
      installedApps: [], fileAssociations: [], onLayoutChange: () => Promise.resolve(), onOpenHelp: () => undefined,
    } as Parameters<typeof SettingsWindow>[0])} />);
    expect(markup).toContain("Grid size");
    expect(markup).toContain("Auto-arrange while dragging");
    expect(markup).toContain('<option value="36" selected="">36px</option>');
    expect(markup).toContain('<option value="48">48px</option>');
  });

  test("shows account short links only when the session advertises support", () => {
    const props = {
      page: "sharing", onPageChange: () => undefined, layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], canMutate: false,
      installedApps: [], fileAssociations: [], onLayoutChange: () => Promise.resolve(), onOpenHelp: () => undefined, shortLinkBaseUrl: "https://go.example.test/r/",
    } as Parameters<typeof SettingsWindow>[0];
    expect(renderToStaticMarkup(<SettingsWindow {...props} shortLinksAvailable={false} />)).not.toContain("Create and manage account-wide redirect URLs.");
    expect(renderToStaticMarkup(<SettingsWindow {...props} shortLinksAvailable />)).toContain("Create and manage account-wide redirect URLs.");
  });

  test("opens Theme Editor from desktop settings", () => {
    const markup = renderToStaticMarkup(<SettingsWindow {...({
      page: "desktop", onPageChange: () => undefined, layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: DEFAULT_WALLPAPER }, activeDesktopId: "desktop", entries: [], canMutate: true,
      installedApps: [], fileAssociations: [], onLayoutChange: () => Promise.resolve(), onOpenHelp: () => undefined, sharingAvailable: true, shortLinksAvailable: true,
    } as Parameters<typeof SettingsWindow>[0])} />);
    expect(markup).toContain('aria-pressed="true">Desktop</button>');
    expect(markup).toContain('aria-pressed="false">Sharing</button>');
    expect(markup).not.toContain("Appearance");
    expect(markup).not.toContain("Desktop &amp; sharing");
    expect(markup).toContain("Theme Editor");
    expect(markup).toContain("Create and apply themes");
    expect(markup).toContain("Desktops");
  });
});

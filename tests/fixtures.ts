import type { DesktopStateSnapshot } from "../src/domain/desktop-state";
import { DEFAULT_THEME_STATE } from "../src/lib/themes";
import { DEFAULT_GRID_SIZE, DEFAULT_WALLPAPER } from "../src/types";
import { OWNER_CAPABILITIES } from "../src/lib/permissions";

export function remoteDesktopIdentity(id = "desk", name = "Desktop") {
  return { id, name, pinned: false, ownership: "owned" as const, role: "owner" as const, owner: { id: "user-1", displayName: "Owner", avatar: null }, capabilities: { ...OWNER_CAPABILITIES }, authorityCatalogId: "catalog-1" };
}

export function desktopStateSnapshot(): DesktopStateSnapshot {
  return {
    entries: [],
    layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: { ...DEFAULT_WALLPAPER } },
    editorSettings: { autoSave: true, autoFormat: false, fontSize: 13, language: "auto", lineWrap: true },
    appearance: DEFAULT_THEME_STATE,
    sync: { catalogId: null, catalogRevision: 0, entryRevisions: {}, contentRevisions: {}, layoutRevision: 0, settingsRevision: 0, themeSelectionRevision: 0, themeRevisions: {} },
  };
}

export function remoteDesktopState() {
  return {
    schemaVersion: 2 as const,
    catalogId: "catalog-1",
    catalogRevision: 1,
    ...remoteDesktopIdentity(),
    entries: [{
      kind: "file",
      id: "file-1",
      name: "notes.txt",
      parentId: null,
      createdAt: 1,
      modifiedAt: 1,
      position: { x: 10, y: 20 },
      mimeType: "text/plain; charset=utf-8",
      size: 4,
      revision: 1,
      contentRevision: 1,
    }],
    layout: { autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: { ...DEFAULT_WALLPAPER } },
    layoutRevision: 1,
    editorSettings: { autoSave: true, autoFormat: false, fontSize: 13, language: "auto", lineWrap: true },
    settingsRevision: 1,
    appearance: { selectedThemeId: "hiraya-dusk", selectionRevision: 1, customThemes: [] },
  };
}

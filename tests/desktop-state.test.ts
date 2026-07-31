import { describe, expect, test } from "bun:test";
import { emptySyncState, parseDesktopState } from "../src/lib/desktop-state";
import { desktopStateSnapshot } from "./fixtures";
import { BUILTIN_THEMES } from "../src/lib/themes";
import { DEFAULT_WALLPAPER } from "../src/types";

describe("desktop state", () => {
  test("accepts only complete current state", () => {
    const snapshot = desktopStateSnapshot();
    const state = { entries: snapshot.entries, snapToGrid: snapshot.layout.snapToGrid, wallpaper: snapshot.layout.wallpaper, editorSettings: snapshot.editorSettings, appearance: snapshot.appearance, sync: snapshot.sync };
    expect(parseDesktopState(state)).toEqual(state);
    expect(emptySyncState()).toEqual({ catalogId: null, catalogRevision: 0, entryRevisions: {}, contentRevisions: {}, layoutRevision: 0, settingsRevision: 0, themeSelectionRevision: 0, themeRevisions: {} });
    expect(() => parseDesktopState({ ...state, entries: [{ kind: "folder", id: "a", name: "A", parentId: null, modifiedAt: 1, position: { x: 0, y: 0 } }] })).toThrow("creation date");
  });

  test("restores a valid packaged wallpaper selection", () => {
    const snapshot = desktopStateSnapshot();
    const theme = { id: "aurora", name: "Aurora", definition: BUILTIN_THEMES["hiraya-dusk"].definition, wallpaper: { assetId: "theme-asset", kind: "scene" as const, size: 4, sha256: "a".repeat(64), revision: 2 } };
    const state = { entries: [], snapToGrid: false, wallpaper: { ...DEFAULT_WALLPAPER, source: "theme:aurora" as const }, editorSettings: snapshot.editorSettings, appearance: { selectedThemeId: theme.id, customThemes: [theme] }, sync: snapshot.sync };
    expect(parseDesktopState(state)).toEqual(state);
  });
});

import type { DesktopEntry, DesktopLayout, EditorSettings } from "../types";
import type { DesktopStateSnapshot, DesktopSyncState, PersistedDesktopState } from "../domain/desktop-state";
import { assertIconGroupFolders, assertSceneFiles, assertWallpaperSource, isRecord, parseEditorSettings, parseEntries, parseLayout, readRevision, type RemoteDesktopState, type RemoteEntry } from "./contracts";
import { parseThemeState } from "./themes";
import { DEFAULT_FILE_CREATION_TEMPLATES } from "./file-creation-templates";

/** Defines the default editor settings. */
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = { autoSave: true, autoFormat: false, fontSize: 13, language: "auto", lineWrap: true, fileCreationTemplates: DEFAULT_FILE_CREATION_TEMPLATES };

/** Returns empty sync state. */
export function emptySyncState(): DesktopSyncState {
  return { catalogId: null, catalogRevision: 0, entryRevisions: {}, contentRevisions: {}, layoutRevision: 0, settingsRevision: 0, themeSelectionRevision: 0, themeRevisions: {} };
}

/** Parses and validates revision map. */
function parseRevisionMap(value: unknown) {
  if (!isRecord(value)) throw new Error("The desktop sync state has an unsupported format.");
  return Object.fromEntries(Object.entries(value).map(([id, revision]) => [id, readRevision(revision)]));
}

/** Parses and validates sync state. */
function parseSyncState(value: unknown): DesktopSyncState {
  if (!isRecord(value)) throw new Error("The desktop sync state has an unsupported format.");
  return {
    catalogId: value.catalogId === null ? null : (() => {
      if (typeof value.catalogId !== "string" || !value.catalogId) throw new Error("The desktop sync state has an unsupported format.");
      return value.catalogId;
    })(),
    catalogRevision: readRevision(value.catalogRevision),
    entryRevisions: parseRevisionMap(value.entryRevisions),
    contentRevisions: parseRevisionMap(value.contentRevisions),
    layoutRevision: readRevision(value.layoutRevision),
    settingsRevision: readRevision(value.settingsRevision),
    themeSelectionRevision: readRevision(value.themeSelectionRevision),
    themeRevisions: parseRevisionMap(value.themeRevisions),
  };
}

/** Parses and validates desktop state. */
export function parseDesktopState(value: unknown): PersistedDesktopState {
  if (!isRecord(value)) throw new Error("The desktop state has an unsupported format.");
  const entries = parseEntries(value.entries);
  const layout = parseLayout(value, true);
  const appearance = parseThemeState(value.appearance);
  assertWallpaperSource(entries, layout.wallpaper, appearance);
  assertIconGroupFolders(entries, layout);
  assertSceneFiles(entries, layout);
  return {
    entries,
    autoArrangeIcons: layout.autoArrangeIcons,
    snapToGrid: layout.snapToGrid,
    gridSize: layout.gridSize,
    wallpaper: layout.wallpaper,
    widgets: layout.widgets,
    iconGroups: layout.iconGroups,
    editorSettings: parseEditorSettings(value.editorSettings),
    appearance,
    sync: parseSyncState(value.sync),
  };
}

/** Computes desktop state layout. */
export function desktopStateLayout(state: PersistedDesktopState): DesktopLayout {
  return { autoArrangeIcons: state.autoArrangeIcons, snapToGrid: state.snapToGrid, gridSize: state.gridSize, wallpaper: state.wallpaper, widgets: state.widgets, iconGroups: state.iconGroups };
}

/** Computes local entry. */
function localEntry(entry: RemoteEntry): DesktopEntry {
  const { revision: _revision, contentRevision: _contentRevision, ...local } = entry;
  void _revision;
  void _contentRevision;
  return local;
}

/** Computes remote desktop snapshot. */
export function remoteDesktopSnapshot(remote: RemoteDesktopState, includedEntryIds?: ReadonlySet<string>): DesktopStateSnapshot {
  const entries = includedEntryIds ? remote.entries.filter((entry) => includedEntryIds.has(entry.id)) : remote.entries;
  const entryRevisions: Record<string, number> = {};
  const contentRevisions: Record<string, number> = {};
  const themeRevisions: Record<string, number> = {};
  for (const entry of entries) {
    entryRevisions[entry.id] = entry.revision;
    if (entry.kind === "file") contentRevisions[entry.id] = entry.contentRevision;
  }
  for (const theme of remote.appearance.customThemes) themeRevisions[theme.id] = theme.revision;
  return {
    entries: entries.map(localEntry),
    layout: remote.layout,
    editorSettings: remote.editorSettings,
    appearance: {
      selectedThemeId: remote.appearance.selectedThemeId,
      customThemes: remote.appearance.customThemes.map(({ id, name, definition, wallpaper }) => ({ id, name, definition, ...(wallpaper ? { wallpaper } : {}) })),
    },
    sync: {
      catalogId: remote.catalogId,
      catalogRevision: remote.catalogRevision,
      entryRevisions,
      contentRevisions,
      layoutRevision: remote.layoutRevision,
      settingsRevision: remote.settingsRevision,
      themeSelectionRevision: remote.appearance.selectionRevision,
      themeRevisions,
    },
  };
}

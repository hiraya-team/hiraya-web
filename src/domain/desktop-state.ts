import type { DesktopEntry, DesktopLayout, EditorSettings, Wallpaper } from "../types";
import type { ThemeState } from "./theme";

export type DesktopSyncState = {
  catalogId: string | null;
  catalogRevision: number;
  entryRevisions: Record<string, number>;
  contentRevisions: Record<string, number>;
  layoutRevision: number;
  settingsRevision: number;
  themeSelectionRevision: number;
  themeRevisions: Record<string, number>;
};

export type PersistedDesktopState = {
  entries: DesktopEntry[];
  snapToGrid: boolean;
  wallpaper: Wallpaper;
  editorSettings: EditorSettings;
  appearance: ThemeState;
  sync: DesktopSyncState;
};

export type DesktopStateSnapshot = {
  entries: DesktopEntry[];
  layout: DesktopLayout;
  editorSettings: EditorSettings;
  appearance: ThemeState;
  sync: DesktopSyncState;
};

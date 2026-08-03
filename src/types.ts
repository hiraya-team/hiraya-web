export type EntryPosition = { x: number; y: number };

export const WALLPAPERS = ["dusk", "grove", "ember"] as const;
export type WallpaperPreset = typeof WALLPAPERS[number];
export const GRID_SIZES = [12, 24, 36, 48] as const;
export type GridSize = typeof GRID_SIZES[number];
export const DEFAULT_GRID_SIZE: GridSize = 24;
export type Wallpaper = {
  source: WallpaperPreset | `file:${string}` | `theme:${string}`;
  fit: "cover" | "contain";
  positionX: number;
  positionY: number;
  blur: number;
  dim: number;
  overlayColor: string;
  overlayOpacity: number;
};
export const DEFAULT_WALLPAPER: Wallpaper = {
  source: "dusk",
  fit: "cover",
  positionX: 50,
  positionY: 50,
  blur: 0,
  dim: 0,
  overlayColor: "#000000",
  overlayOpacity: 0,
};

export type DesktopLayout = {
  snapToGrid: boolean;
  gridSize: GridSize;
  wallpaper: Wallpaper;
};

export type RootEntryPositionUpdate = {
  entryId: string;
  position: EntryPosition;
};

export type DesktopIdentity = {
  id: string;
  name: string;
  ownership: "owned" | "shared";
  role: "owner" | "manager" | "writer" | "reader";
  owner: { id: string; displayName: string; avatar: string | null };
  capabilities: DesktopCapabilities;
  authorityCatalogId: string | null;
  purpose?: "app-store";
};

export type DesktopCapabilities = {
  read: boolean;
  write: boolean;
  manage: boolean;
  delete: boolean;
  settings: boolean;
  activity: boolean;
};

export type EditorLanguage = "auto" | "plain" | "markdown" | "json" | "javascript" | "typescript" | "jsx" | "tsx" | "css" | "html" | "xml" | "yaml";

export type EditorSettings = {
  autoSave: boolean;
  autoFormat: boolean;
  fontSize: number;
  language: EditorLanguage;
  lineWrap: boolean;
};

export type BaseEntry = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number | null;
  modifiedAt: number;
  position: EntryPosition;
};

export type FileEntry = BaseEntry & {
  kind: "file";
  mimeType: string;
  size: number;
};

export type FolderEntry = BaseEntry & {
  kind: "folder";
};

export type DesktopEntry = FileEntry | FolderEntry;

export type DialogState =
  | { type: "create-file"; parentId: string | null; position?: EntryPosition }
  | { type: "create-shortcut"; parentId: string | null; position?: EntryPosition; url: string; name: string }
  | { type: "create-folder"; parentId: string | null; position?: EntryPosition }
  | { type: "rename"; entryId: string }
  | { type: "delete"; entryIds: string[] }
  | null;

export type ContextMenuState =
  | { type: "entry"; entryId: string; x: number; y: number; presentation: "menu" | "sheet" }
  | { type: "desktop"; parentId: string | null; x: number; y: number; position: EntryPosition; presentation: "menu" | "sheet" }
  | null;

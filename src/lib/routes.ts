import type { DesktopEntry } from "../types";
import { isValidId } from "./contracts";
import { namesMatch } from "./entry-validation";

export type DesktopRoute = {
  desktopId?: string;
  column: number;
  row: number;
  explorerFolderId?: string | null;
  fileId?: string;
  propertiesEntryId?: string;
  settings?: SettingsPage;
};

export const SETTINGS_PAGES = [
  "desktop", "desktop/desktops",
  "files-apps", "files-apps/file-types",
  "sharing", "sharing/desktop", "sharing/short-links",
  "sync-storage", "sync-storage/connection", "sync-storage/activity", "sync-storage/export",
  "system", "system/updates", "system/about",
] as const;
export type SettingsPage = typeof SETTINGS_PAGES[number];
export const SETTINGS_PAGE_TITLES: Record<SettingsPage, string> = {
  desktop: "Desktop", "desktop/desktops": "Desktops",
  "files-apps": "Files & apps", "files-apps/file-types": "File type defaults",
  sharing: "Sharing", "sharing/desktop": "Desktop sharing", "sharing/short-links": "Short Links",
  "sync-storage": "Sync & storage", "sync-storage/connection": "Connection & Offline", "sync-storage/activity": "Activity", "sync-storage/export": "Export",
  system: "System", "system/updates": "Updates", "system/about": "About",
};
export const SETTINGS_PARENTS: Partial<Record<SettingsPage, SettingsPage>> = {
  "desktop/desktops": "desktop",
  "files-apps/file-types": "files-apps",
  "sharing/desktop": "sharing", "sharing/short-links": "sharing",
  "sync-storage/connection": "sync-storage", "sync-storage/activity": "sync-storage", "sync-storage/export": "sync-storage",
  "system/updates": "system", "system/about": "system",
};

export function routeTargetsAppEntry(route: DesktopRoute | null, target: { targetKind: "file" | "folder" | "root"; entryId: string | null }) {
  if (!route) return false;
  if (target.targetKind === "file") return route.fileId === target.entryId;
  if (target.targetKind === "folder") return route.explorerFolderId === target.entryId;
  return route.explorerFolderId === null;
}

function decodeId(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return isValidId(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function parseSuffix(parts: string[], route: DesktopRoute, startIndex: number) {
  const next = { ...route };
  let index = startIndex;
  if (parts[index] === "explorer") {
    if (parts[index + 1] === "root") {
      next.explorerFolderId = null;
      index += 2;
    } else if (parts[index + 1] === "folder" && parts[index + 2]) {
      const folderId = decodeId(parts[index + 2]);
      if (!folderId) return null;
      next.explorerFolderId = folderId;
      index += 3;
    } else {
      return null;
    }
  }
  if (parts[index] === "file" && parts[index + 1]) {
    const fileId = decodeId(parts[index + 1]);
    if (!fileId) return null;
    next.fileId = fileId;
    index += 2;
  }
  if (parts[index] === "properties" && parts[index + 1]) {
    if (next.explorerFolderId !== undefined || next.fileId) return null;
    const entryId = decodeId(parts[index + 1]);
    if (!entryId) return null;
    next.propertiesEntryId = entryId;
    index += 2;
  }
  if (parts[index] === "settings") {
    if (next.explorerFolderId !== undefined || next.fileId || next.propertiesEntryId) return null;
    const requestedPage = parts.slice(index + 1).join("/") || "desktop";
    const page = requestedPage === "desktop/appearance" ? "desktop" : requestedPage;
    if (!(SETTINGS_PAGES as readonly string[]).includes(page)) return null;
    next.settings = page as SettingsPage;
    index = parts.length;
  }
  return index === parts.length ? next : null;
}

export function parseDesktopRoute(pathname: string): DesktopRoute | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  if (parts[0] === "desktops" && decodeId(parts[1]) && parts[2] === "areas" && /^-?\d+$/.test(parts[3] ?? "") && /^-?\d+$/.test(parts[4] ?? "")) {
    const column = Number(parts[3]);
    const row = Number(parts[4]);
    if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) return null;
    return parseSuffix(parts, { desktopId: decodeId(parts[1])!, column, row }, 5);
  }

  return null;
}

export function formatDesktopRoute(route: DesktopRoute) {
  if (!route.desktopId) throw new Error("A desktop route requires a desktop ID.");
  let pathname = `/desktops/${encodeURIComponent(route.desktopId)}/areas/${route.column}/${route.row}`;
  if (route.settings) return `${pathname}/settings/${route.settings}`;
  if (route.propertiesEntryId) return `${pathname}/properties/${encodeURIComponent(route.propertiesEntryId)}`;
  if (route.explorerFolderId === null) pathname += "/explorer/root";
  else if (route.explorerFolderId !== undefined) pathname += `/explorer/folder/${encodeURIComponent(route.explorerFolderId)}`;
  if (route.fileId) pathname += `/file/${encodeURIComponent(route.fileId)}`;
  return pathname;
}

export function normalizeDesktopRoute(route: DesktopRoute | null, entries: DesktopEntry[], desktopId: string): DesktopRoute {
  const column = route && Number.isSafeInteger(route.column) ? route.column : 0;
  const row = route && Number.isSafeInteger(route.row) ? route.row : 0;
  const next: DesktopRoute = { desktopId, column, row };
  if (route?.settings) return { ...next, settings: route.settings };
  if (route?.propertiesEntryId && entries.some((entry) => entry.id === route.propertiesEntryId)) return { ...next, propertiesEntryId: route.propertiesEntryId };
  if (route?.explorerFolderId === null) next.explorerFolderId = null;
  else if (route?.explorerFolderId !== undefined && entries.some((entry) => entry.id === route.explorerFolderId && entry.kind === "folder")) {
    next.explorerFolderId = route.explorerFolderId;
  }
  if (route?.fileId && entries.some((entry) => entry.id === route.fileId && entry.kind === "file")) next.fileId = route.fileId;
  return next;
}

export function resolveOpenFilePath(entries: DesktopEntry[], path: string) {
  const segments = path.split("/");
  if (!path || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || [...segment].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  }))) {
    throw new Error(`“${path}” is not a valid file path.`);
  }

  let parentId: string | null = null;
  let resolved: DesktopEntry | undefined;
  for (const [index, segment] of segments.entries()) {
    resolved = entries.find((entry) => entry.parentId === parentId && namesMatch(entry.name, segment));
    if (!resolved || index < segments.length - 1 && resolved.kind !== "folder") {
      throw new Error(`No file exists at “${path}”.`);
    }
    parentId = resolved.id;
  }
  if (resolved?.kind !== "file") throw new Error(`No file exists at “${path}”.`);
  return resolved;
}

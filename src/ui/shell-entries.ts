import type { SystemEntry, TrashItem } from "../lib/contracts";
import type { AccountResource } from "../lib/account-apps";
import { supportsThumbnailMime, THUMBNAIL_MAX_SOURCE_SIZE, THUMBNAIL_PROFILE } from "../lib/thumbnails";
import type { DesktopEntry, FileEntry } from "../types";
import { withoutDotEntries } from "./hidden-entries";

export const VIRTUAL_THUMBNAIL_PREFIX = "virtual:thumbnail/";
export const VIRTUAL_PROTECTED_PREFIX = "virtual:protected/";
export const VIRTUAL_HIRAYA_ROOT_ID = `${VIRTUAL_THUMBNAIL_PREFIX}.hiraya`;

const position = { x: 0, y: 0 };
const folder = (id: string, name: string, parentId: string | null, modifiedAt: number): DesktopEntry => ({ kind: "folder", id, name, parentId, createdAt: null, modifiedAt, position });

export function isProtectedShellEntry(entryOrId: DesktopEntry | string | null | undefined) {
  const id = typeof entryOrId === "string" ? entryOrId : entryOrId?.id;
  return Boolean(id?.startsWith(VIRTUAL_THUMBNAIL_PREFIX) || id?.startsWith(VIRTUAL_PROTECTED_PREFIX));
}

export const isVirtualThumbnailEntry = isProtectedShellEntry;

export function canMutateShellDrop(entryOrId: DesktopEntry | string, destinationParentId: string | null) {
  return !isProtectedShellEntry(entryOrId) && !isProtectedShellEntry(destinationParentId);
}

export function canonicalSelectionIds(entries: readonly DesktopEntry[], ids: readonly string[]) {
  const canonical = new Set(entries.map((entry) => entry.id));
  return ids.filter((id) => canonical.has(id));
}

export function protectedWindowDisposition(openRevision: number, currentRevision: number | null) {
  return currentRevision === null ? "close" : currentRevision === openRevision ? "keep" : "reload";
}

export function virtualThumbnailSource(entryOrId: DesktopEntry | string): { entryId: string; contentRevision: number } | null {
  const id = typeof entryOrId === "string" ? entryOrId : entryOrId.id;
  const match = /^virtual:thumbnail\/file\/([^/]+)\/(\d+)$/.exec(id);
  if (!match) return null;
  const contentRevision = Number(match[2]);
  if (!Number.isSafeInteger(contentRevision) || contentRevision <= 0) return null;
  try { return { entryId: decodeURIComponent(match[1]), contentRevision }; } catch { return null; }
}

export type ProtectedShellSource =
  | { kind: "system"; entryId: string }
  | { kind: "trash"; rootId: string; entryId: string }
  | { kind: "account"; resourceId: string };

export function protectedShellSource(entryOrId: DesktopEntry | string): ProtectedShellSource | null {
  const id = typeof entryOrId === "string" ? entryOrId : entryOrId.id;
  const system = /^virtual:protected\/system\/([^/]+)$/.exec(id);
  const trash = /^virtual:protected\/trash\/([^/]+)\/([^/]+)$/.exec(id);
  const account = /^virtual:protected\/account\/([^/]+)$/.exec(id);
  try {
    if (system) return { kind: "system", entryId: decodeURIComponent(system[1]) };
    if (trash) return { kind: "trash", rootId: decodeURIComponent(trash[1]), entryId: decodeURIComponent(trash[2]) };
    if (account) return { kind: "account", resourceId: decodeURIComponent(account[1]) };
  } catch { return null; }
  return null;
}

export function downloadedThumbnailEntry(file: FileEntry, blob: Blob): FileEntry {
  return { ...file, mimeType: blob.type || "image/webp", size: blob.size };
}

function availableName(name: string, used: Set<string>) {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 2; ; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

export function shellEntries(
  entries: readonly DesktopEntry[],
  contentRevisions: Readonly<Record<string, number>>,
  showHiddenFiles: boolean,
  includeThumbnailHierarchy: boolean,
  systemEntries: readonly SystemEntry[] = [],
  trashItems: readonly TrashItem[] = [],
  protectedTreeVisible = false,
  accountResources: readonly AccountResource[] = [],
): DesktopEntry[] {
  const visible = showHiddenFiles ? [...entries] : withoutDotEntries(entries);
  if (!showHiddenFiles) return visible;
  const sources = includeThumbnailHierarchy ? entries.filter((entry): entry is FileEntry => {
    const revision = contentRevisions[entry.id];
    return entry.kind === "file" && entry.size <= THUMBNAIL_MAX_SOURCE_SIZE && supportsThumbnailMime(entry.mimeType) && Number.isSafeInteger(revision) && revision > 0;
  }) : [];
  if (!sources.length && !systemEntries.length && !trashItems.length && !protectedTreeVisible && !accountResources.length) return visible;

  const modifiedAt = Math.max(0, ...sources.map((entry) => entry.modifiedAt), ...trashItems.flatMap((item) => item.entries.map((entry) => entry.modifiedAt)));
  const rootName = entries.some((entry) => entry.parentId === null && entry.name.toLowerCase() === ".hiraya") ? ".hiraya (System)" : ".hiraya";
  const virtual: DesktopEntry[] = [folder(VIRTUAL_HIRAYA_ROOT_ID, rootName, null, modifiedAt)];
  const folderIds = new Map<string, string>([["", VIRTUAL_HIRAYA_ROOT_ID]]);
  const usedNames = new Map<string, Set<string>>();

  const ensureFolder = (segments: readonly string[]) => {
    let path = "";
    let parentId = VIRTUAL_HIRAYA_ROOT_ID;
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let id = folderIds.get(path);
      if (!id) {
        id = `${VIRTUAL_PROTECTED_PREFIX}folder/${encodeURIComponent(path)}`;
        virtual.push(folder(id, segment, parentId, modifiedAt));
        folderIds.set(path, id);
        const used = usedNames.get(parentId) ?? new Set<string>();
        used.add(segment.toLowerCase());
        usedNames.set(parentId, used);
      }
      parentId = id;
    }
    return parentId;
  };

  if (sources.length) {
    const thumbnailsId = `${VIRTUAL_THUMBNAIL_PREFIX}thumbnails`;
    virtual.push(folder(thumbnailsId, "thumbnails", VIRTUAL_HIRAYA_ROOT_ID, modifiedAt));
    folderIds.set("thumbnails", thumbnailsId);
    usedNames.set(VIRTUAL_HIRAYA_ROOT_ID, new Set(["thumbnails"]));
    for (const source of sources) {
      const encoded = encodeURIComponent(source.id);
      const entryFolderId = `${VIRTUAL_THUMBNAIL_PREFIX}entry/${encoded}`;
      const revision = contentRevisions[source.id];
      const revisionFolderId = `${VIRTUAL_THUMBNAIL_PREFIX}revision/${encoded}/${revision}`;
      virtual.push(
        folder(entryFolderId, source.id, thumbnailsId, source.modifiedAt),
        folder(revisionFolderId, String(revision), entryFolderId, source.modifiedAt),
        { kind: "file", id: `${VIRTUAL_THUMBNAIL_PREFIX}file/${encoded}/${revision}`, name: `${THUMBNAIL_PROFILE}.webp`, parentId: revisionFolderId, createdAt: null, modifiedAt: source.modifiedAt, position, mimeType: "image/webp", size: 0 },
      );
    }
  }

  for (const entry of systemEntries) {
    const path = entry.path.split("/").slice(1);
    const parentId = ensureFolder(path.slice(0, -1));
    const used = usedNames.get(parentId) ?? new Set<string>();
    usedNames.set(parentId, used);
    virtual.push({ kind: "file", id: `${VIRTUAL_PROTECTED_PREFIX}system/${encodeURIComponent(entry.id)}`, name: availableName(path.at(-1) ?? entry.name, used), parentId, createdAt: null, modifiedAt: 0, position, mimeType: entry.mimeType, size: entry.size });
  }

  for (const resource of accountResources) {
    const path = resource.path.split("/").slice(1);
    const parentId = ensureFolder(path.slice(0, -1));
    const used = usedNames.get(parentId) ?? new Set<string>();
    usedNames.set(parentId, used);
    virtual.push({ kind: "file", id: `${VIRTUAL_PROTECTED_PREFIX}account/${encodeURIComponent(resource.id)}`, name: availableName(path.at(-1) ?? resource.id, used), parentId, createdAt: null, modifiedAt: 0, position, mimeType: resource.mimeType, size: resource.size });
  }

  const trashParentId = trashItems.length ? ensureFolder(["desktop", "trash"]) : "";
  const trashRootNames = usedNames.get(trashParentId) ?? new Set<string>();
  if (trashItems.length) usedNames.set(trashParentId, trashRootNames);
  for (const item of trashItems) {
    const ids = new Map(item.entries.map((entry) => [entry.id, `${VIRTUAL_PROTECTED_PREFIX}trash/${encodeURIComponent(item.entry.id)}/${encodeURIComponent(entry.id)}`]));
    for (const entry of item.entries) {
      const id = ids.get(entry.id)!;
      const parentId = entry.id === item.entry.id ? trashParentId : ids.get(entry.parentId ?? "");
      if (!parentId) continue;
      const name = entry.id === item.entry.id ? availableName(entry.name, trashRootNames) : entry.name;
      virtual.push(entry.kind === "folder"
        ? folder(id, name, parentId, entry.modifiedAt)
        : { kind: "file", id, name, parentId, createdAt: null, modifiedAt: entry.modifiedAt, position, mimeType: entry.mimeType, size: entry.size });
    }
  }
  return [...visible, ...virtual];
}

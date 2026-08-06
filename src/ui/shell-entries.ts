import type { DesktopEntry, FileEntry } from "../types";
import { supportsThumbnailMime, THUMBNAIL_MAX_SOURCE_SIZE, THUMBNAIL_PROFILE } from "../lib/thumbnails";
import { withoutDotEntries } from "./hidden-entries";

export const VIRTUAL_THUMBNAIL_PREFIX = "virtual:thumbnail/";
export const VIRTUAL_HIRAYA_ROOT_ID = `${VIRTUAL_THUMBNAIL_PREFIX}.hiraya`;

const position = { x: 0, y: 0 };
const folder = (id: string, name: string, parentId: string | null, modifiedAt: number): DesktopEntry => ({ kind: "folder", id, name, parentId, createdAt: null, modifiedAt, position });

export function isVirtualThumbnailEntry(entryOrId: DesktopEntry | string | null | undefined) {
  const id = typeof entryOrId === "string" ? entryOrId : entryOrId?.id;
  return Boolean(id?.startsWith(VIRTUAL_THUMBNAIL_PREFIX));
}

export function canMutateShellDrop(entryOrId: DesktopEntry | string, destinationParentId: string | null) {
  return !isVirtualThumbnailEntry(entryOrId) && !isVirtualThumbnailEntry(destinationParentId);
}

export function canonicalSelectionIds(entries: readonly DesktopEntry[], ids: readonly string[]) {
  const canonical = new Set(entries.map((entry) => entry.id));
  return ids.filter((id) => canonical.has(id));
}

export function virtualThumbnailSource(entryOrId: DesktopEntry | string): { entryId: string; contentRevision: number } | null {
  const id = typeof entryOrId === "string" ? entryOrId : entryOrId.id;
  const match = /^virtual:thumbnail\/file\/([^/]+)\/(\d+)$/.exec(id);
  if (!match) return null;
  const contentRevision = Number(match[2]);
  if (!Number.isSafeInteger(contentRevision) || contentRevision <= 0) return null;
  try { return { entryId: decodeURIComponent(match[1]), contentRevision }; } catch { return null; }
}

export function downloadedThumbnailEntry(file: FileEntry, blob: Blob): FileEntry {
  return { ...file, mimeType: blob.type || "image/webp", size: blob.size };
}

export function shellEntries(entries: readonly DesktopEntry[], contentRevisions: Readonly<Record<string, number>>, showHiddenFiles: boolean, includeThumbnailHierarchy: boolean): DesktopEntry[] {
  const visible = showHiddenFiles ? [...entries] : withoutDotEntries(entries);
  if (!showHiddenFiles || !includeThumbnailHierarchy) return visible;
  const sources = entries.filter((entry): entry is FileEntry => {
    const revision = contentRevisions[entry.id];
    return entry.kind === "file" && entry.size <= THUMBNAIL_MAX_SOURCE_SIZE && supportsThumbnailMime(entry.mimeType) && Number.isSafeInteger(revision) && revision > 0;
  });
  const modifiedAt = Math.max(0, ...sources.map((entry) => entry.modifiedAt));
  const rootName = entries.some((entry) => entry.parentId === null && entry.name.toLowerCase() === ".hiraya") ? ".hiraya (System)" : ".hiraya";
  const thumbnailsId = `${VIRTUAL_THUMBNAIL_PREFIX}thumbnails`;
  const virtual: DesktopEntry[] = [folder(VIRTUAL_HIRAYA_ROOT_ID, rootName, null, modifiedAt), folder(thumbnailsId, "thumbnails", VIRTUAL_HIRAYA_ROOT_ID, modifiedAt)];
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
  return [...visible, ...virtual];
}

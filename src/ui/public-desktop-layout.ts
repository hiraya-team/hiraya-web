import type { DesktopEntry } from "../types";

export function publicFolderBackTarget(entries: readonly DesktopEntry[], folderId: string | null) {
  if (!folderId) return undefined;
  return entries.find((entry) => entry.id === folderId && entry.kind === "folder")?.parentId;
}

import type { DirectoryEntry, FileMetadata, FolderHandle } from "@hiraya-team/apps-sdk";

/** Lists workspace file extensions editable as text. */
const TEXT_EXTENSIONS = /\.(?:css|csv|html?|hsh|js|jsx|json|log|markdown|md|ts|tsx|txt|xml|ya?ml)$/i;
/** Lists workspace file extensions previewed as images. */
const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
/** Lists workspace file extensions previewed as audio. */
const AUDIO_EXTENSIONS = /\.(?:aac|flac|m4a|mp3|oga|ogg|wav|weba)$/i;
/** Lists workspace file extensions previewed as video. */
const VIDEO_EXTENSIONS = /\.(?:m4v|mov|mp4|ogv|webm)$/i;
/** Matches application MIME types editable as text. */
const TEXT_APPLICATION_MIME = /^application\/(?:ecmascript|javascript|json|xml|x-yaml|yaml|[^/]+\+(?:json|xml))$/;

export type EditorFileKind = "text" | "image" | "pdf" | "audio" | "video" | "scene" | "metadata";

/** Sorts workspace entries. */
export function sortWorkspaceEntries(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.metadata.name.localeCompare(right.metadata.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

/** Filters workspace entries. */
export function filterWorkspaceEntries(entries: Iterable<DirectoryEntry>, query: string): DirectoryEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return sortWorkspaceEntries([...entries].filter((entry) => entry.metadata.name.toLocaleLowerCase().includes(normalized)));
}

/** Reports whether a workspace file can be edited as text. */
export function isEditableFile(file: FileMetadata): boolean {
  const mimeType = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  return file.name.toLowerCase().endsWith(".url") || mimeType.startsWith("text/") || TEXT_APPLICATION_MIME.test(mimeType) || mimeType === "application/octet-stream" && TEXT_EXTENSIONS.test(file.name);
}

/** Selects the MIME type to use when saving a file. */
export function fileMimeTypeForSave(file: FileMetadata | null): string {
  return file?.mimeType || "text/plain; charset=utf-8";
}

/** Classifies a workspace file for the editor. */
export function editorFileKind(file: FileMetadata): EditorFileKind {
  const mimeType = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  if (mimeType === "application/vnd.hiraya.scene+zip" || file.name.toLowerCase().endsWith(".hiraya.scene")) return "scene";
  if (isEditableFile({ ...file, mimeType })) return "text";
  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name)) return "image";
  if (mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name)) return "audio";
  if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.test(file.name)) return "video";
  return "metadata";
}

/** Reports whether a path is contained by a folder. */
export function isWithinFolder(handle: string, folder: FolderHandle, parents: ReadonlyMap<string, FolderHandle | null>): boolean {
  const seen = new Set<string>();
  let current: string | null = handle;
  while (current && !seen.has(current)) {
    if (current === folder) return true;
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

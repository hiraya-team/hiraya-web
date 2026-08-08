import type { DirectoryEntry, FileMetadata, FolderHandle } from "@hiraya-team/apps-sdk";

const TEXT_EXTENSIONS = /\.(?:css|csv|html?|hsh|js|jsx|json|log|markdown|md|ts|tsx|txt|xml|ya?ml)$/i;
const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const AUDIO_EXTENSIONS = /\.(?:aac|flac|m4a|mp3|oga|ogg|wav|weba)$/i;
const VIDEO_EXTENSIONS = /\.(?:m4v|mov|mp4|ogv|webm)$/i;

export type EditorFileKind = "text" | "image" | "pdf" | "audio" | "video" | "metadata";

export function sortWorkspaceEntries(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.metadata.name.localeCompare(right.metadata.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function filterWorkspaceEntries(entries: Iterable<DirectoryEntry>, query: string): DirectoryEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return sortWorkspaceEntries([...entries].filter((entry) => entry.metadata.name.toLocaleLowerCase().includes(normalized)));
}

export function isEditableFile(file: FileMetadata): boolean {
  return file.mimeType.startsWith("text/") || TEXT_EXTENSIONS.test(file.name);
}

export function editorFileKind(file: FileMetadata): EditorFileKind {
  const mimeType = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  if (isEditableFile({ ...file, mimeType })) return "text";
  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name)) return "image";
  if (mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name)) return "audio";
  if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.test(file.name)) return "video";
  return "metadata";
}

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

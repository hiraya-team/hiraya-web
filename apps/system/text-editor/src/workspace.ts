import type { DirectoryEntry, FileMetadata, FolderHandle } from "@hiraya-team/apps-sdk";

const TEXT_EXTENSIONS = /\.(?:css|csv|html?|hsh|js|jsx|json|log|markdown|md|ts|tsx|txt|xml|ya?ml)$/i;

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

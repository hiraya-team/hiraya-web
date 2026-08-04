import { HirayaSdkError, type DirectoryEntry, type FileHandle, type FileMetadata, type FolderHandle, type HirayaClient } from "@hiraya-team/apps-sdk";

export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;

type IndexedEntryBase = Readonly<{
  name: string;
  path: string;
  depth: number;
  parent: FolderHandle;
}>;

export type IndexedEntry =
  | IndexedEntryBase & Readonly<{ kind: "file"; handle: FileHandle; mimeType: string; size: number; revision: number }>
  | IndexedEntryBase & Readonly<{ kind: "folder"; handle: FolderHandle }>;

export type TextSnapshot = Readonly<{ text: string; metadata: FileMetadata }>;

export async function indexProject(hiraya: HirayaClient, root: FolderHandle): Promise<IndexedEntry[]> {
  const queue: Array<{ folder: FolderHandle; path: string; depth: number }> = [{ folder: root, path: "", depth: 0 }];
  const output: IndexedEntry[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    const children = await hiraya.files.list(current.folder);
    children.sort(compareEntries);
    for (const child of children) {
      const path = current.path ? `${current.path}/${child.metadata.name}` : child.metadata.name;
      if (path === "dist" || path.startsWith("dist/")) continue;
      const entry = indexedEntry(child, path, current.depth, current.folder);
      output.push(entry);
      if (child.kind === "folder") queue.push({ folder: child.metadata.handle, path, depth: current.depth + 1 });
    }
  }
  return output;
}

export async function readTextSnapshot(hiraya: HirayaClient, handle: FileHandle): Promise<TextSnapshot> {
  const entry = await hiraya.files.stat(handle);
  if (entry.kind !== "file") throw new Error("The selected item is not a file.");
  if (entry.metadata.size > MAX_EDITABLE_BYTES) throw new Error(`Text files larger than ${formatBytes(MAX_EDITABLE_BYTES)} cannot be edited in Project Studio.`);
  const { data } = await hiraya.files.readAll(handle, { timeoutMs: 120_000 });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new Error(`${entry.metadata.name} is not valid UTF-8 text.`);
  }
  const current = await hiraya.files.stat(handle);
  if (current.kind !== "file" || current.metadata.contentRevision !== entry.metadata.contentRevision || current.metadata.size !== entry.metadata.size) {
    throw new HirayaSdkError("The file changed while it was being read.", "CONFLICT");
  }
  return { text, metadata: current.metadata };
}

export function isEditablePath(path: string): boolean {
  return /\.(?:css|html?|js|json|md|markdown|mjs|txt|ya?ml)$/i.test(path);
}

export function mimeTypeForPath(path: string): string {
  if (/\.md$/i.test(path)) return "text/markdown; charset=utf-8";
  if (/\.css$/i.test(path)) return "text/css; charset=utf-8";
  if (/\.html?$/i.test(path)) return "text/html; charset=utf-8";
  if (/\.(?:js|mjs)$/i.test(path)) return "text/javascript; charset=utf-8";
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.ya?ml$/i.test(path)) return "application/yaml";
  return "text/plain; charset=utf-8";
}

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof HirayaSdkError) {
    if (error.code === "CANCELLED") return "";
    if (error.code === "OFFLINE") return "This file is not available offline. Reconnect or download it through Hiraya, then try again.";
    if (error.code === "CONFLICT") return "The file changed elsewhere. Your draft is still preserved.";
    if (error.code === "PERMISSION_DENIED") return "Project Studio no longer has permission to perform that action.";
    if (error.code === "QUOTA_EXCEEDED") return "The operation exceeds the available storage or in-memory write limit.";
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : fallback;
}

export function exactBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB"];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[index]}`;
}

function indexedEntry(entry: DirectoryEntry, path: string, depth: number, parent: FolderHandle): IndexedEntry {
  return entry.kind === "file"
    ? { kind: "file", handle: entry.metadata.handle, name: entry.metadata.name, path, depth, parent, mimeType: entry.metadata.mimeType, size: entry.metadata.size, revision: entry.metadata.contentRevision }
    : { kind: "folder", handle: entry.metadata.handle, name: entry.metadata.name, path, depth, parent };
}

function compareEntries(left: DirectoryEntry, right: DirectoryEntry): number {
  if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
  return left.metadata.name.localeCompare(right.metadata.name, undefined, { numeric: true, sensitivity: "base" });
}

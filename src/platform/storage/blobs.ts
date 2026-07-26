import type { FileEntry } from "../../types";
import type { OutboxOperation, OutboxRecord } from "../../lib/outbox";
import { CONTENT_CACHE_DIRECTORY, FILES_DIRECTORY, PENDING_DIRECTORY, getRoot, isNotFound } from "./namespace";

export type ContentCacheMarker = { catalogId: string; contentRevision: number; size: number };

export async function getFilesDirectory() {
  return (await getRoot()).getDirectoryHandle(FILES_DIRECTORY, { create: true });
}

async function getPendingDirectory() {
  return (await getRoot()).getDirectoryHandle(PENDING_DIRECTORY, { create: true });
}

async function getContentCacheDirectory() {
  return (await getRoot()).getDirectoryHandle(CONTENT_CACHE_DIRECTORY, { create: true });
}

async function writeHandleContent(directory: FileSystemDirectoryHandle, name: string, content: Blob | string) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

export async function readContentCacheMarker(id: string): Promise<ContentCacheMarker | null> {
  try {
    const directory = await getContentCacheDirectory();
    const value: unknown = JSON.parse(await (await directory.getFileHandle(id)).getFile().then((file) => file.text()));
    if (!value || typeof value !== "object") return null;
    const marker = value as Partial<ContentCacheMarker>;
    if (typeof marker.catalogId !== "string" || !Number.isSafeInteger(marker.contentRevision) || !Number.isSafeInteger(marker.size)) return null;
    return marker as ContentCacheMarker;
  } catch (error) {
    if (isNotFound(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeContentCacheMarker(id: string, marker: ContentCacheMarker) {
  await writeHandleContent(await getContentCacheDirectory(), id, JSON.stringify(marker));
}

export async function removeContentCacheMarker(id: string) {
  try {
    await (await getContentCacheDirectory()).removeEntry(id);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function writeContent(id: string, content: Blob | string) {
  await writeHandleContent(await getFilesDirectory(), id, content);
}

export function operationContentIds(operation: OutboxOperation) {
  if (operation.kind === "save-content") return [operation.entry.id];
  if (operation.kind === "create") return operation.entries.filter((entry): entry is FileEntry => entry.kind === "file").map((entry) => entry.id);
  return [];
}

export async function stageOperationContentsInDirectory(
  pending: FileSystemDirectoryHandle,
  operationId: string,
  contents: Map<string, Blob>,
  write: (directory: FileSystemDirectoryHandle, name: string, content: Blob) => Promise<void> = writeHandleContent,
) {
  if (contents.size === 0) return;
  try {
    const operationDirectory = await pending.getDirectoryHandle(operationId, { create: true });
    for (const [id, content] of contents) await write(operationDirectory, id, content);
  } catch (error) {
    try {
      await pending.removeEntry(operationId, { recursive: true });
    } catch (cleanupError) {
      if (!isNotFound(cleanupError)) console.warn("Hiraya could not clean up partially staged content.", cleanupError);
    }
    throw error;
  }
}

export async function stageOperationContents(operationId: string, contents: Map<string, Blob>) {
  await stageOperationContentsInDirectory(await getPendingDirectory(), operationId, contents);
}

export async function readStagedContent(operationId: string, id: string) {
  const pending = await getPendingDirectory();
  return (await (await pending.getDirectoryHandle(operationId)).getFileHandle(id)).getFile();
}

export async function materializeOutbox(records: OutboxRecord[]) {
  for (const record of records) {
    for (const id of operationContentIds(record.operation)) {
      const content = await readStagedContent(record.operationId, id);
      await writeContent(id, content);
    }
  }
}

export async function removeStagedOperation(operationId: string) {
  try {
    await (await getPendingDirectory()).removeEntry(operationId, { recursive: true });
  } catch (error) {
    if (!isNotFound(error)) console.warn("Hiraya could not clean up acknowledged pending content.", error);
  }
}

import type { OutboxOperation, OutboxRecord } from "../../lib/outbox";
import { sha256Blob } from "../../lib/blob-transfer";
import { APPROVED_PACKAGE_ARCHIVES_DIRECTORY, CONTENT_CACHE_DIRECTORY, FILES_DIRECTORY, LOCAL_MUTATIONS_DIRECTORY, PENDING_DIRECTORY, getRoot, isNotFound } from "./namespace";
import { callDatabase } from "./database-client";

export type ContentCacheMarker = { catalogId: string; contentRevision: number; size: number; sha256: string };
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CONFLICT_SERVER = ".content-conflict-server";
let packageArchiveWork = Promise.resolve();
let contentWriteWork = Promise.resolve();

function serializePackageArchives<T>(operation: () => Promise<T>) {
  const locked = () => typeof navigator !== "undefined" && typeof navigator.locks?.request === "function"
    ? navigator.locks.request("hiraya-approved-package-archives", operation)
    : operation();
  const next = packageArchiveWork.then(locked, locked);
  packageArchiveWork = next.then(() => undefined, () => undefined);
  return next;
}

function serializeContentWrites<T>(operation: () => Promise<T>) {
  const locked = () => typeof navigator !== "undefined" && typeof navigator.locks?.request === "function"
    ? navigator.locks.request("hiraya-opfs-writes", operation)
    : operation();
  const next = contentWriteWork.then(locked, locked);
  contentWriteWork = next.then(() => undefined, () => undefined);
  return next;
}

function conflictBaseName(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("The content conflict base revision is invalid.");
  return `.content-conflict-base-${revision}`;
}

export async function contentMatchesCacheMarker(content: Blob, marker: ContentCacheMarker) {
  return content.size === marker.size && await sha256Blob(content) === marker.sha256;
}

export function parseContentCacheMarker(value: unknown): ContentCacheMarker | null {
  if (!value || typeof value !== "object") return null;
  const marker = value as Partial<ContentCacheMarker>;
  if (typeof marker.catalogId !== "string" || !Number.isSafeInteger(marker.contentRevision) || !Number.isSafeInteger(marker.size) || typeof marker.sha256 !== "string" || !SHA256_HEX.test(marker.sha256)) return null;
  return marker as ContentCacheMarker;
}

export async function getFilesDirectory() {
  return (await getRoot()).getDirectoryHandle(FILES_DIRECTORY, { create: true });
}

async function getPendingDirectory() {
  return (await getRoot()).getDirectoryHandle(PENDING_DIRECTORY, { create: true });
}

async function getContentCacheDirectory() {
  return (await getRoot()).getDirectoryHandle(CONTENT_CACHE_DIRECTORY, { create: true });
}

async function getLocalMutationsDirectory() {
  return (await getRoot()).getDirectoryHandle(LOCAL_MUTATIONS_DIRECTORY, { create: true });
}

async function getApprovedPackageArchivesDirectory() {
  return (await getRoot()).getDirectoryHandle(APPROVED_PACKAGE_ARCHIVES_DIRECTORY, { create: true });
}

async function writeHandleContent(directory: FileSystemDirectoryHandle, name: string, content: Blob | string) {
  await serializeContentWrites(async () => {
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  });
}

export async function readContentCacheMarker(id: string): Promise<ContentCacheMarker | null> {
  try {
    const directory = await getContentCacheDirectory();
    const value: unknown = JSON.parse(await (await directory.getFileHandle(id)).getFile().then((file) => file.text()));
    // Markers written before SHA-256 was required intentionally miss the cache.
    // Online callers redownload; offline callers report the file unavailable.
    return parseContentCacheMarker(value);
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

export async function removeUnretainedCachedContent(retained: ReadonlySet<string>, cache?: FileSystemDirectoryHandle, files?: FileSystemDirectoryHandle) {
  cache ??= await getContentCacheDirectory();
  files ??= await getFilesDirectory();
  const entries = cache as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
  for await (const [id] of entries.entries()) {
    if (retained.has(id)) continue;
    await files.removeEntry(id).catch((error) => { if (!isNotFound(error)) throw error; });
    await cache.removeEntry(id).catch((error) => { if (!isNotFound(error)) throw error; });
  }
}

export async function writeContent(id: string, content: Blob | string) {
  await writeHandleContent(await getFilesDirectory(), id, content);
}

function validatePackageDigest(digest: string) {
  if (!SHA256_HEX.test(digest)) throw new TypeError("Approved package digest is invalid.");
}

export async function saveApprovedPackageArchive(digest: string, archive: Blob, retain?: () => Promise<void>) {
  validatePackageDigest(digest);
  return await serializePackageArchives(async () => {
    if (await sha256Blob(archive) !== digest) throw new Error("Approved package archive does not match its digest.");
    await writeHandleContent(await getApprovedPackageArchivesDirectory(), digest, archive);
    await retain?.();
  });
}

export async function readApprovedPackageArchive(digest: string) {
  validatePackageDigest(digest);
  const archive = await (await (await getApprovedPackageArchivesDirectory()).getFileHandle(digest)).getFile();
  if (await sha256Blob(archive) !== digest) throw new Error("Approved package archive does not match its digest.");
  return archive;
}

async function deleteApprovedPackageArchiveUnsafe(digest: string) {
  try {
    await (await getApprovedPackageArchivesDirectory()).removeEntry(digest);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export async function deleteApprovedPackageArchive(digest: string) {
  validatePackageDigest(digest);
  return await serializePackageArchives(() => deleteApprovedPackageArchiveUnsafe(digest));
}

export async function releaseApprovedPackageArchive(digest: string) {
  validatePackageDigest(digest);
  await serializePackageArchives(async () => {
    const [installed, account] = await Promise.all([callDatabase("listInstalledApps", undefined, null), callDatabase("readAccountApps", undefined, null)]);
    if (installed.some((app) => app.digest === digest) || account.state.baseline?.apps.some((app) => app.package.sha256 === digest) || account.outbox.some((record) => record.operation.kind === "install" && record.operation.digest === digest)) return;
    await deleteApprovedPackageArchiveUnsafe(digest);
  });
}

export type LocalContentJournal = {
  desktopId: string;
  id: string;
  previousExists: boolean;
  saved: { mimeType: string; size: number; modifiedAt: number };
};

type PreparedLocalReplacement = { operationId: string; journal: LocalContentJournal };

export async function rollbackSafeReplacement(
  publish: () => Promise<void>,
  commitMetadata: () => Promise<void>,
  rollback: () => Promise<void>,
  cleanup: () => Promise<void>,
) {
  await publish();
  try {
    await commitMetadata();
  } catch (error) {
    try { await rollback(); } catch { /* Startup recovery retains the journal. */ }
    throw error;
  }
  try { await cleanup(); } catch (error) { console.warn("Hiraya could not clean up a committed local file journal.", error); }
}

export async function prepareLocalContentReplacement(desktopId: string, id: string, saved: LocalContentJournal["saved"], content: Blob): Promise<PreparedLocalReplacement> {
  const mutations = await getLocalMutationsDirectory();
  const operationId = crypto.randomUUID();
  const directory = await mutations.getDirectoryHandle(operationId, { create: true });
  let previous: File | null = null;
  try { previous = await (await (await getFilesDirectory()).getFileHandle(id)).getFile(); }
  catch (error) { if (!isNotFound(error)) throw error; }
  try {
    if (previous) await writeHandleContent(directory, "backup", previous);
    await writeHandleContent(directory, "next", content);
    const journal = { desktopId, id, previousExists: previous !== null, saved };
    // The descriptor is the commit marker: directories lacking it are harmless
    // preparation orphans and are removed during startup recovery.
    await writeHandleContent(directory, "journal", JSON.stringify(journal));
    return { operationId, journal };
  } catch (error) {
    try { await mutations.removeEntry(operationId, { recursive: true }); } catch { /* best effort */ }
    throw error;
  }
}

async function rollbackPreparedLocalReplacement(operationId: string, journal: LocalContentJournal) {
  const mutations = await getLocalMutationsDirectory();
  const directory = await mutations.getDirectoryHandle(operationId);
  if (journal.previousExists) await writeContent(journal.id, await (await directory.getFileHandle("backup")).getFile());
  else {
    try { await (await getFilesDirectory()).removeEntry(journal.id); } catch (error) { if (!isNotFound(error)) throw error; }
  }
  await mutations.removeEntry(operationId, { recursive: true });
}

export async function publishLocalContentReplacement(prepared: PreparedLocalReplacement, commitMetadata: () => Promise<void>) {
  const mutations = await getLocalMutationsDirectory();
  const directory = await mutations.getDirectoryHandle(prepared.operationId);
  await rollbackSafeReplacement(
    async () => writeContent(prepared.journal.id, await (await directory.getFileHandle("next")).getFile()),
    commitMetadata,
    async () => rollbackPreparedLocalReplacement(prepared.operationId, prepared.journal),
    async () => mutations.removeEntry(prepared.operationId, { recursive: true }),
  );
}

export async function recoverLocalContentReplacements(metadataCommitted: (journal: LocalContentJournal) => Promise<boolean>) {
  const mutations = await getLocalMutationsDirectory();
  const entries = mutations as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
  for await (const [operationId, handle] of entries.entries()) {
    if (handle.kind !== "directory") { await mutations.removeEntry(operationId).catch(() => undefined); continue; }
    try {
      const directory = handle as FileSystemDirectoryHandle;
      const value: unknown = JSON.parse(await (await directory.getFileHandle("journal")).getFile().then((file) => file.text()));
      if (!value || typeof value !== "object") throw new Error("invalid local content journal");
      const journal = value as LocalContentJournal;
      if (typeof journal.desktopId !== "string" || typeof journal.id !== "string" || typeof journal.previousExists !== "boolean" || !journal.saved || typeof journal.saved.mimeType !== "string" || !Number.isSafeInteger(journal.saved.size) || !Number.isSafeInteger(journal.saved.modifiedAt)) throw new Error("invalid local content journal");
      if (await metadataCommitted(journal)) await mutations.removeEntry(operationId, { recursive: true });
      else await rollbackPreparedLocalReplacement(operationId, journal);
    } catch (error) {
      if (isNotFound(error)) await mutations.removeEntry(operationId, { recursive: true }).catch(() => undefined);
      else console.warn("Hiraya could not recover a local file replacement.", error);
    }
  }
}

export function operationContentIds(operation: OutboxOperation) {
  if (operation.kind === "save-content") return [operation.entryId];
  if (operation.kind === "create") return operation.entries.filter((entry) => entry.kind === "file").map((entry) => entry.id);
  if (operation.kind === "install-theme-package") return operation.wallpaperKind === null ? [] : [operation.assetId];
  return [];
}

export function operationMaterializationContentIds(operation: OutboxOperation) {
  return operation.kind === "install-theme-package" ? [] : operationContentIds(operation);
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
    await write(operationDirectory, ".complete", new Blob([JSON.stringify([...contents].map(([id, content]) => [id, content.size]))]));
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

export async function readStagedContent(operationId: string, id: string, selectedKey?: string) {
  const pending = await getPendingDirectory();
  const directory = await pending.getDirectoryHandle(operationId);
  if (selectedKey !== undefined) {
    if (!/^\.mine-[0-9a-f-]{36}$/.test(selectedKey)) throw new Error("Pending file content has an invalid storage key.");
    return (await directory.getFileHandle(selectedKey)).getFile();
  }
  const manifest = JSON.parse(await (await directory.getFileHandle(".complete")).getFile().then((file) => file.text())) as unknown;
  if (!Array.isArray(manifest)) throw new Error("Pending file content was not completely staged.");
  const item = manifest.find((candidate): candidate is [string, number, string?] => Array.isArray(candidate) && candidate[0] === id && Number.isSafeInteger(candidate[1]) && candidate[1] >= 0 && (candidate[2] === undefined || typeof candidate[2] === "string" && candidate[2].startsWith(".mine-")));
  if (!item) throw new Error("Pending file content was not completely staged.");
  const expected = item[1];
  const storedName = item[2] ?? id;
  const content = await (await directory.getFileHandle(storedName)).getFile();
  if (content.size !== expected) throw new Error("Pending file content was not completely staged.");
  return content;
}

export async function stageStagedContentVariant(operationId: string, content: Blob) {
  return stageStagedContentVariantInDirectory(await (await getPendingDirectory()).getDirectoryHandle(operationId), content);
}

export async function stageStagedContentVariantInDirectory(directory: FileSystemDirectoryHandle, content: Blob, key = `.mine-${crypto.randomUUID()}`, write: (directory: FileSystemDirectoryHandle, name: string, content: Blob) => Promise<void> = writeHandleContent) {
  if (!/^\.mine-[0-9a-f-]{36}$/.test(key)) throw new Error("Pending file content has an invalid storage key.");
  await write(directory, key, content);
  return key;
}

async function readOptionalStagedFile(operationId: string, name: string) {
  try {
    const directory = await (await getPendingDirectory()).getDirectoryHandle(operationId);
    return await (await directory.getFileHandle(name)).getFile();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export function readContentConflictBase(operationId: string, revision: number) {
  return readOptionalStagedFile(operationId, conflictBaseName(revision));
}

export function readContentConflictServer(operationId: string) {
  return readOptionalStagedFile(operationId, CONFLICT_SERVER);
}

export async function writeContentConflictBase(operationId: string, revision: number, content: Blob) {
  await writeHandleContent(await (await getPendingDirectory()).getDirectoryHandle(operationId), conflictBaseName(revision), content);
}

export async function writeContentConflictServer(operationId: string, content: Blob) {
  await writeHandleContent(await (await getPendingDirectory()).getDirectoryHandle(operationId), CONFLICT_SERVER, content);
}

export async function materializeOutbox(records: OutboxRecord[], pruneOrphans = false) {
  if (pruneOrphans) {
    const pending = await getPendingDirectory();
    const retained = new Set(records.map((record) => record.operationId));
    const entries = pending as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
    for await (const [name] of entries.entries()) if (!retained.has(name)) {
      try { await pending.removeEntry(name, { recursive: true }); }
      catch (error) { if (!isNotFound(error)) console.warn("Hiraya could not clean up orphaned staged content.", error); }
    }
  }
  for (const record of records) {
    for (const id of operationMaterializationContentIds(record.operation)) {
      const content = await readStagedContent(record.operationId, id, record.operation.kind === "save-content" ? record.operation.stagedContentKey : undefined);
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

export const FILES_DIRECTORY = "files";
export const PENDING_DIRECTORY = "pending";
export const CONTENT_CACHE_DIRECTORY = ".hiraya-content-cache";
export const LOCAL_MUTATIONS_DIRECTORY = ".hiraya-local-mutations";
export const APPROVED_PACKAGE_ARCHIVES_DIRECTORY = ".hiraya-approved-package-archives";
export const LOCAL_STORAGE_ID = "hiraya-local";
export const FRONTEND_ONLY = import.meta.env.HIRAYA_FRONTEND_ONLY === "true";

const LEGACY_STORAGE_ENTRIES = [FILES_DIRECTORY, PENDING_DIRECTORY, CONTENT_CACHE_DIRECTORY, LOCAL_MUTATIONS_DIRECTORY, APPROVED_PACKAGE_ARCHIVES_DIRECTORY, ".hiraya-sqlite-v1"];
const INDEXED_DB_RESET_VERSION = 1;
const STORAGE_LOCK_TIMEOUT_MS = 30_000;

let storageNamespace: { storageId: string; key: string } | null = null;
let activeDesktopContext: string | null = null;
let storageWork: Promise<void> = Promise.resolve();

export class StorageUnavailableError extends Error {
  constructor() {
    super("Private browser storage is unavailable. Open Hiraya in a modern browser over HTTPS or localhost.");
    this.name = "StorageUnavailableError";
  }
}

export function namespaceKey() {
  if (!storageNamespace) throw new Error("Hiraya storage was used before its namespace was selected.");
  return storageNamespace.key;
}

export function getActiveDesktopContext() {
  return activeDesktopContext;
}

export function isNotFound(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "NotFoundError";
}

async function storageKey(storageId: string) {
  if (!storageId || storageId.length > 1024 || [...storageId].some((character) => character.charCodeAt(0) < 32)) throw new Error("The Hiraya storage ID is invalid.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(storageId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function indexedDatabaseName(key = namespaceKey()) {
  return `hiraya-indexeddb-v1-${key}`;
}

function legacyOwnerLockName(key: string) {
  return FRONTEND_ONLY ? "hiraya-sqlite-v1-owner" : `hiraya-sqlite-v1-owner-${key}`;
}

async function withLegacyOwnerLock<T>(name: string, operation: () => Promise<T>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), STORAGE_LOCK_TIMEOUT_MS);
  try {
    return await navigator.locks.request(name, { mode: "exclusive", signal: controller.signal }, async () => {
      window.clearTimeout(timeout);
      return operation();
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Legacy local storage is open in another Hiraya tab. Close all older Hiraya tabs and retry.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function deleteIndexedDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("The new local database could not be reset."));
    request.onblocked = () => reject(new Error("Local storage is still open in another Hiraya tab. Close all older Hiraya tabs and retry."));
  });
}

async function removeEntries(root: FileSystemDirectoryHandle, names: string[]) {
  for (const name of names) {
    try {
      await root.removeEntry(name, { recursive: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

async function resetLegacyStorage(root: FileSystemDirectoryHandle, key: string) {
  const marker = `hiraya-indexeddb-reset-v${INDEXED_DB_RESET_VERSION}-${key}`;
  if (localStorage.getItem(marker) === "complete") return;
  const reset = async () => {
    if (FRONTEND_ONLY) await removeEntries(root, LEGACY_STORAGE_ENTRIES);
    else await removeEntries(root, [...LEGACY_STORAGE_ENTRIES, `.hiraya-storage-${key}`, `.hiraya-sqlite-v1-${key}`]);
    await deleteIndexedDatabase(indexedDatabaseName(key));
    sessionStorage.removeItem(FRONTEND_ONLY ? "hiraya-active-desktop" : `hiraya-active-desktop-${key}`);
    localStorage.setItem(marker, "complete");
  };
  await withLegacyOwnerLock(legacyOwnerLockName(key), async () => {
    if (localStorage.getItem(marker) === "complete") return;
    if (FRONTEND_ONLY) await reset();
    else await withLegacyOwnerLock("hiraya-sqlite-v1-owner", async () => {
      if (localStorage.getItem(marker) !== "complete") await reset();
    });
  });
}

export async function configureStorageNamespace(storageId: string) {
  const key = await storageKey(storageId);
  if (storageNamespace) {
    if (storageNamespace.storageId !== storageId) throw new Error("The Hiraya storage namespace cannot change after startup.");
    return;
  }
  if (!navigator.storage?.getDirectory || !navigator.locks) throw new StorageUnavailableError();
  const root = await navigator.storage.getDirectory();
  await resetLegacyStorage(root, key);
  storageNamespace = { storageId, key };
  activeDesktopContext = sessionStorage.getItem(FRONTEND_ONLY ? "hiraya-active-desktop" : `hiraya-active-desktop-${key}`);
}

export async function getRoot() {
  if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) throw new StorageUnavailableError();
  const root = await navigator.storage.getDirectory();
  return FRONTEND_ONLY ? root : root.getDirectoryHandle(`.hiraya-storage-${namespaceKey()}`, { create: true });
}

export async function estimateStorage() {
  return navigator.storage.estimate();
}

export function setDesktopContext(desktopId: string) {
  activeDesktopContext = desktopId;
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(FRONTEND_ONLY ? "hiraya-active-desktop" : `hiraya-active-desktop-${namespaceKey()}`, desktopId);
}

async function withCrossContextLock<T>(operation: () => Promise<T>) {
  if (!("locks" in navigator) || !navigator.locks) return operation();
  const controller = new AbortController();
  let acquired = false;
  const timeout = window.setTimeout(() => {
    if (!acquired) controller.abort();
  }, STORAGE_LOCK_TIMEOUT_MS);
  try {
    return await navigator.locks.request(FRONTEND_ONLY ? "hiraya-opfs" : `hiraya-opfs-${namespaceKey()}`, { mode: "exclusive", signal: controller.signal }, async () => {
      acquired = true;
      window.clearTimeout(timeout);
      return operation();
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Local storage is busy in another Hiraya window. Close the other window and retry.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function serializeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const locked = () => withCrossContextLock(operation);
  const next = storageWork.then(locked, locked);
  storageWork = next.then(() => undefined, () => undefined);
  return next;
}

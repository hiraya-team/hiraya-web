/** Defines the files directory. */
export const FILES_DIRECTORY = "files";
/** Defines the pending directory. */
export const PENDING_DIRECTORY = "pending";
/** Defines the content cache directory. */
export const CONTENT_CACHE_DIRECTORY = ".hiraya-content-cache";
/** Defines the local mutations directory. */
export const LOCAL_MUTATIONS_DIRECTORY = ".hiraya-local-mutations";
/** Defines the approved package archives directory. */
export const APPROVED_PACKAGE_ARCHIVES_DIRECTORY = ".hiraya-approved-package-archives";
/** Defines the local storage ID. */
export const LOCAL_STORAGE_ID = "hiraya-local";
/** Indicates whether browser-local storage is active. */
export const FRONTEND_ONLY = import.meta.env.HIRAYA_FRONTEND_ONLY === "true";

/** Names browser storage keys owned by the desktop namespace. */
const BROWSER_STORAGE_KEYS = {
  activeDesktop: "hiraya-active-desktop",
} as const;

/** Defines the storage lock timeout in milliseconds. */
const STORAGE_LOCK_TIMEOUT_MS = 30_000;

let storageNamespace: { storageId: string; key: string } | null = null;
let activeDesktopContext: string | null = null;
let storageWork: Promise<void> = Promise.resolve();

/** Reports storage unavailable failures. */
export class StorageUnavailableError extends Error {
  /** Creates a StorageUnavailableError instance. */
  constructor() {
    super("Private browser storage is unavailable. Open Hiraya in a modern browser over HTTPS or localhost.");
    this.name = "StorageUnavailableError";
  }
}

/** Returns namespace key. */
export function namespaceKey() {
  if (!storageNamespace) throw new Error("Hiraya storage was used before its namespace was selected.");
  return storageNamespace.key;
}

/** Returns the active desktop context for the current namespace. */
export function getActiveDesktopContext() {
  return activeDesktopContext;
}

/** Reports whether an error represents a missing OPFS entry. */
export function isNotFound(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "NotFoundError";
}

/** Returns storage key. */
async function storageKey(storageId: string) {
  if (!storageId || storageId.length > 1024 || [...storageId].some((character) => character.charCodeAt(0) < 32)) throw new Error("The Hiraya storage ID is invalid.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(storageId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Returns the active-desktop key for the selected deployment namespace. */
function activeDesktopStorageKey(key = namespaceKey()) {
  return FRONTEND_ONLY ? BROWSER_STORAGE_KEYS.activeDesktop : `${BROWSER_STORAGE_KEYS.activeDesktop}-${key}`;
}

/** Returns indexed database name. */
export function indexedDatabaseName(key = namespaceKey()) {
  return `hiraya-indexeddb-v1-${key}`;
}

/** Configures storage namespace. */
export async function configureStorageNamespace(storageId: string) {
  const key = await storageKey(storageId);
  if (storageNamespace) {
    if (storageNamespace.storageId !== storageId) throw new Error("The Hiraya storage namespace cannot change after startup.");
    return;
  }
  if (!navigator.storage?.getDirectory || !navigator.locks) throw new StorageUnavailableError();
  storageNamespace = { storageId, key };
  activeDesktopContext = sessionStorage.getItem(activeDesktopStorageKey(key));
}

/** Returns the OPFS root directory. */
export async function getRoot() {
  if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) throw new StorageUnavailableError();
  const root = await navigator.storage.getDirectory();
  return FRONTEND_ONLY ? root : root.getDirectoryHandle(`.hiraya-storage-${namespaceKey()}`, { create: true });
}

/** Estimates storage. */
export async function estimateStorage() {
  return navigator.storage.estimate();
}

/** Sets desktop context. */
export function setDesktopContext(desktopId: string) {
  activeDesktopContext = desktopId;
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(activeDesktopStorageKey(), desktopId);
}

/** Returns with cross context lock. */
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

/** Serializes storage. */
export function serializeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const locked = () => withCrossContextLock(operation);
  const next = storageWork.then(locked, locked);
  storageWork = next.then(() => undefined, () => undefined);
  return next;
}

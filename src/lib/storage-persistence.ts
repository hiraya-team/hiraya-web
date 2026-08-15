export type StoragePersistenceStatus = "checking" | "granted" | "denied" | "unsupported";

type PersistenceStorage = Pick<StorageManager, "persist" | "persisted">;
type PersistenceResult = Exclude<StoragePersistenceStatus, "checking">;
const requests = new WeakMap<object, Promise<PersistenceResult>>();

export function requestStoragePersistence(storage?: Partial<PersistenceStorage>): Promise<PersistenceResult> {
  const target = storage ?? (typeof navigator === "undefined" ? undefined : navigator.storage);
  if (!target) return Promise.resolve("unsupported");
  const existing = requests.get(target);
  if (existing) return existing;
  const request = (async () => {
    if (typeof target.persisted === "function") {
      try { if (await target.persisted.call(target)) return "granted"; }
      catch { /* Fall through to the controlled request when available. */ }
    }
    if (typeof target.persist !== "function") return "unsupported";
    try { return await target.persist.call(target) ? "granted" : "denied"; }
    catch { return "denied"; }
  })();
  requests.set(target, request);
  return request;
}

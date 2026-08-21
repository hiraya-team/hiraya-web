import { parseJsonValue, type JsonValue } from "@hiraya-team/apps-contracts";
import { hasControlCharacters, HostServiceError, type AppInstanceOwner } from "./types";

/** Caps serialized storage owned by one app. */
export const MAX_APP_STORAGE_BYTES = 64 * 1024;
/** Caps the number of keys stored by one app. */
export const MAX_APP_STORAGE_ENTRIES = 128;
/** Caps app-storage key length. */
export const MAX_APP_STORAGE_KEY_LENGTH = 128;

export interface AppStorageApi {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export type PersistentAppStorage = {
  get(appId: string, key: string): Promise<JsonValue | undefined>;
  set(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number): Promise<void>;
  remove(appId: string, key: string): Promise<void>;
  clear(appId: string): Promise<void>;
};

/** Scopes persistent key-value storage to a hosted app identity. */
export class AppPersistentStorageService {
  /** Creates a quota-enforcing app storage service. */
  constructor(private readonly storage: PersistentAppStorage, private readonly maxBytes = MAX_APP_STORAGE_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("Storage quota must be positive.");
  }

  /** Creates the storage API exposed to one app instance. */
  forInstance(owner: AppInstanceOwner): AppStorageApi {
    return {
      get: async (key) => { validateKey(key); return clone(await this.storage.get(owner.appId, key)); },
      set: async (key, value) => {
        validateKey(key);
        try { await this.storage.set(owner.appId, key, parseJsonValue(value), this.maxBytes, MAX_APP_STORAGE_ENTRIES); }
        catch (error) {
          if (error instanceof Error && error.message.toLowerCase().includes("quota")) throw new HostServiceError(error.message, "QUOTA_EXCEEDED");
          throw error;
        }
      },
      remove: async (key) => { validateKey(key); await this.storage.remove(owner.appId, key); },
      clear: async () => this.storage.clear(owner.appId),
    };
  }
}

/** Validates an app-storage key against the host contract. */
export function validateAppStorageKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_APP_STORAGE_KEY_LENGTH || hasControlCharacters(key)) throw new TypeError("App storage key is invalid.");
}

/** Provides the internal key validator used by instance APIs. */
const validateKey = validateAppStorageKey;

/** Clones stored JSON so app code cannot mutate host state by reference. */
function clone(value: JsonValue | undefined): JsonValue | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

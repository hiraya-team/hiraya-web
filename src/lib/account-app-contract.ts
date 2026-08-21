/** Defines the app ID. */
const APP_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

/** Parses and validates account app ID. */
export function parseAccountAppId(value: unknown) {
  if (typeof value !== "string" || value.length > 256 || !APP_ID.test(value)) throw new Error("An account app has an invalid app ID.");
  return value;
}

/** Parses and validates account app data key. */
export function parseAccountAppDataKey(value: unknown) {
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).byteLength > 128 || [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  })) throw new Error("An account app data key is invalid.");
  return value;
}

/** Reports account apps request failures. */
export class AccountAppsRequestError extends Error {
  /** Creates a AccountAppsRequestError instance. */
  constructor(readonly status: number, message = `Account apps could not be synchronized (${status}).`, readonly code: string | null = null) { super(message); this.name = "AccountAppsRequestError"; }
}

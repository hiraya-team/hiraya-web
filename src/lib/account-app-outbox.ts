import { parseJsonValue, parseManifestV2, type HirayaAppManifestV2, type JsonValue } from "@hiraya-team/apps-contracts";
import { isRecord } from "./contracts";
import { parseAccountAppDataKey, parseAccountAppId, type AccountAppsSnapshot } from "./account-apps";

/** Matches a lowercase SHA-256 digest. */
const SHA256 = /^[a-f0-9]{64}$/;
/** Matches the expected MD5. */
const MD5 = /^[a-f0-9]{32}$/;

/** Validates that a record contains exactly the expected keys. */
function exactKeys(value: Record<string, unknown>, keys: readonly string[], message: string) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((candidate) => !keys.includes(candidate))) throw new Error(message);
}

export type AccountAppOperation = Readonly<
  | { schemaVersion: 1; kind: "install"; appId: string; manifest: HirayaAppManifestV2; digest: string; md5: string; size: number }
  | { schemaVersion: 1; kind: "uninstall"; appId: string; installationGeneration: number }
  | { schemaVersion: 1; kind: "put-data"; appId: string; key: string; dataGeneration: number; value: JsonValue }
  | { schemaVersion: 1; kind: "delete-data"; appId: string; key: string; dataGeneration: number }
  | { schemaVersion: 1; kind: "clear-data"; appId: string; dataGeneration: number }
  | { schemaVersion: 1; kind: "handlers"; hints: Readonly<Record<string, string>> }
>;

export type AccountAppOutboxRecord = Readonly<{
  operationId: string;
  clientId: string;
  sequence: number;
  operation: AccountAppOperation;
  status: "pending" | "blocked";
  error: string | null;
  errorCode: string | null;
  attemptCount: number;
  lastAttemptAt: number | null;
}>;

export type DesiredAccountApp = Readonly<{
  appId: string;
  manifest: HirayaAppManifestV2;
  digest: string;
  installationGeneration: number | null;
  dataGeneration: number;
}>;

export type AccountAppsProjection = Readonly<{
  appsRevision: number;
  apps: DesiredAccountApp[];
  handlerHints: Readonly<Record<string, string>>;
}>;

export type PersistedAccountApps = Readonly<{
  id: "singleton";
  baseline: AccountAppsSnapshot | null;
  projection: AccountAppsProjection;
}>;

export type ProjectedAccountAppData = Readonly<{ resolved: boolean; value?: JsonValue }>;
export type AccountAppDataRestoration = Readonly<
  | { kind: "put"; appId: string; key: string; value: JsonValue }
  | { kind: "delete"; appId: string; key: string }
  | { kind: "replace"; appId: string; values: ReadonlyArray<readonly [string, JsonValue]> }
>;

/** Returns an app resource's generation number. */
function generation(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(message);
  return Number(value);
}

/** Parses and validates account app operation. */
export function parseAccountAppOperation(value: unknown): AccountAppOperation {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.kind !== "string") throw new Error("A queued account app operation has an unsupported format.");
  const id = value.kind === "handlers" ? "" : parseAccountAppId(value.appId);
  if (value.kind === "install") {
    exactKeys(value, ["schemaVersion", "kind", "appId", "manifest", "digest", "md5", "size"], "A queued app installation has an unsupported shape.");
    const manifest = parseManifestV2(value.manifest);
    if (manifest.id !== id || typeof value.digest !== "string" || !SHA256.test(value.digest) || typeof value.md5 !== "string" || !MD5.test(value.md5) || !Number.isSafeInteger(value.size) || Number(value.size) < 1 || Number(value.size) > 32 * 1024 * 1024) throw new Error("A queued app installation has invalid package metadata.");
    return { schemaVersion: 1, kind: "install", appId: id, manifest, digest: value.digest, md5: value.md5, size: Number(value.size) };
  }
  if (value.kind === "uninstall") { exactKeys(value, ["schemaVersion", "kind", "appId", "installationGeneration"], "A queued uninstall has an unsupported shape."); return { schemaVersion: 1, kind: "uninstall", appId: id, installationGeneration: generation(value.installationGeneration, "A queued uninstall has an invalid generation.") }; }
  if (value.kind === "put-data") { exactKeys(value, ["schemaVersion", "kind", "appId", "key", "dataGeneration", "value"], "Queued app data has an unsupported shape."); return { schemaVersion: 1, kind: "put-data", appId: id, key: parseAccountAppDataKey(value.key), dataGeneration: generation(value.dataGeneration, "Queued app data has an invalid generation."), value: parseJsonValue(value.value) }; }
  if (value.kind === "delete-data") { exactKeys(value, ["schemaVersion", "kind", "appId", "key", "dataGeneration"], "Queued app data has an unsupported shape."); return { schemaVersion: 1, kind: "delete-data", appId: id, key: parseAccountAppDataKey(value.key), dataGeneration: generation(value.dataGeneration, "Queued app data has an invalid generation.") }; }
  if (value.kind === "clear-data") { exactKeys(value, ["schemaVersion", "kind", "appId", "dataGeneration"], "Queued app data has an unsupported shape."); return { schemaVersion: 1, kind: "clear-data", appId: id, dataGeneration: generation(value.dataGeneration, "Queued app data has an invalid generation.") }; }
  if (value.kind === "handlers") {
    exactKeys(value, ["schemaVersion", "kind", "hints"], "Queued handler hints have an unsupported shape.");
    if (!isRecord(value.hints) || Object.keys(value.hints).length > 128) throw new Error("Queued handler hints have an unsupported format.");
    const hints = Object.fromEntries(Object.entries(value.hints).map(([matcher, target]) => {
      if (!matcher || new TextEncoder().encode(matcher).byteLength > 255 || [...matcher].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127)) throw new Error("Queued handler hints contain an invalid key.");
      return [matcher, parseAccountAppId(target)];
    }));
    return { schemaVersion: 1, kind: "handlers", hints };
  }
  throw new Error("A queued account app operation has an unsupported kind.");
}

/** Parses and validates account app outbox record. */
export function parseAccountAppOutboxRecord(value: unknown): AccountAppOutboxRecord {
  if (!isRecord(value) || typeof value.operationId !== "string" || !value.operationId || typeof value.clientId !== "string" || !value.clientId || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1 || value.status !== "pending" && value.status !== "blocked" || value.error !== null && typeof value.error !== "string" || value.errorCode !== null && typeof value.errorCode !== "string" || !Number.isSafeInteger(value.attemptCount) || Number(value.attemptCount) < 0 || value.lastAttemptAt !== null && (!Number.isSafeInteger(value.lastAttemptAt) || Number(value.lastAttemptAt) < 0)) throw new Error("The account app outbox contains invalid metadata.");
  exactKeys(value, ["operationId", "clientId", "sequence", "operation", "status", "error", "errorCode", "attemptCount", "lastAttemptAt"], "The account app outbox contains unsupported metadata.");
  return { operationId: value.operationId, clientId: value.clientId, sequence: Number(value.sequence), operation: parseAccountAppOperation(value.operation), status: value.status, error: value.error, errorCode: value.errorCode, attemptCount: Number(value.attemptCount), lastAttemptAt: value.lastAttemptAt as number | null };
}

/** Projects account apps. */
export function projectAccountApps(baseline: AccountAppsSnapshot | null, records: readonly Pick<AccountAppOutboxRecord, "operation" | "status">[]): AccountAppsProjection {
  const apps = new Map<string, DesiredAccountApp>((baseline?.apps ?? []).map((app) => [app.appId, { appId: app.appId, manifest: app.manifest, digest: app.package.sha256, installationGeneration: app.generations.installationGeneration, dataGeneration: app.generations.dataGeneration }]));
  let handlerHints: Readonly<Record<string, string>> = baseline?.handlerHints ?? {};
  for (const { operation, status } of records) {
    if (status === "blocked") continue;
    if (operation.kind === "install") {
      const current = apps.get(operation.appId);
      apps.set(operation.appId, { appId: operation.appId, manifest: operation.manifest, digest: operation.digest, installationGeneration: current?.installationGeneration ?? null, dataGeneration: current?.dataGeneration ?? 0 });
    } else if (operation.kind === "uninstall") {
      apps.delete(operation.appId);
      handlerHints = Object.fromEntries(Object.entries(handlerHints).filter(([, target]) => target !== operation.appId));
    } else if (operation.kind === "clear-data") {
      const current = apps.get(operation.appId);
      if (current && current.dataGeneration === operation.dataGeneration) apps.set(operation.appId, { ...current, dataGeneration: current.dataGeneration + 1 });
    } else if (operation.kind === "handlers") handlerHints = operation.hints;
  }
  return { appsRevision: baseline?.appsRevision ?? 0, apps: [...apps.values()].sort((left, right) => left.appId.localeCompare(right.appId)), handlerHints };
}

/** Projects account app data. */
export function projectAccountAppData(records: readonly Pick<AccountAppOutboxRecord, "operation" | "status">[], appId: string, key: string): ProjectedAccountAppData {
  let result: ProjectedAccountAppData = { resolved: false };
  for (const { operation, status } of records) {
    if (status !== "pending" || operation.kind === "install" || operation.kind === "uninstall" || operation.kind === "handlers" || operation.appId !== appId) continue;
    if (operation.kind === "clear-data" || operation.key === key) result = operation.kind === "put-data" ? { resolved: true, value: operation.value } : { resolved: true };
  }
  return result;
}

/** Rebases account app operation. */
export function rebaseAccountAppOperation(operation: AccountAppOperation, snapshot: AccountAppsSnapshot): AccountAppOperation {
  if (operation.kind === "install" || operation.kind === "handlers") return operation;
  const app = snapshot.apps.find((candidate) => candidate.appId === operation.appId);
  if (!app) return operation;
  if (operation.kind === "uninstall") return { ...operation, installationGeneration: app.generations.installationGeneration };
  return { ...operation, dataGeneration: app.generations.dataGeneration };
}

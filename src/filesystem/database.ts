import {
  WEB2_INDEXED_DB_PREFIX,
  WEB2_BOOTSTRAP_SETTING_KEYS,
  WEB2_MAX_ANCESTRY_DEPTH,
  WEB2_MAX_BATCH_ITEMS,
  assertExactKeys,
  canonicalNameKey,
  canonicalManifestSha256,
  compareOperationTuples,
  isRecord,
  parseCanonicalName,
  parseManifest,
  parseMimeType,
  parseNode,
  parseNodeRecord,
  parseNodeLifecycle,
  parseNonNegativeSafeInteger,
  parseOperationTuple,
  parsePosition,
  parsePositiveSafeInteger,
  parseSha256,
  parseStableId,
  parseSetting,
  parseSettingKeyForNamespace,
  parseSettingNamespace,
  parseWorkspaceSetting,
  storageNamespaceHash,
  type JsonValue,
  type ActiveSetting,
  type Manifest,
  type Node,
  type NodeRecord,
  type NodeLifecycle,
  type OperationTuple,
  type Position,
  type PurgeTombstone,
  type Setting,
  type SettingNamespace,
} from "./model";
import { compareCanonicalStrings, hydrationTargetId, parseHydrationPageData, parseHydrationPageToken, parseHydrationTarget, type HydrationPageData, type HydrationTarget } from "./hydration";
import {
  operationAffectedIdentities,
  parseWorkspaceOperation,
  type WorkspaceOperation,
} from "./operations";
import { DEFAULT_DEVICE_PREFERENCES, parseDevicePreferences, type DevicePreferences } from "../domain/preferences";
import { parseWindowSession, type WindowSession } from "../lib/window-session";
import { parseJsonValue } from "@hiraya-team/apps-contracts";
import { normalizeAssociationMatcher, parseFileAssociation, parseInstalledApp, type FileAssociation, type InstalledApp } from "../apps/installed-apps";
import { RESERVED_SYSTEM_APP_IDS } from "../apps/system-app-ids";
import { parseAccountAppsSnapshot, type AccountAppsSnapshot } from "../lib/account-apps";
import {
  parseAccountAppOperation,
  parseAccountAppOutboxRecord,
  projectAccountApps,
  rebaseAccountAppOperation,
  type AccountAppDataRestoration,
  type AccountAppOperation,
  type AccountAppOutboxRecord,
  type PersistedAccountApps,
} from "../lib/account-app-outbox";

/** Defines the database version. */
const DATABASE_VERSION = 1;
/** Defines the file version history limit. */
const FILE_VERSION_HISTORY_LIMIT = 20;
/** Defines the maximum number of workspaces. */
const MAX_WORKSPACES = WEB2_MAX_BATCH_ITEMS;
/** Defines the stores. */
const STORES = ["workspaces", "nodes", "manifests", "operations", "changes", "sync", "settings", "hydration-pages", "hydration-coverage", "window-sessions", "device-preferences", "installed-apps", "app-storage", "file-associations", "account-apps", "account-app-outbox", "account-app-client-state"] as const;
/** Defines the store schema. */
const STORE_SCHEMA = {
  workspaces: { keyPath: "id", indexes: {} },
  nodes: {
    keyPath: "id",
    indexes: {
      "by-workspace-parent-lifecycle": { keyPath: ["workspaceId", "parentKey", "lifecycleKey"], unique: false },
      "by-workspace-lifecycle": { keyPath: ["workspaceId", "lifecycleKey"], unique: false },
    },
  },
  manifests: { keyPath: "hash", indexes: {} },
  operations: {
    keyPath: "operationId",
    indexes: {
      "by-workspace-revision": { keyPath: ["workspaceId", "localRevision"], unique: true },
      "by-workspace-state-revision": { keyPath: ["workspaceId", "stateKind", "localRevision"], unique: false },
    },
  },
  changes: { keyPath: ["workspaceId", "revision"], indexes: { "by-operation-id": { keyPath: "operationId", unique: false } } },
  sync: { keyPath: "workspaceId", indexes: {} },
  settings: { keyPath: ["workspaceId", "namespace", "key"], indexes: {} },
  "hydration-pages": { keyPath: ["workspaceId", "targetId", "pageIndex"], indexes: { "by-workspace-kind": { keyPath: ["workspaceId", "kind"], unique: false } } },
  "hydration-coverage": { keyPath: ["workspaceId", "targetId"], indexes: {
    "by-workspace-as-of": { keyPath: ["workspaceId", "target.asOf", "targetId"], unique: true },
    "by-member": { keyPath: "memberIds", unique: false, multiEntry: true },
    "by-exact-node": { keyPath: "target.nodeIds", unique: false, multiEntry: true },
    "by-ancestry-node": { keyPath: "target.nodeId", unique: false },
    "by-workspace-kind-namespace": { keyPath: ["workspaceId", "target.kind", "target.namespace"], unique: false },
  } },
  "window-sessions": { keyPath: "workspaceId", indexes: {} },
  "device-preferences": { keyPath: "id", indexes: {} },
  "installed-apps": { keyPath: "appId", indexes: {} },
  "app-storage": { keyPath: ["appId", "key"], indexes: { appId: { keyPath: "appId", unique: false } } },
  "file-associations": { keyPath: "matcher", indexes: { appId: { keyPath: "appId", unique: false } } },
  "account-apps": { keyPath: "id", indexes: {} },
  "account-app-outbox": { keyPath: "sequence", indexes: { operationId: { keyPath: "operationId", unique: true } } },
  "account-app-client-state": { keyPath: "id", indexes: {} },
} as const;

export type Workspace = {
  id: string;
  name: string;
  pinned: boolean;
  ordinal: number;
  headSequence: number;
  snapshotBarrier: number;
  logFloor: number;
  localRevision: number;
};

export type SyncState = {
  workspaceId: string;
  deviceId: string;
  cursor: number;
  lastHydrationAsOf: number;
  lastObservedLogicalTime: number;
  lastLocalLogicalTime: number;
};

export type HydrationGeneration = { workspaceId: string; deviceId: string; generationId: string; target: HydrationTarget };
export type HydrationProgress = { nextPageIndex: number; pageToken: string | null; complete: boolean };
export type HydrationCoverage = { workspaceId: string; targetId: string; generationId: string; target: HydrationTarget; memberIds: string[] };
export type CacheQuery<T> = { availability: "available"; value: T } | { availability: "unavailable" };
export type FilesystemBootstrap = {
  accountId: string;
  deviceId: string;
  cursor: number;
  workspaces: Array<{ id: string; name: string; pinned: boolean }>;
  workspace: { id: string; name: string; pinned: boolean; headSequence: number; snapshotBarrier: number; logFloor: number };
  rootPage: HydrationPageData;
  workspaceSettings: Setting[];
};
export type FilesystemPullOperations = {
  workspaceId: string;
  deviceId: string;
  fromCursor: number;
  cursor: number;
  headSequence: number;
  snapshotBarrier: number;
  logFloor: number;
  observedLogicalTime: number;
  operations: Array<{
    sequence: number;
    operationId: string;
    companion: { workspaceId: string; sequence: number } | null;
    nodes: NodeRecord[];
    settings: Setting[];
  }>;
};
export type FilesystemReset = {
  workspaceId: string;
  deviceId: string;
  fromCursor: number;
  cursor: number;
  headSequence: number;
  snapshotBarrier: number;
  logFloor: number;
  observedLogicalTime: number;
  resetBarrier: number;
};
export type ResetPlan = {
  resetId: string;
  reset: FilesystemReset;
  generations: HydrationGeneration[];
};
export type ResetPreparation = { kind: "plan"; plan: ResetPlan } | { kind: "published"; changes: ChangeRecord[] };
export type ResetPublication = { kind: "plan"; plan: ResetPlan } | { kind: "published"; changes: ChangeRecord[] };

type LocallyCommittableOperation = Extract<WorkspaceOperation, { kind: "create" | "write" | "copy" | "rename" | "move" | "position" | "transfer" | "trash" | "restore" | "purge" | "set" | "set-many" | "unset" | "unset-many" }>;
export type WorkspaceOperationDraft = {
  [Kind in LocallyCommittableOperation["kind"]]: Omit<Extract<LocallyCommittableOperation, { kind: Kind }>, "logicalTime">;
}[LocallyCommittableOperation["kind"]];

export type OperationIntent = "forward" | "undo" | "redo" | "restore";
type PreviousSetting = { exists: false } | { exists: true; value: JsonValue };
export type OperationInverse =
  | { kind: "create"; rootNodeIds: string[] }
  | { kind: "copy"; rootNodeIds: string[]; sourceNodeIds: string[]; sourceFileNodeIds: string[] }
  | { kind: "write"; nodeId: string; mimeType: string; size: number; manifestHash: string; modifiedAt: number }
  | { kind: "rename"; nodeId: string; name: string; modifiedAt: number }
  | { kind: "move"; roots: Array<{ nodeId: string; parentId: string | null; modifiedAt: number }> }
  | { kind: "transfer"; nodes: Array<{ nodeId: string; parentId: string | null; modifiedAt: number }>; fileNodeIds: string[] }
  | { kind: "position"; positions: Array<{ nodeId: string; position: Position }> }
  | { kind: "trash"; roots: Array<{ nodeId: string; parentId: string | null }>; nodeIds: string[] }
  | { kind: "restore"; roots: Array<{ nodeId: string; parentId: string | null; modifiedAt: number }>; nodes: Array<{ nodeId: string; lifecycle: Extract<NodeLifecycle, { kind: "trashed" }> }> }
  | { kind: "purge"; nodeIds: string[]; reason: "Permanent purge cannot be undone." }
  | { kind: "set"; namespace: SettingNamespace; key: string; previous: PreviousSetting }
  | { kind: "set-many"; namespace: SettingNamespace; settings: Array<{ key: string; previous: PreviousSetting }> }
  | { kind: "unset"; namespace: SettingNamespace; key: string; previous: PreviousSetting }
  | { kind: "unset-many"; namespace: SettingNamespace; settings: Array<{ key: string; previous: PreviousSetting }> };

type StoredOperationBase = {
  operationId: string;
  workspaceId: string;
  localRevision: number;
  destinationLocalRevision: number | null;
  overlayKind: "active" | "deferred" | "discarded";
  intent: OperationIntent;
  compensatesOperationId: string | null;
  expectedContentTuple: OperationTuple | null;
  operation: LocallyCommittableOperation;
  inverse: OperationInverse;
  affectedIdentities: string[];
  versionNodeIds: string[];
};
export type StoredOperation = StoredOperationBase & (
  | { stateKind: "pending" | "accepted"; rejection?: never }
  | { stateKind: "rejected"; rejection: { code: string; message: string } }
);

export type ChangeRecord = {
  kind: "operation";
  workspaceId: string;
  revision: number;
  operationId: string;
  affectedIdentities: string[];
} | {
  kind: "hydration";
  workspaceId: string;
  revision: number;
  operationId: string;
  targetId: string;
  affectedIdentities: string[];
} | {
  kind: "pull";
  workspaceId: string;
  revision: number;
  operationId: string;
  fromCursor: number;
  cursor: number;
  affectedIdentities: string[];
} | {
  kind: "reset";
  workspaceId: string;
  revision: number;
  operationId: string;
  fromCursor: number;
  cursor: number;
  headSequence: number;
  snapshotBarrier: number;
  logFloor: number;
  observedLogicalTime: number;
  affectedIdentities: string[];
};

export type FileVersion = {
  nodeId: string;
  operationId: string;
  logicalTime: number;
  mimeType: string;
  size: number;
  manifestHash: string;
  modifiedAt: number;
  current: boolean;
};

export type FilesystemDatabaseEnvironment = {
  storageId: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  now?: () => number;
  randomUUID?: () => string;
};

type CommitOperationBase = {
  manifests?: Array<{ hash: string; manifest: Manifest }>;
  intent?: OperationIntent;
  compensatesOperationId?: string | null;
};
export type CommitOperationInput = CommitOperationBase & (
  | { operation: Extract<WorkspaceOperationDraft, { kind: "create" }>; expectedContentTuple?: never }
  | { operation: Extract<WorkspaceOperationDraft, { kind: "write" }>; expectedContentTuple: OperationTuple }
  | { operation: Exclude<WorkspaceOperationDraft, { kind: "create" | "write" }>; expectedContentTuple?: never }
);

export type FilesystemDatabase = {
  close(): void;
  createWorkspace(value: { id: string; name: string; pinned: boolean; deviceId: string }): Promise<Workspace>;
  listWorkspaces(): Promise<Workspace[]>;
  renameWorkspace(workspaceId: string, name: string): Promise<Workspace>;
  setWorkspacePreferences(preferences: Array<{ id: string; pinned: boolean }>): Promise<Workspace[]>;
  deleteWorkspace(workspaceId: string): Promise<Workspace[]>;
  getNode(id: string): Promise<Node | undefined>;
  getNodeRecord(id: string): Promise<NodeRecord | undefined>;
  queryNode(workspaceId: string, nodeId: string): Promise<CacheQuery<Node | undefined>>;
  listChildren(workspaceId: string, parentId: string | null, limit?: number): Promise<Node[]>;
  queryFolderChildren(workspaceId: string, parentId: string | null): Promise<CacheQuery<Node[]>>;
  assertChildNamesAvailable(workspaceId: string, parentId: string | null, names: string[]): Promise<void>;
  assertNodeIdsAvailable(ids: string[]): Promise<void>;
  listTrash(workspaceId: string): Promise<Node[]>;
  getSetting(workspaceId: string, namespace: SettingNamespace, key: string): Promise<ActiveSetting | undefined>;
  querySetting(workspaceId: string, namespace: SettingNamespace, key: string): Promise<CacheQuery<ActiveSetting | undefined>>;
  listSettings(workspaceId: string, namespace: SettingNamespace): Promise<ActiveSetting[]>;
  querySettingNamespace(workspaceId: string, namespace: SettingNamespace): Promise<CacheQuery<ActiveSetting[]>>;
  getSettingRecord(workspaceId: string, namespace: SettingNamespace, key: string): Promise<Setting | undefined>;
  listSettingRecords(workspaceId: string, namespace: SettingNamespace): Promise<Setting[]>;
  getSyncState(workspaceId: string): Promise<SyncState>;
  beginHydration(targetId: string, generation: HydrationGeneration, resetId?: string): Promise<void>;
  getHydrationGeneration(workspaceId: string, targetId: string): Promise<HydrationGeneration | undefined>;
  getHydrationProgress(workspaceId: string, targetId: string, generationId: string): Promise<HydrationProgress | undefined>;
  stageHydrationPage(targetId: string, requestPageToken: string | null, page: HydrationPageData): Promise<boolean>;
  getHydrationCoverage(workspaceId: string, targetId: string): Promise<HydrationCoverage | undefined>;
  getWorkspaceBootstrapState(workspaceId: string): Promise<{ target: HydrationTarget; staged: boolean } | undefined>;
  getHydrationChanges(generationId: string): Promise<ChangeRecord[]>;
  publishHydration(workspaceId: string, targetId: string, generationId: string, bootstrap?: FilesystemBootstrap): Promise<ChangeRecord[]>;
  prepareReset(value: FilesystemReset, createGenerationId: () => string): Promise<ResetPreparation>;
  restartResetHydration(resetId: string, targetId: string, createGenerationId: () => string): Promise<HydrationGeneration>;
  publishReset(resetId: string, createGenerationId: () => string): Promise<ResetPublication>;
  applyPullOperations(value: FilesystemPullOperations): Promise<ChangeRecord[]>;
  getManifest(hash: string): Promise<Manifest | undefined>;
  storeManifest(hash: string, manifest: Manifest): Promise<void>;
  getOperation(operationId: string): Promise<StoredOperation | undefined>;
  listUnsettledOperations(workspaceId: string, afterRevision?: number, limit?: number): Promise<StoredOperation[]>;
  recordPushRejections(rejections: Array<{ operationId: string; workspaceId: string; code: string; message: string }>): Promise<StoredOperation[]>;
  deferRejectedOperation(operationId: string): Promise<StoredOperation>;
  completeRejectedDiscards(operationIds: string[]): Promise<void>;
  commitOperation(value: CommitOperationInput): Promise<StoredOperation>;
  listChanges(workspaceId: string, afterRevision: number, limit?: number): Promise<ChangeRecord[]>;
  listOperations(workspaceId: string, limit?: number): Promise<StoredOperation[]>;
  listFileVersions(workspaceId: string, nodeId: string): Promise<FileVersion[]>;
  sweepManifests(): Promise<string[]>;
  readWindowSession(workspaceId: string): Promise<WindowSession>;
  writeWindowSession(workspaceId: string, session: WindowSession): Promise<void>;
  readDevicePreferences(): Promise<DevicePreferences>;
  writeDevicePreferences(preferences: DevicePreferences): Promise<void>;
  listLegacyStoreApps(): Promise<Array<{ appId: string; digest: string }>>;
  removeLegacyStoreApp(appId: string): Promise<void>;
  listInstalledApps(): Promise<InstalledApp[]>;
  installApp(install: InstalledApp): Promise<InstalledApp>;
  uninstallApp(appId: string): Promise<void>;
  listFileAssociations(): Promise<FileAssociation[]>;
  setFileAssociation(association: FileAssociation): Promise<FileAssociation>;
  removeFileAssociation(matcher: string): Promise<void>;
  resetFileAssociations(): Promise<void>;
  readAppStorage(appId: string, key: string): Promise<JsonValue | undefined>;
  writeAppStorage(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number): Promise<void>;
  removeAppStorage(appId: string, key: string): Promise<void>;
  clearAppStorage(appId: string): Promise<void>;
  readAccountApps(): Promise<{ state: PersistedAccountApps; outbox: AccountAppOutboxRecord[] }>;
  enqueueAccountAppOperation(operation: AccountAppOperation): Promise<{ state: PersistedAccountApps; record: AccountAppOutboxRecord }>;
  reconcileAccountApps(snapshot: AccountAppsSnapshot, acknowledgedOperationId?: string): Promise<PersistedAccountApps>;
  blockAccountAppOperation(operationId: string, error: string, errorCode: string): Promise<void>;
  retryAccountAppOperation(operationId: string): Promise<AccountAppOutboxRecord>;
  discardAccountAppOperation(operationId: string, restoration?: AccountAppDataRestoration): Promise<void>;
  recordAccountAppAttempt(operationId: string, attemptedAt: number): Promise<void>;
  getOrCreateDeviceId(): Promise<string>;
};

type StoredNode = Node & { parentKey: string; lifecycleKey: string };
type StoredNodeRecord = StoredNode | Extract<NodeRecord, { purged: true }>;
type StoredHydrationHeader = HydrationGeneration & HydrationProgress & { targetId: string; pageIndex: -1; kind: "header"; lastIdentity: string | null };
type StoredHydrationPage = { workspaceId: string; targetId: string; pageIndex: number; kind: "page"; requestPageToken: string | null; page: HydrationPageData };
type StoredBootstrap = { workspaceId: string; targetId: string; pageIndex: -2; kind: "bootstrap"; bootstrap: FilesystemBootstrap };
type StoredResetPlan = { workspaceId: string; targetId: string; pageIndex: -3; kind: "reset"; resetId: string; reset: FilesystemReset; targets: HydrationTarget[] };
type StoredHydrationCoverage = HydrationCoverage;
type StoredManifest = { hash: string; manifest: Manifest };
type AppStorageRecord = { appId: string; key: string; value: JsonValue; bytes: number };
/** Identifies records stored once per filesystem database. */
const SINGLETON_RECORD_ID = "singleton" as const;
type AccountAppClientState = { id: typeof SINGLETON_RECORD_ID; clientId: string; nextSequence: number };

/** Defines the app ID. */
const APP_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
/** Defines the reset target ID. */
const RESET_TARGET_ID = "0".repeat(64);

/** Parses and validates app ID. */
function parseAppId(value: unknown) {
  if (typeof value !== "string" || value.length > 256 || !APP_ID.test(value)) throw new Error("An app ID is invalid.");
  return value;
}

/** Parses and validates app storage key. */
function parseAppStorageKey(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  })) throw new Error("An app storage key is invalid.");
  return value;
}

/** Returns app storage bytes. */
function appStorageBytes(key: string, value: JsonValue) {
  return new TextEncoder().encode(JSON.stringify(key)).byteLength + new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Parses and validates app storage record. */
function parseAppStorageRecord(value: unknown, expectedAppId?: string): AppStorageRecord {
  if (!isRecord(value)) throw new Error("A stored app data record has an unsupported shape.");
  assertExactKeys(value, ["appId", "key", "value", "bytes"], "A stored app data record has an unsupported shape.");
  const appId = parseAppId(value.appId);
  const key = parseAppStorageKey(value.key);
  const parsed = parseJsonValue(value.value);
  const bytes = parsePositiveSafeInteger(value.bytes, "A stored app data size is invalid.");
  if ((expectedAppId !== undefined && appId !== expectedAppId) || bytes !== appStorageBytes(key, parsed)) throw new Error("A stored app data record is inconsistent.");
  return { appId, key, value: parsed, bytes };
}

/** Removes app data rows. */
async function clearAppDataRows(transaction: IDBTransaction, appId: string) {
  const storage = transaction.objectStore("app-storage");
  const associations = transaction.objectStore("file-associations");
  await Promise.all([
    ...((await request(storage.index("appId").getAllKeys(appId))).map((key) => request(storage.delete(key)))),
    ...((await request(associations.index("appId").getAllKeys(appId))).map((key) => request(associations.delete(key)))),
  ]);
}

/** Parses and validates account app operation ID. */
function parseAccountAppOperationId(value: unknown) {
  if (typeof value !== "string" || !/^\d{16}$/.test(value)) throw new Error("An account app operation ID is invalid.");
  return value;
}

/** Reads account app outbox. */
async function readAccountAppOutbox(store: IDBObjectStore) {
  return (await request(store.getAll())).map((value) => {
    const record = parseAccountAppOutboxRecord(value);
    if (record.operationId !== record.sequence.toString().padStart(16, "0")) throw new Error("The account app outbox contains inconsistent identity metadata.");
    return { ...record, clientId: parseStableId(record.clientId, "The account app outbox client ID is invalid.") };
  }).sort((left, right) => left.sequence - right.sequence);
}

/** Reads account app state. */
async function readAccountAppState(store: IDBObjectStore, outbox: readonly AccountAppOutboxRecord[]): Promise<PersistedAccountApps> {
  const value = await request(store.get(SINGLETON_RECORD_ID));
  if (value === undefined) return { id: SINGLETON_RECORD_ID, baseline: null, projection: projectAccountApps(null, outbox) };
  if (!isRecord(value)) throw new Error("Stored account apps have an unsupported shape.");
  assertExactKeys(value, ["id", "baseline", "projection"], "Stored account apps have an unsupported shape.");
  if (value.id !== SINGLETON_RECORD_ID) throw new Error("Stored account apps have an invalid identity.");
  const baseline = value.baseline === null ? null : parseAccountAppsSnapshot(value.baseline);
  const projection = projectAccountApps(baseline, outbox);
  if (JSON.stringify(value.projection) !== JSON.stringify(projection)) throw new Error("The account app projection does not match its baseline and outbox.");
  return { id: SINGLETON_RECORD_ID, baseline, projection };
}

/** Reserves account app operation. */
async function reserveAccountAppOperation(store: IDBObjectStore, randomUUID: () => string) {
  const value = await request(store.get(SINGLETON_RECORD_ID));
  let state: AccountAppClientState;
  if (value === undefined) state = { id: SINGLETON_RECORD_ID, clientId: parseStableId(randomUUID(), "The account app client ID is invalid."), nextSequence: 1 };
  else {
    if (!isRecord(value)) throw new Error("The account app operation identity is invalid.");
    assertExactKeys(value, ["id", "clientId", "nextSequence"], "The account app operation identity is invalid.");
    if (value.id !== SINGLETON_RECORD_ID) throw new Error("The account app operation identity is invalid.");
    state = { id: SINGLETON_RECORD_ID, clientId: parseStableId(value.clientId, "The account app client ID is invalid."), nextSequence: parsePositiveSafeInteger(value.nextSequence, "The account app operation sequence is invalid.") };
  }
  const sequence = state.nextSequence;
  await request(store.put({ ...state, nextSequence: nextSafeInteger(sequence, "The account app operation sequence is exhausted.") } satisfies AccountAppClientState));
  return { clientId: state.clientId, sequence, operationId: sequence.toString().padStart(16, "0") };
}

/** Writes local account app data. */
async function writeLocalAccountAppData(transaction: IDBTransaction, operation: Extract<AccountAppOperation, { kind: "put-data" | "delete-data" | "clear-data" }>) {
  const store = transaction.objectStore("app-storage");
  if (operation.kind === "delete-data") {
    await request(store.delete([operation.appId, operation.key]));
    return;
  }
  if (operation.kind === "clear-data") {
    const keys = await request(store.index("appId").getAllKeys(operation.appId));
    await Promise.all(keys.map((key) => request(store.delete(key))));
    return;
  }
  const key = parseAppStorageKey(operation.key);
  const value = parseJsonValue(operation.value);
  const bytes = appStorageBytes(key, value);
  const records = (await request(store.index("appId").getAll(operation.appId))).map((record) => parseAppStorageRecord(record, operation.appId));
  const existing = records.find((record) => record.key === key);
  if (!existing && records.length >= 128) throw new Error("App storage entry quota exceeded.");
  if (records.reduce((sum, record) => sum + record.bytes, 0) - (existing?.bytes ?? 0) + bytes > 64 * 1024) throw new Error("App storage quota exceeded.");
  await request(store.put({ appId: operation.appId, key, value, bytes } satisfies AppStorageRecord));
}

/** Restores local account app data. */
async function restoreLocalAccountAppData(transaction: IDBTransaction, operation: AccountAppOperation, restoration?: AccountAppDataRestoration) {
  if (operation.kind === "install" || operation.kind === "uninstall" || operation.kind === "handlers") {
    if (restoration) throw new Error("That account app change does not restore local data.");
    return;
  }
  if (!restoration || parseAppId(restoration.appId) !== operation.appId) throw new Error("Local app data must be restored before discarding this change.");
  const store = transaction.objectStore("app-storage");
  if (restoration.kind === "replace") {
    if (restoration.values.length > 128 || new Set(restoration.values.map(([key]) => key)).size !== restoration.values.length) throw new Error("The local app data restoration is invalid.");
    const values = restoration.values.map(([keyValue, value]) => {
      const key = parseAppStorageKey(keyValue);
      const parsed = parseJsonValue(value);
      return { key, value: parsed, bytes: appStorageBytes(key, parsed) };
    });
    if (values.reduce((sum, item) => sum + item.bytes, 0) > 64 * 1024) throw new Error("App storage quota exceeded.");
    const keys = await request(store.index("appId").getAllKeys(operation.appId));
    await Promise.all(keys.map((key) => request(store.delete(key))));
    await Promise.all(values.map(({ key, value, bytes }) => request(store.put({ appId: operation.appId, key, value, bytes } satisfies AppStorageRecord))));
    return;
  }
  if (operation.kind === "clear-data" || parseAppStorageKey(restoration.key) !== operation.key) throw new Error("The local app data restoration does not match the discarded change.");
  if (restoration.kind === "delete") {
    await request(store.delete([operation.appId, operation.key]));
    return;
  }
  const value = parseJsonValue(restoration.value);
  const bytes = appStorageBytes(operation.key, value);
  const records = (await request(store.index("appId").getAll(operation.appId))).map((record) => parseAppStorageRecord(record, operation.appId));
  const existing = records.find((record) => record.key === operation.key);
  if (!existing && records.length >= 128) throw new Error("App storage entry quota exceeded.");
  if (records.reduce((sum, record) => sum + record.bytes, 0) - (existing?.bytes ?? 0) + bytes > 64 * 1024) throw new Error("App storage quota exceeded.");
  await request(store.put({ appId: operation.appId, key: operation.key, value, bytes } satisfies AppStorageRecord));
}

/** Parses and validates stored window session. */
function parseStoredWindowSession(value: unknown, expectedWorkspaceId: string) {
  if (!isRecord(value)) throw new Error("A stored window session has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "session"], "A stored window session has an unsupported shape.");
  const workspaceId = parseStableId(value.workspaceId, "A stored window session workspace ID is invalid.");
  if (workspaceId !== expectedWorkspaceId) throw new Error("A stored window session has an inconsistent identity.");
  return parseWindowSession(value.session);
}

/** Parses and validates stored device preferences. */
function parseStoredDevicePreferences(value: unknown) {
  if (!isRecord(value)) throw new Error("Stored device preferences have an unsupported shape.");
  assertExactKeys(value, ["id", "schemaVersion", "preferences"], "Stored device preferences have an unsupported shape.");
  if (value.id !== SINGLETON_RECORD_ID || value.schemaVersion !== 1) throw new Error("Stored device preferences have an unsupported format.");
  return parseDevicePreferences(value.preferences);
}

/** Parses and validates stored device identity. */
function parseStoredDeviceIdentity(value: unknown) {
  if (!isRecord(value)) throw new Error("Stored device identity has an unsupported shape.");
  assertExactKeys(value, ["id", "schemaVersion", "deviceId"], "Stored device identity has an unsupported shape.");
  if (value.id !== "device" || value.schemaVersion !== 1) throw new Error("Stored device identity has an unsupported format.");
  return parseStableId(value.deviceId, "Stored device identity is invalid.");
}

/** Resolves an IndexedDB request as a promise. */
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Filesystem storage failed."));
  });
}

/** Resolves when an IndexedDB transaction completes. */
function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("The filesystem transaction was cancelled."));
    transaction.onerror = () => reject(transaction.error ?? new Error("The filesystem transaction failed."));
  });
}

/** Runs work in an IndexedDB transaction. */
async function transact<T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => Promise<T>) {
  const transaction = mode === "readwrite"
    ? db.transaction(stores, mode, { durability: "strict" })
    : db.transaction(stores, mode);
  const done = transactionDone(transaction);
  try {
    const result = await operation(transaction);
    await done;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* The transaction already ended. */ }
    await done.catch(() => undefined);
    throw error;
  }
}

/** Parses and validates workspace. */
function parseWorkspace(value: unknown): Workspace {
  if (!isRecord(value)) throw new Error("A stored workspace has an unsupported shape.");
  assertExactKeys(value, ["id", "name", "pinned", "ordinal", "headSequence", "snapshotBarrier", "logFloor", "localRevision"], "A stored workspace has an unsupported shape.");
  if (typeof value.pinned !== "boolean") throw new Error("A stored workspace has invalid pinning metadata.");
  const workspace = {
    id: parseStableId(value.id, "A stored workspace ID is invalid."),
    name: parseCanonicalName(value.name, "A stored workspace name is invalid."),
    pinned: value.pinned,
    ordinal: parseNonNegativeSafeInteger(value.ordinal, "A stored workspace ordinal is invalid."),
    headSequence: parseNonNegativeSafeInteger(value.headSequence, "A stored workspace head is invalid."),
    snapshotBarrier: parseNonNegativeSafeInteger(value.snapshotBarrier, "A stored workspace snapshot barrier is invalid."),
    logFloor: parseNonNegativeSafeInteger(value.logFloor, "A stored workspace log floor is invalid."),
    localRevision: parseNonNegativeSafeInteger(value.localRevision, "A stored workspace revision is invalid."),
  };
  if (workspace.logFloor > workspace.snapshotBarrier || workspace.snapshotBarrier > workspace.headSequence) throw new Error("A stored workspace sequence range is invalid.");
  return workspace;
}

/** Computes workspace name key. */
function workspaceNameKey(name: string) {
  return canonicalNameKey(name);
}

/** Parses and validates workspace list. */
function parseWorkspaceList(values: unknown[]) {
  const workspaces = values.map(parseWorkspace).sort((left, right) => left.ordinal - right.ordinal);
  if (workspaces.length > MAX_WORKSPACES || workspaces.some(({ ordinal }, index) => ordinal !== index) || new Set(workspaces.map(({ name }) => workspaceNameKey(name))).size !== workspaces.length) throw new Error("Stored workspace directory metadata is invalid.");
  let unpinned = false;
  for (const workspace of workspaces) {
    if (!workspace.pinned) unpinned = true;
    else if (unpinned) throw new Error("Stored workspace directory metadata is invalid.");
  }
  return workspaces;
}

/** Parses and validates sync state. */
function parseSyncState(value: unknown): SyncState {
  if (!isRecord(value)) throw new Error("Stored synchronization state has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "deviceId", "cursor", "lastHydrationAsOf", "lastObservedLogicalTime", "lastLocalLogicalTime"], "Stored synchronization state has an unsupported shape.");
  return {
    workspaceId: parseStableId(value.workspaceId, "A stored synchronization workspace ID is invalid."),
    deviceId: parseStableId(value.deviceId, "A stored synchronization device ID is invalid."),
    cursor: parseNonNegativeSafeInteger(value.cursor, "A stored synchronization cursor is invalid."),
    lastHydrationAsOf: parseNonNegativeSafeInteger(value.lastHydrationAsOf, "A stored hydration sequence is invalid."),
    lastObservedLogicalTime: parseNonNegativeSafeInteger(value.lastObservedLogicalTime, "A stored observed logical time is invalid."),
    lastLocalLogicalTime: parseNonNegativeSafeInteger(value.lastLocalLogicalTime, "A stored local logical time is invalid."),
  };
}

/** Parses and validates hydration generation. */
function parseHydrationGeneration(value: unknown): HydrationGeneration {
  if (!isRecord(value)) throw new Error("A hydration generation has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "deviceId", "generationId", "target"], "A hydration generation has an unsupported shape.");
  const workspaceId = parseStableId(value.workspaceId, "A hydration workspace ID is invalid.");
  const target = parseHydrationTarget(value.target);
  if (target.workspaceId !== workspaceId) throw new Error("A hydration generation mixes workspaces.");
  return { workspaceId, deviceId: parseStableId(value.deviceId, "A hydration device ID is invalid."), generationId: parseStableId(value.generationId, "A hydration generation ID is invalid."), target };
}

/** Parses and validates filesystem bootstrap. */
function parseFilesystemBootstrap(value: unknown): FilesystemBootstrap {
  if (!isRecord(value)) throw new Error("A filesystem bootstrap has an unsupported shape.");
  assertExactKeys(value, ["accountId", "deviceId", "cursor", "workspaces", "workspace", "rootPage", "workspaceSettings"], "A filesystem bootstrap has an unsupported shape.");
  const accountId = parseStableId(value.accountId, "A bootstrap account ID is invalid.");
  const deviceId = parseStableId(value.deviceId, "A bootstrap device ID is invalid.");
  const cursor = parseNonNegativeSafeInteger(value.cursor, "A bootstrap cursor is invalid.");
  if (!Array.isArray(value.workspaces) || value.workspaces.length === 0 || value.workspaces.length > MAX_WORKSPACES) throw new Error("A bootstrap workspace directory is invalid.");
  const parseSummary = (candidate: unknown) => {
    if (!isRecord(candidate)) throw new Error("A bootstrap workspace summary has an unsupported shape.");
    assertExactKeys(candidate, ["id", "name", "pinned"], "A bootstrap workspace summary has an unsupported shape.");
    if (typeof candidate.pinned !== "boolean") throw new Error("A bootstrap workspace summary has invalid pinning metadata.");
    return { id: parseStableId(candidate.id, "A bootstrap workspace ID is invalid."), name: parseCanonicalName(candidate.name, "A bootstrap workspace name is invalid."), pinned: candidate.pinned };
  };
  const workspaces = value.workspaces.map(parseSummary);
  if (!isRecord(value.workspace)) throw new Error("A bootstrap workspace state has an unsupported shape.");
  assertExactKeys(value.workspace, ["id", "name", "pinned", "headSequence", "snapshotBarrier", "logFloor"], "A bootstrap workspace state has an unsupported shape.");
  const summary = parseSummary({ id: value.workspace.id, name: value.workspace.name, pinned: value.workspace.pinned });
  const workspace = {
    ...summary,
    headSequence: parseNonNegativeSafeInteger(value.workspace.headSequence, "A bootstrap workspace head is invalid."),
    snapshotBarrier: parseNonNegativeSafeInteger(value.workspace.snapshotBarrier, "A bootstrap workspace snapshot barrier is invalid."),
    logFloor: parseNonNegativeSafeInteger(value.workspace.logFloor, "A bootstrap workspace log floor is invalid."),
  };
  const rootPage = parseHydrationPageData(value.rootPage);
  if (!Array.isArray(value.workspaceSettings) || value.workspaceSettings.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Bootstrap workspace settings are invalid.");
  const workspaceSettings = value.workspaceSettings.map(parseSetting);
  const activeSummary = workspaces.find(({ id }) => id === workspace.id);
  if (new Set(workspaces.map(({ id }) => id)).size !== workspaces.length || new Set(workspaces.map(({ name }) => workspaceNameKey(name))).size !== workspaces.length || workspaces.some(({ pinned }, index) => index > 0 && pinned && !workspaces[index - 1]!.pinned) || !activeSummary || !equalValues(activeSummary, summary)) throw new Error("A bootstrap workspace directory is inconsistent.");
  if (workspace.logFloor > workspace.snapshotBarrier || workspace.snapshotBarrier > workspace.headSequence || cursor > workspace.headSequence) throw new Error("A bootstrap workspace sequence range is invalid.");
  if (rootPage.workspaceId !== workspace.id || rootPage.deviceId !== deviceId || rootPage.pageIndex !== 0 || rootPage.target.kind !== "folder-page" || rootPage.target.parentId !== null || rootPage.target.asOf !== workspace.headSequence) throw new Error("A bootstrap root page is inconsistent.");
  if (workspaceSettings.some((setting) => setting.workspaceId !== workspace.id || setting.namespace !== "desktop-grid" || !WEB2_BOOTSTRAP_SETTING_KEYS.includes(setting.key as typeof WEB2_BOOTSTRAP_SETTING_KEYS[number]) || setting.logicalTime > rootPage.observedLogicalTime) || new Set(workspaceSettings.map(({ namespace, key }) => `${namespace}\0${key}`)).size !== workspaceSettings.length) throw new Error("Bootstrap workspace settings are inconsistent.");
  return { accountId, deviceId, cursor, workspaces, workspace, rootPage, workspaceSettings };
}

/** Parses and validates filesystem pull operations. */
function parseFilesystemPullOperations(value: unknown): FilesystemPullOperations {
  if (!isRecord(value)) throw new Error("A filesystem pull has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "deviceId", "fromCursor", "cursor", "headSequence", "snapshotBarrier", "logFloor", "observedLogicalTime", "operations"], "A filesystem pull has an unsupported shape.");
  const workspaceId = parseStableId(value.workspaceId, "A pull workspace ID is invalid.");
  const deviceId = parseStableId(value.deviceId, "A pull device ID is invalid.");
  const fromCursor = parseNonNegativeSafeInteger(value.fromCursor, "A pull cursor is invalid.");
  const cursor = parseNonNegativeSafeInteger(value.cursor, "A pull cursor is invalid.");
  const headSequence = parseNonNegativeSafeInteger(value.headSequence, "A pull head is invalid.");
  const snapshotBarrier = parseNonNegativeSafeInteger(value.snapshotBarrier, "A pull snapshot barrier is invalid.");
  const logFloor = parseNonNegativeSafeInteger(value.logFloor, "A pull log floor is invalid.");
  const observedLogicalTime = parseNonNegativeSafeInteger(value.observedLogicalTime, "A pull observed logical time is invalid.");
  if (cursor < fromCursor || headSequence < cursor || logFloor > snapshotBarrier || snapshotBarrier > headSequence || !Array.isArray(value.operations) || value.operations.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A filesystem pull sequence range is invalid.");
  const operations = value.operations.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error("A filesystem pulled operation has an unsupported shape.");
    assertExactKeys(candidate, ["sequence", "operationId", "companion", "nodes", "settings"], "A filesystem pulled operation has an unsupported shape.");
    const sequence = parsePositiveSafeInteger(candidate.sequence, "A pulled operation sequence is invalid.");
    const operationId = parseStableId(candidate.operationId, "A pulled operation ID is invalid.");
    let companion: { workspaceId: string; sequence: number } | null = null;
    if (candidate.companion !== null) {
      if (!isRecord(candidate.companion)) throw new Error("A filesystem pull companion has an unsupported shape.");
      assertExactKeys(candidate.companion, ["workspaceId", "sequence"], "A filesystem pull companion has an unsupported shape.");
      companion = { workspaceId: parseStableId(candidate.companion.workspaceId, "A pull companion workspace ID is invalid."), sequence: parsePositiveSafeInteger(candidate.companion.sequence, "A pull companion sequence is invalid.") };
    }
    if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.settings)) throw new Error("A filesystem pull record batch is invalid.");
    const nodes = candidate.nodes.map(parseNodeRecord);
    const settings = candidate.settings.map(parseSetting);
    if (sequence !== fromCursor + index + 1 || nodes.length + settings.length > WEB2_MAX_BATCH_ITEMS || nodes.length > 0 && settings.length > 0 || (companion === null ? [...nodes, ...settings].some((record) => record.workspaceId !== workspaceId) : companion.workspaceId === workspaceId || settings.length > 0 || nodes.some((record) => record.workspaceId !== workspaceId && record.workspaceId !== companion.workspaceId))) throw new Error("A filesystem pulled operation is inconsistent.");
    return { sequence, operationId, companion, nodes, settings };
  });
  if (operations.length > 0 && operations.at(-1)!.sequence !== cursor || operations.length === 0 && cursor !== fromCursor || new Set(operations.map(({ operationId }) => operationId)).size !== operations.length) throw new Error("A filesystem pull cursor is inconsistent.");
  return { workspaceId, deviceId, fromCursor, cursor, headSequence, snapshotBarrier, logFloor, observedLogicalTime, operations };
}

/** Parses and validates filesystem reset. */
function parseFilesystemReset(value: unknown): FilesystemReset {
  if (!isRecord(value)) throw new Error("A filesystem reset has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "deviceId", "fromCursor", "cursor", "headSequence", "snapshotBarrier", "logFloor", "observedLogicalTime", "resetBarrier"], "A filesystem reset has an unsupported shape.");
  const reset = {
    workspaceId: parseStableId(value.workspaceId, "A reset workspace ID is invalid."),
    deviceId: parseStableId(value.deviceId, "A reset device ID is invalid."),
    fromCursor: parseNonNegativeSafeInteger(value.fromCursor, "A reset cursor is invalid."),
    cursor: parseNonNegativeSafeInteger(value.cursor, "A reset cursor is invalid."),
    headSequence: parseNonNegativeSafeInteger(value.headSequence, "A reset head is invalid."),
    snapshotBarrier: parseNonNegativeSafeInteger(value.snapshotBarrier, "A reset snapshot barrier is invalid."),
    logFloor: parseNonNegativeSafeInteger(value.logFloor, "A reset log floor is invalid."),
    observedLogicalTime: parseNonNegativeSafeInteger(value.observedLogicalTime, "A reset observed logical time is invalid."),
    resetBarrier: parseNonNegativeSafeInteger(value.resetBarrier, "A reset barrier is invalid."),
  };
  if (reset.fromCursor >= reset.logFloor || reset.cursor !== reset.resetBarrier || reset.snapshotBarrier !== reset.resetBarrier || reset.headSequence < reset.cursor || reset.logFloor > reset.snapshotBarrier) throw new Error("A filesystem reset is inconsistent.");
  return reset;
}

/** Parses and validates stored hydration header. */
function parseStoredHydrationHeader(value: unknown): StoredHydrationHeader {
  if (!isRecord(value)) throw new Error("A stored hydration header has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "targetId", "pageIndex", "kind", "deviceId", "generationId", "target", "nextPageIndex", "pageToken", "complete", "lastIdentity"], "A stored hydration header has an unsupported shape.");
  if (value.kind !== "header" || value.pageIndex !== -1 || typeof value.complete !== "boolean" || value.lastIdentity !== null && (typeof value.lastIdentity !== "string" || value.lastIdentity.length === 0)) throw new Error("A stored hydration header is invalid.");
  const nextPageIndex = parseNonNegativeSafeInteger(value.nextPageIndex, "A stored hydration page index is invalid.");
  if (nextPageIndex > 100_000) throw new Error("A stored hydration generation is too large.");
  const pageToken = value.pageToken === null ? null : parseHydrationPageToken(value.pageToken);
  if (value.complete !== (pageToken === null && nextPageIndex > 0)) throw new Error("Stored hydration completion metadata is inconsistent.");
  return { ...parseHydrationGeneration({ workspaceId: value.workspaceId, deviceId: value.deviceId, generationId: value.generationId, target: value.target }), targetId: parseSha256(value.targetId, "A hydration target ID is invalid."), pageIndex: -1, kind: "header", nextPageIndex, pageToken, complete: value.complete, lastIdentity: value.lastIdentity };
}

/** Parses and validates stored hydration page. */
function parseStoredHydrationPage(value: unknown): StoredHydrationPage {
  if (!isRecord(value)) throw new Error("A stored hydration page has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "targetId", "pageIndex", "kind", "requestPageToken", "page"], "A stored hydration page has an unsupported shape.");
  if (value.kind !== "page") throw new Error("A stored hydration page is invalid.");
  const workspaceId = parseStableId(value.workspaceId, "A hydration workspace ID is invalid.");
  const pageIndex = parseNonNegativeSafeInteger(value.pageIndex, "A hydration page index is invalid.");
  const requestPageToken = value.requestPageToken === null ? null : parseHydrationPageToken(value.requestPageToken);
  if ((pageIndex === 0) !== (requestPageToken === null)) throw new Error("Stored hydration request pagination is inconsistent.");
  const page = parseHydrationPageData(value.page);
  if (page.workspaceId !== workspaceId || page.pageIndex !== pageIndex) throw new Error("Stored hydration page metadata is inconsistent.");
  return { workspaceId, targetId: parseSha256(value.targetId, "A hydration target ID is invalid."), pageIndex, kind: "page", requestPageToken, page };
}

/** Parses and validates stored bootstrap. */
function parseStoredBootstrap(value: unknown): StoredBootstrap {
  if (!isRecord(value)) throw new Error("A stored bootstrap has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "targetId", "pageIndex", "kind", "bootstrap"], "A stored bootstrap has an unsupported shape.");
  if (value.kind !== "bootstrap" || value.pageIndex !== -2) throw new Error("A stored bootstrap is invalid.");
  const bootstrap = parseFilesystemBootstrap(value.bootstrap);
  const workspaceId = parseStableId(value.workspaceId, "A bootstrap workspace ID is invalid.");
  const targetId = parseSha256(value.targetId, "A hydration target ID is invalid.");
  if (workspaceId !== bootstrap.workspace.id || hydrationTargetId(bootstrap.rootPage.target) !== targetId) throw new Error("Stored bootstrap metadata is inconsistent.");
  return { workspaceId, targetId, pageIndex: -2, kind: "bootstrap", bootstrap };
}

/** Parses and validates stored reset plan. */
function parseStoredResetPlan(value: unknown): StoredResetPlan {
  if (!isRecord(value)) throw new Error("A stored reset plan has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "targetId", "pageIndex", "kind", "resetId", "reset", "targets"], "A stored reset plan has an unsupported shape.");
  if (value.kind !== "reset" || value.pageIndex !== -3 || value.targetId !== RESET_TARGET_ID || !Array.isArray(value.targets) || value.targets.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A stored reset plan is invalid.");
  const workspaceId = parseStableId(value.workspaceId, "A reset workspace ID is invalid.");
  const reset = parseFilesystemReset(value.reset);
  const targets = value.targets.map(parseHydrationTarget);
  const targetIds = targets.map(hydrationTargetId);
  if (reset.workspaceId !== workspaceId || targets.some((target) => target.workspaceId !== workspaceId || target.asOf !== reset.resetBarrier) || new Set(targetIds).size !== targets.length || targetIds.some((targetId, index) => index > 0 && targetIds[index - 1]! >= targetId)) throw new Error("A stored reset plan is inconsistent.");
  return { workspaceId, targetId: RESET_TARGET_ID, pageIndex: -3, kind: "reset", resetId: parseStableId(value.resetId, "A reset ID is invalid."), reset, targets };
}

/** Resets plans. */
function resetPlans(values: unknown[]) {
  return values.filter((value) => isRecord(value) && value.kind === "reset").map(parseStoredResetPlan);
}

/** Parses and validates stored hydration coverage. */
function parseStoredHydrationCoverage(value: unknown): StoredHydrationCoverage {
  if (!isRecord(value)) throw new Error("Stored hydration coverage has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "targetId", "generationId", "target", "memberIds"], "Stored hydration coverage has an unsupported shape.");
  const workspaceId = parseStableId(value.workspaceId, "A hydration workspace ID is invalid.");
  const generationId = parseStableId(value.generationId, "A hydration generation ID is invalid.");
  const target = parseHydrationTarget(value.target);
  if (target.workspaceId !== workspaceId) throw new Error("Stored hydration coverage mixes workspaces.");
  if (!Array.isArray(value.memberIds)) throw new Error("Stored hydration coverage members are invalid.");
  const memberIds = value.memberIds.map((identity) => {
    if (target.kind === "folder-page" || target.kind === "exact-nodes" || target.kind === "ancestry") return parseStableId(identity, "A hydration coverage node ID is invalid.");
    return parseSettingKeyForNamespace(target.namespace, identity).key;
  });
  if (new Set(memberIds).size !== memberIds.length || memberIds.some((identity, index) => index > 0 && compareCanonicalStrings(memberIds[index - 1]!, identity) >= 0)) throw new Error("Stored hydration coverage members are not canonically ordered.");
  const targetId = parseSha256(value.targetId, "A hydration target ID is invalid.");
  if (hydrationTargetId(target) !== targetId) throw new Error("Stored hydration coverage does not match its selector.");
  return { workspaceId, targetId, generationId, target, memberIds };
}

/** Returns the identities available for hydration. */
function available<T>(value: T): CacheQuery<T> {
  return { availability: "available", value };
}

/** Resolves missing exact. */
function resolveMissingExact(proofs: Array<{ asOf: number; kind: "positive" | "negative" }>): CacheQuery<undefined> {
  if (proofs.length === 0) return { availability: "unavailable" };
  const freshest = Math.max(...proofs.map(({ asOf }) => asOf));
  const current = proofs.filter(({ asOf }) => asOf === freshest);
  return current.some(({ kind }) => kind === "positive") ? { availability: "unavailable" }
    : current.some(({ kind }) => kind === "negative") ? available(undefined)
      : { availability: "unavailable" };
}

/** Computes hydration target affected identities. */
function hydrationTargetAffectedIdentities(target: HydrationTarget) {
  switch (target.kind) {
    case "folder-page": return [`folder:${target.workspaceId}:${target.parentId ?? "root"}`];
    case "exact-nodes": return target.nodeIds.map((id) => `node:${target.workspaceId}:${id}`);
    case "ancestry": return [`node:${target.workspaceId}:${target.nodeId}`];
    case "exact-settings": return [...target.keys.map((key) => `setting:${target.workspaceId}:${target.namespace}:${key}`), `setting-namespace:${target.workspaceId}:${target.namespace}`];
    case "setting-namespace": return [`setting-namespace:${target.workspaceId}:${target.namespace}`];
  }
}

/** Computes hydration page identities. */
function hydrationPageIdentities(page: HydrationPageData) {
  return page.target.kind === "folder-page" ? page.nodes.map(({ id }) => id) : page.target.kind === "setting-namespace" ? page.settings.map(({ key }) => key) : [];
}

/** Validates stored hydration generation. */
function validateStoredHydrationGeneration(header: StoredHydrationHeader, pages: StoredHydrationPage[]) {
  if (pages.length !== header.nextPageIndex) throw new Error("Stored hydration page count is inconsistent.");
  let pageToken: string | null = null;
  let lastIdentity: string | null = null;
  const emittedTokens = new Set<string>();
  for (let index = 0; index < pages.length; index += 1) {
    const stored = pages[index]!;
    const page = stored.page;
    if (stored.workspaceId !== header.workspaceId || stored.targetId !== header.targetId || stored.pageIndex !== index || stored.requestPageToken !== pageToken || page.workspaceId !== header.workspaceId || page.deviceId !== header.deviceId || page.generationId !== header.generationId || !equalValues(page.target, header.target)) throw new Error("Stored hydration generation metadata is inconsistent.");
    const identities = hydrationPageIdentities(page);
    if (lastIdentity !== null && identities.length > 0 && compareCanonicalStrings(lastIdentity, identities[0]!) >= 0) throw new Error("Stored hydration records are not ordered across pages.");
    lastIdentity = identities.at(-1) ?? lastIdentity;
    if (page.nextPageToken === null && index !== pages.length - 1) throw new Error("Stored hydration generation completes before its final page.");
    if (page.nextPageToken !== null && emittedTokens.has(page.nextPageToken)) throw new Error("Stored hydration generation contains a token cycle.");
    if (page.nextPageToken !== null) emittedTokens.add(page.nextPageToken);
    pageToken = page.nextPageToken;
  }
  if (header.pageToken !== pageToken || header.complete !== (pageToken === null && pages.length > 0) || header.lastIdentity !== lastIdentity) throw new Error("Stored hydration progress is inconsistent.");
}

/** Validates completed hydration generation. */
async function validateCompletedHydrationGeneration(store: IDBObjectStore, keyRange: typeof IDBKeyRange, header: StoredHydrationHeader) {
  if (!header.complete) return;
  const range = keyRange.bound([header.workspaceId, header.targetId, 0], [header.workspaceId, header.targetId, Number.MAX_SAFE_INTEGER]);
  const pages = (await request(store.getAll(range))).map(parseStoredHydrationPage).sort((left, right) => left.pageIndex - right.pageIndex);
  validateStoredHydrationGeneration(header, pages);
}

/** Parses and validates stored node. */
function parseStoredNode(value: unknown): StoredNode {
  if (!isRecord(value) || typeof value.parentKey !== "string" || typeof value.lifecycleKey !== "string") throw new Error("A stored node has an unsupported shape.");
  const nodeValue = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "parentKey" && key !== "lifecycleKey"));
  const node = parseNode(nodeValue);
  const parentKey = node.parentId ?? "";
  if (value.parentKey !== parentKey || value.lifecycleKey !== node.lifecycle.kind) throw new Error("A stored node has inconsistent index metadata.");
  return { ...node, parentKey, lifecycleKey: node.lifecycle.kind };
}

/** Parses and validates stored node record. */
function parseStoredNodeRecord(value: unknown): StoredNodeRecord {
  if (isRecord(value) && value.purged === true) return parseNodeRecord(value) as Extract<NodeRecord, { purged: true }>;
  return parseStoredNode(value);
}

/** Reports whether a stored node is a purge tombstone. */
function isPurgeTombstone(value: NodeRecord): value is PurgeTombstone {
  return "purged" in value;
}

/** Builds a persisted node record. */
function nodeRecord(value: StoredNode) {
  return parseNode(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "parentKey" && key !== "lifecycleKey")));
}

/** Converts a node to its persisted database record. */
function storeNode(value: Node | StoredNode): StoredNode {
  const node = "parentKey" in value ? nodeRecord(value) : parseNode(value);
  return { ...node, parentKey: node.parentId ?? "", lifecycleKey: node.lifecycle.kind };
}

/** Parses and validates stored manifest. */
function parseStoredManifest(value: unknown): StoredManifest {
  if (!isRecord(value)) throw new Error("A stored manifest has an unsupported shape.");
  assertExactKeys(value, ["hash", "manifest"], "A stored manifest has an unsupported shape.");
  return { hash: parseSha256(value.hash, "A stored manifest hash is invalid."), manifest: parseManifest(value.manifest) };
}

/** Validates stored manifest. */
async function validateStoredManifest(value: unknown, expectedHash?: string) {
  const record = parseStoredManifest(value);
  if (expectedHash !== undefined && record.hash !== expectedHash) throw new Error("Stored manifest identity metadata is inconsistent.");
  if (await canonicalManifestSha256(record.manifest) !== record.hash) throw new Error("A stored manifest hash does not match its canonical bytes.");
  return record;
}

/** Parses and validates intent. */
function parseIntent(value: unknown): OperationIntent {
  if (value !== "forward" && value !== "undo" && value !== "redo" && value !== "restore") throw new Error("An operation intent is invalid.");
  return value;
}

/** Parses and validates string set. */
function parseStringSet(value: unknown, message: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) throw new Error(message);
  const result = value as string[];
  if (new Set(result).size !== result.length) throw new Error(message);
  return result;
}

/** Parses and validates stored IDs. */
function parseStoredIds(value: unknown, message: string, allowEmpty = false, maxItems: number | null = WEB2_MAX_BATCH_ITEMS) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0 || maxItems !== null && value.length > maxItems) throw new Error(message);
  const result = value.map((id) => parseStableId(id, message));
  if (new Set(result).size !== result.length) throw new Error(message);
  return result;
}

/** Reports whether values are in lexical order. */
function isSorted(values: readonly string[]) {
  return values.every((value, index) => index === 0 || values[index - 1]! <= value);
}

/** Parses and validates inverse root. */
function parseInverseRoot(value: unknown, message: string) {
  if (!isRecord(value)) throw new Error(message);
  assertExactKeys(value, ["nodeId", "parentId"], message);
  return { nodeId: parseStableId(value.nodeId, message), parentId: value.parentId === null ? null : parseStableId(value.parentId, message) };
}

/** Parses and validates previous setting. */
function parsePreviousSetting(value: unknown, namespace: SettingNamespace, key: string): PreviousSetting {
  if (!isRecord(value) || typeof value.exists !== "boolean") throw new Error("Stored setting inverse metadata has an unsupported shape.");
  if (!value.exists) {
    assertExactKeys(value, ["exists"], "Stored setting inverse metadata has an unsupported shape.");
    return { exists: false };
  }
  assertExactKeys(value, ["exists", "value"], "Stored setting inverse metadata has an unsupported shape.");
  return { exists: true, value: parseWorkspaceSetting(namespace, key, value.value).value };
}

/** Parses and validates operation inverse. */
function parseOperationInverse(value: unknown): OperationInverse {
  if (!isRecord(value) || typeof value.kind !== "string") throw new Error("Stored operation inverse metadata has an unsupported shape.");
  switch (value.kind) {
    case "create":
      assertExactKeys(value, ["kind", "rootNodeIds"], "Stored operation inverse metadata has an unsupported shape.");
      return { kind: "create", rootNodeIds: parseStoredIds(value.rootNodeIds, "Stored create inverse roots are invalid.") };
    case "copy": {
      assertExactKeys(value, ["kind", "rootNodeIds", "sourceNodeIds", "sourceFileNodeIds"], "Stored operation inverse metadata has an unsupported shape.");
      const rootNodeIds = parseStoredIds(value.rootNodeIds, "Stored copy inverse roots are invalid.");
      const sourceNodeIds = parseStoredIds(value.sourceNodeIds, "Stored copy source node IDs are invalid.");
      const sourceFileNodeIds = parseStoredIds(value.sourceFileNodeIds, "Stored copy source file IDs are invalid.", true);
      if (!isSorted(sourceNodeIds) || !isSorted(sourceFileNodeIds) || sourceFileNodeIds.some((id) => !sourceNodeIds.includes(id))) throw new Error("Stored copy source IDs are invalid.");
      return { kind: "copy", rootNodeIds, sourceNodeIds, sourceFileNodeIds };
    }
    case "write":
      assertExactKeys(value, ["kind", "nodeId", "mimeType", "size", "manifestHash", "modifiedAt"], "Stored operation inverse metadata has an unsupported shape.");
      return { kind: "write", nodeId: parseStableId(value.nodeId, "A stored write inverse node ID is invalid."), mimeType: parseMimeType(value.mimeType, "A stored write inverse MIME type is invalid."), size: parseNonNegativeSafeInteger(value.size, "A stored write inverse size is invalid."), manifestHash: parseSha256(value.manifestHash, "A stored write inverse manifest hash is invalid."), modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt, "A stored write inverse modification time is invalid.") };
    case "rename":
      assertExactKeys(value, ["kind", "nodeId", "name", "modifiedAt"], "Stored operation inverse metadata has an unsupported shape.");
      return { kind: "rename", nodeId: parseStableId(value.nodeId), name: parseCanonicalName(value.name), modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt) };
    case "move": {
      assertExactKeys(value, ["kind", "roots"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored move inverse roots are invalid.");
      const roots = value.roots.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored move inverse roots are invalid.");
        assertExactKeys(candidate, ["nodeId", "parentId", "modifiedAt"], "Stored move inverse roots are invalid.");
        return { nodeId: parseStableId(candidate.nodeId), parentId: candidate.parentId === null ? null : parseStableId(candidate.parentId), modifiedAt: parseNonNegativeSafeInteger(candidate.modifiedAt) };
      });
      if (new Set(roots.map(({ nodeId }) => nodeId)).size !== roots.length) throw new Error("Stored move inverse roots are invalid.");
      return { kind: "move", roots };
    }
    case "transfer": {
      assertExactKeys(value, ["kind", "nodes", "fileNodeIds"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored transfer inverse nodes are invalid.");
      const nodes = value.nodes.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored transfer inverse nodes are invalid.");
        assertExactKeys(candidate, ["nodeId", "parentId", "modifiedAt"], "Stored transfer inverse nodes are invalid.");
        return { nodeId: parseStableId(candidate.nodeId), parentId: candidate.parentId === null ? null : parseStableId(candidate.parentId), modifiedAt: parseNonNegativeSafeInteger(candidate.modifiedAt) };
      });
      const nodeIds = nodes.map(({ nodeId }) => nodeId);
      const fileNodeIds = parseStoredIds(value.fileNodeIds, "Stored transfer inverse file IDs are invalid.", true);
      if (!isSorted(nodeIds) || new Set(nodeIds).size !== nodeIds.length || !isSorted(fileNodeIds) || fileNodeIds.some((id) => !nodeIds.includes(id))) throw new Error("Stored transfer inverse metadata is invalid.");
      return { kind: "transfer", nodes, fileNodeIds };
    }
    case "position": {
      assertExactKeys(value, ["kind", "positions"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.positions) || value.positions.length === 0 || value.positions.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored position inverse metadata is invalid.");
      const positions = value.positions.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored position inverse metadata is invalid.");
        assertExactKeys(candidate, ["nodeId", "position"], "Stored position inverse metadata is invalid.");
        return { nodeId: parseStableId(candidate.nodeId), position: parsePosition(candidate.position) };
      });
      if (new Set(positions.map(({ nodeId }) => nodeId)).size !== positions.length) throw new Error("Stored position inverse metadata is invalid.");
      return { kind: "position", positions };
    }
    case "trash": {
      assertExactKeys(value, ["kind", "roots", "nodeIds"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored Trash inverse roots are invalid.");
      const roots = value.roots.map((candidate) => parseInverseRoot(candidate, "Stored Trash inverse roots are invalid."));
      const nodeIds = parseStoredIds(value.nodeIds, "Stored Trash inverse node IDs are invalid.");
      if (!isSorted(nodeIds) || new Set(roots.map(({ nodeId }) => nodeId)).size !== roots.length || roots.some(({ nodeId }) => !nodeIds.includes(nodeId))) throw new Error("Stored Trash inverse roots are invalid.");
      return { kind: "trash", roots, nodeIds };
    }
    case "restore": {
      assertExactKeys(value, ["kind", "roots", "nodes"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.length > WEB2_MAX_BATCH_ITEMS || !Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored restore inverse metadata is invalid.");
      const roots = value.roots.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored restore inverse roots are invalid.");
        assertExactKeys(candidate, ["nodeId", "parentId", "modifiedAt"], "Stored restore inverse roots are invalid.");
        return { nodeId: parseStableId(candidate.nodeId), parentId: candidate.parentId === null ? null : parseStableId(candidate.parentId), modifiedAt: parseNonNegativeSafeInteger(candidate.modifiedAt) };
      });
      const nodes = value.nodes.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored restore inverse nodes are invalid.");
        assertExactKeys(candidate, ["nodeId", "lifecycle"], "Stored restore inverse nodes are invalid.");
        const lifecycle = parseNodeLifecycle(candidate.lifecycle);
        if (lifecycle.kind !== "trashed") throw new Error("Stored restore inverse nodes are invalid.");
        return { nodeId: parseStableId(candidate.nodeId), lifecycle };
      });
      if (!isSorted(nodes.map(({ nodeId }) => nodeId)) || new Set(roots.map(({ nodeId }) => nodeId)).size !== roots.length || new Set(nodes.map(({ nodeId }) => nodeId)).size !== nodes.length || roots.some(({ nodeId }) => !nodes.some((node) => node.nodeId === nodeId))) throw new Error("Stored restore inverse metadata is invalid.");
      return { kind: "restore", roots, nodes };
    }
    case "purge": {
      assertExactKeys(value, ["kind", "nodeIds", "reason"], "Stored operation inverse metadata has an unsupported shape.");
      if (value.reason !== "Permanent purge cannot be undone.") throw new Error("Stored purge inverse metadata is invalid.");
      const nodeIds = parseStoredIds(value.nodeIds, "Stored purge inverse node IDs are invalid.");
      if (!isSorted(nodeIds)) throw new Error("Stored purge inverse node IDs are invalid.");
      return { kind: "purge", nodeIds, reason: value.reason };
    }
    case "set": {
      assertExactKeys(value, ["kind", "namespace", "key", "previous"], "Stored operation inverse metadata has an unsupported shape.");
      const { namespace, key } = parseSettingKeyForNamespace(value.namespace, value.key);
      return { kind: "set", namespace, key, previous: parsePreviousSetting(value.previous, namespace, key) };
    }
    case "set-many": {
      assertExactKeys(value, ["kind", "namespace", "settings"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.settings) || value.settings.length === 0 || value.settings.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored setting batch inverse metadata is invalid.");
      const namespace = parseSettingNamespace(value.namespace);
      const settings = value.settings.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored setting batch inverse metadata is invalid.");
        assertExactKeys(candidate, ["key", "previous"], "Stored setting batch inverse metadata is invalid.");
        const key = parseSettingKeyForNamespace(namespace, candidate.key).key;
        return { key, previous: parsePreviousSetting(candidate.previous, namespace, key) };
      });
      if (new Set(settings.map(({ key }) => key)).size !== settings.length) throw new Error("Stored setting batch inverse metadata is invalid.");
      return { kind: "set-many", namespace, settings };
    }
    case "unset": {
      assertExactKeys(value, ["kind", "namespace", "key", "previous"], "Stored operation inverse metadata has an unsupported shape.");
      const { namespace, key } = parseSettingKeyForNamespace(value.namespace, value.key);
      return { kind: "unset", namespace, key, previous: parsePreviousSetting(value.previous, namespace, key) };
    }
    case "unset-many": {
      assertExactKeys(value, ["kind", "namespace", "settings"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.settings) || value.settings.length === 0 || value.settings.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored setting batch inverse metadata is invalid.");
      const namespace = parseSettingNamespace(value.namespace);
      const settings = value.settings.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored setting batch inverse metadata is invalid.");
        assertExactKeys(candidate, ["key", "previous"], "Stored setting batch inverse metadata is invalid.");
        const key = parseSettingKeyForNamespace(namespace, candidate.key).key;
        return { key, previous: parsePreviousSetting(candidate.previous, namespace, key) };
      });
      if (new Set(settings.map(({ key }) => key)).size !== settings.length) throw new Error("Stored setting batch inverse metadata is invalid.");
      return { kind: "unset-many", namespace, settings };
    }
    default:
      throw new Error("Stored operation inverse metadata has an unsupported shape.");
  }
}

/** Returns node IDs affected by a version operation. */
function operationVersionNodeIds(operation: LocallyCommittableOperation) {
  if (operation.kind === "create" || operation.kind === "copy") return operation.nodes.filter((node) => node.kind === "file").map(({ id }) => id);
  return operation.kind === "write" ? [operation.nodeId] : [];
}

/** Collects root IDs created by an operation. */
function createdRootIds(operation: Extract<WorkspaceOperation, { kind: "create" | "copy" }>) {
  const ids = new Set(operation.nodes.map(({ id }) => id));
  return operation.nodes.filter(({ parentId }) => parentId === null || !ids.has(parentId)).map(({ id }) => id);
}

/** Reports whether two persisted values are deeply equal. */
function equalValues(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Computes local affected identities. */
function localAffectedIdentities(operation: LocallyCommittableOperation, inverse: OperationInverse) {
  if (operation.kind === "transfer" && inverse.kind === "transfer") {
    const { source, destination } = transferAffectedIdentities(operation, inverse);
    return [...new Set([...source, ...destination])].sort();
  }
  const affected = new Set(operationAffectedIdentities(operation));
  if (operation.kind === "set" || operation.kind === "set-many" || operation.kind === "unset" || operation.kind === "unset-many") affected.add(`setting-namespace:${operation.workspaceId}:${operation.namespace}`);
  const node = (nodeId: string) => affected.add(`node:${operation.workspaceId}:${nodeId}`);
  const content = (nodeId: string) => affected.add(`content:${operation.workspaceId}:${nodeId}`);
  const folder = (parentId: string | null) => affected.add(`folder:${operation.workspaceId}:${parentId ?? "root"}`);
  if (inverse.kind === "copy") {
    inverse.sourceNodeIds.forEach(node);
    inverse.sourceFileNodeIds.forEach(content);
  }
  switch (inverse.kind) {
    case "move":
      for (const root of inverse.roots) { node(root.nodeId); folder(root.parentId); folder(operation.kind === "move" ? operation.parentId : null); }
      break;
    case "trash":
      inverse.nodeIds.forEach(node);
      for (const root of inverse.roots) { folder(root.parentId); folder(null); }
      break;
    case "restore": {
      inverse.nodes.forEach(({ nodeId }) => node(nodeId));
      for (const root of inverse.roots) {
        folder(root.parentId);
        const lifecycle = inverse.nodes.find(({ nodeId }) => nodeId === root.nodeId)!.lifecycle;
        folder(operation.kind === "restore" && operation.destination === "original" ? lifecycle.originalParentId : null);
      }
      break;
    }
    case "purge":
      inverse.nodeIds.forEach(node);
      folder(null);
      break;
  }
  return [...affected].sort();
}

/** Transfers affected identities. */
function transferAffectedIdentities(operation: Extract<LocallyCommittableOperation, { kind: "transfer" }>, inverse: Extract<OperationInverse, { kind: "transfer" }>) {
  const source = new Set<string>();
  const destination = new Set<string>();
  const fileNodeIds = new Set(inverse.fileNodeIds);
  const addNodeIdentities = (affected: Set<string>, workspaceId: string, nodeId: string) => {
    affected.add(`node:${workspaceId}:${nodeId}`);
    affected.add(`${fileNodeIds.has(nodeId) ? "content" : "folder"}:${workspaceId}:${nodeId}`);
  };
  for (const { nodeId } of inverse.nodes) {
    addNodeIdentities(source, operation.workspaceId, nodeId);
    addNodeIdentities(destination, operation.destinationWorkspaceId, nodeId);
  }
  for (const rootId of operation.nodeIds) {
    const root = inverse.nodes.find(({ nodeId }) => nodeId === rootId);
    if (root) source.add(`folder:${operation.workspaceId}:${root.parentId ?? "root"}`);
  }
  destination.add(`folder:${operation.destinationWorkspaceId}:${operation.parentId ?? "root"}`);
  return { source: [...source].sort(), destination: [...destination].sort() };
}

/** Returns change for workspace. */
function changeForWorkspace(stored: StoredOperation, workspaceId: string): ChangeRecord | undefined {
  if (stored.operation.kind === "transfer" && stored.inverse.kind === "transfer") {
    const identities = transferAffectedIdentities(stored.operation, stored.inverse);
    if (workspaceId === stored.workspaceId) return { kind: "operation", workspaceId, revision: stored.localRevision, operationId: stored.operationId, affectedIdentities: identities.source };
    if (workspaceId === stored.operation.destinationWorkspaceId && stored.destinationLocalRevision !== null) return { kind: "operation", workspaceId, revision: stored.destinationLocalRevision, operationId: stored.operationId, affectedIdentities: identities.destination };
    return;
  }
  if (workspaceId !== stored.workspaceId) return;
  return { kind: "operation", workspaceId, revision: stored.localRevision, operationId: stored.operationId, affectedIdentities: stored.affectedIdentities };
}

/** Parses and validates stored operation. */
function parseStoredOperation(value: unknown): StoredOperation {
  if (!isRecord(value)) throw new Error("A stored operation has an unsupported shape.");
  const baseKeys = ["operationId", "workspaceId", "localRevision", "destinationLocalRevision", "stateKind", "overlayKind", "intent", "compensatesOperationId", "expectedContentTuple", "operation", "inverse", "affectedIdentities", "versionNodeIds"];
  if (value.stateKind !== "pending" && value.stateKind !== "accepted" && value.stateKind !== "rejected") throw new Error("A stored operation state is invalid.");
  assertExactKeys(value, value.stateKind === "rejected" ? [...baseKeys, "rejection"] : baseKeys, "A stored operation has an unsupported shape.");
  if (value.overlayKind !== "active" && value.overlayKind !== "deferred" && value.overlayKind !== "discarded") throw new Error("A stored operation overlay state is invalid.");
  const operation = parseWorkspaceOperation(value.operation);
  const base: StoredOperationBase = {
    operationId: parseStableId(value.operationId, "A stored operation ID is invalid."),
    workspaceId: parseStableId(value.workspaceId, "A stored operation workspace ID is invalid."),
    localRevision: parsePositiveSafeInteger(value.localRevision, "A stored operation revision is invalid."),
    destinationLocalRevision: value.destinationLocalRevision === null ? null : parsePositiveSafeInteger(value.destinationLocalRevision, "A stored destination operation revision is invalid."),
    overlayKind: value.overlayKind as StoredOperation["overlayKind"],
    intent: parseIntent(value.intent),
    compensatesOperationId: value.compensatesOperationId === null ? null : parseStableId(value.compensatesOperationId, "A compensated operation ID is invalid."),
    expectedContentTuple: value.expectedContentTuple === null ? null : parseOperationTuple(value.expectedContentTuple),
    operation,
    inverse: parseOperationInverse(value.inverse),
    affectedIdentities: parseStringSet(value.affectedIdentities, "Stored operation identities are invalid."),
    versionNodeIds: parseStringSet(value.versionNodeIds, "Stored operation version node IDs are invalid.").map((id) => parseStableId(id, "A stored operation version node ID is invalid.")),
  };
  let stored: StoredOperation;
  if (value.stateKind === "rejected") {
    if (!isRecord(value.rejection)) throw new Error("A stored operation rejection has an unsupported shape.");
    assertExactKeys(value.rejection, ["code", "message"], "A stored operation rejection has an unsupported shape.");
    if (typeof value.rejection.code !== "string" || !value.rejection.code || value.rejection.code.length > 128 || typeof value.rejection.message !== "string" || !value.rejection.message || value.rejection.message.length > 1024) throw new Error("A stored operation rejection is invalid.");
    stored = { ...base, stateKind: "rejected", rejection: { code: value.rejection.code, message: value.rejection.message } };
  } else {
    stored = { ...base, stateKind: value.stateKind };
  }
  if (stored.operationId !== operation.operationId || stored.workspaceId !== operation.workspaceId) throw new Error("Stored operation identity metadata is inconsistent.");
  if (operation.kind === "transfer" && stored.destinationLocalRevision === null || operation.kind !== "transfer" && stored.destinationLocalRevision !== null) throw new Error("Stored operation destination revision metadata is inconsistent.");
  if (stored.intent === "forward" && stored.compensatesOperationId !== null || stored.intent !== "forward" && stored.compensatesOperationId === null) throw new Error("Stored operation compensation metadata is inconsistent.");
  if (operation.kind === "write" && stored.expectedContentTuple === null || operation.kind !== "write" && stored.expectedContentTuple !== null) throw new Error("Stored operation expectation metadata is inconsistent.");
  const lifecycleCompensation = operation.kind === "trash" && stored.intent === "undo" || operation.kind === "restore" && stored.intent === "redo";
  if (operation.kind !== "write" && stored.intent !== "forward" && !lifecycleCompensation) throw new Error("Stored operation intent is unsupported for metadata projection.");
  if (!equalValues(stored.affectedIdentities, localAffectedIdentities(operation, stored.inverse)) || !equalValues(stored.versionNodeIds, operationVersionNodeIds(operation))) throw new Error("Stored operation derived metadata is inconsistent.");
  switch (operation.kind) {
    case "create":
      if (stored.inverse.kind !== "create" || !equalValues(stored.inverse.rootNodeIds, createdRootIds(operation))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "copy": {
      const inverse = stored.inverse;
      if (inverse.kind !== "copy" || !equalValues(inverse.rootNodeIds, createdRootIds(operation)) || inverse.sourceNodeIds.length !== operation.nodes.length || inverse.sourceFileNodeIds.length !== operation.nodes.filter(({ kind }) => kind === "file").length || !operation.sourceNodeIds.every((id) => inverse.sourceNodeIds.includes(id)) || inverse.sourceNodeIds.some((id) => operation.nodes.some((node) => node.id === id))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    }
    case "write":
      if (stored.inverse.kind !== "write" || stored.inverse.nodeId !== operation.nodeId) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "rename":
      if (stored.inverse.kind !== "rename" || stored.inverse.nodeId !== operation.nodeId) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "move":
      if (stored.inverse.kind !== "move" || !equalValues(stored.inverse.roots.map(({ nodeId }) => nodeId), operation.nodeIds)) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "transfer": {
      const inverse = stored.inverse;
      if (inverse.kind !== "transfer" || operation.nodeIds.some((nodeId) => !inverse.nodes.some((node) => node.nodeId === nodeId))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    }
    case "position":
      if (stored.inverse.kind !== "position" || !equalValues(stored.inverse.positions.map(({ nodeId }) => nodeId), operation.positions.map(({ nodeId }) => nodeId))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "trash": {
      if (stored.inverse.kind !== "trash") throw new Error("Stored operation inverse metadata is inconsistent.");
      const inverse = stored.inverse;
      if (inverse.roots.some(({ nodeId }) => !operation.nodeIds.includes(nodeId)) || operation.nodeIds.some((nodeId) => !inverse.nodeIds.includes(nodeId))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    }
    case "restore":
      if (stored.inverse.kind !== "restore" || !equalValues(stored.inverse.roots.map(({ nodeId }) => nodeId), operation.nodeIds)) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "purge": {
      if (stored.inverse.kind !== "purge") throw new Error("Stored operation inverse metadata is inconsistent.");
      const inverse = stored.inverse;
      if (operation.nodeIds.some((nodeId) => !inverse.nodeIds.includes(nodeId))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    }
    case "set":
      if (stored.inverse.kind !== "set" || stored.inverse.namespace !== operation.namespace || stored.inverse.key !== operation.key) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "set-many":
      if (stored.inverse.kind !== "set-many" || stored.inverse.namespace !== operation.namespace || !equalValues(stored.inverse.settings.map(({ key }) => key), operation.settings.map(({ key }) => key))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "unset":
      if (stored.inverse.kind !== "unset" || stored.inverse.namespace !== operation.namespace || stored.inverse.key !== operation.key) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "unset-many":
      if (stored.inverse.kind !== "unset-many" || stored.inverse.namespace !== operation.namespace || !equalValues(stored.inverse.settings.map(({ key }) => key), operation.keys)) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
  }
  return stored;
}

/** Parses and validates change record. */
function parseChangeRecord(value: unknown): ChangeRecord {
  if (!isRecord(value) || value.kind !== "operation" && value.kind !== "hydration" && value.kind !== "pull" && value.kind !== "reset") throw new Error("A stored change record has an unsupported shape.");
  assertExactKeys(value, value.kind === "hydration" ? ["kind", "workspaceId", "revision", "operationId", "targetId", "affectedIdentities"] : value.kind === "pull" ? ["kind", "workspaceId", "revision", "operationId", "fromCursor", "cursor", "affectedIdentities"] : value.kind === "reset" ? ["kind", "workspaceId", "revision", "operationId", "fromCursor", "cursor", "headSequence", "snapshotBarrier", "logFloor", "observedLogicalTime", "affectedIdentities"] : ["kind", "workspaceId", "revision", "operationId", "affectedIdentities"], "A stored change record has an unsupported shape.");
  const base = {
    kind: value.kind,
    workspaceId: parseStableId(value.workspaceId, "A stored change workspace ID is invalid."),
    revision: parsePositiveSafeInteger(value.revision, "A stored change revision is invalid."),
    operationId: parseStableId(value.operationId, "A stored change operation ID is invalid."),
    affectedIdentities: parseStringSet(value.affectedIdentities, "Stored change identities are invalid."),
  };
  if (value.kind === "hydration") return { ...base, kind: "hydration", targetId: parseSha256(value.targetId, "A stored hydration change target ID is invalid.") };
  if (value.kind === "pull") {
    const fromCursor = parseNonNegativeSafeInteger(value.fromCursor, "A stored pull cursor is invalid.");
    const cursor = parsePositiveSafeInteger(value.cursor, "A stored pull cursor is invalid.");
    if (cursor <= fromCursor) throw new Error("A stored pull cursor range is invalid.");
    return { ...base, kind: "pull", fromCursor, cursor };
  }
  if (value.kind === "reset") {
    const fromCursor = parseNonNegativeSafeInteger(value.fromCursor, "A stored reset cursor is invalid.");
    const cursor = parsePositiveSafeInteger(value.cursor, "A stored reset cursor is invalid.");
    const headSequence = parseNonNegativeSafeInteger(value.headSequence, "A stored reset head is invalid.");
    const snapshotBarrier = parseNonNegativeSafeInteger(value.snapshotBarrier, "A stored reset snapshot barrier is invalid.");
    const logFloor = parseNonNegativeSafeInteger(value.logFloor, "A stored reset log floor is invalid.");
    const observedLogicalTime = parseNonNegativeSafeInteger(value.observedLogicalTime, "A stored reset observed logical time is invalid.");
    if (fromCursor >= logFloor || cursor !== snapshotBarrier || cursor > headSequence || logFloor > snapshotBarrier) throw new Error("A stored reset change is inconsistent.");
    return { ...base, kind: "reset", fromCursor, cursor, headSequence, snapshotBarrier, logFloor, observedLogicalTime };
  }
  return { ...base, kind: "operation" };
}

/** Determines whether two IndexedDB key paths match. */
function sameKeyPath(left: string | string[] | null, right: string | readonly string[]) {
  return equalValues(left, right);
}

/** Validates the IndexedDB store schema. */
function validateSchema(db: IDBDatabase) {
  if (db.version !== DATABASE_VERSION || !equalValues([...db.objectStoreNames], [...STORES].sort())) throw new Error("The filesystem database schema is malformed.");
  const transaction = db.transaction([...STORES], "readonly");
  for (const name of STORES) {
    const store = transaction.objectStore(name);
    const expected = STORE_SCHEMA[name];
    if (store.autoIncrement || !sameKeyPath(store.keyPath, expected.keyPath) || !equalValues([...store.indexNames], Object.keys(expected.indexes).sort())) throw new Error("The filesystem database schema is malformed.");
    for (const [indexName, indexSchema] of Object.entries(expected.indexes)) {
      const index = store.index(indexName);
      const multiEntry = "multiEntry" in indexSchema ? indexSchema.multiEntry : false;
      if (!sameKeyPath(index.keyPath, indexSchema.keyPath) || index.unique !== indexSchema.unique || index.multiEntry !== multiEntry) throw new Error("The filesystem database schema is malformed.");
    }
  }
}

/** Creates the IndexedDB store schema. */
function createSchema(db: IDBDatabase) {
  db.createObjectStore("workspaces", { keyPath: "id" });
  const nodes = db.createObjectStore("nodes", { keyPath: "id" });
  nodes.createIndex("by-workspace-parent-lifecycle", ["workspaceId", "parentKey", "lifecycleKey"]);
  nodes.createIndex("by-workspace-lifecycle", ["workspaceId", "lifecycleKey"]);
  db.createObjectStore("manifests", { keyPath: "hash" });
  const operations = db.createObjectStore("operations", { keyPath: "operationId" });
  operations.createIndex("by-workspace-revision", ["workspaceId", "localRevision"], { unique: true });
  operations.createIndex("by-workspace-state-revision", ["workspaceId", "stateKind", "localRevision"]);
  const changes = db.createObjectStore("changes", { keyPath: ["workspaceId", "revision"] });
  changes.createIndex("by-operation-id", "operationId");
  db.createObjectStore("sync", { keyPath: "workspaceId" });
  db.createObjectStore("settings", { keyPath: ["workspaceId", "namespace", "key"] });
  const hydrationPages = db.createObjectStore("hydration-pages", { keyPath: ["workspaceId", "targetId", "pageIndex"] });
  hydrationPages.createIndex("by-workspace-kind", ["workspaceId", "kind"]);
  const hydrationCoverage = db.createObjectStore("hydration-coverage", { keyPath: ["workspaceId", "targetId"] });
  hydrationCoverage.createIndex("by-workspace-as-of", ["workspaceId", "target.asOf", "targetId"], { unique: true });
  hydrationCoverage.createIndex("by-member", "memberIds", { multiEntry: true });
  hydrationCoverage.createIndex("by-exact-node", "target.nodeIds", { multiEntry: true });
  hydrationCoverage.createIndex("by-ancestry-node", "target.nodeId");
  hydrationCoverage.createIndex("by-workspace-kind-namespace", ["workspaceId", "target.kind", "target.namespace"]);
  db.createObjectStore("window-sessions", { keyPath: "workspaceId" });
  db.createObjectStore("device-preferences", { keyPath: "id" });
  db.createObjectStore("installed-apps", { keyPath: "appId" });
  const appStorage = db.createObjectStore("app-storage", { keyPath: ["appId", "key"] });
  appStorage.createIndex("appId", "appId");
  const fileAssociations = db.createObjectStore("file-associations", { keyPath: "matcher" });
  fileAssociations.createIndex("appId", "appId");
  db.createObjectStore("account-apps", { keyPath: "id" });
  const accountAppOutbox = db.createObjectStore("account-app-outbox", { keyPath: "sequence" });
  accountAppOutbox.createIndex("operationId", "operationId", { unique: true });
  db.createObjectStore("account-app-client-state", { keyPath: "id" });
}

/** Opens database. */
function openDatabase(factory: IDBFactory, name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(name, DATABASE_VERSION);
    let settled = false;
    let upgradeError: unknown;
    open.onupgradeneeded = (event) => {
      try {
        if (event.oldVersion !== 0) throw new Error("The filesystem database schema cannot be upgraded in place.");
        createSchema(open.result);
      } catch (error) {
        upgradeError = error;
        open.transaction?.abort();
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      if (settled) { db.close(); return; }
      try {
        validateSchema(db);
      } catch (error) {
        settled = true;
        db.close();
        reject(error);
        return;
      }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => {
      if (settled) return;
      settled = true;
      reject(upgradeError ?? open.error ?? new Error("The filesystem database could not be opened."));
    };
    open.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("The filesystem database is open in another tab with an incompatible version."));
    };
  });
}

/** Computes filesystem database name. */
export async function filesystemDatabaseName(storageId: string) {
  return `${WEB2_INDEXED_DB_PREFIX}${await storageNamespaceHash(storageId)}`;
}

/** Increments a safe integer without exceeding its maximum. */
function nextSafeInteger(value: number, message: string) {
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error(message);
  return value + 1;
}

/** Normalizes commit input. */
async function normalizeCommitInput(value: CommitOperationInput) {
  if (!isRecord(value) || !("operation" in value) || Object.keys(value).some((key) => !["operation", "manifests", "intent", "compensatesOperationId", "expectedContentTuple"].includes(key))) throw new Error("A filesystem commit has an unsupported shape.");
  if (!isRecord(value.operation) || Object.prototype.hasOwnProperty.call(value.operation, "logicalTime")) throw new Error("An operation draft must not supply a logical time.");
  const operation = parseWorkspaceOperation({ ...value.operation, logicalTime: 0 });
  const manifestValues = value.manifests ?? [];
  if (!Array.isArray(manifestValues) || manifestValues.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A commit manifest batch is invalid.");
  const manifests = await Promise.all(manifestValues.map(async (candidate): Promise<StoredManifest> => {
    if (!isRecord(candidate)) throw new Error("A commit manifest has an unsupported shape.");
    assertExactKeys(candidate, ["hash", "manifest"], "A commit manifest has an unsupported shape.");
    const record = { hash: parseSha256(candidate.hash, "A commit manifest hash is invalid."), manifest: parseManifest(candidate.manifest) };
    if (await canonicalManifestSha256(record.manifest) !== record.hash) throw new Error("A manifest hash does not match its canonical bytes.");
    return record;
  }));
  if (new Set(manifests.map(({ hash }) => hash)).size !== manifests.length) throw new Error("A commit manifest batch contains duplicate hashes.");
  const referencedHashes = new Set(manifestHashes(operation));
  if (manifests.some(({ hash }) => !referencedHashes.has(hash))) throw new Error("A commit includes an unreferenced manifest.");
  if (operation.kind !== "create" && operation.kind !== "write" && manifests.length > 0) throw new Error("Metadata operations cannot include manifests.");
  const intent = parseIntent(value.intent ?? "forward");
  const compensatesOperationId = value.compensatesOperationId === undefined || value.compensatesOperationId === null ? null : parseStableId(value.compensatesOperationId, "A compensated operation ID is invalid.");
  const expectedContentTuple = value.expectedContentTuple === undefined || value.expectedContentTuple === null ? null : parseOperationTuple(value.expectedContentTuple);
  if (intent === "forward" && compensatesOperationId !== null) throw new Error("A forward operation cannot compensate another operation.");
  if (intent !== "forward" && compensatesOperationId === null) throw new Error("A compensating operation must reference an existing operation.");
  if (operation.kind === "write" && expectedContentTuple === null) throw new Error("A write requires an exact expected content tuple.");
  if (operation.kind !== "write" && expectedContentTuple !== null) throw new Error("Metadata operations cannot use a content expectation.");
  const lifecycleCompensation = operation.kind === "trash" && intent === "undo" || operation.kind === "restore" && intent === "redo";
  if (operation.kind !== "write" && intent !== "forward" && !lifecycleCompensation) throw new Error("That metadata operation intent is unsupported.");
  return {
    operation,
    manifests,
    intent,
    compensatesOperationId,
    expectedContentTuple,
  };
}

/** Replays operation. */
function replayOperation(operation: LocallyCommittableOperation) {
  return { ...operation, logicalTime: 0 };
}

/** Reports whether a manifest contains the expected hashes. */
function manifestHashes(operation: LocallyCommittableOperation) {
  if (operation.kind === "create" || operation.kind === "copy") return [...new Set(operation.nodes.filter((node) => node.kind === "file").map(({ manifestHash }) => manifestHash))];
  return operation.kind === "write" ? [operation.manifestHash] : [];
}

/** Reports whether a stored manifest contains the expected hashes. */
function storedManifestHashes(stored: StoredOperation) {
  const hashes = manifestHashes(stored.operation);
  if (stored.inverse.kind === "write") hashes.push(stored.inverse.manifestHash);
  return hashes;
}

/** Computes operation tuple. */
function operationTuple(stored: StoredOperation) {
  return { logicalTime: stored.operation.logicalTime, operationId: stored.operationId };
}

/** Reports whether an operation tuple supersedes the current tuple. */
function tupleApplies(incoming: OperationTuple, current: OperationTuple, missing = false) {
  const compared = compareOperationTuples(incoming, current);
  return compared > 0 || missing && compared === 0;
}

/** Replays pending operation. */
function replayPendingOperation(projection: Map<string, NodeRecord>, projectedSettings: Map<string, Setting>, currentSettings: Map<string, Setting>, coveredNodeIds: Set<string>, hierarchyNodes: Set<string>, siblingNodes: Set<string>, deferredOperations: Set<string>, stored: StoredOperation) {
  if (stored.overlayKind !== "active") return;
  const operation = stored.operation;
  const tuple = operationTuple(stored);
  const node = (id: string) => projection.get(id);
  const put = (value: Node) => projection.set(value.id, parseNode(value));
  const active = (id: string) => {
    const value = node(id);
    return value && !isPurgeTombstone(value) && value.lifecycle.kind === "active" && value.workspaceId === operation.workspaceId ? value : undefined;
  };
  switch (operation.kind) {
    case "create":
    case "copy":
      for (const created of operation.nodes) {
        const existing = projection.get(created.id);
        if (existing) continue;
        put({ ...created, workspaceId: operation.workspaceId, lifecycle: { kind: "active" }, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: created.kind === "file" ? tuple : null } });
        hierarchyNodes.add(created.id);
        siblingNodes.add(created.id);
      }
      break;
    case "write": {
      const missing = !projection.has(operation.nodeId);
      const value = active(operation.nodeId);
      if (value?.kind === "file" && tupleApplies(tuple, value.fieldTuples.content!, missing)) put({ ...value, mimeType: operation.mimeType, size: operation.size, manifestHash: operation.manifestHash, modifiedAt: Math.max(value.modifiedAt, operation.modifiedAt), fieldTuples: { ...value.fieldTuples, content: tuple } });
      break;
    }
    case "rename": {
      const missing = !projection.has(operation.nodeId);
      const value = active(operation.nodeId);
      if (value && tupleApplies(tuple, value.fieldTuples.name, missing)) {
        put({ ...value, name: operation.name, modifiedAt: Math.max(value.modifiedAt, operation.modifiedAt), fieldTuples: { ...value.fieldTuples, name: tuple } });
        siblingNodes.add(value.id);
      }
      break;
    }
    case "move": {
      const values = operation.nodeIds.map((id) => ({ id, value: active(id), missing: !projection.has(id) }));
      for (const { id, value, missing } of values) {
        const remoteWins = !value || compareOperationTuples(tuple, value.fieldTuples.parent) < 0 || coveredNodeIds.has(id) && compareOperationTuples(tuple, value.fieldTuples.parent) === 0 && value.parentId !== operation.parentId;
        if (remoteWins) {
          if (coveredNodeIds.has(id)) continue;
          throw new Error("Hydration requires complete coverage to merge a pending move.");
        }
        if (!tupleApplies(tuple, value.fieldTuples.parent, missing)) continue;
        put({ ...value, parentId: operation.parentId, modifiedAt: Math.max(value.modifiedAt, operation.modifiedAt), fieldTuples: { ...value.fieldTuples, parent: tuple } });
        hierarchyNodes.add(value.id);
        siblingNodes.add(value.id);
      }
      break;
    }
    case "position":
      for (const change of operation.positions) {
        const missing = !projection.has(change.nodeId);
        const value = active(change.nodeId);
        if (value && tupleApplies(tuple, value.fieldTuples.position, missing)) put({ ...value, position: change.position, fieldTuples: { ...value.fieldTuples, position: tuple } });
      }
      break;
    case "transfer": {
      if (stored.inverse.kind !== "transfer") throw new Error("Stored transfer overlay metadata is inconsistent.");
      const roots = new Set(operation.nodeIds);
      const values = stored.inverse.nodes.map(({ nodeId }) => {
        const candidate = node(nodeId);
        const value = candidate && !isPurgeTombstone(candidate) && candidate.lifecycle.kind === "active" && (candidate.workspaceId === operation.workspaceId || candidate.workspaceId === operation.destinationWorkspaceId) ? candidate : undefined;
        return { id: nodeId, value, missing: !projection.has(nodeId) };
      });
      const inverseById = new Map(stored.inverse.nodes.map((value) => [value.nodeId, value]));
      const byRoot = new Map<string, typeof values>();
      for (const value of values) {
        let rootId = value.id;
        const seen = new Set<string>();
        while (!roots.has(rootId)) {
          if (seen.has(rootId)) throw new Error("Stored transfer overlay hierarchy is cyclic.");
          seen.add(rootId);
          const parentId = inverseById.get(rootId)?.parentId;
          if (parentId === null || parentId === undefined || !inverseById.has(parentId)) throw new Error("Stored transfer overlay hierarchy is incomplete.");
          rootId = parentId;
        }
        const group = byRoot.get(rootId) ?? [];
        group.push(value);
        byRoot.set(rootId, group);
      }
      for (const group of byRoot.values()) {
        const remoteWins = group.some(({ id, value }) => !value || compareOperationTuples(tuple, value.fieldTuples.parent) < 0 || coveredNodeIds.has(id) && compareOperationTuples(tuple, value.fieldTuples.parent) === 0 && (value.workspaceId !== operation.destinationWorkspaceId || roots.has(id) && value.parentId !== operation.parentId));
        if (remoteWins) {
          if (group.every(({ id }) => coveredNodeIds.has(id))) continue;
          throw new Error("Hydration requires complete coverage to merge a pending transfer.");
        }
        for (const { value, missing } of group) if (tupleApplies(tuple, value!.fieldTuples.parent, missing)) {
          put({ ...value!, workspaceId: operation.destinationWorkspaceId, parentId: roots.has(value!.id) ? operation.parentId : value!.parentId, modifiedAt: Math.max(value!.modifiedAt, operation.modifiedAt), fieldTuples: { ...value!.fieldTuples, parent: tuple } });
          hierarchyNodes.add(value!.id);
          siblingNodes.add(value!.id);
        }
      }
      break;
    }
    case "trash": {
      if (stored.inverse.kind !== "trash") throw new Error("Stored Trash overlay metadata is inconsistent.");
      const roots = new Set(stored.inverse.roots.map(({ nodeId }) => nodeId));
      const values = stored.inverse.nodeIds.map((id) => {
        const candidate = node(id);
        return { id, value: candidate && candidate.workspaceId === operation.workspaceId ? candidate : undefined, missing: !projection.has(id) };
      });
      const remoteWins = values.some(({ id, value }) => !value || isPurgeTombstone(value) || compareOperationTuples(tuple, value.fieldTuples.lifecycle) < 0 || roots.has(id) && compareOperationTuples(tuple, value.fieldTuples.parent) < 0 || coveredNodeIds.has(id) && compareOperationTuples(tuple, value.fieldTuples.lifecycle) === 0 && (value.lifecycle.kind !== "trashed" || roots.has(id) && value.parentId !== null));
      if (remoteWins) {
        if (values.every(({ id }) => coveredNodeIds.has(id))) { deferredOperations.add(stored.operationId); break; }
        throw new Error("Hydration requires complete coverage to defer a pending Trash operation.");
      }
      for (const { value: candidate, missing } of values) {
        const value = candidate as Node;
        if (value.lifecycle.kind === "trashed" && compareOperationTuples(tuple, value.fieldTuples.lifecycle) === 0) { if (missing) put(value); continue; }
        if (!tupleApplies(tuple, value.fieldTuples.lifecycle, missing)) continue;
        put({ ...value, parentId: roots.has(value.id) ? null : value.parentId, lifecycle: { kind: "trashed", trashedAt: operation.trashedAt, originalParentId: value.parentId }, fieldTuples: { ...value.fieldTuples, parent: roots.has(value.id) ? tuple : value.fieldTuples.parent, lifecycle: tuple } });
        hierarchyNodes.add(value.id);
      }
      break;
    }
    case "restore": {
      if (stored.inverse.kind !== "restore") throw new Error("Stored restore overlay metadata is inconsistent.");
      const inverse = stored.inverse;
      const roots = new Set(operation.nodeIds);
      const values = inverse.nodes.map(({ nodeId }) => {
        const candidate = node(nodeId);
        return { id: nodeId, value: candidate && candidate.workspaceId === operation.workspaceId ? candidate : undefined, missing: !projection.has(nodeId) };
      });
      const remoteWins = values.some(({ id, value }) => !value || isPurgeTombstone(value) || compareOperationTuples(tuple, value.fieldTuples.lifecycle) < 0 || roots.has(id) && compareOperationTuples(tuple, value.fieldTuples.parent) < 0 || coveredNodeIds.has(id) && compareOperationTuples(tuple, value.fieldTuples.lifecycle) === 0 && (value.lifecycle.kind !== "active" || roots.has(id) && value.parentId !== (operation.destination === "original" ? inverse.nodes.find((candidate) => candidate.nodeId === id)!.lifecycle.originalParentId : null)));
      if (remoteWins) {
        if (values.every(({ id }) => coveredNodeIds.has(id))) { deferredOperations.add(stored.operationId); break; }
        throw new Error("Hydration requires complete coverage to defer a pending restore.");
      }
      for (let index = 0; index < values.length; index += 1) {
        const { value: candidate, missing } = values[index]!;
        const value = candidate as Node;
        if (value.lifecycle.kind === "active" && compareOperationTuples(tuple, value.fieldTuples.lifecycle) === 0) { if (missing) put(value); continue; }
        if (!tupleApplies(tuple, value.fieldTuples.lifecycle, missing)) continue;
        if (value.lifecycle.kind !== "trashed") continue;
        const root = roots.has(value.id);
        const lifecycle = inverse.nodes[index]!.lifecycle;
        put({ ...value, parentId: root ? operation.destination === "original" ? lifecycle.originalParentId : null : value.parentId, lifecycle: { kind: "active" }, modifiedAt: root ? operation.modifiedAt : value.modifiedAt, fieldTuples: { ...value.fieldTuples, parent: root ? tuple : value.fieldTuples.parent, lifecycle: tuple } });
        hierarchyNodes.add(value.id);
        siblingNodes.add(value.id);
      }
      break;
    }
    case "purge":
      if (stored.inverse.kind !== "purge") throw new Error("Stored purge overlay metadata is inconsistent.");
      for (const id of stored.inverse.nodeIds) {
        const value = projection.get(id);
        if (value && value.workspaceId !== operation.workspaceId) continue;
        if (!value || !isPurgeTombstone(value) || tupleApplies(tuple, { logicalTime: value.logicalTime, operationId: value.operationId })) {
        projection.set(id, { workspaceId: operation.workspaceId, id, purged: true, ...tuple });
      }
      }
      break;
    case "set":
    case "unset": {
      const key = `${operation.workspaceId}\0${operation.namespace}\0${operation.key}`;
      const projected = projectedSettings.get(key);
      const existing = projected ?? currentSettings.get(key);
      if (!existing || tupleApplies(tuple, { logicalTime: existing.logicalTime, operationId: existing.operationId }, projected === undefined)) projectedSettings.set(key, operation.kind === "set" ? { workspaceId: operation.workspaceId, namespace: operation.namespace, key: operation.key, deleted: false, value: operation.value, ...tuple } : { workspaceId: operation.workspaceId, namespace: operation.namespace, key: operation.key, deleted: true, ...tuple });
      break;
    }
    case "set-many":
      for (const setting of operation.settings) {
        const key = `${operation.workspaceId}\0${operation.namespace}\0${setting.key}`;
        const projected = projectedSettings.get(key);
        const existing = projected ?? currentSettings.get(key);
        if (!existing || tupleApplies(tuple, { logicalTime: existing.logicalTime, operationId: existing.operationId }, projected === undefined)) projectedSettings.set(key, { workspaceId: operation.workspaceId, namespace: operation.namespace, key: setting.key, deleted: false, value: setting.value, ...tuple });
      }
      break;
    case "unset-many":
      for (const settingKey of operation.keys) {
        const key = `${operation.workspaceId}\0${operation.namespace}\0${settingKey}`;
        const projected = projectedSettings.get(key);
        const existing = projected ?? currentSettings.get(key);
        if (!existing || tupleApplies(tuple, { logicalTime: existing.logicalTime, operationId: existing.operationId }, projected === undefined)) projectedSettings.set(key, { workspaceId: operation.workspaceId, namespace: operation.namespace, key: settingKey, deleted: true, ...tuple });
      }
      break;
  }
}

/** Validates projected nodes. */
function validateProjectedNodes(records: Map<string, NodeRecord>, authoritativeIds: Set<string>, overlayIds: Set<string>, completeSiblingIds: Set<string>, allowAuthoritativePurgeParent: boolean) {
  for (const id of new Set([...overlayIds, ...completeSiblingIds])) {
    const record = records.get(id);
    if (!record || isPurgeTombstone(record) || record.lifecycle.kind !== "active") continue;
    if ([...records.values()].some((candidate) => candidate.id !== record.id && !isPurgeTombstone(candidate) && candidate.lifecycle.kind === "active" && candidate.workspaceId === record.workspaceId && candidate.parentId === record.parentId && canonicalNameKey(candidate.name) === canonicalNameKey(record.name))) throw new Error("Hydration overlays create duplicate active sibling names.");
  }
  for (const id of new Set([...authoritativeIds, ...overlayIds])) {
    const record = records.get(id);
    if (!record) continue;
    if (isPurgeTombstone(record)) continue;
    const seen = new Set([record.id]);
    let current = record;
    for (let depth = 0; current.parentId !== null; depth += 1) {
      if (depth >= WEB2_MAX_ANCESTRY_DEPTH) throw new Error("Hydration overlays create a hierarchy that is too deep.");
      const parent = records.get(current.parentId);
      if (!parent) {
        if (overlayIds.has(record.id)) throw new Error("Hydration overlays create an invalid hierarchy.");
        break;
      }
      if (!overlayIds.has(record.id) && !(authoritativeIds.has(current.id) && authoritativeIds.has(parent.id))) break;
      if (isPurgeTombstone(parent)) {
        if (allowAuthoritativePurgeParent && !overlayIds.has(record.id) && authoritativeIds.has(current.id) && authoritativeIds.has(parent.id)) break;
        throw new Error("Hydration overlays create an invalid hierarchy.");
      }
      if (parent.workspaceId !== current.workspaceId || parent.kind !== "folder" || parent.lifecycle.kind !== current.lifecycle.kind || seen.has(parent.id)) throw new Error("Hydration overlays create an invalid hierarchy.");
      seen.add(parent.id);
      current = parent;
    }
  }
}

/** Merges cross workspace node. */
function mergeCrossWorkspaceNode(remote: Node, current: Node) {
  if (remote.id !== current.id || remote.kind !== current.kind || remote.createdAt !== current.createdAt) throw new Error("Hydration changes immutable node metadata.");
  const currentParentWins = compareOperationTuples(current.fieldTuples.parent, remote.fieldTuples.parent) > 0;
  const currentLifecycleWins = compareOperationTuples(current.fieldTuples.lifecycle, remote.fieldTuples.lifecycle) > 0;
  const lifecycleDiffers = !equalValues(current.lifecycle, remote.lifecycle);
  if (currentParentWins !== currentLifecycleWins && lifecycleDiffers) throw new Error("Hydration conflicts with newer cross-workspace structure.");
  const base = currentParentWins ? current : remote;
  const lifecycle = currentLifecycleWins ? current : remote;
  const name = compareOperationTuples(current.fieldTuples.name, remote.fieldTuples.name) > 0 ? current : remote;
  const position = compareOperationTuples(current.fieldTuples.position, remote.fieldTuples.position) > 0 ? current : remote;
  if (base.kind === "folder" || remote.kind === "folder" || current.kind === "folder") return parseNode({ ...base, lifecycle: lifecycle.lifecycle, name: name.name, position: position.position, modifiedAt: Math.max(remote.modifiedAt, current.modifiedAt), fieldTuples: { ...base.fieldTuples, lifecycle: lifecycle.fieldTuples.lifecycle, name: name.fieldTuples.name, position: position.fieldTuples.position } });
  const content = compareOperationTuples(current.fieldTuples.content!, remote.fieldTuples.content!) > 0 ? current : remote;
  return parseNode({ ...base, lifecycle: lifecycle.lifecycle, name: name.name, position: position.position, mimeType: content.mimeType, size: content.size, manifestHash: content.manifestHash, modifiedAt: Math.max(remote.modifiedAt, current.modifiedAt), fieldTuples: { ...base.fieldTuples, lifecycle: lifecycle.fieldTuples.lifecycle, name: name.fieldTuples.name, position: position.fieldTuples.position, content: content.fieldTuples.content } });
}

/** Merges pulled node. */
function mergePulledNode(remote: NodeRecord, current: NodeRecord | undefined): NodeRecord {
  if (!current) return remote;
  if (isPurgeTombstone(remote)) return isPurgeTombstone(current) && compareOperationTuples({ logicalTime: current.logicalTime, operationId: current.operationId }, { logicalTime: remote.logicalTime, operationId: remote.operationId }) > 0 ? current : remote;
  if (isPurgeTombstone(current)) return current;
  return mergeCrossWorkspaceNode(remote, current);
}

/** Returns pending node dependencies. */
function pendingNodeDependencies(stored: StoredOperation) {
  const operation = stored.operation;
  switch (operation.kind) {
    case "create":
    case "copy": return operation.nodes.map(({ id }) => id);
    case "write":
    case "rename": return [operation.nodeId];
    case "move": return [...operation.nodeIds, ...(operation.parentId === null ? [] : [operation.parentId])];
    case "position": return operation.positions.map(({ nodeId }) => nodeId);
    case "transfer": return stored.inverse.kind === "transfer" ? [...stored.inverse.nodes.map(({ nodeId }) => nodeId), ...(operation.parentId === null ? [] : [operation.parentId])] : [];
    case "trash": return stored.inverse.kind === "trash" ? stored.inverse.nodeIds : [];
    case "restore": return stored.inverse.kind === "restore" ? [...stored.inverse.nodes.map(({ nodeId }) => nodeId), ...stored.inverse.nodes.flatMap(({ lifecycle }) => lifecycle.originalParentId === null ? [] : [lifecycle.originalParentId])] : [];
    case "purge": return stored.inverse.kind === "purge" ? stored.inverse.nodeIds : [];
    case "set":
    case "set-many":
    case "unset":
    case "unset-many": return [];
  }
}

/** Returns pending setting dependencies. */
function pendingSettingDependencies(stored: StoredOperation) {
  const operation = stored.operation;
  if (operation.kind === "set" || operation.kind === "unset") return [{ namespace: operation.namespace, key: operation.key }];
  if (operation.kind === "set-many") return operation.settings.map(({ key }) => ({ namespace: operation.namespace, key }));
  if (operation.kind === "unset-many") return operation.keys.map((key) => ({ namespace: operation.namespace, key }));
  return [];
}

/** Retains a rejected operation's optimistic overlay. */
function retainsOperationOverlay(stored: StoredOperation) {
  return stored.stateKind !== "accepted" && stored.overlayKind === "active";
}

/** Returns rejected purge node IDs that may be replaced. */
function replaceableRejectedPurgeNodeIds(operations: StoredOperation[], workspaceId: string) {
  return new Set(operations.filter((stored) => stored.workspaceId === workspaceId && stored.stateKind === "rejected" && stored.overlayKind === "deferred" && stored.inverse.kind === "purge").flatMap((stored) => stored.inverse.kind === "purge" ? stored.inverse.nodeIds : []));
}

/** Returns node IDs covered by an incoming transfer overlay. */
function incomingTransferOverlayNodeIds(operations: StoredOperation[], workspaceId: string) {
  return new Set(operations.filter((stored) => retainsOperationOverlay(stored) && stored.overlayKind === "active" && stored.operation.kind === "transfer" && stored.operation.destinationWorkspaceId === workspaceId && stored.workspaceId !== workspaceId && stored.inverse.kind === "transfer").flatMap(({ inverse }) => inverse.kind === "transfer" ? inverse.nodes.map(({ nodeId }) => nodeId) : []));
}

/** Validates incoming transfer parents. */
function validateIncomingTransferParents(nodes: Map<string, NodeRecord>, operations: StoredOperation[], workspaceId: string, deferredOperations: Set<string>) {
  for (const stored of operations) {
    const operation = stored.operation;
    if (!retainsOperationOverlay(stored) || stored.overlayKind !== "active" || deferredOperations.has(stored.operationId) || operation.kind !== "transfer" || operation.destinationWorkspaceId !== workspaceId || operation.parentId === null) continue;
    const parent = nodes.get(operation.parentId);
    if (!parent || isPurgeTombstone(parent) || parent.workspaceId !== workspaceId || parent.kind !== "folder" || parent.lifecycle.kind !== "active") throw new Error("Cursor reset invalidates a pending transfer destination.");
  }
}

/** Derives node and setting targets for a reset operation. */
function deriveResetTargets(reset: FilesystemReset, coverages: StoredHydrationCoverage[], nodes: NodeRecord[], settings: Setting[], operations: StoredOperation[]) {
  const targets = new Map<string, HydrationTarget>();
  const add = (target: HydrationTarget) => targets.set(hydrationTargetId(target), target);
  const workspaceCoverages = coverages.filter((coverage) => coverage.workspaceId === reset.workspaceId);
  for (const coverage of workspaceCoverages) add({ ...coverage.target, asOf: reset.resetBarrier });

  const pending = operations.filter(retainsOperationOverlay);
  const incomingTransferNodes = incomingTransferOverlayNodeIds(pending, reset.workspaceId);
  const nodeIds = new Set(nodes.filter((record) => record.workspaceId === reset.workspaceId && !incomingTransferNodes.has(record.id)).map(({ id }) => id));
  for (const stored of pending) if (stored.workspaceId === reset.workspaceId) pendingNodeDependencies(stored).forEach((id) => nodeIds.add(id));
  const sortedNodeIds = [...nodeIds].sort(compareCanonicalStrings);
  for (let index = 0; index < sortedNodeIds.length; index += WEB2_MAX_BATCH_ITEMS) add({ kind: "exact-nodes", workspaceId: reset.workspaceId, asOf: reset.resetBarrier, nodeIds: sortedNodeIds.slice(index, index + WEB2_MAX_BATCH_ITEMS) });

  const settingKeys = new Map<SettingNamespace, Set<string>>();
  const addSetting = (namespace: SettingNamespace, key: string) => {
    const keys = settingKeys.get(namespace) ?? new Set<string>();
    keys.add(key);
    settingKeys.set(namespace, keys);
  };
  for (const setting of settings) if (setting.workspaceId === reset.workspaceId) addSetting(setting.namespace, setting.key);
  for (const stored of pending) if (stored.workspaceId === reset.workspaceId) pendingSettingDependencies(stored).forEach(({ namespace, key }) => addSetting(namespace, key));
  for (const namespace of [...settingKeys.keys()].sort(compareCanonicalStrings)) {
    const keys = [...settingKeys.get(namespace)!].sort(compareCanonicalStrings);
    for (let index = 0; index < keys.length; index += WEB2_MAX_BATCH_ITEMS) add({ kind: "exact-settings", workspaceId: reset.workspaceId, asOf: reset.resetBarrier, namespace, keys: keys.slice(index, index + WEB2_MAX_BATCH_ITEMS) });
  }
  const result = [...targets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, target]) => target);
  if (result.length > WEB2_MAX_BATCH_ITEMS) throw new Error("The cursor reset selector plan is too large.");
  return result;
}

/** Resets change matches. */
function resetChangeMatches(change: ChangeRecord, reset: FilesystemReset): change is Extract<ChangeRecord, { kind: "reset" }> {
  return change.kind === "reset" && change.workspaceId === reset.workspaceId && change.fromCursor === reset.fromCursor && change.cursor === reset.cursor && change.headSequence === reset.headSequence && change.snapshotBarrier === reset.snapshotBarrier && change.logFloor === reset.logFloor && change.observedLogicalTime === reset.observedLogicalTime;
}

type CompletedHydration = { targetId: string; header: StoredHydrationHeader; staged: StoredHydrationPage[] };

/** Projects hydration bases. */
function projectHydrationBases(completed: CompletedHydration[], currentNodes: Map<string, NodeRecord>, currentSettings: Map<string, Setting>, coverages: StoredHydrationCoverage[], protectedNodeIds: ReadonlySet<string> = new Set(), replaceTombstoneIds: ReadonlySet<string> = new Set()) {
  const projectedNodes = new Map(currentNodes);
  const projectedSettings = new Map(currentSettings);
  const authoritativeNodeIds = new Set<string>();
  const completeSiblingIds = new Set<string>();
  const coveredNodeIds = new Set<string>();
  const obsoleteCoverageIds = new Set<string>();
  const nextCoverages: StoredHydrationCoverage[] = [];
  const remoteByNode = new Map<string, NodeRecord>();
  const remoteBySetting = new Map<string, Setting>();
  let allowAuthoritativePurgeParent = false;

  for (const { targetId, header, staged } of completed) {
    const generation = parseHydrationGeneration({ workspaceId: header.workspaceId, deviceId: header.deviceId, generationId: header.generationId, target: header.target });
    const currentCoverage = coverages.find((coverage) => coverage.workspaceId === generation.workspaceId && coverage.targetId === targetId);
    if (currentCoverage && currentCoverage.target.asOf > generation.target.asOf) throw new Error("That hydration generation is older than its published coverage.");
    const remoteNodes = new Map(staged.flatMap(({ page }) => page.nodes).map((record) => [record.id, record]));
    const remoteSettings = new Map(staged.flatMap(({ page }) => page.settings).map((setting) => [`${setting.workspaceId}\0${setting.namespace}\0${setting.key}`, setting]));
    for (const [id, record] of remoteNodes) {
      const existing = remoteByNode.get(id);
      if (existing && !equalValues(existing, record)) throw new Error("Hydration selectors disagree about a node record.");
      remoteByNode.set(id, record);
      authoritativeNodeIds.add(id);
    }
    for (const [key, setting] of remoteSettings) {
      const existing = remoteBySetting.get(key);
      if (existing && !equalValues(existing, setting)) throw new Error("Hydration selectors disagree about a setting record.");
      remoteBySetting.set(key, setting);
    }
    const remoteNodeIds = new Set(remoteNodes.keys());
    const remoteSettingKeys = new Map<string, Set<string>>();
    for (const setting of remoteSettings.values()) {
      const keys = remoteSettingKeys.get(setting.namespace) ?? new Set<string>();
      keys.add(setting.key);
      remoteSettingKeys.set(setting.namespace, keys);
    }
    for (const candidate of coverages) {
      const target = candidate.target;
      if (candidate.workspaceId !== generation.workspaceId || target.asOf >= generation.target.asOf) continue;
      const contradicted = target.kind === "exact-nodes" ? target.nodeIds.some((id) => remoteNodeIds.has(id) && !candidate.memberIds.includes(id))
        : target.kind === "ancestry" ? remoteNodeIds.has(target.nodeId) && !candidate.memberIds.includes(target.nodeId)
          : target.kind === "exact-settings" ? target.keys.some((key) => remoteSettingKeys.get(target.namespace)?.has(key) && !candidate.memberIds.includes(key))
            : target.kind === "setting-namespace" ? [...(remoteSettingKeys.get(target.namespace) ?? [])].some((key) => !candidate.memberIds.includes(key))
              : false;
      if (contradicted) obsoleteCoverageIds.add(candidate.targetId);
    }
    const newerNodeCoverage = (id: string, record = projectedNodes.get(id)) => coverages.some((coverage) => {
      if (coverage.workspaceId !== generation.workspaceId || coverage.target.asOf <= generation.target.asOf) return false;
      if (coverage.target.kind === "exact-nodes") return coverage.target.nodeIds.includes(id);
      if (coverage.target.kind === "ancestry") return coverage.target.nodeId === id || coverage.memberIds.includes(id);
      return coverage.target.kind === "folder-page" && record !== undefined && !isPurgeTombstone(record) && record.lifecycle.kind === "active" && record.parentId === coverage.target.parentId;
    });
    const newerSettingCoverage = (namespace: string, key: string) => coverages.some((coverage) => coverage.workspaceId === generation.workspaceId && coverage.target.asOf > generation.target.asOf && (coverage.target.kind === "exact-settings" && coverage.target.keys.includes(key) || coverage.target.kind === "setting-namespace") && coverage.target.namespace === namespace);

    switch (generation.target.kind) {
      case "folder-page":
        for (const record of [...projectedNodes.values()]) if (!isPurgeTombstone(record) && record.workspaceId === generation.workspaceId && record.lifecycle.kind === "active" && record.parentId === generation.target.parentId && !protectedNodeIds.has(record.id) && !remoteNodes.has(record.id) && !newerNodeCoverage(record.id)) projectedNodes.delete(record.id);
        remoteNodeIds.forEach((id) => completeSiblingIds.add(id));
        for (const record of currentNodes.values()) if (!isPurgeTombstone(record) && record.workspaceId === generation.workspaceId && record.lifecycle.kind === "active" && record.parentId === generation.target.parentId) coveredNodeIds.add(record.id);
        break;
      case "exact-nodes":
        for (const id of generation.target.nodeIds) {
          coveredNodeIds.add(id);
          const record = projectedNodes.get(id);
          if (!protectedNodeIds.has(id) && !remoteNodes.has(id) && record && (!isPurgeTombstone(record) || replaceTombstoneIds.has(id)) && record.workspaceId === generation.workspaceId && !newerNodeCoverage(id)) projectedNodes.delete(id);
        }
        break;
      case "ancestry": {
        allowAuthoritativePurgeParent = true;
        coveredNodeIds.add(generation.target.nodeId);
        const record = projectedNodes.get(generation.target.nodeId);
        if (!protectedNodeIds.has(generation.target.nodeId) && !remoteNodes.has(generation.target.nodeId) && record && !isPurgeTombstone(record) && record.workspaceId === generation.workspaceId && !newerNodeCoverage(record.id)) projectedNodes.delete(record.id);
        break;
      }
      case "exact-settings":
        for (const settingKey of generation.target.keys) {
          const key = `${generation.workspaceId}\0${generation.target.namespace}\0${settingKey}`;
          if (!remoteSettings.has(key) && !newerSettingCoverage(generation.target.namespace, settingKey)) projectedSettings.delete(key);
        }
        break;
      case "setting-namespace":
        for (const [storageKey, setting] of [...projectedSettings]) if (setting.workspaceId === generation.workspaceId && setting.namespace === generation.target.namespace && !remoteSettings.has(storageKey) && !newerSettingCoverage(setting.namespace, setting.key)) projectedSettings.delete(storageKey);
        break;
    }
    for (const [id, record] of remoteNodes) {
      const current = projectedNodes.get(id);
      if ((!current || !isPurgeTombstone(current) || replaceTombstoneIds.has(id)) && !newerNodeCoverage(id, record)) projectedNodes.set(id, current && !isPurgeTombstone(record) && !isPurgeTombstone(current) && current.workspaceId !== record.workspaceId ? mergeCrossWorkspaceNode(record, current) : record);
      coveredNodeIds.add(id);
    }
    for (const [storageKey, setting] of remoteSettings) if (!newerSettingCoverage(setting.namespace, setting.key)) projectedSettings.set(storageKey, setting);
    const memberIds = generation.target.kind === "folder-page" || generation.target.kind === "exact-nodes" || generation.target.kind === "ancestry" ? [...remoteNodes.keys()] : [...remoteSettings.values()].map(({ key }) => key);
    memberIds.sort(compareCanonicalStrings);
    nextCoverages.push(parseStoredHydrationCoverage({ workspaceId: generation.workspaceId, targetId, generationId: generation.generationId, target: generation.target, memberIds }));
  }
  return { projectedNodes, projectedSettings, authoritativeNodeIds, completeSiblingIds, coveredNodeIds, obsoleteCoverageIds, nextCoverages, allowAuthoritativePurgeParent };
}

/** Returns file version from operation. */
function fileVersionFromOperation(operation: LocallyCommittableOperation, nodeId: string): FileVersion | undefined {
  if (operation.kind === "write") {
    if (operation.nodeId !== nodeId) return undefined;
    return { nodeId, operationId: operation.operationId, logicalTime: operation.logicalTime, mimeType: operation.mimeType, size: operation.size, manifestHash: operation.manifestHash, modifiedAt: operation.modifiedAt, current: false };
  }
  if (operation.kind !== "create" && operation.kind !== "copy") return undefined;
  const node = operation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.kind !== "file") return undefined;
  return { nodeId, operationId: operation.operationId, logicalTime: operation.logicalTime, mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash, modifiedAt: node.modifiedAt, current: false };
}

type LifecycleUndoExpectation = { rootNodeIds: string[]; nodeIds: string[] };

/** Computes lifecycle undo expectation. */
async function lifecycleUndoExpectation(target: StoredOperation, readOperation: (operationId: string) => Promise<StoredOperation | undefined>, seen = new Set<string>()): Promise<LifecycleUndoExpectation | undefined> {
  if (seen.has(target.operationId)) return undefined;
  seen.add(target.operationId);
  if ((target.operation.kind === "create" || target.operation.kind === "copy") && target.intent === "forward" && (target.inverse.kind === "create" || target.inverse.kind === "copy")) {
    return { rootNodeIds: target.inverse.rootNodeIds, nodeIds: target.operation.nodes.map(({ id }) => id).sort() };
  }
  if (target.operation.kind !== "restore" || target.intent !== "redo" || target.inverse.kind !== "restore" || target.operation.destination !== "original") return undefined;
  const undo = await readOperation(target.compensatesOperationId!);
  if (!undo || undo.workspaceId !== target.workspaceId || undo.operation.kind !== "trash" || undo.intent !== "undo" || undo.inverse.kind !== "trash") return undefined;
  const previous = await readOperation(undo.compensatesOperationId!);
  if (!previous || previous.workspaceId !== target.workspaceId) return undefined;
  const expectation = await lifecycleUndoExpectation(previous, readOperation, seen);
  if (!expectation || !equalValues(undo.operation.nodeIds, expectation.rootNodeIds) || !equalValues(undo.inverse.nodeIds, expectation.nodeIds) || !equalValues(target.operation.nodeIds, undo.inverse.roots.map(({ nodeId }) => nodeId)) || !equalValues(target.inverse.nodes.map(({ nodeId }) => nodeId), undo.inverse.nodeIds)) return undefined;
  return { rootNodeIds: target.operation.nodeIds, nodeIds: target.inverse.nodes.map(({ nodeId }) => nodeId).sort() };
}

/** Opens filesystem database. */
export async function openFilesystemDatabase(accountId: string, environment: FilesystemDatabaseEnvironment): Promise<FilesystemDatabase> {
  const factory = environment.indexedDB ?? globalThis.indexedDB;
  const keyRange = environment.IDBKeyRange ?? globalThis.IDBKeyRange;
  if (!factory || !keyRange) throw new Error("IndexedDB filesystem storage is unavailable.");
  const canonicalAccountId = parseStableId(accountId, "A filesystem account ID is invalid.");
  const db = await openDatabase(factory, await filesystemDatabaseName(environment.storageId));
  const now = environment.now ?? Date.now;
  const randomUUID = environment.randomUUID ?? (() => crypto.randomUUID());
  const readStoredManifests = async (hashes: readonly string[]) => {
    const values = await transact(db, "manifests", "readonly", (transaction) => Promise.all(hashes.map((hash) => request(transaction.objectStore("manifests").get(hash)))));
    const records = new Map<string, StoredManifest>();
    for (let index = 0; index < hashes.length; index += 1) {
      const value = values[index];
      if (value !== undefined) records.set(hashes[index]!, await validateStoredManifest(value, hashes[index]));
    }
    return records;
  };
  const assertChildNamesAvailableInTransaction = async (transaction: IDBTransaction, workspaceId: string, parentId: string | null, names: readonly string[], excludedIds = new Set<string>()) => {
    const folded = names.map((name) => canonicalNameKey(parseCanonicalName(name)));
    if (new Set(folded).size !== folded.length) throw new Error("An active sibling with that name already exists.");
    const wanted = new Set(folded);
    await new Promise<void>((resolve, reject) => {
      const cursor = transaction.objectStore("nodes").index("by-workspace-parent-lifecycle").openCursor(keyRange.only([workspaceId, parentId ?? "", "active"]));
      cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem sibling names could not be read."));
      cursor.onsuccess = () => {
        try {
          if (!cursor.result) { resolve(); return; }
          const sibling = parseStoredNode(cursor.result.value);
          if (!excludedIds.has(sibling.id) && wanted.has(canonicalNameKey(sibling.name))) { reject(new Error("An active sibling with that name already exists.")); return; }
          cursor.result.continue();
        } catch (error) {
          reject(error);
        }
      };
    });
  };
  const assertNodeIdsAvailableInTransaction = async (transaction: IDBTransaction, values: readonly string[]) => {
    const ids = values.map((id) => parseStableId(id, "A created node ID is invalid."));
    if (ids.length === 0 || ids.length > WEB2_MAX_BATCH_ITEMS || new Set(ids).size !== ids.length) throw new Error("Created node IDs must be unique and bounded.");
    const nodes = transaction.objectStore("nodes");
    for (const id of ids) if (await request(nodes.get(id)) !== undefined) throw new Error("A node ID already exists.");
    const pending = new Set(ids);
    // Workspace deletion removes node records but retains operation history, so globally used IDs remain reserved here.
    await new Promise<void>((resolve, reject) => {
      const cursor = transaction.objectStore("operations").openCursor();
      cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem operation history could not be read."));
      cursor.onsuccess = () => {
        try {
          if (!cursor.result) { resolve(); return; }
          const stored = parseStoredOperation(cursor.result.value);
          if ((stored.operation.kind === "create" || stored.operation.kind === "copy") && stored.operation.nodes.some(({ id }) => pending.has(id))) { reject(new Error("A node ID was already used by retained operation history.")); return; }
          cursor.result.continue();
        } catch (error) {
          reject(error);
        }
      };
    });
  };

  return {
    close: () => db.close(),

    createWorkspace: async (value) => {
      if (!isRecord(value)) throw new Error("A workspace creation request has an unsupported shape.");
      assertExactKeys(value, ["id", "name", "pinned", "deviceId"], "A workspace creation request has an unsupported shape.");
      if (typeof value.pinned !== "boolean") throw new Error("Workspace pinning metadata is invalid.");
      const id = parseStableId(value.id, "A workspace ID is invalid.");
      const deviceId = parseStableId(value.deviceId, "A workspace device ID is invalid.");
      const name = parseCanonicalName(value.name, "A workspace name is invalid.");
      const sync = parseSyncState({ workspaceId: id, deviceId, cursor: 0, lastHydrationAsOf: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 });
      return transact(db, ["workspaces", "sync"], "readwrite", async (transaction) => {
        const workspaces = transaction.objectStore("workspaces");
        const existingWorkspace = await request(workspaces.get(id));
        const existingSync = await request(transaction.objectStore("sync").get(id));
        if (existingWorkspace !== undefined) { parseWorkspace(existingWorkspace); throw new Error("That workspace already exists."); }
        if (existingSync !== undefined) { parseSyncState(existingSync); throw new Error("Stored synchronization state exists without its workspace."); }
        const current = parseWorkspaceList(await request(workspaces.getAll()));
        if (current.length === MAX_WORKSPACES) throw new Error("The workspace directory is full.");
        if (current.some((workspace) => workspaceNameKey(workspace.name) === workspaceNameKey(name))) throw new Error("A workspace already uses that name.");
        const insertion = value.pinned ? current.findIndex(({ pinned }) => !pinned) : current.length;
        const ordered = [...current];
        const workspace = parseWorkspace({ id, name, pinned: value.pinned, ordinal: insertion < 0 ? current.length : insertion, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 });
        ordered.splice(workspace.ordinal, 0, workspace);
        const updated = ordered.map((candidate, ordinal) => parseWorkspace({ ...candidate, ordinal }));
        await Promise.all([
          ...updated.map((candidate) => request(candidate.id === id ? workspaces.add(candidate) : workspaces.put(candidate))),
          request(transaction.objectStore("sync").add(sync)),
        ]);
        return updated[workspace.ordinal]!;
      });
    },

    listWorkspaces: () => transact(db, "workspaces", "readonly", async (transaction) => {
      const values = await request(transaction.objectStore("workspaces").getAll());
      return parseWorkspaceList(values);
    }),

    renameWorkspace: async (workspaceId, name) => {
      const id = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalName = parseCanonicalName(name, "A workspace name is invalid.");
      return transact(db, "workspaces", "readwrite", async (transaction) => {
        const store = transaction.objectStore("workspaces");
        const workspaces = parseWorkspaceList(await request(store.getAll()));
        const workspace = workspaces.find((candidate) => candidate.id === id);
        if (!workspace) throw new Error("That workspace does not exist.");
        if (workspaces.some((candidate) => candidate.id !== id && workspaceNameKey(candidate.name) === workspaceNameKey(canonicalName))) throw new Error("A workspace already uses that name.");
        const renamed = parseWorkspace({ ...workspace, name: canonicalName });
        await request(store.put(renamed));
        return renamed;
      });
    },

    setWorkspacePreferences: async (preferences) => {
      if (!Array.isArray(preferences) || preferences.length === 0 || preferences.length > MAX_WORKSPACES) throw new Error("Workspace preferences are invalid.");
      const parsed = preferences.map((preference) => {
        if (!isRecord(preference)) throw new Error("Workspace preferences are invalid.");
        assertExactKeys(preference, ["id", "pinned"], "Workspace preferences are invalid.");
        if (typeof preference.pinned !== "boolean") throw new Error("Workspace preferences are invalid.");
        return { id: parseStableId(preference.id, "A workspace preference ID is invalid."), pinned: preference.pinned };
      });
      if (new Set(parsed.map(({ id }) => id)).size !== parsed.length || parsed.some(({ pinned }, index) => index > 0 && pinned && !parsed[index - 1]!.pinned)) throw new Error("Workspace preferences are invalid.");
      return transact(db, "workspaces", "readwrite", async (transaction) => {
        const store = transaction.objectStore("workspaces");
        const current = parseWorkspaceList(await request(store.getAll()));
        const byId = new Map(current.map((workspace) => [workspace.id, workspace]));
        if (parsed.length !== current.length || parsed.some(({ id }) => !byId.has(id))) throw new Error("Workspace preferences must include the complete directory.");
        const updated = parsed.map(({ id, pinned }, ordinal) => parseWorkspace({ ...byId.get(id)!, pinned, ordinal }));
        await Promise.all(updated.map((workspace) => request(store.put(workspace))));
        return updated;
      });
    },

    deleteWorkspace: async (workspaceId) => {
      const id = parseStableId(workspaceId, "A workspace ID is invalid.");
      const storeNames = ["workspaces", "nodes", "sync", "settings", "changes", "hydration-pages", "hydration-coverage", "window-sessions"];
      return transact(db, storeNames, "readwrite", async (transaction) => {
        const workspacesStore = transaction.objectStore("workspaces");
        const current = parseWorkspaceList(await request(workspacesStore.getAll()));
        if (!current.some((workspace) => workspace.id === id)) throw new Error("That workspace does not exist.");
        if (current.length === 1) throw new Error("The final workspace cannot be deleted.");
        const nodes = transaction.objectStore("nodes");
        const settings = transaction.objectStore("settings");
        const changes = transaction.objectStore("changes");
        const hydrationPages = transaction.objectStore("hydration-pages");
        const hydrationCoverage = transaction.objectStore("hydration-coverage");
        // ponytail: deletion scans the account to remove malformed index rows; add workspace indexes if measured catalogs make this slow.
        const [nodeValues, nodeKeys, settingKeys, changeKeys, hydrationKeys, coverageKeys] = await Promise.all([
          request(nodes.getAll()),
          request(nodes.getAllKeys()),
          request(settings.getAllKeys()),
          request(changes.getAllKeys()),
          request(hydrationPages.getAllKeys()),
          request(hydrationCoverage.getAllKeys()),
        ]);
        const nodeIds = nodeKeys.filter((_, index) => isRecord(nodeValues[index]) && nodeValues[index].workspaceId === id);
        const belongsToWorkspace = (key: IDBValidKey) => Array.isArray(key) && key[0] === id;
        const remaining = current.filter((workspace) => workspace.id !== id).map((workspace, ordinal) => parseWorkspace({ ...workspace, ordinal }));
        await Promise.all([
          ...nodeIds.map((nodeId) => request(nodes.delete(nodeId))),
          ...settingKeys.filter(belongsToWorkspace).map((key) => request(settings.delete(key))),
          ...changeKeys.filter(belongsToWorkspace).map((key) => request(changes.delete(key))),
          ...hydrationKeys.filter(belongsToWorkspace).map((key) => request(hydrationPages.delete(key))),
          ...coverageKeys.filter(belongsToWorkspace).map((key) => request(hydrationCoverage.delete(key))),
          ...remaining.map((workspace) => request(workspacesStore.put(workspace))),
          request(workspacesStore.delete(id)),
          request(transaction.objectStore("sync").delete(id)),
          request(transaction.objectStore("window-sessions").delete(id)),
        ]);
        return remaining;
      });
    },

    readWindowSession: async (workspaceId) => {
      const id = parseStableId(workspaceId, "A workspace ID is invalid.");
      return transact(db, "window-sessions", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("window-sessions").get(id));
        return value === undefined ? { schemaVersion: 1, apps: [] } : parseStoredWindowSession(value, id);
      });
    },

    writeWindowSession: async (workspaceId, session) => {
      const id = parseStableId(workspaceId, "A workspace ID is invalid.");
      const parsed = parseWindowSession(session);
      await transact(db, ["workspaces", "window-sessions"], "readwrite", async (transaction) => {
        const workspace = await request(transaction.objectStore("workspaces").get(id));
        if (workspace === undefined) throw new Error("That workspace does not exist.");
        parseWorkspace(workspace);
        await request(transaction.objectStore("window-sessions").put({ workspaceId: id, session: parsed }));
      });
    },

    readDevicePreferences: () => transact(db, "device-preferences", "readonly", async (transaction) => {
      const value = await request(transaction.objectStore("device-preferences").get(SINGLETON_RECORD_ID));
      return value === undefined ? { ...DEFAULT_DEVICE_PREFERENCES } : parseStoredDevicePreferences(value);
    }),

    writeDevicePreferences: async (preferences) => {
      const parsed = parseDevicePreferences(preferences);
      await transact(db, "device-preferences", "readwrite", async (transaction) => {
        await request(transaction.objectStore("device-preferences").put({ id: SINGLETON_RECORD_ID, schemaVersion: 1, preferences: parsed }));
      });
    },

    getOrCreateDeviceId: () => transact(db, "device-preferences", "readwrite", async (transaction) => {
      const store = transaction.objectStore("device-preferences");
      const value = await request(store.get("device"));
      if (value !== undefined) return parseStoredDeviceIdentity(value);
      const deviceId = parseStableId(randomUUID(), "The generated device ID is invalid.");
      await request(store.add({ id: "device", schemaVersion: 1, deviceId }));
      return deviceId;
    }),

    listLegacyStoreApps: () => transact(db, "installed-apps", "readonly", async (transaction) => {
      const values = await request(transaction.objectStore("installed-apps").getAll());
      return values.flatMap((value) => isRecord(value) && value.source === "store" ? [{ appId: parseAppId(value.appId), digest: parseSha256(value.digest, "Installed app digest is invalid.") }] : []);
    }),

    removeLegacyStoreApp: async (value) => {
      const appId = parseAppId(value);
      await transact(db, ["installed-apps", "app-storage", "file-associations"], "readwrite", async (transaction) => {
        const store = transaction.objectStore("installed-apps");
        const current = await request(store.get(appId));
        if (!isRecord(current) || current.source !== "store") return;
        await Promise.all([request(store.delete(appId)), clearAppDataRows(transaction, appId)]);
      });
    },

    listInstalledApps: () => transact(db, "installed-apps", "readonly", async (transaction) => {
      const values = await request(transaction.objectStore("installed-apps").getAll());
      return values.filter((value) => !isRecord(value) || value.source !== "store").map(parseInstalledApp).sort((left, right) => left.approvedAt - right.approvedAt || left.appId.localeCompare(right.appId));
    }),

    installApp: async (value) => {
      const install = parseInstalledApp(value);
      if (install.source !== "system" && RESERVED_SYSTEM_APP_IDS.has(install.appId)) throw new Error("That app ID is reserved for a trusted system app.");
      return transact(db, "installed-apps", "readwrite", async (transaction) => {
        const store = transaction.objectStore("installed-apps");
        const stored = await request(store.get(install.appId));
        const current = stored === undefined ? undefined : parseInstalledApp(stored);
        if (current?.source === "system" && install.source !== "system") throw new Error("Bundled system apps cannot be replaced.");
        await request(store.put(install));
        return install;
      });
    },

    uninstallApp: async (value) => {
      const appId = parseAppId(value);
      await transact(db, ["installed-apps", "app-storage", "file-associations"], "readwrite", async (transaction) => {
        const apps = transaction.objectStore("installed-apps");
        const stored = await request(apps.get(appId));
        if (stored === undefined) return;
        const current = parseInstalledApp(stored);
        if (current.source === "system") return;
        await request(apps.delete(appId));
        await clearAppDataRows(transaction, appId);
      });
    },

    listFileAssociations: () => transact(db, "file-associations", "readonly", async (transaction) => {
      const values = await request(transaction.objectStore("file-associations").getAll());
      return values.map(parseFileAssociation).sort((left, right) => left.matcher.localeCompare(right.matcher));
    }),

    setFileAssociation: async (value) => {
      const association = parseFileAssociation(value);
      return transact(db, ["installed-apps", "file-associations"], "readwrite", async (transaction) => {
        const installed = await request(transaction.objectStore("installed-apps").get(association.appId));
        if (installed === undefined) throw new Error("That app is not installed.");
        parseInstalledApp(installed);
        await request(transaction.objectStore("file-associations").put(association));
        return association;
      });
    },

    removeFileAssociation: async (matcher) => {
      await transact(db, "file-associations", "readwrite", async (transaction) => {
        await request(transaction.objectStore("file-associations").delete(normalizeAssociationMatcher(matcher)));
      });
    },

    resetFileAssociations: async () => {
      await transact(db, "file-associations", "readwrite", async (transaction) => {
        await request(transaction.objectStore("file-associations").clear());
      });
    },

    readAppStorage: async (appIdValue, keyValue) => {
      const appId = parseAppId(appIdValue);
      const key = parseAppStorageKey(keyValue);
      return transact(db, "app-storage", "readonly", async (transaction) => {
        const stored = await request(transaction.objectStore("app-storage").get([appId, key]));
        return stored === undefined ? undefined : parseAppStorageRecord(stored, appId).value;
      });
    },

    writeAppStorage: async (appIdValue, keyValue, value, maxBytesValue, maxEntriesValue) => {
      const appId = parseAppId(appIdValue);
      const key = parseAppStorageKey(keyValue);
      const parsed = parseJsonValue(value);
      const maxBytes = parsePositiveSafeInteger(maxBytesValue, "The app storage byte quota is invalid.");
      const maxEntries = parsePositiveSafeInteger(maxEntriesValue, "The app storage entry quota is invalid.");
      if (maxBytes > 64 * 1024 || maxEntries > WEB2_MAX_BATCH_ITEMS) throw new Error("The app storage quota is invalid.");
      const bytes = appStorageBytes(key, parsed);
      await transact(db, ["installed-apps", "app-storage"], "readwrite", async (transaction) => {
        const installed = await request(transaction.objectStore("installed-apps").get(appId));
        if (installed === undefined) throw new Error("That app is not installed.");
        parseInstalledApp(installed);
        const store = transaction.objectStore("app-storage");
        const records = (await request(store.index("appId").getAll(appId))).map((record) => parseAppStorageRecord(record, appId));
        const existing = records.find((record) => record.key === key);
        if (!existing && records.length >= maxEntries) throw new Error("App storage entry quota exceeded.");
        if (records.reduce((sum, record) => sum + record.bytes, 0) - (existing?.bytes ?? 0) + bytes > maxBytes) throw new Error("App storage quota exceeded.");
        await request(store.put({ appId, key, value: parsed, bytes } satisfies AppStorageRecord));
      });
    },

    removeAppStorage: async (appIdValue, keyValue) => {
      const appId = parseAppId(appIdValue);
      const key = parseAppStorageKey(keyValue);
      await transact(db, "app-storage", "readwrite", async (transaction) => {
        await request(transaction.objectStore("app-storage").delete([appId, key]));
      });
    },

    clearAppStorage: async (appIdValue) => {
      const appId = parseAppId(appIdValue);
      await transact(db, "app-storage", "readwrite", async (transaction) => {
        const store = transaction.objectStore("app-storage");
        const keys = await request(store.index("appId").getAllKeys(appId));
        await Promise.all(keys.map((key) => request(store.delete(key))));
      });
    },

    readAccountApps: () => transact(db, ["account-apps", "account-app-outbox"], "readonly", async (transaction) => {
      const outbox = await readAccountAppOutbox(transaction.objectStore("account-app-outbox"));
      return { state: await readAccountAppState(transaction.objectStore("account-apps"), outbox), outbox };
    }),

    enqueueAccountAppOperation: async (value) => {
      let operation = parseAccountAppOperation(value);
      return transact(db, ["account-apps", "account-app-outbox", "account-app-client-state", "app-storage"], "readwrite", async (transaction) => {
        const outboxStore = transaction.objectStore("account-app-outbox");
        const outbox = await readAccountAppOutbox(outboxStore);
        const current = await readAccountAppState(transaction.objectStore("account-apps"), outbox);
        if (operation.kind !== "install" && operation.kind !== "handlers") {
          const operationAppId = operation.appId;
          const app = current.projection.apps.find((candidate) => candidate.appId === operationAppId);
          if (!app) throw new Error("That app is not installed for this account.");
          if (operation.kind === "uninstall") {
            if (app.installationGeneration === null) throw new Error("Wait for this app to finish installing before uninstalling it.");
            operation = { ...operation, installationGeneration: app.installationGeneration };
          } else operation = { ...operation, dataGeneration: app.dataGeneration };
        }
        const reserved = await reserveAccountAppOperation(transaction.objectStore("account-app-client-state"), randomUUID);
        const record = parseAccountAppOutboxRecord({ ...reserved, operation, status: "pending", error: null, errorCode: null, attemptCount: 0, lastAttemptAt: null });
        if (operation.kind === "put-data" || operation.kind === "delete-data" || operation.kind === "clear-data") await writeLocalAccountAppData(transaction, operation);
        await request(outboxStore.add(record));
        const state = { id: SINGLETON_RECORD_ID, baseline: current.baseline, projection: projectAccountApps(current.baseline, [...outbox, record]) };
        await request(transaction.objectStore("account-apps").put(state));
        return { state, record };
      });
    },

    reconcileAccountApps: async (value, acknowledgedOperationId) => {
      const snapshot = parseAccountAppsSnapshot(value);
      const operationId = acknowledgedOperationId === undefined ? undefined : parseAccountAppOperationId(acknowledgedOperationId);
      return transact(db, ["account-apps", "account-app-outbox"], "readwrite", async (transaction) => {
        const outboxStore = transaction.objectStore("account-app-outbox");
        if (operationId) {
          const selected = await request(outboxStore.index("operationId").get(operationId));
          if (selected !== undefined) await request(outboxStore.delete(parseAccountAppOutboxRecord(selected).sequence));
        }
        const outbox = await readAccountAppOutbox(outboxStore);
        const state = { id: SINGLETON_RECORD_ID, baseline: snapshot, projection: projectAccountApps(snapshot, outbox) };
        await request(transaction.objectStore("account-apps").put(state));
        return state;
      });
    },

    blockAccountAppOperation: async (operationIdValue, error, errorCode) => {
      const operationId = parseAccountAppOperationId(operationIdValue);
      if (typeof error !== "string" || !error || typeof errorCode !== "string" || !errorCode) throw new Error("A blocked account app error is invalid.");
      await transact(db, ["account-apps", "account-app-outbox"], "readwrite", async (transaction) => {
        const store = transaction.objectStore("account-app-outbox");
        const value = await request(store.index("operationId").get(operationId));
        if (value === undefined) return;
        const selected = parseAccountAppOutboxRecord(value);
        await request(store.put({ ...selected, status: "blocked", error, errorCode }));
        const outbox = await readAccountAppOutbox(store);
        const current = await readAccountAppState(transaction.objectStore("account-apps"), outbox.map((candidate) => candidate.operationId === operationId ? { ...candidate, status: "pending" as const } : candidate));
        await request(transaction.objectStore("account-apps").put({ id: SINGLETON_RECORD_ID, baseline: current.baseline, projection: projectAccountApps(current.baseline, outbox) }));
      });
    },

    retryAccountAppOperation: async (operationIdValue) => {
      const operationId = parseAccountAppOperationId(operationIdValue);
      return transact(db, ["account-apps", "account-app-outbox"], "readwrite", async (transaction) => {
        const outboxStore = transaction.objectStore("account-app-outbox");
        const value = await request(outboxStore.index("operationId").get(operationId));
        if (value === undefined) throw new Error("That blocked account app change no longer exists.");
        const selected = parseAccountAppOutboxRecord(value);
        if (selected.status !== "blocked") throw new Error("That blocked account app change no longer exists.");
        const accountStore = transaction.objectStore("account-apps");
        const stored = await readAccountAppState(accountStore, await readAccountAppOutbox(outboxStore));
        if (!stored.baseline) throw new Error("Refresh account apps before retrying this change.");
        const changed = parseAccountAppOutboxRecord({ ...selected, operation: rebaseAccountAppOperation(selected.operation, stored.baseline), status: "pending", error: null, errorCode: null });
        await request(outboxStore.put(changed));
        const outbox = await readAccountAppOutbox(outboxStore);
        await request(accountStore.put({ id: SINGLETON_RECORD_ID, baseline: stored.baseline, projection: projectAccountApps(stored.baseline, outbox) }));
        return changed;
      });
    },

    discardAccountAppOperation: async (operationIdValue, restoration) => {
      const operationId = parseAccountAppOperationId(operationIdValue);
      await transact(db, ["account-apps", "account-app-outbox", "app-storage"], "readwrite", async (transaction) => {
        const outboxStore = transaction.objectStore("account-app-outbox");
        const value = await request(outboxStore.index("operationId").get(operationId));
        if (value === undefined) throw new Error("That blocked account app change no longer exists.");
        const selected = parseAccountAppOutboxRecord(value);
        if (selected.status !== "blocked") throw new Error("That blocked account app change no longer exists.");
        await restoreLocalAccountAppData(transaction, selected.operation, restoration);
        await request(outboxStore.delete(selected.sequence));
        const accountStore = transaction.objectStore("account-apps");
        const outbox = await readAccountAppOutbox(outboxStore);
        const stored = await readAccountAppState(accountStore, [...outbox, selected]);
        await request(accountStore.put({ id: SINGLETON_RECORD_ID, baseline: stored.baseline, projection: projectAccountApps(stored.baseline, outbox) }));
      });
    },

    recordAccountAppAttempt: async (operationIdValue, attemptedAtValue) => {
      const operationId = parseAccountAppOperationId(operationIdValue);
      const attemptedAt = parseNonNegativeSafeInteger(attemptedAtValue, "An account app attempt time is invalid.");
      await transact(db, "account-app-outbox", "readwrite", async (transaction) => {
        const store = transaction.objectStore("account-app-outbox");
        const value = await request(store.index("operationId").get(operationId));
        if (value === undefined) return;
        const record = parseAccountAppOutboxRecord(value);
        await request(store.put({ ...record, attemptCount: nextSafeInteger(record.attemptCount, "The account app attempt count is exhausted."), lastAttemptAt: attemptedAt }));
      });
    },

    getNode: async (id) => {
      const canonicalId = parseStableId(id, "A node ID is invalid.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("nodes").get(canonicalId));
        if (value === undefined) return undefined;
        const record = parseStoredNodeRecord(value);
        return isPurgeTombstone(record) ? undefined : nodeRecord(record);
      });
    },

    getNodeRecord: async (id) => {
      const canonicalId = parseStableId(id, "A node ID is invalid.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("nodes").get(canonicalId));
        if (value === undefined) return undefined;
        const record = parseStoredNodeRecord(value);
        return isPurgeTombstone(record) ? record : nodeRecord(record);
      });
    },

    queryNode: async (workspaceIdValue, nodeIdValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A workspace ID is invalid.");
      const nodeId = parseStableId(nodeIdValue, "A node ID is invalid.");
      return transact(db, ["nodes", "hydration-coverage"], "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("nodes").get(nodeId));
        if (value !== undefined) {
          const record = parseStoredNodeRecord(value);
          return isPurgeTombstone(record) || record.workspaceId !== workspaceId ? available(undefined) : available(nodeRecord(record));
        }
        const coverageStore = transaction.objectStore("hydration-coverage");
        const coverageValues = (await Promise.all([
          request(coverageStore.index("by-member").getAll(nodeId)),
          request(coverageStore.index("by-exact-node").getAll(nodeId)),
          request(coverageStore.index("by-ancestry-node").getAll(nodeId)),
        ])).flat();
        const coverages = [...new Map(coverageValues.map(parseStoredHydrationCoverage).filter((coverage) => coverage.workspaceId === workspaceId).map((coverage) => [coverage.targetId, coverage])).values()];
        const proofs: Array<{ asOf: number; kind: "positive" | "negative" }> = [];
        for (const coverage of coverages) {
          if (coverage.target.kind === "exact-nodes" && coverage.target.nodeIds.includes(nodeId)) proofs.push({ asOf: coverage.target.asOf, kind: coverage.memberIds.includes(nodeId) ? "positive" : "negative" });
          else if (coverage.target.kind === "ancestry" && coverage.target.nodeId === nodeId) proofs.push({ asOf: coverage.target.asOf, kind: coverage.memberIds.includes(nodeId) ? "positive" : "negative" });
          else if ((coverage.target.kind === "folder-page" || coverage.target.kind === "ancestry") && coverage.memberIds.includes(nodeId)) proofs.push({ asOf: coverage.target.asOf, kind: "positive" });
        }
        return resolveMissingExact(proofs);
      });
    },

    listChildren: async (workspaceId, parentId, limit) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalParentId = parentId === null ? null : parseStableId(parentId, "A parent node ID is invalid.");
      const boundedLimit = limit === undefined ? undefined : parsePositiveSafeInteger(limit, "A child list limit is invalid.");
      if (boundedLimit !== undefined && boundedLimit > WEB2_MAX_BATCH_ITEMS + 1) throw new Error("A child list limit is too large.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const index = transaction.objectStore("nodes").index("by-workspace-parent-lifecycle");
        const range = keyRange.only([canonicalWorkspaceId, canonicalParentId ?? "", "active"]);
        const values = await request(boundedLimit === undefined ? index.getAll(range) : index.getAll(range, boundedLimit));
        return values.map((value) => nodeRecord(parseStoredNode(value)));
      });
    },

    queryFolderChildren: async (workspaceIdValue, parentIdValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A workspace ID is invalid.");
      const parentId = parentIdValue === null ? null : parseStableId(parentIdValue, "A parent node ID is invalid.");
      return transact(db, ["nodes", "hydration-coverage"], "readonly", async (transaction) => {
        const range = keyRange.only([workspaceId, parentId ?? "", "active"]);
        const targetId = hydrationTargetId({ kind: "folder-page", workspaceId, asOf: 0, parentId, limit: 1 });
        const [values, coverageValue] = await Promise.all([
          request(transaction.objectStore("nodes").index("by-workspace-parent-lifecycle").getAll(range)),
          request(transaction.objectStore("hydration-coverage").get([workspaceId, targetId])),
        ]);
        const nodes = values.map((value) => nodeRecord(parseStoredNode(value)));
        if (coverageValue === undefined) return { availability: "unavailable" };
        const coverage = parseStoredHydrationCoverage(coverageValue);
        return coverage.target.kind === "folder-page" && coverage.target.parentId === parentId ? available(nodes) : { availability: "unavailable" };
      });
    },

    assertChildNamesAvailable: async (workspaceId, parentId, names) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalParentId = parentId === null ? null : parseStableId(parentId, "A parent node ID is invalid.");
      if (!Array.isArray(names) || names.length === 0 || names.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A sibling name batch is invalid.");
      return transact(db, "nodes", "readonly", (transaction) => assertChildNamesAvailableInTransaction(transaction, canonicalWorkspaceId, canonicalParentId, names));
    },

    assertNodeIdsAvailable: async (ids) => {
      if (!Array.isArray(ids)) throw new Error("Created node IDs are invalid.");
      return transact(db, ["nodes", "operations"], "readonly", (transaction) => assertNodeIdsAvailableInTransaction(transaction, ids));
    },

    listTrash: async (workspaceId) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const values = await request(transaction.objectStore("nodes").index("by-workspace-lifecycle").getAll(keyRange.only([canonicalWorkspaceId, "trashed"])));
        return values.map(parseStoredNode).filter(({ parentId }) => parentId === null).sort((left, right) => {
          if (left.lifecycle.kind !== "trashed" || right.lifecycle.kind !== "trashed") throw new Error("Stored Trash index metadata is inconsistent.");
          return right.lifecycle.trashedAt - left.lifecycle.trashedAt || right.fieldTuples.lifecycle.logicalTime - left.fieldTuples.lifecycle.logicalTime || left.id.localeCompare(right.id);
        }).map(nodeRecord);
      });
    },

    getSetting: async (workspaceId, namespace, key) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const { namespace: canonicalNamespace, key: canonicalKey } = parseSettingKeyForNamespace(namespace, key);
      return transact(db, "settings", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("settings").get([canonicalWorkspaceId, canonicalNamespace, canonicalKey]));
        if (value === undefined) return undefined;
        const setting = parseSetting(value);
        return setting.deleted ? undefined : setting;
      });
    },

    querySetting: async (workspaceIdValue, namespaceValue, keyValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A workspace ID is invalid.");
      const { namespace, key } = parseSettingKeyForNamespace(namespaceValue, keyValue);
      return transact(db, ["settings", "hydration-coverage"], "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("settings").get([workspaceId, namespace, key]));
        if (value !== undefined) {
          const setting = parseSetting(value);
          return setting.deleted ? available(undefined) : available(setting);
        }
        const coverageStore = transaction.objectStore("hydration-coverage");
        const coverageValues = (await Promise.all([
          request(coverageStore.index("by-workspace-kind-namespace").getAll(keyRange.only([workspaceId, "exact-settings", namespace]))),
          request(coverageStore.index("by-workspace-kind-namespace").getAll(keyRange.only([workspaceId, "setting-namespace", namespace]))),
        ])).flat();
        const coverages = [...new Map(coverageValues.map(parseStoredHydrationCoverage).filter((coverage) => coverage.workspaceId === workspaceId).map((coverage) => [coverage.targetId, coverage])).values()];
        const proofs: Array<{ asOf: number; kind: "positive" | "negative" }> = [];
        for (const coverage of coverages) {
          if (coverage.target.kind === "exact-settings" && coverage.target.namespace === namespace && coverage.target.keys.includes(key) || coverage.target.kind === "setting-namespace" && coverage.target.namespace === namespace) proofs.push({ asOf: coverage.target.asOf, kind: coverage.memberIds.includes(key) ? "positive" : "negative" });
        }
        return resolveMissingExact(proofs);
      });
    },

    getSettingRecord: async (workspaceId, namespace, key) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const { namespace: canonicalNamespace, key: canonicalKey } = parseSettingKeyForNamespace(namespace, key);
      return transact(db, "settings", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("settings").get([canonicalWorkspaceId, canonicalNamespace, canonicalKey]));
        return value === undefined ? undefined : parseSetting(value);
      });
    },

    listSettings: async (workspaceId, namespace) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalNamespace = parseSettingNamespace(namespace);
      return transact(db, "settings", "readonly", async (transaction) => {
        const values = await request(transaction.objectStore("settings").getAll(keyRange.bound([canonicalWorkspaceId, canonicalNamespace, ""], [canonicalWorkspaceId, canonicalNamespace, "\uffff"])));
        return values.map(parseSetting).filter((setting): setting is Extract<Setting, { deleted: false }> => !setting.deleted);
      });
    },

    querySettingNamespace: async (workspaceIdValue, namespaceValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A workspace ID is invalid.");
      const namespace = parseSettingNamespace(namespaceValue);
      return transact(db, ["settings", "hydration-coverage"], "readonly", async (transaction) => {
        const range = keyRange.bound([workspaceId, namespace, ""], [workspaceId, namespace, "\uffff"]);
        const targetId = hydrationTargetId({ kind: "setting-namespace", workspaceId, asOf: 0, namespace, limit: 1 });
        const [values, coverageValue] = await Promise.all([
          request(transaction.objectStore("settings").getAll(range)),
          request(transaction.objectStore("hydration-coverage").get([workspaceId, targetId])),
        ]);
        const settings = values.map(parseSetting).filter((setting): setting is ActiveSetting => !setting.deleted);
        if (coverageValue === undefined) return { availability: "unavailable" };
        const coverage = parseStoredHydrationCoverage(coverageValue);
        return coverage.target.kind === "setting-namespace" && coverage.target.namespace === namespace ? available(settings) : { availability: "unavailable" };
      });
    },

    listSettingRecords: async (workspaceId, namespace) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalNamespace = parseSettingNamespace(namespace);
      return transact(db, "settings", "readonly", async (transaction) => {
        const range = keyRange.bound([canonicalWorkspaceId, canonicalNamespace, ""], [canonicalWorkspaceId, canonicalNamespace, "\uffff"]);
        return (await request(transaction.objectStore("settings").getAll(range))).map(parseSetting);
      });
    },

    getSyncState: async (workspaceId) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      return transact(db, ["workspaces", "sync"], "readonly", async (transaction) => {
        const [workspaceValue, syncValue] = await Promise.all([
          request(transaction.objectStore("workspaces").get(canonicalWorkspaceId)),
          request(transaction.objectStore("sync").get(canonicalWorkspaceId)),
        ]);
        if (workspaceValue === undefined || syncValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        const sync = parseSyncState(syncValue);
        if (workspace.id !== sync.workspaceId) throw new Error("Stored synchronization state does not match its workspace.");
        return sync;
      });
    },

    prepareReset: async (value, createGenerationId) => {
      const reset = parseFilesystemReset(value);
      if (typeof createGenerationId !== "function") throw new TypeError("A reset generation factory is required.");
      return transact(db, ["workspaces", "nodes", "operations", "changes", "sync", "settings", "hydration-pages", "hydration-coverage"], "readwrite", async (transaction): Promise<ResetPreparation> => {
        const pages = transaction.objectStore("hydration-pages");
        const [workspaceValue, syncValue, pageValues, coverageValues, nodeValues, settingValues, operationValues, changeValues] = await Promise.all([
          request(transaction.objectStore("workspaces").get(reset.workspaceId)),
          request(transaction.objectStore("sync").get(reset.workspaceId)),
          request(pages.getAll()),
          request(transaction.objectStore("hydration-coverage").getAll()),
          request(transaction.objectStore("nodes").getAll()),
          request(transaction.objectStore("settings").getAll()),
          request(transaction.objectStore("operations").getAll()),
          request(transaction.objectStore("changes").getAll()),
        ]);
        if (workspaceValue === undefined || syncValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        const sync = parseSyncState(syncValue);
        if (sync.workspaceId !== workspace.id || sync.deviceId !== reset.deviceId) throw new Error("A reset response does not match the local synchronization device.");
        const plans = resetPlans(pageValues);
        if (plans.length > 1) throw new Error("Multiple cursor reset plans are active.");
        const storedChanges = changeValues.map(parseChangeRecord);
        const published = storedChanges.find((change) => resetChangeMatches(change, reset));
        if (sync.cursor === reset.cursor) {
          if (!published) throw new Error("That reset cursor was already reached with different input.");
          return { kind: "published", changes: storedChanges.filter((change) => change.kind === "reset" && change.operationId === published.operationId).sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)) };
        }
        if (sync.cursor !== reset.fromCursor) throw new Error("A reset response does not start at the local cursor.");
        if (workspace.headSequence > reset.headSequence || workspace.snapshotBarrier > reset.snapshotBarrier || workspace.logFloor > reset.logFloor) throw new Error("A reset response regresses workspace sequence metadata.");
        if (plans.length > 0) {
          const plan = plans[0]!;
          if (!equalValues(plan.reset, reset)) throw new Error("A different cursor reset is already active.");
          const generations = await Promise.all(plan.targets.map(async (target) => {
            const targetId = hydrationTargetId(target);
            const headerValue = await request(pages.get([plan.workspaceId, targetId, -1]));
            if (headerValue === undefined) throw new Error("A reset selector generation is missing.");
            const header = parseStoredHydrationHeader(headerValue);
            if (header.workspaceId !== plan.workspaceId || !equalValues(header.target, target)) throw new Error("A reset selector generation is inconsistent.");
            return { workspaceId: header.workspaceId, deviceId: header.deviceId, generationId: header.generationId, target: header.target };
          }));
          return { kind: "plan", plan: { resetId: plan.resetId, reset, generations } };
        }

        const operations = operationValues.map(parseStoredOperation);
        const targets = deriveResetTargets(reset, coverageValues.map(parseStoredHydrationCoverage), nodeValues.map(parseStoredNodeRecord).map((record) => isPurgeTombstone(record) ? record : nodeRecord(record)), settingValues.map(parseSetting), operations);
        const resetId = parseStableId(createGenerationId(), "A generated reset ID is invalid.");
        const generationIds = targets.map(() => parseStableId(createGenerationId(), "A generated hydration generation ID is invalid."));
        const reservedIds = new Set([resetId, ...generationIds]);
        if (reservedIds.size !== generationIds.length + 1 || operations.some(({ operationId }) => reservedIds.has(operationId)) || storedChanges.some(({ operationId }) => reservedIds.has(operationId))) throw new Error("A generated reset identity collides with durable history.");
        const plan = { workspaceId: reset.workspaceId, targetId: RESET_TARGET_ID, pageIndex: -3, kind: "reset", resetId, reset, targets } satisfies StoredResetPlan;
        const writes: Promise<unknown>[] = [request(pages.add(plan))];
        for (let index = 0; index < targets.length; index += 1) {
          const target = targets[index]!;
          const targetId = hydrationTargetId(target);
          const bootstrapValue = await request(pages.get([reset.workspaceId, targetId, -2]));
          if (bootstrapValue !== undefined) { parseStoredBootstrap(bootstrapValue); throw new Error("A staged bootstrap must finish before cursor reset."); }
          const keys = await request(pages.getAllKeys(keyRange.bound([reset.workspaceId, targetId, -1], [reset.workspaceId, targetId, Number.MAX_SAFE_INTEGER])));
          writes.push(...keys.map((key) => request(pages.delete(key))), request(pages.add({ workspaceId: reset.workspaceId, targetId, pageIndex: -1, kind: "header", deviceId: reset.deviceId, generationId: generationIds[index]!, target, nextPageIndex: 0, pageToken: null, complete: false, lastIdentity: null } satisfies StoredHydrationHeader)));
        }
        await Promise.all(writes);
        return { kind: "plan", plan: { resetId, reset, generations: targets.map((target, index) => ({ workspaceId: reset.workspaceId, deviceId: reset.deviceId, generationId: generationIds[index]!, target })) } };
      });
    },

    restartResetHydration: async (resetIdValue, targetIdValue, createGenerationId) => {
      const resetId = parseStableId(resetIdValue, "A reset ID is invalid.");
      const targetId = parseSha256(targetIdValue, "A hydration target ID is invalid.");
      if (typeof createGenerationId !== "function") throw new TypeError("A reset generation factory is required.");
      return transact(db, "hydration-pages", "readwrite", async (transaction) => {
        const pages = transaction.objectStore("hydration-pages");
        const planValue = await request(pages.getAll());
        const plan = resetPlans(planValue).find((candidate) => candidate.resetId === resetId);
        if (!plan) throw new Error("That cursor reset is no longer active.");
        const target = plan.targets.find((candidate) => hydrationTargetId(candidate) === targetId);
        if (!target) throw new Error("That hydration selector is not part of the cursor reset.");
        const headerValue = await request(pages.get([plan.workspaceId, targetId, -1]));
        if (headerValue === undefined) throw new Error("That reset hydration generation is missing.");
        const header = parseStoredHydrationHeader(headerValue);
        if (header.complete) return { workspaceId: header.workspaceId, deviceId: header.deviceId, generationId: header.generationId, target: header.target };
        const generationId = parseStableId(createGenerationId(), "A generated hydration generation ID is invalid.");
        if (generationId === resetId) throw new Error("A generated hydration generation ID collides with its reset.");
        const keys = await request(pages.getAllKeys(keyRange.bound([plan.workspaceId, targetId, -1], [plan.workspaceId, targetId, Number.MAX_SAFE_INTEGER])));
        await Promise.all([
          ...keys.map((key) => request(pages.delete(key))),
          request(pages.add({ workspaceId: plan.workspaceId, targetId, pageIndex: -1, kind: "header", deviceId: plan.reset.deviceId, generationId, target, nextPageIndex: 0, pageToken: null, complete: false, lastIdentity: null } satisfies StoredHydrationHeader)),
        ]);
        return { workspaceId: plan.workspaceId, deviceId: plan.reset.deviceId, generationId, target };
      });
    },

    beginHydration: async (targetIdValue, generationValue, resetIdValue) => {
      const targetId = parseSha256(targetIdValue, "A hydration target ID is invalid.");
      const generation = parseHydrationGeneration(generationValue);
      const resetId = resetIdValue === undefined ? undefined : parseStableId(resetIdValue, "A reset ID is invalid.");
      if (hydrationTargetId(generation.target) !== targetId) throw new Error("A hydration target ID does not match its selector.");
      await transact(db, ["workspaces", "sync", "hydration-pages"], "readwrite", async (transaction) => {
        const [workspaceValue, syncValue] = await Promise.all([
          request(transaction.objectStore("workspaces").get(generation.workspaceId)),
          request(transaction.objectStore("sync").get(generation.workspaceId)),
        ]);
        if (workspaceValue === undefined || syncValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        const sync = parseSyncState(syncValue);
        if (workspace.id !== sync.workspaceId || sync.deviceId !== generation.deviceId) throw new Error("A hydration generation does not match its local synchronization state.");
        const pages = transaction.objectStore("hydration-pages");
        const plans = resetPlans(await request(pages.getAll()));
        if (plans.length > 0 && (resetId === undefined || !plans.some((plan) => plan.resetId === resetId && plan.targets.some((target) => hydrationTargetId(target) === targetId && equalValues(target, generation.target))))) throw new Error("Ordinary hydration is fenced while cursor reset is active.");
        const [existingValue, bootstrapValue] = await Promise.all([
          request(pages.get([generation.workspaceId, targetId, -1])),
          request(pages.get([generation.workspaceId, targetId, -2])),
        ]);
        if (existingValue !== undefined) {
          const existing = parseStoredHydrationHeader(existingValue);
          if (existing.generationId === generation.generationId && existing.deviceId === generation.deviceId && equalValues(existing.target, generation.target)) {
            await validateCompletedHydrationGeneration(pages, keyRange, existing);
            return;
          }
          if (bootstrapValue !== undefined) {
            parseStoredBootstrap(bootstrapValue);
            throw new Error("A staged bootstrap root must be completed or replaced by another bootstrap response.");
          }
        } else {
          const count = await request(pages.index("by-workspace-kind").count(keyRange.only([generation.workspaceId, "header"])));
          if (count >= WEB2_MAX_BATCH_ITEMS) throw new Error("Too many hydration generations are active.");
        }
        const range = keyRange.bound([generation.workspaceId, targetId, -2], [generation.workspaceId, targetId, Number.MAX_SAFE_INTEGER]);
        const keys = await request(pages.getAllKeys(range));
        await Promise.all([...keys.map((key) => request(pages.delete(key))), request(pages.add({ ...generation, targetId, pageIndex: -1, kind: "header", nextPageIndex: 0, pageToken: null, complete: false, lastIdentity: null } satisfies StoredHydrationHeader))]);
      });
    },

    getHydrationGeneration: async (workspaceIdValue, targetIdValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A hydration workspace ID is invalid.");
      const targetId = parseSha256(targetIdValue, "A hydration target ID is invalid.");
      return transact(db, "hydration-pages", "readonly", async (transaction) => {
        const pages = transaction.objectStore("hydration-pages");
        const value = await request(pages.get([workspaceId, targetId, -1]));
        if (value === undefined) return undefined;
        const header = parseStoredHydrationHeader(value);
        await validateCompletedHydrationGeneration(pages, keyRange, header);
        return { workspaceId: header.workspaceId, deviceId: header.deviceId, generationId: header.generationId, target: header.target };
      });
    },

    getHydrationProgress: async (workspaceIdValue, targetIdValue, generationIdValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A hydration workspace ID is invalid.");
      const targetId = parseSha256(targetIdValue, "A hydration target ID is invalid.");
      const generationId = parseStableId(generationIdValue, "A hydration generation ID is invalid.");
      return transact(db, "hydration-pages", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("hydration-pages").get([workspaceId, targetId, -1]));
        if (value === undefined) return undefined;
        const header = parseStoredHydrationHeader(value);
        if (header.generationId !== generationId) return undefined;
        await validateCompletedHydrationGeneration(transaction.objectStore("hydration-pages"), keyRange, header);
        return { nextPageIndex: header.nextPageIndex, pageToken: header.pageToken, complete: header.complete };
      });
    },

    getHydrationCoverage: async (workspaceIdValue, targetIdValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A hydration workspace ID is invalid.");
      const targetId = parseSha256(targetIdValue, "A hydration target ID is invalid.");
      return transact(db, "hydration-coverage", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("hydration-coverage").get([workspaceId, targetId]));
        return value === undefined ? undefined : parseStoredHydrationCoverage(value);
      });
    },

    getWorkspaceBootstrapState: async (workspaceIdValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A bootstrap workspace ID is invalid.");
      return transact(db, "hydration-pages", "readonly", async (transaction) => {
        const store = transaction.objectStore("hydration-pages");
        const values = await request(store.index("by-workspace-kind").getAll(keyRange.only([workspaceId, "bootstrap"])));
        const bootstraps = values.map(parseStoredBootstrap).filter(({ bootstrap }) => bootstrap.rootPage.target.kind === "folder-page" && bootstrap.rootPage.target.parentId === null).sort((left, right) => right.bootstrap.rootPage.target.asOf - left.bootstrap.rootPage.target.asOf);
        const latest = bootstraps[0];
        if (!latest) return undefined;
        const target = latest.bootstrap.rootPage.target;
        return { target, staged: await request(store.get([workspaceId, hydrationTargetId(target), -1])) !== undefined };
      });
    },

    getHydrationChanges: async (generationIdValue) => {
      const generationId = parseStableId(generationIdValue, "A hydration generation ID is invalid.");
      return transact(db, "changes", "readonly", async (transaction) => {
        const values = await request(transaction.objectStore("changes").index("by-operation-id").getAll(generationId));
        return values.map(parseChangeRecord).filter((change): change is Extract<ChangeRecord, { kind: "hydration" }> => change.kind === "hydration").sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
      });
    },

    stageHydrationPage: async (targetIdValue, requestPageTokenValue, pageValue) => {
      const targetId = parseSha256(targetIdValue, "A hydration target ID is invalid.");
      const requestPageToken = requestPageTokenValue === null ? null : parseHydrationPageToken(requestPageTokenValue);
      const page = parseHydrationPageData(pageValue);
      if (hydrationTargetId(page.target) !== targetId) throw new Error("A hydration target ID does not match its selector.");
      if ((page.pageIndex === 0) !== (requestPageToken === null) || page.pageIndex >= 100_000) throw new Error("A hydration page has invalid request pagination.");
      return transact(db, ["workspaces", "sync", "hydration-pages"], "readwrite", async (transaction) => {
        const pages = transaction.objectStore("hydration-pages");
        const [workspaceValue, syncValue, pageValues] = await Promise.all([
          request(transaction.objectStore("workspaces").get(page.workspaceId)),
          request(transaction.objectStore("sync").get(page.workspaceId)),
          request(pages.getAll()),
        ]);
        if (workspaceValue === undefined || syncValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        const sync = parseSyncState(syncValue);
        if (workspace.id !== sync.workspaceId || sync.deviceId !== page.deviceId) throw new Error("A hydration page does not match its local synchronization state.");
        const plans = resetPlans(pageValues);
        const resetGeneration = plans.some((plan) => plan.workspaceId === page.workspaceId && plan.targets.some((target) => hydrationTargetId(target) === targetId) && pageValues.some((value) => isRecord(value) && value.kind === "header" && value.workspaceId === page.workspaceId && value.targetId === targetId && value.generationId === page.generationId));
        if (plans.length > 0 && !resetGeneration) throw new Error("Ordinary hydration is fenced while cursor reset is active.");
        const nextSync = parseSyncState({ ...sync, lastObservedLogicalTime: Math.max(sync.lastObservedLogicalTime, page.observedLogicalTime) });
        const headerValue = await request(pages.get([page.workspaceId, targetId, -1]));
        if (headerValue === undefined) return false;
        const header = parseStoredHydrationHeader(headerValue);
        if (header.generationId !== page.generationId) return false;
        if (header.targetId !== targetId || header.workspaceId !== page.workspaceId || header.deviceId !== page.deviceId || !equalValues(header.target, page.target)) throw new Error("A hydration page does not match its active generation.");
        if (page.pageIndex < header.nextPageIndex) {
          const existingValue = await request(pages.get([page.workspaceId, targetId, page.pageIndex]));
          const existing = existingValue === undefined ? undefined : parseStoredHydrationPage(existingValue);
          if (!existing || existing.targetId !== targetId || existing.requestPageToken !== requestPageToken || existing.page.generationId !== header.generationId || !equalValues(existing.page.target, header.target) || !equalValues(existing.page, page)) throw new Error("A hydration page index cannot be reused with different content.");
          await validateCompletedHydrationGeneration(pages, keyRange, header);
          if (!resetGeneration) await request(transaction.objectStore("sync").put(nextSync));
          return page.nextPageToken === null;
        }
        if (page.pageIndex !== header.nextPageIndex || header.complete || requestPageToken !== header.pageToken) throw new Error("A hydration page is out of sequence.");
        if (page.nextPageToken !== null && page.nextPageToken === requestPageToken) throw new Error("A hydration continuation token cannot repeat immediately.");
        if (page.pageIndex === 99_999 && page.nextPageToken !== null) throw new Error("A hydration generation is too large.");
        const identities = hydrationPageIdentities(page);
        if (header.lastIdentity !== null && identities.length > 0 && compareCanonicalStrings(header.lastIdentity, identities[0]!) >= 0) throw new Error("Hydration records are not ordered across pages.");
        const complete = page.nextPageToken === null;
        const nextHeader = { ...header, nextPageIndex: page.pageIndex + 1, pageToken: page.nextPageToken, complete, lastIdentity: identities.at(-1) ?? header.lastIdentity } satisfies StoredHydrationHeader;
        const storedPage = { workspaceId: page.workspaceId, targetId, pageIndex: page.pageIndex, kind: "page", requestPageToken, page } satisfies StoredHydrationPage;
        if (complete) {
          const range = keyRange.bound([page.workspaceId, targetId, 0], [page.workspaceId, targetId, Number.MAX_SAFE_INTEGER]);
          const staged = (await request(pages.getAll(range))).map(parseStoredHydrationPage).sort((left, right) => left.pageIndex - right.pageIndex);
          validateStoredHydrationGeneration(nextHeader, [...staged, storedPage]);
        }
        await Promise.all([
          request(pages.add(storedPage)),
          request(pages.put(nextHeader)),
          ...(resetGeneration ? [] : [request(transaction.objectStore("sync").put(nextSync))]),
        ]);
        return complete;
      });
    },

    publishHydration: async (workspaceIdValue, targetIdValue, generationIdValue, bootstrapValue) => {
      const workspaceId = parseStableId(workspaceIdValue, "A hydration workspace ID is invalid.");
      const targetId = parseSha256(targetIdValue, "A hydration target ID is invalid.");
      const generationId = parseStableId(generationIdValue, "A hydration generation ID is invalid.");
      const bootstrap = bootstrapValue === undefined ? undefined : parseFilesystemBootstrap(bootstrapValue);
      if (bootstrap && (bootstrap.accountId !== canonicalAccountId || bootstrap.workspace.id !== workspaceId || bootstrap.rootPage.generationId !== generationId || hydrationTargetId(bootstrap.rootPage.target) !== targetId)) throw new Error("A bootstrap response does not match its storage namespace.");
      return transact(db, ["workspaces", "nodes", "operations", "changes", "sync", "settings", "hydration-pages", "hydration-coverage", "device-preferences"], "readwrite", async (transaction) => {
        const pages = transaction.objectStore("hydration-pages");
        if (resetPlans(await request(pages.getAll())).length > 0) throw new Error("Ordinary hydration is fenced while cursor reset is active.");
        if (bootstrap) {
          const [publishedValue, replayValue] = await Promise.all([
            request(transaction.objectStore("hydration-coverage").get([workspaceId, targetId])),
            request(pages.get([workspaceId, targetId, -2])),
          ]);
          if (publishedValue !== undefined && parseStoredHydrationCoverage(publishedValue).generationId === generationId) {
            if (replayValue === undefined || !equalValues(parseStoredBootstrap(replayValue).bootstrap, bootstrap)) throw new Error("A bootstrap generation cannot be reused with different input.");
            return (await request(transaction.objectStore("changes").index("by-operation-id").getAll(generationId))).map(parseChangeRecord).filter((change): change is Extract<ChangeRecord, { kind: "hydration" }> => change.kind === "hydration").sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
          }
          const deviceValue = await request(transaction.objectStore("device-preferences").get("device"));
          if (deviceValue === undefined || parseStoredDeviceIdentity(deviceValue) !== bootstrap.deviceId) throw new Error("A bootstrap response does not match the durable device identity.");
          const [currentWorkspaceValues, currentSyncValues, storedBootstrapValue, existingHeaderValue] = await Promise.all([
            request(transaction.objectStore("workspaces").getAll()),
            request(transaction.objectStore("sync").getAll()),
            request(pages.get([workspaceId, targetId, -2])),
            request(pages.get([workspaceId, targetId, -1])),
          ]);
          const current = parseWorkspaceList(currentWorkspaceValues);
          const currentById = new Map(current.map((candidate) => [candidate.id, candidate]));
          const syncById = new Map(currentSyncValues.map(parseSyncState).map((candidate) => [candidate.workspaceId, candidate]));
          if (current.some(({ id }) => !syncById.has(id)) || [...syncById.values()].some((state) => state.deviceId !== bootstrap.deviceId || !currentById.has(state.workspaceId))) throw new Error("Stored synchronization state does not match the bootstrap device and directory.");
          const activeCurrent = currentById.get(workspaceId);
          const activeSync = syncById.get(workspaceId);
          if ((activeCurrent === undefined) !== (activeSync === undefined)) throw new Error("Stored bootstrap workspace state is incomplete.");
          if (activeCurrent && activeSync) {
            const unhydrated = activeCurrent.headSequence === 0 && activeSync.cursor === 0 && activeSync.lastHydrationAsOf === 0;
            if (!unhydrated && activeSync.cursor !== bootstrap.cursor) throw new Error("A bootstrap cursor diverges from the local workspace projection.");
            if (activeCurrent.headSequence > bootstrap.workspace.headSequence || activeCurrent.snapshotBarrier > bootstrap.workspace.snapshotBarrier || activeCurrent.logFloor > bootstrap.workspace.logFloor || activeSync.lastHydrationAsOf > bootstrap.workspace.headSequence) throw new Error("A bootstrap response regresses the local workspace projection.");
          }
          const previousBootstrap = storedBootstrapValue === undefined ? undefined : parseStoredBootstrap(storedBootstrapValue);
          if (previousBootstrap?.bootstrap.rootPage.generationId === generationId && !equalValues(previousBootstrap.bootstrap, bootstrap)) throw new Error("A bootstrap generation cannot be reused with different input.");

          const remoteIds = new Set(bootstrap.workspaces.map(({ id }) => id));
          const retained = current.filter(({ id }) => !remoteIds.has(id));
          const orderedSummaries = [
            ...bootstrap.workspaces.filter(({ pinned }) => pinned),
            ...retained.filter(({ pinned }) => pinned),
            ...bootstrap.workspaces.filter(({ pinned }) => !pinned),
            ...retained.filter(({ pinned }) => !pinned),
          ];
          if (orderedSummaries.length > MAX_WORKSPACES || new Set(orderedSummaries.map(({ name }) => workspaceNameKey(name))).size !== orderedSummaries.length) throw new Error("The bootstrap workspace directory conflicts with retained local workspaces.");
          const nextWorkspaces = orderedSummaries.map((summary, ordinal) => {
            const existing = currentById.get(summary.id);
            const sequence = summary.id === workspaceId ? bootstrap.workspace : existing ?? { headSequence: 0, snapshotBarrier: 0, logFloor: 0 };
            return parseWorkspace({ ...summary, ordinal, headSequence: sequence.headSequence, snapshotBarrier: sequence.snapshotBarrier, logFloor: sequence.logFloor, localRevision: existing?.localRevision ?? 0 });
          });
          const nextSyncs = bootstrap.workspaces.map(({ id }) => {
            const existing = syncById.get(id);
            if (id === workspaceId) return parseSyncState({
              workspaceId: id,
              deviceId: bootstrap.deviceId,
              cursor: bootstrap.cursor,
              lastHydrationAsOf: existing?.lastHydrationAsOf ?? 0,
              lastObservedLogicalTime: Math.max(existing?.lastObservedLogicalTime ?? 0, bootstrap.rootPage.observedLogicalTime),
              lastLocalLogicalTime: existing?.lastLocalLogicalTime ?? 0,
            });
            return existing ?? parseSyncState({ workspaceId: id, deviceId: bootstrap.deviceId, cursor: 0, lastHydrationAsOf: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 });
          });
          const header = existingHeaderValue === undefined ? undefined : parseStoredHydrationHeader(existingHeaderValue);
          const replacingGeneration = header !== undefined && header.generationId !== generationId;
          if (header && !replacingGeneration && (header.deviceId !== bootstrap.deviceId || !equalValues(header.target, bootstrap.rootPage.target))) throw new Error("A bootstrap root conflicts with an active hydration generation.");
          const storedPageValue = await request(pages.get([workspaceId, targetId, 0]));
          if (!replacingGeneration && storedPageValue !== undefined && !equalValues(parseStoredHydrationPage(storedPageValue).page, bootstrap.rootPage)) throw new Error("A bootstrap root page cannot be reused with different input.");
          const preserveProgress = header !== undefined && !replacingGeneration && storedPageValue !== undefined;
          const complete = preserveProgress ? header.complete : bootstrap.rootPage.nextPageToken === null;
          const identities = hydrationPageIdentities(bootstrap.rootPage);
          const storedBootstrap = { workspaceId, targetId, pageIndex: -2, kind: "bootstrap", bootstrap } satisfies StoredBootstrap;
          const nextHeader = { workspaceId, targetId, pageIndex: -1, kind: "header", deviceId: bootstrap.deviceId, generationId, target: bootstrap.rootPage.target, nextPageIndex: 1, pageToken: bootstrap.rootPage.nextPageToken, complete, lastIdentity: identities.at(-1) ?? null } satisfies StoredHydrationHeader;
          const storedPage = { workspaceId, targetId, pageIndex: 0, kind: "page", requestPageToken: null, page: bootstrap.rootPage } satisfies StoredHydrationPage;
          if (!preserveProgress && complete) validateStoredHydrationGeneration(nextHeader, [storedPage]);
          const replacedKeys = replacingGeneration ? await request(pages.getAllKeys(keyRange.bound([workspaceId, targetId, -2], [workspaceId, targetId, Number.MAX_SAFE_INTEGER]))) : [];
          await Promise.all([
            ...nextWorkspaces.map((candidate) => request(transaction.objectStore("workspaces").put(candidate))),
            ...nextSyncs.map((candidate) => request(transaction.objectStore("sync").put(candidate))),
            ...replacedKeys.map((key) => request(pages.delete(key))),
            request(pages.put(storedBootstrap)),
            ...(preserveProgress ? [] : [request(pages.put(nextHeader)), request(pages.put(storedPage))]),
          ]);
          if (!complete) return [];
        }
        const [workspaceValues, syncValues, headerValue, storedBootstrapValue] = await Promise.all([
          request(transaction.objectStore("workspaces").getAll()),
          request(transaction.objectStore("sync").getAll()),
          request(pages.get([workspaceId, targetId, -1])),
          request(pages.get([workspaceId, targetId, -2])),
        ]);
        const workspaces = new Map(workspaceValues.map(parseWorkspace).map((candidate) => [candidate.id, candidate]));
        const syncs = new Map(syncValues.map(parseSyncState).map((candidate) => [candidate.workspaceId, candidate]));
        const workspace = workspaces.get(workspaceId);
        const sync = syncs.get(workspaceId);
        if (workspace === undefined || sync === undefined) throw new Error("That workspace does not exist.");
        if (headerValue === undefined) throw new Error("That hydration generation is not staged.");
        const header = parseStoredHydrationHeader(headerValue);
        if (!header.complete) throw new Error("That hydration generation is incomplete.");
        if (workspace.id !== sync.workspaceId || header.targetId !== targetId || header.workspaceId !== workspaceId || header.deviceId !== sync.deviceId || header.generationId !== generationId || hydrationTargetId(header.target) !== targetId) throw new Error("That hydration generation does not match its staged projection.");
        const generation = parseHydrationGeneration({ workspaceId, deviceId: sync.deviceId, generationId, target: header.target });
        if (generation.target.asOf < Math.max(sync.cursor, sync.lastHydrationAsOf)) throw new Error("That hydration generation is older than the published workspace projection.");

        const storedBootstrap = storedBootstrapValue === undefined ? undefined : parseStoredBootstrap(storedBootstrapValue);
        if (storedBootstrap && (storedBootstrap.bootstrap.deviceId !== sync.deviceId || storedBootstrap.bootstrap.rootPage.generationId !== generationId || !equalValues(storedBootstrap.bootstrap.rootPage.target, generation.target))) throw new Error("The staged bootstrap does not match its hydration generation.");
        if (storedBootstrap) {
          const bootstrapSettings = new Map(storedBootstrap.bootstrap.workspaceSettings.map((setting) => [setting.key, setting]));
          const settings = transaction.objectStore("settings");
          await Promise.all(WEB2_BOOTSTRAP_SETTING_KEYS.map((key) => {
            const setting = bootstrapSettings.get(key);
            return setting ? request(settings.put(setting)) : request(settings.delete([workspaceId, "desktop-grid", key]));
          }));
        }

        const pageRange = keyRange.bound([generation.workspaceId, targetId, 0], [generation.workspaceId, targetId, Number.MAX_SAFE_INTEGER]);
        const [pageValues, nodeValues, settingValues, operationValues, coverageValues] = await Promise.all([
          request(pages.getAll(pageRange)),
          request(transaction.objectStore("nodes").getAll()),
          request(transaction.objectStore("settings").getAll()),
          request(transaction.objectStore("operations").getAll()),
          request(transaction.objectStore("hydration-coverage").getAll()),
        ]);
        const staged = pageValues.map(parseStoredHydrationPage).sort((left, right) => left.pageIndex - right.pageIndex);
        validateStoredHydrationGeneration(header, staged);
        const currentNodes = new Map<string, NodeRecord>(nodeValues.map(parseStoredNodeRecord).map((record) => [record.id, isPurgeTombstone(record) ? record : nodeRecord(record)]));
        const currentSettings = new Map(settingValues.map(parseSetting).map((setting) => [`${setting.workspaceId}\0${setting.namespace}\0${setting.key}`, setting]));
        const coverages = coverageValues.map(parseStoredHydrationCoverage).filter((coverage) => coverage.workspaceId === generation.workspaceId);
        const operations = operationValues.map(parseStoredOperation);
        const projected = projectHydrationBases([{ targetId, header, staged }], currentNodes, currentSettings, coverages, new Set(), replaceableRejectedPurgeNodeIds(operations, generation.workspaceId));
        const { projectedNodes, projectedSettings, coveredNodeIds, authoritativeNodeIds, completeSiblingIds, obsoleteCoverageIds } = projected;

        if (operations.some(({ operationId }) => operationId === generation.generationId)) throw new Error("A hydration generation ID collides with an operation.");
        const pending = operations.filter((stored) => retainsOperationOverlay(stored) && (stored.operation.kind === "transfer" ? workspaces.has(stored.operation.destinationWorkspaceId) : workspaces.has(stored.operation.workspaceId))).sort((left, right) => compareOperationTuples(operationTuple(left), operationTuple(right)));
        const hierarchyNodes = new Set<string>();
        const siblingNodes = new Set<string>();
        const deferredOperations = new Set<string>();
        for (const operation of pending) replayPendingOperation(projectedNodes, projectedSettings, currentSettings, coveredNodeIds, hierarchyNodes, siblingNodes, deferredOperations, operation);
        validateProjectedNodes(projectedNodes, authoritativeNodeIds, hierarchyNodes, new Set([...siblingNodes, ...completeSiblingIds]), projected.allowAuthoritativePurgeParent);

        const nodeStore = transaction.objectStore("nodes");
        const settingStore = transaction.objectStore("settings");
        const affectedByWorkspace = new Map<string, Set<string>>();
        const affected = (id: string) => {
          const existing = affectedByWorkspace.get(id) ?? new Set<string>();
          affectedByWorkspace.set(id, existing);
          return existing;
        };
        const touchNode = (record: NodeRecord) => {
          const identities = affected(record.workspaceId);
          identities.add(`node:${record.workspaceId}:${record.id}`);
          if (isPurgeTombstone(record)) { identities.add(`trash:${record.workspaceId}`); return; }
          identities.add(`folder:${record.workspaceId}:${record.parentId ?? "root"}`);
          if (record.kind === "file") identities.add(`content:${record.workspaceId}:${record.id}`);
          if (record.lifecycle.kind === "trashed") identities.add(`trash:${record.workspaceId}`);
        };
        const targetAffected = affected(generation.workspaceId);
        hydrationTargetAffectedIdentities(generation.target).forEach((identity) => targetAffected.add(identity));
        if (storedBootstrap) {
          for (const key of WEB2_BOOTSTRAP_SETTING_KEYS) targetAffected.add(`setting:${generation.workspaceId}:desktop-grid:${key}`);
          targetAffected.add(`setting-namespace:${generation.workspaceId}:desktop-grid`);
        }
        const writes: Promise<unknown>[] = [];
        for (const operation of pending) if (deferredOperations.has(operation.operationId)) writes.push(request(transaction.objectStore("operations").put({ ...operation, overlayKind: "deferred" })));
        for (const [id, current] of currentNodes) {
          const projected = projectedNodes.get(id);
          if (projected === undefined) {
            writes.push(request(nodeStore.delete(id)));
            touchNode(current);
          } else if (!equalValues(current, projected)) {
            writes.push(request(nodeStore.put(isPurgeTombstone(projected) ? projected : storeNode(projected))));
            touchNode(current);
            touchNode(projected);
          }
        }
        for (const [id, projected] of projectedNodes) if (!currentNodes.has(id)) {
          writes.push(request(nodeStore.add(isPurgeTombstone(projected) ? projected : storeNode(projected))));
          touchNode(projected);
        }
        for (const [storageKey, current] of currentSettings) {
          const projected = projectedSettings.get(storageKey);
          if (projected === undefined) {
            writes.push(request(settingStore.delete([current.workspaceId, current.namespace, current.key])));
            affected(current.workspaceId).add(`setting:${current.workspaceId}:${current.namespace}:${current.key}`);
          } else if (!equalValues(current, projected)) {
            writes.push(request(settingStore.put(projected)));
            affected(current.workspaceId).add(`setting:${current.workspaceId}:${current.namespace}:${current.key}`);
            affected(projected.workspaceId).add(`setting:${projected.workspaceId}:${projected.namespace}:${projected.key}`);
          }
        }
        for (const [storageKey, projected] of projectedSettings) if (!currentSettings.has(storageKey)) {
          writes.push(request(settingStore.add(projected)));
          affected(projected.workspaceId).add(`setting:${projected.workspaceId}:${projected.namespace}:${projected.key}`);
        }
        await Promise.all(writes);

        const coverage = projected.nextCoverages[0]!;
        const coverageStore = transaction.objectStore("hydration-coverage");
        const obsoleteCoverages = coverages.filter((candidate) => obsoleteCoverageIds.has(candidate.targetId) && candidate.targetId !== targetId);
        const workspaceCoverages = coverages.filter((candidate) => candidate.workspaceId === generation.workspaceId && candidate.targetId !== targetId && !obsoleteCoverageIds.has(candidate.targetId)).sort((left, right) => left.target.asOf - right.target.asOf || left.targetId.localeCompare(right.targetId));
        const evictions: Promise<unknown>[] = [];
        for (const obsolete of obsoleteCoverages) {
          hydrationTargetAffectedIdentities(obsolete.target).forEach((identity) => targetAffected.add(identity));
          evictions.push(request(coverageStore.delete([generation.workspaceId, obsolete.targetId])));
        }
        while (workspaceCoverages.length >= WEB2_MAX_BATCH_ITEMS) {
          const evicted = workspaceCoverages.shift()!;
          hydrationTargetAffectedIdentities(evicted.target).forEach((identity) => targetAffected.add(identity));
          evictions.push(request(coverageStore.delete([generation.workspaceId, evicted.targetId])));
        }
        await Promise.all(evictions);
        const stageKeys = await request(pages.getAllKeys(keyRange.bound([generation.workspaceId, targetId, -1], [generation.workspaceId, targetId, Number.MAX_SAFE_INTEGER])));

        const changes = [...affectedByWorkspace].map(([changedWorkspaceId, identities]) => {
          const changedWorkspace = workspaces.get(changedWorkspaceId);
          if (!changedWorkspace || !syncs.has(changedWorkspaceId)) throw new Error("Hydration overlays reference a workspace that does not exist.");
          return parseChangeRecord({ kind: "hydration", workspaceId: changedWorkspaceId, revision: changedWorkspace.localRevision + 1, operationId: generation.generationId, targetId, affectedIdentities: [...identities].sort() });
        });
        const observedLogicalTime = Math.max(...staged.map(({ page }) => page.observedLogicalTime));
        await Promise.all([
          request(coverageStore.put(coverage)),
          ...stageKeys.map((key) => request(pages.delete(key))),
          ...changes.map((candidate) => request(transaction.objectStore("workspaces").put({ ...workspaces.get(candidate.workspaceId)!, localRevision: candidate.revision }))),
          ...changes.map((candidate) => request(transaction.objectStore("sync").put(parseSyncState({ ...syncs.get(candidate.workspaceId)!, lastHydrationAsOf: candidate.workspaceId === generation.workspaceId ? Math.max(syncs.get(candidate.workspaceId)!.lastHydrationAsOf, generation.target.asOf) : syncs.get(candidate.workspaceId)!.lastHydrationAsOf, lastObservedLogicalTime: Math.max(syncs.get(candidate.workspaceId)!.lastObservedLogicalTime, observedLogicalTime) })))),
          ...changes.map((candidate) => request(transaction.objectStore("changes").add(candidate))),
        ]);
        return changes;
      });
    },

    publishReset: async (resetIdValue, createGenerationId) => {
      const resetId = parseStableId(resetIdValue, "A reset ID is invalid.");
      if (typeof createGenerationId !== "function") throw new TypeError("A reset generation factory is required.");
      return transact(db, ["workspaces", "nodes", "operations", "changes", "sync", "settings", "hydration-pages", "hydration-coverage"], "readwrite", async (transaction): Promise<ResetPublication> => {
        const pages = transaction.objectStore("hydration-pages");
        const [workspaceValues, syncValues, pageValues, nodeValues, settingValues, operationValues, coverageValues, changeValues] = await Promise.all([
          request(transaction.objectStore("workspaces").getAll()),
          request(transaction.objectStore("sync").getAll()),
          request(pages.getAll()),
          request(transaction.objectStore("nodes").getAll()),
          request(transaction.objectStore("settings").getAll()),
          request(transaction.objectStore("operations").getAll()),
          request(transaction.objectStore("hydration-coverage").getAll()),
          request(transaction.objectStore("changes").getAll()),
        ]);
        const storedChanges = changeValues.map(parseChangeRecord);
        const plan = resetPlans(pageValues).find((candidate) => candidate.resetId === resetId);
        if (!plan) {
          const recovered = storedChanges.filter((change) => change.kind === "reset" && change.operationId === resetId).sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
          if (recovered.length > 0) return { kind: "published", changes: recovered };
          throw new Error("That cursor reset is no longer active.");
        }
        const reset = plan.reset;
        const workspaces = new Map(workspaceValues.map(parseWorkspace).map((candidate) => [candidate.id, candidate]));
        const syncs = new Map(syncValues.map(parseSyncState).map((candidate) => [candidate.workspaceId, candidate]));
        const workspace = workspaces.get(reset.workspaceId);
        const sync = syncs.get(reset.workspaceId);
        if (!workspace || !sync || sync.deviceId !== reset.deviceId || sync.cursor !== reset.fromCursor) throw new Error("The active cursor reset no longer matches local synchronization state.");
        if (workspace.headSequence > reset.headSequence || workspace.snapshotBarrier > reset.snapshotBarrier || workspace.logFloor > reset.logFloor) throw new Error("The active cursor reset regresses workspace sequence metadata.");
        const currentNodes = new Map<string, NodeRecord>(nodeValues.map(parseStoredNodeRecord).map((record) => [record.id, isPurgeTombstone(record) ? record : nodeRecord(record)]));
        const currentSettings = new Map(settingValues.map(parseSetting).map((setting) => [`${setting.workspaceId}\0${setting.namespace}\0${setting.key}`, setting]));
        const operations = operationValues.map(parseStoredOperation);
        if (operations.some(({ operationId }) => operationId === resetId)) throw new Error("A cursor reset ID collides with an operation.");
        const coverages = coverageValues.map(parseStoredHydrationCoverage);
        const requiredTargets = deriveResetTargets(reset, coverages, [...currentNodes.values()], [...currentSettings.values()], operations);
        const targetsById = new Map(plan.targets.map((target) => [hydrationTargetId(target), target]));
        const missingTargets = requiredTargets.filter((target) => !targetsById.has(hydrationTargetId(target)));
        if (missingTargets.length > 0) {
          missingTargets.forEach((target) => targetsById.set(hydrationTargetId(target), target));
          const targets = [...targetsById.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, target]) => target);
          if (targets.length > WEB2_MAX_BATCH_ITEMS) throw new Error("The cursor reset selector plan is too large.");
          const generationByTarget = new Map<string, HydrationGeneration>();
          for (const target of plan.targets) {
            const targetId = hydrationTargetId(target);
            const headerValue = await request(pages.get([reset.workspaceId, targetId, -1]));
            if (headerValue === undefined) throw new Error("A reset selector generation is missing.");
            const header = parseStoredHydrationHeader(headerValue);
            generationByTarget.set(targetId, { workspaceId: header.workspaceId, deviceId: header.deviceId, generationId: header.generationId, target: header.target });
          }
          const writes: Promise<unknown>[] = [request(pages.put({ ...plan, targets } satisfies StoredResetPlan))];
          for (const target of missingTargets) {
            const targetId = hydrationTargetId(target);
            const generationId = parseStableId(createGenerationId(), "A generated hydration generation ID is invalid.");
            if (generationId === resetId || operations.some(({ operationId }) => operationId === generationId) || storedChanges.some(({ operationId }) => operationId === generationId) || [...generationByTarget.values()].some((generation) => generation.generationId === generationId)) throw new Error("A generated hydration generation ID collides with durable history.");
            const keys = await request(pages.getAllKeys(keyRange.bound([reset.workspaceId, targetId, -1], [reset.workspaceId, targetId, Number.MAX_SAFE_INTEGER])));
            writes.push(...keys.map((key) => request(pages.delete(key))), request(pages.add({ workspaceId: reset.workspaceId, targetId, pageIndex: -1, kind: "header", deviceId: reset.deviceId, generationId, target, nextPageIndex: 0, pageToken: null, complete: false, lastIdentity: null } satisfies StoredHydrationHeader)));
            generationByTarget.set(targetId, { workspaceId: reset.workspaceId, deviceId: reset.deviceId, generationId, target });
          }
          await Promise.all(writes);
          return { kind: "plan", plan: { resetId, reset, generations: targets.map((target) => generationByTarget.get(hydrationTargetId(target))!) } };
        }

        const completed: CompletedHydration[] = [];
        const generations: HydrationGeneration[] = [];
        for (const target of plan.targets) {
          const targetId = hydrationTargetId(target);
          const headerValue = await request(pages.get([reset.workspaceId, targetId, -1]));
          if (headerValue === undefined) throw new Error("A reset selector generation is missing.");
          const header = parseStoredHydrationHeader(headerValue);
          if (header.workspaceId !== reset.workspaceId || header.deviceId !== reset.deviceId || !equalValues(header.target, target)) throw new Error("A reset selector generation is inconsistent.");
          generations.push({ workspaceId: header.workspaceId, deviceId: header.deviceId, generationId: header.generationId, target: header.target });
          if (!header.complete) return { kind: "plan", plan: { resetId, reset, generations } };
          const values = await request(pages.getAll(keyRange.bound([reset.workspaceId, targetId, 0], [reset.workspaceId, targetId, Number.MAX_SAFE_INTEGER])));
          const staged = values.map(parseStoredHydrationPage).sort((left, right) => left.pageIndex - right.pageIndex);
          validateStoredHydrationGeneration(header, staged);
          completed.push({ targetId, header, staged });
        }

        const resetCoverages = coverages.filter((coverage) => coverage.workspaceId === reset.workspaceId).map((coverage) => ({ ...coverage, target: { ...coverage.target, asOf: Math.min(coverage.target.asOf, reset.resetBarrier) } }));
        const projected = projectHydrationBases(completed, currentNodes, currentSettings, resetCoverages, incomingTransferOverlayNodeIds(operations, reset.workspaceId), replaceableRejectedPurgeNodeIds(operations, reset.workspaceId));
        const pending = operations.filter((stored) => retainsOperationOverlay(stored) && (stored.operation.kind === "transfer" ? workspaces.has(stored.operation.destinationWorkspaceId) : workspaces.has(stored.operation.workspaceId))).sort((left, right) => compareOperationTuples(operationTuple(left), operationTuple(right)));
        const hierarchyNodes = new Set<string>();
        const siblingNodes = new Set<string>();
        const deferredOperations = new Set<string>();
        for (const operation of pending) replayPendingOperation(projected.projectedNodes, projected.projectedSettings, currentSettings, projected.coveredNodeIds, hierarchyNodes, siblingNodes, deferredOperations, operation);
        validateIncomingTransferParents(projected.projectedNodes, pending, reset.workspaceId, deferredOperations);
        validateProjectedNodes(projected.projectedNodes, projected.authoritativeNodeIds, hierarchyNodes, new Set([...siblingNodes, ...projected.completeSiblingIds]), projected.allowAuthoritativePurgeParent);

        const affectedByWorkspace = new Map<string, Set<string>>();
        const affected = (workspaceId: string) => {
          const identities = affectedByWorkspace.get(workspaceId) ?? new Set<string>();
          affectedByWorkspace.set(workspaceId, identities);
          return identities;
        };
        const touchNode = (record: NodeRecord) => {
          const identities = affected(record.workspaceId);
          identities.add(`node:${record.workspaceId}:${record.id}`);
          if (isPurgeTombstone(record)) { identities.add(`trash:${record.workspaceId}`); return; }
          identities.add(`folder:${record.workspaceId}:${record.parentId ?? "root"}`);
          if (record.kind === "file") identities.add(`content:${record.workspaceId}:${record.id}`);
          if (record.lifecycle.kind === "trashed") identities.add(`trash:${record.workspaceId}`);
        };
        const resetAffected = affected(reset.workspaceId);
        plan.targets.forEach((target) => hydrationTargetAffectedIdentities(target).forEach((identity) => resetAffected.add(identity)));
        const writes: Promise<unknown>[] = [];
        const operationStore = transaction.objectStore("operations");
        for (const operation of pending) if (deferredOperations.has(operation.operationId)) writes.push(request(operationStore.put({ ...operation, overlayKind: "deferred" })));
        const nodeStore = transaction.objectStore("nodes");
        for (const [id, current] of currentNodes) {
          const next = projected.projectedNodes.get(id);
          if (next === undefined) { writes.push(request(nodeStore.delete(id))); touchNode(current); }
          else if (!equalValues(current, next)) { writes.push(request(nodeStore.put(isPurgeTombstone(next) ? next : storeNode(next)))); touchNode(current); touchNode(next); }
        }
        for (const [id, next] of projected.projectedNodes) if (!currentNodes.has(id)) { writes.push(request(nodeStore.add(isPurgeTombstone(next) ? next : storeNode(next)))); touchNode(next); }
        const settingStore = transaction.objectStore("settings");
        for (const [key, current] of currentSettings) {
          const next = projected.projectedSettings.get(key);
          if (next === undefined) { writes.push(request(settingStore.delete([current.workspaceId, current.namespace, current.key]))); affected(current.workspaceId).add(`setting:${current.workspaceId}:${current.namespace}:${current.key}`); affected(current.workspaceId).add(`setting-namespace:${current.workspaceId}:${current.namespace}`); }
          else if (!equalValues(current, next)) { writes.push(request(settingStore.put(next))); affected(current.workspaceId).add(`setting:${current.workspaceId}:${current.namespace}:${current.key}`); affected(current.workspaceId).add(`setting-namespace:${current.workspaceId}:${current.namespace}`); }
        }
        for (const [key, next] of projected.projectedSettings) if (!currentSettings.has(key)) { writes.push(request(settingStore.add(next))); affected(next.workspaceId).add(`setting:${next.workspaceId}:${next.namespace}:${next.key}`); affected(next.workspaceId).add(`setting-namespace:${next.workspaceId}:${next.namespace}`); }

        const coverageStore = transaction.objectStore("hydration-coverage");
        const nextCoverageIds = new Set(projected.nextCoverages.map(({ targetId }) => targetId));
        const retainedCoverages = coverages.filter((coverage) => coverage.workspaceId !== reset.workspaceId || !projected.obsoleteCoverageIds.has(coverage.targetId) && !nextCoverageIds.has(coverage.targetId));
        for (const coverage of coverages) if (coverage.workspaceId === reset.workspaceId && projected.obsoleteCoverageIds.has(coverage.targetId) && !nextCoverageIds.has(coverage.targetId)) {
          hydrationTargetAffectedIdentities(coverage.target).forEach((identity) => resetAffected.add(identity));
          writes.push(request(coverageStore.delete([coverage.workspaceId, coverage.targetId])));
        }
        const workspaceRetained = retainedCoverages.filter((coverage) => coverage.workspaceId === reset.workspaceId).sort((left, right) => left.target.asOf - right.target.asOf || left.targetId.localeCompare(right.targetId));
        while (workspaceRetained.length + projected.nextCoverages.length > WEB2_MAX_BATCH_ITEMS) {
          const evicted = workspaceRetained.shift();
          if (!evicted) throw new Error("The cursor reset publishes too many selector coverages.");
          hydrationTargetAffectedIdentities(evicted.target).forEach((identity) => resetAffected.add(identity));
          writes.push(request(coverageStore.delete([evicted.workspaceId, evicted.targetId])));
        }
        projected.nextCoverages.forEach((coverage) => writes.push(request(coverageStore.put(coverage))));
        const stageKeys = await Promise.all(plan.targets.map((target) => request(pages.getAllKeys(keyRange.bound([reset.workspaceId, hydrationTargetId(target), -1], [reset.workspaceId, hydrationTargetId(target), Number.MAX_SAFE_INTEGER])))));
        writes.push(...stageKeys.flat().map((key) => request(pages.delete(key))), request(pages.delete([reset.workspaceId, RESET_TARGET_ID, -3])));
        await Promise.all(writes);

        const pageObservedLogicalTime = completed.flatMap(({ staged }) => staged.map(({ page }) => page.observedLogicalTime));
        const observedLogicalTime = Math.max(reset.observedLogicalTime, ...pageObservedLogicalTime);
        const changes = [...affectedByWorkspace].map(([changedWorkspaceId, identities]) => {
          const current = workspaces.get(changedWorkspaceId);
          if (!current || !syncs.has(changedWorkspaceId)) throw new Error("Reset overlays reference a workspace that does not exist.");
          return parseChangeRecord({ kind: "reset", workspaceId: changedWorkspaceId, revision: current.localRevision + 1, operationId: resetId, fromCursor: reset.fromCursor, cursor: reset.cursor, headSequence: reset.headSequence, snapshotBarrier: reset.snapshotBarrier, logFloor: reset.logFloor, observedLogicalTime: reset.observedLogicalTime, affectedIdentities: [...identities].sort() });
        });
        const nextWorkspaces = new Map(workspaces);
        const nextSyncs = new Map(syncs);
        nextWorkspaces.set(reset.workspaceId, parseWorkspace({ ...workspace, headSequence: reset.headSequence, snapshotBarrier: reset.snapshotBarrier, logFloor: reset.logFloor }));
        nextSyncs.set(reset.workspaceId, parseSyncState({ ...sync, cursor: reset.cursor, lastHydrationAsOf: reset.resetBarrier, lastObservedLogicalTime: Math.max(sync.lastObservedLogicalTime, observedLogicalTime) }));
        for (const change of changes) {
          nextWorkspaces.set(change.workspaceId, parseWorkspace({ ...nextWorkspaces.get(change.workspaceId)!, localRevision: change.revision }));
          nextSyncs.set(change.workspaceId, parseSyncState({ ...nextSyncs.get(change.workspaceId)!, lastObservedLogicalTime: Math.max(nextSyncs.get(change.workspaceId)!.lastObservedLogicalTime, observedLogicalTime) }));
        }
        await Promise.all([
          ...Array.from(nextWorkspaces.values(), (candidate) => request(transaction.objectStore("workspaces").put(candidate))),
          ...Array.from(nextSyncs.values(), (candidate) => request(transaction.objectStore("sync").put(candidate))),
          ...changes.map((change) => request(transaction.objectStore("changes").add(change))),
        ]);
        return { kind: "published", changes };
      });
    },

    applyPullOperations: async (value) => {
      const pull = parseFilesystemPullOperations(value);
      return transact(db, ["workspaces", "nodes", "operations", "changes", "sync", "settings", "hydration-pages", "hydration-coverage"], "readwrite", async (transaction) => {
        if (resetPlans(await request(transaction.objectStore("hydration-pages").getAll())).length > 0) throw new Error("Operation pulls are fenced while cursor reset is active.");
        const [workspaceValues, syncValues, nodeValues, settingValues, operationValues, coverageValues, changeValues] = await Promise.all([
          request(transaction.objectStore("workspaces").getAll()),
          request(transaction.objectStore("sync").getAll()),
          request(transaction.objectStore("nodes").getAll()),
          request(transaction.objectStore("settings").getAll()),
          request(transaction.objectStore("operations").getAll()),
          request(transaction.objectStore("hydration-coverage").getAll()),
          request(transaction.objectStore("changes").getAll()),
        ]);
        const workspaces = new Map(workspaceValues.map(parseWorkspace).map((candidate) => [candidate.id, candidate]));
        const syncs = new Map(syncValues.map(parseSyncState).map((candidate) => [candidate.workspaceId, candidate]));
        const workspace = workspaces.get(pull.workspaceId);
        const sync = syncs.get(pull.workspaceId);
        if (!workspace || !sync) throw new Error("That workspace does not exist.");
        if (sync.deviceId !== pull.deviceId) throw new Error("A pull response does not match the local synchronization device.");
        const terminalOperationId = pull.operations.at(-1)?.operationId;
        if (sync.cursor === pull.cursor) {
          if (!terminalOperationId) return [];
          const replayed = changeValues.map(parseChangeRecord).filter((change): change is Extract<ChangeRecord, { kind: "pull" }> => change.kind === "pull" && change.fromCursor === pull.fromCursor && change.cursor === pull.cursor && change.operationId === terminalOperationId).sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
          if (replayed.length === 0) throw new Error("That pull cursor range was already applied with different input.");
          return replayed;
        }
        if (sync.cursor !== pull.fromCursor) throw new Error("A pull response does not start at the local cursor.");
        if (workspace.headSequence > pull.headSequence || workspace.snapshotBarrier > pull.snapshotBarrier || workspace.logFloor > pull.logFloor) throw new Error("A pull response regresses workspace sequence metadata.");
        const projectedCompanionCursors = new Map([...syncs].map(([workspaceId, state]) => [workspaceId, state.cursor]));
        const companionAlreadyApplied = pull.operations.map(({ companion }) => {
          if (!companion) return false;
          const companionWorkspace = workspaces.get(companion.workspaceId);
          const companionSync = syncs.get(companion.workspaceId);
          if (!companionWorkspace || !companionSync || companionSync.deviceId !== pull.deviceId) throw new Error("A pull companion workspace does not exist on this device.");
          const projectedCursor = projectedCompanionCursors.get(companion.workspaceId)!;
          if (projectedCursor < companion.sequence - 1) throw new Error("A pull companion workspace must apply its preceding sequence first.");
          if (projectedCursor === companion.sequence - 1) projectedCompanionCursors.set(companion.workspaceId, companion.sequence);
          return projectedCursor >= companion.sequence;
        });

        const currentNodes = new Map<string, NodeRecord>(nodeValues.map(parseStoredNodeRecord).map((record) => [record.id, isPurgeTombstone(record) ? record : nodeRecord(record)]));
        const projectedNodes = new Map(currentNodes);
        const currentSettings = new Map(settingValues.map(parseSetting).map((setting) => [`${setting.workspaceId}\0${setting.namespace}\0${setting.key}`, setting]));
        const projectedSettings = new Map(currentSettings);
        const authoritativeNodeIds = new Set<string>();
        const recordWorkspaceIds = new Set<string>();
        for (let index = 0; index < pull.operations.length; index += 1) {
          const operation = pull.operations[index]!;
          for (const record of operation.nodes) {
            projectedNodes.set(record.id, companionAlreadyApplied[index] ? mergePulledNode(record, projectedNodes.get(record.id)) : record);
            authoritativeNodeIds.add(record.id);
            recordWorkspaceIds.add(record.workspaceId);
          }
          for (const setting of operation.settings) {
            const key = `${setting.workspaceId}\0${setting.namespace}\0${setting.key}`;
            const current = projectedSettings.get(key);
            if (!companionAlreadyApplied[index] || !current || compareOperationTuples({ logicalTime: current.logicalTime, operationId: current.operationId }, { logicalTime: setting.logicalTime, operationId: setting.operationId }) <= 0) projectedSettings.set(key, setting);
            recordWorkspaceIds.add(setting.workspaceId);
          }
        }

        const pulledOperationIds = new Set(pull.operations.map(({ operationId }) => operationId));
        const settled: StoredOperation[] = [];
        let operations = operationValues.map(parseStoredOperation).map((stored) => {
          if (stored.stateKind !== "pending" || !pulledOperationIds.has(stored.operationId)) return stored;
          settled.push(stored);
          return { ...stored, stateKind: "accepted" as const };
        });
        const compensatedOperationIds = new Set(settled.flatMap(({ compensatesOperationId }) => compensatesOperationId === null ? [] : [compensatesOperationId]));
        operations = operations.map((stored) => stored.stateKind === "rejected" && compensatedOperationIds.has(stored.operationId) ? { ...stored, overlayKind: "deferred" as const } : stored);
        const coveredNodeIds = new Set(authoritativeNodeIds);
        const hierarchyNodes = new Set<string>();
        const siblingNodes = new Set<string>();
        const deferredOperations = new Set<string>();
        const pending = operations.filter((stored) => retainsOperationOverlay(stored) && (stored.operation.kind === "transfer" ? workspaces.has(stored.operation.destinationWorkspaceId) : workspaces.has(stored.operation.workspaceId))).sort((left, right) => compareOperationTuples(operationTuple(left), operationTuple(right)));
        for (const operation of pending) replayPendingOperation(projectedNodes, projectedSettings, currentSettings, coveredNodeIds, hierarchyNodes, siblingNodes, deferredOperations, operation);
        validateProjectedNodes(projectedNodes, authoritativeNodeIds, hierarchyNodes, siblingNodes, true);

        const affectedByWorkspace = new Map<string, Set<string>>();
        const affected = (workspaceId: string) => {
          const identities = affectedByWorkspace.get(workspaceId) ?? new Set<string>();
          affectedByWorkspace.set(workspaceId, identities);
          return identities;
        };
        for (const stored of settled) for (const workspaceId of stored.operation.kind === "transfer" ? [stored.workspaceId, stored.operation.destinationWorkspaceId] : [stored.workspaceId]) {
          const change = changeForWorkspace(stored, workspaceId);
          change?.affectedIdentities.forEach((identity) => affected(workspaceId).add(identity));
        }
        const touchNode = (record: NodeRecord) => {
          const identities = affected(record.workspaceId);
          identities.add(`node:${record.workspaceId}:${record.id}`);
          if (isPurgeTombstone(record)) { identities.add(`trash:${record.workspaceId}`); return; }
          identities.add(`folder:${record.workspaceId}:${record.parentId ?? "root"}`);
          if (record.kind === "file") identities.add(`content:${record.workspaceId}:${record.id}`);
          if (record.lifecycle.kind === "trashed") identities.add(`trash:${record.workspaceId}`);
        };
        const writes: Promise<unknown>[] = [];
        const nodeStore = transaction.objectStore("nodes");
        for (const [id, current] of currentNodes) {
          const projected = projectedNodes.get(id);
          if (projected === undefined) {
            writes.push(request(nodeStore.delete(id)));
            touchNode(current);
          } else if (!equalValues(current, projected)) {
            writes.push(request(nodeStore.put(isPurgeTombstone(projected) ? projected : storeNode(projected))));
            touchNode(current);
            touchNode(projected);
          }
        }
        for (const [id, projected] of projectedNodes) if (!currentNodes.has(id)) {
          writes.push(request(nodeStore.add(isPurgeTombstone(projected) ? projected : storeNode(projected))));
          touchNode(projected);
        }
        const settingStore = transaction.objectStore("settings");
        for (const [key, current] of currentSettings) {
          const projected = projectedSettings.get(key);
          if (projected === undefined) {
            writes.push(request(settingStore.delete([current.workspaceId, current.namespace, current.key])));
            affected(current.workspaceId).add(`setting:${current.workspaceId}:${current.namespace}:${current.key}`);
            affected(current.workspaceId).add(`setting-namespace:${current.workspaceId}:${current.namespace}`);
          } else if (!equalValues(current, projected)) {
            writes.push(request(settingStore.put(projected)));
            affected(current.workspaceId).add(`setting:${current.workspaceId}:${current.namespace}:${current.key}`);
            affected(current.workspaceId).add(`setting-namespace:${current.workspaceId}:${current.namespace}`);
          }
        }
        for (const [key, projected] of projectedSettings) if (!currentSettings.has(key)) {
          writes.push(request(settingStore.add(projected)));
          affected(projected.workspaceId).add(`setting:${projected.workspaceId}:${projected.namespace}:${projected.key}`);
          affected(projected.workspaceId).add(`setting-namespace:${projected.workspaceId}:${projected.namespace}`);
        }
        const operationStore = transaction.objectStore("operations");
        for (let index = 0; index < operations.length; index += 1) {
          const current = parseStoredOperation(operationValues[index]);
          const projected = deferredOperations.has(operations[index]!.operationId) ? { ...operations[index]!, overlayKind: "deferred" as const } : operations[index]!;
          if (!equalValues(current, projected)) writes.push(request(operationStore.put(projected)));
        }

        // ponytail: invalidate selector proofs instead of incrementally repairing them; retain targeted repair when pull volume makes rehydration costly.
        const coverageStore = transaction.objectStore("hydration-coverage");
        for (const coverage of coverageValues.map(parseStoredHydrationCoverage)) if (recordWorkspaceIds.has(coverage.workspaceId)) {
          hydrationTargetAffectedIdentities(coverage.target).forEach((identity) => affected(coverage.workspaceId).add(identity));
          writes.push(request(coverageStore.delete([coverage.workspaceId, coverage.targetId])));
        }
        await Promise.all(writes);

        const nextWorkspaces = new Map(workspaces);
        const nextSyncs = new Map(syncs);
        nextWorkspaces.set(pull.workspaceId, parseWorkspace({ ...workspace, headSequence: pull.headSequence, snapshotBarrier: pull.snapshotBarrier, logFloor: pull.logFloor }));
        nextSyncs.set(pull.workspaceId, parseSyncState({ ...sync, cursor: pull.cursor, lastObservedLogicalTime: Math.max(sync.lastObservedLogicalTime, pull.observedLogicalTime) }));
        for (const [companionWorkspaceId, cursor] of projectedCompanionCursors) if (cursor !== syncs.get(companionWorkspaceId)!.cursor) {
          const companionWorkspace = nextWorkspaces.get(companionWorkspaceId)!;
          const companionSync = nextSyncs.get(companionWorkspaceId)!;
          nextWorkspaces.set(companionWorkspaceId, parseWorkspace({ ...companionWorkspace, headSequence: Math.max(companionWorkspace.headSequence, cursor) }));
          nextSyncs.set(companionWorkspaceId, parseSyncState({ ...companionSync, cursor, lastObservedLogicalTime: Math.max(companionSync.lastObservedLogicalTime, pull.observedLogicalTime) }));
        }
        if (terminalOperationId) affected(pull.workspaceId);
        const changes = terminalOperationId === undefined ? [] : [...affectedByWorkspace].filter(([workspaceId, identities]) => identities.size > 0 || workspaceId === pull.workspaceId).map(([workspaceId, identities]) => {
          const current = nextWorkspaces.get(workspaceId);
          if (!current || !nextSyncs.has(workspaceId)) throw new Error("Pulled records reference a workspace that does not exist.");
          return parseChangeRecord({ kind: "pull", workspaceId, revision: current.localRevision + 1, operationId: terminalOperationId, fromCursor: pull.fromCursor, cursor: pull.cursor, affectedIdentities: [...identities].sort() });
        });
        for (const change of changes) {
          nextWorkspaces.set(change.workspaceId, parseWorkspace({ ...nextWorkspaces.get(change.workspaceId)!, localRevision: change.revision }));
          nextSyncs.set(change.workspaceId, parseSyncState({ ...nextSyncs.get(change.workspaceId)!, lastObservedLogicalTime: Math.max(nextSyncs.get(change.workspaceId)!.lastObservedLogicalTime, pull.observedLogicalTime) }));
        }
        await Promise.all([
          ...Array.from(nextWorkspaces.values(), (candidate) => request(transaction.objectStore("workspaces").put(candidate))),
          ...Array.from(nextSyncs.values(), (candidate) => request(transaction.objectStore("sync").put(candidate))),
          ...changes.map((change) => request(transaction.objectStore("changes").add(change))),
        ]);
        return changes;
      });
    },

    getManifest: async (hash) => {
      const canonicalHash = parseSha256(hash, "A manifest hash is invalid.");
      return (await readStoredManifests([canonicalHash])).get(canonicalHash)?.manifest;
    },

    storeManifest: async (hash, manifest) => {
      const record = await validateStoredManifest({ hash, manifest });
      await transact(db, "manifests", "readwrite", (transaction) => request(transaction.objectStore("manifests").put(record)));
    },

    getOperation: async (operationId) => {
      const canonicalOperationId = parseStableId(operationId, "An operation ID is invalid.");
      return transact(db, "operations", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("operations").get(canonicalOperationId));
        return value === undefined ? undefined : parseStoredOperation(value);
      });
    },

    listUnsettledOperations: async (workspaceId, afterRevision = 0, limit = WEB2_MAX_BATCH_ITEMS) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalAfterRevision = parseNonNegativeSafeInteger(afterRevision, "An unsettled operation cursor is invalid.");
      const boundedLimit = parsePositiveSafeInteger(limit, "An unsettled operation limit is invalid.");
      if (boundedLimit > WEB2_MAX_BATCH_ITEMS) throw new Error("An unsettled operation limit is too large.");
      return transact(db, "operations", "readonly", async (transaction) => new Promise<StoredOperation[]>((resolve, reject) => {
        const result: StoredOperation[] = [];
        const cursor = transaction.objectStore("operations").index("by-workspace-revision").openCursor(keyRange.bound([canonicalWorkspaceId, canonicalAfterRevision], [canonicalWorkspaceId, Number.MAX_SAFE_INTEGER], canonicalAfterRevision > 0));
        cursor.onerror = () => reject(cursor.error ?? new Error("Unsettled filesystem operations could not be read."));
        cursor.onsuccess = () => {
          try {
            if (!cursor.result || result.length === boundedLimit) { resolve(result); return; }
            const operation = parseStoredOperation(cursor.result.value);
            if (operation.stateKind !== "accepted" && operation.overlayKind !== "discarded") result.push(operation);
            cursor.result.continue();
          } catch (error) {
            reject(error);
          }
        };
      }));
    },

    recordPushRejections: async (values) => {
      if (!Array.isArray(values) || values.length === 0 || values.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A push rejection batch is invalid.");
      const rejections = values.map((value) => {
        if (!isRecord(value)) throw new Error("A push rejection has an unsupported shape.");
        assertExactKeys(value, ["operationId", "workspaceId", "code", "message"], "A push rejection has an unsupported shape.");
        if (typeof value.code !== "string" || !value.code || value.code.length > 128 || typeof value.message !== "string" || !value.message || value.message.length > 1024) throw new Error("A push rejection is invalid.");
        return { operationId: parseStableId(value.operationId), workspaceId: parseStableId(value.workspaceId), code: value.code, message: value.message };
      });
      if (new Set(rejections.map(({ operationId }) => operationId)).size !== rejections.length) throw new Error("A push rejection batch contains duplicate operation IDs.");
      return transact(db, "operations", "readwrite", async (transaction) => {
        const store = transaction.objectStore("operations");
        const rejected: StoredOperation[] = [];
        for (const rejection of rejections) {
          const value = await request(store.get(rejection.operationId));
          if (value === undefined) throw new Error("A rejected operation is absent from the local outbox.");
          const operation = parseStoredOperation(value);
          if (operation.workspaceId !== rejection.workspaceId || operation.stateKind === "accepted") throw new Error("A push rejection does not match a pending local operation.");
          if (operation.stateKind === "rejected") {
            if (!equalValues(operation.rejection, { code: rejection.code, message: rejection.message })) throw new Error("A rejected operation was replayed with a different result.");
            rejected.push(operation);
            continue;
          }
          const updated: StoredOperation = { ...operation, stateKind: "rejected", rejection: { code: rejection.code, message: rejection.message } };
          await request(store.put(updated));
          rejected.push(updated);
        }
        return rejected;
      });
    },

    deferRejectedOperation: async (operationId) => {
      const canonicalOperationId = parseStableId(operationId, "An operation ID is invalid.");
      return transact(db, "operations", "readwrite", async (transaction) => {
        const store = transaction.objectStore("operations");
        const value = await request(store.get(canonicalOperationId));
        if (value === undefined) throw new Error("That rejected operation does not exist.");
        const operation = parseStoredOperation(value);
        if (operation.stateKind !== "rejected" || operation.overlayKind !== "active") throw new Error("That operation is not awaiting discard.");
        const deferred: StoredOperation = { ...operation, overlayKind: "deferred" };
        await request(store.put(deferred));
        return deferred;
      });
    },

    completeRejectedDiscards: async (operationIds) => {
      if (!Array.isArray(operationIds) || operationIds.length === 0 || operationIds.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A rejected discard batch is invalid.");
      const ids = operationIds.map((operationId) => parseStableId(operationId, "A rejected operation ID is invalid."));
      if (new Set(ids).size !== ids.length) throw new Error("A rejected discard batch contains duplicate operation IDs.");
      await transact(db, "operations", "readwrite", async (transaction) => {
        const store = transaction.objectStore("operations");
        for (const operationId of ids) {
          const value = await request(store.get(operationId));
          if (value === undefined) throw new Error("A deferred rejected operation does not exist.");
          const operation = parseStoredOperation(value);
          if (operation.stateKind !== "rejected" || operation.overlayKind !== "deferred") throw new Error("A rejected operation is not awaiting discard completion.");
          await request(store.put({ ...operation, overlayKind: "discarded" } satisfies StoredOperation));
        }
      });
    },

    commitOperation: async (value) => {
      const normalized = await normalizeCommitInput(value);
      const replayedValue = await transact(db, "operations", "readonly", (transaction) => request(transaction.objectStore("operations").get(normalized.operation.operationId)));
      if (replayedValue !== undefined) {
        const replayed = parseStoredOperation(replayedValue);
        if (!equalValues(replayOperation(replayed.operation), normalized.operation) || replayed.intent !== normalized.intent || replayed.compensatesOperationId !== normalized.compensatesOperationId || !equalValues(replayed.expectedContentTuple, normalized.expectedContentTuple)) throw new Error("An operation ID cannot be reused with different input.");
        return replayed;
      }
      const suppliedManifests = new Map(normalized.manifests.map((record) => [record.hash, record]));
      const hashes = [...new Set([...suppliedManifests.keys(), ...manifestHashes(normalized.operation)])];
      const validatedStoredManifests = await readStoredManifests(hashes);
      return transact(db, ["workspaces", "nodes", "manifests", "operations", "changes", "sync", "settings"], "readwrite", async (transaction) => {
        const operations = transaction.objectStore("operations");
        const existingValue = await request(operations.get(normalized.operation.operationId));
        if (existingValue !== undefined) {
          const existing = parseStoredOperation(existingValue);
          if (!equalValues(replayOperation(existing.operation), normalized.operation) || existing.intent !== normalized.intent || existing.compensatesOperationId !== normalized.compensatesOperationId || !equalValues(existing.expectedContentTuple, normalized.expectedContentTuple)) throw new Error("An operation ID cannot be reused with different input.");
          return existing;
        }
        const collidingChanges = (await request(transaction.objectStore("changes").index("by-operation-id").getAll(normalized.operation.operationId))).map(parseChangeRecord);
        if (collidingChanges.some(({ kind }) => kind === "hydration")) throw new Error("An operation ID cannot reuse a hydration generation ID.");
        if (collidingChanges.some(({ kind }) => kind === "pull")) throw new Error("An operation ID cannot reuse a pulled operation ID.");

        const workspaceValue = await request(transaction.objectStore("workspaces").get(normalized.operation.workspaceId));
        const syncValue = await request(transaction.objectStore("sync").get(normalized.operation.workspaceId));
        if (workspaceValue === undefined || syncValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        const sync = parseSyncState(syncValue);
        if (sync.workspaceId !== workspace.id || sync.deviceId !== normalized.operation.deviceId) throw new Error("The operation device does not own this local workspace state.");
        let destinationWorkspace: Workspace | undefined;
        let destinationSync: SyncState | undefined;
        if (normalized.operation.kind === "transfer") {
          const [destinationWorkspaceValue, destinationSyncValue] = await Promise.all([
            request(transaction.objectStore("workspaces").get(normalized.operation.destinationWorkspaceId)),
            request(transaction.objectStore("sync").get(normalized.operation.destinationWorkspaceId)),
          ]);
          if (destinationWorkspaceValue === undefined || destinationSyncValue === undefined) throw new Error("The transfer destination workspace does not exist.");
          destinationWorkspace = parseWorkspace(destinationWorkspaceValue);
          destinationSync = parseSyncState(destinationSyncValue);
          if (destinationSync.workspaceId !== destinationWorkspace.id || destinationSync.deviceId !== normalized.operation.deviceId) throw new Error("The operation device does not own the transfer destination workspace state.");
        }

        let compensated: StoredOperation | undefined;
        let expectedLifecycleNodeIds: string[] | undefined;
        let expectedLifecycleTuple: OperationTuple | undefined;
        const readOperation = async (operationId: string) => {
          const value = await request(operations.get(operationId));
          return value === undefined ? undefined : parseStoredOperation(value);
        };
        if (normalized.compensatesOperationId !== null) {
          compensated = await readOperation(normalized.compensatesOperationId);
          if (!compensated) throw new Error("A compensating operation must reference an existing operation.");
          if (compensated.workspaceId !== workspace.id) throw new Error("A compensating operation must reference the same workspace.");
          if (normalized.operation.kind === "write") {
            const compensatingWrite = normalized.operation;
            const matchesContent = (version: Pick<FileVersion, "nodeId" | "mimeType" | "size" | "manifestHash">) => equalValues({
              nodeId: compensatingWrite.nodeId,
              mimeType: compensatingWrite.mimeType,
              size: compensatingWrite.size,
              manifestHash: compensatingWrite.manifestHash,
            }, { nodeId: version.nodeId, mimeType: version.mimeType, size: version.size, manifestHash: version.manifestHash });
            if (normalized.intent === "undo" && (compensated.operation.kind !== "write" || compensated.intent !== "forward" && compensated.intent !== "redo" && compensated.intent !== "restore" || compensated.operation.nodeId !== normalized.operation.nodeId || compensated.inverse.kind !== "write" || !matchesContent(compensated.inverse))) throw new Error("An undo must apply a write inverse for that file.");
            if (normalized.intent === "redo" && (compensated.intent !== "undo" || compensated.operation.kind !== "write" || compensated.operation.nodeId !== normalized.operation.nodeId || compensated.inverse.kind !== "write" || !matchesContent(compensated.inverse))) throw new Error("A redo must apply an undo inverse for that file.");
            const restoredVersion = normalized.intent === "restore" ? fileVersionFromOperation(compensated.operation, normalized.operation.nodeId) : undefined;
            if (normalized.intent === "restore" && (!restoredVersion || !matchesContent(restoredVersion))) throw new Error("A restore must apply the referenced version of that file.");
          } else if (normalized.operation.kind === "trash" && normalized.intent === "undo") {
            const expectation = await lifecycleUndoExpectation(compensated, readOperation);
            if (!expectation || !equalValues(normalized.operation.nodeIds, expectation.rootNodeIds)) throw new Error("An undo must move the exact created forest to Trash.");
            expectedLifecycleNodeIds = expectation.nodeIds;
            expectedLifecycleTuple = { logicalTime: compensated.operation.logicalTime, operationId: compensated.operationId };
          } else if (normalized.operation.kind === "restore" && normalized.intent === "redo") {
            if (compensated.operation.kind !== "trash" || compensated.intent !== "undo" || compensated.inverse.kind !== "trash") throw new Error("A redo must restore the exact forest from its undo.");
            const target = await readOperation(compensated.compensatesOperationId!);
            const expectation = target && target.workspaceId === workspace.id ? await lifecycleUndoExpectation(target, readOperation) : undefined;
            if (!expectation || !equalValues(compensated.operation.nodeIds, expectation.rootNodeIds) || !equalValues(compensated.inverse.nodeIds, expectation.nodeIds) || normalized.operation.destination !== "original" || !equalValues(normalized.operation.nodeIds, compensated.inverse.roots.map(({ nodeId }) => nodeId))) throw new Error("A redo must restore the exact forest from its undo.");
            expectedLifecycleNodeIds = compensated.inverse.nodeIds;
            expectedLifecycleTuple = { logicalTime: compensated.operation.logicalTime, operationId: compensated.operationId };
          } else {
            throw new Error("That operation cannot compensate filesystem history.");
          }
        }

        const storedManifests = new Map<string, StoredManifest>();
        await Promise.all(hashes.map(async (hash) => {
          const storedValue = await request(transaction.objectStore("manifests").get(hash));
          const validated = validatedStoredManifests.get(hash);
          if (storedValue === undefined) {
            if (validated) throw new Error("A stored manifest changed during the filesystem commit.");
            return;
          }
          const stored = parseStoredManifest(storedValue);
          if (!validated || !equalValues(stored, validated)) throw new Error("A stored manifest changed during the filesystem commit.");
          const supplied = suppliedManifests.get(hash);
          if (supplied && !equalValues(stored.manifest, supplied.manifest)) throw new Error("A manifest hash is already stored with different content.");
          storedManifests.set(hash, stored);
        }));
        const resolvedManifest = (hash: string) => suppliedManifests.get(hash) ?? storedManifests.get(hash);
        for (const hash of manifestHashes(normalized.operation)) if (!resolvedManifest(hash)) throw new Error("An operation references a missing manifest.");

        const wallTime = parseNonNegativeSafeInteger(now(), "The current time is invalid.");
        const logicalTime = Math.max(wallTime, ...[sync, ...(destinationSync ? [destinationSync] : [])].flatMap((state) => [
          nextSafeInteger(state.lastObservedLogicalTime, "The observed logical clock is exhausted."),
          nextSafeInteger(state.lastLocalLogicalTime, "The local logical clock is exhausted."),
        ]));
        const parsedOperation = parseWorkspaceOperation({ ...normalized.operation, logicalTime });
        const operation = parsedOperation;
        const tuple = { logicalTime, operationId: operation.operationId };
        const nodes = transaction.objectStore("nodes");
        const settingsStore = transaction.objectStore("settings");
        const nodeCache = new Map<string, StoredNode | undefined>();
        const readNode = async (id: string) => {
          if (nodeCache.has(id)) return nodeCache.get(id);
          const value = await request(nodes.get(id));
          const record = value === undefined ? undefined : parseStoredNodeRecord(value);
          const node = record === undefined || isPurgeTombstone(record) ? undefined : record;
          nodeCache.set(id, node);
          return node;
        };
        const childrenInLifecycle = async (parent: StoredNode, lifecycle: "active" | "trashed", limit?: number) => {
          const index = nodes.index("by-workspace-parent-lifecycle");
          const range = keyRange.only([parent.workspaceId, parent.id, lifecycle]);
          const values = await request(limit === undefined ? index.getAll(range) : index.getAll(range, limit));
          return values.map(parseStoredNode).sort((left, right) => left.id.localeCompare(right.id));
        };
        const ancestors = async (node: StoredNode) => {
          const result: StoredNode[] = [];
          const seen = new Set([node.id]);
          let parentId = node.parentId;
          while (parentId !== null) {
            const parent = await readNode(parentId);
            if (!parent || parent.workspaceId !== node.workspaceId || parent.kind !== "folder" || parent.lifecycle.kind !== node.lifecycle.kind || seen.has(parent.id)) throw new Error("The stored node hierarchy is invalid.");
            result.push(parent);
            seen.add(parent.id);
            if (result.length > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("The node hierarchy is too deep.");
            parentId = parent.parentId;
          }
          return result;
        };
        const expandSubtrees = async (roots: StoredNode[], lifecycle: "active" | "trashed", message: string, maxItems: number | null = WEB2_MAX_BATCH_ITEMS) => {
          const seen = new Set<string>();
          const result: Array<{ root: StoredNode; nodes: Array<{ node: StoredNode; depth: number }> }> = [];
          for (const root of roots) {
            const expanded: Array<{ node: StoredNode; depth: number }> = [];
            const pending: Array<{ node: StoredNode; depth: number }> = [];
            const enqueue = (node: StoredNode, depth: number) => {
              if (seen.has(node.id)) throw new Error("Selected filesystem roots overlap.");
              if (maxItems !== null && seen.size === maxItems) throw new Error(message);
              seen.add(node.id);
              pending.push({ node, depth });
            };
            enqueue(root, 0);
            for (let index = 0; index < pending.length; index += 1) {
              const current = pending[index]!;
              expanded.push(current);
              const remaining = maxItems === null ? undefined : maxItems - seen.size;
              const children = await childrenInLifecycle(current.node, lifecycle, remaining === undefined ? undefined : remaining + 1);
              if (remaining !== undefined && children.length > remaining) throw new Error(message);
              for (const child of children) enqueue(child, current.depth + 1);
            }
            result.push({ root, nodes: expanded });
          }
          return result;
        };
        const validateDestinationNames = async (items: Array<{ node: { id: string; name: string }; parentId: string | null }>, excludedIds: Set<string>, destinationWorkspaceId = workspace.id) => {
          const byParent = new Map<string | null, string[]>();
          for (const { node, parentId } of items) byParent.set(parentId, [...(byParent.get(parentId) ?? []), node.name]);
          for (const [parentId, names] of byParent) await assertChildNamesAvailableInTransaction(transaction, destinationWorkspaceId, parentId, names, excludedIds);
        };
        const previousSetting = (setting: Setting | undefined): PreviousSetting => setting === undefined || setting.deleted ? { exists: false } : { exists: true, value: setting.value };
        const readSetting = async (namespace: SettingNamespace, key: string) => {
          const value = await request(settingsStore.get([workspace.id, namespace, key]));
          if (value === undefined) return undefined;
          const setting = parseSetting(value);
          if (setting.workspaceId !== workspace.id || setting.namespace !== namespace || setting.key !== key) throw new Error("Stored setting identity metadata is inconsistent.");
          return setting;
        };

        let inverse: OperationInverse;
        const projectedNodes = new Map<string, StoredNode>();
        const addedNodeIds = new Set<string>();
        const purgedNodeIds: string[] = [];
        const projectedSettings: Setting[] = [];
        let copySourceNodes: StoredNode[] = [];
        switch (operation.kind) {
          case "create":
          case "copy": {
            if (operation.kind === "copy") {
              const sourceRoots = await Promise.all(operation.sourceNodeIds.map(async (id) => {
                const node = await readNode(id);
                if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A copy requires active source roots in their workspace.");
                return node;
              }));
              const expanded = await expandSubtrees(sourceRoots, "active", "A copied forest is too large.");
              copySourceNodes = expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node));
              if (copySourceNodes.length !== operation.nodes.length) throw new Error("A copy must contain a complete source forest snapshot.");
              const destinationIds = new Set(operation.nodes.map(({ id }) => id));
              const destinationRoots = operation.nodes.filter(({ parentId }) => parentId === null || !destinationIds.has(parentId));
              if (destinationRoots.length !== sourceRoots.length) throw new Error("A copy must map each source root to one destination root.");
              const timestamp = operation.nodes[0]!.createdAt;
              if (operation.nodes.some((node) => node.createdAt !== timestamp || node.modifiedAt !== timestamp)) throw new Error("Copied nodes require one creation and modification timestamp.");

              const sourceChildren = new Map<string, StoredNode[]>();
              const sourceRootIds = new Set(sourceRoots.map(({ id }) => id));
              for (const source of copySourceNodes) if (!sourceRootIds.has(source.id)) {
                const children = sourceChildren.get(source.parentId!) ?? [];
                children.push(source);
                sourceChildren.set(source.parentId!, children);
              }
              const destinationChildren = new Map<string, typeof operation.nodes>();
              for (const destination of operation.nodes) if (destinationIds.has(destination.parentId ?? "")) {
                const children = destinationChildren.get(destination.parentId!) ?? [];
                children.push(destination);
                destinationChildren.set(destination.parentId!, children);
              }
              const matchedDestinations = new Set<string>();
              const validateSnapshot = (source: StoredNode, destination: typeof operation.nodes[number], root: boolean) => {
                if (source.kind !== destination.kind) throw new Error("A copied node kind does not match its source snapshot.");
                if (!root && (source.name !== destination.name || !equalValues(source.position, destination.position))) throw new Error("A copied descendant does not match its source snapshot.");
                if (source.kind === "file" && destination.kind === "file" && (source.mimeType !== destination.mimeType || source.size !== destination.size || source.manifestHash !== destination.manifestHash)) throw new Error("Copied file metadata does not match its source snapshot.");
                matchedDestinations.add(destination.id);
                const sourceValues = sourceChildren.get(source.id) ?? [];
                const destinationValues = destinationChildren.get(destination.id) ?? [];
                if (sourceValues.length !== destinationValues.length) throw new Error("A copy must contain a complete source forest snapshot.");
                for (const sourceChild of sourceValues) {
                  const destinationChild = destinationValues.find(({ name }) => name === sourceChild.name);
                  if (!destinationChild) throw new Error("A copied descendant does not match its source snapshot.");
                  validateSnapshot(sourceChild, destinationChild, false);
                }
              };
              for (let index = 0; index < sourceRoots.length; index += 1) validateSnapshot(sourceRoots[index]!, destinationRoots[index]!, true);
              if (matchedDestinations.size !== operation.nodes.length) throw new Error("A copy contains invented destination nodes.");
            }
            const createdIds = new Set(operation.nodes.map(({ id }) => id));
            await assertNodeIdsAvailableInTransaction(transaction, [...createdIds]);

            const externalParentIds = [...new Set(operation.nodes.map(({ parentId }) => parentId).filter((parentId): parentId is string => parentId !== null && !createdIds.has(parentId)))];
            await Promise.all(externalParentIds.map(async (id) => {
              const parent = await readNode(id);
              if (!parent) throw new Error("A created node parent does not exist.");
              if (parent.workspaceId !== workspace.id || parent.kind !== "folder" || parent.lifecycle.kind !== "active") throw new Error("A created node parent must be an active folder in its workspace.");
            }));
            await validateDestinationNames(operation.nodes.filter(({ parentId }) => parentId === null || !createdIds.has(parentId)).map((node) => ({ node, parentId: node.parentId })), new Set());
            const createdById = new Map(operation.nodes.map((node) => [node.id, node]));
            const createdDepths = new Map<string, number>();
            const createdDepth = async (id: string): Promise<number> => {
              const cached = createdDepths.get(id);
              if (cached !== undefined) return cached;
              const node = createdById.get(id)!;
              let depth = 0;
              if (node.parentId !== null) {
                if (createdById.has(node.parentId)) depth = await createdDepth(node.parentId) + 1;
                else {
                  const parent = await readNode(node.parentId);
                  if (!parent) throw new Error("A created node parent does not exist.");
                  depth = (await ancestors(parent)).length + 1;
                }
              }
              if (depth > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("The created hierarchy is too deep.");
              createdDepths.set(id, depth);
              return depth;
            };
            await Promise.all(operation.nodes.map(({ id }) => createdDepth(id)));
            for (const node of operation.nodes) {
              if (node.kind === "file" && resolvedManifest(node.manifestHash)!.manifest.size !== node.size) throw new Error("A created file size does not match its manifest.");
              const projected = storeNode(parseNode({ ...node, workspaceId: operation.workspaceId, lifecycle: { kind: "active" }, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: node.kind === "file" ? tuple : null } }));
              projectedNodes.set(node.id, projected);
              addedNodeIds.add(node.id);
            }
            inverse = operation.kind === "copy"
              ? { kind: "copy", rootNodeIds: createdRootIds(operation), sourceNodeIds: copySourceNodes.map(({ id }) => id).sort(), sourceFileNodeIds: copySourceNodes.filter(({ kind }) => kind === "file").map(({ id }) => id).sort() }
              : { kind: "create", rootNodeIds: createdRootIds(operation) };
            break;
          }
          case "write": {
            const node = await readNode(operation.nodeId);
            if (!node) throw new Error("The written file does not exist.");
            if (node.workspaceId !== workspace.id || node.kind !== "file" || node.lifecycle.kind !== "active") throw new Error("A write requires an active file in its workspace.");
            if (!equalValues(node.fieldTuples.content, normalized.expectedContentTuple)) throw new Error("The file content changed before this write could commit.");
            if (compensated && (normalized.intent === "undo" || normalized.intent === "redo")) {
              const compensatedVersion = fileVersionFromOperation(compensated.operation, node.id);
              if (!compensatedVersion || !equalValues({ mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash }, { mimeType: compensatedVersion.mimeType, size: compensatedVersion.size, manifestHash: compensatedVersion.manifestHash })) throw new Error("The compensated operation is not the current file version.");
            }
            if (resolvedManifest(operation.manifestHash)!.manifest.size !== operation.size) throw new Error("A written file size does not match its manifest.");
            inverse = { kind: "write", nodeId: node.id, mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash, modifiedAt: node.modifiedAt };
            projectedNodes.set(node.id, storeNode({ ...node, mimeType: operation.mimeType, size: operation.size, manifestHash: operation.manifestHash, modifiedAt: operation.modifiedAt, fieldTuples: { ...node.fieldTuples, content: tuple } }));
            break;
          }
          case "rename": {
            const node = await readNode(operation.nodeId);
            if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A rename requires an active node in its workspace.");
            await validateDestinationNames([{ node: { id: node.id, name: operation.name }, parentId: node.parentId }], new Set([node.id]));
            inverse = { kind: "rename", nodeId: node.id, name: node.name, modifiedAt: node.modifiedAt };
            projectedNodes.set(node.id, storeNode({ ...node, name: operation.name, modifiedAt: operation.modifiedAt, fieldTuples: { ...node.fieldTuples, name: tuple } }));
            break;
          }
          case "move": {
            const roots = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A move requires active nodes in their workspace.");
              return node;
            }));
            const selected = new Set(operation.nodeIds);
            for (const root of roots) if ((await ancestors(root)).some(({ id }) => selected.has(id))) throw new Error("Moved roots cannot overlap.");
            let destination: StoredNode | undefined;
            if (operation.parentId !== null) {
              destination = await readNode(operation.parentId);
              if (!destination) throw new Error("The move destination does not exist.");
              if (destination.workspaceId !== workspace.id || destination.kind !== "folder" || destination.lifecycle.kind !== "active") throw new Error("The move destination must be an active folder in this workspace.");
              if (selected.has(destination.id) || (await ancestors(destination)).some(({ id }) => selected.has(id))) throw new Error("A node cannot be moved into itself or its descendant.");
            }
            const expanded = await expandSubtrees(roots, "active", "A moved subtree is too large.", null);
            const destinationDepth = destination ? (await ancestors(destination)).length + 1 : 0;
            if (expanded.some(({ nodes: expandedNodes }) => destinationDepth + Math.max(...expandedNodes.map(({ depth }) => depth)) > WEB2_MAX_ANCESTRY_DEPTH)) throw new Error("The move destination would make the hierarchy too deep.");
            await validateDestinationNames(roots.map((node) => ({ node, parentId: operation.parentId })), selected);
            inverse = { kind: "move", roots: roots.map(({ id, parentId, modifiedAt }) => ({ nodeId: id, parentId, modifiedAt })) };
            for (const root of roots) projectedNodes.set(root.id, storeNode({ ...root, parentId: operation.parentId, modifiedAt: operation.modifiedAt, fieldTuples: { ...root.fieldTuples, parent: tuple } }));
            break;
          }
          case "transfer": {
            if (!destinationWorkspace || !destinationSync) throw new Error("The transfer destination workspace does not exist.");
            const roots = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A transfer requires active source roots in their workspace.");
              return node;
            }));
            const selected = new Set(operation.nodeIds);
            for (const root of roots) if ((await ancestors(root)).some(({ id }) => selected.has(id))) throw new Error("Transferred roots cannot overlap.");
            const expanded = await expandSubtrees(roots, "active", "A transferred forest is too large.");
            const movedNodes = expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node)).sort((left, right) => left.id.localeCompare(right.id));
            let destination: StoredNode | undefined;
            if (operation.parentId !== null) {
              destination = await readNode(operation.parentId);
              if (!destination || destination.workspaceId !== destinationWorkspace.id || destination.kind !== "folder" || destination.lifecycle.kind !== "active") throw new Error("The transfer destination parent must be an active folder in the destination workspace.");
            }
            const destinationDepth = destination ? (await ancestors(destination)).length + 1 : 0;
            if (expanded.some(({ nodes: expandedNodes }) => destinationDepth + Math.max(...expandedNodes.map(({ depth }) => depth)) > WEB2_MAX_ANCESTRY_DEPTH)) throw new Error("The transfer destination would make the hierarchy too deep.");
            await validateDestinationNames(roots.map((node) => ({ node, parentId: operation.parentId })), new Set(), destinationWorkspace.id);
            inverse = {
              kind: "transfer",
              nodes: movedNodes.map(({ id, parentId, modifiedAt }) => ({ nodeId: id, parentId, modifiedAt })),
              fileNodeIds: movedNodes.filter(({ kind }) => kind === "file").map(({ id }) => id),
            };
            for (const node of movedNodes) projectedNodes.set(node.id, storeNode({
              ...node,
              workspaceId: destinationWorkspace.id,
              parentId: selected.has(node.id) ? operation.parentId : node.parentId,
              modifiedAt: operation.modifiedAt,
              fieldTuples: { ...node.fieldTuples, parent: tuple },
            }));
            break;
          }
          case "position": {
            const previous: Array<{ nodeId: string; position: Position }> = [];
            for (const change of operation.positions) {
              const node = await readNode(change.nodeId);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A position update requires active nodes in their workspace.");
              previous.push({ nodeId: node.id, position: node.position });
              projectedNodes.set(node.id, storeNode({ ...node, position: change.position, fieldTuples: { ...node.fieldTuples, position: tuple } }));
            }
            inverse = { kind: "position", positions: previous };
            break;
          }
          case "trash": {
            const selectedNodes = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("Trash requires active nodes in their workspace.");
              return node;
            }));
            const selected = new Set(operation.nodeIds);
            const roots: StoredNode[] = [];
            for (const node of selectedNodes) if (!(await ancestors(node)).some(({ id }) => selected.has(id))) roots.push(node);
            const expanded = await expandSubtrees(roots, "active", "A Trash subtree batch is too large.");
            const expandedNodes = expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node));
            if (expectedLifecycleTuple && expandedNodes.some(({ fieldTuples }) => !equalValues(fieldTuples.lifecycle, expectedLifecycleTuple))) throw new Error("The compensated lifecycle operation is no longer current.");
            const rootIds = new Set(roots.map(({ id }) => id));
            inverse = { kind: "trash", roots: roots.map(({ id, parentId }) => ({ nodeId: id, parentId })), nodeIds: expandedNodes.map(({ id }) => id).sort() };
            for (const node of expandedNodes) projectedNodes.set(node.id, storeNode({ ...node, parentId: rootIds.has(node.id) ? null : node.parentId, lifecycle: { kind: "trashed", trashedAt: operation.trashedAt, originalParentId: node.parentId }, fieldTuples: { ...node.fieldTuples, parent: rootIds.has(node.id) ? tuple : node.fieldTuples.parent, lifecycle: tuple } }));
            break;
          }
          case "restore": {
            const roots = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "trashed" || node.parentId !== null) throw new Error("Restore requires actual trashed roots in their workspace.");
              return node;
            }));
            const expanded = await expandSubtrees(roots, "trashed", "A restore subtree batch is too large.");
            const expandedNodes = expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node)).sort((left, right) => left.id.localeCompare(right.id));
            if (expectedLifecycleTuple && expandedNodes.some(({ fieldTuples }) => !equalValues(fieldTuples.lifecycle, expectedLifecycleTuple))) throw new Error("The compensated lifecycle operation is no longer current.");
            const restoringById = new Map(expandedNodes.map((node) => [node.id, node]));
            const destinations = new Map<string, string | null>();
            for (const root of roots) {
              if (root.lifecycle.kind !== "trashed") throw new Error("Restore requires trashed roots.");
              const parentId = operation.destination === "original" ? root.lifecycle.originalParentId : null;
              if (parentId !== null) {
                const parent = restoringById.get(parentId) ?? await readNode(parentId);
                if (!parent) throw new Error("The original parent no longer exists.");
                if (parent.workspaceId !== workspace.id || parent.kind !== "folder" || !restoringById.has(parentId) && parent.lifecycle.kind !== "active") throw new Error("The original parent is not an active folder.");
              }
              destinations.set(root.id, parentId);
            }
            const rootIds = new Set(roots.map(({ id }) => id));
            const finalParents = new Map(expandedNodes.map((node) => [node.id, rootIds.has(node.id) ? destinations.get(node.id)! : node.parentId]));
            await validateDestinationNames(expandedNodes.map((node) => ({ node, parentId: finalParents.get(node.id)! })), new Set(restoringById.keys()));
            const finalDepths = new Map<string, number>();
            const finalDepth = async (id: string, visiting = new Set<string>()): Promise<number> => {
              const cached = finalDepths.get(id);
              if (cached !== undefined) return cached;
              if (visiting.has(id)) throw new Error("The restored hierarchy contains a cycle.");
              visiting.add(id);
              const parentId = finalParents.get(id)!;
              let depth = 0;
              if (parentId !== null) {
                if (restoringById.has(parentId)) depth = await finalDepth(parentId, visiting) + 1;
                else {
                  const parent = await readNode(parentId);
                  if (!parent) throw new Error("The restore destination does not exist.");
                  depth = (await ancestors(parent)).length + 1;
                }
              }
              visiting.delete(id);
              if (depth > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("The restored hierarchy is too deep.");
              finalDepths.set(id, depth);
              return depth;
            };
            await Promise.all(expandedNodes.map(({ id }) => finalDepth(id)));
            inverse = { kind: "restore", roots: roots.map(({ id, parentId, modifiedAt }) => ({ nodeId: id, parentId, modifiedAt })), nodes: expandedNodes.map((node) => {
              if (node.lifecycle.kind !== "trashed") throw new Error("Restore requires trashed nodes.");
              return { nodeId: node.id, lifecycle: node.lifecycle };
            }) };
            for (const node of expandedNodes) projectedNodes.set(node.id, storeNode({ ...node, parentId: finalParents.get(node.id)!, lifecycle: { kind: "active" }, modifiedAt: rootIds.has(node.id) ? operation.modifiedAt : node.modifiedAt, fieldTuples: { ...node.fieldTuples, parent: rootIds.has(node.id) ? tuple : node.fieldTuples.parent, lifecycle: tuple } }));
            break;
          }
          case "purge": {
            const roots = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "trashed" || node.parentId !== null) throw new Error("Purge requires actual trashed roots in their workspace.");
              return node;
            }));
            const expanded = await expandSubtrees(roots, "trashed", "A purge subtree batch is too large.");
            purgedNodeIds.push(...expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node.id)).sort());
            inverse = { kind: "purge", nodeIds: [...purgedNodeIds], reason: "Permanent purge cannot be undone." };
            break;
          }
          case "set": {
            const previous = await readSetting(operation.namespace, operation.key);
            inverse = { kind: "set", namespace: operation.namespace, key: operation.key, previous: previousSetting(previous) };
            projectedSettings.push(parseSetting({ workspaceId: workspace.id, namespace: operation.namespace, key: operation.key, deleted: false, value: operation.value, logicalTime, operationId: operation.operationId }));
            break;
          }
          case "set-many": {
            const previous = await Promise.all(operation.settings.map(async ({ key }) => ({ key, previous: previousSetting(await readSetting(operation.namespace, key)) })));
            inverse = { kind: "set-many", namespace: operation.namespace, settings: previous };
            projectedSettings.push(...operation.settings.map(({ key, value }) => parseSetting({ workspaceId: workspace.id, namespace: operation.namespace, key, deleted: false, value, logicalTime, operationId: operation.operationId })));
            break;
          }
          case "unset": {
            const previous = await readSetting(operation.namespace, operation.key);
            inverse = { kind: "unset", namespace: operation.namespace, key: operation.key, previous: previousSetting(previous) };
            projectedSettings.push(parseSetting({ workspaceId: workspace.id, namespace: operation.namespace, key: operation.key, deleted: true, logicalTime, operationId: operation.operationId }));
            break;
          }
          case "unset-many": {
            const previous = await Promise.all(operation.keys.map(async (key) => ({ key, previous: previousSetting(await readSetting(operation.namespace, key)) })));
            inverse = { kind: "unset-many", namespace: operation.namespace, settings: previous };
            projectedSettings.push(...operation.keys.map((key) => parseSetting({ workspaceId: workspace.id, namespace: operation.namespace, key, deleted: true, logicalTime, operationId: operation.operationId })));
            break;
          }
        }

        if (expectedLifecycleNodeIds) {
          const actualNodeIds = inverse.kind === "trash" ? inverse.nodeIds : inverse.kind === "restore" ? inverse.nodes.map(({ nodeId }) => nodeId) : [];
          if (!equalValues(actualNodeIds, expectedLifecycleNodeIds)) throw new Error("A lifecycle compensation must cover the exact original forest.");
        }

        const localRevision = nextSafeInteger(workspace.localRevision, "The workspace revision is exhausted.");
        const destinationLocalRevision = destinationWorkspace ? nextSafeInteger(destinationWorkspace.localRevision, "The destination workspace revision is exhausted.") : null;
        const transferIdentities = operation.kind === "transfer" && inverse.kind === "transfer" ? transferAffectedIdentities(operation, inverse) : undefined;
        const affectedIdentities = transferIdentities ? [...new Set([...transferIdentities.source, ...transferIdentities.destination])].sort() : localAffectedIdentities(operation, inverse);
        const stored = parseStoredOperation({
          operationId: operation.operationId,
          workspaceId: operation.workspaceId,
          localRevision,
          destinationLocalRevision,
          stateKind: "pending",
          overlayKind: "active",
          intent: normalized.intent,
          compensatesOperationId: normalized.compensatesOperationId,
          expectedContentTuple: normalized.expectedContentTuple,
          operation,
          inverse,
          affectedIdentities,
          versionNodeIds: operationVersionNodeIds(operation),
        });
        const changes = [parseChangeRecord({ kind: "operation", workspaceId: workspace.id, revision: localRevision, operationId: operation.operationId, affectedIdentities: transferIdentities?.source ?? affectedIdentities })];
        if (destinationWorkspace && destinationLocalRevision !== null && transferIdentities) changes.push(parseChangeRecord({ kind: "operation", workspaceId: destinationWorkspace.id, revision: destinationLocalRevision, operationId: operation.operationId, affectedIdentities: transferIdentities.destination }));
        const nextWorkspace = parseWorkspace({ ...workspace, localRevision });
        const nextSync = parseSyncState({ ...sync, lastLocalLogicalTime: logicalTime });
        const writes: IDBRequest[] = [];
        for (const manifest of normalized.manifests) if (!storedManifests.has(manifest.hash)) writes.push(transaction.objectStore("manifests").add(manifest));
        for (const node of projectedNodes.values()) writes.push(addedNodeIds.has(node.id) ? nodes.add(node) : nodes.put(node));
        for (const nodeId of purgedNodeIds) writes.push(nodes.put(parseNodeRecord({ workspaceId: workspace.id, id: nodeId, purged: true, logicalTime, operationId: operation.operationId })));
        for (const setting of projectedSettings) writes.push(settingsStore.put(setting));
        writes.push(operations.add(stored));
        for (const change of changes) writes.push(transaction.objectStore("changes").add(change));
        writes.push(transaction.objectStore("workspaces").put(nextWorkspace));
        writes.push(transaction.objectStore("sync").put(nextSync));
        if (destinationWorkspace && destinationSync && destinationLocalRevision !== null) {
          writes.push(transaction.objectStore("workspaces").put(parseWorkspace({ ...destinationWorkspace, localRevision: destinationLocalRevision })));
          writes.push(transaction.objectStore("sync").put(parseSyncState({ ...destinationSync, lastLocalLogicalTime: logicalTime })));
        }
        await Promise.all(writes.map((write) => request(write)));
        return stored;
      });
    },

    listChanges: async (workspaceId, afterRevision, limit = WEB2_MAX_BATCH_ITEMS) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalRevision = parseNonNegativeSafeInteger(afterRevision, "A change replay revision is invalid.");
      const boundedLimit = parsePositiveSafeInteger(limit, "A change replay limit is invalid.");
      if (boundedLimit > WEB2_MAX_BATCH_ITEMS) throw new Error("A change replay limit is too large.");
      return transact(db, ["workspaces", "changes", "operations"], "readonly", async (transaction) => {
        const workspaceValue = await request(transaction.objectStore("workspaces").get(canonicalWorkspaceId));
        if (workspaceValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        if (canonicalRevision > workspace.localRevision) throw new Error("A change replay revision is ahead of the workspace.");
        if (canonicalRevision === workspace.localRevision) return [];
        const firstRevision = nextSafeInteger(canonicalRevision, "The change replay revision is exhausted.");
        const values = await request(transaction.objectStore("changes").getAll(keyRange.bound([canonicalWorkspaceId, firstRevision], [canonicalWorkspaceId, Number.MAX_SAFE_INTEGER]), boundedLimit));
        const changes = values.map(parseChangeRecord);
        const expectedCount = Math.min(boundedLimit, workspace.localRevision - canonicalRevision);
        if (changes.length !== expectedCount || changes.some((change, index) => change.workspaceId !== canonicalWorkspaceId || change.revision !== firstRevision + index)) throw new Error("Stored workspace changes are not contiguous.");
        const operations = transaction.objectStore("operations");
        await Promise.all(changes.map(async (change) => {
          const operationValue = await request(operations.get(change.operationId));
          if (change.kind === "hydration" || change.kind === "reset") {
            if (operationValue !== undefined) throw new Error(`A stored ${change.kind} change collides with an operation.`);
            return;
          }
          if (change.kind === "pull") return;
          const expected = operationValue === undefined ? undefined : changeForWorkspace(parseStoredOperation(operationValue), canonicalWorkspaceId);
          if (!expected || !equalValues(change, expected)) throw new Error("A stored workspace change does not match its operation.");
        }));
        return changes;
      });
    },

    listOperations: async (workspaceId, limit = 50) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const boundedLimit = parsePositiveSafeInteger(limit, "An operation list limit is invalid.");
      if (boundedLimit > WEB2_MAX_BATCH_ITEMS) throw new Error("An operation list limit is too large.");
      return transact(db, "operations", "readonly", async (transaction) => new Promise<StoredOperation[]>((resolve, reject) => {
        const result: StoredOperation[] = [];
        const cursor = transaction.objectStore("operations").index("by-workspace-revision").openCursor(keyRange.bound([canonicalWorkspaceId, 0], [canonicalWorkspaceId, Number.MAX_SAFE_INTEGER]), "prev");
        cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem operation history could not be read."));
        cursor.onsuccess = () => {
          try {
            if (!cursor.result || result.length === boundedLimit) { resolve(result); return; }
            result.push(parseStoredOperation(cursor.result.value));
            cursor.result.continue();
          } catch (error) {
            reject(error);
          }
        };
      }));
    },

    listFileVersions: async (workspaceId, nodeId) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalNodeId = parseStableId(nodeId, "A node ID is invalid.");
      const versions = await transact(db, ["nodes", "operations"], "readonly", async (transaction) => {
        const nodeValue = await request(transaction.objectStore("nodes").get(canonicalNodeId));
        if (nodeValue === undefined) throw new Error("That file does not exist.");
        const record = parseStoredNodeRecord(nodeValue);
        if (isPurgeTombstone(record)) throw new Error("That file does not exist.");
        const node = record;
        if (node.workspaceId !== canonicalWorkspaceId || node.kind !== "file") throw new Error("File versions require a file in its workspace.");
        if (node.fieldTuples.content === null) throw new Error("A stored file is missing its content tuple.");
        const contentTuple = node.fieldTuples.content;
        const currentOperationValue = await request(transaction.objectStore("operations").get(contentTuple.operationId));
        const retainedCurrent = currentOperationValue === undefined ? undefined : fileVersionFromOperation(parseStoredOperation(currentOperationValue).operation, node.id);
        if (retainedCurrent && (retainedCurrent.logicalTime !== contentTuple.logicalTime || retainedCurrent.mimeType !== node.mimeType || retainedCurrent.size !== node.size || retainedCurrent.manifestHash !== node.manifestHash)) throw new Error("The current file version is inconsistent with its retained operation.");
        const current = {
          nodeId: node.id,
          operationId: contentTuple.operationId,
          logicalTime: contentTuple.logicalTime,
          mimeType: node.mimeType,
          size: node.size,
          manifestHash: node.manifestHash,
          modifiedAt: retainedCurrent?.modifiedAt ?? node.modifiedAt,
          current: true,
        } satisfies FileVersion;
        const older = await new Promise<FileVersion[]>((resolve, reject) => {
          const result: FileVersion[] = [];
          // ponytail: this bounded scan avoids a schema change; add a node-version index when measured history size makes it slow.
          const cursor = transaction.objectStore("operations").openCursor();
          cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem version history could not be read."));
          cursor.onsuccess = () => {
            try {
              if (!cursor.result) { resolve(result); return; }
              const stored = parseStoredOperation(cursor.result.value);
              if (stored.versionNodeIds.includes(canonicalNodeId) && stored.operationId !== current.operationId) {
                const version = fileVersionFromOperation(stored.operation, canonicalNodeId);
                if (version) {
                  const index = result.findIndex((existing) => version.logicalTime > existing.logicalTime || version.logicalTime === existing.logicalTime && version.operationId > existing.operationId);
                  result.splice(index === -1 ? result.length : index, 0, version);
                  if (result.length > FILE_VERSION_HISTORY_LIMIT) result.pop();
                }
              }
              cursor.result.continue();
            } catch (error) {
              reject(error);
            }
          };
        });
        return [current, ...older];
      });
      const manifests = await readStoredManifests([...new Set(versions.map(({ manifestHash }) => manifestHash))]);
      for (const version of versions) {
        const manifest = manifests.get(version.manifestHash);
        if (manifest && manifest.manifest.size !== version.size) throw new Error("A file version has inconsistent manifest metadata.");
      }
      return versions;
    },

    sweepManifests: async () => {
      const retained = await transact(db, ["workspaces", "nodes", "operations", "manifests"], "readwrite", async (transaction) => {
        const [workspaceValues, nodeValues, operationValues, manifestValues] = await Promise.all([
          request(transaction.objectStore("workspaces").getAll()),
          request(transaction.objectStore("nodes").getAll()),
          request(transaction.objectStore("operations").getAll()),
          request(transaction.objectStore("manifests").getAll()),
        ]);
        const workspaceIds = new Set(parseWorkspaceList(workspaceValues).map(({ id }) => id));
        const liveNodeIds = new Set<string>();
        const retainedHashes = new Set<string>();
        for (const value of nodeValues) {
          const record = parseStoredNodeRecord(value);
          if (isPurgeTombstone(record)) continue;
          liveNodeIds.add(record.id);
          if (record.kind === "file") retainedHashes.add(record.manifestHash);
        }
        for (const value of operationValues) {
          const stored = parseStoredOperation(value);
          if (workspaceIds.has(stored.workspaceId) || stored.versionNodeIds.some((id) => liveNodeIds.has(id))) for (const hash of storedManifestHashes(stored)) retainedHashes.add(hash);
        }
        const manifests = manifestValues.map(parseStoredManifest);
        const manifestHashes = new Set(manifests.map(({ hash }) => hash));
        if ([...retainedHashes].some((hash) => !manifestHashes.has(hash))) throw new Error("A retained manifest is missing.");
        await Promise.all(manifests.filter(({ hash }) => !retainedHashes.has(hash)).map(({ hash }) => request(transaction.objectStore("manifests").delete(hash))));
        return manifests.filter(({ hash }) => retainedHashes.has(hash));
      });
      const hashes = new Set<string>();
      for (const value of retained) for (const chunk of (await validateStoredManifest(value)).manifest.chunks) hashes.add(chunk.hash);
      return [...hashes].sort();
    },
  };
}

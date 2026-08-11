import { parseJsonValue, type JsonValue } from "@hiraya-team/apps-contracts";
import { normalizeAssociationMatcher, parseFileAssociation, parseInstalledApp, parseQuarantinedApp, type FileAssociation, type InstalledApp, type QuarantinedApp } from "../../apps/installed-apps";
import type { PersistedDesktopState } from "../../domain/desktop-state";
import type { LocalPreferences } from "../../domain/preferences";
import type { DesktopIdentity } from "../../types";
import { activityRecord, parseActivityPage, parseActivityQuery, type ActivityPage, type ActivityQuery, type NewActivityRecord, type ValidActivityRecord } from "../../lib/activity";
import { parseDesktopIdentity } from "../../lib/contracts";
import { parseDesktopState } from "../../lib/desktop-state";
import { parseAccountAppsSnapshot, type AccountAppsSnapshot } from "../../lib/account-apps";
import { parseAccountAppOperation, parseAccountAppOutboxRecord, projectAccountApps, rebaseAccountAppOperation, type AccountAppDataRestoration, type AccountAppOperation, type AccountAppOutboxRecord, type PersistedAccountApps } from "../../lib/account-app-outbox";
import { applyOutboxOperation, desktopPendingOperationProtection, normalizeOutboxOperation, outboxOperationDesktopIds, outboxRecordsDependingOnDesktop, parseRevisionConflictDetails, rebaseOutboxOperationAfterAcknowledgement, transferEntriesBetweenDesktopStates, type OutboxOperation, type OutboxRecord, type RevisionConflictDetails } from "../../lib/outbox";
import { EMPTY_WINDOW_SESSION, parseWindowSession, type WindowSession } from "../../lib/window-session";
import { getActiveDesktopContext, getRoot, indexedDatabaseName } from "./namespace";
import { RESERVED_SYSTEM_APP_IDS, RETIRED_SYSTEM_APP_IDS, SYSTEM_APP_IDS } from "../../apps/system-app-ids";

type StorageDbRequests = {
  listDesktops: undefined;
  createDesktop: { desktop: DesktopIdentity; state: PersistedDesktopState };
  createOfflineDesktop: { desktop: DesktopIdentity; state: PersistedDesktopState };
  renameDesktop: { desktopId: string; name: string };
  updateDesktopIdentity: { desktop: DesktopIdentity };
  deleteDesktop: { desktopId: string };
  readDesktop: { desktopId: string };
  transferEntries: { sourceDesktopId: string; destinationDesktopId: string; entryIds: string[]; parentId: string | null };
  enqueueTransfer: { operationId: string; catalogId: string | null; sourceDesktopId: string; destinationDesktopId: string; entryIds: string[]; parentId: string | null };
  replaceDesktopState: { state: PersistedDesktopState; activity?: NewActivityRecord };
  readPreferences: undefined;
  writePreferences: { preferences: LocalPreferences };
  readWindowSession: { desktopId: string };
  writeWindowSession: { desktopId: string; session: WindowSession };
  reserveOperation: undefined;
  enqueueMutation: { operationId: string; catalogId: string | null; operation: OutboxOperation };
  enqueueDesktopCreate: { operationId: string; catalogId: string | null; desktop: DesktopIdentity; state: PersistedDesktopState };
  enqueueDesktopRename: { operationId: string; catalogId: string | null; desktop: DesktopIdentity; baseRevision: number };
  enqueueDesktopDelete: { operationId: string; catalogId: string | null; ownerDesktopId: string; desktopId: string; baseRevision: number };
  readOutbox: undefined;
  bindOutboxCatalog: { catalogId: string };
  applyRemoteWithOutbox: { state: PersistedDesktopState; acknowledgedOperationId?: string; acknowledgedRevision?: number; removeAcknowledged?: boolean };
  acknowledgeMutation: { operationId: string };
  blockMutation: { operationId: string; error: string; errorCode: string | null; conflictDetails: RevisionConflictDetails | null };
  rebaseBlockedMutation: { operationId: string; operation: OutboxOperation };
  resolveContentConflictKeepBoth: { operationId: string; replacementOperationId: string; state: PersistedDesktopState; operation: OutboxOperation };
  recordMutationAttempt: { operationId: string; attemptedAt: number };
  discardDesktopProjection: { desktopId: string; operationId: string };
  listActivity: ActivityQuery;
  pruneDesktops: { retainedDesktopIds: string[] };
  listInstalledApps: undefined;
  installApp: { install: InstalledApp };
  retireMarkdownPreview: undefined;
  retireSceneEditor: undefined;
  uninstallApp: { appId: string };
  listQuarantinedApps: undefined;
  removeQuarantinedApp: { appId: string };
  listFileAssociations: undefined;
  setFileAssociation: { association: FileAssociation };
  removeFileAssociation: { matcher: string };
  resetFileAssociations: undefined;
  readAppStorage: { appId: string; key: string };
  writeAppStorage: { appId: string; key: string; value: JsonValue; maxBytes: number; maxEntries: number };
  removeAppStorage: { appId: string; key: string };
  clearAppStorage: { appId: string };
  readAccountApps: undefined;
  enqueueAccountAppOperation: { operation: AccountAppOperation; localData?: { kind: "put"; appId: string; key: string; value: JsonValue } | { kind: "delete"; appId: string; key: string } | { kind: "clear"; appId: string } };
  reconcileAccountApps: { snapshot: AccountAppsSnapshot; acknowledgedOperationId?: string };
  blockAccountAppOperation: { operationId: string; error: string; errorCode: string };
  retryAccountAppOperation: { operationId: string };
  discardAccountAppOperation: { operationId: string; restoration?: AccountAppDataRestoration };
  recordAccountAppAttempt: { operationId: string; attemptedAt: number };
};

type StorageDbResponses = {
  listDesktops: { desktops: DesktopIdentity[] };
  createDesktop: DesktopIdentity;
  createOfflineDesktop: { desktop: DesktopIdentity; record: OutboxRecord };
  renameDesktop: DesktopIdentity;
  updateDesktopIdentity: DesktopIdentity;
  deleteDesktop: undefined;
  readDesktop: PersistedDesktopState;
  transferEntries: { source: PersistedDesktopState; destination: PersistedDesktopState };
  enqueueTransfer: { state: PersistedDesktopState; record: OutboxRecord };
  replaceDesktopState: undefined;
  readPreferences: LocalPreferences;
  writePreferences: undefined;
  readWindowSession: WindowSession;
  writeWindowSession: undefined;
  reserveOperation: { clientId: string; operationId: string; sequence: number };
  enqueueMutation: { state: PersistedDesktopState; record: OutboxRecord };
  enqueueDesktopCreate: { desktop: DesktopIdentity; record: OutboxRecord };
  enqueueDesktopRename: { desktop: DesktopIdentity; record: OutboxRecord };
  enqueueDesktopDelete: { record: OutboxRecord };
  readOutbox: OutboxRecord[];
  bindOutboxCatalog: undefined;
  applyRemoteWithOutbox: { state: PersistedDesktopState; blocked: OutboxRecord[] };
  acknowledgeMutation: undefined;
  blockMutation: undefined;
  rebaseBlockedMutation: OutboxRecord;
  resolveContentConflictKeepBoth: { state: PersistedDesktopState; record: OutboxRecord };
  recordMutationAttempt: undefined;
  discardDesktopProjection: { operationIds: string[]; fileIds: string[]; affectedDesktopIds: string[] };
  listActivity: ActivityPage;
  pruneDesktops: undefined;
  listInstalledApps: InstalledApp[];
  installApp: InstalledApp;
  retireMarkdownPreview: string | null;
  retireSceneEditor: string | null;
  uninstallApp: undefined;
  listQuarantinedApps: QuarantinedApp[];
  removeQuarantinedApp: undefined;
  listFileAssociations: FileAssociation[];
  setFileAssociation: FileAssociation;
  removeFileAssociation: undefined;
  resetFileAssociations: undefined;
  readAppStorage: JsonValue | undefined;
  writeAppStorage: undefined;
  removeAppStorage: undefined;
  clearAppStorage: undefined;
  readAccountApps: { state: PersistedAccountApps; outbox: AccountAppOutboxRecord[] };
  enqueueAccountAppOperation: { state: PersistedAccountApps; record: AccountAppOutboxRecord };
  reconcileAccountApps: PersistedAccountApps;
  blockAccountAppOperation: undefined;
  retryAccountAppOperation: AccountAppOutboxRecord;
  discardAccountAppOperation: undefined;
  recordAccountAppAttempt: undefined;
};

type StorageDbMethod = keyof StorageDbRequests;
type DesktopRecord = { id: string; ordinal: number; identity: DesktopIdentity; state: PersistedDesktopState };
type ClientState = { id: "singleton"; clientId: string; nextSequence: number };
type AppStorageRecord = { appId: string; key: string; value: JsonValue; bytes: number };
type AccountAppClientState = { id: "singleton"; clientId: string; nextSequence: number };

const DATABASE_VERSION = 2;
const HISTORY_LIMIT = Number(import.meta.env.HIRAYA_HISTORY_LIMIT);
const DEFAULT_PREFERENCES: LocalPreferences = { autoUpdate: true, externalEmbeddedPreviews: false, allowBrowserPinchZoom: false, searchAllDesktops: false, onboardingVersion: 0, showDesktopMinimap: true, explorerView: "list", showHiddenFiles: false, desktops: [] };
const STORES = {
  desktops: "desktops",
  outbox: "outbox",
  clientState: "client-state",
  preferences: "preferences",
  sessions: "sessions",
  activity: "activity",
  installedApps: "installed-apps",
  quarantinedApps: "quarantined-apps",
  appStorage: "app-storage",
  fileAssociations: "file-associations",
  accountApps: "account-apps",
  accountAppOutbox: "account-app-outbox",
  accountAppClientState: "account-app-client-state",
} as const;
export const ACCOUNT_APP_ATOMIC_STORES = [STORES.accountApps, STORES.accountAppOutbox, STORES.accountAppClientState, STORES.appStorage] as const;

let database: Promise<IDBDatabase> | null = null;

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Local storage failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("The local storage transaction was cancelled."));
    transaction.onerror = () => reject(transaction.error ?? new Error("The local storage transaction failed."));
  });
}

async function transact<T>(storeNames: string | string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
  const transaction = (await openDatabase()).transaction(storeNames, mode, { durability: mode === "readwrite" ? "strict" : "default" });
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

function openDatabase() {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(indexedDatabaseName(), DATABASE_VERSION);
    let settled = false;
    open.onupgradeneeded = (event) => {
      const db = open.result;
      if (event.oldVersion < 1) {
        const desktops = db.createObjectStore(STORES.desktops, { keyPath: "id" });
        desktops.createIndex("ordinal", "ordinal", { unique: true });
        const outbox = db.createObjectStore(STORES.outbox, { keyPath: "sequence" });
        outbox.createIndex("operationId", "operationId", { unique: true });
        outbox.createIndex("desktopId", "desktopId");
        db.createObjectStore(STORES.clientState, { keyPath: "id" });
        db.createObjectStore(STORES.preferences);
        db.createObjectStore(STORES.sessions);
        db.createObjectStore(STORES.activity, { keyPath: "catalogRevision", autoIncrement: true });
        db.createObjectStore(STORES.installedApps, { keyPath: "appId" });
        db.createObjectStore(STORES.quarantinedApps, { keyPath: "appId" });
        const appStorage = db.createObjectStore(STORES.appStorage, { keyPath: ["appId", "key"] });
        appStorage.createIndex("appId", "appId");
        const associations = db.createObjectStore(STORES.fileAssociations, { keyPath: "matcher" });
        associations.createIndex("appId", "appId");
      }
      if (event.oldVersion < 2) {
        db.createObjectStore(STORES.accountApps, { keyPath: "id" });
        const outbox = db.createObjectStore(STORES.accountAppOutbox, { keyPath: "sequence" });
        outbox.createIndex("operationId", "operationId", { unique: true });
        db.createObjectStore(STORES.accountAppClientState, { keyPath: "id" });
      }
    };
    open.onsuccess = () => {
      if (settled) { open.result.close(); return; }
      settled = true;
      const db = open.result;
      db.onversionchange = () => { db.close(); if (database) database = null; };
      db.onclose = () => { if (database) database = null; };
      resolve(db);
    };
    open.onerror = () => { settled = true; database = null; reject(open.error ?? new Error("Local storage could not be opened.")); };
    open.onblocked = () => {
      if (settled) return;
      settled = true;
      database = null;
      reject(new Error("Local storage is open in an older Hiraya tab. Close other Hiraya tabs and reload."));
    };
  });
  return database;
}

function parseDesktopRecord(value: DesktopRecord): DesktopRecord {
  if (!value || typeof value !== "object" || !Number.isSafeInteger(value.ordinal) || value.ordinal < 0) throw new Error("The desktop database contains invalid metadata.");
  const identity = parseDesktopIdentity(value.identity, true);
  if (value.id !== identity.id) throw new Error("The desktop database contains invalid metadata.");
  return { id: identity.id, ordinal: value.ordinal, identity, state: parseDesktopState(value.state) };
}

async function readDesktop(store: IDBObjectStore, desktopId: string) {
  const record = await request(store.get(desktopId)) as DesktopRecord | undefined;
  if (!record) throw new Error("That desktop no longer exists.");
  return parseDesktopRecord(record);
}

async function readDesktops(store: IDBObjectStore) {
  return ((await request(store.index("ordinal").getAll())) as DesktopRecord[]).map(parseDesktopRecord);
}

export function assertUniqueDesktopEntryIds(records: readonly Pick<DesktopRecord, "id" | "state">[]) {
  const owners = new Map<string, string>();
  for (const record of records) for (const entry of parseDesktopState(record.state).entries) {
    const owner = owners.get(entry.id);
    if (owner && owner !== record.id) throw new Error("The desktop database contains duplicate entry IDs.");
    owners.set(entry.id, record.id);
  }
}

async function writeDesktopStates(store: IDBObjectStore, updates: ReadonlyMap<string, PersistedDesktopState>) {
  const records = await readDesktops(store);
  const next = records.map((record) => updates.has(record.id) ? { ...record, state: parseDesktopState(updates.get(record.id)) } : record);
  for (const id of updates.keys()) if (!records.some((record) => record.id === id)) throw new Error("That desktop no longer exists.");
  assertUniqueDesktopEntryIds(next);
  for (const record of next) if (updates.has(record.id)) await request(store.put(record));
}

async function createDesktop(store: IDBObjectStore, desktopValue: DesktopIdentity, stateValue: PersistedDesktopState) {
  const desktop = parseDesktopIdentity(desktopValue, true);
  const state = parseDesktopState(stateValue);
  const records = await readDesktops(store);
  const ordinal = records.reduce((maximum, record) => Math.max(maximum, record.ordinal), -1) + 1;
  const record = { id: desktop.id, ordinal, identity: desktop, state } satisfies DesktopRecord;
  assertUniqueDesktopEntryIds([...records, record]);
  await request(store.add(record));
  return desktop;
}

function parseOutboxRecord(value: OutboxRecord): OutboxRecord {
  if (!value || typeof value !== "object" || !Number.isSafeInteger(value.sequence) || value.sequence <= 0 || value.operationId !== value.sequence.toString().padStart(16, "0") || typeof value.clientId !== "string" || typeof value.desktopId !== "string" || !["pending", "blocked"].includes(value.status) || !Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0 || value.lastAttemptAt !== null && (!Number.isSafeInteger(value.lastAttemptAt) || value.lastAttemptAt < 0)) throw new Error("The local outbox contains invalid metadata.");
  return { ...value, operation: normalizeOutboxOperation(value.operation), errorCode: value.errorCode ?? null, conflictDetails: value.conflictDetails == null ? null : parseRevisionConflictDetails(value.conflictDetails) };
}

async function readOutbox(store: IDBObjectStore, desktopId?: string) {
  const values = desktopId === undefined ? await request(store.getAll()) : await request(store.index("desktopId").getAll(desktopId));
  return (values as OutboxRecord[]).map(parseOutboxRecord).sort((left, right) => left.sequence - right.sequence);
}

async function insertOutbox(store: IDBObjectStore, clientStore: IDBObjectStore, operationId: string, catalogId: string | null, desktopId: string, operationValue: OutboxOperation) {
  const identity = await request(clientStore.get("singleton")) as ClientState | undefined;
  if (!identity) throw new Error("The local operation identity is unavailable.");
  const sequence = Number.parseInt(operationId, 10);
  const record = parseOutboxRecord({ operationId, sequence, clientId: identity.clientId, catalogId, desktopId, operation: normalizeOutboxOperation(operationValue), status: "pending", error: null, errorCode: null, conflictDetails: null, attemptCount: 0, lastAttemptAt: null });
  await request(store.add(record));
  return record;
}

async function reserveOperation(store: IDBObjectStore) {
  let state = await request(store.get("singleton")) as ClientState | undefined;
  if (!state) state = { id: "singleton", clientId: crypto.randomUUID(), nextSequence: 1 };
  if (state.id !== "singleton" || typeof state.clientId !== "string" || !state.clientId || !Number.isSafeInteger(state.nextSequence) || state.nextSequence <= 0) throw new Error("The local operation identity is invalid.");
  const sequence = state.nextSequence;
  await request(store.put({ ...state, nextSequence: sequence + 1 }));
  return { clientId: state.clientId, sequence, operationId: sequence.toString().padStart(16, "0") };
}

async function readAccountAppOutbox(store: IDBObjectStore) {
  return (await request(store.getAll()) as AccountAppOutboxRecord[]).map(parseAccountAppOutboxRecord).sort((left, right) => left.sequence - right.sequence);
}

async function accountAppState(store: IDBObjectStore, outbox: readonly AccountAppOutboxRecord[]): Promise<PersistedAccountApps> {
  const stored = await request(store.get("singleton")) as PersistedAccountApps | undefined;
  const baseline = stored?.baseline == null ? null : parseAccountAppsSnapshot(stored.baseline);
  const projection = projectAccountApps(baseline, outbox);
  if (stored && JSON.stringify(stored.projection) !== JSON.stringify(projection)) throw new Error("The account app projection does not match its baseline and outbox.");
  return { id: "singleton", baseline, projection };
}

async function reserveAccountAppOperation(store: IDBObjectStore) {
  let state = await request(store.get("singleton")) as AccountAppClientState | undefined;
  if (!state) state = { id: "singleton", clientId: crypto.randomUUID(), nextSequence: 1 };
  if (state.id !== "singleton" || !state.clientId || !Number.isSafeInteger(state.nextSequence) || state.nextSequence < 1) throw new Error("The account app operation identity is invalid.");
  const sequence = state.nextSequence;
  await request(store.put({ ...state, nextSequence: sequence + 1 }));
  return { clientId: state.clientId, sequence, operationId: sequence.toString().padStart(16, "0") };
}

async function writeLocalAccountAppData(transaction: IDBTransaction, action: NonNullable<StorageDbRequests["enqueueAccountAppOperation"]["localData"]>) {
  const store = transaction.objectStore(STORES.appStorage);
  if (action.kind === "delete") return request(store.delete([action.appId, action.key])).then(() => undefined);
  if (action.kind === "clear") {
    for (const record of await request(store.index("appId").getAll(action.appId)) as AppStorageRecord[]) await request(store.delete([record.appId, record.key]));
    return;
  }
  const value = parseJsonValue(action.value);
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const records = await request(store.index("appId").getAll(action.appId)) as AppStorageRecord[];
  const existing = records.find((record) => record.key === action.key);
  if (!existing && records.length >= 128) throw new Error("App storage entry quota exceeded.");
  if (records.reduce((sum, record) => sum + record.bytes, 0) - (existing?.bytes ?? 0) + bytes > 64 * 1024) throw new Error("App storage quota exceeded.");
  await request(store.put({ appId: action.appId, key: action.key, value, bytes } satisfies AppStorageRecord));
}

async function restoreLocalAccountAppData(transaction: IDBTransaction, operation: AccountAppOperation, restoration?: AccountAppDataRestoration) {
  if (operation.kind === "install" || operation.kind === "uninstall" || operation.kind === "handlers") {
    if (restoration) throw new Error("That account app change does not restore local data.");
    return;
  }
  if (!restoration || restoration.appId !== operation.appId) throw new Error("Local app data must be restored before discarding this change.");
  if (restoration.kind !== "replace" && operation.kind !== "clear-data") {
    if (restoration.key !== operation.key) throw new Error("The local app data restoration does not match the discarded change.");
    await writeLocalAccountAppData(transaction, restoration);
    return;
  }
  if (restoration.kind !== "replace") throw new Error("The local app data restoration does not match the discarded clear.");
  if (restoration.values.length > 128 || new Set(restoration.values.map(([key]) => key)).size !== restoration.values.length) throw new Error("The local app data restoration is invalid.");
  const values = restoration.values.map(([key, value]) => ({ key, value: parseJsonValue(value) }));
  const total = values.reduce((sum, item) => sum + new TextEncoder().encode(JSON.stringify(item.value)).byteLength, 0);
  if (total > 64 * 1024) throw new Error("App storage quota exceeded.");
  const store = transaction.objectStore(STORES.appStorage);
  for (const record of await request(store.index("appId").getAll(operation.appId)) as AppStorageRecord[]) await request(store.delete([record.appId, record.key]));
  for (const item of values) await request(store.put({ appId: operation.appId, key: item.key, value: item.value, bytes: new TextEncoder().encode(JSON.stringify(item.value)).byteLength } satisfies AppStorageRecord));
}

function parsePreferences(value: unknown): LocalPreferences {
  if (!value || typeof value !== "object") throw new Error("The local preferences have an unsupported format.");
  const item = value as LocalPreferences;
  if ([item.autoUpdate, item.externalEmbeddedPreviews, item.allowBrowserPinchZoom, item.searchAllDesktops, item.showDesktopMinimap].some((field) => typeof field !== "boolean") || item.showHiddenFiles !== undefined && typeof item.showHiddenFiles !== "boolean" || !Number.isSafeInteger(item.onboardingVersion) || item.onboardingVersion < 0 || !["list", "grid"].includes(item.explorerView)) throw new Error("The local preferences have an unsupported format.");
  const desktops = item.desktops ?? [];
  if (!Array.isArray(desktops) || desktops.length > 1000 || desktops.some((desktop) => !desktop || typeof desktop.id !== "string" || !desktop.id || typeof desktop.pinned !== "boolean") || new Set(desktops.map((desktop) => desktop.id)).size !== desktops.length) throw new Error("The local preferences have an unsupported format.");
  return { ...item, showHiddenFiles: item.showHiddenFiles ?? false, desktops };
}

async function appendActivity(store: IDBObjectStore, value: NewActivityRecord) {
  const record = activityRecord(value.summary, value.details, value.timestamp, value.action);
  await request(store.add(record));
  const keys = await request(store.getAllKeys());
  for (const key of keys.slice(0, Math.max(0, keys.length - HISTORY_LIMIT))) await request(store.delete(key));
}

async function listActivity(store: IDBObjectStore, value: ActivityQuery) {
  const query = parseActivityQuery(value);
  const records = (await request(store.getAll()) as Array<ValidActivityRecord & { catalogRevision: number }>).reverse().filter((record) => {
    if (query.before !== undefined && record.catalogRevision >= query.before) return false;
    return !query.q || [record.action, record.source, record.summary, ...record.details].join("\n").toLocaleLowerCase().includes(query.q.toLocaleLowerCase());
  });
  const activities = records.slice(0, query.limit);
  return parseActivityPage({ activities, nextBefore: records.length > query.limit ? activities.at(-1)!.catalogRevision : null });
}

async function deleteAppData(transaction: IDBTransaction, appId: string) {
  const storage = transaction.objectStore(STORES.appStorage);
  for (const record of await request(storage.index("appId").getAll(appId)) as AppStorageRecord[]) await request(storage.delete([record.appId, record.key]));
  const associations = transaction.objectStore(STORES.fileAssociations);
  for (const association of await request(associations.index("appId").getAll(appId)) as FileAssociation[]) await request(associations.delete(association.matcher));
}

async function dispatch<M extends StorageDbMethod>(method: M, params: StorageDbRequests[M], desktopId: string | null): Promise<StorageDbResponses[M]> {
  switch (method) {
    case "listDesktops": return transact(STORES.desktops, "readonly", async (tx) => ({ desktops: (await readDesktops(tx.objectStore(STORES.desktops))).map((record) => record.identity) })) as Promise<StorageDbResponses[M]>;
    case "createDesktop": {
      const input = params as StorageDbRequests["createDesktop"];
      return transact(STORES.desktops, "readwrite", (tx) => createDesktop(tx.objectStore(STORES.desktops), input.desktop, input.state)) as Promise<StorageDbResponses[M]>;
    }
    case "createOfflineDesktop": {
      const input = params as StorageDbRequests["createOfflineDesktop"];
      return transact([STORES.desktops, STORES.outbox, STORES.clientState], "readwrite", async (tx) => {
        const desktop = await createDesktop(tx.objectStore(STORES.desktops), input.desktop, input.state);
        const reservation = await reserveOperation(tx.objectStore(STORES.clientState));
        const record = await insertOutbox(tx.objectStore(STORES.outbox), tx.objectStore(STORES.clientState), reservation.operationId, null, desktop.id, { schemaVersion: 1, kind: "create-desktop", desktop });
        return { desktop, record };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "renameDesktop": {
      const input = params as StorageDbRequests["renameDesktop"];
      return transact(STORES.desktops, "readwrite", async (tx) => {
        const store = tx.objectStore(STORES.desktops); const record = await readDesktop(store, input.desktopId);
        const identity = parseDesktopIdentity({ ...record.identity, name: input.name }, true);
        await request(store.put({ ...record, identity })); return identity;
      }) as Promise<StorageDbResponses[M]>;
    }
    case "updateDesktopIdentity": {
      const desktop = parseDesktopIdentity((params as StorageDbRequests["updateDesktopIdentity"]).desktop, true);
      return transact(STORES.desktops, "readwrite", async (tx) => { const store = tx.objectStore(STORES.desktops); const record = await readDesktop(store, desktop.id); await request(store.put({ ...record, identity: { ...desktop, name: record.identity.name } })); return desktop; }) as Promise<StorageDbResponses[M]>;
    }
    case "deleteDesktop": {
      const id = (params as StorageDbRequests["deleteDesktop"]).desktopId;
      return transact([STORES.desktops, STORES.outbox, STORES.sessions], "readwrite", async (tx) => {
        const store = tx.objectStore(STORES.desktops); await readDesktop(store, id);
        const protection = desktopPendingOperationProtection(await readOutbox(tx.objectStore(STORES.outbox)), id); if (protection) throw new Error(protection);
        await request(store.delete(id)); await request(tx.objectStore(STORES.sessions).delete(id));
      }) as Promise<StorageDbResponses[M]>;
    }
    case "readDesktop": return transact(STORES.desktops, "readonly", async (tx) => (await readDesktop(tx.objectStore(STORES.desktops), (params as StorageDbRequests["readDesktop"]).desktopId)).state) as Promise<StorageDbResponses[M]>;
    case "replaceDesktopState": {
      if (!desktopId) throw new Error("No desktop is active for this request.");
      const input = params as StorageDbRequests["replaceDesktopState"];
      return transact(input.activity ? [STORES.desktops, STORES.activity] : STORES.desktops, "readwrite", async (tx) => {
        await writeDesktopStates(tx.objectStore(STORES.desktops), new Map([[desktopId, input.state]]));
        if (input.activity) await appendActivity(tx.objectStore(STORES.activity), input.activity);
      }) as Promise<StorageDbResponses[M]>;
    }
    case "transferEntries": {
      const input = params as StorageDbRequests["transferEntries"];
      return transact(STORES.desktops, "readwrite", async (tx) => {
        const store = tx.objectStore(STORES.desktops); const source = await readDesktop(store, input.sourceDesktopId); const destination = await readDesktop(store, input.destinationDesktopId);
        const moved = transferEntriesBetweenDesktopStates(source.state, destination.state, input.entryIds, input.parentId);
        const nextSource = parseDesktopState(moved.source); const nextDestination = parseDesktopState(moved.destination);
        await writeDesktopStates(store, new Map([[source.id, nextSource], [destination.id, nextDestination]]));
        return { source: nextSource, destination: nextDestination };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "readPreferences": return transact(STORES.preferences, "readonly", async (tx) => { const value = await request(tx.objectStore(STORES.preferences).get("singleton")); return value === undefined ? { ...DEFAULT_PREFERENCES } : parsePreferences(value); }) as Promise<StorageDbResponses[M]>;
    case "writePreferences": return transact(STORES.preferences, "readwrite", async (tx) => { await request(tx.objectStore(STORES.preferences).put(parsePreferences((params as StorageDbRequests["writePreferences"]).preferences), "singleton")); }) as Promise<StorageDbResponses[M]>;
    case "readWindowSession": return transact(STORES.sessions, "readonly", async (tx) => { const value = await request(tx.objectStore(STORES.sessions).get((params as StorageDbRequests["readWindowSession"]).desktopId)); return value === undefined ? EMPTY_WINDOW_SESSION : parseWindowSession(value); }) as Promise<StorageDbResponses[M]>;
    case "writeWindowSession": { const input = params as StorageDbRequests["writeWindowSession"]; return transact([STORES.desktops, STORES.sessions], "readwrite", async (tx) => { await readDesktop(tx.objectStore(STORES.desktops), input.desktopId); await request(tx.objectStore(STORES.sessions).put(parseWindowSession(input.session), input.desktopId)); }) as Promise<StorageDbResponses[M]>; }
    case "reserveOperation": return transact(STORES.clientState, "readwrite", (tx) => reserveOperation(tx.objectStore(STORES.clientState))) as Promise<StorageDbResponses[M]>;
    case "enqueueMutation": {
      if (!desktopId) throw new Error("No desktop is active for this request."); const input = params as StorageDbRequests["enqueueMutation"];
      return transact([STORES.desktops, STORES.outbox, STORES.clientState], "readwrite", async (tx) => {
        const desktops = tx.objectStore(STORES.desktops); const current = await readDesktop(desktops, desktopId); const state = parseDesktopState(applyOutboxOperation(current.state, input.operation));
        const record = await insertOutbox(tx.objectStore(STORES.outbox), tx.objectStore(STORES.clientState), input.operationId, input.catalogId, desktopId, input.operation);
        await writeDesktopStates(desktops, new Map([[current.id, state]])); return { state, record };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "enqueueDesktopCreate": {
      const input = params as StorageDbRequests["enqueueDesktopCreate"];
      return transact([STORES.desktops, STORES.outbox, STORES.clientState], "readwrite", async (tx) => {
        const desktop = await createDesktop(tx.objectStore(STORES.desktops), input.desktop, input.state);
        const record = await insertOutbox(tx.objectStore(STORES.outbox), tx.objectStore(STORES.clientState), input.operationId, input.catalogId, desktop.id, { schemaVersion: 1, kind: "create-desktop", desktop }); return { desktop, record };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "enqueueDesktopRename": {
      const input = params as StorageDbRequests["enqueueDesktopRename"];
      return transact([STORES.desktops, STORES.outbox, STORES.clientState], "readwrite", async (tx) => {
        const desktops = tx.objectStore(STORES.desktops); const current = await readDesktop(desktops, input.desktop.id); const identity = parseDesktopIdentity({ ...current.identity, name: input.desktop.name }, true);
        const operation: OutboxOperation = { schemaVersion: 1, kind: "rename-desktop", desktop: identity };
        await request(desktops.put({ ...current, identity })); const record = await insertOutbox(tx.objectStore(STORES.outbox), tx.objectStore(STORES.clientState), input.operationId, input.catalogId, identity.id, operation); return { desktop: identity, record };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "enqueueDesktopDelete": {
      const input = params as StorageDbRequests["enqueueDesktopDelete"];
      return transact([STORES.desktops, STORES.outbox, STORES.clientState, STORES.sessions], "readwrite", async (tx) => {
        const desktops = tx.objectStore(STORES.desktops); await readDesktop(desktops, input.desktopId); const outbox = tx.objectStore(STORES.outbox);
        const protection = desktopPendingOperationProtection(await readOutbox(outbox), input.desktopId); if (protection) throw new Error(protection);
        await request(desktops.delete(input.desktopId)); await request(tx.objectStore(STORES.sessions).delete(input.desktopId));
        const record = await insertOutbox(outbox, tx.objectStore(STORES.clientState), input.operationId, input.catalogId, input.ownerDesktopId, { schemaVersion: 1, kind: "delete-desktop", desktopId: input.desktopId }); return { record };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "enqueueTransfer": {
      const input = params as StorageDbRequests["enqueueTransfer"];
      return transact([STORES.desktops, STORES.outbox, STORES.clientState], "readwrite", async (tx) => {
        const desktops = tx.objectStore(STORES.desktops); const source = await readDesktop(desktops, input.sourceDesktopId); const destination = await readDesktop(desktops, input.destinationDesktopId);
        const moved = transferEntriesBetweenDesktopStates(source.state, destination.state, input.entryIds, input.parentId); const state = parseDesktopState(moved.source); const destinationState = parseDesktopState(moved.destination);
        await writeDesktopStates(desktops, new Map([[source.id, state], [destination.id, destinationState]]));
        const operation: OutboxOperation = { schemaVersion: 1, kind: "entry-transfer", entryIds: input.entryIds, destinationDesktopId: input.destinationDesktopId, parentId: input.parentId };
        const record = await insertOutbox(tx.objectStore(STORES.outbox), tx.objectStore(STORES.clientState), input.operationId, input.catalogId, input.sourceDesktopId, operation); return { state, record };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "readOutbox": return transact(STORES.outbox, "readonly", (tx) => readOutbox(tx.objectStore(STORES.outbox))) as Promise<StorageDbResponses[M]>;
    case "bindOutboxCatalog": return transact(STORES.outbox, "readwrite", async (tx) => { const store = tx.objectStore(STORES.outbox); for (const record of await readOutbox(store)) if (record.catalogId === null) await request(store.put({ ...record, catalogId: (params as StorageDbRequests["bindOutboxCatalog"]).catalogId })); }) as Promise<StorageDbResponses[M]>;
    case "applyRemoteWithOutbox": {
      if (!desktopId) throw new Error("No desktop is active for this request."); const input = params as StorageDbRequests["applyRemoteWithOutbox"];
      return transact([STORES.desktops, STORES.outbox], "readwrite", async (tx) => {
        const desktops = tx.objectStore(STORES.desktops); const current = await readDesktop(desktops, desktopId); const outbox = tx.objectStore(STORES.outbox); let state = parseDesktopState(input.state); const blocked: OutboxRecord[] = [];
        for (const record of await readOutbox(outbox, desktopId)) {
          if (record.operationId === input.acknowledgedOperationId) { if (input.removeAcknowledged) await request(outbox.delete(record.sequence)); continue; }
          if (record.catalogId !== state.sync.catalogId) { const changed = { ...record, status: "blocked" as const, error: "Pending changes belong to a different catalog.", errorCode: null, conflictDetails: null }; await request(outbox.put(changed)); blocked.push(changed); continue; }
          try { const operation = input.acknowledgedRevision === undefined ? record.operation : rebaseOutboxOperationAfterAcknowledgement(state, record.operation, input.acknowledgedRevision); if (operation !== record.operation) await request(outbox.put({ ...record, operation })); state = parseDesktopState(applyOutboxOperation(state, operation)); }
          catch (error) { const changed = { ...record, status: "blocked" as const, error: error instanceof Error ? error.message : String(error), errorCode: null, conflictDetails: null }; await request(outbox.put(changed)); blocked.push(changed); }
        }
        await writeDesktopStates(desktops, new Map([[current.id, state]])); return { state, blocked };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "acknowledgeMutation": return transact(STORES.outbox, "readwrite", async (tx) => { const index = tx.objectStore(STORES.outbox).index("operationId"); const key = await request(index.getKey((params as StorageDbRequests["acknowledgeMutation"]).operationId)); if (key !== undefined) await request(tx.objectStore(STORES.outbox).delete(key)); }) as Promise<StorageDbResponses[M]>;
    case "blockMutation": {
      const input = params as StorageDbRequests["blockMutation"];
      return transact(STORES.outbox, "readwrite", async (tx) => { const store = tx.objectStore(STORES.outbox); const record = await request(store.index("operationId").get(input.operationId)) as OutboxRecord | undefined; if (record) await request(store.put({ ...parseOutboxRecord(record), status: "blocked", error: input.error, errorCode: input.errorCode, conflictDetails: input.conflictDetails })); }) as Promise<StorageDbResponses[M]>;
    }
    case "rebaseBlockedMutation": {
      const input = params as StorageDbRequests["rebaseBlockedMutation"];
      return transact(STORES.outbox, "readwrite", async (tx) => { const store = tx.objectStore(STORES.outbox); const record = await request(store.index("operationId").get(input.operationId)) as OutboxRecord | undefined; if (!record || record.status !== "blocked") throw new Error("That blocked change no longer exists."); const changed = { ...parseOutboxRecord(record), operation: normalizeOutboxOperation(input.operation), status: "pending" as const, error: null, errorCode: null, conflictDetails: null }; await request(store.put(changed)); return changed; }) as Promise<StorageDbResponses[M]>;
    }
    case "resolveContentConflictKeepBoth": {
      if (!desktopId) throw new Error("No desktop is active for this request."); const input = params as StorageDbRequests["resolveContentConflictKeepBoth"]; const operation = normalizeOutboxOperation(input.operation);
      if (operation.kind !== "create" || operation.entries.length !== 1 || operation.entries[0].kind !== "file") throw new Error("A keep-both resolution requires one file copy.");
      return transact([STORES.desktops, STORES.outbox, STORES.clientState], "readwrite", async (tx) => {
        const outbox = tx.objectStore(STORES.outbox); const selected = await request(outbox.index("operationId").get(input.operationId)) as OutboxRecord | undefined;
        if (!selected || selected.desktopId !== desktopId || selected.status !== "blocked" || selected.operation.kind !== "save-content") throw new Error("That blocked content conflict no longer exists.");
        await request(outbox.delete(selected.sequence)); const record = await insertOutbox(outbox, tx.objectStore(STORES.clientState), input.replacementOperationId, selected.catalogId, desktopId, operation);
        let state = parseDesktopState(input.state); for (const pending of await readOutbox(outbox, desktopId)) state = parseDesktopState(applyOutboxOperation(state, pending.operation));
        const desktops = tx.objectStore(STORES.desktops); await writeDesktopStates(desktops, new Map([[desktopId, state]])); return { state, record };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "recordMutationAttempt": {
      const input = params as StorageDbRequests["recordMutationAttempt"];
      return transact(STORES.outbox, "readwrite", async (tx) => { const store = tx.objectStore(STORES.outbox); const record = await request(store.index("operationId").get(input.operationId)) as OutboxRecord | undefined; if (record) await request(store.put({ ...parseOutboxRecord(record), attemptCount: record.attemptCount + 1, lastAttemptAt: input.attemptedAt })); }) as Promise<StorageDbResponses[M]>;
    }
    case "discardDesktopProjection": {
      const input = params as StorageDbRequests["discardDesktopProjection"];
      return transact([STORES.desktops, STORES.outbox, STORES.sessions], "readwrite", async (tx) => {
        const outbox = tx.objectStore(STORES.outbox); const records = await readOutbox(outbox); const selected = records.find((record) => record.operationId === input.operationId);
        if (!selected || selected.status !== "blocked" || !outboxOperationDesktopIds(selected).has(input.desktopId)) throw new Error("That blocked desktop change no longer exists.");
        const dependent = outboxRecordsDependingOnDesktop(records, input.desktopId); const operationIds = dependent.map((record) => record.operationId); const affectedDesktopIds = [...new Set(dependent.flatMap((record) => [...outboxOperationDesktopIds(record)]))];
        const desktops = tx.objectStore(STORES.desktops); const removed = await readDesktop(desktops, input.desktopId); for (const record of dependent) await request(outbox.delete(record.sequence)); await request(desktops.delete(input.desktopId)); await request(tx.objectStore(STORES.sessions).delete(input.desktopId));
        const retained = new Set((await readDesktops(desktops)).flatMap((record) => record.state.entries.map((entry) => entry.id))); return { operationIds, affectedDesktopIds, fileIds: removed.state.entries.filter((entry) => entry.kind === "file" && !retained.has(entry.id)).map((entry) => entry.id) };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "listActivity": return transact(STORES.activity, "readonly", (tx) => listActivity(tx.objectStore(STORES.activity), params as ActivityQuery)) as Promise<StorageDbResponses[M]>;
    case "pruneDesktops": {
      const retained = new Set((params as StorageDbRequests["pruneDesktops"]).retainedDesktopIds);
      return transact([STORES.desktops, STORES.sessions], "readwrite", async (tx) => { const store = tx.objectStore(STORES.desktops); for (const record of await readDesktops(store)) if (!retained.has(record.id)) { await request(store.delete(record.id)); await request(tx.objectStore(STORES.sessions).delete(record.id)); } }) as Promise<StorageDbResponses[M]>;
    }
    case "listInstalledApps": return transact(STORES.installedApps, "readonly", async (tx) => (await request(tx.objectStore(STORES.installedApps).getAll()) as InstalledApp[]).map(parseInstalledApp).sort((a, b) => a.approvedAt - b.approvedAt || a.appId.localeCompare(b.appId))) as Promise<StorageDbResponses[M]>;
    case "installApp": {
      const install = parseInstalledApp((params as StorageDbRequests["installApp"]).install);
      if (install.source !== "system" && RESERVED_SYSTEM_APP_IDS.has(install.appId)) throw new Error("That app ID is reserved for a trusted system app.");
      return transact(STORES.installedApps, "readwrite", async (tx) => { const store = tx.objectStore(STORES.installedApps); const current = await request(store.get(install.appId)) as InstalledApp | undefined; if (current?.source === "system" && install.source !== "system") throw new Error("Bundled system apps cannot be replaced."); await request(store.put(install)); return install; }) as Promise<StorageDbResponses[M]>;
    }
    case "retireMarkdownPreview": {
      return transact([STORES.installedApps, STORES.appStorage, STORES.fileAssociations], "readwrite", async (tx) => {
        const apps = tx.objectStore(STORES.installedApps);
        const retired = await request(apps.get(RETIRED_SYSTEM_APP_IDS.markdownPreview)) as InstalledApp | undefined;
        if (!retired || retired.source !== "system") return null;
        const replacement = await request(apps.get(SYSTEM_APP_IDS.mediaViewer)) as InstalledApp | undefined;
        if (replacement?.source !== "system") throw new Error("Media Viewer must be installed before retiring Markdown Preview.");
        await request(apps.delete(RETIRED_SYSTEM_APP_IDS.markdownPreview));
        const storage = tx.objectStore(STORES.appStorage);
        for (const record of await request(storage.index("appId").getAll(RETIRED_SYSTEM_APP_IDS.markdownPreview)) as AppStorageRecord[]) await request(storage.delete([record.appId, record.key]));
        const associations = tx.objectStore(STORES.fileAssociations);
        for (const association of await request(associations.index("appId").getAll(RETIRED_SYSTEM_APP_IDS.markdownPreview)) as FileAssociation[]) await request(associations.put({ ...association, appId: SYSTEM_APP_IDS.mediaViewer }));
        return retired.digest;
      }) as Promise<StorageDbResponses[M]>;
    }
    case "retireSceneEditor": {
      return transact([STORES.installedApps, STORES.appStorage, STORES.fileAssociations], "readwrite", async (tx) => {
        const apps = tx.objectStore(STORES.installedApps);
        const retired = await request(apps.get(RETIRED_SYSTEM_APP_IDS.sceneEditor)) as InstalledApp | undefined;
        if (!retired || retired.source !== "system") return null;
        const replacement = await request(apps.get(SYSTEM_APP_IDS.textEditor)) as InstalledApp | undefined;
        if (replacement?.source !== "system") throw new Error("Integrated Editor must be installed before retiring Scene Studio.");
        await request(apps.delete(RETIRED_SYSTEM_APP_IDS.sceneEditor));
        const storage = tx.objectStore(STORES.appStorage);
        for (const record of await request(storage.index("appId").getAll(RETIRED_SYSTEM_APP_IDS.sceneEditor)) as AppStorageRecord[]) await request(storage.delete([record.appId, record.key]));
        const associations = tx.objectStore(STORES.fileAssociations);
        for (const association of await request(associations.index("appId").getAll(RETIRED_SYSTEM_APP_IDS.sceneEditor)) as FileAssociation[]) await request(associations.put({ ...association, appId: SYSTEM_APP_IDS.textEditor }));
        return retired.digest;
      }) as Promise<StorageDbResponses[M]>;
    }
    case "uninstallApp": {
      const appId = (params as StorageDbRequests["uninstallApp"]).appId;
      return transact([STORES.installedApps, STORES.appStorage, STORES.fileAssociations], "readwrite", async (tx) => { const apps = tx.objectStore(STORES.installedApps); const current = await request(apps.get(appId)) as InstalledApp | undefined; if (current && current.source !== "system") { await request(apps.delete(appId)); await deleteAppData(tx, appId); } }) as Promise<StorageDbResponses[M]>;
    }
    case "listQuarantinedApps": return transact(STORES.quarantinedApps, "readonly", async (tx) => (await request(tx.objectStore(STORES.quarantinedApps).getAll()) as QuarantinedApp[]).map(parseQuarantinedApp).sort((a, b) => a.approvedAt - b.approvedAt || a.appId.localeCompare(b.appId))) as Promise<StorageDbResponses[M]>;
    case "removeQuarantinedApp": return transact(STORES.quarantinedApps, "readwrite", async (tx) => { await request(tx.objectStore(STORES.quarantinedApps).delete((params as StorageDbRequests["removeQuarantinedApp"]).appId)); }) as Promise<StorageDbResponses[M]>;
    case "listFileAssociations": return transact(STORES.fileAssociations, "readonly", async (tx) => (await request(tx.objectStore(STORES.fileAssociations).getAll()) as FileAssociation[]).map(parseFileAssociation).sort((a, b) => a.matcher.localeCompare(b.matcher))) as Promise<StorageDbResponses[M]>;
    case "setFileAssociation": {
      const association = parseFileAssociation((params as StorageDbRequests["setFileAssociation"]).association);
      return transact([STORES.installedApps, STORES.fileAssociations], "readwrite", async (tx) => { if (!await request(tx.objectStore(STORES.installedApps).get(association.appId))) throw new Error("That app is not installed."); await request(tx.objectStore(STORES.fileAssociations).put(association)); return association; }) as Promise<StorageDbResponses[M]>;
    }
    case "removeFileAssociation": return transact(STORES.fileAssociations, "readwrite", async (tx) => { await request(tx.objectStore(STORES.fileAssociations).delete(normalizeAssociationMatcher((params as StorageDbRequests["removeFileAssociation"]).matcher))); }) as Promise<StorageDbResponses[M]>;
    case "resetFileAssociations": return transact(STORES.fileAssociations, "readwrite", async (tx) => { await request(tx.objectStore(STORES.fileAssociations).clear()); }) as Promise<StorageDbResponses[M]>;
    case "readAppStorage": {
      const input = params as StorageDbRequests["readAppStorage"];
      return transact(STORES.appStorage, "readonly", async (tx) => { const record = await request(tx.objectStore(STORES.appStorage).get([input.appId, input.key])) as AppStorageRecord | undefined; return record ? parseJsonValue(record.value) : undefined; }) as Promise<StorageDbResponses[M]>;
    }
    case "writeAppStorage": {
      const input = params as StorageDbRequests["writeAppStorage"]; const value = parseJsonValue(input.value); const bytes = new TextEncoder().encode(JSON.stringify(input.key)).byteLength + new TextEncoder().encode(JSON.stringify(value)).byteLength;
      return transact([STORES.installedApps, STORES.appStorage], "readwrite", async (tx) => { if (!await request(tx.objectStore(STORES.installedApps).get(input.appId))) throw new Error("That app is not installed."); const store = tx.objectStore(STORES.appStorage); const records = await request(store.index("appId").getAll(input.appId)) as AppStorageRecord[]; const existing = records.find((record) => record.key === input.key); if (!existing && records.length >= input.maxEntries) throw new Error("App storage entry quota exceeded."); if (records.reduce((sum, record) => sum + record.bytes, 0) - (existing?.bytes ?? 0) + bytes > input.maxBytes) throw new Error("App storage quota exceeded."); await request(store.put({ appId: input.appId, key: input.key, value, bytes } satisfies AppStorageRecord)); }) as Promise<StorageDbResponses[M]>;
    }
    case "removeAppStorage": { const input = params as StorageDbRequests["removeAppStorage"]; return transact(STORES.appStorage, "readwrite", async (tx) => { await request(tx.objectStore(STORES.appStorage).delete([input.appId, input.key])); }) as Promise<StorageDbResponses[M]>; }
    case "clearAppStorage": {
      const appId = (params as StorageDbRequests["clearAppStorage"]).appId;
      return transact(STORES.appStorage, "readwrite", async (tx) => { const store = tx.objectStore(STORES.appStorage); for (const record of await request(store.index("appId").getAll(appId)) as AppStorageRecord[]) await request(store.delete([record.appId, record.key])); }) as Promise<StorageDbResponses[M]>;
    }
    case "readAccountApps": return transact([STORES.accountApps, STORES.accountAppOutbox], "readonly", async (tx) => {
      const outbox = await readAccountAppOutbox(tx.objectStore(STORES.accountAppOutbox));
      return { state: await accountAppState(tx.objectStore(STORES.accountApps), outbox), outbox };
    }) as Promise<StorageDbResponses[M]>;
    case "enqueueAccountAppOperation": {
      const input = params as StorageDbRequests["enqueueAccountAppOperation"];
      return transact([...ACCOUNT_APP_ATOMIC_STORES], "readwrite", async (tx) => {
        let operation = parseAccountAppOperation(input.operation);
        const outboxStore = tx.objectStore(STORES.accountAppOutbox);
        const outbox = await readAccountAppOutbox(outboxStore);
        const current = await accountAppState(tx.objectStore(STORES.accountApps), outbox);
        if (operation.kind !== "install" && operation.kind !== "handlers") {
          const operationAppId = operation.appId;
          const app = current.projection.apps.find((candidate) => candidate.appId === operationAppId);
          if (!app) throw new Error("That app is not installed for this account.");
          if (operation.kind === "uninstall") {
            if (app.installationGeneration === null) throw new Error("Wait for this app to finish installing before uninstalling it.");
            operation = { ...operation, installationGeneration: app.installationGeneration };
          } else operation = { ...operation, dataGeneration: app.dataGeneration };
        }
        const reserved = await reserveAccountAppOperation(tx.objectStore(STORES.accountAppClientState));
        const record = parseAccountAppOutboxRecord({ ...reserved, operation, status: "pending", error: null, errorCode: null, attemptCount: 0, lastAttemptAt: null });
        if (input.localData) await writeLocalAccountAppData(tx, input.localData);
        await request(outboxStore.add(record));
        const state = { id: "singleton" as const, baseline: current.baseline, projection: projectAccountApps(current.baseline, [...outbox, record]) };
        await request(tx.objectStore(STORES.accountApps).put(state));
        return { state, record };
      }) as Promise<StorageDbResponses[M]>;
    }
    case "reconcileAccountApps": {
      const input = params as StorageDbRequests["reconcileAccountApps"];
      return transact([STORES.accountApps, STORES.accountAppOutbox], "readwrite", async (tx) => {
        const snapshot = parseAccountAppsSnapshot(input.snapshot);
        const outboxStore = tx.objectStore(STORES.accountAppOutbox);
        if (input.acknowledgedOperationId) {
          const selected = await request(outboxStore.index("operationId").get(input.acknowledgedOperationId)) as AccountAppOutboxRecord | undefined;
          if (selected) await request(outboxStore.delete(selected.sequence));
        }
        const outbox = await readAccountAppOutbox(outboxStore);
        const state = { id: "singleton" as const, baseline: snapshot, projection: projectAccountApps(snapshot, outbox) };
        await request(tx.objectStore(STORES.accountApps).put(state));
        return state;
      }) as Promise<StorageDbResponses[M]>;
    }
    case "blockAccountAppOperation": {
      const input = params as StorageDbRequests["blockAccountAppOperation"];
      return transact([STORES.accountApps, STORES.accountAppOutbox], "readwrite", async (tx) => {
        const store = tx.objectStore(STORES.accountAppOutbox);
        const record = await request(store.index("operationId").get(input.operationId)) as AccountAppOutboxRecord | undefined;
        if (!record) return;
        await request(store.put({ ...parseAccountAppOutboxRecord(record), status: "blocked", error: input.error, errorCode: input.errorCode }));
        const outbox = await readAccountAppOutbox(store);
        const current = await accountAppState(tx.objectStore(STORES.accountApps), outbox.map((candidate) => candidate.operationId === input.operationId ? { ...candidate, status: "pending" as const } : candidate));
        await request(tx.objectStore(STORES.accountApps).put({ id: "singleton", baseline: current.baseline, projection: projectAccountApps(current.baseline, outbox) }));
      }) as Promise<StorageDbResponses[M]>;
    }
    case "retryAccountAppOperation": {
      const input = params as StorageDbRequests["retryAccountAppOperation"];
      return transact([STORES.accountApps, STORES.accountAppOutbox], "readwrite", async (tx) => {
        const outboxStore = tx.objectStore(STORES.accountAppOutbox);
        const selected = await request(outboxStore.index("operationId").get(input.operationId)) as AccountAppOutboxRecord | undefined;
        if (!selected || selected.status !== "blocked") throw new Error("That blocked account app change no longer exists.");
        const accountStore = tx.objectStore(STORES.accountApps);
        const stored = await accountAppState(accountStore, await readAccountAppOutbox(outboxStore));
        if (!stored.baseline) throw new Error("Refresh account apps before retrying this change.");
        const changed = parseAccountAppOutboxRecord({ ...selected, operation: rebaseAccountAppOperation(selected.operation, stored.baseline), status: "pending", error: null, errorCode: null });
        await request(outboxStore.put(changed));
        const outbox = await readAccountAppOutbox(outboxStore);
        await request(accountStore.put({ id: "singleton", baseline: stored.baseline, projection: projectAccountApps(stored.baseline, outbox) }));
        return changed;
      }) as Promise<StorageDbResponses[M]>;
    }
    case "discardAccountAppOperation": {
      const input = params as StorageDbRequests["discardAccountAppOperation"];
      return transact([STORES.accountApps, STORES.accountAppOutbox, STORES.appStorage], "readwrite", async (tx) => {
        const outboxStore = tx.objectStore(STORES.accountAppOutbox);
        const selected = await request(outboxStore.index("operationId").get(input.operationId)) as AccountAppOutboxRecord | undefined;
        if (!selected || selected.status !== "blocked") throw new Error("That blocked account app change no longer exists.");
        await restoreLocalAccountAppData(tx, selected.operation, input.restoration);
        await request(outboxStore.delete(selected.sequence));
        const accountStore = tx.objectStore(STORES.accountApps);
        const outbox = await readAccountAppOutbox(outboxStore);
        const stored = await accountAppState(accountStore, [...outbox, selected]);
        await request(accountStore.put({ id: "singleton", baseline: stored.baseline, projection: projectAccountApps(stored.baseline, outbox) }));
      }) as Promise<StorageDbResponses[M]>;
    }
    case "recordAccountAppAttempt": {
      const input = params as StorageDbRequests["recordAccountAppAttempt"];
      return transact(STORES.accountAppOutbox, "readwrite", async (tx) => {
        const store = tx.objectStore(STORES.accountAppOutbox);
        const record = await request(store.index("operationId").get(input.operationId)) as AccountAppOutboxRecord | undefined;
        if (record) await request(store.put({ ...parseAccountAppOutboxRecord(record), attemptCount: record.attemptCount + 1, lastAttemptAt: input.attemptedAt }));
      }) as Promise<StorageDbResponses[M]>;
    }
  }
}

export async function callDatabase<M extends StorageDbMethod>(method: M, params: StorageDbRequests[M], desktopId: string | null = getActiveDesktopContext()): Promise<StorageDbResponses[M]> {
  await getRoot();
  return dispatch(method, params, desktopId);
}

export async function initializeDatabase() {
  await getRoot();
  await openDatabase();
}

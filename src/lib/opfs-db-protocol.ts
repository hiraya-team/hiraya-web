import type { PersistedDesktopState } from "../domain/desktop-state";
import type { OutboxOperation, OutboxRecord, RevisionConflictDetails } from "./outbox";
import type { WindowSession } from "./window-session";
import type { ActivityPage, ActivityQuery, NewActivityRecord } from "./activity";
import type { DesktopIdentity } from "../types";
import type { FileAssociation, InstalledApp, QuarantinedApp } from "../apps/installed-apps";
import type { JsonValue } from "@hiraya/apps-contracts";
import { STORAGE_PROTOCOL_VERSION } from "./storage-worker";
import type { LocalPreferences } from "../domain/preferences";

export type StoredPreferences = LocalPreferences;

export type StorageDbRequests = {
  ping: undefined;
  protocol: undefined;
  status: undefined;
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
  writePreferences: { preferences: StoredPreferences };
  readWindowSession: { desktopId: string };
  writeWindowSession: { desktopId: string; session: WindowSession };
  reserveOperation: undefined;
  enqueueMutation: { operationId: string; catalogId: string | null; operation: OutboxOperation };
  enqueueDesktopCreate: { operationId: string; catalogId: string | null; desktop: DesktopIdentity; state: PersistedDesktopState };
  enqueueDesktopRename: { operationId: string; catalogId: string | null; desktop: DesktopIdentity; baseRevision: number };
  enqueueDesktopDelete: { operationId: string; catalogId: string | null; ownerDesktopId: string; desktopId: string; baseRevision: number };
  readOutbox: undefined;
  bindOutboxCatalog: { catalogId: string };
  applyRemoteWithOutbox: { state: PersistedDesktopState; acknowledgedOperationId?: string; acknowledgedRevision?: number };
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
};

export type StorageDbResponses = {
  ping: undefined;
  protocol: { version: number };
  status: { existedBeforeOpen: boolean };
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
  readPreferences: StoredPreferences;
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
};

export type StorageDbMethod = keyof StorageDbRequests;

export type StorageDbRequest<M extends StorageDbMethod = StorageDbMethod> = {
  id: number;
  desktopId: string | null;
  method: M;
  params: StorageDbRequests[M];
};

export type StorageDbResponse = {
  id: number;
  result?: unknown;
  error?: string;
};

export function createStorageDbRequest<M extends StorageDbMethod>(id: number, desktopId: string | null, method: M, params: StorageDbRequests[M]): StorageDbRequest<M> {
  return { id, desktopId, method, params };
}

export function parseStorageProtocol(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !("version" in value) || value.version !== STORAGE_PROTOCOL_VERSION) throw new Error("The local storage worker protocol is outdated. Reload Hiraya and close any older Hiraya tabs.");
  return STORAGE_PROTOCOL_VERSION;
}

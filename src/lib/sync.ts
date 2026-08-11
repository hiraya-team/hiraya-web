import type { SeededManifest } from "./seeded-manifest";
import { assertUniqueName, namesMatch, validateEntryName } from "./entry-validation";
import { API_ROUTES, authenticatedHeaders } from "./api-routes";
import { assertValidId, isRecord, parseContentAccessDescriptor, parseEntries, parseLayout, parsePosition, parseRemoteDesktopState, parseRootEntryPositionUpdates, parseSystemEntriesDocument, parseSystemEntryDocument, parseTrashDeleteResult, parseTrashDocument, parseTrashRestoreResult, systemEntryPath, type ContentAccessExpectations, type RemoteDesktopState, type RemoteEntry, type SystemEntriesDocument, type SystemEntry, type SystemRole, type TrashDeleteResult, type TrashDocument, type TrashEntry, type TrashRestoreResult } from "./contracts";
import type { DesktopEntry, DesktopIdentity, DesktopLayout, RootEntryPositionUpdate, EditorSettings, EntryPosition, FileEntry, FolderEntry } from "../types";
import { DEFAULT_WALLPAPER } from "../types";
import type { OutboxOperation, OutboxRecord } from "./outbox";
import { ACCESS_REVOKED_ERROR, desktopPendingOperationProtection, forceRebaseOutboxOperation, isAccessRevocationRecord, isRevisionConflictRecord, mergeDesktopLayout, outboxCausalKeys, outboxDesktopRetentionIds, outboxOperationDesktopIds, resolveOutboxRevisionConflict, type EntryConflictBase, type RevisionConflictDetails } from "./outbox";
import { parseCustomTheme, parseThemeState } from "./themes";
import type { CustomTheme } from "../domain/theme";
import type { ClipboardEntrySnapshot } from "./clipboard";
import { parseActivityPage, parseActivityQuery, type ActivityQuery } from "./activity";
import { parseDesktopCatalog, type CatalogQuota } from "./desktop-catalog";
import type { DesktopPreference } from "./desktop-preferences";
import { AuthenticationRequiredError, redirectToLogin } from "./auth";
import { mapWithConcurrency, responseBlobWithProgress, sha256Blob } from "./blob-transfer";
import { buildOfflineAvailability, dedupeOfflineRoots, offlineFilesUnderRoots, type OfflineStorageInventory } from "./offline-availability";
import type { DesktopStateSnapshot } from "../domain/desktop-state";
import { ContentRevisionConflictError, type SaveFileOptions } from "../domain/files";
import { browserSyncStorage, type SyncStorage } from "../platform/sync/storage-port";
import { SyncHttpClient, SyncRequestError } from "../platform/sync/http-client";
import { SyncConnectivity } from "../platform/sync/connectivity";
import { sendOutboxOperation, type BlobUploadPhase } from "../platform/sync/outbox-transport";
import { AuthorityValidationError, parseAuthorityIdentity, UpgradeRequiredError } from "./wire-authority";
import type { FilePreviewSource } from "@hiraya-team/apps-contracts";
import { loadThumbnail, supportsThumbnailMime, THUMBNAIL_MAX_SOURCE_SIZE, THUMBNAIL_PROFILE } from "./thumbnails";
import { remoteDesktopSnapshot } from "./desktop-state";

type OutboxOperationInput = OutboxOperation extends infer Operation
  ? Operation extends OutboxOperation ? Omit<Operation, "schemaVersion"> : never
  : never;

export type SyncStatus = "connecting" | "online" | "offline" | "blocked" | "upgrade-required" | "error" | "local";
export type FileTransferState = {
  id: string;
  entryId: string;
  fileName: string;
  direction: "upload" | "download";
  phase: BlobUploadPhase | "downloading" | "complete" | "failed";
  transferredBytes: number;
  totalBytes: number;
  error: string | null;
};
export type DesktopRegistry = { schemaVersion: 2; catalogId: string | null; catalogRevision: number; desktops: DesktopIdentity[]; activeDesktopId: string | null; quota: CatalogQuota | null };
export type ContentConflictBundle = {
  operationId: string;
  desktopId: string;
  entryId: string;
  expectedRevision: number;
  serverRevision: number;
  mine: Blob;
  base: Blob | null;
  server: Blob;
  mineMetadata: Pick<FileEntry, "name" | "mimeType" | "size" | "modifiedAt">;
  serverMetadata: Pick<FileEntry, "name" | "mimeType" | "size" | "modifiedAt">;
};
const HEALTH_TIMEOUT_MS = 10_000;

export async function fetchServerBuildTimestamp(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
  const controller = new AbortController();
  const deadline = globalThis.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(API_ROUTES.health, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("The Hiraya server is unavailable.");
    const health = await response.json() as unknown;
    if (typeof health !== "object" || health === null || !("buildTimestamp" in health) || typeof health.buildTimestamp !== "string") return null;
    return health.buildTimestamp || null;
  } finally {
    globalThis.clearTimeout(deadline);
  }
}

export type OfflineOperationProgress = {
  desktopId: string;
  generation: number;
  operationId: string;
  phase: "downloading" | "complete" | "error";
  completed: number;
  total: number;
  failed: number;
  bytesCompleted: number;
  totalBytes: number;
  updatingIds: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
};

export type SyncEngineOptions = {
  frontendOnly?: boolean;
  fetch?: typeof fetch;
  eventSource?: typeof EventSource;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  storage?: SyncStorage;
  onUnauthorized?: () => void;
  expectedCatalogId?: string | null;
  directBlobOrigin?: string;
  thumbnails?: boolean;
  createXMLHttpRequest?: () => XMLHttpRequest;
};

const REPLAY_RETRY_MIN_MS = 1_000;
const REPLAY_RETRY_MAX_MS = 30_000;

export class VirtualFileUnavailableError extends Error {
  constructor(message = "This file is not available offline yet. Reconnect and try again.") {
    super(message);
    this.name = "VirtualFileUnavailableError";
  }
}

export class VirtualFileChangedError extends Error {
  constructor() {
    super("This file changed while it was loading. Try opening it again.");
    this.name = "VirtualFileChangedError";
  }
}

export class TrashUnavailableError extends Error {
  constructor(message = "Trash is only available when connected to a Hiraya server.") {
    super(message);
    this.name = "TrashUnavailableError";
  }
}

const toSnapshot = remoteDesktopSnapshot;

function localSystemContent(snapshot: DesktopStateSnapshot, role: SystemRole, key?: string) {
  if (role === "layout") return snapshot.layout;
  if (role === "editor-settings") return snapshot.editorSettings;
  if (role === "theme-selection") return { themeId: snapshot.appearance.selectedThemeId };
  if (role === "theme-definition") {
    const theme = snapshot.appearance.customThemes.find((candidate) => candidate.id === key);
    if (theme) return { id: theme.id, name: theme.name, definition: theme.definition };
  }
  throw new Error("That protected system resource is unavailable in this browser.");
}

async function localSystemEntries(snapshot: DesktopStateSnapshot, desktopId: string): Promise<SystemEntriesDocument> {
  const resources: Array<{ role: SystemRole; key?: string; revision: number }> = [
    { role: "layout", revision: snapshot.sync.layoutRevision },
    { role: "editor-settings", revision: snapshot.sync.settingsRevision },
    { role: "theme-selection", revision: snapshot.sync.themeSelectionRevision },
    ...snapshot.appearance.customThemes.map((theme) => ({ role: "theme-definition" as const, key: theme.id, revision: snapshot.sync.themeRevisions[theme.id] ?? 0 })),
  ];
  const entries = await Promise.all(resources.map(async ({ role, key, revision }): Promise<SystemEntry> => {
    const content = new Blob([JSON.stringify(localSystemContent(snapshot, role, key))], { type: "application/json" });
    return {
      kind: "file",
      id: `${desktopId}:system:${role}${key ? `:${key}` : ""}`,
      name: role === "theme-definition" ? `${key}.theme.json` : `${role}.json`,
      systemRole: role,
      ...(key ? { systemKey: key } : {}),
      path: systemEntryPath(role, key),
      mimeType: "application/json",
      size: content.size,
      revision,
      contentRevision: revision,
      sha256: await sha256Blob(content),
    };
  }));
  return { schemaVersion: 2, catalogId: snapshot.sync.catalogId ?? desktopId, catalogRevision: Math.max(0, ...resources.map(({ revision }) => revision)), desktopId, entries };
}

function conflictBase(entry: DesktopEntry): EntryConflictBase {
  return { name: entry.name, parentId: entry.parentId, position: entry.position };
}

function currentConflict(conflict: RevisionConflictDetails, remote: DesktopStateSnapshot): RevisionConflictDetails {
  let actualRevision = conflict.actualRevision;
  if (conflict.resourceKind === "entry") actualRevision = remote.sync.entryRevisions[conflict.resourceId] ?? actualRevision;
  else if (conflict.resourceKind === "content") actualRevision = remote.sync.contentRevisions[conflict.resourceId] ?? actualRevision;
  else if (conflict.resourceKind === "layout") actualRevision = remote.sync.layoutRevision;
  else if (conflict.resourceKind === "editor-settings") actualRevision = remote.sync.settingsRevision;
  else if (conflict.resourceKind === "theme-selection") actualRevision = remote.sync.themeSelectionRevision;
  else if (conflict.resourceKind === "theme") actualRevision = remote.sync.themeRevisions[conflict.resourceId] ?? 0;
  return { ...conflict, actualRevision: Math.max(actualRevision, conflict.actualRevision) };
}

export class SyncEngine {
  private readonly frontendOnly: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly storage: SyncStorage;
  private readonly onUnauthorized: () => void;
  private expectedCatalogId: string | null;
  private directBlobOrigin?: string;
  private thumbnails: boolean;
  private readonly http: SyncHttpClient;
  private readonly connectivity: SyncConnectivity;
  private readonly setTimeoutImpl: typeof globalThis.setTimeout;
  private readonly clearTimeoutImpl: typeof globalThis.clearTimeout;
  private readonly createXMLHttpRequest?: () => XMLHttpRequest;
  private readonly directMutationClientId = crypto.randomUUID();
  private desktop: DesktopStateSnapshot | null = null;
  private status: SyncStatus = "connecting";
  private work: Promise<unknown> = Promise.resolve();
  private syncWork: Promise<unknown> = Promise.resolve();
  private startPromise: Promise<{ desktop: DesktopStateSnapshot; status: SyncStatus }> | null = null;
  private running = false;
  private authenticationPaused = false;
  private generation = 0;
  private healthAbort: AbortController | null = null;
  private syncAbort: AbortController | null = null;
  private desktopId = "";
  private catalogId: string | null = null;
  private catalogRevision = 0;
  private lastQuota: { catalogId: string; quota: CatalogQuota } | null = null;
  private pendingWork = 0;
  private replayRequested = false;
  private replayRunning = false;
  private replayRetryMs = REPLAY_RETRY_MIN_MS;
  private replayRetryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private readonly desktopListeners = new Set<(next: DesktopStateSnapshot) => void>();
  private readonly statusListeners = new Set<(next: SyncStatus) => void>();
  private readonly syncWorkListeners = new Set<(syncing: boolean) => void>();
  private readonly activityChangeListeners = new Set<() => void>();
  private readonly outboxListeners = new Set<(records: readonly OutboxRecord[]) => void>();
  private readonly catalogListeners = new Set<(catalog: DesktopRegistry) => void>();
  private readonly contentLoads = new Map<string, Promise<File>>();
  private readonly offlineInventoryListeners = new Set<(inventory: OfflineStorageInventory) => void>();
  private readonly offlineProgressListeners = new Set<(progress: OfflineOperationProgress | null) => void>();
  private readonly entryDownloadListeners = new Set<(entryIds: ReadonlySet<string>) => void>();
  private readonly transferListeners = new Set<(transfers: readonly FileTransferState[]) => void>();
  private readonly transfers = new Map<string, FileTransferState>();
  private transferSnapshot: readonly FileTransferState[] = [];
  private readonly activeEntryDownloadIds = new Set<string>();
  private offlineInventoryLoad: { desktopId: string; generation: number; promise: Promise<OfflineStorageInventory> } | null = null;
  private offlineDownload: { desktopId: string; generation: number; promise: Promise<OfflineStorageInventory> } | null = null;

  constructor(options: SyncEngineOptions = {}) {
    this.frontendOnly = options.frontendOnly ?? false;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.storage = options.storage ?? browserSyncStorage;
    this.onUnauthorized = options.onUnauthorized ?? redirectToLogin;
    this.expectedCatalogId = options.expectedCatalogId ?? null;
    this.directBlobOrigin = options.directBlobOrigin;
    this.thumbnails = options.thumbnails ?? false;
    this.setTimeoutImpl = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutImpl = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    this.createXMLHttpRequest = options.createXMLHttpRequest;
    this.http = new SyncHttpClient({
      fetch: this.fetchImpl,
      onUnauthorized: this.onUnauthorized,
      onAuthenticationRequired: () => this.pauseForAuthentication(),
      authenticationPaused: () => this.authenticationPaused,
      onUnavailable: () => this.setStatus("offline"),
    });
    this.connectivity = new SyncConnectivity(
      "eventSource" in options ? options.eventSource : globalThis.EventSource,
      this.setTimeoutImpl,
      this.clearTimeoutImpl,
      API_ROUTES.events,
    );
  }

  start(desktopId: string, viewport: EntryPosition, seeded: SeededManifest | null = null, options: { backgroundServer?: boolean } = {}) {
    if (this.startPromise) return this.startPromise;
    this.running = true;
    this.authenticationPaused = false;
    this.replayRetryMs = REPLAY_RETRY_MIN_MS;
    this.syncAbort = new AbortController();
    const generation = ++this.generation;
    this.desktopId = desktopId;
    this.startPromise = this.startInternal(viewport, seeded, generation, options.backgroundServer === true).catch((error) => {
      if (this.generation === generation) this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  private async startInternal(viewport: EntryPosition, seeded: SeededManifest | null, generation: number, backgroundServer: boolean) {
    this.desktop = await this.storage.loadDesktop(viewport, seeded);
    if (!this.running || this.generation !== generation) throw new DOMException("Desktop synchronization was stopped.", "AbortError");
    this.publish(this.desktop);
    if (this.frontendOnly) {
      this.setStatus("local");
      return { desktop: this.desktop, status: this.status };
    }
    this.setStatus("connecting");
    if (backgroundServer) {
      this.startEvents();
      void this.queueSync(async () => {
        try {
          await this.ensureServer(generation);
          this.assertActive(generation);
          this.setStatus("online");
          this.requestReplay();
        } catch (error) {
          if (!this.running || this.generation !== generation) return;
          if (error instanceof AuthenticationRequiredError) this.setStatus("connecting");
          else if (error instanceof UpgradeRequiredError || error instanceof AuthorityValidationError) this.failAuthority(error);
          else this.setStatus("offline");
        }
      });
      return { desktop: this.current(), status: this.status };
    }
    try {
      await this.ensureServer(generation);
      this.setStatus("online");
      await this.replayOutbox(generation).catch((error) => {
        if (error instanceof SyncRequestError && error.permanent) this.setStatus("blocked");
        else throw error;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (error instanceof AuthenticationRequiredError) this.setStatus("connecting");
      else if (error instanceof UpgradeRequiredError || error instanceof AuthorityValidationError) this.failAuthority(error);
      else this.setStatus("offline");
    }
    if (this.running && !this.authenticationPaused && this.generation === generation) this.startEvents();
    return { desktop: this.current(), status: this.status };
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    this.startPromise = null;
    this.syncAbort?.abort();
    this.syncAbort = null;
    this.connectivity.stop();
    this.healthAbort?.abort();
    this.healthAbort = null;
    if (this.replayRetryTimer !== null) this.clearTimeoutImpl(this.replayRetryTimer);
    this.replayRetryTimer = null;
    this.replayRequested = false;
    this.replayRunning = false;
    this.syncWork = Promise.resolve();
    if (this.pendingWork > 0) for (const listener of this.syncWorkListeners) listener(false);
    this.pendingWork = 0;
    this.contentLoads.clear();
    this.activeEntryDownloadIds.clear();
    this.publishEntryDownloads();
    this.offlineInventoryLoad = null;
    this.offlineDownload = null;
    await this.work;
    this.transfers.clear();
    this.publishTransfers();
  }

  subscribe(onDesktop: (next: DesktopStateSnapshot) => void, onStatus: (next: SyncStatus) => void, onSyncWork?: (syncing: boolean) => void) {
    this.desktopListeners.add(onDesktop);
    this.statusListeners.add(onStatus);
    if (onSyncWork) this.syncWorkListeners.add(onSyncWork);
    onStatus(this.status);
    onSyncWork?.(!this.frontendOnly && this.pendingWork > 0);
    return () => {
      this.desktopListeners.delete(onDesktop);
      this.statusListeners.delete(onStatus);
      if (onSyncWork) this.syncWorkListeners.delete(onSyncWork);
    };
  }

  subscribeActivityChanges(listener: () => void) {
    this.activityChangeListeners.add(listener);
    return () => {
      this.activityChangeListeners.delete(listener);
    };
  }

  subscribeOutbox(listener: (records: readonly OutboxRecord[]) => void) {
    this.outboxListeners.add(listener);
    void this.storage.readOutbox().then((records) => {
      if (this.outboxListeners.has(listener)) this.notifyOutboxListener(listener, records);
    });
    return () => { this.outboxListeners.delete(listener); };
  }

  private notifyOutboxListener(listener: (records: readonly OutboxRecord[]) => void, records: readonly OutboxRecord[]) {
    try {
      listener(records);
    } catch (error) {
      console.error("A synchronization queue listener failed.", error);
    }
  }

  private async publishOutbox() {
    if (this.outboxListeners.size === 0) return;
    const records = await this.storage.readOutbox();
    for (const listener of this.outboxListeners) this.notifyOutboxListener(listener, records);
  }

  subscribeDesktopCatalog(listener: (catalog: DesktopRegistry) => void) {
    this.catalogListeners.add(listener);
    return () => { this.catalogListeners.delete(listener); };
  }

  subscribeOfflineStorage(onInventory: (inventory: OfflineStorageInventory) => void, onProgress?: (progress: OfflineOperationProgress | null) => void) {
    this.offlineInventoryListeners.add(onInventory);
    if (onProgress) this.offlineProgressListeners.add(onProgress);
    return () => { this.offlineInventoryListeners.delete(onInventory); if (onProgress) this.offlineProgressListeners.delete(onProgress); };
  }

  subscribeEntryDownloads(listener: (entryIds: ReadonlySet<string>) => void) {
    this.entryDownloadListeners.add(listener);
    listener(new Set(this.activeEntryDownloadIds));
    return () => this.entryDownloadListeners.delete(listener);
  }

  getTransferSnapshot() {
    return this.transferSnapshot;
  }

  subscribeTransfers(listener: (transfers: readonly FileTransferState[]) => void) {
    this.transferListeners.add(listener);
    listener(this.transferSnapshot);
    return () => this.transferListeners.delete(listener);
  }

  dismissTransfer(id: string) {
    if (!this.transfers.delete(id)) return;
    this.publishTransfers();
  }

  dismissCompletedTransfer(id: string) {
    if (this.transfers.get(id)?.phase !== "complete") return;
    this.dismissTransfer(id);
  }

  private publishTransfers() {
    this.transferSnapshot = [...this.transfers.values()];
    for (const listener of this.transferListeners) listener(this.transferSnapshot);
  }

  private updateTransfer(transfer: FileTransferState) {
    this.transfers.set(transfer.id, transfer);
    this.publishTransfers();
  }

  private updateDownloadTransfer(generation: number, desktopId: string, transfer: FileTransferState) {
    if (!this.sessionIsActive(generation, desktopId)) return;
    this.updateTransfer(transfer);
  }

  private uploadFiles(record: OutboxRecord): Array<{ id: string; name: string; size: number }> {
    if (record.operation.kind === "create") return record.operation.entries.filter((entry): entry is FileEntry => entry.kind === "file");
    if (record.operation.kind === "install-theme-package") return [{ id: record.operation.assetId, name: `${record.operation.theme.name}.hiraya.app`, size: record.operation.size }];
    if (record.operation.kind !== "save-content") return [];
    const entryId = record.operation.entryId;
    const entry = this.current().entries.find((candidate): candidate is FileEntry => candidate.kind === "file" && candidate.id === entryId);
    return [{ id: entryId, name: entry?.name ?? entryId, size: record.operation.size }];
  }

  private uploadTransferId(operationId: string, entryId: string) {
    return `upload:${operationId}:${entryId}`;
  }

  private updateUploadTransfer(record: OutboxRecord, generation: number, entryId: string, phase: BlobUploadPhase, transferredBytes: number, totalBytes: number) {
    if (!this.running || this.generation !== generation) return;
    const file = this.uploadFiles(record).find((entry) => entry.id === entryId);
    if (!file) return;
    this.updateTransfer({ id: this.uploadTransferId(record.operationId, entryId), entryId, fileName: file.name, direction: "upload", phase, transferredBytes, totalBytes, error: null });
  }

  private finishUploadTransfers(record: OutboxRecord, generation: number, error?: unknown) {
    if (!this.running || this.generation !== generation) return;
    const prefix = `upload:${record.operationId}:`;
    for (const [id, current] of this.transfers) {
      if (!id.startsWith(prefix)) continue;
      if (!current) continue;
      if (error !== undefined && current.phase === "complete") continue;
      this.updateTransfer({ ...current, phase: error === undefined ? "complete" : "failed", transferredBytes: error === undefined ? current.totalBytes : current.transferredBytes, error: error === undefined ? null : error instanceof Error ? error.message : "The file upload failed." });
    }
  }

  private publishEntryDownloads() {
    const entryIds = new Set(this.activeEntryDownloadIds);
    for (const listener of this.entryDownloadListeners) listener(entryIds);
  }

  private publishOfflineProgress(progress: OfflineOperationProgress | null) {
    for (const listener of this.offlineProgressListeners) listener(progress);
  }

  async loadOfflineInventory() {
    const desktopId = this.desktopId;
    const generation = this.generation;
    const existing = this.offlineInventoryLoad;
    if (existing?.desktopId === desktopId && existing.generation === generation) return existing.promise;
    const promise = this.storage.loadOfflineInventory(desktopId).then((inventory) => {
      if (this.desktopId === desktopId && this.generation === generation) for (const listener of this.offlineInventoryListeners) listener(inventory);
      return inventory;
    }).finally(() => { if (this.offlineInventoryLoad?.promise === promise) this.offlineInventoryLoad = null; });
    this.offlineInventoryLoad = { desktopId, generation, promise };
    return promise;
  }

  private async refreshOfflineInventory() {
    const existing = this.offlineInventoryLoad;
    if (existing?.desktopId === this.desktopId && existing.generation === this.generation) await existing.promise.catch(() => undefined);
    return this.loadOfflineInventory();
  }

  private publishCatalog(catalog: DesktopRegistry) {
    for (const listener of this.catalogListeners) listener(catalog);
    return catalog;
  }

  private publishActivityChange() {
    for (const listener of this.activityChangeListeners) listener();
  }

  private setStatus(next: SyncStatus) {
    if (this.status === next) return;
    this.status = next;
    for (const listener of this.statusListeners) listener(next);
  }

  setExpectedAuthority(catalogId: string | null, directBlobOrigin?: string, thumbnails = false) {
    if (this.running) throw new Error("The synchronization authority cannot change while running.");
    this.expectedCatalogId = catalogId;
    this.directBlobOrigin = directBlobOrigin;
    this.thumbnails = thumbnails;
  }

  private failAuthority(error: unknown) {
    this.replayRequested = false;
    if (this.replayRetryTimer !== null) this.clearTimeoutImpl(this.replayRetryTimer);
    this.replayRetryTimer = null;
    this.connectivity.stop();
    this.setStatus(error instanceof UpgradeRequiredError ? "upgrade-required" : "error");
  }

  private assertAuthority(value: unknown, source: string) {
    const identity = parseAuthorityIdentity(value, source, this.expectedCatalogId);
    if (this.catalogId && identity.catalogId !== this.catalogId) throw new AuthorityValidationError(`${source} belongs to a different catalog.`);
    return identity;
  }

  private activeDesktopIsBlocked(records: readonly OutboxRecord[]) {
    return records.some((record) => record.catalogId === this.catalogId && record.status === "blocked" && outboxOperationDesktopIds(record).has(this.desktopId));
  }

  private async updateStatusFromOutbox(generation?: number, desktopId?: string) {
    const records = await this.storage.readOutbox();
    if (generation !== undefined && desktopId !== undefined) this.assertActiveSession(generation, desktopId);
    this.setStatus(this.activeDesktopIsBlocked(records) ? "blocked" : "online");
    return records;
  }

  private publish(next: DesktopStateSnapshot) {
    this.desktop = next;
    for (const listener of this.desktopListeners) listener(next);
  }

  private current() {
    if (!this.desktop) throw new Error("The desktop is still loading.");
    return this.desktop;
  }

  private assertActive(generation: number) {
    if (!this.running || this.generation !== generation) {
      throw new DOMException("Desktop synchronization was stopped.", "AbortError");
    }
  }

  private sessionIsActive(generation: number, desktopId: string) {
    return this.running && this.generation === generation && this.desktopId === desktopId;
  }

  private assertActiveSession(generation: number, desktopId: string) {
    this.assertActive(generation);
    if (this.desktopId !== desktopId) throw new DOMException("The active desktop changed.", "AbortError");
  }

  private queue<T>(operation: () => Promise<T>) {
    const next = this.work.then(operation, operation);
    this.work = next.then(() => undefined, () => undefined);
    return next;
  }

  private queueSync<T>(operation: () => Promise<T>) {
    const generation = this.generation;
    if (!this.frontendOnly) {
      this.pendingWork += 1;
      if (this.pendingWork === 1) {
        for (const listener of this.syncWorkListeners) listener(true);
      }
    }
    const next = this.syncWork.then(operation, operation);
    this.syncWork = next.then(() => undefined, () => undefined);
    return next.finally(() => {
      if (!this.frontendOnly && this.generation === generation) {
        this.pendingWork -= 1;
        if (this.pendingWork === 0) {
          for (const listener of this.syncWorkListeners) listener(false);
        }
      }
    });
  }

  private scheduleReplayRetry() {
    if (this.replayRetryTimer !== null || !this.running || this.authenticationPaused) return;
    const delay = this.replayRetryMs;
    this.replayRetryMs = Math.min(this.replayRetryMs * 2, REPLAY_RETRY_MAX_MS);
    this.replayRetryTimer = this.setTimeoutImpl(() => {
      this.replayRetryTimer = null;
      this.requestReplay();
    }, delay);
  }

  private requestReplay() {
    if (this.frontendOnly || !this.running || this.authenticationPaused) return;
    this.replayRequested = true;
    if (this.replayRunning || this.status !== "online" && this.status !== "blocked") return;
    this.replayRunning = true;
    const generation = this.generation;
    const desktopId = this.desktopId;
    void this.queueSync(async () => {
      while (this.replayRequested && this.sessionIsActive(generation, desktopId) && (this.status === "online" || this.status === "blocked")) {
        this.replayRequested = false;
        try {
          await this.replayOutbox(generation, desktopId);
          this.replayRetryMs = REPLAY_RETRY_MIN_MS;
          if (this.replayRetryTimer !== null) this.clearTimeoutImpl(this.replayRetryTimer);
          this.replayRetryTimer = null;
        } catch (error) {
          if (!this.sessionIsActive(generation, desktopId)) return;
          if (error instanceof AuthenticationRequiredError) this.setStatus("connecting");
          else if (error instanceof SyncRequestError && error.permanent) this.setStatus("blocked");
          else {
            if (!(error instanceof SyncRequestError) || error.status === null || error.status === 408) this.setStatus("offline");
            this.scheduleReplayRetry();
          }
          return;
        }
      }
    }).finally(() => {
      if (this.generation !== generation) return;
      this.replayRunning = false;
      if (this.replayRequested && (this.status === "online" || this.status === "blocked")) this.requestReplay();
    });
  }

  private async requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
    return this.http.requestJson(input, { ...init, signal: init?.signal ?? this.syncAbort?.signal });
  }

  private pauseForAuthentication() {
    if (this.authenticationPaused) return;
    this.authenticationPaused = true;
    this.connectivity.stop();
    this.healthAbort?.abort();
    this.healthAbort = null;
    this.setStatus("connecting");
  }

  private requireAuthentication(response: Response) {
    return this.http.requireAuthentication(response);
  }

  private async requestDesktop(input: RequestInfo | URL, init?: RequestInit) {
    return parseRemoteDesktopState(await this.requestJson(input, init));
  }

  private async fetchDesktop(desktopId = this.desktopId) {
    try {
      return await this.requestDesktop(API_ROUTES.desktopProjection(desktopId), { cache: "no-store" });
    } catch (error) {
      if (error instanceof SyncRequestError && error.status === 404 && desktopId === this.desktopId) await this.refreshCatalog();
      throw error;
    }
  }

  private async fetchVerifiedRemoteContent(desktopId: string, remote: RemoteDesktopState, entryId: string) {
    const entry = remote.entries.find((candidate): candidate is Extract<RemoteEntry, { kind: "file" }> => candidate.id === entryId && candidate.kind === "file");
    if (!entry) throw new Error("That file no longer exists on the server.");
    const descriptorResponse = this.requireAuthentication(await this.fetchImpl(API_ROUTES.desktopContent(desktopId, entryId, entry.contentRevision), { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders(), signal: this.syncAbort?.signal }));
    if (!descriptorResponse.ok) throw new Error(`The server content could not be loaded (${descriptorResponse.status}).`);
    const descriptor = parseContentAccessDescriptor(await descriptorResponse.json(), entryId, entry.contentRevision, entry.size, this.directBlobOrigin);
    const response = await this.fetchImpl(descriptor.access.url, { method: descriptor.access.method, headers: descriptor.access.headers, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: this.syncAbort?.signal });
    if (!response.ok) throw new Error(`The server content could not be downloaded (${response.status}).`);
    const downloaded = await responseBlobWithProgress(response, descriptor.size, () => undefined);
    if (downloaded.blob.size !== descriptor.size || downloaded.sha256 !== descriptor.sha256) throw new Error("The server content failed integrity verification.");
    return downloaded.blob.slice(0, downloaded.blob.size, entry.mimeType);
  }

  private async fetchCurrentVerifiedContent(desktopId: string, entryId: string, initial?: RemoteDesktopState) {
    let remote = initial ?? await this.fetchDesktop(desktopId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.assertAuthority(remote, "The server desktop");
      const content = await this.fetchVerifiedRemoteContent(desktopId, remote, entryId);
      const revision = remote.entries.find((entry) => entry.id === entryId && entry.kind === "file")?.contentRevision;
      const latest = await this.fetchDesktop(desktopId);
      this.assertAuthority(latest, "The server desktop");
      const latestRevision = latest.entries.find((entry) => entry.id === entryId && entry.kind === "file")?.contentRevision;
      if (revision === latestRevision) return { remote: latest, content, revision: revision! };
      remote = latest;
    }
    throw new VirtualFileChangedError();
  }

  private healthRoute() {
    return API_ROUTES.syncHealth;
  }

  private async applyRemoteState(remote: RemoteDesktopState, generation = this.generation, acknowledgedOperationId?: string, desktopId = this.desktopId, force = false, useAcknowledgedContent = true, acknowledgedRevision?: number) {
    this.assertActive(generation);
    this.assertAuthority(remote, "The server desktop");
    const desktop = desktopId === this.desktopId ? this.current() : await this.storage.readDesktopState(desktopId);
    const identityChanged = desktop.sync.catalogId !== remote.catalogId;
    if (!force && !identityChanged && remote.catalogRevision <= desktop.sync.catalogRevision) {
      if (remote.catalogRevision > this.catalogRevision) this.catalogRevision = remote.catalogRevision;
      return desktop;
    }
    const next = toSnapshot(remote);
    this.assertActive(generation);
    const applied = await this.storage.applyRemoteDesktop(next, new Map(), acknowledgedOperationId, desktopId, force, useAcknowledgedContent, acknowledgedRevision);
    this.assertActive(generation);
    if (remote.catalogRevision > this.catalogRevision) this.catalogRevision = remote.catalogRevision;
    if (desktopId === this.desktopId) this.publish(applied);
    this.publishActivityChange();
    return applied;
  }

  private async ensureServer(generation = this.generation) {
    return this.reconcileActiveWithCreateRecovery(undefined, generation);
  }

  private async reconcile(acknowledgedOperationId?: string, desktopId = this.desktopId, generation = this.generation, acknowledgedRevision?: number) {
    const remote = await this.fetchDesktop(desktopId);
    this.assertActive(generation);
    await this.bindOutboxCatalog(remote.catalogId);
    return this.applyRemoteState(remote, generation, acknowledgedOperationId, desktopId, false, true, acknowledgedRevision);
  }

  private async bindOutboxCatalog(catalogId: string) {
    this.assertAuthority({ schemaVersion: 2, catalogId }, "The server catalog");
    await this.storage.bindOutboxCatalog(catalogId);
    this.catalogId = catalogId;
    await this.publishOutbox();
  }

  private async sendOutboxOperation(record: OutboxRecord, generation: number) {
    return sendOutboxOperation(record, {
      fetch: this.fetchImpl,
      directBlobOrigin: this.directBlobOrigin,
      signal: this.syncAbort?.signal,
      requestJson: (input, init) => this.requestJson(input, init),
      requireAuthentication: (response) => this.requireAuthentication(response),
      readPendingContent: (operationId, entryId, stagedContentKey) => this.storage.readPendingContent(operationId, entryId, stagedContentKey),
      createXMLHttpRequest: this.createXMLHttpRequest,
      onBlobUploadProgress: (entryId, phase, transferredBytes, totalBytes) => this.updateUploadTransfer(record, generation, entryId, phase, transferredBytes, totalBytes),
    });
  }

  private async replayRecord(record: OutboxRecord, generation: number, retryBlocked = false, autoResolveConflict = true) {
    this.assertActive(generation);
    const durable = (await this.storage.readOutbox()).find((candidate) => candidate.operationId === record.operationId);
    if (!durable) return;
    record = durable;
    if (record.status === "blocked" && !retryBlocked) throw new SyncRequestError(record.error ?? "A pending change is blocked.", 409, true);
    if (!this.catalogId || record.catalogId !== this.catalogId) {
      const message = "Pending changes belong to a different catalog.";
      await this.storage.blockMutation(record.operationId, message, null, null);
      await this.publishOutbox();
      throw new SyncRequestError(message, 409, true);
    }
    try {
      await this.storage.recordMutationAttempt?.(record.operationId, Date.now());
      await this.publishOutbox();
      const { response, verifiedUploads } = await this.sendOutboxOperation(record, generation);
      const acknowledgedRevision = typeof response === "object" && response !== null && "catalogRevision" in response && Number.isSafeInteger(response.catalogRevision) && Number(response.catalogRevision) > 0 ? Number(response.catalogRevision) : undefined;
      let reconciled: DesktopStateSnapshot;
      if (record.operation.kind === "create-desktop") {
        reconciled = await this.reconcile(record.operationId, record.operation.desktop.id, generation, acknowledgedRevision);
      } else if (record.operation.kind === "entry-transfer") {
        reconciled = await this.reconcile(record.operationId, record.desktopId, generation, acknowledgedRevision);
        await this.reconcile(undefined, record.operation.destinationDesktopId, generation);
      } else if (record.operation.kind === "delete-desktop") {
        reconciled = await this.reconcile(record.operationId, record.desktopId, generation, acknowledgedRevision);
      } else {
        reconciled = await this.reconcile(record.operationId, record.desktopId, generation, acknowledgedRevision);
      }
      const retainedUploads: Array<{ id: string; revision: number; sha256: string; content: Blob }> = [];
      for (const [id, sha256] of verifiedUploads) {
        const entry = reconciled.entries.find((candidate): candidate is FileEntry => candidate.kind === "file" && candidate.id === id);
        const revision = reconciled.sync.contentRevisions[id];
        if (entry && Number.isSafeInteger(revision)) retainedUploads.push({ id, revision, sha256, content: await this.storage.readPendingContent(record.operationId, id, record.operation.kind === "save-content" ? record.operation.stagedContentKey : undefined) });
      }
      await this.storage.acknowledgeMutation(record.operationId);
      for (const upload of retainedUploads) {
        try { await this.storage.cacheRemoteFile(record.desktopId, reconciled.sync.catalogId!, upload.id, upload.revision, upload.sha256, upload.content); }
        catch (error) { console.warn("Hiraya could not retain uploaded file content locally.", error); }
      }
      this.finishUploadTransfers(record, generation);
      if (this.offlineInventoryListeners.size > 0 && outboxOperationDesktopIds(record).has(this.desktopId)) await this.refreshOfflineInventory();
      await this.publishOutbox();
    } catch (error) {
      this.finishUploadTransfers(record, generation, error);
      if (error instanceof SyncRequestError && error.permanent) {
        const conflict = error.code === "revision_conflict" ? error.details as RevisionConflictDetails | null : null;
        if (autoResolveConflict && conflict) {
          let remoteState = await this.fetchDesktop(record.desktopId);
          if (record.operation.kind === "save-content" && conflict.resourceKind === "content" && conflict.resourceId === record.operation.entryId) {
            const retained = await this.fetchCurrentVerifiedContent(record.desktopId, record.operation.entryId, remoteState);
            remoteState = retained.remote;
            await this.storage.retainContentConflictServer(record.operationId, retained.content);
          }
          const remote = toSnapshot(remoteState);
          this.assertActive(generation);
          const latestConflict = currentConflict(conflict, remote);
          const resolution = resolveOutboxRevisionConflict(record.operation, latestConflict, remote);
          if (resolution.kind === "satisfied") {
            const applied = await this.storage.resolveSatisfiedMutation(remote, record.operationId, latestConflict.actualRevision, record.desktopId);
            this.assertActive(generation);
            if (record.desktopId === this.desktopId) this.publish(applied);
            this.publishActivityChange();
            await this.publishOutbox();
            return;
          }
          if (resolution.kind === "rebase") {
            await this.storage.blockMutation(record.operationId, error.message, error.code, latestConflict);
            const rebased = await this.storage.rebaseBlockedMutation(record.operationId, resolution.operation);
            await this.replayRecord(rebased, generation, false, false);
            return;
          }
          const fields = resolution.fields.join(", ");
          await this.storage.blockMutation(record.operationId, `Both your change and the server changed ${fields}. Choose which version to keep.`, error.code, latestConflict);
        } else {
          await this.storage.blockMutation(record.operationId, error.status === 403 ? ACCESS_REVOKED_ERROR : error.message, error.status === 403 ? "forbidden" : error.code, error.status === 403 ? null : conflict);
        }
        await this.publishOutbox();
      }
      throw error;
    }
  }

  private async replayThroughActiveDesktopCreation(generation: number, desktopId = this.desktopId) {
    const records = await this.storage.readOutbox();
    this.assertActiveSession(generation, desktopId);
    const createIndex = records.findIndex((record) => record.operation.kind === "create-desktop" && record.operation.desktop.id === desktopId);
    if (createIndex < 0) return false;
    for (const record of records.slice(0, createIndex + 1)) {
      const ownerDesktopId = record.desktopId;
      const createsActiveDesktop = record.operation.kind === "create-desktop" && record.operation.desktop.id === desktopId;
      if (ownerDesktopId === desktopId && !createsActiveDesktop) {
        const message = "A desktop mutation is ordered before its pending desktop creation.";
        await this.storage.blockMutation(record.operationId, message, null, null);
        await this.publishOutbox();
        throw new SyncRequestError(message, 409, true);
      }
      await this.replayRecord(record, generation);
    }
    return true;
  }

  private async reconcileActiveWithCreateRecovery(acknowledgedOperationId?: string, generation = this.generation, desktopId = this.desktopId) {
    try {
      return await this.reconcile(acknowledgedOperationId, desktopId, generation);
    } catch (error) {
      if (!(error instanceof SyncRequestError) || error.status !== 404 || !await this.replayThroughActiveDesktopCreation(generation, desktopId)) throw error;
      return this.reconcile(acknowledgedOperationId, desktopId, generation);
    }
  }

  private async replayOutbox(generation = this.generation, activeDesktopId?: string) {
    if (this.status === "upgrade-required" || this.status === "error") return;
    if (activeDesktopId !== undefined) this.assertActiveSession(generation, activeDesktopId);
    if (!this.catalogId) {
      const catalog = parseDesktopCatalog(await this.requestJson(API_ROUTES.desktops, { cache: "no-store" }));
      if (activeDesktopId !== undefined) this.assertActiveSession(generation, activeDesktopId);
      this.catalogRevision = catalog.catalogRevision;
      await this.bindOutboxCatalog(catalog.catalogId);
    } else {
      await this.bindOutboxCatalog(this.catalogId);
    }
    if (activeDesktopId !== undefined) this.assertActiveSession(generation, activeDesktopId);
    const records = (await this.storage.readOutbox()).filter((candidate) => candidate.catalogId === this.catalogId);
    if (activeDesktopId !== undefined) this.assertActiveSession(generation, activeDesktopId);
    const revokedDesktopIds = new Set(records.filter(isAccessRevocationRecord).flatMap((record) => [...outboxOperationDesktopIds(record)]));
    const blockedKeys = new Set(records.filter((record) => record.status === "blocked").flatMap((record) => [...outboxCausalKeys(record)]));
    for (const record of records) {
      if (record.status === "blocked" || isAccessRevocationRecord(record) || [...outboxOperationDesktopIds(record)].some((id) => revokedDesktopIds.has(id)) || [...outboxCausalKeys(record)].some((key) => blockedKeys.has(key))) continue;
      try {
        await this.replayRecord(record, generation);
        if (activeDesktopId !== undefined) this.assertActiveSession(generation, activeDesktopId);
      } catch (error) {
        if (!(error instanceof SyncRequestError) || !error.permanent) throw error;
        for (const key of outboxCausalKeys(record)) blockedKeys.add(key);
        if (error.status === 403) for (const id of outboxOperationDesktopIds(record)) revokedDesktopIds.add(id);
      }
    }
    await this.updateStatusFromOutbox(generation, activeDesktopId);
    if (activeDesktopId !== undefined) this.assertActiveSession(generation, activeDesktopId);
  }

  private startEvents() {
    const generation = this.generation;
    const desktopId = this.desktopId;
    this.connectivity.start({
      onOpen: () => {
        if (!this.sessionIsActive(generation, desktopId)) return;
        if (this.status !== "online" && this.status !== "blocked") this.setStatus("connecting");
        void this.queueSync(async () => {
          this.assertActiveSession(generation, desktopId);
          const catalog = await this.refreshCatalog(generation, desktopId);
          this.assertActiveSession(generation, desktopId);
          if (catalog.desktops.some((desktop) => desktop.id === desktopId)) {
            await this.reconcileActiveWithCreateRecovery(undefined, generation, desktopId);
            this.assertActiveSession(generation, desktopId);
          }
        }).then(async () => {
          if (!this.sessionIsActive(generation, desktopId)) return;
          await this.updateStatusFromOutbox(generation, desktopId);
          this.requestReplay();
        }).catch((error) => {
          if (this.sessionIsActive(generation, desktopId)) this.setStatus(error instanceof SyncRequestError && error.permanent ? "blocked" : "offline");
        });
      },
      onError: () => {
        if (!this.sessionIsActive(generation, desktopId) || this.status === "blocked" || this.authenticationPaused) return;
        this.setStatus("offline");
      },
      onCatalog: (event) => {
        if (!this.sessionIsActive(generation, desktopId)) return;
        if (this.status === "blocked") return;
        let revision = Number.NaN;
        let catalogId = "";
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as unknown;
          const identity = this.assertAuthority(data, "The synchronization event");
          if (typeof data === "object" && data !== null && "catalogRevision" in data) {
            revision = Number((data as { catalogRevision: unknown }).catalogRevision);
          }
          catalogId = identity.catalogId;
        } catch (error) {
          this.failAuthority(error);
          return;
        }
        if (!Number.isSafeInteger(revision) || revision < 0) { this.failAuthority(new AuthorityValidationError("The synchronization event has an invalid revision.")); return; }
        if (catalogId === this.catalogId && revision <= this.catalogRevision) return;
        void this.queueSync(async () => {
          this.assertActiveSession(generation, desktopId);
          if (revision > this.catalogRevision) this.catalogRevision = revision;
          const catalog = await this.refreshCatalog(generation, desktopId);
          this.assertActiveSession(generation, desktopId);
          if (catalog.desktops.some((desktop) => desktop.id === desktopId)) {
            await this.reconcileActiveWithCreateRecovery(undefined, generation, desktopId);
            this.assertActiveSession(generation, desktopId);
          }
          this.requestReplay();
        }).catch((error) => {
          if (this.sessionIsActive(generation, desktopId)) this.setStatus(error instanceof SyncRequestError && error.permanent ? "blocked" : "offline");
        });
      },
      onPoll: () => this.checkHealth(generation, desktopId),
    });
  }

  private async checkHealth(generation: number, desktopId: string) {
    if (!this.sessionIsActive(generation, desktopId) || this.authenticationPaused) return;
    const controller = new AbortController();
    this.healthAbort = controller;
    const deadline = globalThis.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = this.requireAuthentication(await this.fetchImpl(this.healthRoute(), { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders(), signal: controller.signal }));
      this.assertActiveSession(generation, desktopId);
      if (!response.ok) throw new Error("unhealthy");
      const health = await response.json() as unknown;
      this.assertActiveSession(generation, desktopId);
      const identity = this.assertAuthority(health, "The synchronization health response");
      const revision = typeof health === "object" && health !== null && "catalogRevision" in health ? Number((health as { catalogRevision: unknown }).catalogRevision) : Number.NaN;
      const catalogId = identity.catalogId;
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("invalid health response");
      if (this.status === "blocked") return;
      const wasOffline = this.status === "offline";
      if (wasOffline) this.setStatus("connecting");
      const changed = catalogId !== this.current().sync.catalogId || revision > this.catalogRevision;
      if (wasOffline || changed) await this.queueSync(async () => {
        this.assertActiveSession(generation, desktopId);
        if (revision > this.catalogRevision) this.catalogRevision = revision;
        const catalog = await this.refreshCatalog(generation, desktopId);
        this.assertActiveSession(generation, desktopId);
        if (catalog.desktops.some((desktop) => desktop.id === desktopId)) {
          await this.reconcileActiveWithCreateRecovery(undefined, generation, desktopId);
          this.assertActiveSession(generation, desktopId);
        }
      });
      else if (revision > this.catalogRevision) this.catalogRevision = revision;
      this.assertActiveSession(generation, desktopId);
      await this.updateStatusFromOutbox(generation, desktopId);
      this.assertActiveSession(generation, desktopId);
      this.requestReplay();
    } catch (error) {
      if (this.sessionIsActive(generation, desktopId) && (error instanceof UpgradeRequiredError || error instanceof AuthorityValidationError)) this.failAuthority(error);
      else if (this.sessionIsActive(generation, desktopId) && !(error instanceof AuthenticationRequiredError)) this.setStatus(error instanceof SyncRequestError && error.permanent ? "blocked" : "offline");
    } finally {
      globalThis.clearTimeout(deadline);
      if (this.healthAbort === controller) this.healthAbort = null;
    }
  }

  private async mutate<T>(operation: (current: DesktopStateSnapshot) => OutboxOperationInput, select: (next: DesktopStateSnapshot) => T, contents?: Map<string, Blob>, replay = true) {
    return this.queue(async () => {
      const queued = await this.storage.enqueueMutation((current) => ({ ...operation(current), schemaVersion: 1 } as OutboxOperation), contents);
      this.publish(queued.desktop);
      await this.publishOutbox();
      if (replay) this.requestReplay();
      return select(this.current());
    });
  }

  private localMutation<T>(operation: () => Promise<T>, publish = true) {
    return this.queue(async () => {
      const result = await operation();
      const next = await this.storage.readCurrentDesktop();
      if (publish) this.publish(next);
      else this.desktop = next;
      this.publishActivityChange();
      return result;
    });
  }

  private assertParent(parentId: string | null) {
    if (parentId === null) return;
    const parent = this.current().entries.find((entry) => entry.id === parentId);
    if (!parent || parent.kind !== "folder") throw new Error("That parent folder no longer exists.");
  }

  createTextFile(nameValue: string, parentId: string | null, position: EntryPosition) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.createTextFile(nameValue, parentId, position));
    const parsedPosition = parsePosition(position);
    const name = validateEntryName(nameValue);
    this.assertParent(parentId);
    assertUniqueName(this.current().entries, name, parentId);
    const now = Date.now();
    const entry: FileEntry = { kind: "file", id: crypto.randomUUID(), name, parentId, mimeType: "text/plain", size: 0, createdAt: now, modifiedAt: now, position: parsedPosition };
    return this.mutate(() => ({ kind: "create", entries: [entry] }), (next) => next.entries.find((item) => item.id === entry.id) as FileEntry, new Map([[entry.id, new Blob([], { type: entry.mimeType })]]));
  }

  createFile(nameValue: string, parentId: string | null, position: EntryPosition, content: Blob, mimeType?: string, deferReplay = false) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.createFile(nameValue, parentId, position, content, mimeType));
    const parsedPosition = parsePosition(position);
    const name = validateEntryName(nameValue);
    this.assertParent(parentId);
    assertUniqueName(this.current().entries, name, parentId);
    const now = Date.now();
    const entry: FileEntry = {
      kind: "file", id: crypto.randomUUID(), name, parentId,
      mimeType: mimeType ?? (content.type || "application/octet-stream"), size: content.size,
      createdAt: now, modifiedAt: now, position: parsedPosition,
    };
    return this.mutate(() => ({ kind: "create", entries: [entry] }), (next) => next.entries.find((item) => item.id === entry.id) as FileEntry, new Map([[entry.id, content.slice(0, content.size, entry.mimeType)]]), !deferReplay);
  }

  createFolder(nameValue: string, parentId: string | null, position: EntryPosition) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.createFolder(nameValue, parentId, position));
    const parsedPosition = parsePosition(position);
    const name = validateEntryName(nameValue);
    this.assertParent(parentId);
    assertUniqueName(this.current().entries, name, parentId);
    const now = Date.now();
    const entry: FolderEntry = { kind: "folder", id: crypto.randomUUID(), name, parentId, createdAt: now, modifiedAt: now, position: parsedPosition };
    return this.mutate(() => ({ kind: "create", entries: [entry] }), (next) => next.entries.find((item) => item.id === entry.id) as FolderEntry);
  }

  importFiles(files: File[], parentId: string | null, positions: EntryPosition[]) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.importFiles(files, parentId, positions));
    if (files.length !== positions.length) throw new Error("Each imported file needs a desktop position.");
    const parsedPositions = positions.map(parsePosition);
    this.assertParent(parentId);
    const names = files.map((file) => validateEntryName(file.name));
    for (const [index, name] of names.entries()) {
      assertUniqueName(this.current().entries, name, parentId);
      if (names.slice(0, index).some((candidate) => namesMatch(candidate, name))) throw new Error(`The upload contains more than one file named “${name}”.`);
    }
    const createdAt = Date.now();
    const entries: FileEntry[] = files.map((file, index) => ({ kind: "file", id: crypto.randomUUID(), name: names[index], parentId, mimeType: file.type || "application/octet-stream", size: file.size, createdAt, modifiedAt: file.lastModified || createdAt, position: parsedPositions[index] }));
    return this.mutate(() => ({ kind: "create", entries }), (next) => entries.map((entry) => next.entries.find((item) => item.id === entry.id) as FileEntry), new Map(entries.map((entry, index) => [entry.id, files[index]])));
  }

  createEntries(entriesValue: DesktopEntry[], contentsValue: Map<string, Blob>) {
    const entries = parseEntries([...this.current().entries, ...entriesValue]).slice(this.current().entries.length) as DesktopEntry[];
    const files = entries.filter((entry): entry is FileEntry => entry.kind === "file");
    if (contentsValue.size !== files.length || files.some((entry) => !(contentsValue.get(entry.id) instanceof Blob) || contentsValue.get(entry.id)!.size !== entry.size)) {
      throw new Error("Imported file content is incomplete.");
    }
    const contents = new Map(files.map((entry) => [entry.id, contentsValue.get(entry.id)!.slice(0, entry.size, entry.mimeType)]));
    if (this.frontendOnly) return this.localMutation(() => this.storage.createEntries(entries, contents));
    return this.mutate(() => ({ kind: "create", entries }), (next) => entries.map((entry) => next.entries.find((item) => item.id === entry.id)!), contents);
  }

  renameEntry(id: string, nameValue: string) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.renameEntry(id, nameValue));
    const existing = this.current().entries.find((entry) => entry.id === id);
    if (!existing) throw new Error("That entry no longer exists.");
    const name = validateEntryName(nameValue);
    assertUniqueName(this.current().entries, name, existing.parentId, id);
    const modifiedAt = Date.now();
    return this.mutate((current) => {
      const entry = current.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error("That entry no longer exists.");
      assertUniqueName(current.entries, name, entry.parentId, id);
      return { kind: "patch-entry", entryId: id, baseRevision: current.sync.entryRevisions[id] ?? 0, conflictBase: conflictBase(entry), changes: { name, modifiedAt } };
    }, (next) => next.entries.find((item) => item.id === id) as DesktopEntry);
  }

  deleteEntry(id: string) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.deleteEntry(id));
    const before = this.current().entries;
    if (!before.some((entry) => entry.id === id)) throw new Error("That entry no longer exists.");
    return this.mutate((current) => {
      if (!current.entries.some((entry) => entry.id === id)) throw new Error("That entry no longer exists.");
      return { kind: "delete", entryId: id, baseRevision: current.sync.entryRevisions[id] ?? 0 };
    }, (next) => before.filter((entry) => !next.entries.some((item) => item.id === entry.id)));
  }

  deleteEntries(ids: string[]) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.deleteEntries(ids));
    const unique = [...new Set(ids)];
    const before = this.current().entries;
    if (!unique.length || unique.length !== ids.length || unique.some((id) => !before.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
    return this.mutate((current) => {
      if (unique.some((id) => !current.entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
      return { kind: "delete-entries", entryIds: unique, baseRevisions: Object.fromEntries(unique.map((id) => [id, current.sync.entryRevisions[id] ?? 0])) };
    }, (next) => before.filter((entry) => !next.entries.some((item) => item.id === entry.id)));
  }

  moveEntry(id: string, parentId: string | null, position: EntryPosition) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.moveEntry(id, parentId, position));
    const parsedPosition = parsePosition(position);
    const existing = this.current().entries.find((entry) => entry.id === id);
    if (!existing) throw new Error("That entry no longer exists.");
    this.assertParent(parentId);
    const modifiedAt = Date.now();
    return this.mutate((current) => {
      const entry = current.entries.find((candidate) => candidate.id === id);
      if (!entry) throw new Error("That entry no longer exists.");
      if (parentId !== null && !current.entries.some((candidate) => candidate.id === parentId && candidate.kind === "folder")) throw new Error("That parent folder no longer exists.");
      return { kind: "patch-entry", entryId: id, baseRevision: current.sync.entryRevisions[id] ?? 0, conflictBase: conflictBase(entry), changes: { parentId, position: parsedPosition, modifiedAt } };
    }, (next) => next.entries.find((item) => item.id === id) as DesktopEntry);
  }

  moveEntries(ids: string[], parentId: string | null) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.moveEntries(ids, parentId));
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length !== ids.length || unique.some((id) => !this.current().entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
    this.assertParent(parentId);
    const modifiedAt = Date.now();
    return this.mutate((current) => {
      const entries = new Map(current.entries.map((entry) => [entry.id, entry]));
      if (unique.some((id) => !entries.has(id))) throw new Error("An entry no longer exists.");
      if (parentId !== null && !current.entries.some((entry) => entry.id === parentId && entry.kind === "folder")) throw new Error("That parent folder no longer exists.");
      return { kind: "move-entries", entryIds: unique, baseRevisions: Object.fromEntries(unique.map((id) => [id, current.sync.entryRevisions[id] ?? 0])), conflictBases: Object.fromEntries(unique.map((id) => [id, conflictBase(entries.get(id)!)])), parentId, modifiedAt };
    }, (next) => unique.map((id) => next.entries.find((entry) => entry.id === id) as DesktopEntry));
  }

  transferEntries(destinationDesktopId: string, ids: string[], parentId: string | null) {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length !== ids.length || unique.some((id) => !this.current().entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
    return this.queue(async () => {
      const result = this.frontendOnly
        ? await this.storage.transferEntries(this.desktopId, destinationDesktopId, unique, parentId)
        : (await this.storage.enqueueTransfer(this.desktopId, destinationDesktopId, unique, parentId)).desktop;
      this.publish(result);
      if (!this.frontendOnly) await this.publishOutbox();
      this.requestReplay();
      return result;
    });
  }

  async createDesktop(name: string) {
    if (this.frontendOnly) return this.storage.createDesktop(name);
    const queued = await this.storage.enqueueDesktopCreate(name);
    await this.publishOutbox();
    this.requestReplay();
    return queued.desktop;
  }

  async listDesktops(seeded: SeededManifest | null = null, options: { cacheFirst?: boolean } = {}) {
    let local = await this.storage.listDesktops(seeded);
    if (this.frontendOnly) {
      if (local.desktops.length === 0) {
        try {
          const desktop = await this.storage.createDesktop("Desktop");
          local = { desktops: [desktop], activeDesktopId: desktop.id };
        } catch (error) {
          local = await this.storage.listDesktops();
          if (local.desktops.length === 0) throw error;
        }
      }
      return { schemaVersion: 2 as const, catalogId: null, catalogRevision: 0, quota: null, ...local };
    }
    if (options.cacheFirst && local.desktops.length > 0) {
      const quota = this.lastQuota?.catalogId === this.catalogId ? this.lastQuota.quota : null;
      return { schemaVersion: 2 as const, catalogId: null, catalogRevision: 0, quota, ...local };
    }
    try {
      const catalog = parseDesktopCatalog(await this.requestJson(API_ROUTES.desktops, { cache: "no-store" }));
      this.catalogRevision = catalog.catalogRevision;
      await this.bindOutboxCatalog(catalog.catalogId);
      const remoteIds = new Set(catalog.desktops.map((desktop) => desktop.id));
      const records = (await this.storage.readOutbox()).filter((record) => record.catalogId === catalog.catalogId);
      const retainedLocalIds = outboxDesktopRetentionIds(records, catalog.catalogId);
      const pendingDeletes = new Set(records.flatMap((record) => record.operation.kind === "delete-desktop" ? [record.operation.desktopId] : []));
      const pendingRenames = new Map(records.flatMap((record) => record.operation.kind === "rename-desktop" ? [[record.operation.desktop.id, record.operation.desktop.name] as const] : []));
      for (const desktop of catalog.desktops) if (!pendingDeletes.has(desktop.id)) await this.storage.ensureDesktop(desktop);
      local = await this.storage.listDesktops();
      const remoteDesktops = catalog.desktops
        .filter((desktop) => !pendingDeletes.has(desktop.id))
        .map((desktop) => pendingRenames.has(desktop.id) ? { ...desktop, name: pendingRenames.get(desktop.id)! } : desktop);
      const registry = {
        schemaVersion: 2 as const,
        catalogId: catalog.catalogId,
        catalogRevision: catalog.catalogRevision,
        quota: catalog.quota,
        activeDesktopId: local.activeDesktopId && (remoteIds.has(local.activeDesktopId) || retainedLocalIds.has(local.activeDesktopId))
          ? local.activeDesktopId
          : catalog.desktops[0]?.id ?? null,
        desktops: [...remoteDesktops, ...local.desktops.filter((desktop) => !remoteIds.has(desktop.id) && retainedLocalIds.has(desktop.id))],
      };
      this.lastQuota = { catalogId: catalog.catalogId, quota: catalog.quota };
      return registry;
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) throw error;
      if (error instanceof UpgradeRequiredError || error instanceof AuthorityValidationError) throw error;
      if (local.desktops.length === 0) {
        try {
          const created = await this.storage.createOfflineDesktop("Offline desktop");
          local = { desktops: [created.desktop], activeDesktopId: created.desktop.id };
        } catch (creationError) {
          local = await this.storage.listDesktops();
          if (local.desktops.length === 0) throw creationError;
        }
      }
      const quota = this.lastQuota?.catalogId === this.catalogId ? this.lastQuota.quota : null;
      return { schemaVersion: 2 as const, catalogId: null, catalogRevision: 0, quota, ...local };
    }
  }

  async refreshCatalog(generation?: number, desktopId?: string) {
    const catalog = await this.listDesktops();
    if (generation !== undefined && desktopId !== undefined) this.assertActiveSession(generation, desktopId);
    return this.publishCatalog(catalog);
  }

  async updateDesktopPreferences(desktops: DesktopPreference[]) {
    if (this.frontendOnly) throw new Error("Local desktop preferences do not use the server.");
    if (!desktops.length || desktops.some((desktop) => typeof desktop.pinned !== "boolean") || new Set(desktops.map((desktop) => desktop.id)).size !== desktops.length) throw new Error("The desktop preferences are invalid.");
    for (const desktop of desktops) assertValidId(desktop.id, "A desktop preference has an invalid ID.");
    if ((await this.storage.readOutbox()).some((record) => record.operation.kind === "create-desktop")) throw new Error("Wait for new desktops to finish syncing before changing their order.");
    parseDesktopCatalog(await this.requestJson(API_ROUTES.desktopPreferences, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desktops }),
    }));
    return this.refreshCatalog();
  }

  async renameDesktop(desktopId: string, name: string) {
    if (this.frontendOnly) return this.storage.renameDesktop(desktopId, name);
    const queued = await this.storage.enqueueDesktopRename(desktopId, name, this.catalogRevision);
    await this.publishOutbox();
    this.requestReplay();
    return queued.desktop;
  }

  async deleteDesktop(desktopId: string) {
    if (desktopId === this.desktopId) throw new Error("Switch desktops before deleting the active desktop.");
    const protection = desktopPendingOperationProtection(await this.storage.readOutbox(), desktopId);
    if (protection) throw new Error(protection);
    if (this.frontendOnly) await this.storage.deleteDesktop(desktopId);
    else {
      await this.storage.enqueueDesktopDelete(this.desktopId, desktopId, this.catalogRevision);
      await this.publishOutbox();
      this.requestReplay();
    }
  }

  async captureEntries(rootIds: string[]): Promise<ClipboardEntrySnapshot> {
    const generation = this.generation;
    const desktopId = this.desktopId;
    const desktop = this.current();
    const roots = [...new Set(rootIds)].map((id) => desktop.entries.find((entry) => entry.id === id));
    if (!roots.length || roots.some((entry) => !entry)) throw new Error("An entry no longer exists.");
    const included = new Set(rootIds);
    for (let changed = true; changed;) {
      changed = false;
      for (const entry of desktop.entries) if (entry.parentId && included.has(entry.parentId) && !included.has(entry.id)) { included.add(entry.id); changed = true; }
    }
    const sourceEntries = desktop.entries.filter((entry) => included.has(entry.id));
    const expectedContentRevisions = new Map(sourceEntries.filter((entry): entry is FileEntry => entry.kind === "file").map((entry) => [entry.id, desktop.sync.contentRevisions[entry.id]]));
    const contents = new Map<string, Blob>();
    await Promise.all(sourceEntries.map(async (entry) => { if (entry.kind === "file") contents.set(entry.id, await this.readFile(entry.id)); }));
    return this.queue(async () => {
      this.assertActiveSession(generation, desktopId);
      const current = this.current();
      const unchanged = sourceEntries.every((entry) => {
        const candidate = current.entries.find((item) => item.id === entry.id);
        return candidate && candidate.kind === entry.kind && candidate.name === entry.name && candidate.parentId === entry.parentId && candidate.modifiedAt === entry.modifiedAt && (entry.kind !== "file" || candidate.kind === "file" && candidate.size === entry.size && current.sync.contentRevisions[entry.id] === expectedContentRevisions.get(entry.id));
      });
      if (!unchanged) throw new Error("An item changed while it was being copied. Try again.");
      const entries = sourceEntries.map((entry) => rootIds.includes(entry.id) ? { ...entry, parentId: null } : { ...entry });
      return { selectedRootIds: [...rootIds], entries, contents };
    });
  }

  pasteEntries(snapshot: ClipboardEntrySnapshot, parentId: string | null, rootNames: Map<string, string>, rootPositions: Map<string, EntryPosition>) {
    this.assertParent(parentId);
    const idMap = new Map(snapshot.entries.map((entry) => [entry.id, crypto.randomUUID()]));
    const now = Date.now();
    const entries = snapshot.entries.map((entry): DesktopEntry => {
      const isRoot = snapshot.selectedRootIds.includes(entry.id);
      const name = validateEntryName(isRoot ? rootNames.get(entry.id) ?? entry.name : entry.name);
      const nextParent = isRoot ? parentId : idMap.get(entry.parentId!);
      const position = parsePosition(isRoot ? rootPositions.get(entry.id) ?? entry.position : entry.position);
      return { ...entry, id: idMap.get(entry.id)!, name, parentId: nextParent ?? null, position, createdAt: now, modifiedAt: now };
    });
    const rootEntries = entries.filter((entry) => snapshot.selectedRootIds.some((id) => idMap.get(id) === entry.id));
    for (const [index, entry] of rootEntries.entries()) {
      assertUniqueName(this.current().entries, entry.name, parentId);
      if (rootEntries.slice(0, index).some((candidate) => namesMatch(candidate.name, entry.name))) throw new Error(`More than one copied item is named “${entry.name}”.`);
    }
    const contents = new Map<string, Blob>();
    for (const entry of snapshot.entries) if (entry.kind === "file") {
      const content = snapshot.contents.get(entry.id);
      if (!content || content.size !== entry.size) throw new Error(`The copied contents of “${entry.name}” are unavailable.`);
      contents.set(idMap.get(entry.id)!, content);
    }
    return this.createEntries(entries, contents);
  }

  updateEntryPosition(id: string, position: EntryPosition) {
    const parsedPosition = parsePosition(position);
    if (this.frontendOnly) return this.localMutation(() => this.storage.updateEntryPosition(id, position));
    if (!this.current().entries.some((entry) => entry.id === id)) throw new Error("That entry no longer exists.");
    return this.mutate((current) => {
      const existing = current.entries.find((entry) => entry.id === id);
      if (!existing) throw new Error("That entry no longer exists.");
      return { kind: "patch-entry", entryId: id, baseRevision: current.sync.entryRevisions[id] ?? 0, conflictBase: conflictBase(existing), changes: { position: parsedPosition } };
    }, (next) => next.entries.find((item) => item.id === id) as DesktopEntry);
  }

  updateRootEntryPositions(positionValues: RootEntryPositionUpdate[]) {
    const positions = parseRootEntryPositionUpdates(positionValues, this.current().entries);
    if (this.frontendOnly) return this.localMutation(() => this.storage.updateRootEntryPositions(positions));
    return this.mutate((current) => {
      const currentPositions = parseRootEntryPositionUpdates(positions, current.entries);
      const entries = new Map(current.entries.map((entry) => [entry.id, entry]));
      return { kind: "root-entry-positions", positions: currentPositions, baseRevisions: Object.fromEntries(currentPositions.map(({ entryId }) => [entryId, current.sync.entryRevisions[entryId] ?? 0])), conflictBases: Object.fromEntries(currentPositions.map(({ entryId }) => [entryId, conflictBase(entries.get(entryId)!)])) };
    }, (next) => positions.map(({ entryId }) => next.entries.find((entry) => entry.id === entryId) as DesktopEntry));
  }

  saveFile(id: string, content: Blob, options: SaveFileOptions = {}) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveFile(id, content, options));
    const existing = this.current().entries.find((entry): entry is FileEntry => entry.id === id && entry.kind === "file");
    if (!existing) throw new Error("That file no longer exists.");
    const entry = { ...existing, mimeType: options.mimeType ?? existing.mimeType, size: content.size, modifiedAt: Date.now() };
    return this.mutate(
      (current) => {
        const actualRevision = current.sync.contentRevisions[id] ?? 0;
        if (options.expectedContentRevision !== undefined && options.expectedContentRevision !== actualRevision) throw new ContentRevisionConflictError(options.expectedContentRevision, actualRevision);
        const currentEntry = current.entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
        if (!currentEntry) throw new Error("That file no longer exists.");
        return { kind: "save-content", entryId: id, mimeType: options.mimeType ?? currentEntry.mimeType, size: content.size, modifiedAt: entry.modifiedAt, baseContentRevision: options.unconditional ? undefined : current.sync.contentRevisions[id] };
      },
      (next) => next.entries.find((item) => item.id === id) as FileEntry,
      new Map([[id, content.slice(0, content.size, entry.mimeType)]]),
    );
  }

  saveTextFile(id: string, content: string) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveTextFile(id, content));
    const existing = this.current().entries.find((entry): entry is FileEntry => entry.id === id && entry.kind === "file");
    if (!existing) throw new Error("That file no longer exists.");
    return this.saveFile(id, new Blob([content], { type: existing.mimeType }));
  }

  saveDesktopLayout(layout: DesktopLayout, base?: { revision: number; layout: DesktopLayout }) {
    const parsed = parseLayout(layout);
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveDesktopLayout(parsed), false);
    return this.mutate((current) => ({ kind: "layout", layout: base ? mergeDesktopLayout(base.layout, parsed, current.layout) : parsed, baseRevision: current.sync.layoutRevision, conflictBase: current.layout }), () => undefined);
  }

  saveEditorSettings(settings: EditorSettings) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveEditorSettings(settings), false);
    return this.mutate((current) => ({ kind: "editor-settings", settings, baseRevision: current.sync.settingsRevision, conflictBase: current.editorSettings }), () => undefined);
  }

  selectTheme(themeId: string) {
    parseThemeState({ ...this.current().appearance, selectedThemeId: themeId });
    if (this.frontendOnly) return this.localMutation(() => this.storage.selectTheme(themeId));
    return this.mutate((current) => {
      parseThemeState({ ...current.appearance, selectedThemeId: themeId });
      return { kind: "select-theme", themeId, baseRevision: current.sync.themeSelectionRevision };
    }, (next) => next.appearance);
  }

  saveCustomTheme(value: CustomTheme) {
    const parsed = parseCustomTheme(value);
    if (this.frontendOnly) {
      const existing = this.current().appearance.customThemes.find((item) => item.id === parsed.id);
      return this.localMutation(() => this.storage.saveCustomTheme(parseCustomTheme({ ...parsed, wallpaper: parsed.wallpaper ?? existing?.wallpaper })));
    }
    return this.mutate((current) => {
      const existing = current.appearance.customThemes.find((item) => item.id === parsed.id);
      const theme = parseCustomTheme({ ...parsed, wallpaper: parsed.wallpaper ?? existing?.wallpaper });
      parseThemeState({ ...current.appearance, customThemes: existing ? current.appearance.customThemes.map((item) => item.id === theme.id ? theme : item) : [...current.appearance.customThemes, theme] });
      return { kind: "upsert-theme", theme, baseRevision: current.sync.themeRevisions[theme.id] ?? 0 };
    }, (next) => next.appearance.customThemes.find((item) => item.id === parsed.id)!);
  }

  installThemePackage(value: CustomTheme, wallpaperKind: "static" | "animated" | "scene" | null, archive: Blob, layout: DesktopLayout) {
    if (this.frontendOnly) return Promise.reject(new Error("Packaged wallpaper themes require a synchronized Hiraya server."));
    const theme = parseCustomTheme(value);
    const assetId = crypto.randomUUID();
    const packaged = parseCustomTheme(wallpaperKind === null ? theme : { ...theme, wallpaper: { assetId, kind: wallpaperKind, size: archive.size, sha256: "0".repeat(64), revision: 0 } });
    return this.mutate((current) => ({
      kind: "install-theme-package",
      theme: packaged,
      assetId,
      wallpaperKind,
      size: wallpaperKind === null ? 0 : archive.size,
      layout: parseLayout({ ...(wallpaperKind === null && layout.wallpaper.source === `theme:${theme.id}` ? { ...layout, wallpaper: DEFAULT_WALLPAPER } : layout), widgets: current.layout.widgets, iconGroups: current.layout.iconGroups }),
      baseThemeRevision: current.sync.themeRevisions[theme.id] ?? 0,
      baseSelectionRevision: current.sync.themeSelectionRevision,
      baseLayoutRevision: current.sync.layoutRevision,
    }), (next) => next.appearance.customThemes.find((item) => item.id === theme.id)!, wallpaperKind === null ? new Map() : new Map([[assetId, archive]]));
  }

  deleteCustomTheme(themeId: string) {
    if (!this.current().appearance.customThemes.some((theme) => theme.id === themeId)) throw new Error("That custom theme no longer exists.");
    if (this.frontendOnly) return this.localMutation(() => this.storage.deleteCustomTheme(themeId));
    return this.mutate((current) => {
      if (!current.appearance.customThemes.some((theme) => theme.id === themeId)) throw new Error("That custom theme no longer exists.");
      return { kind: "delete-theme", themeId, baseRevision: current.sync.themeRevisions[themeId] ?? 0 };
    }, (next) => next.appearance);
  }

  async readFile(id: FileEntry["id"]): Promise<File> {
    const entry = this.current().entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
    if (!entry) throw new Error("That file no longer exists.");
    const catalogId = this.current().sync.catalogId;
    if (this.frontendOnly || !catalogId) return this.storage.readFile(id);

    const desktopId = this.desktopId;
    const contentRevision = this.current().sync.contentRevisions[id];
    const generation = this.generation;
    const signal = this.syncAbort?.signal;
    const cached = await this.storage.readCachedFile(desktopId, catalogId, id, contentRevision);
    if (cached) return cached;
    if (!Number.isSafeInteger(contentRevision)) throw new Error("That file has invalid synchronization metadata.");
    if (this.status === "offline") throw new VirtualFileUnavailableError();

    const key = `${desktopId}\n${catalogId}\n${id}\n${contentRevision}`;
    const existing = this.contentLoads.get(key);
    if (existing) return existing;
    const transferId = `download:${key}`;
    this.updateDownloadTransfer(generation, desktopId, { id: transferId, entryId: id, fileName: entry.name, direction: "download", phase: "access", transferredBytes: 0, totalBytes: entry.size, error: null });
    this.activeEntryDownloadIds.add(id);
    this.publishEntryDownloads();
    const loading = (async () => {
      let descriptorResponse: Response;
      try {
        descriptorResponse = await this.fetchImpl(API_ROUTES.desktopContent(desktopId, id, contentRevision), { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders(), signal });
      } catch {
        if (signal?.aborted) throw new DOMException("File loading was stopped.", "AbortError");
        if (this.sessionIsActive(generation, desktopId)) this.setStatus("offline");
        throw new VirtualFileUnavailableError();
      }
      this.assertActiveSession(generation, desktopId);
      this.requireAuthentication(descriptorResponse);
      if (!descriptorResponse.ok) throw new Error(descriptorResponse.status === 404 ? "This file no longer exists on the server." : `Access to the server contents of “${entry.name}” could not be loaded (${descriptorResponse.status}).`);
      let descriptor;
      try {
        descriptor = parseContentAccessDescriptor(await descriptorResponse.json(), id, contentRevision, entry.size, this.directBlobOrigin);
      } catch (error) {
        if (error instanceof Error && error.message.includes("different revision")) throw new VirtualFileChangedError();
        throw error;
      }
      let response: Response;
      try {
        response = await this.fetchImpl(descriptor.access.url, {
          method: descriptor.access.method,
          headers: descriptor.access.headers,
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          signal,
        });
      } catch {
        if (signal?.aborted) throw new DOMException("File loading was stopped.", "AbortError");
        throw new VirtualFileUnavailableError("This file could not be downloaded. Reconnect and try again.");
      }
      if (!response.ok) throw new VirtualFileUnavailableError(`This file could not be downloaded (${response.status}). Reconnect and try again.`);
      this.updateDownloadTransfer(generation, desktopId, { id: transferId, entryId: id, fileName: entry.name, direction: "download", phase: "downloading", transferredBytes: 0, totalBytes: descriptor.size, error: null });
      const downloaded = await responseBlobWithProgress(response, descriptor.size, (transferredBytes) => {
        this.updateDownloadTransfer(generation, desktopId, { id: transferId, entryId: id, fileName: entry.name, direction: "download", phase: "downloading", transferredBytes, totalBytes: descriptor.size, error: null });
      });
      const content = downloaded.blob;
      this.updateDownloadTransfer(generation, desktopId, { id: transferId, entryId: id, fileName: entry.name, direction: "download", phase: "finalizing", transferredBytes: content.size, totalBytes: descriptor.size, error: null });
      if (content.size !== descriptor.size || content.size !== entry.size) throw new Error(`The server contents of “${entry.name}” have an unexpected size.`);
      if (downloaded.sha256 !== descriptor.sha256) throw new Error(`The server contents of “${entry.name}” failed integrity verification.`);
      this.assertActive(generation);
      const stored = await this.storage.cacheRemoteFile(desktopId, catalogId, id, contentRevision, descriptor.sha256, content);
      this.assertActive(generation);
      if (!stored) throw new VirtualFileChangedError();
      await this.loadOfflineInventory().catch(() => undefined);
      this.updateDownloadTransfer(generation, desktopId, { id: transferId, entryId: id, fileName: entry.name, direction: "download", phase: "complete", transferredBytes: descriptor.size, totalBytes: descriptor.size, error: null });
      return stored;
    })().catch((error) => {
      const current = this.transfers.get(transferId);
      if (current && this.sessionIsActive(generation, desktopId)) this.updateTransfer({ ...current, phase: "failed", error: error instanceof Error ? error.message : "The file download failed." });
      throw error;
    });
    this.contentLoads.set(key, loading);
    try {
      return await loading;
    } finally {
      if (this.contentLoads.get(key) === loading) this.contentLoads.delete(key);
      this.activeEntryDownloadIds.delete(id);
      this.publishEntryDownloads();
    }
  }

  async previewFile(id: FileEntry["id"]): Promise<FilePreviewSource> {
    const entry = this.current().entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
    if (!entry) throw new Error("That file no longer exists.");
    const catalogId = this.current().sync.catalogId;
    if (this.frontendOnly || !catalogId) return { kind: "blob", blob: await this.storage.readFile(id) };

    const desktopId = this.desktopId;
    const contentRevision = this.current().sync.contentRevisions[id];
    const generation = this.generation;
    const signal = this.syncAbort?.signal;
    const cached = await this.storage.readCachedFile(desktopId, catalogId, id, contentRevision);
    if (cached) return { kind: "blob", blob: cached };
    if (!Number.isSafeInteger(contentRevision)) throw new Error("That file has invalid synchronization metadata.");
    if (this.status === "offline") throw new VirtualFileUnavailableError();

    let response: Response;
    try {
      response = await this.fetchImpl(API_ROUTES.desktopContent(desktopId, id, contentRevision, "preview"), { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders(), signal });
    } catch {
      if (signal?.aborted) throw new DOMException("File loading was stopped.", "AbortError");
      if (this.sessionIsActive(generation, desktopId)) this.setStatus("offline");
      throw new VirtualFileUnavailableError();
    }
    this.assertActiveSession(generation, desktopId);
    this.requireAuthentication(response);
    if (!response.ok) throw new Error(response.status === 404 ? "This file no longer exists on the server." : `A preview of “${entry.name}” could not be loaded (${response.status}).`);
    const descriptor = parseContentAccessDescriptor(await response.json(), id, contentRevision, entry.size, this.directBlobOrigin);
    if (Object.keys(descriptor.access.headers).length) throw new Error("The server did not provide a browser-compatible media preview.");
    return { kind: "url", url: descriptor.access.url, expiresAt: descriptor.access.expiresAt };
  }

  async thumbnailFile(id: FileEntry["id"]): Promise<FilePreviewSource> {
    const entry = this.current().entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
    if (!entry) throw new Error("That file no longer exists.");
    const image = entry.mimeType.toLowerCase().startsWith("image/");
    const catalogId = this.current().sync.catalogId;
    if (this.frontendOnly || !catalogId) {
      if (image) return { kind: "blob", blob: await this.storage.readFile(id) };
      throw new Error("Generated thumbnails are unavailable.");
    }
    if (!this.thumbnails) {
      if (image) return this.previewFile(id);
      throw new Error("Generated thumbnails are unavailable.");
    }
    const contentRevision = this.current().sync.contentRevisions[id];
    if (!Number.isSafeInteger(contentRevision) || contentRevision <= 0) throw new Error("That file has invalid synchronization metadata.");
    if (!supportsThumbnailMime(entry.mimeType) || entry.size > THUMBNAIL_MAX_SOURCE_SIZE) {
      if (image) {
        const cached = await this.storage.readCachedFile(this.desktopId, catalogId, id, contentRevision).catch(() => null);
        if (cached) return { kind: "blob", blob: cached };
      }
      throw new Error("Generated thumbnails are unavailable for this file.");
    }
    try {
      const blob = await loadThumbnail({
        authority: `${catalogId}/${this.desktopId}`,
        entryId: id,
        contentRevision,
        endpoint: API_ROUTES.desktopThumbnail(this.desktopId, id, contentRevision, THUMBNAIL_PROFILE),
        expectedDirectOrigin: this.directBlobOrigin,
        descriptorInit: { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders(), signal: this.syncAbort?.signal },
        fetchImpl: this.fetchImpl,
        onDescriptorResponse: (response) => { this.requireAuthentication(response); },
      });
      return { kind: "blob", blob };
    } catch (error) {
      if (image) {
        const cached = await this.storage.readCachedFile(this.desktopId, catalogId, id, contentRevision).catch(() => null);
        if (cached) return { kind: "blob", blob: cached };
      }
      throw error;
    }
  }

  async estimateOfflineOperation(rootIds: readonly string[]) {
    const roots = dedupeOfflineRoots(this.current().entries, rootIds);
    const inventory = await this.storage.loadOfflineInventory(this.desktopId);
    const model = buildOfflineAvailability(this.current().entries, inventory);
    const files = offlineFilesUnderRoots(this.current().entries, roots);
    return { roots, fileCount: files.length, downloadBytes: files.reduce((total, file) => total + (model.entries[file.id]?.downloadBytes ?? file.size), 0) };
  }

  async isFileAvailableOffline(id: FileEntry["id"]) {
    const entry = this.current().entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
    if (!entry) throw new Error("That file no longer exists.");
    const catalogId = this.current().sync.catalogId;
    if (this.frontendOnly || !catalogId) {
      try { await this.storage.readFile(id); return true; }
      catch (error) { if (error instanceof DOMException && error.name === "NotFoundError") return false; throw error; }
    }
    const contentRevision = this.current().sync.contentRevisions[id];
    if (!Number.isSafeInteger(contentRevision)) throw new Error("That file has invalid synchronization metadata.");
    return await this.storage.readCachedFile(this.desktopId, catalogId, id, contentRevision) !== null;
  }

  makeFileAvailableOffline(id: FileEntry["id"]) { return this.readFile(id); }

  removeFileFromOfflineCache(id: FileEntry["id"]) {
    return this.queue(async () => {
      const entry = this.current().entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
      if (!entry) throw new Error("That file no longer exists.");
      const catalogId = this.current().sync.catalogId;
      if (this.frontendOnly || !catalogId) throw new Error("Authoritative local file content cannot be removed from offline storage.");
      const contentRevision = this.current().sync.contentRevisions[id];
      if (!Number.isSafeInteger(contentRevision)) throw new Error("That file has invalid synchronization metadata.");
      return this.storage.removeCachedFile(this.desktopId, catalogId, id, contentRevision);
    });
  }

  downloadOfflineCopies(rootIds: readonly string[]) {
    const desktopId = this.desktopId;
    const generation = this.generation;
    const roots = dedupeOfflineRoots(this.current().entries, rootIds);
    const existing = this.offlineDownload;
    if (existing?.desktopId === desktopId && existing.generation === generation) return existing.promise;
    const promise = this.downloadOfflineCopiesInternal(desktopId, generation, roots).finally(() => { if (this.offlineDownload?.promise === promise) this.offlineDownload = null; });
    this.offlineDownload = { desktopId, generation, promise };
    return promise;
  }

  private async downloadOfflineCopiesInternal(desktopId: string, generation: number, rootIds: readonly string[]) {
    if (this.frontendOnly) return this.loadOfflineInventory();
    if (this.status === "offline") throw new VirtualFileUnavailableError("Reconnect before downloading offline copies.");
    const inventory = await this.loadOfflineInventory();
    if (this.desktopId !== desktopId || this.generation !== generation) return inventory;
    const files = offlineFilesUnderRoots(this.current().entries, rootIds);
    const targets = files.filter((file) => !inventory.files[file.id]?.cached && !inventory.files[file.id]?.protected);
    if (!targets.length) { for (const listener of this.offlineInventoryListeners) listener(inventory); return inventory; }
    const updatingIds = new Set(targets.map((file) => file.id));
    const errors = new Map<string, string>();
    let completed = 0;
    let bytesCompleted = 0;
    const totalBytes = targets.reduce((total, file) => total + file.size, 0);
    const operationId = crypto.randomUUID();
    const report = (phase: OfflineOperationProgress["phase"]) => {
      if (this.desktopId !== desktopId || this.generation !== generation) return;
      this.publishOfflineProgress({ desktopId, generation, operationId, phase, completed, total: targets.length, failed: errors.size, bytesCompleted, totalBytes, updatingIds: new Set(updatingIds), errors: new Map(errors) });
    };
    report("downloading");
    await mapWithConcurrency(targets, 3, async (file) => {
      try { await this.readFile(file.id); bytesCompleted += file.size; }
      catch (error) { errors.set(file.id, error instanceof Error ? error.message : "The offline copy could not be downloaded."); }
      finally { completed += 1; updatingIds.delete(file.id); report("downloading"); }
    });
    report(errors.size ? "error" : "complete");
    if (this.desktopId !== desktopId || this.generation !== generation) return inventory;
    const refreshed = await this.loadOfflineInventory();
    if (errors.size) throw new Error(`${errors.size} ${errors.size === 1 ? "file" : "files"} could not be downloaded.`);
    return refreshed;
  }

  async releaseOfflineCopies(rootIds?: readonly string[]) {
    const roots = rootIds ? dedupeOfflineRoots(this.current().entries, rootIds) : undefined;
    const released = await this.storage.releaseOfflineCopies(this.desktopId, roots);
    await this.loadOfflineInventory();
    return released;
  }

  async readFileByRelativePath(fromFileId: FileEntry["id"], relativePath: string) {
    const file = await this.storage.resolveFileByRelativePath(fromFileId, relativePath);
    return { file, blob: await this.readFile(file.id) };
  }
  async getOutboxStatus() {
    const records = await this.storage.readOutbox();
    return {
      pending: records.filter((record) => record.status === "pending").length,
      blocked: records.filter((record) => record.status === "blocked").length,
      records,
    };
  }

  listOutboxRecords() {
    return this.storage.readOutbox().then((records) => [...records]);
  }

  async loadContentConflict(operationId: string): Promise<ContentConflictBundle> {
    const record = (await this.storage.readOutbox()).find((candidate) => candidate.operationId === operationId);
    if (!record || !isRevisionConflictRecord(record) || record.operation.kind !== "save-content" || record.conflictDetails?.resourceKind !== "content") throw new Error("That content conflict no longer exists.");
    const entryId = record.operation.entryId;
    const baseRevision = record.operation.baseContentRevision ?? record.conflictDetails.expectedRevision;
    const contents = await this.storage.readContentConflict(operationId, entryId, baseRevision, record.operation.stagedContentKey);
    let server = contents.server;
    let serverRevision = record.conflictDetails.actualRevision;
    let serverEntry = (await this.storage.readDesktopState(record.desktopId)).entries.find((candidate): candidate is FileEntry => candidate.id === entryId && candidate.kind === "file");
    if (this.status !== "offline") {
      try {
        const retained = await this.fetchCurrentVerifiedContent(record.desktopId, entryId);
        await this.storage.retainContentConflictServer(operationId, retained.content);
        server = retained.content;
        serverRevision = retained.revision;
        serverEntry = toSnapshot(retained.remote).entries.find((candidate): candidate is FileEntry => candidate.id === entryId && candidate.kind === "file");
      } catch (error) {
        if (!server) throw error;
      }
    }
    if (!server) throw new Error("The server version has not been retained yet. Reconnect and try again.");
    if (!serverEntry) throw new Error("That file no longer exists on the server.");
    return {
      operationId,
      desktopId: record.desktopId,
      entryId,
      expectedRevision: record.conflictDetails.expectedRevision,
      serverRevision,
      mine: contents.mine,
      base: contents.base,
      server,
      mineMetadata: { name: serverEntry.name, mimeType: record.operation.mimeType, size: record.operation.size, modifiedAt: record.operation.modifiedAt },
      serverMetadata: { name: serverEntry.name, mimeType: serverEntry.mimeType, size: server.size, modifiedAt: serverEntry.modifiedAt },
    };
  }

  private async replayContentResolution(record: OutboxRecord, operation: Extract<OutboxOperation, { kind: "save-content" }>, generation: number) {
    this.assertActiveSession(generation, record.desktopId);
    const records = await this.storage.readOutbox();
    const index = records.findIndex((candidate) => candidate.operationId === record.operationId);
    if (index < 0) throw new Error("That content conflict no longer exists.");
    for (const queued of records.slice(0, index + 1)) {
      if (queued.operationId !== record.operationId && queued.status === "blocked") throw new Error("Resolve the earlier blocked change first.");
      this.assertActiveSession(generation, record.desktopId);
      const next = queued.operationId === record.operationId ? await this.storage.rebaseBlockedMutation(record.operationId, operation) : queued;
      try {
        await this.replayRecord(next, generation, queued.operationId === record.operationId, false);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError" || error instanceof SyncRequestError && error.permanent) throw error;
        this.setStatus("offline");
        return this.storage.readOutbox();
      }
    }
    await this.updateStatusFromOutbox();
    return this.storage.readOutbox();
  }

  private contentConflictRecord(records: readonly OutboxRecord[], operationId: string) {
    const record = records.find((candidate) => candidate.operationId === operationId);
    if (!record || !isRevisionConflictRecord(record) || record.operation.kind !== "save-content" || record.conflictDetails?.resourceKind !== "content") throw new Error("That content conflict no longer exists.");
    return record as OutboxRecord & { operation: Extract<OutboxOperation, { kind: "save-content" }>; conflictDetails: RevisionConflictDetails };
  }

  resolveContentConflictKeepLocal(operationId: string, reviewedServerRevision: number) {
    const generation = this.generation;
    return this.queueSync(async () => {
      const record = this.contentConflictRecord(await this.storage.readOutbox(), operationId);
      this.assertActiveSession(generation, record.desktopId);
      const retained = await this.fetchCurrentVerifiedContent(record.desktopId, record.operation.entryId);
      if (retained.revision !== reviewedServerRevision) throw new Error("The server version changed again. Reload the comparison before keeping your version.");
      this.assertActiveSession(generation, record.desktopId);
      await this.storage.retainContentConflictServer(operationId, retained.content);
      await this.storage.retainContentConflictBase(operationId, retained.revision, retained.content);
      return this.replayContentResolution(record, { ...record.operation, baseContentRevision: retained.revision }, generation);
    });
  }

  resolveContentConflictMerged(operationId: string, content: Blob, reviewedServerRevision: number) {
    const generation = this.generation;
    return this.queueSync(async () => {
      const record = this.contentConflictRecord(await this.storage.readOutbox(), operationId);
      this.assertActiveSession(generation, record.desktopId);
      const retained = await this.fetchCurrentVerifiedContent(record.desktopId, record.operation.entryId);
      if (retained.revision !== reviewedServerRevision) throw new Error("The server version changed again. Reload the comparison before saving the merge.");
      const mimeType = content.type || record.operation.mimeType;
      const merged = content.slice(0, content.size, mimeType);
      this.assertActiveSession(generation, record.desktopId);
      await this.storage.retainContentConflictServer(operationId, retained.content);
      await this.storage.retainContentConflictBase(operationId, retained.revision, retained.content);
      const stagedContentKey = await this.storage.stagePendingContentVariant(operationId, merged);
      return this.replayContentResolution(record, { ...record.operation, mimeType, size: merged.size, modifiedAt: Date.now(), baseContentRevision: retained.revision, stagedContentKey }, generation);
    });
  }

  resolveContentConflictKeepServer(operationId: string) {
    const generation = this.generation;
    return this.queueSync(async () => {
      const record = this.contentConflictRecord(await this.storage.readOutbox(), operationId);
      this.assertActiveSession(generation, record.desktopId);
      const retained = await this.fetchCurrentVerifiedContent(record.desktopId, record.operation.entryId);
      this.assertActiveSession(generation, record.desktopId);
      await this.storage.retainContentConflictServer(operationId, retained.content);
      const applied = await this.applyRemoteState(retained.remote, generation, operationId, record.desktopId, true, false);
      await this.storage.acknowledgeMutation(operationId);
      const entry = applied.entries.find((candidate): candidate is FileEntry => candidate.id === record.operation.entryId && candidate.kind === "file");
      if (entry && applied.sync.catalogId) await this.storage.cacheRemoteFile(record.desktopId, applied.sync.catalogId, entry.id, retained.revision, await sha256Blob(retained.content), retained.content);
      await this.publishOutbox();
      await this.updateStatusFromOutbox();
      return this.storage.readOutbox();
    });
  }

  resolveContentConflictKeepBoth(operationId: string) {
    const generation = this.generation;
    return this.queueSync(async () => {
      const record = this.contentConflictRecord(await this.storage.readOutbox(), operationId);
      this.assertActiveSession(generation, record.desktopId);
      const retained = await this.fetchCurrentVerifiedContent(record.desktopId, record.operation.entryId);
      this.assertActiveSession(generation, record.desktopId);
      await this.storage.retainContentConflictServer(operationId, retained.content);
      const remote = toSnapshot(retained.remote);
      const original = remote.entries.find((candidate): candidate is FileEntry => candidate.id === record.operation.entryId && candidate.kind === "file");
      if (!original) throw new Error("That file no longer exists on the server.");
      const dot = original.name.lastIndexOf(".");
      const stem = dot > 0 ? original.name.slice(0, dot) : original.name;
      const extension = dot > 0 ? original.name.slice(dot) : "";
      const entries = [...retained.remote.entries, ...this.current().entries];
      let copyName = `${stem} (local conflict)${extension}`;
      for (let suffix = 2; entries.some((entry) => entry.id !== original.id && entry.parentId === original.parentId && namesMatch(entry.name, copyName)); suffix += 1) copyName = `${stem} (local conflict ${suffix})${extension}`;
      const sibling: FileEntry = { ...original, id: crypto.randomUUID(), name: copyName, mimeType: record.operation.mimeType, size: record.operation.size, createdAt: Date.now(), modifiedAt: record.operation.modifiedAt };
      const queued = await this.storage.resolveContentConflictKeepBoth(operationId, remote, sibling);
      if (!this.sessionIsActive(generation, record.desktopId)) return sibling;
      this.publish(queued.desktop);
      if (remote.sync.catalogId) await this.storage.cacheRemoteFile(record.desktopId, remote.sync.catalogId, original.id, retained.revision, await sha256Blob(retained.content), retained.content);
      await this.publishOutbox();
      await this.updateStatusFromOutbox();
      this.requestReplay();
      return sibling;
    });
  }

  retryBlockedOutboxRecord(operationId: string) {
    if (this.frontendOnly) throw new Error("Local-only desktops do not have a synchronization queue.");
    const generation = this.generation;
    const desktopId = this.desktopId;
    const runningAtCall = this.running;
    const assertInitiatingSession = () => { if (runningAtCall) this.assertActiveSession(generation, desktopId); };
    return this.queueSync(async () => {
      assertInitiatingSession();
      const records = await this.storage.readOutbox();
      assertInitiatingSession();
      const index = records.findIndex((record) => record.operationId === operationId);
      if (index < 0) throw new Error("That queued change no longer exists.");
      if (records[index].status !== "blocked") throw new Error("Only blocked changes can be retried manually.");
      try {
        for (const [recordIndex, queued] of records.entries()) {
          let record = queued;
          if (record.status === "blocked" && recordIndex < index) throw new Error("Resolve the earlier blocked change first.");
          if (recordIndex >= index && isRevisionConflictRecord(record)) {
            const remote = toSnapshot(await this.fetchDesktop(record.desktopId));
            assertInitiatingSession();
            const operation = forceRebaseOutboxOperation(record.operation, currentConflict(record.conflictDetails!, remote), remote);
            if (!operation) throw new Error("This conflict cannot be safely rebased. Discard the local change and use the server version.");
            record = await this.storage.rebaseBlockedMutation(record.operationId, operation);
          }
          await this.replayRecord(record, generation, recordIndex >= index && queued.status === "blocked");
        }
        const remaining = [...await this.storage.readOutbox()];
        assertInitiatingSession();
        this.setStatus(this.activeDesktopIsBlocked(remaining) ? "blocked" : "online");
        return remaining;
      } catch (error) {
        if (error instanceof SyncRequestError) {
          if (error.permanent) await this.updateStatusFromOutbox();
          else this.setStatus("offline");
        }
        throw error;
      }
    });
  }

  discardBlockedOutboxRecord(operationId: string) {
    if (this.frontendOnly) throw new Error("Local-only desktops do not have a synchronization queue.");
    const generation = this.generation;
    const activeDesktopId = this.desktopId;
    const runningAtCall = this.running;
    const assertInitiatingSession = () => { if (runningAtCall) this.assertActiveSession(generation, activeDesktopId); };
    return this.queueSync(async () => {
      assertInitiatingSession();
      const records = await this.storage.readOutbox();
      assertInitiatingSession();
      const record = records.find((candidate) => candidate.operationId === operationId);
      if (!record) throw new Error("That queued change no longer exists.");
      if (record.status !== "blocked") throw new Error("Only blocked changes can be discarded.");
      const removesProjection = isAccessRevocationRecord(record) || record.operation.kind === "create-desktop";
      if (!removesProjection && records[0]?.operationId !== operationId) throw new Error("Resolve earlier queued changes before discarding this change.");

      if (removesProjection) {
        const desktopId = record.operation.kind === "create-desktop" ? record.operation.desktop.id : record.desktopId;
        const discarded = await this.storage.discardDesktopProjection(desktopId, operationId);
        assertInitiatingSession();
        for (const affectedDesktopId of discarded.affectedDesktopIds) {
          if (affectedDesktopId !== desktopId) await this.reconcile(undefined, affectedDesktopId, generation);
        }
        assertInitiatingSession();
        await this.publishOutbox();
        if (runningAtCall) await this.refreshCatalog(generation, activeDesktopId);
        else await this.refreshCatalog();
        assertInitiatingSession();
        return [...await (runningAtCall ? this.updateStatusFromOutbox(generation, activeDesktopId) : this.updateStatusFromOutbox())];
      }

      const remote = await this.fetchDesktop(record.desktopId);
      assertInitiatingSession();
      const destinationDesktopId = record.operation.kind === "entry-transfer" ? record.operation.destinationDesktopId : null;
      const destination = destinationDesktopId
        ? await this.fetchDesktop(destinationDesktopId)
        : null;
      assertInitiatingSession();
      await this.applyRemoteState(remote, generation, record.operationId, record.desktopId, true, false);
      if (destination && destinationDesktopId) await this.applyRemoteState(destination, generation, undefined, destinationDesktopId, true);
      await this.storage.acknowledgeMutation(record.operationId);
      if (this.offlineInventoryListeners.size > 0 && outboxOperationDesktopIds(record).has(this.desktopId)) await this.refreshOfflineInventory();
      assertInitiatingSession();
      await this.publishOutbox();
      if (record.operation.kind === "create-desktop" || record.operation.kind === "rename-desktop" || record.operation.kind === "delete-desktop") await this.refreshCatalog(generation, activeDesktopId);
      const remaining = [...await this.storage.readOutbox()];
      assertInitiatingSession();
      this.setStatus(this.activeDesktopIsBlocked(remaining) ? "blocked" : "online");
      return remaining;
    });
  }

  async listActivity(query: ActivityQuery = {}) {
    const parsed = parseActivityQuery(query);
    if (this.frontendOnly) return parseActivityPage(await this.storage.listActivity(parsed));
    let response: Response;
    try {
      response = await this.fetchImpl(API_ROUTES.activity(parsed), { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders() });
    } catch {
      this.setStatus("offline");
      throw new Error("Activity is unavailable while the Hiraya server is offline.");
    }
    this.requireAuthentication(response);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error || `Activity could not be loaded (${response.status}).`);
    }
    return parseActivityPage(await response.json());
  }

  private async protectedRead(input: RequestInfo | URL) {
    let response: Response;
    try {
      response = await this.fetchImpl(input, { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders(), signal: this.syncAbort?.signal });
    } catch {
      throw new VirtualFileUnavailableError("Protected files are unavailable while the Hiraya server is offline.");
    }
    this.requireAuthentication(response);
    if (!response.ok) throw new Error(response.status === 404 ? "That protected file no longer exists." : `The protected file could not be loaded (${response.status}).`);
    return response;
  }

  async listSystemEntries(desktopId: string): Promise<SystemEntriesDocument> {
    assertValidId(desktopId, "System files require a valid desktop ID.");
    if (this.frontendOnly) {
      if (desktopId !== this.desktopId) throw new Error("System files are unavailable for an inactive local desktop.");
      return localSystemEntries(this.current(), desktopId);
    }
    const value = await (await this.protectedRead(API_ROUTES.desktopSystemEntries(desktopId))).json();
    const authority = this.assertAuthority(value, "The server system entries response");
    return parseSystemEntriesDocument(value, desktopId, authority.catalogId);
  }

  private async downloadProtectedFile(entry: Pick<SystemEntry, "id" | "name" | "mimeType" | "size" | "contentRevision">, endpoint: string, expected: ContentAccessExpectations) {
    const descriptor = parseContentAccessDescriptor(await (await this.protectedRead(endpoint)).json(), entry.id, entry.contentRevision, entry.size, this.directBlobOrigin, expected);
    let response: Response;
    try {
      response = await this.fetchImpl(descriptor.access.url, { method: descriptor.access.method, headers: descriptor.access.headers, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: this.syncAbort?.signal });
    } catch {
      throw new VirtualFileUnavailableError("The protected file could not be downloaded. Reconnect and try again.");
    }
    if (!response.ok) throw new VirtualFileUnavailableError(`The protected file could not be downloaded (${response.status}). Reconnect and try again.`);
    const downloaded = await responseBlobWithProgress(response, descriptor.size, () => undefined);
    if (downloaded.blob.size !== descriptor.size || downloaded.sha256 !== descriptor.sha256) throw new Error("The protected file failed integrity verification.");
    return new File([downloaded.blob], entry.name, { type: entry.mimeType });
  }

  async readSystemFile(desktopId: string, catalogId: string, entry: SystemEntry) {
    assertValidId(desktopId, "System files require a valid desktop ID.");
    if (this.frontendOnly) {
      if (desktopId !== this.desktopId) throw new Error("System files are unavailable for an inactive local desktop.");
      const content = new Blob([JSON.stringify(localSystemContent(this.current(), entry.systemRole, entry.systemKey))], { type: entry.mimeType });
      if (content.size !== entry.size || await sha256Blob(content) !== entry.sha256) throw new Error("That protected system resource changed. Reopen the .hiraya folder and try again.");
      return new File([content], entry.name, { type: entry.mimeType });
    }
    this.assertAuthority({ schemaVersion: 2, catalogId }, "The selected system entry");
    const value = await (await this.protectedRead(API_ROUTES.desktopSystemEntry(desktopId, entry.id))).json();
    this.assertAuthority(value, "The server system entry response");
    const current = parseSystemEntryDocument(value, desktopId, entry.id, catalogId);
    if (current.contentRevision !== entry.contentRevision || current.size !== entry.size || current.sha256 !== entry.sha256 || current.systemRole !== entry.systemRole || current.systemKey !== entry.systemKey) throw new VirtualFileChangedError();
    return this.downloadProtectedFile(current, API_ROUTES.desktopContent(desktopId, current.id, current.contentRevision), { catalogId, desktopId, sha256: current.sha256, systemRole: current.systemRole, systemKey: current.systemKey });
  }

  async readTrashFile(desktopId: string, catalogId: string, trashRootId: string, entry: TrashEntry) {
    assertValidId(desktopId, "Trash files require a valid desktop ID.");
    assertValidId(trashRootId, "Trash files require a valid Trash root ID.");
    if (entry.kind !== "file") throw new Error("Only files have content.");
    if (this.frontendOnly) throw new TrashUnavailableError();
    this.assertAuthority({ schemaVersion: 2, catalogId }, "The selected Trash entry");
    return this.downloadProtectedFile(entry, API_ROUTES.desktopTrashContent(desktopId, entry.id, entry.contentRevision, trashRootId), { catalogId, desktopId, trashRootId, sha256: entry.sha256 });
  }

  private async trashRequest(input: RequestInfo | URL, init?: RequestInit) {
    if (this.frontendOnly) throw new TrashUnavailableError();
    let response: Response;
    try {
      response = await this.fetchImpl(input, { cache: "no-store", credentials: "same-origin", ...init, headers: authenticatedHeaders(init?.headers) });
    } catch {
      this.setStatus("offline");
      throw new TrashUnavailableError("Trash is unavailable while the Hiraya server is offline.");
    }
    this.requireAuthentication(response);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error || `The Trash request failed (${response.status}).`);
    }
    return response.json() as Promise<unknown>;
  }

  async listTrash(desktopId: string): Promise<TrashDocument> {
    assertValidId(desktopId, "Trash requires a valid desktop ID.");
    const value = await this.trashRequest(API_ROUTES.desktopTrash(desktopId));
    const authority = this.assertAuthority(value, "The server Trash response");
    return parseTrashDocument(value, desktopId, authority.catalogId);
  }

  async restoreTrash(desktopId: string, entryId: string, destination: "original" | "root", baseRevision: number): Promise<TrashRestoreResult> {
    assertValidId(desktopId, "Trash requires a valid desktop ID.");
    assertValidId(entryId, "Trash restore requires a valid entry ID.");
    if (destination !== "original" && destination !== "root") throw new Error("Trash restore requires an original or root destination.");
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new Error("Trash restore requires a valid base revision.");
    const response = await this.trashRequest(API_ROUTES.desktopEntryTransactions(desktopId), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hiraya-Client-ID": this.directMutationClientId,
        "X-Hiraya-Operation-ID": crypto.randomUUID(),
      },
      body: JSON.stringify({ operations: [{ type: "entry.restore", entryId, baseRevision, ...(destination === "root" ? { parentId: null } : {}) }] }),
    });
    const catalogRevision = isRecord(response) && Number.isSafeInteger(response.catalogRevision) ? Number(response.catalogRevision) : this.catalogRevision;
    if (!this.running) {
      this.catalogRevision = Math.max(this.catalogRevision, catalogRevision);
      return { catalogRevision, entries: [] };
    }
    let reconciled: DesktopStateSnapshot;
    try {
      reconciled = await this.reconcile(undefined, desktopId);
    } catch (error) {
      if (this.running || !(error instanceof DOMException) || error.name !== "AbortError") throw error;
      this.catalogRevision = Math.max(this.catalogRevision, catalogRevision);
      return { catalogRevision, entries: [] };
    }
    const root = reconciled?.entries.find((entry) => entry.id === entryId);
    if (!root) throw new Error("The restored item is missing from the desktop projection.");
    const restoredIds = new Set([entryId]);
    for (let changed = true; changed;) {
      changed = false;
      for (const entry of reconciled.entries) if (entry.parentId && restoredIds.has(entry.parentId) && !restoredIds.has(entry.id)) { restoredIds.add(entry.id); changed = true; }
    }
    const result = parseTrashRestoreResult({ catalogRevision, entries: reconciled.entries.filter((entry) => restoredIds.has(entry.id)).map((entry) => ({ ...entry, revision: reconciled.sync.entryRevisions[entry.id], contentRevision: reconciled.sync.contentRevisions[entry.id] ?? 0 })) }, entryId, destination);
    this.catalogRevision = Math.max(this.catalogRevision, catalogRevision);
    return result;
  }

  async permanentlyDeleteTrash(desktopId: string, entryId: string, baseRevision: number): Promise<TrashDeleteResult> {
    assertValidId(desktopId, "Trash requires a valid desktop ID.");
    assertValidId(entryId, "Permanent deletion requires a valid entry ID.");
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new Error("Permanent deletion requires a valid base revision.");
    const response = await this.trashRequest(API_ROUTES.desktopEntryTransactions(desktopId), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hiraya-Client-ID": this.directMutationClientId,
        "X-Hiraya-Operation-ID": crypto.randomUUID(),
      },
      body: JSON.stringify({ operations: [{ type: "entry.purge", entryId, baseRevision }] }),
    });
    const result = parseTrashDeleteResult({ catalogRevision: isRecord(response) && Number.isSafeInteger(response.catalogRevision) ? Number(response.catalogRevision) : this.catalogRevision, deletedIds: [entryId] });
    this.catalogRevision = Math.max(this.catalogRevision, result.catalogRevision);
    return result;
  }
}

const defaultEngine = new SyncEngine({ frontendOnly: import.meta.env.HIRAYA_FRONTEND_ONLY === "true" });

export function configureSyncAuthority(catalogId: string | null, directBlobOrigin?: string, thumbnails = false) { defaultEngine.setExpectedAuthority(catalogId, directBlobOrigin, thumbnails); }

export const initializeDesktop = defaultEngine.start.bind(defaultEngine);
export const stopDesktopSync = defaultEngine.stop.bind(defaultEngine);
export const subscribeToSync = defaultEngine.subscribe.bind(defaultEngine);
export const createTextFile = defaultEngine.createTextFile.bind(defaultEngine);
export const createFile = defaultEngine.createFile.bind(defaultEngine);
export const createFolder = defaultEngine.createFolder.bind(defaultEngine);
export const importFiles = defaultEngine.importFiles.bind(defaultEngine);
export const createEntries = defaultEngine.createEntries.bind(defaultEngine);
export const renameEntry = defaultEngine.renameEntry.bind(defaultEngine);
export const deleteEntry = defaultEngine.deleteEntry.bind(defaultEngine);
export const deleteEntries = defaultEngine.deleteEntries.bind(defaultEngine);
export const moveEntry = defaultEngine.moveEntry.bind(defaultEngine);
export const moveEntries = defaultEngine.moveEntries.bind(defaultEngine);
export const transferEntries = defaultEngine.transferEntries.bind(defaultEngine);
export const createDesktop = defaultEngine.createDesktop.bind(defaultEngine);
export const listDesktops = defaultEngine.listDesktops.bind(defaultEngine);
export const refreshDesktopCatalog = defaultEngine.refreshCatalog.bind(defaultEngine);
export const subscribeToDesktopCatalog = defaultEngine.subscribeDesktopCatalog.bind(defaultEngine);
export const updateDesktopPreferences = defaultEngine.updateDesktopPreferences.bind(defaultEngine);
export const renameDesktop = defaultEngine.renameDesktop.bind(defaultEngine);
export const deleteDesktop = defaultEngine.deleteDesktop.bind(defaultEngine);
export const captureEntries = defaultEngine.captureEntries.bind(defaultEngine);
export const pasteEntries = defaultEngine.pasteEntries.bind(defaultEngine);
export const updateRootEntryPositions = defaultEngine.updateRootEntryPositions.bind(defaultEngine);
export const updateEntryPosition = defaultEngine.updateEntryPosition.bind(defaultEngine);
export const saveFile = defaultEngine.saveFile.bind(defaultEngine);
export const saveDesktopLayout = defaultEngine.saveDesktopLayout.bind(defaultEngine);
export const selectTheme = defaultEngine.selectTheme.bind(defaultEngine);
export const saveCustomTheme = defaultEngine.saveCustomTheme.bind(defaultEngine);
export const installThemePackage = defaultEngine.installThemePackage.bind(defaultEngine);
export const deleteCustomTheme = defaultEngine.deleteCustomTheme.bind(defaultEngine);
export const readFile = defaultEngine.readFile.bind(defaultEngine);
export const previewFile = defaultEngine.previewFile.bind(defaultEngine);
export const thumbnailFile = defaultEngine.thumbnailFile.bind(defaultEngine);
export const loadOfflineInventory = defaultEngine.loadOfflineInventory.bind(defaultEngine);
export const subscribeToOfflineStorage = defaultEngine.subscribeOfflineStorage.bind(defaultEngine);
export const subscribeToEntryDownloads = defaultEngine.subscribeEntryDownloads.bind(defaultEngine);
export const subscribeToTransfers = defaultEngine.subscribeTransfers.bind(defaultEngine);
export const dismissFileTransfer = defaultEngine.dismissTransfer.bind(defaultEngine);
export const dismissCompletedFileTransfer = defaultEngine.dismissCompletedTransfer.bind(defaultEngine);
export const estimateOfflineOperation = defaultEngine.estimateOfflineOperation.bind(defaultEngine);
export const downloadOfflineCopies = defaultEngine.downloadOfflineCopies.bind(defaultEngine);
export const releaseOfflineCopies = defaultEngine.releaseOfflineCopies.bind(defaultEngine);
export const getOutboxStatus = defaultEngine.getOutboxStatus.bind(defaultEngine);
export const listOutboxRecords = defaultEngine.listOutboxRecords.bind(defaultEngine);
export const retryBlockedOutboxRecord = defaultEngine.retryBlockedOutboxRecord.bind(defaultEngine);
export const discardBlockedOutboxRecord = defaultEngine.discardBlockedOutboxRecord.bind(defaultEngine);
export const loadContentConflict = defaultEngine.loadContentConflict.bind(defaultEngine);
export const resolveContentConflictKeepLocal = defaultEngine.resolveContentConflictKeepLocal.bind(defaultEngine);
export const resolveContentConflictKeepServer = defaultEngine.resolveContentConflictKeepServer.bind(defaultEngine);
export const resolveContentConflictMerged = defaultEngine.resolveContentConflictMerged.bind(defaultEngine);
export const resolveContentConflictKeepBoth = defaultEngine.resolveContentConflictKeepBoth.bind(defaultEngine);
export const subscribeToOutbox = defaultEngine.subscribeOutbox.bind(defaultEngine);
export const listActivity = defaultEngine.listActivity.bind(defaultEngine);
export const subscribeToActivityChanges = defaultEngine.subscribeActivityChanges.bind(defaultEngine);
export const listSystemEntries = defaultEngine.listSystemEntries.bind(defaultEngine);
export const readSystemFile = defaultEngine.readSystemFile.bind(defaultEngine);
export const readTrashFile = defaultEngine.readTrashFile.bind(defaultEngine);
export const listTrash = defaultEngine.listTrash.bind(defaultEngine);
export const restoreTrash = defaultEngine.restoreTrash.bind(defaultEngine);
export const permanentlyDeleteTrash = defaultEngine.permanentlyDeleteTrash.bind(defaultEngine);

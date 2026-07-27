import type { SeededManifest } from "./seeded-manifest";
import { assertUniqueName, namesMatch, validateEntryName } from "./entry-validation";
import { API_ROUTES } from "./api-routes";
import { assertValidId, parseContentAccessDescriptor, parseEntries, parseLayout, parsePosition, parseRemoteDesktopState, parseRootEntryPositionUpdates, parseTrashDeleteResult, parseTrashDocument, parseTrashRestoreResult, type RemoteDesktopState, type RemoteEntry, type TrashDeleteResult, type TrashDocument, type TrashRestoreResult } from "./contracts";
import type { DesktopEntry, DesktopIdentity, DesktopLayout, RootEntryPositionUpdate, EditorSettings, EntryPosition, FileEntry, FolderEntry } from "../types";
import type { OutboxOperation, OutboxRecord } from "./outbox";
import { ACCESS_REVOKED_ERROR, desktopPendingOperationProtection, isAccessRevocationRecord, isRevisionConflictRecord, outboxCausalKeys, outboxDesktopRetentionIds, outboxOperationDesktopIds, rebaseOutboxOperationForConflict, type RevisionConflictDetails } from "./outbox";
import { parseCustomTheme, parseThemeState } from "./themes";
import type { CustomTheme } from "../domain/theme";
import type { ClipboardEntrySnapshot } from "./clipboard";
import { parseActivityPage, parseActivityQuery, type ActivityQuery } from "./activity";
import { parseDesktopCatalog, type CatalogQuota } from "./desktop-catalog";
import { AuthenticationRequiredError, redirectToLogin } from "./auth";
import { mapWithConcurrency, sha256Blob } from "./blob-transfer";
import { buildOfflineAvailability, dedupeOfflineRoots, offlineFilesUnderRoots, type OfflineStorageInventory } from "./offline-availability";
import type { DesktopStateSnapshot } from "../domain/desktop-state";
import { ContentRevisionConflictError, type SaveFileOptions } from "../domain/files";
import { browserSyncStorage, type SyncStorage } from "../platform/sync/storage-port";
import { SyncHttpClient, SyncRequestError } from "../platform/sync/http-client";
import { SyncConnectivity } from "../platform/sync/connectivity";
import { sendOutboxOperation } from "../platform/sync/outbox-transport";
import { AuthorityValidationError, parseAuthorityIdentity, UpgradeRequiredError } from "./wire-authority";

type OutboxOperationInput = OutboxOperation extends infer Operation
  ? Operation extends OutboxOperation ? Omit<Operation, "schemaVersion"> : never
  : never;

export type SyncStatus = "connecting" | "online" | "offline" | "blocked" | "upgrade-required" | "error" | "local";
export type DesktopRegistry = { schemaVersion: 1; catalogId: string | null; catalogRevision: number; desktops: DesktopIdentity[]; activeDesktopId: string | null; quota: CatalogQuota | null };
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

function localEntry(entry: RemoteEntry): DesktopEntry {
  const { revision: _revision, contentRevision: _contentRevision, ...local } = entry;
  void _revision;
  void _contentRevision;
  return local;
}

function toSnapshot(remote: RemoteDesktopState): DesktopStateSnapshot {
  const entryRevisions: Record<string, number> = {};
  const contentRevisions: Record<string, number> = {};
  const themeRevisions: Record<string, number> = {};
  for (const entry of remote.entries) {
    entryRevisions[entry.id] = entry.revision;
    if (entry.kind === "file") contentRevisions[entry.id] = entry.contentRevision;
  }
  for (const theme of remote.appearance.customThemes) themeRevisions[theme.id] = theme.revision;
  return {
    entries: remote.entries.map(localEntry),
    layout: remote.layout,
    editorSettings: remote.editorSettings,
    appearance: {
      selectedThemeId: remote.appearance.selectedThemeId,
      customThemes: remote.appearance.customThemes.map(({ id, name, definition }) => ({ id, name, definition })),
    },
    sync: {
      catalogId: remote.catalogId,
      catalogRevision: remote.catalogRevision,
      entryRevisions,
      contentRevisions,
      layoutRevision: remote.layoutRevision,
      settingsRevision: remote.settingsRevision,
      themeSelectionRevision: remote.appearance.selectionRevision,
      themeRevisions,
    },
  };
}

export class SyncEngine {
  private readonly frontendOnly: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly storage: SyncStorage;
  private readonly onUnauthorized: () => void;
  private expectedCatalogId: string | null;
  private readonly http: SyncHttpClient;
  private readonly connectivity: SyncConnectivity;
  private readonly setTimeoutImpl: typeof globalThis.setTimeout;
  private readonly clearTimeoutImpl: typeof globalThis.clearTimeout;
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
  private offlineInventoryLoad: { desktopId: string; generation: number; promise: Promise<OfflineStorageInventory> } | null = null;
  private offlineRefresh: { desktopId: string; generation: number; promise: Promise<OfflineStorageInventory> } | null = null;

  constructor(options: SyncEngineOptions = {}) {
    this.frontendOnly = options.frontendOnly ?? false;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.storage = options.storage ?? browserSyncStorage;
    this.onUnauthorized = options.onUnauthorized ?? redirectToLogin;
    this.expectedCatalogId = options.expectedCatalogId ?? null;
    this.setTimeoutImpl = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutImpl = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
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
    this.offlineInventoryLoad = null;
    this.offlineRefresh = null;
    await this.work;
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

  setExpectedCatalogId(catalogId: string | null) {
    if (this.running) throw new Error("The synchronization authority cannot change while running.");
    this.expectedCatalogId = catalogId;
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
      return await this.requestDesktop(API_ROUTES.desktop(desktopId), { cache: "no-store" });
    } catch (error) {
      if (error instanceof SyncRequestError && error.status === 404 && desktopId === this.desktopId) await this.refreshCatalog();
      throw error;
    }
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
    if (desktopId === this.desktopId && this.status !== "offline") void this.refreshPinnedContent().catch(() => undefined);
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
    this.assertAuthority({ schemaVersion: 1, catalogId }, "The server catalog");
    await this.storage.bindOutboxCatalog(catalogId);
    this.catalogId = catalogId;
    await this.publishOutbox();
  }

  private async sendOutboxOperation(record: OutboxRecord) {
    return sendOutboxOperation(record, {
      fetch: this.fetchImpl,
      signal: this.syncAbort?.signal,
      requestJson: (input, init) => this.requestJson(input, init),
      requireAuthentication: (response) => this.requireAuthentication(response),
      readPendingContent: (operationId, entryId) => this.storage.readPendingContent(operationId, entryId),
    });
  }

  private async replayRecord(record: OutboxRecord, generation: number, retryBlocked = false) {
    this.assertActive(generation);
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
      const response = await this.sendOutboxOperation(record);
      const acknowledgedRevision = typeof response === "object" && response !== null && "catalogRevision" in response && Number.isSafeInteger(response.catalogRevision) && Number(response.catalogRevision) > 0 ? Number(response.catalogRevision) : undefined;
      if (record.operation.kind === "create-desktop") {
        await this.reconcile(record.operationId, record.operation.desktop.id, generation, acknowledgedRevision);
      } else if (record.operation.kind === "entry-transfer") {
        await this.reconcile(record.operationId, record.desktopId, generation, acknowledgedRevision);
        await this.reconcile(undefined, record.operation.destinationDesktopId, generation);
      } else if (record.operation.kind === "delete-desktop") {
        await this.reconcile(record.operationId, record.desktopId, generation, acknowledgedRevision);
      } else {
        await this.reconcile(record.operationId, record.desktopId, generation, acknowledgedRevision);
      }
      await this.storage.acknowledgeMutation(record.operationId);
      await this.publishOutbox();
    } catch (error) {
      if (error instanceof SyncRequestError && error.permanent) {
        await this.storage.blockMutation(record.operationId, error.status === 403 ? ACCESS_REVOKED_ERROR : error.message, error.status === 403 ? "forbidden" : error.code, error.status === 403 ? null : error.details as RevisionConflictDetails | null);
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
      const catalog = parseDesktopCatalog(await this.requestJson(API_ROUTES.catalog, { cache: "no-store" }));
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
      const response = this.requireAuthentication(await this.fetchImpl(this.healthRoute(), { cache: "no-store", credentials: "same-origin", signal: controller.signal }));
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

  private async mutate<T>(operation: OutboxOperationInput, select: (next: DesktopStateSnapshot) => T, contents?: Map<string, Blob>, validate?: () => void) {
    return this.queue(async () => {
      validate?.();
      const queued = await this.storage.enqueueMutation({ ...operation, schemaVersion: 1 } as OutboxOperation, contents);
      this.publish(queued.desktop);
      await this.publishOutbox();
      this.requestReplay();
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
    return this.mutate({ kind: "create", entries: [entry] }, (next) => next.entries.find((item) => item.id === entry.id) as FileEntry, new Map([[entry.id, new Blob([], { type: entry.mimeType })]]));
  }

  createFile(nameValue: string, parentId: string | null, position: EntryPosition, content: Blob, mimeType?: string) {
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
    return this.mutate({ kind: "create", entries: [entry] }, (next) => next.entries.find((item) => item.id === entry.id) as FileEntry, new Map([[entry.id, content.slice(0, content.size, entry.mimeType)]]));
  }

  createFolder(nameValue: string, parentId: string | null, position: EntryPosition) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.createFolder(nameValue, parentId, position));
    const parsedPosition = parsePosition(position);
    const name = validateEntryName(nameValue);
    this.assertParent(parentId);
    assertUniqueName(this.current().entries, name, parentId);
    const now = Date.now();
    const entry: FolderEntry = { kind: "folder", id: crypto.randomUUID(), name, parentId, createdAt: now, modifiedAt: now, position: parsedPosition };
    return this.mutate({ kind: "create", entries: [entry] }, (next) => next.entries.find((item) => item.id === entry.id) as FolderEntry);
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
    return this.mutate({ kind: "create", entries }, (next) => entries.map((entry) => next.entries.find((item) => item.id === entry.id) as FileEntry), new Map(entries.map((entry, index) => [entry.id, files[index]])));
  }

  createEntries(entriesValue: DesktopEntry[], contentsValue: Map<string, Blob>) {
    const entries = parseEntries([...this.current().entries, ...entriesValue]).slice(this.current().entries.length) as DesktopEntry[];
    const files = entries.filter((entry): entry is FileEntry => entry.kind === "file");
    if (contentsValue.size !== files.length || files.some((entry) => !(contentsValue.get(entry.id) instanceof Blob) || contentsValue.get(entry.id)!.size !== entry.size)) {
      throw new Error("Imported file content is incomplete.");
    }
    const contents = new Map(files.map((entry) => [entry.id, contentsValue.get(entry.id)!.slice(0, entry.size, entry.mimeType)]));
    if (this.frontendOnly) return this.localMutation(() => this.storage.createEntries(entries, contents));
    return this.mutate({ kind: "create", entries }, (next) => entries.map((entry) => next.entries.find((item) => item.id === entry.id)!), contents);
  }

  renameEntry(id: string, nameValue: string) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.renameEntry(id, nameValue));
    const existing = this.current().entries.find((entry) => entry.id === id);
    if (!existing) throw new Error("That entry no longer exists.");
    const name = validateEntryName(nameValue);
    assertUniqueName(this.current().entries, name, existing.parentId, id);
    return this.mutate({ kind: "patch-entry", entryId: id, baseRevision: this.current().sync.entryRevisions[id] ?? 0, changes: { name, modifiedAt: Date.now() } }, (next) => next.entries.find((item) => item.id === id) as DesktopEntry);
  }

  deleteEntry(id: string) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.deleteEntry(id));
    const before = this.current().entries;
    if (!before.some((entry) => entry.id === id)) throw new Error("That entry no longer exists.");
    return this.mutate({ kind: "delete", entryId: id, baseRevision: this.current().sync.entryRevisions[id] ?? 0 }, (next) => before.filter((entry) => !next.entries.some((item) => item.id === entry.id)));
  }

  deleteEntries(ids: string[]) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.deleteEntries(ids));
    const unique = [...new Set(ids)];
    const before = this.current().entries;
    if (!unique.length || unique.length !== ids.length || unique.some((id) => !before.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
    return this.mutate({ kind: "delete-entries", entryIds: unique, baseRevisions: Object.fromEntries(unique.map((id) => [id, this.current().sync.entryRevisions[id] ?? 0])) }, (next) => before.filter((entry) => !next.entries.some((item) => item.id === entry.id)));
  }

  moveEntry(id: string, parentId: string | null, position: EntryPosition) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.moveEntry(id, parentId, position));
    const parsedPosition = parsePosition(position);
    const existing = this.current().entries.find((entry) => entry.id === id);
    if (!existing) throw new Error("That entry no longer exists.");
    this.assertParent(parentId);
    return this.mutate({ kind: "patch-entry", entryId: id, baseRevision: this.current().sync.entryRevisions[id] ?? 0, changes: { parentId, position: parsedPosition, modifiedAt: Date.now() } }, (next) => next.entries.find((item) => item.id === id) as DesktopEntry);
  }

  moveEntries(ids: string[], parentId: string | null) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.moveEntries(ids, parentId));
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length !== ids.length || unique.some((id) => !this.current().entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
    this.assertParent(parentId);
    return this.mutate({ kind: "move-entries", entryIds: unique, baseRevisions: Object.fromEntries(unique.map((id) => [id, this.current().sync.entryRevisions[id] ?? 0])), parentId, modifiedAt: Date.now() }, (next) => unique.map((id) => next.entries.find((entry) => entry.id === id) as DesktopEntry));
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

  async listDesktops(seeded: SeededManifest | null = null) {
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
      return { schemaVersion: 1 as const, catalogId: null, catalogRevision: 0, quota: null, ...local };
    }
    try {
      const catalog = parseDesktopCatalog(await this.requestJson(API_ROUTES.catalog, { cache: "no-store" }));
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
        schemaVersion: 1 as const,
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
      return { schemaVersion: 1 as const, catalogId: null, catalogRevision: 0, quota, ...local };
    }
  }

  async refreshCatalog(generation?: number, desktopId?: string) {
    const catalog = await this.listDesktops();
    if (generation !== undefined && desktopId !== undefined) this.assertActiveSession(generation, desktopId);
    return this.publishCatalog(catalog);
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
    const existing = this.current().entries.find((entry) => entry.id === id);
    if (!existing) throw new Error("That entry no longer exists.");
    return this.mutate({ kind: "patch-entry", entryId: id, baseRevision: this.current().sync.entryRevisions[id] ?? 0, changes: { position: parsedPosition } }, (next) => next.entries.find((item) => item.id === id) as DesktopEntry);
  }

  updateRootEntryPositions(positionValues: RootEntryPositionUpdate[]) {
    const positions = parseRootEntryPositionUpdates(positionValues, this.current().entries);
    if (this.frontendOnly) return this.localMutation(() => this.storage.updateRootEntryPositions(positions));
    return this.mutate({ kind: "root-entry-positions", positions, baseRevisions: Object.fromEntries(positions.map(({ entryId }) => [entryId, this.current().sync.entryRevisions[entryId] ?? 0])) }, (next) => positions.map(({ entryId }) => next.entries.find((entry) => entry.id === entryId) as DesktopEntry));
  }

  saveFile(id: string, content: Blob, options: SaveFileOptions = {}) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveFile(id, content, options));
    const existing = this.current().entries.find((entry): entry is FileEntry => entry.id === id && entry.kind === "file");
    if (!existing) throw new Error("That file no longer exists.");
    const entry = { ...existing, mimeType: options.mimeType ?? existing.mimeType, size: content.size, modifiedAt: Date.now() };
    return this.mutate(
      { kind: "save-content", entryId: id, mimeType: entry.mimeType, size: entry.size, modifiedAt: entry.modifiedAt, baseContentRevision: this.current().sync.contentRevisions[id] ?? 0 },
      (next) => next.entries.find((item) => item.id === id) as FileEntry,
      new Map([[id, content.slice(0, content.size, entry.mimeType)]]),
      () => {
        const actualRevision = this.current().sync.contentRevisions[id] ?? 0;
        if (options.expectedContentRevision !== undefined && options.expectedContentRevision !== actualRevision) {
          throw new ContentRevisionConflictError(options.expectedContentRevision, actualRevision);
        }
      },
    );
  }

  saveTextFile(id: string, content: string) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveTextFile(id, content));
    const existing = this.current().entries.find((entry): entry is FileEntry => entry.id === id && entry.kind === "file");
    if (!existing) throw new Error("That file no longer exists.");
    return this.saveFile(id, new Blob([content], { type: existing.mimeType }));
  }

  saveDesktopLayout(layout: DesktopLayout) {
    const parsed = parseLayout(layout);
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveDesktopLayout(parsed), false);
    return this.mutate({ kind: "layout", layout: parsed, baseRevision: this.current().sync.layoutRevision }, () => undefined);
  }

  saveEditorSettings(settings: EditorSettings) {
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveEditorSettings(settings), false);
    return this.mutate({ kind: "editor-settings", settings, baseRevision: this.current().sync.settingsRevision }, () => undefined);
  }

  selectTheme(themeId: string) {
    parseThemeState({ ...this.current().appearance, selectedThemeId: themeId });
    if (this.frontendOnly) return this.localMutation(() => this.storage.selectTheme(themeId));
    return this.mutate({ kind: "select-theme", themeId, baseRevision: this.current().sync.themeSelectionRevision }, (next) => next.appearance);
  }

  saveCustomTheme(value: CustomTheme) {
    const theme = parseCustomTheme(value);
    const exists = this.current().appearance.customThemes.some((item) => item.id === theme.id);
    parseThemeState({
      ...this.current().appearance,
      customThemes: exists
        ? this.current().appearance.customThemes.map((item) => item.id === theme.id ? theme : item)
        : [...this.current().appearance.customThemes, theme],
    });
    if (this.frontendOnly) return this.localMutation(() => this.storage.saveCustomTheme(theme));
    return this.mutate({ kind: "upsert-theme", theme, baseRevision: this.current().sync.themeRevisions[theme.id] ?? 0 }, (next) => next.appearance.customThemes.find((item) => item.id === theme.id)!);
  }

  deleteCustomTheme(themeId: string) {
    if (!this.current().appearance.customThemes.some((theme) => theme.id === themeId)) throw new Error("That custom theme no longer exists.");
    if (this.frontendOnly) return this.localMutation(() => this.storage.deleteCustomTheme(themeId));
    return this.mutate({ kind: "delete-theme", themeId, baseRevision: this.current().sync.themeRevisions[themeId] ?? 0 }, (next) => next.appearance);
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
    if (!Number.isSafeInteger(contentRevision)) throw new Error("That file has invalid synchronization metadata.");
    const cached = await this.storage.readCachedFile(desktopId, catalogId, id, contentRevision);
    if (cached) return cached;
    if (this.status === "offline") throw new VirtualFileUnavailableError();

    const key = `${desktopId}\n${catalogId}\n${id}\n${contentRevision}`;
    const existing = this.contentLoads.get(key);
    if (existing) return existing;
    const loading = (async () => {
      let descriptorResponse: Response;
      try {
        descriptorResponse = await this.fetchImpl(API_ROUTES.desktopContentAccess(desktopId, id, contentRevision), { cache: "no-store", credentials: "same-origin", signal });
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
        descriptor = parseContentAccessDescriptor(await descriptorResponse.json(), id, contentRevision, entry.size);
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
      const content = await response.blob();
      if (content.size !== descriptor.size || content.size !== entry.size) throw new Error(`The server contents of “${entry.name}” have an unexpected size.`);
      if (await sha256Blob(content) !== descriptor.sha256) throw new Error(`The server contents of “${entry.name}” failed integrity verification.`);
      this.assertActive(generation);
      const stored = await this.storage.cacheRemoteFile(desktopId, catalogId, id, contentRevision, descriptor.sha256, content);
      this.assertActive(generation);
      if (!stored) throw new VirtualFileChangedError();
      return stored;
    })();
    this.contentLoads.set(key, loading);
    try {
      return await loading;
    } finally {
      if (this.contentLoads.get(key) === loading) this.contentLoads.delete(key);
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

  async setOfflinePinIntent(rootIds: readonly string[], pinned: boolean) {
    const roots = pinned ? dedupeOfflineRoots(this.current().entries, rootIds) : [...new Set(rootIds)];
    if (!pinned && (roots.length !== rootIds.length || roots.some((id) => !this.current().entries.some((entry) => entry.id === id)))) throw new Error("An offline selection contains an entry that no longer exists.");
    await this.storage.setOfflinePins(this.desktopId, roots, pinned);
    const inventory = await this.loadOfflineInventory();
    return inventory;
  }

  refreshPinnedContent(_rootIds?: readonly string[]) {
    void _rootIds;
    const desktopId = this.desktopId;
    const generation = this.generation;
    const existing = this.offlineRefresh;
    if (existing?.desktopId === desktopId && existing.generation === generation) return existing.promise;
    const promise = this.refreshPinnedContentInternal(desktopId, generation).finally(() => { if (this.offlineRefresh?.promise === promise) this.offlineRefresh = null; });
    this.offlineRefresh = { desktopId, generation, promise };
    return promise;
  }

  private async refreshPinnedContentInternal(desktopId: string, generation: number) {
    if (this.frontendOnly || this.status === "offline") return this.loadOfflineInventory();
    const inventory = await this.loadOfflineInventory();
    if (this.desktopId !== desktopId || this.generation !== generation) return inventory;
    const model = buildOfflineAvailability(this.current().entries, inventory);
    const files = this.current().entries.filter((entry): entry is FileEntry => entry.kind === "file" && model.entries[entry.id]?.pinned);
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
    return this.loadOfflineInventory();
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
        for (const [recordIndex, queued] of records.slice(0, index + 1).entries()) {
          let record = queued;
          if (record.status === "blocked" && recordIndex !== index) throw new Error("Resolve the earlier blocked change first.");
          if (recordIndex === index && isRevisionConflictRecord(record)) {
            const operation = rebaseOutboxOperationForConflict(record.operation, record.conflictDetails!);
            if (!operation) throw new Error("This conflict cannot be safely rebased. Discard the local change and use the server version.");
            record = await this.storage.rebaseBlockedMutation(record.operationId, operation);
          }
          await this.replayRecord(record, generation, recordIndex === index);
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
      response = await this.fetchImpl(API_ROUTES.activity(parsed), { cache: "no-store", credentials: "same-origin" });
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

  private async trashRequest(input: RequestInfo | URL, init?: RequestInit) {
    if (this.frontendOnly) throw new TrashUnavailableError();
    let response: Response;
    try {
      response = await this.fetchImpl(input, { cache: "no-store", credentials: "same-origin", ...init });
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
    return parseTrashDocument(await this.trashRequest(API_ROUTES.desktopTrash(desktopId)), desktopId);
  }

  async restoreTrash(desktopId: string, entryId: string, destination: "original" | "root"): Promise<TrashRestoreResult> {
    assertValidId(desktopId, "Trash requires a valid desktop ID.");
    assertValidId(entryId, "Trash restore requires a valid entry ID.");
    if (destination !== "original" && destination !== "root") throw new Error("Trash restore requires an original or root destination.");
    const result = parseTrashRestoreResult(await this.trashRequest(API_ROUTES.desktopTrashRestore(desktopId, entryId), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hiraya-Client-ID": this.directMutationClientId,
        "X-Hiraya-Operation-ID": crypto.randomUUID(),
      },
      body: JSON.stringify({ destination }),
    }), entryId, destination);
    if (this.running) await this.reconcile(undefined, desktopId);
    this.catalogRevision = Math.max(this.catalogRevision, result.catalogRevision);
    return result;
  }

  async permanentlyDeleteTrash(desktopId: string, entryId: string): Promise<TrashDeleteResult> {
    assertValidId(desktopId, "Trash requires a valid desktop ID.");
    assertValidId(entryId, "Permanent deletion requires a valid entry ID.");
    const result = parseTrashDeleteResult(await this.trashRequest(API_ROUTES.desktopTrashEntry(desktopId, entryId), {
      method: "DELETE",
      headers: {
        "X-Hiraya-Client-ID": this.directMutationClientId,
        "X-Hiraya-Operation-ID": crypto.randomUUID(),
      },
    }));
    this.catalogRevision = Math.max(this.catalogRevision, result.catalogRevision);
    return result;
  }
}

const defaultEngine = new SyncEngine({ frontendOnly: import.meta.env.HIRAYA_FRONTEND_ONLY === "true" });

export function configureSyncAuthority(catalogId: string | null) { defaultEngine.setExpectedCatalogId(catalogId); }

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
export const subscribeToDesktopCatalog = defaultEngine.subscribeDesktopCatalog.bind(defaultEngine);
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
export const deleteCustomTheme = defaultEngine.deleteCustomTheme.bind(defaultEngine);
export const readFile = defaultEngine.readFile.bind(defaultEngine);
export const loadOfflineInventory = defaultEngine.loadOfflineInventory.bind(defaultEngine);
export const subscribeToOfflineStorage = defaultEngine.subscribeOfflineStorage.bind(defaultEngine);
export const estimateOfflineOperation = defaultEngine.estimateOfflineOperation.bind(defaultEngine);
export const setOfflinePinIntent = defaultEngine.setOfflinePinIntent.bind(defaultEngine);
export const refreshPinnedContent = defaultEngine.refreshPinnedContent.bind(defaultEngine);
export const releaseOfflineCopies = defaultEngine.releaseOfflineCopies.bind(defaultEngine);
export const getOutboxStatus = defaultEngine.getOutboxStatus.bind(defaultEngine);
export const listOutboxRecords = defaultEngine.listOutboxRecords.bind(defaultEngine);
export const retryBlockedOutboxRecord = defaultEngine.retryBlockedOutboxRecord.bind(defaultEngine);
export const discardBlockedOutboxRecord = defaultEngine.discardBlockedOutboxRecord.bind(defaultEngine);
export const subscribeToOutbox = defaultEngine.subscribeOutbox.bind(defaultEngine);
export const listActivity = defaultEngine.listActivity.bind(defaultEngine);
export const subscribeToActivityChanges = defaultEngine.subscribeActivityChanges.bind(defaultEngine);
export const listTrash = defaultEngine.listTrash.bind(defaultEngine);
export const restoreTrash = defaultEngine.restoreTrash.bind(defaultEngine);
export const permanentlyDeleteTrash = defaultEngine.permanentlyDeleteTrash.bind(defaultEngine);

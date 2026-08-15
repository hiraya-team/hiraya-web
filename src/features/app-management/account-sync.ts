import type { AppPackageInspection, JsonValue } from "@hiraya-team/apps-contracts";
import type { InstalledApp } from "../../apps/installed-apps";
import { API_ROUTES } from "../../lib/api-routes";
import {
  accountMutation,
  accountAppsRequestIsPermanent,
  accountAppsRequestIsTransient,
  downloadAccountAppData,
  downloadAccountAppPackage,
  fetchAccountApps,
  parseAppsRevisionEvent,
  prepareAccountPackage,
  uploadPreparedAccountPackage,
  verifyLocalAccountPackage,
  cancelPreparedAccountPackage,
  AccountAppsRequestError,
  type AccountApp,
  type AccountAppsSnapshot,
} from "../../lib/account-apps";
import { projectAccountAppData, type AccountAppDataRestoration, type AccountAppOperation, type AccountAppOutboxRecord, type PersistedAccountApps } from "../../lib/account-app-outbox";
import { uploadBlobDigests } from "../../lib/blob-transfer";
import { readApprovedPackageArchive, releaseApprovedPackageArchive, saveApprovedPackageArchive } from "../../platform/storage/blobs";
import {
  blockAccountAppOperation,
  clearAppStorage,
  discardAccountAppOperation,
  enqueueAccountAppOperation,
  readAccountApps,
  readAppStorage,
  reconcileAccountApps,
  recordAccountAppAttempt,
  removeAppStorage,
  retryAccountAppOperation,
  writeAppStorage,
} from "../../platform/storage/repositories";

export type AccountAppsClientState = Readonly<{ state: PersistedAccountApps; outbox: AccountAppOutboxRecord[]; error: string }>;

const emptyState: PersistedAccountApps = { id: "singleton", baseline: null, projection: { appsRevision: 0, apps: [], handlerHints: {} } };

export class AccountAppsClient {
  private current: AccountAppsClientState = { state: emptyState, outbox: [], error: "" };
  private listener: (state: AccountAppsClientState) => void = () => undefined;
  private events: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private streamOpen = false;
  private active = false;
  private replaying: Promise<void> | null = null;
  private readonly online = () => { this.clearRetry(); void this.replay(); };

  constructor(private readonly directBlobOrigin: string) {}

  snapshot() { return this.current.state.baseline; }

  async start(listener: (state: AccountAppsClientState) => void) {
    this.active = true;
    window.addEventListener("online", this.online);
    this.listener = listener;
    const stored = await readAccountApps();
    this.publish({ ...stored, error: "" });
    await this.refresh().catch((error) => this.fail(error));
    if (!this.active) return;
    try { this.events = typeof EventSource === "undefined" ? null : new EventSource(API_ROUTES.events); } catch { this.events = null; }
    if (this.events) {
      this.events.addEventListener("apps", (event) => {
        try {
          const revision = parseAppsRevisionEvent(JSON.parse((event as MessageEvent<string>).data));
          if (revision !== this.current.state.baseline?.appsRevision) void this.refresh().then(() => this.replay()).catch((error) => this.fail(error));
        } catch { /* Polling below repairs malformed or missed events. */ }
      });
      this.events.onerror = () => { this.streamOpen = false; this.schedulePoll(0); };
      this.events.onopen = () => { this.streamOpen = true; if (this.timer) clearTimeout(this.timer); this.timer = null; };
    } else this.schedulePoll(0);
    void this.replay();
  }

  stop() {
    this.active = false;
    this.events?.close();
    this.events = null;
    this.streamOpen = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearRetry();
    window.removeEventListener("online", this.online);
  }

  private publish(value: AccountAppsClientState) {
    this.current = value;
    this.listener(value);
  }

  private fail(error: unknown) {
    if (!this.active) return;
    this.publish({ ...this.current, error: error instanceof Error ? error.message : "Account apps could not be synchronized." });
  }

  private schedulePoll(delay = 5_000) {
    if (!this.active || this.streamOpen || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh().then(() => this.replay()).catch((error) => this.fail(error)).finally(() => this.schedulePoll());
    }, delay);
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private scheduleRetry(attemptCount: number) {
    if (!this.active || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.replay();
    }, Math.min(60_000, 1_000 * 2 ** Math.min(attemptCount, 6)));
  }

  async refresh() {
    const snapshot = await fetchAccountApps();
    await reconcileAccountApps(snapshot);
    let stored = await readAccountApps();
    for (const record of stored.outbox.filter((candidate) => candidate.status === "blocked")) {
      if (await this.satisfied(record.operation, snapshot).catch(() => false)) await reconcileAccountApps(snapshot, record.operationId);
    }
    stored = await readAccountApps();
    if (this.active) this.publish({ ...stored, error: "" });
    return snapshot;
  }

  private async queued(operation: AccountAppOperation, localData?: Parameters<typeof enqueueAccountAppOperation>[1]) {
    const result = await enqueueAccountAppOperation(operation, localData);
    this.publish({ state: result.state, outbox: [...this.current.outbox, result.record].sort((left, right) => left.sequence - right.sequence), error: "" });
    void this.replay();
    return result.state.projection;
  }

  async install(archive: Blob, inspection: AppPackageInspection) {
    const hashes = await uploadBlobDigests(archive);
    if (hashes.sha256 !== inspection.digest) throw new Error("The app package digest changed before it could be queued.");
    await verifyLocalAccountPackage(archive, inspection.digest, inspection.manifest);
    await saveApprovedPackageArchive(inspection.digest, archive, () => this.queued({ schemaVersion: 1, kind: "install", appId: inspection.manifest.id, manifest: inspection.manifest, digest: hashes.sha256, md5: hashes.md5, size: archive.size }).then(() => undefined));
    await this.replay();
    return this.current.state.baseline?.apps.find((app) => app.appId === inspection.manifest.id && app.package.sha256 === inspection.digest) ?? null;
  }

  async approve(app: AccountApp): Promise<InstalledApp> {
    const { archive, inspection } = await downloadAccountAppPackage(app, this.directBlobOrigin);
    await saveApprovedPackageArchive(inspection.digest, archive);
    return { appId: app.appId, source: "account", packageEntryId: null, archivePath: null, installationGeneration: app.generations.installationGeneration, digest: app.package.sha256, version: app.manifest.version, manifest: app.manifest, approvedAt: Date.now() };
  }

  async uninstall(app: AccountApp) {
    return this.queued({ schemaVersion: 1, kind: "uninstall", appId: app.appId, installationGeneration: app.generations.installationGeneration });
  }

  async setHandlers(hints: Readonly<Record<string, string>>) {
    return this.queued({ schemaVersion: 1, kind: "handlers", hints });
  }

  private desired(appId: string) {
    const desired = this.current.state.projection.apps.find((app) => app.appId === appId);
    if (!desired) throw new Error("That app is not installed for this account.");
    return desired;
  }

  owns(appId: string) { return Boolean(this.current.state.baseline?.apps.some((app) => app.appId === appId)); }

  async getData(appId: string, key: string): Promise<JsonValue | undefined> {
    const projected = projectAccountAppData(this.current.outbox, appId, key);
    if (projected.resolved) return projected.value;
    const app = this.current.state.baseline?.apps.find((candidate) => candidate.appId === appId);
    if (app) {
      try {
        const value = await downloadAccountAppData(app, key, this.directBlobOrigin);
        if (value !== undefined) await writeAppStorage(appId, key, value, 64 * 1024, 128);
        return value;
      } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof AccountAppsRequestError && accountAppsRequestIsTransient(error.status))) throw error;
        // The local projection remains usable during a short network outage.
      }
    }
    return readAppStorage(appId, key);
  }

  setData(appId: string, key: string, value: JsonValue) {
    const app = this.desired(appId);
    return this.queued({ schemaVersion: 1, kind: "put-data", appId, key, dataGeneration: app.dataGeneration, value }, { kind: "put", appId, key, value });
  }

  removeData(appId: string, key: string) {
    const app = this.desired(appId);
    return this.queued({ schemaVersion: 1, kind: "delete-data", appId, key, dataGeneration: app.dataGeneration }, { kind: "delete", appId, key });
  }

  clearData(appId: string) {
    const app = this.desired(appId);
    return this.queued({ schemaVersion: 1, kind: "clear-data", appId, dataGeneration: app.dataGeneration }, { kind: "clear", appId });
  }

  replay() {
    if (this.replaying) return this.replaying;
    const replay = this.replayPending().finally(() => { if (this.replaying === replay) this.replaying = null; });
    this.replaying = replay;
    return replay;
  }

  private async replayPending() {
    for (;;) {
      const stored = await readAccountApps();
      const record = stored.outbox.find((candidate) => candidate.status === "pending");
      if (!record || !this.active) {
        if (this.active) this.publish({ state: stored.state, outbox: stored.outbox, error: this.current.error });
        return;
      }
      try {
        const operation = record.operation;
        const obsoleteDigest = operation.kind === "uninstall" || operation.kind === "install"
          ? this.current.state.baseline?.apps.find((app) => app.appId === operation.appId)?.package.sha256
          : undefined;
        await recordAccountAppAttempt(record.operationId);
        await this.send(record);
        const snapshot = await fetchAccountApps();
        const state = await reconcileAccountApps(snapshot, record.operationId);
        const next = await readAccountApps();
        if (obsoleteDigest && (operation.kind === "uninstall" || operation.kind === "install" && obsoleteDigest !== operation.digest)) await releaseApprovedPackageArchive(obsoleteDigest).catch(() => undefined);
        this.clearRetry();
        if (this.active) this.publish({ state, outbox: next.outbox, error: "" });
      } catch (error) {
        if (error instanceof AccountAppsRequestError && accountAppsRequestIsPermanent(error.status)) {
          const snapshot = await fetchAccountApps().catch(() => null);
          if ((error.status === 404 || error.status === 409) && snapshot && await this.satisfied(record.operation, snapshot).catch(() => false)) await reconcileAccountApps(snapshot, record.operationId);
          else {
            await blockAccountAppOperation(record.operationId, error.message, error.code ?? `http_${error.status}`);
            const baseline = snapshot ?? this.current.state.baseline;
            if (baseline) await this.restoreData(record.operation, baseline).catch(() => undefined);
          }
          const stored = await readAccountApps();
          if (this.active) this.publish({ ...stored, error: "" });
          continue;
        }
        this.fail(error);
        this.scheduleRetry(record.attemptCount + 1);
        return;
      }
    }
  }

  async retry(operationId: string) {
    await retryAccountAppOperation(operationId);
    const stored = await readAccountApps();
    this.publish({ ...stored, error: "" });
    this.clearRetry();
    void this.replay();
  }

  async discard(operationId: string) {
    const stored = await readAccountApps();
    const record = stored.outbox.find((candidate) => candidate.operationId === operationId);
    if (!record) return;
    try {
      const restoration = await this.dataRestoration(record.operation, stored.state.baseline, stored.outbox.filter((candidate) => candidate.operationId !== operationId));
      await discardAccountAppOperation(operationId, restoration);
      this.publish({ ...await readAccountApps(), error: "" });
    } catch (error) {
      this.publish({ ...await readAccountApps(), error: this.current.error });
      throw error;
    }
  }

  private async dataRestoration(operation: AccountAppOperation, snapshot: AccountAppsSnapshot | null, remaining: readonly AccountAppOutboxRecord[]): Promise<AccountAppDataRestoration | undefined> {
    if (operation.kind === "install" || operation.kind === "uninstall" || operation.kind === "handlers") return undefined;
    if (!snapshot) throw new Error("Reconnect and refresh account apps before discarding this change.");
    const app = snapshot.apps.find((candidate) => candidate.appId === operation.appId);
    const values = new Map<string, JsonValue>();
    if (app) for (const [key, value] of await Promise.all(app.data.map(async (item) => [item.key, await downloadAccountAppData(app, item.key, this.directBlobOrigin)] as const))) {
      if (value !== undefined) values.set(key, value);
    }
    for (const record of remaining) {
      const pending = record.operation;
      if (record.status !== "pending" || pending.kind === "install" || pending.kind === "uninstall" || pending.kind === "handlers" || pending.appId !== operation.appId) continue;
      if (pending.kind === "clear-data") values.clear();
      else if (pending.kind === "put-data") values.set(pending.key, pending.value);
      else values.delete(pending.key);
    }
    return { kind: "replace", appId: operation.appId, values: [...values] };
  }

  private async satisfied(operation: AccountAppOperation, snapshot: AccountAppsSnapshot) {
    if (operation.kind === "handlers") return JSON.stringify(operation.hints) === JSON.stringify(snapshot.handlerHints);
    const app = snapshot.apps.find((candidate) => candidate.appId === operation.appId);
    if (operation.kind === "install") return app?.package.sha256 === operation.digest;
    if (operation.kind === "uninstall") return !app;
    if (!app) return operation.kind === "delete-data" || operation.kind === "clear-data";
    if (operation.kind === "clear-data") return app.data.length === 0 && app.generations.dataGeneration > operation.dataGeneration;
    const item = app.data.find((candidate) => candidate.key === operation.key);
    if (operation.kind === "delete-data") return !item;
    if (!item) return false;
    return JSON.stringify(await downloadAccountAppData(app, operation.key, this.directBlobOrigin)) === JSON.stringify(operation.value);
  }

  private async restoreData(operation: AccountAppOperation, snapshot: AccountAppsSnapshot) {
    if (operation.kind === "install" || operation.kind === "uninstall" || operation.kind === "handlers") return;
    const app = snapshot.apps.find((candidate) => candidate.appId === operation.appId);
    if (operation.kind === "clear-data") {
      await clearAppStorage(operation.appId);
      if (app) for (const item of app.data) {
        const value = await downloadAccountAppData(app, item.key, this.directBlobOrigin);
        if (value !== undefined) await writeAppStorage(app.appId, item.key, value, 64 * 1024, 128);
      }
      return;
    }
    const value = app ? await downloadAccountAppData(app, operation.key, this.directBlobOrigin) : undefined;
    if (value === undefined) await removeAppStorage(operation.appId, operation.key);
    else await writeAppStorage(operation.appId, operation.key, value, 64 * 1024, 128);
  }

  private async send(record: AccountAppOutboxRecord) {
    const operation = record.operation;
    if (operation.kind === "install") {
      const archive = await readApprovedPackageArchive(operation.digest);
      if (archive.size !== operation.size) throw new Error("The queued app package has an unexpected size.");
      await verifyLocalAccountPackage(archive, operation.digest, operation.manifest);
      const prepared = await prepareAccountPackage(archive, operation.manifest, record.clientId, record.operationId, this.directBlobOrigin);
      if (!prepared) return;
      try { await uploadPreparedAccountPackage(prepared, archive, operation.manifest, operation.digest, record.clientId, record.operationId); }
      catch (error) {
        await cancelPreparedAccountPackage(prepared, record.clientId, record.operationId).catch(() => undefined);
        throw error;
      }
      return;
    }
    if (operation.kind === "uninstall") return accountMutation(API_ROUTES.app(operation.appId), "DELETE", { installationGeneration: operation.installationGeneration }, record.clientId, record.operationId).then(() => undefined);
    if (operation.kind === "put-data") return accountMutation(API_ROUTES.appData(operation.appId, operation.key), "PUT", { dataGeneration: operation.dataGeneration, value: operation.value }, record.clientId, record.operationId).then(() => undefined);
    if (operation.kind === "delete-data") return accountMutation(API_ROUTES.appData(operation.appId, operation.key), "DELETE", { dataGeneration: operation.dataGeneration }, record.clientId, record.operationId).then(() => undefined);
    if (operation.kind === "clear-data") return accountMutation(API_ROUTES.appData(operation.appId), "DELETE", { dataGeneration: operation.dataGeneration }, record.clientId, record.operationId).then(() => undefined);
    return accountMutation(API_ROUTES.appHandlers, "PUT", { hints: operation.hints }, record.clientId, record.operationId).then(() => undefined);
  }
}

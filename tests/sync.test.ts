import { describe, expect, test } from "bun:test";
import { SyncEngine, type SyncEngineOptions } from "../src/lib/sync";
import type { OutboxOperation, OutboxRecord } from "../src/lib/outbox";
import { applyOutboxOperation, rebaseOutboxOperationAfterAcknowledgement, transferEntriesBetweenDesktopStates } from "../src/lib/outbox";
import { desktopStateSnapshot, remoteDesktopIdentity, remoteDesktopState } from "./fixtures";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "../src/lib/themes";
import { DEFAULT_WALLPAPER } from "../src/types";
import { sha256Blob } from "../src/lib/blob-transfer";

const catalogQuota = { storageBytes: { used: 12, limit: 100 }, desktops: { used: 1, limit: 10 }, entries: { used: 2, limit: 5000 } };

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) { void type; void listener; }
  close() {}
}

class CapturingEventSource extends FakeEventSource {
  static latest: CapturingEventSource | null = null;
  private catalogListener: ((event: MessageEvent<string>) => void) | null = null;
  constructor(readonly url: string) {
    super();
    CapturingEventSource.latest = this;
  }
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "catalog") this.catalogListener = listener as (event: MessageEvent<string>) => void;
  }
  emitCatalog(catalogId: string, catalogRevision: number, schemaVersion = 2) {
    this.catalogListener?.({ data: JSON.stringify({ schemaVersion, catalogId, catalogRevision }) } as MessageEvent<string>);
  }
}

function xhrUsingFetch(fetchImpl: typeof fetch) {
  return () => {
    let method = "GET";
    let url = "";
    const headers = new Headers();
    const request = {
      status: 0,
      withCredentials: false,
      upload: { onprogress: null as ((event: ProgressEvent) => void) | null },
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      open(nextMethod: string, nextUrl: string) { method = nextMethod; url = nextUrl; },
      setRequestHeader(name: string, value: string) { headers.append(name, value); },
      abort() { request.onabort?.(); },
      send(body: Blob) {
        request.upload.onprogress?.({ loaded: body.size } as ProgressEvent);
        void fetchImpl(url, { method, headers, body, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" }).then((response) => {
          request.status = response.status;
          request.onload?.();
        }, () => request.onerror?.());
      },
    };
    return request as unknown as XMLHttpRequest;
  };
}

async function blockEngineQueue(engine: SyncEngine) {
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const queue = (engine as unknown as { queueSync(operation: () => Promise<void>): Promise<void> }).queueSync.bind(engine);
  const pending = queue(async () => { markStarted(); await gate; });
  await started;
  return { release, pending };
}

async function waitFor(condition: () => boolean | Promise<boolean>, message = "Timed out waiting for background synchronization.") {
  const deadline = Date.now() + 2_000;
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitForOutboxDrain(engine: SyncEngine) {
  await waitFor(async () => (await engine.getOutboxStatus()).records.length === 0);
}

function remoteStorage(initial = desktopStateSnapshot()) {
  let current = initial;
  let outbox: OutboxRecord[] = [];
  let sequence = 0;
  const cached = new Map<string, File>();
  const pending = new Map<string, Map<string, Blob>>();
  const conflictContents = new Map<string, { base: Blob | null; server: Blob | null }>();
  const stats = { cacheWrites: 0, blockWrites: 0, attemptWrites: 0, remoteApplications: [] as Array<{ acknowledgedOperationId?: string; force: boolean; useAcknowledgedContent: boolean }> };
  const storage = {
    loadDesktop: async () => current,
    readDesktopState: async () => current,
    applyRemoteDesktop: async (next: typeof current, _contents: Map<string, Blob>, acknowledgedOperationId?: string, _desktopId?: string, force = false, useAcknowledgedContent = true) => {
      stats.remoteApplications.push({ acknowledgedOperationId, force, useAcknowledgedContent });
      current = next;
      return current;
    },
    bindOutboxCatalog: async () => undefined,
    readFile: async (id: string) => {
      const entry = current.entries.find((candidate) => candidate.id === id && candidate.kind === "file")!;
      return new File(["note"], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
    },
    readCachedFile: async (desktopId: string, catalogId: string, id: string, contentRevision?: number) => {
      const content = outbox.filter((record) => record.desktopId === desktopId).map((record) => pending.get(record.operationId)?.get(id)).filter((candidate): candidate is Blob => candidate !== undefined).at(-1);
      const entry = current.entries.find((candidate) => candidate.id === id && candidate.kind === "file");
      if (content && entry) return new File([content], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
      return cached.get(`${desktopId}:${catalogId}:${id}:${contentRevision}`) ?? null;
    },
    cacheRemoteFile: async (desktopId: string, catalogId: string, id: string, contentRevision: number, _sha256: string, content: Blob) => {
      const entry = current.entries.find((candidate) => candidate.id === id && candidate.kind === "file");
      if (!entry || current.sync.catalogId !== catalogId || current.sync.contentRevisions[id] !== contentRevision || content.size !== entry.size) return null;
      const file = new File([content], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
      cached.set(`${desktopId}:${catalogId}:${id}:${contentRevision}`, file);
      stats.cacheWrites += 1;
      return file;
    },
    removeCachedFile: async (desktopId: string, catalogId: string, id: string, contentRevision: number) => cached.delete(`${desktopId}:${catalogId}:${id}:${contentRevision}`),
    loadOfflineInventory: async (desktopId: string) => ({
      desktopId,
      authoritativeLocal: false,
      files: Object.fromEntries(current.entries.filter((entry) => entry.kind === "file").map((entry) => {
        const revision = current.sync.contentRevisions[entry.id];
        const available = cached.has(`${desktopId}:${current.sync.catalogId}:${entry.id}:${revision}`);
        return [entry.id, { cached: available, cachedBytes: available ? entry.size : 0, storedBytes: available ? entry.size : 0, pending: false, protected: false }];
      })),
      cachedBytes: [...cached.values()].reduce((total, file) => total + file.size, 0),
      protectedBytes: 0,
      releasableBytes: [...cached.values()].reduce((total, file) => total + file.size, 0),
      browserStorage: null,
    }),
    releaseOfflineCopies: async () => {
      const releasedBytes = [...cached.values()].reduce((total, file) => total + file.size, 0);
      const releasedFiles = cached.size;
      cached.clear();
      return { releasedBytes, releasedFiles, skippedFiles: 0 };
    },
    readOutbox: async () => outbox,
    enqueueMutation: async (operation: OutboxOperation | ((current: typeof current) => OutboxOperation), contents = new Map<string, Blob>()) => {
      if (typeof operation === "function") operation = operation(current);
      const state = applyOutboxOperation({ entries: current.entries, autoArrangeIcons: current.layout.autoArrangeIcons, snapToGrid: current.layout.snapToGrid, gridSize: current.layout.gridSize, wallpaper: current.layout.wallpaper, widgets: current.layout.widgets, iconGroups: current.layout.iconGroups, editorSettings: current.editorSettings, appearance: current.appearance, sync: current.sync }, operation);
      current = { entries: state.entries, layout: { autoArrangeIcons: state.autoArrangeIcons, snapToGrid: state.snapToGrid, gridSize: state.gridSize, wallpaper: state.wallpaper, widgets: state.widgets, iconGroups: state.iconGroups }, editorSettings: state.editorSettings, appearance: state.appearance, sync: state.sync };
      const record: OutboxRecord = { operationId: String(++sequence), sequence, clientId: "client", catalogId: current.sync.catalogId!, desktopId: "desk", operation, status: "pending", error: null, attemptCount: 0, lastAttemptAt: null };
      outbox.push(record);
      pending.set(record.operationId, contents);
      return { desktop: current, record };
    },
    enqueueTransfer: async (_source: string, destinationDesktopId: string, entryIds: string[], parentId: string | null) => {
      const operation: OutboxOperation = { schemaVersion: 1, kind: "entry-transfer", destinationDesktopId, entryIds, parentId };
      const state = applyOutboxOperation({ entries: current.entries, autoArrangeIcons: current.layout.autoArrangeIcons, snapToGrid: current.layout.snapToGrid, gridSize: current.layout.gridSize, wallpaper: current.layout.wallpaper, widgets: current.layout.widgets, iconGroups: current.layout.iconGroups, editorSettings: current.editorSettings, appearance: current.appearance, sync: current.sync }, operation);
      current = { ...current, entries: state.entries };
      const record: OutboxRecord = { operationId: String(++sequence), sequence, clientId: "client", catalogId: current.sync.catalogId!, desktopId: "desk", operation, status: "pending", error: null, attemptCount: 0, lastAttemptAt: null };
      outbox.push(record);
      return { desktop: current, record };
    },
    acknowledgeMutation: async (operationId: string) => { outbox = outbox.filter((record) => record.operationId !== operationId); pending.delete(operationId); },
    resolveSatisfiedMutation: async (remote: typeof current, operationId: string, acknowledgedRevision: number) => {
      outbox = outbox.filter((record) => record.operationId !== operationId).map((record) => ({ ...record, operation: rebaseOutboxOperationAfterAcknowledgement({ entries: remote.entries, autoArrangeIcons: remote.layout.autoArrangeIcons, snapToGrid: remote.layout.snapToGrid, gridSize: remote.layout.gridSize, wallpaper: remote.layout.wallpaper, widgets: remote.layout.widgets, iconGroups: remote.layout.iconGroups, editorSettings: remote.editorSettings, appearance: remote.appearance, sync: remote.sync }, record.operation, acknowledgedRevision) }));
      pending.delete(operationId);
      let projected = { entries: remote.entries, autoArrangeIcons: remote.layout.autoArrangeIcons, snapToGrid: remote.layout.snapToGrid, gridSize: remote.layout.gridSize, wallpaper: remote.layout.wallpaper, widgets: remote.layout.widgets, iconGroups: remote.layout.iconGroups, editorSettings: remote.editorSettings, appearance: remote.appearance, sync: remote.sync };
      for (const record of outbox) projected = applyOutboxOperation(projected, record.operation);
      current = { entries: projected.entries, layout: { autoArrangeIcons: projected.autoArrangeIcons, snapToGrid: projected.snapToGrid, gridSize: projected.gridSize, wallpaper: projected.wallpaper, widgets: projected.widgets, iconGroups: projected.iconGroups }, editorSettings: projected.editorSettings, appearance: projected.appearance, sync: projected.sync };
      return current;
    },
    readPendingContent: async (operationId: string, entryId: string) => pending.get(operationId)?.get(entryId) ?? (() => { throw new Error("missing pending content"); })(),
    readContentConflict: async (operationId: string, entryId: string) => ({ mine: pending.get(operationId)?.get(entryId) ?? (() => { throw new Error("missing pending content"); })(), ...(conflictContents.get(operationId) ?? { base: null, server: null }) }),
    retainContentConflictBase: async (operationId: string, _revision: number, content: Blob) => { conflictContents.set(operationId, { base: content, server: conflictContents.get(operationId)?.server ?? null }); },
    retainContentConflictServer: async (operationId: string, content: Blob) => { conflictContents.set(operationId, { base: conflictContents.get(operationId)?.base ?? null, server: content }); },
    stagePendingContentVariant: async (operationId: string, content: Blob) => {
      const selected = outbox.find((record) => record.operationId === operationId)?.operation;
      if (!selected || selected.kind !== "save-content") throw new Error("missing pending operation");
      pending.get(operationId)?.set(selected.entryId, content);
      return ".mine-00000000-0000-4000-8000-000000000000";
    },
    resolveContentConflictKeepBoth: async (operationId: string, remote: typeof current, sibling: typeof current.entries[number]) => {
      const selected = outbox.find((record) => record.operationId === operationId)!;
      const mine = pending.get(operationId)!.get((selected.operation as Extract<OutboxOperation, { kind: "save-content" }>).entryId)!;
      outbox = outbox.filter((record) => record.operationId !== operationId);
      pending.delete(operationId);
      const operation: OutboxOperation = { schemaVersion: 1, kind: "create", entries: [sibling] };
      const record: OutboxRecord = { ...selected, operationId: String(++sequence), sequence, operation, status: "pending", error: null, errorCode: null, conflictDetails: null };
      outbox.push(record);
      pending.set(record.operationId, new Map([[sibling.id, mine]]));
      const projected = applyOutboxOperation({ entries: remote.entries, autoArrangeIcons: remote.layout.autoArrangeIcons, snapToGrid: remote.layout.snapToGrid, gridSize: remote.layout.gridSize, wallpaper: remote.layout.wallpaper, widgets: remote.layout.widgets, iconGroups: remote.layout.iconGroups, editorSettings: remote.editorSettings, appearance: remote.appearance, sync: remote.sync }, operation);
      current = { entries: projected.entries, layout: { autoArrangeIcons: projected.autoArrangeIcons, snapToGrid: projected.snapToGrid, gridSize: projected.gridSize, wallpaper: projected.wallpaper, widgets: projected.widgets, iconGroups: projected.iconGroups }, editorSettings: projected.editorSettings, appearance: projected.appearance, sync: projected.sync };
      return { desktop: current, record };
    },
    blockMutation: async (operationId: string, error: string, errorCode: string | null = null, conflictDetails: OutboxRecord["conflictDetails"] = null) => {
      stats.blockWrites += 1;
      outbox = outbox.map((record) => record.operationId === operationId ? { ...record, status: "blocked" as const, error, errorCode, conflictDetails } : record);
    },
    rebaseBlockedMutation: async (operationId: string, operation: OutboxOperation) => {
      outbox = outbox.map((record) => record.operationId === operationId ? { ...record, operation, status: "pending" as const, error: null, errorCode: null, conflictDetails: null } : record);
      return outbox.find((record) => record.operationId === operationId)!;
    },
    recordMutationAttempt: async (operationId: string, attemptedAt: number) => {
      stats.attemptWrites += 1;
      outbox = outbox.map((record) => record.operationId === operationId ? { ...record, attemptCount: (record.attemptCount ?? 0) + 1, lastAttemptAt: attemptedAt } : record);
    },
    discardDesktopProjection: async (desktopId: string) => {
      const discarded = outbox.filter((record) => record.desktopId === desktopId || record.operation.kind === "entry-transfer" && record.operation.destinationDesktopId === desktopId);
      outbox = outbox.filter((record) => !discarded.includes(record));
      return { operationIds: discarded.map((record) => record.operationId), fileIds: [], affectedDesktopIds: [desktopId] };
    },
  } as unknown as NonNullable<SyncEngineOptions["storage"]>;
  return Object.assign(storage, { stats, seedOutbox: (records: OutboxRecord[], contents = new Map<string, Map<string, Blob>>()) => { outbox = records; for (const [id, value] of contents) pending.set(id, value); }, seedConflictBase: (operationId: string, base: Blob) => { conflictContents.set(operationId, { base, server: null }); }, seedConflictServer: (operationId: string, server: Blob) => { conflictContents.set(operationId, { base: conflictContents.get(operationId)?.base ?? null, server }); } });
}

describe("canonical synchronization", () => {
  test("does not invent a content revision when saving a pending new file", async () => {
    const storage = remoteStorage();
    const engine = new SyncEngine({ storage, fetch: (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);
    const replay = engine as unknown as { replayRequested: boolean };
    const file = await engine.createFile("store.hpos", null, { x: 0, y: 0 }, new Blob([]), undefined, true);
    expect(replay.replayRequested).toBeFalse();
    await engine.saveFile(file.id, new Blob(["store"]), { unconditional: true });
    expect((await engine.getOutboxStatus()).records.at(-1)?.operation).toMatchObject({ kind: "save-content", entryId: file.id, baseContentRevision: undefined });
    expect(replay.replayRequested).toBeTrue();
    blocked.release();
    await blocked.pending;
    await engine.stop();
  });

  test("keeps an explicitly unconditional save unversioned for existing files", async () => {
    const storage = remoteStorage();
    const engine = new SyncEngine({ storage, fetch: (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);
    await engine.saveFile("file-1", new Blob(["updated"]), { unconditional: true });
    expect((await engine.getOutboxStatus()).records.at(-1)?.operation).toMatchObject({ kind: "save-content", entryId: "file-1", baseContentRevision: undefined });
    blocked.release();
    await blocked.pending;
    await engine.stop();
  });

  test("commits later interactions locally while an earlier replay is still in flight", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    let releasePosition!: () => void;
    let markPositionStarted!: () => void;
    const positionGate = new Promise<void>((resolve) => { releasePosition = resolve; });
    const positionStarted = new Promise<void>((resolve) => { markPositionStarted = resolve; });
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      requests.push(request);
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") {
        const operation = JSON.parse(String(init?.body)).operations[0];
        if (operation.systemRole === "layout") remote = { ...remote, catalogRevision: 3, layout: operation.content, layoutRevision: 3 };
        else {
          markPositionStarted();
          await positionGate;
          remote = { ...remote, catalogRevision: 2, entries: [{ ...remote.entries[0], position: operation.changes.position, revision: 2 }] };
        }
        return Response.json({ state: "committed", catalogRevision: 1 });
      }
      throw new Error(`Unexpected request: ${request}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    let latest = desktopStateSnapshot();
    engine.subscribe((desktop) => { latest = desktop; }, () => undefined);
    await engine.start("desk", { x: 0, y: 0 });

    await engine.updateRootEntryPositions([{ entryId: "file-1", position: { x: 20, y: 30 } }]);
    await positionStarted;
    await engine.saveDesktopLayout({ ...remote.layout, snapToGrid: true, gridSize: 48 });

    expect(latest.entries[0].position).toEqual({ x: 20, y: 30 });
    expect(latest.layout.snapToGrid).toBe(true);
    expect(latest.layout.gridSize).toBe(48);
    expect(await engine.getOutboxStatus()).toMatchObject({ pending: 2, blocked: 0 });
    expect(requests.filter((request) => request === "POST /api/desktops/desk/entries/transactions")).toHaveLength(1);

    releasePosition();
    await waitForOutboxDrain(engine);
    expect(requests.filter((request) => request === "POST /api/desktops/desk/entries/transactions")).toHaveLength(2);
    await engine.stop();
  });

  test("captures position revisions after serialized reconciliation", async () => {
    const storage = remoteStorage();
    const enqueue = storage.enqueueMutation.bind(storage);
    let releaseEnqueue!: () => void;
    let markEnqueueStarted!: () => void;
    const enqueueGate = new Promise<void>((resolve) => { releaseEnqueue = resolve; });
    const enqueueStarted = new Promise<void>((resolve) => { markEnqueueStarted = resolve; });
    storage.enqueueMutation = async (operation, contents) => {
      markEnqueueStarted();
      await enqueueGate;
      return enqueue(operation, contents);
    };
    const engine = new SyncEngine({ storage, fetch: (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);

    const mutation = engine.updateRootEntryPositions([{ entryId: "file-1", position: { x: 20, y: 30 } }]);
    await enqueueStarted;
    const reconciled = remoteDesktopState();
    reconciled.catalogRevision = 2;
    reconciled.entries[0] = { ...reconciled.entries[0], position: { x: 10, y: 15 }, revision: 2 };
    await storage.applyRemoteDesktop({
      ...desktopStateSnapshot(),
      entries: reconciled.entries.map(({ revision, contentRevision, ...entry }) => {
        void revision;
        void contentRevision;
        return entry;
      }),
      sync: { ...desktopStateSnapshot().sync, catalogRevision: 2, entryRevisions: { "file-1": 2 } },
    }, new Map());
    releaseEnqueue();
    await mutation;

    expect((await engine.getOutboxStatus()).records[0]?.operation).toMatchObject({
      kind: "root-entry-positions",
      baseRevisions: { "file-1": 2 },
      conflictBases: { "file-1": { position: { x: 10, y: 15 } } },
    });
    blocked.release();
    await blocked.pending;
    await engine.stop();
  });

  test("captures layout revisions and conflict bases after serialized reconciliation", async () => {
    const storage = remoteStorage();
    const enqueue = storage.enqueueMutation.bind(storage);
    let releaseEnqueue!: () => void;
    let markEnqueueStarted!: () => void;
    const enqueueGate = new Promise<void>((resolve) => { releaseEnqueue = resolve; });
    const enqueueStarted = new Promise<void>((resolve) => { markEnqueueStarted = resolve; });
    storage.enqueueMutation = async (operation, contents) => {
      markEnqueueStarted();
      await enqueueGate;
      return enqueue(operation, contents);
    };
    const engine = new SyncEngine({ storage, fetch: (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);
    const initial = desktopStateSnapshot();
    const widget = { id: "clock", kind: "clock" as const, x: 20, y: 30, width: 220, height: 150 };

    const mutation = engine.saveDesktopLayout({ ...initial.layout, widgets: [{ ...widget, width: 280 }] }, { revision: initial.sync.layoutRevision, layout: initial.layout });
    await enqueueStarted;
    await storage.applyRemoteDesktop({
      ...initial,
      layout: { ...initial.layout, widgets: [widget], wallpaper: { ...initial.layout.wallpaper, dim: 0.8 } },
      sync: { ...initial.sync, catalogRevision: 2, layoutRevision: 2 },
    }, new Map());
    releaseEnqueue();
    await mutation;

    expect((await engine.getOutboxStatus()).records[0]?.operation).toMatchObject({
      kind: "layout",
      baseRevision: 2,
      conflictBase: { widgets: [widget] },
      layout: { widgets: [{ ...widget, width: 280 }], wallpaper: { dim: 0.8 } },
    });
    blocked.release();
    await blocked.pending;
    await engine.stop();
  });

  test("stops immediately and starts a new generation while stale replay transport is blocked", async () => {
    const storage = remoteStorage();
    const remote = remoteDesktopState();
    let replayCalls = 0;
    let staleSignal: AbortSignal | undefined;
    const statuses: string[] = [];
    let markReplayStarted!: () => void;
    const replayStarted = new Promise<void>((resolve) => { markReplayStarted = resolve; });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") {
        replayCalls += 1;
        if (replayCalls === 1) {
          staleSignal = init?.signal ?? undefined;
          markReplayStarted();
          return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => setTimeout(() => reject(new TypeError("stale transport failed")), 0), { once: true }));
        }
        return Response.json({ state: "committed", catalogRevision: 1 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    engine.subscribe(() => undefined, (status) => statuses.push(status));
    await engine.start("desk", { x: 0, y: 0 });
    await engine.updateRootEntryPositions([{ entryId: "file-1", position: { x: 7, y: 8 } }]);
    await replayStarted;

    await engine.stop();
    expect(staleSignal?.aborted).toBe(true);

    expect((await engine.start("desk", { x: 0, y: 0 })).status).toBe("online");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replayCalls).toBe(2);
    expect(statuses.at(-1)).toBe("online");
    expect((await engine.getOutboxStatus()).records).toEqual([]);
    await engine.stop();
  });

  test("does not let an uncached clipboard read block desktop synchronization shutdown", async () => {
    const storage = remoteStorage();
    let descriptorSignal: AbortSignal | undefined;
    let markDescriptorStarted!: () => void;
    const descriptorStarted = new Promise<void>((resolve) => { markDescriptorStarted = resolve; });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remoteDesktopState());
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1") {
        descriptorSignal = init?.signal ?? undefined;
        markDescriptorStarted();
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new TypeError("stale descriptor failed")), { once: true }));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });

    const capturing = engine.captureEntries(["file-1"]).then(() => null, (error: unknown) => error);
    await descriptorStarted;
    await engine.stop();

    expect(descriptorSignal?.aborted).toBe(true);
    expect(await capturing).toMatchObject({ name: "AbortError" });
  });

  test("projects a complete imported hierarchy as one offline create operation", async () => {
    const storage = remoteStorage();
    const engine = new SyncEngine({ storage, fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const entries = [
      { kind: "folder" as const, id: "import-root", name: "Imported", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 10, y: 20 } },
      { kind: "folder" as const, id: "import-empty", name: "Empty", parentId: "import-root", createdAt: 1, modifiedAt: 1, position: { x: 8, y: 8 } },
      { kind: "file" as const, id: "import-file", name: "note.txt", parentId: "import-root", createdAt: 1, modifiedAt: 1, position: { x: 8, y: 96 }, mimeType: "text/plain", size: 4 },
    ];

    expect(await engine.createEntries(entries, new Map([["import-file", new Blob(["note"], { type: "text/plain" })]]))).toEqual(entries);
    const records = await storage.readOutbox();
    expect(records).toHaveLength(1);
    expect(records[0].operation).toEqual({ schemaVersion: 1, kind: "create", entries });
    expect(await storage.readPendingContent(records[0].operationId, "import-file").then((content) => content.text())).toBe("note");
    await engine.stop();
  });

  test("opens a staged import before its upload is acknowledged", async () => {
    const storage = remoteStorage();
    const requests: string[] = [];
    const engine = new SyncEngine({ storage, fetch: (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      throw new TypeError("offline");
    }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);

    const [uploaded] = await engine.importFiles([new File(["local"], "local.txt", { type: "text/plain" })], null, [{ x: 20, y: 20 }]);

    expect(await engine.readFile(uploaded.id).then((file) => file.text())).toBe("local");
    expect(requests).toEqual(["/api/desktops/desk?projection=web"]);
    blocked.release();
    await blocked.pending;
    await engine.stop();
  });

  test("retains uploaded files in the verified offline cache after acknowledgement", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        remote = { ...remote, catalogRevision: 2, entries: [...remote.entries, { ...body.operations[0].entry, revision: 2, contentRevision: 2 }] };
        return Response.json({ state: "committed", catalogRevision: 2 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });

    const [uploaded] = await engine.importFiles([new File(["offline"], "offline.txt", { type: "text/plain" })], null, [{ x: 20, y: 20 }]);
    await waitForOutboxDrain(engine);

    expect(storage.stats.cacheWrites).toBe(1);
    expect(await engine.isFileAvailableOffline(uploaded.id)).toBe(true);
    expect(await engine.readFile(uploaded.id).then((file) => file.text())).toBe("offline");
    await engine.stop();
  });

  test("stages, replays, and cleans up an installed theme package asset", async () => {
    const storage = remoteStorage();
    const folder = { kind: "folder" as const, id: "group-folder", name: "Group", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 40, y: 50 }, revision: 1, contentRevision: 1 };
    const widget = { id: "status", kind: "status" as const, x: 20, y: 30, width: 240, height: 120 };
    let remote = { ...remoteDesktopState(), entries: [...remoteDesktopState().entries, folder], layout: { ...remoteDesktopState().layout, widgets: [widget], iconGroups: [{ folderId: folder.id, width: 320, height: 240 }] } };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const [definition, item, selection, layout] = body.operations;
        remote = {
          ...remote,
          catalogRevision: 2,
          layout: layout.content,
          layoutRevision: 2,
          appearance: { selectedThemeId: selection.content.themeId, selectionRevision: 2, customThemes: [{ ...definition.content, wallpaper: { assetId: item.entry.id, kind: item.packageKind, size: item.entry.size, sha256: item.sha256, revision: 2 }, revision: 2 }] },
        };
        return Response.json({ state: "committed", catalogRevision: 2 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);
    const theme = { id: "aurora", name: "Aurora", definition: BUILTIN_THEMES[DEFAULT_THEME_ID].definition };
    await engine.installThemePackage(theme, "static", new Blob(["theme package"]), { ...remote.layout, wallpaper: { ...DEFAULT_WALLPAPER, source: "theme:aurora" }, widgets: [], iconGroups: [] });
    const [record] = await storage.readOutbox();
    expect(record.operation.kind).toBe("install-theme-package");
    expect(record.operation).toMatchObject({ layout: { widgets: [widget], iconGroups: [{ folderId: folder.id }] } });
    const assetId = record.operation.kind === "install-theme-package" ? record.operation.assetId : "";
    expect(await storage.readPendingContent(record.operationId, assetId).then((content) => content.text())).toBe("theme package");

    blocked.release();
    await blocked.pending;
    await waitForOutboxDrain(engine);
    await expect(storage.readPendingContent(record.operationId, assetId)).rejects.toThrow("missing pending content");
    await engine.stop();
  });

  test("preserves package wallpaper metadata during a normal theme edit", async () => {
    const storage = remoteStorage();
    const wallpaper = { assetId: "theme-asset", kind: "scene" as const, size: 4, sha256: "a".repeat(64), revision: 2 };
    const existing = { id: "aurora", name: "Aurora", definition: BUILTIN_THEMES[DEFAULT_THEME_ID].definition, wallpaper, revision: 2 };
    const remote = { ...remoteDesktopState(), catalogRevision: 2, appearance: { selectedThemeId: existing.id, selectionRevision: 2, customThemes: [existing] } };
    const engine = new SyncEngine({ storage, fetch: (async (input) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remote);
      throw new TypeError("offline");
    }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);
    const edited = await engine.saveCustomTheme({ id: existing.id, name: "Aurora Edited", definition: existing.definition });
    expect(edited.wallpaper).toEqual(wallpaper);
    expect((await storage.readOutbox())[0].operation).toMatchObject({ kind: "upsert-theme", theme: { name: "Aurora Edited", wallpaper } });
    blocked.release();
    await blocked.pending;
    await engine.stop();
  });

  test("queues a wallpaper-free replacement without staging an unused archive", async () => {
    const storage = remoteStorage();
    const wallpaper = { assetId: "theme-asset", kind: "scene" as const, size: 4, sha256: "a".repeat(64), revision: 2 };
    const theme = { id: "aurora", name: "Aurora", definition: BUILTIN_THEMES[DEFAULT_THEME_ID].definition, wallpaper, revision: 2 };
    const remote = { ...remoteDesktopState(), catalogRevision: 2, layout: { ...remoteDesktopState().layout, wallpaper: { ...DEFAULT_WALLPAPER, source: "theme:aurora" as const } }, layoutRevision: 2, appearance: { selectedThemeId: theme.id, selectionRevision: 2, customThemes: [theme] } };
    const engine = new SyncEngine({ storage, fetch: (async (input) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remote);
      throw new TypeError("offline");
    }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);
    await engine.installThemePackage({ id: theme.id, name: theme.name, definition: theme.definition }, null, new Blob(["unused package"]), remote.layout);
    const [record] = await storage.readOutbox();
    expect(record.operation).toMatchObject({ kind: "install-theme-package", wallpaperKind: null, size: 0, layout: { wallpaper: DEFAULT_WALLPAPER } });
    if (record.operation.kind !== "install-theme-package") throw new Error("unexpected operation");
    await expect(storage.readPendingContent(record.operationId, record.operation.assetId)).rejects.toThrow("missing pending content");
    blocked.release();
    await blocked.pending;
    await engine.stop();
  });

  test("saves binary content with MIME and revision options while preserving text saves", async () => {
    const file = { kind: "file" as const, id: "binary", name: "binary.dat", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "application/octet-stream", size: 0 };
    let current = { ...desktopStateSnapshot(), entries: [file], sync: { ...desktopStateSnapshot().sync, contentRevisions: { binary: 4 } } };
    const writes: Array<{ bytes: number[]; mimeType?: string; expectedContentRevision?: number }> = [];
    const storage = {
      loadDesktop: async () => current,
      readCurrentDesktop: async () => current,
      saveFile: async (_id: string, content: Blob, options: { mimeType?: string; expectedContentRevision?: number } = {}) => {
        if (options.expectedContentRevision !== undefined && options.expectedContentRevision !== current.sync.contentRevisions.binary) throw new Error("revision conflict");
        writes.push({ bytes: [...new Uint8Array(await content.arrayBuffer())], ...options });
        const saved = { ...file, size: content.size, mimeType: options.mimeType ?? file.mimeType };
        current = { ...current, entries: [saved] };
        return saved;
      },
      saveTextFile: async (id: string, content: string) => storage.saveFile(id, new Blob([content], { type: file.mimeType })),
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ frontendOnly: true, storage });
    await engine.start("desk", { x: 0, y: 0 });

    await engine.saveFile("binary", new Blob([new Uint8Array([0, 128, 255])]), { mimeType: "image/png", expectedContentRevision: 4 });
    await engine.saveTextFile("binary", "ok");

    expect(writes[0]).toEqual({ bytes: [0, 128, 255], mimeType: "image/png", expectedContentRevision: 4 });
    expect(new TextDecoder().decode(new Uint8Array(writes[1].bytes))).toBe("ok");
    await engine.stop();
  });

  test("converges a fresh browser on the server-created first desktop", async () => {
    const local: Array<{ id: string; name: string }> = [];
    const storage = {
      listDesktops: async () => ({ desktops: local, activeDesktopId: null }),
      ensureDesktop: async (desktop: { id: string; name: string }) => { if (!local.some(({ id }) => id === desktop.id)) local.push(desktop); return desktop; },
      bindOutboxCatalog: async () => undefined,
      readOutbox: async () => [],
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async (input) => {
      expect(String(input)).toBe("/api/desktops");
      return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 1, desktops: [remoteDesktopIdentity()], quota: catalogQuota });
    }) as typeof fetch });

    expect(await engine.listDesktops()).toEqual({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 1, activeDesktopId: "desk", desktops: [remoteDesktopIdentity()], quota: catalogQuota });
  });

  test("returns a cached desktop before refreshing the server catalog", async () => {
    const local = [remoteDesktopIdentity()];
    let requests = 0;
    const storage = {
      listDesktops: async () => ({ desktops: local, activeDesktopId: "desk" }),
      ensureDesktop: async (desktop: { id: string; name: string }) => desktop,
      bindOutboxCatalog: async () => undefined,
      readOutbox: async () => [],
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async () => {
      requests += 1;
      return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 1, desktops: local, quota: catalogQuota });
    }) as typeof fetch });

    expect(await engine.listDesktops(null, { cacheFirst: true })).toMatchObject({ catalogId: null, activeDesktopId: "desk", desktops: local });
    expect(requests).toBe(0);
    expect(await engine.refreshCatalog()).toMatchObject({ catalogId: "catalog", desktops: local });
    expect(requests).toBe(1);
  });

  test("updates synchronized desktop pinning and order through account preferences", async () => {
    const first = remoteDesktopIdentity("one", "One");
    const second = { ...remoteDesktopIdentity("two", "Two"), pinned: true };
    const ensured: string[] = [];
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const storage = {
      ensureDesktop: async (desktop: { id: string }) => { ensured.push(desktop.id); return desktop; },
      listDesktops: async () => ({ desktops: [first, second], activeDesktopId: "one" }),
      bindOutboxCatalog: async () => undefined,
      readOutbox: async () => [],
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 2, desktops: [second, first], quota: { ...catalogQuota, desktops: { used: 2, limit: 10 } } });
    }) as typeof fetch });

    const result = await engine.updateDesktopPreferences([{ id: "two", pinned: true }, { id: "one", pinned: false }]);
    expect(requests).toEqual([
      { url: "/api/account/desktop-preferences", method: "PUT", body: { desktops: [{ id: "two", pinned: true }, { id: "one", pinned: false }] } },
      { url: "/api/desktops", method: "GET", body: null },
    ]);
    expect(ensured).toEqual(["two", "one"]);
    expect(result.desktops.map(({ id, pinned }) => [id, pinned])).toEqual([["two", true], ["one", false]]);
  });

  test("waits for pending desktop creation before saving order", async () => {
    let requested = false;
    const storage = {
      readOutbox: async () => [{ operation: { kind: "create-desktop" } }],
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async () => { requested = true; return Response.json({}); }) as typeof fetch });

    await expect(engine.updateDesktopPreferences([{ id: "one", pinned: false }])).rejects.toThrow("finish syncing");
    expect(requested).toBeFalse();
  });

  test("recovers when concurrent first-run initialization creates the local desktop", async () => {
    const local = [remoteDesktopIdentity("desk", "Desktop")];
    let reads = 0;
    const storage = {
      listDesktops: async () => ({ desktops: reads++ === 0 ? [] : local, activeDesktopId: reads === 1 ? null : "desk" }),
      createDesktop: async () => { throw new Error("A desktop with that name already exists."); },
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ frontendOnly: true, storage });

    expect(await engine.listDesktops()).toMatchObject({ activeDesktopId: "desk", desktops: local });
  });

  test("updates the catalog and falls back when the active desktop is deleted remotely", async () => {
    const local = [{ id: "one", name: "One" }, { id: "two", name: "Two" }];
    let catalogRead = 0;
    const storage = {
      listDesktops: async () => ({ desktops: local, activeDesktopId: "one" }),
      ensureDesktop: async (desktop: { id: string; name: string }) => desktop,
      bindOutboxCatalog: async () => undefined,
      readOutbox: async () => [],
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async () => {
      catalogRead += 1;
      const desktops = (catalogRead === 1 ? local : [local[1]]).map((desktop) => remoteDesktopIdentity(desktop.id, desktop.name));
      return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: catalogRead, desktops, quota: { ...catalogQuota, desktops: { used: desktops.length, limit: 10 } } });
    }) as typeof fetch });

    expect((await engine.listDesktops()).activeDesktopId).toBe("one");
    expect(await engine.refreshCatalog()).toMatchObject({ activeDesktopId: "two", desktops: [{ id: "two", name: "Two" }] });
  });

  test("retains the last authoritative quota snapshot while offline", async () => {
    const local = [{ id: "desk", name: "Desktop" }];
    let online = true;
    const storage = {
      listDesktops: async () => ({ desktops: local, activeDesktopId: "desk" }),
      ensureDesktop: async (desktop: { id: string; name: string }) => desktop,
      bindOutboxCatalog: async () => undefined,
      readOutbox: async () => [],
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async () => {
      if (!online) throw new TypeError("offline");
      return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 1, desktops: local.map((desktop) => remoteDesktopIdentity(desktop.id, desktop.name)), quota: catalogQuota });
    }) as typeof fetch });

    expect((await engine.listDesktops()).quota).toEqual(catalogQuota);
    online = false;
    expect(await engine.listDesktops()).toMatchObject({ catalogId: null, quota: catalogQuota });
  });

  test("does not attach a new catalog quota to an older local projection", async () => {
    const local = [{ id: "desk", name: "Desktop" }];
    let catalogId = "old-catalog";
    const storage = {
      listDesktops: async () => ({ desktops: local, activeDesktopId: "desk" }),
      ensureDesktop: async () => { if (catalogId === "new-catalog") throw new Error("local reconciliation failed"); return local[0]; },
      bindOutboxCatalog: async () => undefined,
      readOutbox: async () => [],
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async () => Response.json({ schemaVersion: 2, catalogId, catalogRevision: 1, desktops: local.map((desktop) => remoteDesktopIdentity(desktop.id, desktop.name)), quota: catalogQuota })) as typeof fetch });

    expect((await engine.listDesktops()).quota).toEqual(catalogQuota);
    catalogId = "new-catalog";
    await expect(engine.listDesktops()).rejects.toThrow("different catalog");
  });

  function deletionStorage(initialRecords: OutboxRecord[]) {
    const records = [...initialRecords];
    const deleted: string[] = [];
    const current = { ...desktopStateSnapshot(), sync: { ...desktopStateSnapshot().sync, catalogId: "catalog", catalogRevision: 1 } };
    const storage = {
      loadDesktop: async () => current,
      readOutbox: async () => records,
      deleteDesktop: async (desktopId: string) => { deleted.push(desktopId); },
      enqueueMutation: async (operation: OutboxOperation) => {
        const record: OutboxRecord = { operationId: `operation-${records.length + 1}`, sequence: records.length + 1, clientId: "client", catalogId: "catalog", desktopId: "retained", operation, status: "pending", error: null };
        records.push(record);
        return { desktop: current, record };
      },
      enqueueDesktopDelete: async (ownerDesktopId: string, desktopId: string, baseRevision: number) => {
        deleted.push(desktopId);
        const operation: OutboxOperation = { schemaVersion: 1, kind: "delete-desktop", desktopId, baseRevision };
        const record: OutboxRecord = { operationId: `operation-${records.length + 1}`, sequence: records.length + 1, clientId: "client", catalogId: "catalog", desktopId: ownerDesktopId, operation, status: "pending", error: null, attemptCount: 0, lastAttemptAt: null };
        records.push(record);
        return { record };
      },
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    return { storage, deleted, records: () => records };
  }

  test("blocks deletion of both sides of an offline entry transfer", async () => {
    const transfer: OutboxRecord = { operationId: "transfer", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desktop-a", operation: { schemaVersion: 1, kind: "entry-transfer", entryIds: ["file"], destinationDesktopId: "desktop-b", parentId: null }, status: "pending", error: null };
    const harness = deletionStorage([transfer]);
    const engine = new SyncEngine({ storage: harness.storage, fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("retained", { x: 0, y: 0 });
    await expect(engine.deleteDesktop("desktop-a")).rejects.toThrow("pending or blocked changes");
    await expect(engine.deleteDesktop("desktop-b")).rejects.toThrow("pending or blocked changes");
    expect(harness.deleted).toEqual([]);
    await engine.stop();
  });

  test("blocks deletion of a desktop with a pending edit", async () => {
    const edit: OutboxRecord = { operationId: "edit", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desktop-a", operation: { schemaVersion: 1, kind: "layout", layout: { snapToGrid: true, wallpaper: { source: "dusk", fit: "cover", positionX: 50, positionY: 50, blur: 0, dim: 0, overlayColor: "#000000", overlayOpacity: 0 } } }, status: "pending", error: null };
    const harness = deletionStorage([edit]);
    const engine = new SyncEngine({ storage: harness.storage, fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("retained", { x: 0, y: 0 });
    await expect(engine.deleteDesktop("desktop-a")).rejects.toThrow("pending or blocked changes");
    expect(harness.deleted).toEqual([]);
    await engine.stop();
  });

  test("optimistically deletes a clean desktop and owns the delete on a retained desktop", async () => {
    const harness = deletionStorage([]);
    const engine = new SyncEngine({ storage: harness.storage, fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("retained", { x: 0, y: 0 });
    await engine.deleteDesktop("clean");
    expect(harness.deleted).toEqual(["clean"]);
    expect(harness.records()).toEqual([expect.objectContaining({ desktopId: "retained", operation: { schemaVersion: 1, kind: "delete-desktop", desktopId: "clean", baseRevision: 0 } })]);
    await engine.stop();
  });

  test("uses atomic desktop projection and outbox storage calls", async () => {
    const storage = remoteStorage();
    const calls: string[] = [];
    storage.enqueueDesktopCreate = async (name: string) => {
      calls.push(`create:${name}`);
      const desktop = { id: "new-desktop", name };
      return { desktop, record: { operationId: "create", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: desktop.id, operation: { schemaVersion: 1, kind: "create-desktop", desktop }, status: "pending", error: null, attemptCount: 0, lastAttemptAt: null } };
    };
    storage.enqueueDesktopRename = async (desktopId: string, name: string, baseRevision: number) => {
      calls.push(`rename:${desktopId}:${name}:${baseRevision}`);
      const desktop = { id: desktopId, name };
      return { desktop, record: { operationId: "rename", sequence: 2, clientId: "client", catalogId: "catalog", desktopId, operation: { schemaVersion: 1, kind: "rename-desktop", desktop, baseRevision }, status: "pending", error: null, attemptCount: 0, lastAttemptAt: null } };
    };
    const engine = new SyncEngine({ storage, fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    expect(await engine.createDesktop("New")).toEqual({ id: "new-desktop", name: "New" });
    expect(await engine.renameDesktop("new-desktop", "Renamed")).toEqual({ id: "new-desktop", name: "Renamed" });
    expect(calls).toEqual(["create:New", "rename:new-desktop:Renamed:0"]);
    await engine.stop();
  });

  const staleCases: Array<{ name: string; desktopId: string; operation: OutboxOperation }> = [
    { name: "create-desktop", desktopId: "old-owner", operation: { schemaVersion: 1, kind: "create-desktop", desktop: { id: "old-created", name: "Old created" } } },
    { name: "delete-desktop", desktopId: "old-owner", operation: { schemaVersion: 1, kind: "delete-desktop", desktopId: "old-deleted" } },
    { name: "entry-transfer", desktopId: "old-source", operation: { schemaVersion: 1, kind: "entry-transfer", entryIds: ["old-entry"], destinationDesktopId: "old-destination", parentId: null } },
    { name: "nonactive desktop mutation", desktopId: "old-nonactive", operation: { schemaVersion: 1, kind: "layout", layout: { snapToGrid: true, wallpaper: { source: "dusk", fit: "cover", positionX: 50, positionY: 50, blur: 0, dim: 0, overlayColor: "#000000", overlayOpacity: 0 } } } },
  ];

  for (const stale of staleCases) test(`blocks stale ${stale.name} before replay and catalog retention`, async () => {
    const remote = remoteDesktopState();
    remote.catalogId = "new-catalog";
    const local = [
      { id: "desk", name: "Desktop" },
      { id: stale.desktopId, name: "Old owner" },
      ...(stale.operation.kind === "create-desktop" ? [stale.operation.desktop] : []),
      ...(stale.operation.kind === "entry-transfer" ? [{ id: stale.operation.destinationDesktopId, name: "Old destination" }] : []),
    ];
    let records: OutboxRecord[] = [{ operationId: "stale-1", sequence: 1, clientId: "client", catalogId: "old-catalog", desktopId: stale.desktopId, operation: stale.operation, status: "pending", error: null }];
    const requests: string[] = [];
    const storage = {
      listDesktops: async () => ({ desktops: local, activeDesktopId: stale.desktopId }),
      ensureDesktop: async (desktop: { id: string; name: string }) => desktop,
      bindOutboxCatalog: async (catalogId: string) => { records = records.map((record) => record.catalogId !== null && record.catalogId !== catalogId ? { ...record, status: "blocked" as const, error: "Pending changes belong to a different catalog." } : { ...record, catalogId }); },
      readOutbox: async () => records,
      loadDesktop: async () => desktopStateSnapshot(),
      applyRemoteDesktop: async (next: ReturnType<typeof desktopStateSnapshot>) => next,
      blockMutation: async () => undefined,
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      requests.push(request);
      if (String(input) === "/api/desktops") return Response.json({ schemaVersion: 2, catalogId: "new-catalog", catalogRevision: 2, desktops: [remoteDesktopIdentity()], quota: catalogQuota });
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remote);
      throw new Error(`A stale operation was sent: ${request}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });

    const catalog = await engine.listDesktops();
    expect(catalog.desktops).toEqual([remoteDesktopIdentity()]);
    expect(records[0]).toMatchObject({ status: "blocked", catalogId: "old-catalog" });
    const started = await engine.start("desk", { x: 0, y: 0 });
    expect(started.status).toBe("online");
    expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
    await engine.stop();
  });

  test("creates a durable first-run offline desktop and replays its creation after reconnect", async () => {
    let online = false;
    let remoteExists = false;
    let local: Array<{ id: string; name: string }> = [];
    let activeDesktopId: string | null = null;
    let current = desktopStateSnapshot();
    let records: OutboxRecord[] = [];
    const requests: string[] = [];
    let createBody: unknown;
    const storage = {
      listDesktops: async () => ({ desktops: local, activeDesktopId }),
      createOfflineDesktop: async (name: string) => {
        const desktop = { id: "offline-desk", name };
        local = [desktop];
        activeDesktopId = desktop.id;
        const operation: OutboxOperation = { schemaVersion: 1, kind: "create-desktop", desktop };
        const record: OutboxRecord = { operationId: "offline-create", sequence: 1, clientId: "client", catalogId: null, desktopId: desktop.id, operation, status: "pending", error: null };
        records = [record];
        return { desktop, record };
      },
      ensureDesktop: async (desktop: { id: string; name: string }) => { if (!local.some(({ id }) => id === desktop.id)) local.push(desktop); return desktop; },
      bindOutboxCatalog: async (catalogId: string) => { records = records.map((record) => record.catalogId === null ? { ...record, catalogId } : record); },
      readOutbox: async () => records,
      loadDesktop: async () => current,
      applyRemoteDesktop: async (next: typeof current) => { current = next; return current; },
      acknowledgeMutation: async (operationId: string) => { records = records.filter((record) => record.operationId !== operationId); },
      blockMutation: async () => undefined,
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      requests.push(request);
      if (!online) throw new TypeError("offline");
      if (String(input) === "/api/desktops" && !init?.method) return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 1, desktops: [remoteDesktopIdentity("server-desk", "Desktop")], quota: catalogQuota });
      if (String(input) === "/api/desktops/offline-desk?projection=web" && !remoteExists) return Response.json({ error: "desktop not found" }, { status: 404 });
      if (String(input) === "/api/desktops" && init?.method === "POST") { createBody = JSON.parse(String(init.body)); remoteExists = true; return Response.json({ ...remoteDesktopState(), catalogId: "catalog", id: "offline-desk", name: "Offline desktop" }, { status: 201 }); }
      if (String(input) === "/api/desktops/offline-desk?projection=web") return Response.json({ ...remoteDesktopState(), catalogId: "catalog", id: "offline-desk", name: "Offline desktop", catalogRevision: 2 });
      throw new Error(`Unexpected request: ${request}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });

    const offline = await engine.listDesktops();
    expect(offline).toMatchObject({ activeDesktopId: "offline-desk", catalogId: null, desktops: [{ id: "offline-desk", name: "Offline desktop" }] });
    expect(records[0]).toMatchObject({ catalogId: null, operation: { kind: "create-desktop" } });

    online = true;
    const reconnected = await engine.listDesktops();
    expect(reconnected.desktops.map(({ id }) => id)).toEqual(["server-desk", "offline-desk"]);
    expect(records[0].catalogId).toBe("catalog");
    const started = await engine.start("offline-desk", { x: 0, y: 0 });
    expect(started.status).toBe("online");
    expect(remoteExists).toBe(true);
    expect(records).toEqual([]);
    expect(requests).toContain("POST /api/desktops");
    expect(createBody).toEqual({ id: "offline-desk", name: "Offline desktop" });
    await engine.stop();
  });

  test("uses scoped desktop, content, and root-entry-position APIs", async () => {
    const remote = remoteDesktopState();
    const requests: string[] = [];
    let reads = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json({ ...remote, catalogRevision: ++reads });
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1") return Response.json({ entryId: "file-1", contentRevision: 1, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/file-1", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (String(input) === "https://downloads.example.test/file-1") return new Response("note");
      if (String(input) === "/api/desktops/desk/entries/transactions") return Response.json({ state: "committed", catalogRevision: 1 });
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage: remoteStorage(), fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, setTimeout: (() => 1) as never, clearTimeout: (() => undefined) as never });
    await engine.start("desk", { x: 100, y: 100 });
    await engine.updateRootEntryPositions([{ entryId: "file-1", position: { x: 20, y: 30 } }]);
    await waitFor(() => requests.includes("POST /api/desktops/desk/entries/transactions"));
    expect(requests).toContain("GET /api/desktops/desk?projection=web");
    expect(requests).toContain("POST /api/desktops/desk/entries/transactions");
    await engine.stop();
  });

  test("pauses replay on 401 without blocking its outbox record", async () => {
    const remote = remoteDesktopState();
    const storage = remoteStorage();
    let unauthorized = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") return new Response(null, { status: 401 });
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, onUnauthorized: () => { unauthorized += 1; } });
    await engine.start("desk", { x: 0, y: 0 });
    await engine.updateRootEntryPositions([{ entryId: "file-1", position: { x: 5, y: 6 } }]);
    await waitFor(() => unauthorized === 1);
    expect(await engine.getOutboxStatus()).toMatchObject({ pending: 1, blocked: 0 });
    expect(storage.stats.blockWrites).toBe(0);
    expect(unauthorized).toBe(1);
    await engine.stop();
  });

  test("enters upgrade-required and never replays queued work for an unsupported wire version", async () => {
    const storage = remoteStorage();
    const record: OutboxRecord = { operationId: "queued", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desk", operation: { schemaVersion: 1, kind: "layout", layout: remoteDesktopState().layout }, status: "pending", error: null };
    storage.seedOutbox([record]);
    const requests: string[] = [];
    const engine = new SyncEngine({ storage, expectedCatalogId: "catalog", eventSource: FakeEventSource as unknown as typeof EventSource, fetch: (async (input, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      return Response.json({ ...remoteDesktopState(), schemaVersion: 1 });
    }) as typeof fetch });
    expect((await engine.start("desk", { x: 0, y: 0 })).status).toBe("upgrade-required");
    expect(requests).toEqual(["GET /api/desktops/desk?projection=web"]);
    expect((await engine.getOutboxStatus()).records).toHaveLength(1);
    await engine.stop();
  });

  test("probes authenticated sync health after an EventSource error", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      if (String(input) === "/api/sync/health") return Response.json({ schemaVersion: 2, catalogId: "catalog-1", catalogRevision: 1 });
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage: remoteStorage(), fetch: fetchImpl, eventSource: CapturingEventSource as unknown as typeof EventSource, setTimeout: (() => 1) as never, clearTimeout: (() => undefined) as never });
    await engine.start("desk", { x: 0, y: 0 });
    CapturingEventSource.latest?.onerror?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toContain("/api/sync/health");
    await engine.stop();
  });

  test("rejects unsupported SSE and health envelopes before replay", async () => {
    for (const source of ["sse", "health"] as const) {
      const storage = remoteStorage();
      const record: OutboxRecord = { operationId: source, sequence: 1, clientId: "client", catalogId: "catalog-1", desktopId: "desk", operation: { schemaVersion: 1, kind: "layout", layout: remoteDesktopState().layout }, status: "pending", error: null };
      const requests: string[] = [];
      const engine = new SyncEngine({ storage, expectedCatalogId: "catalog-1", eventSource: CapturingEventSource as unknown as typeof EventSource,
        setTimeout: (() => 1) as never, clearTimeout: (() => undefined) as never,
        fetch: (async (input) => {
          requests.push(String(input));
          if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
          if (String(input) === "/api/sync/health") return Response.json({ schemaVersion: source === "health" ? 1 : 2, catalogId: "catalog-1", catalogRevision: 2 });
          throw new Error(`Unexpected request: ${String(input)}`);
        }) as typeof fetch });
      await engine.start("desk", { x: 0, y: 0 });
      storage.seedOutbox([record]);
      if (source === "sse") CapturingEventSource.latest?.emitCatalog("catalog-1", 2, 1);
      else CapturingEventSource.latest?.onerror?.();
      await waitFor(() => (engine as unknown as { status: string }).status === "upgrade-required");
      expect((await engine.getOutboxStatus()).records).toHaveLength(1);
      expect(requests.filter((request) => request !== "/api/desktops/desk?projection=web" && request !== "/api/sync/health")).toEqual([]);
      await engine.stop();
    }
  });

  test("aborts health work on stop and ignores its stale completion after restart", async () => {
    let healthSignal: AbortSignal | null = null;
    let finishHealth!: (response: Response) => void;
    let healthRequests = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      if (String(input) === "/api/sync/health") {
        healthRequests += 1;
        healthSignal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve) => { finishHealth = resolve; });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const statuses: string[] = [];
    const engine = new SyncEngine({ storage: remoteStorage(), fetch: fetchImpl, eventSource: CapturingEventSource as unknown as typeof EventSource, setTimeout: (() => 1) as never, clearTimeout: (() => undefined) as never });
    engine.subscribe(() => undefined, (status) => statuses.push(status));

    await engine.start("desk", { x: 0, y: 0 });
    CapturingEventSource.latest?.onerror?.();
    await Promise.resolve();
    expect(healthRequests).toBe(1);
    await engine.stop();
    expect(healthSignal?.aborted).toBe(true);

    await engine.start("desk", { x: 0, y: 0 });
    finishHealth(Response.json({ schemaVersion: 2, catalogId: "stale", catalogRevision: 99 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(statuses.at(-1)).toBe("online");
    await engine.stop();
  });

  test("does not run queued onOpen work after stop and restart", async () => {
    const requests: string[] = [];
    const statuses: string[] = [];
    const engine = new SyncEngine({
      storage: remoteStorage(),
      eventSource: CapturingEventSource as unknown as typeof EventSource,
      setTimeout: (() => 1) as never,
      clearTimeout: (() => undefined) as never,
      fetch: (async (input) => {
        requests.push(String(input));
        if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
        throw new Error(`Unexpected request: ${String(input)}`);
      }) as typeof fetch,
    });
    engine.subscribe(() => undefined, (status) => statuses.push(status));
    await engine.start("desk", { x: 0, y: 0 });
    const oldEvents = CapturingEventSource.latest!;
    const blocked = await blockEngineQueue(engine);
    oldEvents.onopen?.();
    expect((engine as unknown as { pendingWork: number }).pendingWork).toBe(2);

    const stopping = engine.stop();
    await engine.start("desk", { x: 0, y: 0 });
    const requestsBeforeRelease = requests.length;
    blocked.release();
    await Promise.all([blocked.pending, stopping]);
    await Promise.resolve();

    expect(requests).toHaveLength(requestsBeforeRelease);
    expect(requests).not.toContain("/api/desktops");
    expect(statuses.at(-1)).toBe("online");
    await engine.stop();
  });

  test("does not let queued onCatalog work cross lifecycle generations", async () => {
    const requests: string[] = [];
    const engine = new SyncEngine({
      storage: remoteStorage(),
      eventSource: CapturingEventSource as unknown as typeof EventSource,
      setTimeout: (() => 1) as never,
      clearTimeout: (() => undefined) as never,
      fetch: (async (input) => {
        requests.push(String(input));
        if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
        if (String(input) === "/api/desktops") return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 2, desktops: [remoteDesktopIdentity()], quota: catalogQuota });
        throw new Error(`Unexpected request: ${String(input)}`);
      }) as typeof fetch,
    });
    await engine.start("desk", { x: 0, y: 0 });
    const oldEvents = CapturingEventSource.latest!;
    const blocked = await blockEngineQueue(engine);
    oldEvents.emitCatalog("catalog-1", 99);
    expect((engine as unknown as { pendingWork: number }).pendingWork).toBe(2);

    const stopping = engine.stop();
    await engine.start("desk", { x: 0, y: 0 });
    const revisionAfterRestart = (engine as unknown as { catalogRevision: number }).catalogRevision;
    blocked.release();
    await Promise.all([blocked.pending, stopping]);

    expect(requests).not.toContain("/api/desktops");
    expect((engine as unknown as { catalogRevision: number }).catalogRevision).toBe(revisionAfterRestart);
    await engine.stop();
  });

  test("falls back to health polling when EventSource is missing or throws and cleans up", async () => {
    for (const eventSource of [undefined, class { constructor() { throw new Error("disabled"); } }] as const) {
      let healthCheck: (() => void) | undefined;
      let cleared = 0;
      const requests: string[] = [];
      const engine = new SyncEngine({
        storage: remoteStorage(),
        fetch: (async (input) => {
          requests.push(String(input));
          if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
          if (String(input) === "/api/sync/health") return Response.json({ schemaVersion: 2, catalogId: "catalog-1", catalogRevision: 1 });
          throw new Error(`Unexpected request: ${String(input)}`);
        }) as typeof fetch,
        eventSource: eventSource as typeof EventSource | undefined,
        setTimeout: ((callback: () => void) => { healthCheck = callback; return 1; }) as never,
        clearTimeout: (() => { cleared += 1; }) as never,
      });
      expect((await engine.start("desk", { x: 0, y: 0 })).status).toBe("online");
      healthCheck?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requests).toContain("/api/sync/health");
      await engine.stop();
      expect(cleared).toBe(1);
    }
  });

  test("scopes access revocation while replaying and preserving unrelated desktop writes", async () => {
    const storage = remoteStorage();
    const revoked: OutboxRecord = { operationId: "revoked", sequence: 1, clientId: "client", catalogId: "catalog-1", desktopId: "shared", operation: { schemaVersion: 1, kind: "layout", layout: remoteDesktopState().layout }, status: "pending", error: null };
    const unrelated: OutboxRecord = { operationId: "owned", sequence: 2, clientId: "client", catalogId: "catalog-1", desktopId: "desk", operation: { schemaVersion: 1, kind: "editor-settings", settings: remoteDesktopState().editorSettings }, status: "pending", error: null };
    storage.seedOutbox([revoked, unrelated]);
    const requests: string[] = [];
    const engine = new SyncEngine({ storage, eventSource: FakeEventSource as unknown as typeof EventSource, fetch: (async (input, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      if (String(input) === "/api/desktops/shared/entries/transactions") return Response.json({ error: "forbidden" }, { status: 403 });
      if (String(input) === "/api/desktops/desk/entries/transactions") return Response.json({ state: "committed", catalogRevision: 1 });
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch });

    expect((await engine.start("desk", { x: 0, y: 0 })).status).toBe("online");
    expect(await engine.listOutboxRecords()).toEqual([expect.objectContaining({ operationId: "revoked", status: "blocked", error: "Access to this desktop was revoked. Local changes have not been uploaded." })]);
    expect(requests).toContain("POST /api/desktops/desk/entries/transactions");
    await engine.createFolder("Still writable", null, { x: 0, y: 0 });
    expect((await engine.listOutboxRecords()).some((record) => record.desktopId === "desk" && record.status === "pending")).toBe(true);
    await engine.stop();
  });

  test("reconciles metadata without blobs and caches one validated content revision", async () => {
    const remote = remoteDesktopState();
    const storage = remoteStorage();
    let contentRequests = 0;
    let directInit: RequestInit | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1") {
        contentRequests += 1;
        return Response.json({ entryId: "file-1", contentRevision: 1, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/file-1", method: "GET", headers: { "X-Test-Download": "yes" }, expiresAt: 2_000_000_000_000 } });
      }
      if (String(input) === "https://downloads.example.test/file-1") { directInit = init; return new Response("note"); }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, directBlobOrigin: "https://downloads.example.test" });
    const transferPhases: string[] = [];
    engine.subscribeTransfers((transfers) => {
      const transfer = transfers.find(({ entryId }) => entryId === "file-1");
      if (transfer && transferPhases.at(-1) !== transfer.phase) transferPhases.push(transfer.phase);
    });
    const started = await engine.start("desk", { x: 0, y: 0 });
    expect(started.desktop.entries).toHaveLength(1);
    expect(contentRequests).toBe(0);
    expect(await (await engine.readFile("file-1")).text()).toBe("note");
    expect(await (await engine.readFile("file-1")).text()).toBe("note");
    expect(contentRequests).toBe(1);
    expect(storage.stats.cacheWrites).toBe(1);
    expect(directInit).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" });
    expect(new Headers(directInit?.headers).get("X-Test-Download")).toBe("yes");
    expect(transferPhases).toEqual(["access", "downloading", "finalizing", "complete"]);
    expect(engine.getTransferSnapshot()).toEqual([expect.objectContaining({ entryId: "file-1", fileName: "notes.txt", direction: "download", phase: "complete", transferredBytes: 4, totalBytes: 4, error: null })]);
    const transferId = engine.getTransferSnapshot()[0].id;
    engine.dismissCompletedTransfer(transferId);
    expect(engine.getTransferSnapshot()).toEqual([]);
    await engine.stop();
  });

  test("previews local and cached files as Blobs and uncached remote images by URL", async () => {
    const localState = desktopStateSnapshot();
    localState.entries = [{ kind: "file", id: "file-1", name: "photo.png", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 10, y: 20 }, mimeType: "image/png", size: 4 }];
    localState.sync.contentRevisions["file-1"] = 1;
    const local = new SyncEngine({ frontendOnly: true, storage: remoteStorage(localState) });
    await local.start("desk", { x: 0, y: 0 });
    expect(await local.previewFile("file-1")).toMatchObject({ kind: "blob", blob: expect.any(Blob) });
    expect(await local.thumbnailFile("file-1")).toMatchObject({ kind: "blob", blob: expect.any(Blob) });
    await local.stop();

    const storage = remoteStorage();
    const requests: string[] = [];
    const remoteState = remoteDesktopState();
    remoteState.entries[0] = { ...remoteState.entries[0], name: "photo.png", mimeType: "image/png" };
    const descriptor = { entryId: "file-1", contentRevision: 1, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/file-1", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteState);
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1") return Response.json(descriptor);
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1&purpose=preview") return Response.json(descriptor);
      if (String(input) === descriptor.access.url) return new Response("note");
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const remote = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await remote.start("desk", { x: 0, y: 0 });
    expect(await remote.previewFile("file-1")).toEqual({ kind: "url", url: descriptor.access.url, expiresAt: descriptor.access.expiresAt });
    expect(await remote.thumbnailFile("file-1")).toEqual({ kind: "url", url: descriptor.access.url, expiresAt: descriptor.access.expiresAt });
    expect(storage.stats.cacheWrites).toBe(0);
    expect(requests).not.toContain(descriptor.access.url);
    await remote.readFile("file-1");
    expect(await remote.previewFile("file-1")).toMatchObject({ kind: "blob", blob: expect.any(Blob) });
    expect(requests.filter((request) => request.includes("purpose=preview"))).toHaveLength(2);
    await remote.stop();
  });

  test("uses only an exact cached original when generated image thumbnails fail", async () => {
    const remoteState = remoteDesktopState();
    remoteState.entries[0] = { ...remoteState.entries[0], name: "photo.png", mimeType: "image/png" };
    const localState = desktopStateSnapshot();
    localState.entries = [{ kind: "file", id: "file-1", name: "photo.png", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 10, y: 20 }, mimeType: "image/png", size: 4 }];
    localState.sync.catalogId = remoteState.catalogId;
    localState.sync.contentRevisions["file-1"] = 1;
    const storage = remoteStorage(localState);
    expect(await storage.cacheRemoteFile("desk", remoteState.catalogId, "file-1", 1, "ignored", new Blob(["note"]))).toBeInstanceOf(File);
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteState);
      if (String(input).includes("/thumbnail?")) throw new TypeError("offline");
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, thumbnails: true, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const thumbnail = await engine.thumbnailFile("file-1");
    expect(thumbnail.kind).toBe("blob");
    if (thumbnail.kind === "blob") expect(await thumbnail.blob.text()).toBe("note");
    expect(requests.some((request) => request.includes("purpose=preview"))).toBeFalse();
    await engine.stop();
  });

  test("keeps videos on the generic glyph when thumbnail capability is absent", async () => {
    const remoteState = remoteDesktopState();
    remoteState.entries[0] = { ...remoteState.entries[0], name: "clip.mp4", mimeType: "video/mp4" };
    const requests: string[] = [];
    const engine = new SyncEngine({ storage: remoteStorage(), eventSource: FakeEventSource as unknown as typeof EventSource, fetch: (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteState);
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch });
    await engine.start("desk", { x: 0, y: 0 });
    await expect(engine.thumbnailFile("file-1")).rejects.toThrow("unavailable");
    expect(requests.some((request) => request.includes("/content"))).toBeFalse();
    await engine.stop();
  });

  test("reports, requests, and removes exact validated offline file revisions", async () => {
    const storage = remoteStorage();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1") return Response.json({ entryId: "file-1", contentRevision: 1, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/file-1", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (String(input) === "https://downloads.example.test/file-1") return new Response("note");
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    const activeDownloads: string[][] = [];
    engine.subscribeEntryDownloads((ids) => activeDownloads.push([...ids]));
    await engine.start("desk", { x: 0, y: 0 });

    expect(await engine.isFileAvailableOffline("file-1")).toBe(false);
    expect(await (await engine.makeFileAvailableOffline("file-1")).text()).toBe("note");
    expect(await engine.isFileAvailableOffline("file-1")).toBe(true);
    expect(activeDownloads).toContainEqual(["file-1"]);
    expect(activeDownloads.at(-1)).toEqual([]);
    expect(await engine.removeFileFromOfflineCache("file-1")).toBe(true);
    expect(await engine.isFileAvailableOffline("file-1")).toBe(false);
    await engine.stop();
  });

  test("downloads selected copies once through the verified access path", async () => {
    const storage = remoteStorage();
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1") return Response.json({ entryId: "file-1", contentRevision: 1, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/file-1", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (String(input) === "https://downloads.example.test/file-1") return new Response("note");
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });

    void engine.downloadOfflineCopies(["file-1"]);
    await waitFor(() => engine.isFileAvailableOffline("file-1"));
    expect(await engine.isFileAvailableOffline("file-1")).toBe(true);
    expect(requests).toContain("/api/desktops/desk/entries/file-1/content?revision=1");
    expect(await engine.releaseOfflineCopies()).toMatchObject({ releasedFiles: 1, releasedBytes: 4 });
    await engine.stop();
  });

  test("coalesces concurrent active-desktop inventory loads", async () => {
    const storage = remoteStorage();
    const original = storage.loadOfflineInventory;
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    storage.loadOfflineInventory = async (desktopId: string) => { loads += 1; await gate; return original(desktopId); };
    const engine = new SyncEngine({ frontendOnly: true, storage });
    await engine.start("desk", { x: 0, y: 0 });
    const first = engine.loadOfflineInventory();
    const second = engine.loadOfflineInventory();
    release();
    await Promise.all([first, second]);
    expect(loads).toBe(1);
    await engine.stop();
  });

  test("suppresses late offline progress after the desktop generation stops", async () => {
    const storage = remoteStorage();
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>((resolve) => { releaseDownload = resolve; });
    const progress: Array<{ phase: string; desktopId: string; generation: number; operationId: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1") return Response.json({ entryId: "file-1", contentRevision: 1, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/file-1", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (String(input) === "https://downloads.example.test/file-1") { await downloadGate; return new Response("note"); }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    engine.subscribeOfflineStorage(() => undefined, (value) => { if (value) progress.push(value); });
    await engine.start("desk", { x: 0, y: 0 });
    void engine.downloadOfflineCopies(["file-1"]);
    while (!progress.length) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(progress[0]).toMatchObject({ phase: "downloading", desktopId: "desk" });
    expect(progress[0].operationId).toBeTruthy();
    await engine.stop();
    const countAfterStop = progress.length;
    releaseDownload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(progress).toHaveLength(countAfterStop);
  });

  test("retries the selected blocked record and all later records in order", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    let rejectMutation = true;
    const retriedOperationIds: string[] = [];
    const queueSizes: number[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") {
        if (rejectMutation) return Response.json({ error: "position conflict" }, { status: 409 });
        retriedOperationIds.push(new Headers(init?.headers).get("X-Hiraya-Operation-ID")!);
        remote = { ...remote, catalogRevision: remote.catalogRevision + 1 };
        return Response.json({ state: "committed", catalogRevision: remote.catalogRevision });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const unsubscribe = engine.subscribeOutbox((records) => queueSizes.push(records.length));
    await engine.updateRootEntryPositions([{ entryId: "file-1", position: { x: 5, y: 6 } }]);
    await waitFor(async () => (await engine.getOutboxStatus()).blocked === 1);
    await engine.saveEditorSettings({ ...remote.editorSettings, fontSize: 15 });
    await waitFor(async () => (await engine.getOutboxStatus()).blocked === 2);
    await engine.saveDesktopLayout({ ...remote.layout, snapToGrid: true });
    await waitFor(async () => (await engine.getOutboxStatus()).blocked === 3);
    const records = await engine.listOutboxRecords();
    expect(records.every((record) => record.status === "blocked")).toBeTrue();

    rejectMutation = false;
    await engine.retryBlockedOutboxRecord(records[0].operationId);
    expect(retriedOperationIds).toEqual(records.map((record) => record.operationId));
    expect(await engine.listOutboxRecords()).toEqual([]);
    expect(queueSizes).toContain(3);
    expect(queueSizes.at(-1)).toBe(0);
    unsubscribe();
    await engine.stop();
  });

  test("automatically merges and retries disjoint offline layout changes", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    const requests: Array<{ baseRevision?: number; layout: typeof remote.layout }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") {
        const body = JSON.parse(String(init?.body)).operations[0] as { baseRevision?: number; content: typeof remote.layout };
        requests.push(body);
        if (requests.length === 1) {
          remote = { ...remote, catalogRevision: 2, layoutRevision: 2, layout: { ...remote.layout, wallpaper: { ...remote.layout.wallpaper, dim: 0.8 } } };
          return Response.json({ error: "The layout changed.", code: "revision_conflict", conflict: { resourceKind: "layout", resourceId: "desk", expectedRevision: 1, actualRevision: 2 } }, { status: 409 });
        }
        remote = { ...remote, catalogRevision: 3, layoutRevision: 3, layout: body.content };
        return Response.json({ state: "committed", catalogRevision: 3 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });

    await engine.saveDesktopLayout({ ...remote.layout, snapToGrid: true });
    await waitFor(async () => (await engine.listOutboxRecords()).length === 0);

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ baseRevision: 2, content: { snapToGrid: true, wallpaper: { dim: 0.8 } } });
    await engine.stop();
  });

  test("replays the durable rebased operation instead of a stale queue snapshot", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    const bases: Array<number | undefined> = [];
    const acknowledge = storage.acknowledgeMutation.bind(storage);
    storage.acknowledgeMutation = async (operationId) => {
      await acknowledge(operationId);
      const records = await storage.readOutbox();
      if (records[0]?.operation.kind === "select-theme") storage.seedOutbox([{ ...records[0], operation: { ...records[0].operation, baseRevision: 2 } }]);
    };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") {
        const operation = JSON.parse(String(init?.body)).operations[0] as { baseRevision?: number; content: { themeId: string } };
        bases.push(operation.baseRevision);
        remote = { ...remote, catalogRevision: remote.catalogRevision + 1, appearance: { ...remote.appearance, selectedThemeId: operation.content.themeId, selectionRevision: remote.catalogRevision + 1 } };
        return Response.json({ state: "committed", catalogRevision: remote.catalogRevision });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const blocked = await blockEngineQueue(engine);
    await engine.selectTheme("warm-paper");
    await engine.selectTheme(DEFAULT_THEME_ID);
    blocked.release();
    await blocked.pending;
    await waitForOutboxDrain(engine);

    expect(bases).toEqual([1, 2]);
    await engine.stop();
  });

  test("removes a theme selection already satisfied by the server without rewriting it", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    let writes = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") {
        writes += 1;
        remote = { ...remote, catalogRevision: 2, appearance: { ...remote.appearance, selectedThemeId: "warm-paper", selectionRevision: 2 } };
        return Response.json({ error: "The theme selection changed.", code: "revision_conflict", conflict: { resourceKind: "theme-selection", resourceId: "desk", expectedRevision: 1, actualRevision: 2 } }, { status: 409 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    await engine.selectTheme("warm-paper");
    await waitForOutboxDrain(engine);

    expect(writes).toBe(1);
    expect(storage.stats.blockWrites).toBe(0);
    expect((await storage.readDesktopState()).appearance.selectedThemeId).toBe("warm-paper");
    await engine.stop();
  });

  test("persists conflict diagnostics across restart and explicitly rebases keep-local intent", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    let conflict = true;
    const seenBases: Array<number | undefined> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") {
        const body = JSON.parse(String(init?.body)).operations[0] as { baseRevision?: number; systemRole: string };
        if (body.systemRole === "editor-settings") {
          remote = { ...remote, catalogRevision: 2, editorSettings: { ...remote.editorSettings, fontSize: 15 }, settingsRevision: 2 };
          return Response.json({ state: "committed", catalogRevision: 2 });
        }
        seenBases.push(body.baseRevision);
        if (conflict) {
          remote = { ...remote, catalogRevision: 5, layout: { ...remote.layout, gridSize: 12 }, layoutRevision: 5 };
          return Response.json({ error: "The layout changed.", code: "revision_conflict", conflict: { resourceKind: "layout", resourceId: "desk", expectedRevision: 1, actualRevision: 5 } }, { status: 409 });
        }
        remote = { ...remote, catalogRevision: 6, layout: { ...remote.layout, snapToGrid: true }, layoutRevision: 6 };
        return Response.json({ state: "committed", catalogRevision: 6 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const first = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await first.start("desk", { x: 0, y: 0 });
    await first.saveDesktopLayout({ ...remote.layout, gridSize: 36 });
    await waitFor(async () => (await first.getOutboxStatus()).blocked === 1);
    const blocked = (await first.listOutboxRecords())[0];
    expect(blocked).toMatchObject({ errorCode: "revision_conflict", conflictDetails: { resourceKind: "layout", expectedRevision: 1, actualRevision: 5 } });
    await first.saveEditorSettings({ ...remote.editorSettings, fontSize: 15 });
    await waitFor(async () => (await first.listOutboxRecords()).length === 1);
    expect((await first.listOutboxRecords())[0].operationId).toBe(blocked.operationId);
    await first.stop();

    const restarted = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await restarted.start("desk", { x: 0, y: 0 });
    expect((await restarted.listOutboxRecords())[0]).toMatchObject({ errorCode: "revision_conflict", conflictDetails: { actualRevision: 5 } });
    conflict = false;
    await restarted.retryBlockedOutboxRecord(blocked.operationId);
    expect(seenBases).toEqual([1, 5]);
    expect(await restarted.listOutboxRecords()).toEqual([]);
    await restarted.stop();
  });

  test("loads a descriptor-backed content conflict and keeps the current server version", async () => {
    const storage = remoteStorage();
    const remote = { ...remoteDesktopState(), catalogRevision: 2, entries: [{ ...remoteDesktopState().entries[0], revision: 2, contentRevision: 2 }] };
    const operation: OutboxOperation = { schemaVersion: 1, kind: "save-content", entryId: "file-1", mimeType: "text/plain", size: 4, modifiedAt: 2, baseContentRevision: 1 };
    const blocked: OutboxRecord = { operationId: "conflict", sequence: 1, clientId: "client", catalogId: remote.catalogId, desktopId: "desk", operation, status: "blocked", error: "content conflict", errorCode: "revision_conflict", conflictDetails: { resourceKind: "content", resourceId: "file-1", expectedRevision: 1, actualRevision: 2 }, attemptCount: 1, lastAttemptAt: 1 };
    storage.seedOutbox([blocked], new Map([[blocked.operationId, new Map([["file-1", new Blob(["mine"]) ]])]]));
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=2") return Response.json({ entryId: "file-1", contentRevision: 2, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/server", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (String(input) === "https://downloads.example.test/server") return new Response("note");
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });

    const bundle = await engine.loadContentConflict(blocked.operationId);
    expect(await bundle.mine.text()).toBe("mine");
    expect(bundle.base).toBeNull();
    expect(await bundle.server.text()).toBe("note");
    expect(bundle.serverRevision).toBe(2);

    expect(await engine.resolveContentConflictKeepServer(blocked.operationId)).toEqual([]);
    expect(await engine.listOutboxRecords()).toEqual([]);
    expect(await (await engine.readFile("file-1")).text()).toBe("note");
    await engine.stop();
  });

  test("loads a retained server conflict version when refresh is offline", async () => {
    const storage = remoteStorage();
    const remote = { ...remoteDesktopState(), catalogRevision: 2, entries: [{ ...remoteDesktopState().entries[0], revision: 2, contentRevision: 2 }] };
    const operation: OutboxOperation = { schemaVersion: 1, kind: "save-content", entryId: "file-1", mimeType: "text/plain", size: 4, modifiedAt: 2, baseContentRevision: 1 };
    const blocked: OutboxRecord = { operationId: "conflict", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desk", operation, status: "blocked", error: "content conflict", errorCode: "revision_conflict", conflictDetails: { resourceKind: "content", resourceId: "file-1", expectedRevision: 1, actualRevision: 2 }, attemptCount: 1, lastAttemptAt: 1 };
    storage.seedOutbox([blocked], new Map([[blocked.operationId, new Map([["file-1", new Blob(["mine"]) ]])]]));
    storage.seedConflictServer(blocked.operationId, new Blob(["note"]));
    let offline = false;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !offline) return Response.json(remote);
      throw new TypeError("offline");
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    offline = true;

    expect(await (await engine.loadContentConflict(blocked.operationId)).server.text()).toBe("note");
    await engine.stop();
  });

  test("refuses to overwrite a server revision newer than the reviewed merge", async () => {
    const storage = remoteStorage();
    let remote = { ...remoteDesktopState(), catalogRevision: 2, entries: [{ ...remoteDesktopState().entries[0], revision: 2, contentRevision: 2, size: 4 }] };
    let serverContent = new Blob(["note"]);
    const operation: OutboxOperation = { schemaVersion: 1, kind: "save-content", entryId: "file-1", mimeType: "text/plain", size: 4, modifiedAt: 2, baseContentRevision: 1 };
    const blocked: OutboxRecord = { operationId: "conflict", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desk", operation, status: "blocked", error: "content conflict", errorCode: "revision_conflict", conflictDetails: { resourceKind: "content", resourceId: "file-1", expectedRevision: 1, actualRevision: 2 }, attemptCount: 1, lastAttemptAt: 1 };
    storage.seedOutbox([blocked], new Map([[blocked.operationId, new Map([["file-1", new Blob(["mine"]) ]])]]));
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/desktops/desk?projection=web") return Response.json(remote);
      if (url.startsWith("/api/desktops/desk/entries/file-1/content?revision=")) return Response.json({ entryId: "file-1", contentRevision: remote.entries[0].contentRevision, size: serverContent.size, sha256: await sha256Blob(serverContent), access: { url: "https://downloads.example.test/reviewed", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (url === "https://downloads.example.test/reviewed") return new Response(serverContent);
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    const reviewed = await engine.loadContentConflict(blocked.operationId);

    serverContent = new Blob(["newer"]);
    remote = { ...remote, catalogRevision: 3, entries: [{ ...remote.entries[0], revision: 3, contentRevision: 3, size: serverContent.size }] };

    await expect(engine.resolveContentConflictMerged(blocked.operationId, new Blob(["merged"]), reviewed.serverRevision)).rejects.toThrow("changed again");
    expect((await engine.listOutboxRecords())[0].operationId).toBe(blocked.operationId);
    await engine.stop();
  });

  test("keeps a durably selected resolution pending after a transient replay failure", async () => {
    const storage = remoteStorage();
    const remote = { ...remoteDesktopState(), catalogRevision: 2, entries: [{ ...remoteDesktopState().entries[0], revision: 2, contentRevision: 2, size: 4 }] };
    const serverContent = new Blob(["note"]);
    const operation: OutboxOperation = { schemaVersion: 1, kind: "save-content", entryId: "file-1", mimeType: "text/plain", size: 4, modifiedAt: 2, baseContentRevision: 1 };
    const blocked: OutboxRecord = { operationId: "conflict", sequence: 1, clientId: "client", catalogId: remote.catalogId, desktopId: "desk", operation, status: "blocked", error: "content conflict", errorCode: "revision_conflict", conflictDetails: { resourceKind: "content", resourceId: "file-1", expectedRevision: 1, actualRevision: 2 }, attemptCount: 1, lastAttemptAt: 1 };
    storage.seedOutbox([blocked], new Map([[blocked.operationId, new Map([["file-1", new Blob(["mine"]) ]])]]));
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/desktops/desk?projection=web") return Response.json(remote);
      if (url === "/api/desktops/desk/entries/file-1/content?revision=2") return Response.json({ entryId: "file-1", contentRevision: 2, size: 4, sha256: await sha256Blob(serverContent), access: { url: "https://downloads.example.test/transient", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (url === "https://downloads.example.test/transient") return new Response(serverContent);
      if (url === "/api/desktops/desk/entries/transactions" && init?.method === "POST") throw new TypeError("offline");
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    let status = "connecting";
    engine.subscribe(() => undefined, (next) => { status = next; });
    await engine.start("desk", { x: 0, y: 0 });

    const remaining = await engine.resolveContentConflictKeepLocal(blocked.operationId, 2);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ operationId: blocked.operationId, status: "pending", operation: { baseContentRevision: 2 } });
    expect(status).toBe("offline");
    await engine.stop();
  });

  test("queues Mine as a conflict-safe sibling while preserving the current server file", async () => {
    const storage = remoteStorage();
    let remote = { ...remoteDesktopState(), catalogRevision: 2, entries: [{ ...remoteDesktopState().entries[0], revision: 2, contentRevision: 2 }] };
    const operation: OutboxOperation = { schemaVersion: 1, kind: "save-content", entryId: "file-1", mimeType: "text/plain", size: 4, modifiedAt: 2, baseContentRevision: 1 };
    const blocked: OutboxRecord = { operationId: "conflict", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desk", operation, status: "blocked", error: "content conflict", errorCode: "revision_conflict", conflictDetails: { resourceKind: "content", resourceId: "file-1", expectedRevision: 1, actualRevision: 2 }, attemptCount: 1, lastAttemptAt: 1 };
    storage.seedOutbox([blocked], new Map([[blocked.operationId, new Map([["file-1", new Blob(["mine"]) ]])]]));
    let replacementOperationId = "";
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=2") return Response.json({ entryId: "file-1", contentRevision: 2, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/keep-both", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (String(input) === "https://downloads.example.test/keep-both") return new Response("note");
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { items: Array<{ entry: typeof remote.entries[number] }> };
        const entry = body.items[0].entry;
        replacementOperationId = new Headers(init.headers).get("X-Hiraya-Operation-ID") ?? "";
        remote = { ...remote, catalogRevision: 3, entries: [...remote.entries, { ...entry, revision: 3, contentRevision: 3 }] };
        return Response.json({ state: "committed", catalogRevision: 3 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    let latest = desktopStateSnapshot();
    engine.subscribe((desktop) => { latest = desktop; }, () => undefined);
    await engine.start("desk", { x: 0, y: 0 });
    const sibling = await engine.resolveContentConflictKeepBoth(blocked.operationId);
    const [replacement] = await engine.listOutboxRecords();

    expect(sibling).toMatchObject({ parentId: null, name: "notes (local conflict).txt", size: 4 });
    expect(replacement).toMatchObject({ operationId: "1", status: "pending", operation: { kind: "create", entries: [{ id: sibling.id, name: sibling.name }] } });
    expect(replacement.operationId).not.toBe(blocked.operationId);
    expect(replacementOperationId === "" || replacementOperationId === replacement.operationId).toBe(true);
    expect(latest.entries.find((entry) => entry.id === "file-1")?.name).toBe("notes.txt");
    expect(latest.entries.find((entry) => entry.id === sibling.id)?.name).toBe(sibling.name);
    await engine.stop();
  });

  test("discards only the first blocked record and force-reprojects authoritative state", async () => {
    const storage = remoteStorage();
    const remote = remoteDesktopState();
    let latest = desktopStateSnapshot();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") return Response.json({ error: "layout conflict" }, { status: 409 });
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    engine.subscribe((desktop) => { latest = desktop; }, () => undefined);
    await engine.saveDesktopLayout({ ...remote.layout, snapToGrid: true });
    await waitFor(async () => (await engine.getOutboxStatus()).blocked === 1);
    const [blocked] = await engine.listOutboxRecords();
    expect(latest.layout.snapToGrid).toBe(true);

    await engine.discardBlockedOutboxRecord(blocked.operationId);
    expect(await engine.listOutboxRecords()).toEqual([]);
    expect(latest.layout.snapToGrid).toBe(remote.layout.snapToGrid);
    expect(storage.stats.remoteApplications.at(-1)).toEqual({ acknowledgedOperationId: blocked.operationId, force: true, useAcknowledgedContent: false });
    await engine.stop();
  });

  test("explicitly removes a permanently rejected projected desktop without fetching it", async () => {
    const projected = remoteDesktopIdentity("projected", "Projected");
    let records: OutboxRecord[] = [{ operationId: "create", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desk", operation: { schemaVersion: 1, kind: "create-desktop", desktop: projected }, status: "blocked", error: "invalid desktop" }];
    const discarded: Array<{ desktopId: string; operationId: string }> = [];
    const requests: string[] = [];
    const storage = {
      readOutbox: async () => records,
      discardDesktopProjection: async (desktopId: string, operationId: string) => {
        discarded.push({ desktopId, operationId });
        records = [];
        return { operationIds: [operationId], fileIds: [], affectedDesktopIds: [desktopId] };
      },
      listDesktops: async () => ({ desktops: [remoteDesktopIdentity()], activeDesktopId: "desk" }),
      ensureDesktop: async (desktop: ReturnType<typeof remoteDesktopIdentity>) => desktop,
      bindOutboxCatalog: async () => undefined,
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async (input) => {
      requests.push(String(input));
      if (String(input) === "/api/desktops") return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 2, desktops: [remoteDesktopIdentity()], quota: catalogQuota });
      throw new Error(`The projected desktop was fetched: ${String(input)}`);
    }) as typeof fetch });

    expect(await engine.discardBlockedOutboxRecord("create")).toEqual([]);
    expect(discarded).toEqual([{ desktopId: "projected", operationId: "create" }]);
    expect(requests).toEqual(["/api/desktops"]);
  });

  test("resolves revoked desktop dependencies without fetching the revoked desktop", async () => {
    let records: OutboxRecord[] = [{ operationId: "revoked", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "shared", operation: { schemaVersion: 1, kind: "layout", layout: remoteDesktopState().layout }, status: "blocked", error: "Access to this desktop was revoked. Local changes have not been uploaded." }];
    const discarded: string[] = [];
    const requests: string[] = [];
    const storage = {
      readOutbox: async () => records,
      discardDesktopProjection: async (desktopId: string) => {
        discarded.push(desktopId);
        records = [];
        return { operationIds: ["revoked"], fileIds: [], affectedDesktopIds: [desktopId] };
      },
      listDesktops: async () => ({ desktops: [remoteDesktopIdentity()], activeDesktopId: "desk" }),
      ensureDesktop: async (desktop: ReturnType<typeof remoteDesktopIdentity>) => desktop,
      bindOutboxCatalog: async () => undefined,
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage, fetch: (async (input) => {
      requests.push(String(input));
      if (String(input) === "/api/desktops") return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 2, desktops: [remoteDesktopIdentity()], quota: catalogQuota });
      throw new Error(`The revoked desktop was fetched: ${String(input)}`);
    }) as typeof fetch });

    expect(await engine.discardBlockedOutboxRecord("revoked")).toEqual([]);
    expect(discarded).toEqual(["shared"]);
    expect(requests).toEqual(["/api/desktops"]);
  });

  test("rejects discard unless the caller selects the blocked head record", async () => {
    const first: OutboxRecord = { operationId: "first", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desk", operation: { schemaVersion: 1, kind: "layout", layout: remoteDesktopState().layout }, status: "pending", error: null };
    const second: OutboxRecord = { operationId: "second", sequence: 2, clientId: "client", catalogId: "catalog", desktopId: "desk", operation: { schemaVersion: 1, kind: "editor-settings", settings: remoteDesktopState().editorSettings }, status: "blocked", error: "conflict" };
    const records = [first, second];
    const storage = {
      readOutbox: async () => records,
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ storage });

    await expect(engine.discardBlockedOutboxRecord(first.operationId)).rejects.toThrow("Only blocked changes");
    await expect(engine.discardBlockedOutboxRecord(second.operationId)).rejects.toThrow("earlier queued changes");
    expect(records).toEqual([first, second]);
  });

  test("does not remove authoritative local file content from offline storage", async () => {
    const remote = remoteDesktopState();
    const file = { ...remote.entries[0] };
    delete (file as Partial<typeof remote.entries[0]>).revision;
    delete (file as Partial<typeof remote.entries[0]>).contentRevision;
    const current = { ...desktopStateSnapshot(), entries: [file] };
    let removed = false;
    const storage = {
      loadDesktop: async () => current,
      readFile: async () => new File(["note"], "note.txt"),
      removeCachedFile: async () => { removed = true; return true; },
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ frontendOnly: true, storage, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });

    expect(await engine.isFileAvailableOffline("file-1")).toBe(true);
    await expect(engine.removeFileFromOfflineCache("file-1")).rejects.toThrow("Authoritative local file content");
    expect(removed).toBe(false);
    await engine.stop();
  });

  test("does not cache content returned for a different revision", async () => {
    const storage = remoteStorage();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remoteDesktopState());
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=1") return Response.json({ entryId: "file-1", contentRevision: 2, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/file-1", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    await expect(engine.readFile("file-1")).rejects.toThrow("changed while it was loading");
    expect(storage.stats.cacheWrites).toBe(0);
    await engine.stop();
  });

  test("hashes staged saves, uploads directly, and commits before reconciliation", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    const requests: string[] = [];
    let prepareBody: unknown;
    let directInit: RequestInit | undefined;
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        prepareBody = JSON.parse(String(init.body));
        return Response.json({ state: "prepared", transactionId: "upload-1", expiresAt: 2_000_000_000_000, items: [{ entryId: "file-1", access: { url: "https://uploads.example.test/file-1?signature=secret", method: "PUT", headers: { "X-Test-Upload": "yes" }, expiresAt: 2_000_000_000_000 } }] });
      }
      if (String(input).startsWith("https://uploads.example.test/")) {
        directInit = init;
        expect(await new Response(init?.body).text()).toBe("updated note");
        return new Response(null, { status: 200 });
      }
      if (String(input) === "/api/desktops/desk/entries/transactions/upload-1/commit" && init?.method === "POST") {
        await commitGate;
        remote = { ...remote, catalogRevision: 2, entries: [{ ...remote.entries[0], size: 12, revision: 2, contentRevision: 2 }] };
        return Response.json({ state: "committed", catalogRevision: 1 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, createXMLHttpRequest: xhrUsingFetch(fetchImpl) });
    const transferPhases: string[] = [];
    engine.subscribeTransfers((transfers) => {
      const transfer = transfers.find(({ entryId }) => entryId === "file-1");
      if (transfer && transferPhases.at(-1) !== transfer.phase) transferPhases.push(transfer.phase);
    });
    const inventoryUpdates: string[] = [];
    engine.subscribeOfflineStorage((inventory) => inventoryUpdates.push(inventory.desktopId));
    await engine.start("desk", { x: 0, y: 0 });
    await engine.loadOfflineInventory();
    inventoryUpdates.length = 0;
    await engine.saveTextFile("file-1", "updated note");
    await waitFor(() => engine.getTransferSnapshot()[0]?.phase === "finalizing");
    expect(engine.getTransferSnapshot()[0].phase).toBe("finalizing");
    expect((await engine.getOutboxStatus()).pending).toBe(1);
    releaseCommit();
    await waitForOutboxDrain(engine);

    expect(prepareBody).toMatchObject({
      operations: [{ type: "entry.content.write", entryId: "file-1", size: 12, baseRevision: 1, sha256: "977eefe2ccc906a187bc83d1815feaa068bbc1268f3d38f368a9bb2197f1a807", md5: "e2a4459894e14f0f93cc1c007eae90f8" }],
    });
    expect(directInit).toMatchObject({ method: "PUT", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    expect(new Headers(directInit?.headers).get("X-Test-Upload")).toBe("yes");
    expect(requests.indexOf("PUT https://uploads.example.test/file-1?signature=secret")).toBeLessThan(requests.indexOf("POST /api/desktops/desk/entries/transactions/upload-1/commit"));
    expect((await engine.getOutboxStatus()).pending).toBe(0);
    expect(inventoryUpdates).toEqual(["desk"]);
    expect(transferPhases).toEqual(["hashing", "access", "uploading", "finalizing", "complete"]);
    expect(engine.getTransferSnapshot()).toEqual([expect.objectContaining({ direction: "upload", phase: "complete", transferredBytes: 12, totalBytes: 12, error: null })]);
    await engine.stop();
  });

  test("prepares a mixed tree in original order and uploads only its file", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    let preparedItems: Array<{ entry: ReturnType<typeof remoteDesktopState>["entries"][number]; sha256: string; md5: string }> = [];
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { operations: typeof preparedItems & Array<{ type: string }> };
        expect(body.operations.every(({ type }) => type === "entry.create")).toBeTrue();
        preparedItems = body.operations;
        const file = preparedItems.find((item) => item.entry.kind === "file")!;
        return Response.json({ state: "prepared", transactionId: "tree-upload", expiresAt: 2_000_000_000_000, items: [{ entryId: file.entry.id, access: { url: "https://uploads.example.test/tree-file", method: "PUT", headers: {}, expiresAt: 2_000_000_000_000 } }] });
      }
      if (String(input) === "https://uploads.example.test/tree-file") {
        expect(await new Response(init?.body).text()).toBe("leaf");
        return new Response(null, { status: 200 });
      }
      if (String(input) === "/api/desktops/desk/entries/transactions/tree-upload/commit" && init?.method === "POST") {
        remote = { ...remote, catalogRevision: 2, entries: [...remote.entries, ...preparedItems.map(({ entry }) => ({ ...entry, revision: 2, contentRevision: entry.kind === "file" ? 2 : 0 }))] };
        return Response.json({ state: "committed", catalogRevision: 1 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, createXMLHttpRequest: xhrUsingFetch(fetchImpl) });
    await engine.start("desk", { x: 0, y: 0 });
    await engine.pasteEntries({
      selectedRootIds: ["source-folder"],
      entries: [
        { kind: "folder", id: "source-folder", name: "Tree", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 1, y: 2 } },
        { kind: "file", id: "source-file", name: "leaf.txt", parentId: "source-folder", createdAt: 1, modifiedAt: 1, position: { x: 3, y: 4 }, mimeType: "text/plain", size: 4 },
      ],
      contents: new Map([["source-file", new Blob(["leaf"], { type: "text/plain" })]]),
    }, null, new Map([["source-folder", "Tree"]]), new Map([["source-folder", { x: 10, y: 20 }]]));
    await waitForOutboxDrain(engine);

    expect(preparedItems.map(({ entry, sha256, md5 }) => ({ kind: entry.kind, id: entry.id, parentId: entry.parentId, sha256, md5 }))).toEqual([
      { kind: "folder", id: preparedItems[0].entry.id, parentId: null, sha256: "", md5: "" },
      { kind: "file", id: preparedItems[1].entry.id, parentId: preparedItems[0].entry.id, sha256: "9f91161f43433e49a6de6db680d79f60159f2e4ac9172621a12846428158440b", md5: "bab4ff04cc14af66e4d42c85f888cfe6" },
    ]);
    expect(requests.filter((request) => request.startsWith("PUT https://uploads.example.test/"))).toHaveLength(1);
    expect((await engine.getOutboxStatus()).pending).toBe(0);
    await engine.stop();
  });

  test("prepares and commits folder-only creates without upload targets", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    let prepareBody: { operations: Array<{ entry: { id: string; kind: string }; sha256: string; md5: string }> } | undefined;
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        prepareBody = JSON.parse(String(init.body));
        const folder = prepareBody.operations[0].entry;
        remote = { ...remote, catalogRevision: 2, entries: [...remote.entries, { ...folder, name: "Empty", parentId: null, createdAt: 1, modifiedAt: 2, position: { x: 4, y: 5 }, revision: 2, contentRevision: 0 }] };
        return Response.json({ state: "committed", catalogRevision: 2 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    await engine.createFolder("Empty", null, { x: 4, y: 5 });
    await waitForOutboxDrain(engine);

    expect(prepareBody).toMatchObject({ operations: [{ type: "entry.create", entry: { kind: "folder" }, sha256: "", md5: "" }] });
    expect(requests.some((request) => request.startsWith("PUT "))).toBe(false);
    expect(requests).not.toContain("POST /api/desktops/desk/entries/transactions/folder-upload/commit");
    expect((await engine.getOutboxStatus()).pending).toBe(0);
    await engine.stop();
  });

  test("reconciles an already committed prepare without uploading or committing again", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        remote = { ...remote, catalogRevision: 2, entries: [{ ...remote.entries[0], size: 9, revision: 2, contentRevision: 2 }] };
        return Response.json({ state: "committed", catalogRevision: 1 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    await engine.saveTextFile("file-1", "committed");
    await waitForOutboxDrain(engine);

    expect(requests.some((request) => request.startsWith("PUT "))).toBe(false);
    expect(requests.some((request) => request.includes("/commit"))).toBe(false);
    expect((await engine.getOutboxStatus()).pending).toBe(0);
    await engine.stop();
  });

  test("aborts a failed upload and prepares fresh targets on replay", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    let prepares = 0;
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        prepares += 1;
        return Response.json({ state: "prepared", transactionId: `upload-${prepares}`, expiresAt: 2_000_000_000_000, items: [{ entryId: "file-1", access: { url: `https://uploads.example.test/file-1?attempt=${prepares}`, method: "PUT", headers: {}, expiresAt: 2_000_000_000_000 } }] });
      }
      if (String(input) === "https://uploads.example.test/file-1?attempt=1") return new Response(null, { status: 503 });
      if (String(input) === "/api/desktops/desk/entries/transactions/upload-1" && init?.method === "DELETE") return new Response(null, { status: 204 });
      if (String(input) === "https://uploads.example.test/file-1?attempt=2") return new Response(null, { status: 200 });
      if (String(input) === "/api/desktops/desk/entries/transactions/upload-2/commit" && init?.method === "POST") {
        remote = { ...remote, catalogRevision: 2, entries: [{ ...remote.entries[0], size: 5, revision: 2, contentRevision: 2 }] };
        return Response.json({ state: "committed", catalogRevision: 1 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;

    const first = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, createXMLHttpRequest: xhrUsingFetch(fetchImpl) });
    await first.start("desk", { x: 0, y: 0 });
    await first.saveTextFile("file-1", "retry");
    await waitFor(() => first.getTransferSnapshot()[0]?.phase === "failed");
    const failedTransfer = first.getTransferSnapshot()[0];
    expect(failedTransfer).toMatchObject({ direction: "upload", phase: "failed", transferredBytes: 5, totalBytes: 5, error: "Direct file upload failed. The change remains queued." });
    expect((await first.getOutboxStatus()).pending).toBe(1);
    await first.stop();

    const second = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, createXMLHttpRequest: xhrUsingFetch(fetchImpl) });
    const retryStates: Array<{ phase: string; transferredBytes: number }> = [];
    second.subscribeTransfers((transfers) => {
      const transfer = transfers[0];
      if (transfer) retryStates.push({ phase: transfer.phase, transferredBytes: transfer.transferredBytes });
    });
    expect((await second.start("desk", { x: 0, y: 0 })).status).toBe("online");
    expect(prepares).toBe(2);
    expect(requests).toContain("DELETE /api/desktops/desk/entries/transactions/upload-1");
    expect(requests).toContain("PUT https://uploads.example.test/file-1?attempt=2");
    expect(second.getTransferSnapshot()).toEqual([expect.objectContaining({ id: failedTransfer.id, phase: "complete", error: null })]);
    expect(retryStates).toContainEqual({ phase: "hashing", transferredBytes: 0 });
    expect((await second.getOutboxStatus()).pending).toBe(0);
    await second.stop();
  });

  test("restarts prepare, upload, and commit after an expired commit reservation", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    let prepares = 0;
    let commits = 0;
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") {
        prepares += 1;
        return Response.json({ state: "prepared", transactionId: `expired-${prepares}`, expiresAt: 2_000_000_000_000, items: [{ entryId: "file-1", access: { url: `https://uploads.example.test/expired-${prepares}`, method: "PUT", headers: {}, expiresAt: 2_000_000_000_000 } }] });
      }
      if (String(input).startsWith("https://uploads.example.test/expired-")) return new Response(null, { status: 200 });
      if (String(input).includes("/entries/transactions/expired-") && String(input).endsWith("/commit")) {
        commits += 1;
        if (commits === 1) return Response.json({ error: "upload reservation expired" }, { status: 410 });
        remote = { ...remote, catalogRevision: 2, entries: [{ ...remote.entries[0], size: 5, revision: 2, contentRevision: 2 }] };
        return Response.json({ state: "committed", catalogRevision: 1 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;

    const first = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, createXMLHttpRequest: xhrUsingFetch(fetchImpl) });
    await first.start("desk", { x: 0, y: 0 });
    await first.saveTextFile("file-1", "retry");
    expect(await first.getOutboxStatus()).toMatchObject({ pending: 1, blocked: 0 });
    await first.stop();

    const second = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, createXMLHttpRequest: xhrUsingFetch(fetchImpl) });
    expect((await second.start("desk", { x: 0, y: 0 })).status).toBe("online");
    expect(prepares).toBe(2);
    expect(commits).toBe(2);
    expect(requests).toContain("PUT https://uploads.example.test/expired-2");
    expect(requests.some((request) => request.startsWith("DELETE "))).toBe(false);
    expect((await second.getOutboxStatus()).pending).toBe(0);
    await second.stop();
  });

  for (const commitError of [
    { status: 404, message: "upload reservation not found", blocked: false },
    { status: 409, message: "a reserved upload is missing", blocked: false },
    { status: 409, message: "a reserved upload failed size or checksum verification", blocked: false },
    { status: 409, message: "an entry conflicts with existing metadata", blocked: true },
  ]) test(`${commitError.blocked ? "blocks" : "retries"} commit ${commitError.status}: ${commitError.message}`, async () => {
    const storage = remoteStorage();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remoteDesktopState());
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") return Response.json({ state: "prepared", transactionId: "conflict", expiresAt: 2_000_000_000_000, items: [{ entryId: "file-1", access: { url: "https://uploads.example.test/conflict", method: "PUT", headers: {}, expiresAt: 2_000_000_000_000 } }] });
      if (String(input) === "https://uploads.example.test/conflict") return new Response(null, { status: 200 });
      if (String(input) === "/api/desktops/desk/entries/transactions/conflict/commit") return Response.json({ error: commitError.message }, { status: commitError.status });
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, createXMLHttpRequest: xhrUsingFetch(fetchImpl) });
    await engine.start("desk", { x: 0, y: 0 });
    await engine.saveTextFile("file-1", "conflict");
    if (commitError.blocked) await waitFor(async () => (await engine.getOutboxStatus()).blocked === 1);
    else await waitFor(async () => (await engine.getOutboxStatus()).pending === 1);
    expect(await engine.getOutboxStatus()).toMatchObject(commitError.blocked ? { pending: 0, blocked: 1 } : { pending: 1, blocked: 0 });
    expect(storage.stats.blockWrites).toBe(commitError.blocked ? 1 : 0);
    await engine.stop();
  });

  test("retains verified current server bytes before blocking a content revision conflict", async () => {
    const storage = remoteStorage();
    let remote = remoteDesktopState();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web" && !init?.method) return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions" && init?.method === "POST") return Response.json({ state: "prepared", transactionId: "content-conflict", expiresAt: 2_000_000_000_000, items: [{ entryId: "file-1", access: { url: "https://uploads.example.test/content-conflict", method: "PUT", headers: {}, expiresAt: 2_000_000_000_000 } }] });
      if (String(input) === "https://uploads.example.test/content-conflict") return new Response(null, { status: 200 });
      if (String(input) === "/api/desktops/desk/entries/transactions/content-conflict/commit") {
        remote = { ...remote, catalogRevision: 2, entries: [{ ...remote.entries[0], revision: 2, contentRevision: 2 }] };
        return Response.json({ error: "The file content changed.", code: "revision_conflict", conflict: { resourceKind: "content", resourceId: "file-1", expectedRevision: 1, actualRevision: 2 } }, { status: 409 });
      }
      if (String(input) === "/api/desktops/desk/entries/file-1/content?revision=2") return Response.json({ entryId: "file-1", contentRevision: 2, size: 4, sha256: "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8", access: { url: "https://downloads.example.test/conflict-server", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } });
      if (String(input) === "https://downloads.example.test/conflict-server") return new Response("note");
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource, createXMLHttpRequest: xhrUsingFetch(fetchImpl) });
    await engine.start("desk", { x: 0, y: 0 });
    await engine.saveTextFile("file-1", "mine");
    await waitFor(async () => (await engine.getOutboxStatus()).blocked === 1);
    const [blocked] = await engine.listOutboxRecords();
    const retained = await engine.loadContentConflict(blocked.operationId);
    expect(await retained.mine.text()).toBe("mine");
    expect(await retained.server.text()).toBe("note");
    expect(retained.serverRevision).toBe(2);
    await engine.stop();
  });

  test("uses the global entry-transfer endpoint", async () => {
    const remote = remoteDesktopState();
    const storage = remoteStorage();
    let body: unknown;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json(remote);
      if (String(input) === "/api/desktops/desk/entries/transactions") { body = JSON.parse(String(init?.body)); return Response.json({ state: "committed", catalogRevision: 1 }); }
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });
    await engine.transferEntries("other", ["file-1"], null);
    await waitFor(() => body !== undefined);
    expect(body).toEqual({ operations: [{ type: "entry.transfer", desktopId: "desk", destinationDesktopId: "other", entryIds: ["file-1"], parentId: null }] });
    await engine.stop();
  });

  test("reads an optimistic transfer offline after switching desktops and replays it while the destination is active", async () => {
    const file = remoteDesktopState().entries[0];
    const localFile = { ...file };
    delete (localFile as Partial<typeof file>).revision;
    delete (localFile as Partial<typeof file>).contentRevision;
    const base = desktopStateSnapshot();
    const source = { entries: [localFile], snapToGrid: base.layout.snapToGrid, wallpaper: base.layout.wallpaper, editorSettings: base.editorSettings, appearance: base.appearance, sync: { ...base.sync, catalogId: "catalog", catalogRevision: 5, entryRevisions: { [file.id]: 4 }, contentRevisions: { [file.id]: 3 } } };
    const destination = { entries: base.entries, snapToGrid: base.layout.snapToGrid, wallpaper: base.layout.wallpaper, editorSettings: base.editorSettings, appearance: base.appearance, sync: { ...base.sync, catalogId: "catalog", catalogRevision: 5 } };
    const states = new Map([["source", source], ["destination", destination]]);
    let selected = "source";
    let online = false;
    let records: OutboxRecord[] = [];
    const requests: string[] = [];
    const sharedBlob = new File(["note"], file.name, { type: file.mimeType, lastModified: file.modifiedAt });
    const storage = {
      loadDesktop: async () => states.get(selected)!,
      readDesktopState: async (desktopId: string) => states.get(desktopId)!,
      enqueueTransfer: async (sourceDesktopId: string, destinationDesktopId: string, entryIds: string[], parentId: string | null) => {
        const transferred = transferEntriesBetweenDesktopStates(states.get(sourceDesktopId)!, states.get(destinationDesktopId)!, entryIds, parentId, 10);
        states.set(sourceDesktopId, transferred.source);
        states.set(destinationDesktopId, transferred.destination);
        const operation: OutboxOperation = { schemaVersion: 1, kind: "entry-transfer", entryIds, destinationDesktopId, parentId };
        const record: OutboxRecord = { operationId: "transfer", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: sourceDesktopId, operation, status: "pending", error: null };
        records = [record];
        return { desktop: transferred.source, record };
      },
      readOutbox: async () => records,
      bindOutboxCatalog: async () => undefined,
      readCachedFile: async (_desktopId: string, catalogId: string, id: string, revision: number) => catalogId === "catalog" && id === file.id && revision === 3 ? sharedBlob : null,
      applyRemoteDesktop: async (next: ReturnType<typeof desktopStateSnapshot>, _contents: Map<string, Blob>, _acknowledged?: string, desktopId = selected) => { states.set(desktopId, next); return next; },
      acknowledgeMutation: async () => { records = []; },
      blockMutation: async () => undefined,
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      requests.push(request);
      if (!online) throw new TypeError("offline");
      if (String(input) === "/api/desktops/destination?projection=web") return Response.json({ ...remoteDesktopState(), id: "destination", catalogId: "catalog", catalogRevision: 6 });
      if (String(input) === "/api/desktops/source/entries/transactions") return Response.json({ state: "committed", schemaVersion: 2, catalogId: "catalog", catalogRevision: 6 });
      if (String(input) === "/api/desktops/source?projection=web") return Response.json({ ...remoteDesktopState(), id: "source", catalogId: "catalog", catalogRevision: 6, entries: [] });
      throw new Error(`Unexpected request: ${request}`);
    }) as typeof fetch;

    const sourceEngine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await sourceEngine.start("source", { x: 0, y: 0 });
    await sourceEngine.transferEntries("destination", [file.id], null);
    await sourceEngine.stop();

    selected = "destination";
    const destinationOffline = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await destinationOffline.start("destination", { x: 0, y: 0 });
    expect(await (await destinationOffline.readFile(file.id)).text()).toBe("note");
    expect(states.get("destination")!.sync).toMatchObject({ entryRevisions: { [file.id]: 4 }, contentRevisions: { [file.id]: 3 } });
    await destinationOffline.stop();

    online = true;
    const destinationOnline = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    const started = await destinationOnline.start("destination", { x: 0, y: 0 });
    expect(started.status).toBe("online");
    expect(requests).toContain("POST /api/desktops/source/entries/transactions");
    expect(requests).toContain("GET /api/desktops/source?projection=web");
    expect(records).toEqual([]);
    await destinationOnline.stop();
  });
});

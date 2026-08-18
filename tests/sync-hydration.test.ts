import { expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { filesystemDatabaseName, openFilesystemDatabase } from "../src/filesystem/database";
import { hydrationTargetId } from "../src/filesystem/hydration";
import { openHydrationStorage } from "../src/platform/storage/hydration-storage";
import { createHydrationCoordinator } from "../src/sync/hydration";
import { WEB2_SYNC_PROTOCOL, type HydrationRequest } from "../src/sync/protocol";
import type { FilesystemBroadcastChannel } from "../src/platform/storage/workspace-filesystem";

const ACCOUNT = stableId(1);
const WORKSPACE = stableId(2);
const DEVICE = stableId(3);
const DESTINATION = stableId(4);

function stableId(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

class ImmediateLocks {
  readonly names: string[] = [];
  active = 0;
  private readonly tails = new Map<string, Promise<void>>();

  async request<T>(name: string, _options: LockOptions, callback: (lock: Lock) => Promise<T> | T) {
    this.names.push(name);
    _options.signal?.throwIfAborted();
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(name, previous.then(() => current));
    await previous;
    try {
      _options.signal?.throwIfAborted();
      this.active += 1;
      try {
        return await callback({ name, mode: _options.mode ?? "exclusive" } as Lock);
      } finally {
        this.active -= 1;
      }
    } finally {
      release();
    }
  }
}

class RevisionRecorder {
  readonly messages: unknown[] = [];
  readonly names: string[] = [];

  readonly create = (name: string): FilesystemBroadcastChannel => {
    this.names.push(name);
    return {
      postMessage: (value) => { this.messages.push(value); },
      addEventListener: (() => undefined) as BroadcastChannel["addEventListener"],
      removeEventListener: (() => undefined) as BroadcastChannel["removeEventListener"],
      close: () => undefined,
    };
  };
}

function remoteFolder(id: string, name: string, logicalTime: number) {
  const tuple = { logicalTime, operationId: stableId(300 + logicalTime) };
  return { workspaceId: WORKSPACE, id, kind: "folder" as const, name, parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
}

function response(request: HydrationRequest, nodes: ReturnType<typeof remoteFolder>[], nextPageToken: string | null, observedLogicalTime = 10) {
  return {
    schemaVersion: 1,
    protocol: WEB2_SYNC_PROTOCOL,
    workspaceId: request.workspaceId,
    deviceId: request.deviceId,
    generationId: request.generationId,
    pageIndex: request.pageIndex,
    observedLogicalTime,
    target: request.target,
    nodes,
    settings: [],
    nextPageToken,
  };
}

test("publishes bootstrap metadata and resumes its private root generation", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  const environment = { storageId: ACCOUNT, indexedDB, IDBKeyRange, randomUUID: () => DEVICE, locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: revisions.create };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  expect(await database.getOrCreateDeviceId()).toBe(DEVICE);
  database.close();
  const generationId = stableId(90);
  const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 1 };
  const firstNode = remoteFolder(stableId(91), "First", 10);
  const secondNode = remoteFolder(stableId(92), "Second", 10);
  const finalNode = remoteFolder(stableId(94), "Final", 10);
  const bootstrapResponse = {
    schemaVersion: 1,
    protocol: WEB2_SYNC_PROTOCOL,
    accountId: ACCOUNT,
    deviceId: DEVICE,
    cursor: 9,
    workspaces: [{ id: WORKSPACE, name: "Main", pinned: true }, { id: DESTINATION, name: "Archive", pinned: false }],
    workspace: { id: WORKSPACE, name: "Main", pinned: true, headSequence: 10, snapshotBarrier: 8, logFloor: 2 },
    rootPage: { schemaVersion: 1, protocol: WEB2_SYNC_PROTOCOL, workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [firstNode], settings: [], nextPageToken: "next" },
    workspaceSettings: [{ workspaceId: WORKSPACE, namespace: "desktop-grid", key: "grid-size", deleted: false, value: 24, logicalTime: 1, operationId: stableId(93) }],
  };
  const coordinator = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment));
  const bootstrapped = await coordinator.bootstrap(bootstrapResponse);
  expect(bootstrapped.changes).toEqual([]);

  const staged = await openFilesystemDatabase(ACCOUNT, environment);
  expect((await staged.listWorkspaces()).map(({ name }) => name)).toEqual(["Main", "Archive"]);
  expect(await staged.queryFolderChildren(WORKSPACE, null)).toEqual({ availability: "unavailable" });
  expect(await staged.getSetting(WORKSPACE, "desktop-grid", "grid-size")).toBeUndefined();
  expect(await staged.getHydrationProgress(WORKSPACE, hydrationTargetId(target), generationId)).toEqual({ nextPageIndex: 1, pageToken: "next", complete: false });
  await staged.stageHydrationPage(hydrationTargetId(target), "next", { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 1, observedLogicalTime: 10, target, nodes: [secondNode], settings: [], nextPageToken: "last" });
  staged.close();
  await coordinator.bootstrap(bootstrapResponse);
  const retried = await openFilesystemDatabase(ACCOUNT, environment);
  expect(await retried.getHydrationProgress(WORKSPACE, hydrationTargetId(target), generationId)).toEqual({ nextPageIndex: 2, pageToken: "last", complete: false });
  retried.close();

  const changes = await coordinator.hydrate(target, async (request) => response(request, [finalNode], null));
  await coordinator.close();
  expect(changes).toMatchObject([{ kind: "hydration", workspaceId: WORKSPACE, revision: 1, operationId: generationId }]);
  expect(revisions.messages).toEqual([
    { schemaVersion: 1, kind: "catalog-change" },
    { schemaVersion: 1, kind: "catalog-change" },
    { schemaVersion: 1, workspaceId: WORKSPACE, revision: 1 },
  ]);
  const published = await openFilesystemDatabase(ACCOUNT, environment);
  expect((await published.listChildren(WORKSPACE, null)).map(({ id }) => id).sort()).toEqual([firstNode.id, secondNode.id, finalNode.id].sort());
  expect(await published.getSetting(WORKSPACE, "desktop-grid", "grid-size")).toMatchObject({ value: 24 });
  expect(await published.getSyncState(WORKSPACE)).toMatchObject({ cursor: 9, lastHydrationAsOf: 10 });
  const clearGeneration = stableId(95);
  const clearTarget = { ...target, asOf: 11, limit: 100 };
  const clearChanges = await published.publishHydration(WORKSPACE, hydrationTargetId(clearTarget), clearGeneration, {
    accountId: ACCOUNT,
    deviceId: DEVICE,
    cursor: 9,
    workspaces: bootstrapResponse.workspaces,
    workspace: { ...bootstrapResponse.workspace, headSequence: 11 },
    rootPage: { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: clearGeneration, pageIndex: 0, observedLogicalTime: 11, target: clearTarget, nodes: [firstNode, secondNode, finalNode], settings: [], nextPageToken: null },
    workspaceSettings: [],
  });
  expect(await published.getSetting(WORKSPACE, "desktop-grid", "grid-size")).toBeUndefined();
  expect(clearChanges[0]!.affectedIdentities).toEqual(expect.arrayContaining([
    `setting:${WORKSPACE}:desktop-grid:auto-arrange-icons`,
    `setting:${WORKSPACE}:desktop-grid:grid-size`,
    `setting:${WORKSPACE}:desktop-grid:snap-to-grid`,
    `setting-namespace:${WORKSPACE}:desktop-grid`,
  ]));
  published.close();
});

test("applies a parsed operation pull under storage locks and broadcasts after commit", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  const environment = { storageId: ACCOUNT, indexedDB, IDBKeyRange, randomUUID: () => DEVICE, locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: revisions.create };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  await database.getOrCreateDeviceId();
  const generationId = stableId(80);
  const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
  await database.publishHydration(WORKSPACE, hydrationTargetId(target), generationId, {
    accountId: ACCOUNT,
    deviceId: DEVICE,
    cursor: 10,
    workspaces: [{ id: WORKSPACE, name: "Main", pinned: true }],
    workspace: { id: WORKSPACE, name: "Main", pinned: true, headSequence: 10, snapshotBarrier: 8, logFloor: 2 },
    rootPage: { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [], settings: [], nextPageToken: null },
    workspaceSettings: [],
  });
  database.close();
  const operationId = stableId(81);
  const coordinator = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment));
  const result = await coordinator.applyPull({
    schemaVersion: 1,
    protocol: WEB2_SYNC_PROTOCOL,
    kind: "operations",
    workspaceId: WORKSPACE,
    deviceId: DEVICE,
    fromCursor: 10,
    cursor: 11,
    headSequence: 11,
    snapshotBarrier: 8,
    logFloor: 2,
    observedLogicalTime: 11,
    operations: [{ sequence: 11, operationId, companion: null, nodes: [], settings: [{ workspaceId: WORKSPACE, namespace: "editor", key: "font-size", deleted: false, value: 18, logicalTime: 11, operationId }] }],
  });
  await coordinator.close();
  expect(result.changes).toMatchObject([{ kind: "pull", workspaceId: WORKSPACE, revision: 2, operationId, fromCursor: 10, cursor: 11 }]);
  expect(revisions.messages).toEqual([{ schemaVersion: 1, kind: "catalog-change" }, { schemaVersion: 1, workspaceId: WORKSPACE, revision: 2 }]);
  expect(locks.names).toContain(`${await filesystemDatabaseName(ACCOUNT)}-workspace-${WORKSPACE}`);
  const published = await openFilesystemDatabase(ACCOUNT, environment);
  expect(await published.getSetting(WORKSPACE, "editor", "font-size")).toMatchObject({ value: 18 });
  expect(await published.getSyncState(WORKSPACE)).toMatchObject({ cursor: 11 });
  published.close();
});

test("resumes a durable hydration generation and broadcasts its published revision", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  let nextGeneration = 100;
  const environment = {
    storageId: ACCOUNT,
    indexedDB,
    IDBKeyRange,
    locks: locks as unknown as Pick<LockManager, "request">,
    createBroadcastChannel: revisions.create,
  };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  await database.createWorkspace({ id: WORKSPACE, name: "Workspace", pinned: true, deviceId: DEVICE });
  database.close();

  const firstNode = remoteFolder(stableId(200), "First", 10);
  const secondNode = remoteFolder(stableId(201), "Second", 10);
  const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 1 };
  const targetId = hydrationTargetId(target);
  const requested: HydrationRequest[] = [];
  const controller = new AbortController();
  const first = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  await expect(first.hydrate(target, async (request) => {
    expect(locks.active).toBe(0);
    requested.push(request);
    if (request.pageIndex === 0) return response(request, [firstNode], "next");
    throw new Error("injected transport failure");
  }, { signal: controller.signal })).rejects.toThrow("injected transport failure");
  await first.close();

  const staged = await openFilesystemDatabase(ACCOUNT, environment);
  expect(await staged.getNode(firstNode.id)).toBeUndefined();
  expect(await staged.getHydrationGeneration(WORKSPACE, targetId)).toMatchObject({ generationId: stableId(100), target });
  expect(await staged.getHydrationProgress(WORKSPACE, targetId, stableId(100))).toEqual({ nextPageIndex: 1, pageToken: "next", complete: false });
  staged.close();

  const resumed = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  const changes = await resumed.hydrate(target, async (request) => {
    expect(locks.active).toBe(0);
    requested.push(request);
    return response(request, [secondNode], null);
  }, { signal: controller.signal });
  await resumed.close();
  const recovered = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  const recoveredChanges = await recovered.hydrate(target, async () => { throw new Error("Published hydration must not request another page."); });
  await recovered.close();

  expect(requested.map(({ generationId, pageIndex, pageToken }) => ({ generationId, pageIndex, pageToken }))).toEqual([
    { generationId: stableId(100), pageIndex: 0, pageToken: null },
    { generationId: stableId(100), pageIndex: 1, pageToken: "next" },
    { generationId: stableId(100), pageIndex: 1, pageToken: "next" },
  ]);
  expect(nextGeneration).toBe(101);
  expect(changes).toMatchObject([{ kind: "hydration", workspaceId: WORKSPACE, revision: 1, targetId }]);
  expect(recoveredChanges).toEqual(changes);
  expect(revisions.messages).toEqual([
    { schemaVersion: 1, workspaceId: WORKSPACE, revision: 1 },
    { schemaVersion: 1, workspaceId: WORKSPACE, revision: 1 },
  ]);
  expect(locks.names).toContain(`${await filesystemDatabaseName(ACCOUNT)}-storage`);
  expect(locks.names).toContain(`${await filesystemDatabaseName(ACCOUNT)}-workspace-${WORKSPACE}`);
  const published = await openFilesystemDatabase(ACCOUNT, environment);
  expect((await published.listChildren(WORKSPACE, null)).map(({ id }) => id)).toEqual([firstNode.id, secondNode.id]);
  expect(await published.getHydrationCoverage(WORKSPACE, targetId)).toMatchObject({ generationId: stableId(100), memberIds: [firstNode.id, secondNode.id] });
  expect(await published.getHydrationGeneration(WORKSPACE, targetId)).toBeUndefined();
  published.close();
});

test("restarts an expired continuation with a fresh durable generation", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  const environment = { storageId: ACCOUNT, indexedDB, IDBKeyRange, locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: revisions.create };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  await database.createWorkspace({ id: WORKSPACE, name: "Workspace", pinned: true, deviceId: DEVICE });
  database.close();
  let generation = 500;
  const coordinator = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(generation++));
  const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 1 };
  const requests: HydrationRequest[] = [];
  await expect(coordinator.hydrate(target, async (request) => {
    requests.push(request);
    if (request.pageIndex === 0) return response(request, [remoteFolder(stableId(510), "Expired", 10)], "expired");
    throw new Error("continuation expired");
  })).rejects.toThrow("continuation expired");

  let releaseResume!: () => void;
  const resumeGate = new Promise<void>((resolve) => { releaseResume = resolve; });
  let resumeStarted!: () => void;
  const activeResume = new Promise<void>((resolve) => { resumeStarted = resolve; });
  const staleResume = coordinator.hydrate(target, async (request) => {
    requests.push(request);
    resumeStarted();
    await resumeGate;
    return response(request, [remoteFolder(stableId(512), "Stale", 10)], null);
  });
  await activeResume;
  await coordinator.hydrate(target, async (request) => {
    requests.push(request);
    return response(request, [remoteFolder(stableId(511), "Fresh", 10)], null);
  }, { restart: true });
  releaseResume();
  await expect(staleResume).rejects.toThrow("superseded");
  await coordinator.close();

  expect(requests.map(({ generationId, pageIndex }) => ({ generationId, pageIndex }))).toEqual([
    { generationId: stableId(500), pageIndex: 0 },
    { generationId: stableId(500), pageIndex: 1 },
    { generationId: stableId(500), pageIndex: 1 },
    { generationId: stableId(501), pageIndex: 0 },
  ]);
  const published = await openFilesystemDatabase(ACCOUNT, environment);
  expect((await published.listChildren(WORKSPACE, null)).map(({ id }) => id)).toEqual([stableId(511)]);
  expect(await published.getHydrationGeneration(WORKSPACE, hydrationTargetId(target))).toBeUndefined();
  published.close();
});

test("concurrent callers share one generation and publication", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  const environment = { storageId: ACCOUNT, indexedDB, IDBKeyRange, locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: revisions.create };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  await database.createWorkspace({ id: WORKSPACE, name: "Workspace", pinned: true, deviceId: DEVICE });
  database.close();
  let nextGeneration = 700;
  const coordinator = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 1 };
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  let started = 0;
  let bothStarted!: () => void;
  const ready = new Promise<void>((resolve) => { bothStarted = resolve; });
  const request = async (value: HydrationRequest) => {
    started += 1;
    if (started === 2) bothStarted();
    await responseGate;
    return response(value, [remoteFolder(stableId(710), "Shared", 10)], null);
  };
  const first = coordinator.hydrate(target, request);
  const second = coordinator.hydrate(target, request);
  await ready;
  release();
  const results = await Promise.all([first, second]);
  await coordinator.close();

  expect(nextGeneration).toBe(701);
  expect(results.map((changes) => changes.length)).toEqual([1, 1]);
  expect(revisions.messages).toEqual([
    { schemaVersion: 1, workspaceId: WORKSPACE, revision: 1 },
    { schemaVersion: 1, workspaceId: WORKSPACE, revision: 1 },
  ]);
});

test("broadcasts every workspace revision changed by transfer replay", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  const environment = { storageId: ACCOUNT, indexedDB, IDBKeyRange, now: () => 100, locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: revisions.create };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  await database.createWorkspace({ id: WORKSPACE, name: "Source", pinned: true, deviceId: DEVICE });
  await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
  const node = remoteFolder(stableId(720), "Transferred", 10);
  const exactTarget = { kind: "exact-nodes" as const, workspaceId: WORKSPACE, asOf: 10, nodeIds: [node.id] };
  const exactTargetId = hydrationTargetId(exactTarget);
  const initialGeneration = stableId(721);
  await database.beginHydration(exactTargetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: initialGeneration, target: exactTarget });
  await database.stageHydrationPage(exactTargetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: initialGeneration, pageIndex: 0, observedLogicalTime: 10, target: exactTarget, nodes: [node], settings: [], nextPageToken: null });
  await database.publishHydration(WORKSPACE, exactTargetId, initialGeneration);
  await database.commitOperation({ operation: { schemaVersion: 1, kind: "transfer", operationId: stableId(722), workspaceId: WORKSPACE, deviceId: DEVICE, nodeIds: [node.id], destinationWorkspaceId: DESTINATION, parentId: null, modifiedAt: 20 } });
  database.close();

  const coordinator = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(723));
  const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 20, parentId: null, limit: 1 };
  const refreshed = remoteFolder(node.id, node.name, 20);
  refreshed.position = { x: 9, y: 9 };
  refreshed.fieldTuples.position = { logicalTime: 200, operationId: stableId(724) };
  const changes = await coordinator.hydrate(target, async (request) => response(request, [refreshed], null, 200));
  await coordinator.close();

  expect(changes.map(({ workspaceId }) => workspaceId).sort()).toEqual([WORKSPACE, DESTINATION].sort());
  expect(revisions.messages).toEqual([
    { schemaVersion: 1, workspaceId: WORKSPACE, revision: 3 },
    { schemaVersion: 1, workspaceId: DESTINATION, revision: 2 },
  ]);
});

test("resumes a multi-page cursor reset after leader failover and rebroadcasts recovery", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  const environment = { storageId: ACCOUNT, indexedDB, IDBKeyRange, locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: revisions.create };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  await database.createWorkspace({ id: WORKSPACE, name: "Workspace", pinned: true, deviceId: DEVICE });
  const firstNode = remoteFolder(stableId(800), "First", 0);
  const secondNode = remoteFolder(stableId(801), "Second", 8);
  const staleTarget = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 0, parentId: null, limit: 1 };
  const staleTargetId = hydrationTargetId(staleTarget);
  const staleGeneration = stableId(802);
  await database.beginHydration(staleTargetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: staleGeneration, target: staleTarget });
  await database.stageHydrationPage(staleTargetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: staleGeneration, pageIndex: 0, observedLogicalTime: 0, target: staleTarget, nodes: [firstNode], settings: [], nextPageToken: null });
  await database.publishHydration(WORKSPACE, staleTargetId, staleGeneration);
  database.close();
  const reset = { schemaVersion: 1, protocol: WEB2_SYNC_PROTOCOL, kind: "reset" as const, workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 0, cursor: 8, headSequence: 10, snapshotBarrier: 8, logFloor: 1, observedLogicalTime: 8, resetBarrier: 8 };
  let nextGeneration = 810;
  const requested: HydrationRequest[] = [];
  const page = (request: HydrationRequest) => {
    requested.push(request);
    if (request.target.kind === "exact-nodes") return response(request, [firstNode], null, 8);
    if (request.pageIndex === 0) return response(request, [firstNode], "next", 8);
    return response(request, [secondNode], null, 8);
  };
  const first = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  await expect(first.applyPull(reset, async (request) => {
    const value = page(request);
    if (request.target.kind === "folder-page" && request.pageIndex === 1) throw new Error("leader stopped");
    return value;
  })).rejects.toThrow("leader stopped");
  await first.close();
  const staged = await openFilesystemDatabase(ACCOUNT, environment);
  expect(await staged.getSyncState(WORKSPACE)).toMatchObject({ cursor: 0, lastObservedLogicalTime: 0 });
  staged.close();
  const fenced = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  await expect(fenced.hydrate({ kind: "exact-settings", workspaceId: WORKSPACE, asOf: 8, namespace: "editor", keys: ["font-size"] }, async () => { throw new Error("Fenced hydration must not fetch."); })).rejects.toThrow("fenced");
  await fenced.close();

  const resumed = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  const result = await resumed.applyPull(reset, async (request) => {
    expect(locks.active).toBe(0);
    return page(request);
  });
  await resumed.close();
  expect(result.changes).toMatchObject([{ kind: "reset", workspaceId: WORKSPACE, revision: 2, fromCursor: 0, cursor: 8 }]);
  const resumedFolderRequests = requested.filter(({ target }) => target.kind === "folder-page").map(({ pageIndex }) => pageIndex);
  expect(resumedFolderRequests).toEqual([0, 1, 1]);
  const published = await openFilesystemDatabase(ACCOUNT, environment);
  expect(await published.getSyncState(WORKSPACE)).toMatchObject({ cursor: 8, lastHydrationAsOf: 8, lastObservedLogicalTime: 8 });
  expect((await published.listChildren(WORKSPACE, null)).map(({ id }) => id).sort()).toEqual([firstNode.id, secondNode.id].sort());
  published.close();

  const recovered = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  expect((await recovered.applyPull(reset, async () => { throw new Error("A committed reset must not fetch pages."); })).changes).toEqual(result.changes);
  await recovered.close();
  expect(revisions.messages).toEqual([
    { schemaVersion: 1, kind: "catalog-change" },
    { schemaVersion: 1, workspaceId: WORKSPACE, revision: 2 },
    { schemaVersion: 1, kind: "catalog-change" },
    { schemaVersion: 1, workspaceId: WORKSPACE, revision: 2 },
  ]);
});

test("explicitly restarts an expired reset continuation with a fresh generation", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  const environment = { storageId: ACCOUNT, indexedDB, IDBKeyRange, locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: revisions.create };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  await database.createWorkspace({ id: WORKSPACE, name: "Workspace", pinned: true, deviceId: DEVICE });
  const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 0, parentId: null, limit: 1 };
  const generationId = stableId(900);
  await database.beginHydration(hydrationTargetId(target), { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, target });
  await database.stageHydrationPage(hydrationTargetId(target), null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 0, target, nodes: [], settings: [], nextPageToken: null });
  await database.publishHydration(WORKSPACE, hydrationTargetId(target), generationId);
  database.close();
  const reset = { schemaVersion: 1, protocol: WEB2_SYNC_PROTOCOL, kind: "reset" as const, workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 0, cursor: 8, headSequence: 8, snapshotBarrier: 8, logFloor: 1, observedLogicalTime: 8, resetBarrier: 8 };
  let nextGeneration = 901;
  const coordinator = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(nextGeneration++));
  const requests: HydrationRequest[] = [];
  await expect(coordinator.applyPull(reset, async (request) => {
    requests.push(request);
    if (request.pageIndex === 0) return response(request, [], "expired", 8);
    throw new Error("continuation expired");
  })).rejects.toThrow("continuation expired");
  await coordinator.applyPull(reset, async (request) => {
    requests.push(request);
    return response(request, [], null, 8);
  }, { restart: true });
  await coordinator.close();
  const folderRequests = requests.filter(({ target: requestTarget }) => requestTarget.kind === "folder-page");
  expect(folderRequests.map(({ pageIndex }) => pageIndex)).toEqual([0, 1, 0]);
  expect(folderRequests[0]!.generationId).not.toBe(folderRequests[2]!.generationId);
});

test("close aborts and drains an in-flight hydration request", async () => {
  const indexedDB = new IDBFactory();
  const locks = new ImmediateLocks();
  const revisions = new RevisionRecorder();
  const environment = { storageId: ACCOUNT, indexedDB, IDBKeyRange, locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: revisions.create };
  const database = await openFilesystemDatabase(ACCOUNT, environment);
  await database.createWorkspace({ id: WORKSPACE, name: "Workspace", pinned: true, deviceId: DEVICE });
  database.close();
  const coordinator = createHydrationCoordinator(await openHydrationStorage(ACCOUNT, environment), () => stableId(600));
  const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 1 };
  let started!: () => void;
  const active = new Promise<void>((resolve) => { started = resolve; });
  const hydration = coordinator.hydrate(target, async (_request, signal) => {
    started();
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  await active;
  await coordinator.close();
  await expect(hydration).rejects.toMatchObject({ name: "AbortError" });
  expect(revisions.messages).toEqual([]);
});

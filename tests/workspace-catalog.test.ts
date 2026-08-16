import { expect, test } from "bun:test";
import { IDBDatabase, IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { filesystemDatabaseName, openFilesystemDatabase } from "../src/filesystem/database";
import { openWorkspaceCatalog, type WorkspaceCatalogEnvironment } from "../src/platform/storage/workspace-catalog";
import { openWorkspaceFilesystem, type FilesystemBroadcastChannel } from "../src/platform/storage/workspace-filesystem";
import { MemoryDirectory, memoryOpfsHandle } from "./support/memory-opfs";
import { initializeLocalWeb2Storage, LOCAL_WEB2_ACCOUNT_ID } from "../src/platform/storage/local-startup";

const ACCOUNT = stableId(1);
const DEVICE = stableId(2);

function stableId(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function idbRequest<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function openRaw(factory: IDBFactory, name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

class TestSessionStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class TestBroadcastChannels {
  private readonly channels = new Map<string, Set<Set<(event: MessageEvent<unknown>) => void>>>();

  readonly create = (name: string): FilesystemBroadcastChannel => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const peers = this.channels.get(name) ?? new Set();
    peers.add(listeners);
    this.channels.set(name, peers);
    return {
      postMessage: (value: unknown) => {
        for (const peer of peers) if (peer !== listeners) setTimeout(() => {
          if (peers.has(peer)) for (const listener of peer) listener({ data: value } as MessageEvent<unknown>);
        }, 0);
      },
      addEventListener: ((type: string, listener: (event: MessageEvent<unknown>) => void) => { if (type === "message") listeners.add(listener); }) as BroadcastChannel["addEventListener"],
      removeEventListener: ((type: string, listener: (event: MessageEvent<unknown>) => void) => { if (type === "message") listeners.delete(listener); }) as BroadcastChannel["removeEventListener"],
      close: () => {
        peers.delete(listeners);
        if (peers.size === 0) this.channels.delete(name);
      },
    };
  };
}

class TestLocks {
  readonly calls: Array<{ name: string; mode: LockMode }> = [];
  private readonly states = new Map<string, { readers: number; writer: boolean; queue: Array<{ mode: LockMode; operation: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }> }>();

  request<T>(name: string, options: LockOptions, operation: () => Promise<T>) {
    const mode = options.mode ?? "exclusive";
    this.calls.push({ name, mode });
    const state = this.states.get(name) ?? { readers: 0, writer: false, queue: [] };
    this.states.set(name, state);
    const result = new Promise<T>((resolve, reject) => state.queue.push({ mode, operation, resolve: resolve as (value: unknown) => void, reject }));
    this.drain(name);
    return result;
  }

  private drain(name: string) {
    const state = this.states.get(name)!;
    if (state.writer || state.queue.length === 0 || state.readers > 0 && state.queue[0]!.mode === "exclusive") return;
    const start = (entry: typeof state.queue[number]) => {
      if (entry.mode === "exclusive") state.writer = true;
      else state.readers += 1;
      void entry.operation().then(entry.resolve, entry.reject).finally(() => {
        if (entry.mode === "exclusive") state.writer = false;
        else state.readers -= 1;
        this.drain(name);
      });
    };
    if (state.queue[0]!.mode === "exclusive") start(state.queue.shift()!);
    else while (state.queue[0]?.mode === "shared" && !state.writer) start(state.queue.shift()!);
  }
}

const flushBroadcasts = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function testEnvironment(indexedDB = new IDBFactory()) {
  const locks = new TestLocks();
  const broadcasts = new TestBroadcastChannels();
  const sessionStorage = new TestSessionStorage();
  let nextId = 100;
  const environment = {
    indexedDB,
    IDBKeyRange,
    locks: locks as unknown as Pick<LockManager, "request">,
    createBroadcastChannel: broadcasts.create,
    sessionStorage,
    randomUUID: () => stableId(nextId++),
  } satisfies WorkspaceCatalogEnvironment;
  return { environment, locks };
}

test("initializes one stable browser-local identity and workspace across tabs and reload", async () => {
  const { environment } = testEnvironment();
  const [first, second] = await Promise.all([initializeLocalWeb2Storage(environment), initializeLocalWeb2Storage(environment)]);
  expect(first.accountId).toBe(LOCAL_WEB2_ACCOUNT_ID);
  expect(second.deviceId).toBe(first.deviceId);
  expect(second.activeWorkspaceId).toBe(first.activeWorkspaceId);
  expect(await first.catalog.listWorkspaces()).toEqual([{ id: first.activeWorkspaceId, name: "Home", pinned: true, ordinal: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 }]);
  first.catalog.close();
  second.catalog.close();

  const reopened = await initializeLocalWeb2Storage(environment);
  expect(reopened).toMatchObject({ accountId: LOCAL_WEB2_ACCOUNT_ID, deviceId: first.deviceId, activeWorkspaceId: first.activeWorkspaceId });
  expect(await reopened.catalog.listWorkspaces()).toHaveLength(1);
  reopened.catalog.close();
});

test("creates, renames, orders, pins, selects, and deletes workspaces across reload", async () => {
  const { environment, locks } = testEnvironment();
  const catalog = await openWorkspaceCatalog(ACCOUNT, DEVICE, environment);
  const observer = await openWorkspaceCatalog(ACCOUNT, DEVICE, environment);
  let wakeups = 0;
  const stop = observer.onChangesAvailable(() => { wakeups += 1; });
  const beta = await catalog.createWorkspace({ name: "Beta" });
  const pinned = await catalog.createWorkspace({ name: "Pinned", pinned: true });
  const alpha = await catalog.createWorkspace({ name: "Gamma" });
  expect((await catalog.listWorkspaces()).map(({ name, pinned, ordinal }) => ({ name, pinned, ordinal }))).toEqual([
    { name: "Pinned", pinned: true, ordinal: 0 },
    { name: "Beta", pinned: false, ordinal: 1 },
    { name: "Gamma", pinned: false, ordinal: 2 },
  ]);
  await expect(catalog.setWorkspacePreferences([{ id: pinned.id, pinned: true }])).rejects.toThrow("complete directory");
  await expect(catalog.setWorkspacePreferences([{ id: beta.id, pinned: false }, { id: pinned.id, pinned: true }, { id: alpha.id, pinned: false }])).rejects.toThrow("invalid");
  await catalog.renameWorkspace(alpha.id, "Alpha");
  await expect(catalog.renameWorkspace(alpha.id, "beta")).rejects.toThrow("already uses");
  await catalog.pinWorkspace(beta.id, true);
  await catalog.moveWorkspace(beta.id, -1);
  expect((await catalog.listWorkspaces()).map(({ id }) => id)).toEqual([beta.id, pinned.id, alpha.id]);
  await catalog.setActiveWorkspace(alpha.id);
  expect((await catalog.resolveActiveWorkspace()).id).toBe(alpha.id);
  catalog.close();

  const reopened = await openWorkspaceCatalog(ACCOUNT, DEVICE, environment);
  expect((await reopened.resolveActiveWorkspace()).id).toBe(alpha.id);
  await reopened.deleteWorkspace(alpha.id);
  expect((await reopened.resolveActiveWorkspace()).id).toBe(beta.id);
  await reopened.deleteWorkspace(pinned.id);
  await expect(reopened.deleteWorkspace(beta.id)).rejects.toThrow("final workspace");
  await flushBroadcasts();
  expect((await observer.listWorkspaces()).map(({ id, ordinal }) => ({ id, ordinal }))).toEqual([{ id: beta.id, ordinal: 0 }]);
  expect(wakeups).toBe(8);
  expect(locks.calls.some(({ name, mode }) => name.endsWith("-storage") && mode === "exclusive")).toBe(true);
  expect(locks.calls.some(({ name, mode }) => name.endsWith("-catalog") && mode === "exclusive")).toBe(true);
  stop();
  reopened.close();
  observer.close();
});

test("deleting a workspace preserves transferred files, shared chunks, and destination change history", async () => {
  const indexedDB = new IDBFactory();
  const origin = new MemoryDirectory();
  const { environment } = testEnvironment(indexedDB);
  const fullEnvironment = { ...environment, originRoot: memoryOpfsHandle(origin), now: () => 100 };
  const catalog = await openWorkspaceCatalog(ACCOUNT, DEVICE, fullEnvironment);
  const sourceWorkspace = await catalog.createWorkspace({ name: "Source", pinned: true });
  const destinationWorkspace = await catalog.createWorkspace({ name: "Destination" });
  const source = await openWorkspaceFilesystem(ACCOUNT, sourceWorkspace.id, fullEnvironment);
  const destination = await openWorkspaceFilesystem(ACCOUNT, destinationWorkspace.id, fullEnvironment);
  const file = await source.createFile({ name: "Transfer.txt", content: new Blob(["shared bytes"], { type: "text/plain" }) });
  const disposable = await source.createFolder({ name: "Disposable" });
  const retainedOperation = (await source.listOperations()).find(({ operation }) => operation.kind === "create" && operation.nodes.some(({ id }) => id === file.id))!;
  await source.transferNodes(destinationWorkspace.id, [file.id], null);
  const malformedNodeId = stableId(9_000);
  const databaseName = await filesystemDatabaseName(ACCOUNT);
  const raw = await openRaw(indexedDB, databaseName);
  await Promise.all([
    idbRequest(raw.transaction("nodes", "readwrite").objectStore("nodes").put({ id: malformedNodeId, workspaceId: sourceWorkspace.id, parentKey: "", lifecycleKey: "broken" })),
    idbRequest(raw.transaction("settings", "readwrite").objectStore("settings").put({ workspaceId: sourceWorkspace.id, namespace: 99, key: "broken" })),
    idbRequest(raw.transaction("changes", "readwrite").objectStore("changes").put({ workspaceId: sourceWorkspace.id, revision: "broken" })),
    idbRequest(raw.transaction("hydration-pages", "readwrite").objectStore("hydration-pages").put({ workspaceId: sourceWorkspace.id, targetId: 99, pageIndex: "broken" })),
    idbRequest(raw.transaction("hydration-coverage", "readwrite").objectStore("hydration-coverage").put({ workspaceId: sourceWorkspace.id, targetId: 99 })),
  ]);
  raw.close();

  await catalog.deleteWorkspace(sourceWorkspace.id);
  await expect(source.createFolder({ name: "Stale" })).rejects.toThrow("does not exist");
  expect(await destination.getNode(file.id)).toMatchObject({ workspaceId: destinationWorkspace.id, lifecycle: { kind: "active" } });
  expect(await (await destination.readFile(file.id)).content.text()).toBe("shared bytes");
  expect((await destination.listChanges(0)).at(-1)?.affectedIdentities).toContain(`node:${destinationWorkspace.id}:${file.id}`);
  const verification = await openFilesystemDatabase(ACCOUNT, fullEnvironment);
  expect(await verification.getNode(disposable.id)).toBeUndefined();
  expect(await verification.getOperation(retainedOperation.operationId)).toEqual(retainedOperation);
  await expect(verification.assertNodeIdsAvailable([disposable.id])).rejects.toThrow("retained operation history");
  expect(await verification.listWorkspaces()).toEqual([{ ...destinationWorkspace, ordinal: 0, localRevision: 1 }]);
  expect(await verification.sweepManifests()).not.toEqual([]);
  await expect(verification.getSyncState(sourceWorkspace.id)).rejects.toThrow("does not exist");
  verification.close();
  const cleaned = await openRaw(indexedDB, databaseName);
  expect(await idbRequest(cleaned.transaction("nodes").objectStore("nodes").get(malformedNodeId))).toBeUndefined();
  expect(await idbRequest(cleaned.transaction("settings").objectStore("settings").get([sourceWorkspace.id, 99, "broken"]))).toBeUndefined();
  expect(await idbRequest(cleaned.transaction("changes").objectStore("changes").get([sourceWorkspace.id, "broken"]))).toBeUndefined();
  expect(await idbRequest(cleaned.transaction("hydration-pages").objectStore("hydration-pages").get([sourceWorkspace.id, 99, "broken"]))).toBeUndefined();
  expect(await idbRequest(cleaned.transaction("hydration-coverage").objectStore("hydration-coverage").get([sourceWorkspace.id, 99]))).toBeUndefined();
  cleaned.close();
  source.close();
  destination.close();
  catalog.close();
});

test("reports explicit active-workspace persistence failures without changing the resolved fallback", async () => {
  const { environment } = testEnvironment();
  const failingStorage = { getItem: () => null, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
  const catalog = await openWorkspaceCatalog(ACCOUNT, DEVICE, { ...environment, sessionStorage: failingStorage });
  const first = await catalog.createWorkspace({ name: "First" });
  const second = await catalog.createWorkspace({ name: "Second" });
  await expect(catalog.setActiveWorkspace(second.id)).rejects.toThrow("could not be saved");
  expect((await catalog.resolveActiveWorkspace()).id).toBe(first.id);
  catalog.close();
});

import { describe, expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { getAccountOpfsRoot } from "../src/filesystem/chunks";
import { openFilesystemDatabase } from "../src/filesystem/database";
import { WEB2_CHUNK_SIZE, WEB2_OPFS_PREFIX, sha256Hex } from "../src/filesystem/model";
import { openWorkspaceFilesystem, type WorkspaceFilesystemEnvironment } from "../src/platform/storage/workspace-filesystem";
import { MemoryDirectory, memoryChunk, memoryOpfsHandle } from "./support/memory-opfs";

const ACCOUNT = stableId(1);
const WORKSPACE = stableId(2);
const DEVICE = stableId(3);
const ACCOUNT_HASH = "11e594f481958c10e3015d0bf0447a22f068a8a647f475df15ce2c7ab4b8f3f1";

function stableId(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

async function blobHash(value: Blob) {
  return sha256Hex(await value.arrayBuffer());
}

class TestLocks {
  readonly calls: Array<{ name: string; mode?: LockMode }> = [];
  readonly acquisitions: Array<{ name: string; mode: LockMode }> = [];
  depth = 0;
  private readonly states = new Map<string, { readers: number; writer: boolean; queue: Array<{ mode: LockMode; operation: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }> }>();
  private readonly callWaiters: Array<{ name: string; count: number; resolve: () => void }> = [];

  request<T>(name: string, options: LockOptions, operation: () => Promise<T>) {
    this.calls.push({ name, mode: options.mode });
    this.resolveCallWaiters();
    const state = this.states.get(name) ?? { readers: 0, writer: false, queue: [] };
    this.states.set(name, state);
    const result = new Promise<T>((resolve, reject) => state.queue.push({ mode: options.mode ?? "exclusive", operation, resolve: resolve as (value: unknown) => void, reject }));
    this.drain(name);
    return result;
  }

  waitForCallCount(name: string, count: number) {
    if (this.calls.filter((call) => call.name === name).length >= count) return Promise.resolve();
    return new Promise<void>((resolve) => this.callWaiters.push({ name, count, resolve }));
  }

  private resolveCallWaiters() {
    for (let index = this.callWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.callWaiters[index]!;
      if (this.calls.filter((call) => call.name === waiter.name).length >= waiter.count) {
        this.callWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }

  private drain(name: string) {
    const state = this.states.get(name)!;
    if (state.writer || state.queue.length === 0 || state.readers > 0 && state.queue[0]!.mode === "exclusive") return;
    const start = (entry: typeof state.queue[number]) => {
      if (entry.mode === "exclusive") state.writer = true;
      else state.readers += 1;
      this.acquisitions.push({ name, mode: entry.mode });
      this.depth += 1;
      void entry.operation().then((value) => {
        this.depth -= 1;
        if (entry.mode === "exclusive") state.writer = false;
        else state.readers -= 1;
        this.drain(name);
        entry.resolve(value);
      }, (error) => {
        this.depth -= 1;
        if (entry.mode === "exclusive") state.writer = false;
        else state.readers -= 1;
        this.drain(name);
        entry.reject(error);
      });
    };
    if (state.queue[0]!.mode === "exclusive") start(state.queue.shift()!);
    else while (state.queue[0]?.mode === "shared" && !state.writer) start(state.queue.shift()!);
  }
}

class TestBroadcastChannels {
  readonly names: string[] = [];
  private readonly channels = new Map<string, Set<Set<(event: MessageEvent<unknown>) => void>>>();

  readonly create: NonNullable<WorkspaceFilesystemEnvironment["createBroadcastChannel"]> = (name) => {
    this.names.push(name);
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const peers = this.channels.get(name) ?? new Set();
    let closed = false;
    peers.add(listeners);
    this.channels.set(name, peers);
    return {
      postMessage: (value: unknown) => {
        if (closed) throw new Error("The broadcast channel is closed.");
        for (const peer of peers) if (peer !== listeners) setTimeout(() => {
          if (peers.has(peer)) for (const listener of peer) listener({ data: value } as MessageEvent<unknown>);
        }, 0);
      },
      addEventListener: ((type: string, listener: (event: MessageEvent<unknown>) => void) => { if (!closed && type === "message") listeners.add(listener); }) as BroadcastChannel["addEventListener"],
      removeEventListener: ((type: string, listener: (event: MessageEvent<unknown>) => void) => { if (type === "message") listeners.delete(listener); }) as BroadcastChannel["removeEventListener"],
      close: () => {
        if (closed) return;
        closed = true;
        peers.delete(listeners);
        if (peers.size === 0) this.channels.delete(name);
      },
    };
  };

  broadcast(name: string, value: unknown) {
    const peers = this.channels.get(name);
    if (peers) for (const listeners of peers) setTimeout(() => {
      if (peers.has(listeners)) for (const listener of listeners) listener({ data: value } as MessageEvent<unknown>);
    }, 0);
  }
}

const flushBroadcasts = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("workspace filesystem storage", () => {
  test("persists the locked offline create, write, undo, redo, restore, and cleanup journey", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 10;
    let timestamp = 1_000;
    const randomUUID = () => {
      expect(locks.depth).toBe(2);
      return stableId(nextId++);
    };
    const environment = { indexedDB, IDBKeyRange, now: () => timestamp, originRoot: memoryOpfsHandle(origin), randomUUID, locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Offline", pinned: true, deviceId: DEVICE });
    const otherWorkspaceId = stableId(4);
    const otherNodeId = stableId(5);
    await database.createWorkspace({ id: otherWorkspaceId, name: "Other", pinned: false, deviceId: DEVICE });
    await database.commitOperation({ operation: { schemaVersion: 1, kind: "create", operationId: stableId(6), workspaceId: otherWorkspaceId, deviceId: DEVICE, nodes: [{ id: otherNodeId, kind: "folder", name: "Private", parentId: null, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1 }] } });
    database.close();

    const shared = new Uint8Array(WEB2_CHUNK_SIZE).fill(97);
    const oldest = new Blob([shared, "oldest"], { type: "text/plain" });
    const middle = new Blob([shared, "middle"], { type: "text/plain" });
    const newest = new Blob([shared, "newest"], { type: "text/plain" });
    const rejected = new Blob([shared, "rejected"], { type: "text/plain" });
    const filesystem = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const folder = await filesystem.createFolder({ name: "Documents" });
    const file = await filesystem.createFile({ name: "Notes.txt", parentId: folder.id, content: oldest });
    expect(await filesystem.getNode(otherNodeId)).toBeUndefined();
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(oldest));

    const firstWrite = await filesystem.writeFile(file.id, middle, { expectedContentTuple: file.fieldTuples.content! });
    await expect(filesystem.writeFile(file.id, rejected, { expectedContentTuple: file.fieldTuples.content! })).rejects.toThrow("content changed");
    const secondWrite = await filesystem.writeFile(file.id, newest, { expectedContentTuple: { logicalTime: firstWrite.operation.logicalTime, operationId: firstWrite.operationId } });
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(newest));
    const undoNewest = await filesystem.undoOperation(secondWrite.operationId);
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(middle));
    const undoMiddle = await filesystem.undoOperation(firstWrite.operationId);
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(oldest));
    const redoMiddle = await filesystem.redoOperation(undoMiddle.operationId);
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(middle));
    const redoNewest = await filesystem.redoOperation(undoNewest.operationId);
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(newest));
    expect(redoMiddle).toMatchObject({ intent: "redo", compensatesOperationId: undoMiddle.operationId });
    expect(redoNewest).toMatchObject({ intent: "redo", compensatesOperationId: undoNewest.operationId });

    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;
    const chunks = accountRoot.directories.get("chunks")!;
    const chunkWrites = () => [...chunks.directories.values()].flatMap((directory) => [...directory.files].map(([hash, entry]) => [hash, entry.writes] as const)).sort(([left], [right]) => left.localeCompare(right));
    const writesBeforeMetadata = chunkWrites();
    timestamp = 1_500;
    await filesystem.renameNode(file.id, "Renamed.txt");
    await filesystem.setNodePositions([{ nodeId: file.id, position: { x: 40, y: 50 } }]);
    await filesystem.moveNodes([file.id], null);
    await filesystem.moveNodes([file.id], folder.id);
    await filesystem.trashNodes([file.id]);
    expect((await filesystem.listTrash()).map(({ id }) => id)).toEqual([file.id]);
    await filesystem.restoreNodes([file.id], "original");
    await filesystem.setSetting("editor", "theme", null);
    await filesystem.setSettings("editor", [{ key: "theme", value: "dusk" }, { key: "wrap", value: true }]);
    const disposable = await filesystem.createFolder({ name: "Disposable" });
    await filesystem.trashNodes([disposable.id]);
    await filesystem.purgeNodes([disposable.id]);
    const retainedTrash = await filesystem.createFolder({ name: "Retained Trash" });
    await filesystem.trashNodes([retainedTrash.id]);
    expect(chunkWrites()).toEqual(writesBeforeMetadata);

    const beforeReopen = {
      content: await blobHash((await filesystem.readFile(file.id)).content),
      operations: await filesystem.listOperations(),
      root: await filesystem.listChildren(null),
      children: await filesystem.listChildren(folder.id),
      trash: await filesystem.listTrash(),
      settings: await filesystem.listSettings("editor"),
    };
    filesystem.close();
    const reopened = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const [reloadedFolder] = await reopened.listChildren(null);
    const [reloadedFile] = await reopened.listChildren(reloadedFolder!.id);
    expect(reloadedFolder).toMatchObject({ id: folder.id, kind: "folder", name: "Documents" });
    expect(reloadedFile).toMatchObject({ id: file.id, kind: "file", name: "Renamed.txt", position: { x: 40, y: 50 } });
    expect(await reopened.getNode(reloadedFile!.id)).toEqual(reloadedFile);
    expect({
      content: await blobHash((await reopened.readFile(reloadedFile!.id)).content),
      operations: await reopened.listOperations(),
      root: await reopened.listChildren(null),
      children: await reopened.listChildren(folder.id),
      trash: await reopened.listTrash(),
      settings: await reopened.listSettings("editor"),
    }).toEqual(beforeReopen);
    expect((await reopened.getSetting("editor", "theme"))?.value).toBe("dusk");
    expect(beforeReopen.operations.every(({ operation }) => operation.deviceId === DEVICE)).toBe(true);

    const versions = await reopened.listFileVersions(file.id);
    const oldestVersion = versions.at(-1)!;
    expect(oldestVersion.current).toBe(false);
    expect(await blobHash(await reopened.readFileVersion(file.id, oldestVersion.operationId))).toBe(await blobHash(oldest));
    timestamp = 2_000;
    const restore = await reopened.restoreFileVersion(file.id, oldestVersion.operationId);
    expect(restore).toMatchObject({ intent: "restore", compensatesOperationId: oldestVersion.operationId });
    expect(restore.operation).toMatchObject({ kind: "write", modifiedAt: 2_000 });
    expect(await blobHash((await reopened.readFile(file.id)).content)).toBe(await blobHash(oldest));
    const undoRestore = await reopened.undoOperation(restore.operationId);
    expect(await blobHash((await reopened.readFile(file.id)).content)).toBe(await blobHash(newest));

    const orphanHash = await sha256Hex(new TextEncoder().encode("rejected"));
    const sharedHash = await sha256Hex(shared);
    expect(memoryChunk(accountRoot, orphanHash)).toBeDefined();
    const raceContent = new Blob(["race"], { type: "text/plain" });
    const raceHash = await sha256Hex(await raceContent.arrayBuffer());
    const raceShard = chunks.directories.get(raceHash.slice(0, 2)) ?? chunks.directory(raceHash.slice(0, 2));
    let staged!: () => void;
    const stagedPromise = new Promise<void>((resolve) => { staged = resolve; });
    let releaseWrite!: () => void;
    const releaseWritePromise = new Promise<void>((resolve) => { releaseWrite = resolve; });
    raceShard.beforeFileClose = async (name) => {
      if (name !== raceHash) return;
      staged();
      await releaseWritePromise;
    };
    const competing = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const raceWritePromise = reopened.writeFile(file.id, raceContent, { expectedContentTuple: { logicalTime: undoRestore.operation.logicalTime, operationId: undoRestore.operationId } });
    await stagedPromise;
    let cleanupFinished = false;
    const cleanupPromise = competing.removeOrphans().then(() => { cleanupFinished = true; });
    await Promise.resolve();
    expect(cleanupFinished).toBe(false);
    releaseWrite();
    await Promise.all([raceWritePromise, cleanupPromise]);
    expect(memoryChunk(accountRoot, orphanHash)).toBeUndefined();
    expect(memoryChunk(accountRoot, sharedHash)).toBeDefined();
    expect(memoryChunk(accountRoot, raceHash)).toBeDefined();
    expect(await blobHash((await reopened.readFile(file.id)).content)).toBe(await blobHash(raceContent));
    for (const version of await reopened.listFileVersions(file.id)) await reopened.readFileVersion(file.id, version.operationId);

    const accountLocks = locks.calls.filter(({ name }) => name === `hiraya-web2-v1-${ACCOUNT_HASH}-storage`);
    const workspaceLocks = locks.calls.filter(({ name }) => name === `hiraya-web2-v1-${ACCOUNT_HASH}-workspace-${WORKSPACE}`);
    expect(accountLocks).toEqual([...Array.from({ length: 25 }, () => ({ name: `hiraya-web2-v1-${ACCOUNT_HASH}-storage`, mode: "shared" as const })), { name: `hiraya-web2-v1-${ACCOUNT_HASH}-storage`, mode: "exclusive" }]);
    expect(workspaceLocks).toEqual(Array.from({ length: 25 }, () => ({ name: `hiraya-web2-v1-${ACCOUNT_HASH}-workspace-${WORKSPACE}`, mode: "exclusive" })));
    expect(await getAccountOpfsRoot(ACCOUNT, memoryOpfsHandle(origin))).toBe(memoryOpfsHandle(accountRoot));
    competing.close();
    reopened.close();
  });

  test("persists the exact desktop grid settings contract", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 80;
    const environment = { indexedDB, IDBKeyRange, now: () => 40, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Desktop grid", pinned: true, deviceId: DEVICE });
    database.close();

    const filesystem = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    expect(await filesystem.readDesktopGridSettings()).toEqual({ autoArrangeIcons: true, snapToGrid: false, gridSize: 24 });
    const operation = await filesystem.saveDesktopGridSettings({ autoArrangeIcons: false, snapToGrid: true, gridSize: 36 });
    expect(operation.operation).toMatchObject({ kind: "set-many", namespace: "desktop-grid", settings: [
      { key: "auto-arrange-icons", value: false },
      { key: "snap-to-grid", value: true },
      { key: "grid-size", value: 36 },
    ] });
    expect(await filesystem.readDesktopGridSettings()).toEqual({ autoArrangeIcons: false, snapToGrid: true, gridSize: 36 });
    await expect(filesystem.setSetting("desktop-grid", "unknown", true)).rejects.toThrow();
    await expect(filesystem.setSetting("desktop-grid", "grid-size", 16)).rejects.toThrow();
    await expect(filesystem.saveDesktopGridSettings({ autoArrangeIcons: false, snapToGrid: true, gridSize: 16 as 24 })).rejects.toThrow();
    filesystem.close();

    const reopened = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    expect(await reopened.readDesktopGridSettings()).toEqual({ autoArrangeIcons: false, snapToGrid: true, gridSize: 36 });
    expect(await reopened.listOperations()).toHaveLength(1);
    reopened.close();
  });

  test("broadcasts committed revisions and replays bounded targeted changes across facades", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    const broadcasts = new TestBroadcastChannels();
    let nextId = 100;
    const destinationWorkspace = stableId(4);
    const environment = { indexedDB, IDBKeyRange, now: () => 50, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Source", pinned: true, deviceId: DEVICE });
    await database.createWorkspace({ id: destinationWorkspace, name: "Destination", pinned: false, deviceId: DEVICE });
    database.close();

    const source = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const observer = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const destination = await openWorkspaceFilesystem(ACCOUNT, destinationWorkspace, environment);
    let sourceWakeups = 0;
    let destinationWakeups = 0;
    const stopSource = observer.onChangesAvailable(() => { sourceWakeups += 1; });
    const stopDestination = destination.onChangesAvailable(() => { destinationWakeups += 1; });
    const item = await source.createFolder({ name: "Broadcast" });
    await flushBroadcasts();
    expect(sourceWakeups).toBe(1);
    const [createdChange] = await observer.listChanges(0, 1);
    expect(createdChange).toMatchObject({ workspaceId: WORKSPACE, revision: 1 });
    expect(createdChange!.affectedIdentities).toContain(`node:${WORKSPACE}:${item.id}`);
    expect(createdChange!.affectedIdentities).toContain(`folder:${WORKSPACE}:root`);

    await source.transferNodes(destinationWorkspace, [item.id], null);
    await flushBroadcasts();
    expect(sourceWakeups).toBe(2);
    expect(destinationWakeups).toBe(1);
    expect((await observer.listChanges(1)).map(({ revision }) => revision)).toEqual([2]);
    const [destinationChange] = await destination.listChanges(0);
    expect(destinationChange).toMatchObject({ workspaceId: destinationWorkspace, revision: 1 });
    expect(destinationChange!.affectedIdentities).toContain(`node:${destinationWorkspace}:${item.id}`);

    const channelName = `hiraya-web2-v1-${ACCOUNT_HASH}-revisions`;
    broadcasts.broadcast(channelName, { schemaVersion: 1, workspaceId: WORKSPACE, revision: -1 });
    broadcasts.broadcast(channelName, { schemaVersion: 1, workspaceId: WORKSPACE, revision: 99, unexpected: true });
    broadcasts.broadcast(channelName, { schemaVersion: 1, workspaceId: WORKSPACE, revision: 99 });
    await flushBroadcasts();
    expect(sourceWakeups).toBe(3);
    expect(await observer.listChanges(2)).toEqual([]);
    stopSource();
    stopDestination();
    await source.createFolder({ name: "After unsubscribe" });
    await flushBroadcasts();
    expect(sourceWakeups).toBe(3);
    expect(destinationWakeups).toBe(1);
    expect(new Set(broadcasts.names)).toEqual(new Set([channelName]));
    source.close();
    observer.close();
    destination.close();
  });

  test("creates a bounded multi-root forest atomically in caller order with deduplicated content", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 200;
    const environment = { indexedDB, IDBKeyRange, now: () => 100, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Forest", pinned: true, deviceId: DEVICE });
    database.close();
    const filesystem = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const duplicate = new Blob(["same bytes"], { type: "text/plain" });
    const created = await filesystem.createForest({ parentId: null, nodes: [
      { key: "nested-file", kind: "file", name: "Nested.txt", parentKey: "folder", position: { x: 3, y: 4 }, modifiedAt: 90, content: duplicate, mimeType: "text/markdown" },
      { key: "folder", kind: "folder", name: "Folder", parentKey: null, position: { x: 1, y: 2 } },
      { key: "empty", kind: "folder", name: "Empty", parentKey: "folder", position: { x: 5, y: 6 }, modifiedAt: 91 },
      { key: "duplicate-file", kind: "file", name: "Duplicate.txt", parentKey: null, position: { x: 7, y: 8 }, content: duplicate },
      { key: "zero", kind: "file", name: "Zero.txt", parentKey: "empty", position: { x: 9, y: 10 }, content: new Blob([], { type: "application/octet-stream" }) },
    ] });

    expect(created.map(({ name }) => name)).toEqual(["Nested.txt", "Folder", "Empty", "Duplicate.txt", "Zero.txt"]);
    expect(created[0]).toMatchObject({ parentId: created[1]!.id, mimeType: "text/markdown", modifiedAt: 90, createdAt: 100 });
    expect(created[2]).toMatchObject({ parentId: created[1]!.id, modifiedAt: 91, createdAt: 100 });
    expect(created[4]).toMatchObject({ parentId: created[2]!.id, size: 0, createdAt: 100, modifiedAt: 100 });
    const operations = await filesystem.listOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0]!.operation).toMatchObject({ kind: "create", nodes: created.map(({ id }) => ({ id })) });
    expect(operations[0]!.versionNodeIds).toEqual([created[0]!.id, created[3]!.id, created[4]!.id]);
    expect(created.every(({ fieldTuples }) => fieldTuples.name.operationId === operations[0]!.operationId)).toBe(true);
    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;
    const chunkEntries = [...accountRoot.directories.get("chunks")!.directories.values()].flatMap((directory) => [...directory.files.values()]);
    expect(chunkEntries).toHaveLength(1);
    expect(chunkEntries[0]!.writes).toBe(1);
    expect(await (await filesystem.readFile(created[0]!.id)).content.text()).toBe("same bytes");
    expect(await (await filesystem.readFile(created[4]!.id)).content.text()).toBe("");

    const beforeReopen = { root: await filesystem.listChildren(null), folder: await filesystem.listChildren(created[1]!.id), empty: await filesystem.listChildren(created[2]!.id), operations };
    filesystem.close();
    const reopened = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    expect({ root: await reopened.listChildren(null), folder: await reopened.listChildren(created[1]!.id), empty: await reopened.listChildren(created[2]!.id), operations: await reopened.listOperations() }).toEqual(beforeReopen);
    reopened.close();
  });

  test("rejects forest metadata and destination failures before OPFS, and leaves no projection after later staging failure", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 300;
    const environment = { indexedDB, IDBKeyRange, now: () => 200, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Preflight", pinned: true, deviceId: DEVICE });
    database.close();
    const filesystem = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;

    await expect(filesystem.createForest({ parentId: null, nodes: [] })).rejects.toThrow("between 1 and 256");
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "child", kind: "folder", name: "Child", parentKey: "missing", position: { x: 0, y: 0 } }] })).rejects.toThrow("parent key");
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "same", kind: "folder", name: "First", parentKey: null, position: { x: 0, y: 0 } }, { key: "same", kind: "folder", name: "Second", parentKey: null, position: { x: 0, y: 0 } }] })).rejects.toThrow("duplicate keys");
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "a", kind: "folder", name: "A", parentKey: "b", position: { x: 0, y: 0 } }, { key: "b", kind: "folder", name: "B", parentKey: "a", position: { x: 0, y: 0 } }] })).rejects.toThrow("cycle");
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "bad-name", kind: "folder", name: " Bad", parentKey: null, position: { x: 0, y: 0 } }] })).rejects.toThrow("name");
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "bad-position", kind: "folder", name: "Bad position", parentKey: null, position: { x: Number.NaN, y: 0 } }] })).rejects.toThrow("position");
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "bad-time", kind: "folder", name: "Bad time", parentKey: null, position: { x: 0, y: 0 }, modifiedAt: -1 }] })).rejects.toThrow("time");
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "bad-mime", kind: "file", name: "Bad MIME", parentKey: null, position: { x: 0, y: 0 }, content: new Blob(["bytes"]), mimeType: "not-a-mime" }] })).rejects.toThrow("MIME");
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "file", kind: "file", name: "File", parentKey: null, position: { x: 0, y: 0 }, content: "not a blob" as unknown as Blob }] })).rejects.toThrow("Blob");
    await expect(filesystem.createForest({ parentId: stableId(999), nodes: [{ key: "file", kind: "file", name: "File", parentKey: null, position: { x: 0, y: 0 }, content: new Blob(["bytes"]) }] })).rejects.toThrow("active folder");
    const existing = await filesystem.createFolder({ name: "Existing" });
    await expect(filesystem.createForest({ parentId: null, nodes: [{ key: "file", kind: "file", name: "existing", parentKey: null, position: { x: 0, y: 0 }, content: new Blob(["bytes"]) }] })).rejects.toThrow("sibling");
    await expect(filesystem.createForest({ parentId: null, nodes: Array.from({ length: 257 }, (_, index) => ({ key: `${index}`, kind: "folder" as const, name: `Folder ${index}`, parentKey: null, position: { x: 0, y: 0 } })) })).rejects.toThrow("between 1 and 256");
    expect(accountRoot.directoryReads).toBe(0);
    expect(accountRoot.directories.has("chunks")).toBe(false);

    const collisionIds = [existing.id, stableId(9_998)];
    const collisionFilesystem = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, { ...environment, randomUUID: () => collisionIds.shift()! });
    await expect(collisionFilesystem.createFile({ name: "Collision.txt", content: new Blob(["must not stage"]) })).rejects.toThrow("already exists");
    expect(accountRoot.directories.has("chunks")).toBe(false);
    collisionFilesystem.close();

    const first = new Blob(["first"]);
    const second = new Blob(["second"]);
    const firstHash = await blobHash(first);
    const secondHash = await blobHash(second);
    const chunks = accountRoot.directory("chunks");
    const failingShard = chunks.directory(secondHash.slice(0, 2));
    failingShard.beforeFileClose = async (name) => { if (name === secondHash) throw new Error("Injected later staging failure"); };
    await expect(filesystem.createForest({ parentId: null, nodes: [
      { key: "first", kind: "file", name: "First.txt", parentKey: null, position: { x: 0, y: 0 }, content: first },
      { key: "second", kind: "file", name: "Second.txt", parentKey: null, position: { x: 1, y: 1 }, content: second },
    ] })).rejects.toThrow("Injected later staging failure");
    expect(memoryChunk(accountRoot, firstHash)?.writes).toBe(1);
    expect((await filesystem.listChildren(null)).map(({ id }) => id)).toEqual([existing.id]);
    expect(await filesystem.listOperations()).toHaveLength(1);
    const verification = await openFilesystemDatabase(ACCOUNT, environment);
    expect((await verification.listWorkspaces())[0]!.localRevision).toBe(1);
    verification.close();
    filesystem.close();
  });

  test("copies nested and empty roots without chunk rewrites and verifies source chunks after destination preflight", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 400;
    let timestamp = 300;
    const environment = { indexedDB, IDBKeyRange, now: () => timestamp, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Copy", pinned: true, deviceId: DEVICE });
    database.close();
    const filesystem = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const shared = new Blob(["copy bytes"], { type: "text/plain" });
    const source = await filesystem.createForest({ parentId: null, nodes: [
      { key: "root", kind: "folder", name: "Root", parentKey: null, position: { x: 1, y: 2 } },
      { key: "nested", kind: "folder", name: "Nested", parentKey: "root", position: { x: 3, y: 4 } },
      { key: "nested-file", kind: "file", name: "Nested.txt", parentKey: "nested", position: { x: 5, y: 6 }, content: shared, mimeType: "text/markdown" },
      { key: "duplicate", kind: "file", name: "Duplicate.txt", parentKey: "root", position: { x: 7, y: 8 }, content: shared },
      { key: "empty", kind: "folder", name: "Empty", parentKey: null, position: { x: 9, y: 10 } },
    ] });
    const destination = await filesystem.createFolder({ name: "Destination" });
    const sourceByName = new Map(source.map((node) => [node.name, node]));
    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;
    const hash = await blobHash(shared);
    const chunk = memoryChunk(accountRoot, hash)!;
    const writesBeforeCopy = chunk.writes;
    const readsBeforeCopy = chunk.reads;
    timestamp = 500;
    const copied = await filesystem.copyNodes({ parentId: destination.id, roots: [
      { nodeId: sourceByName.get("Root")!.id, name: "Root copy", position: { x: 20, y: 21 } },
      { nodeId: sourceByName.get("Empty")!.id, name: "Empty copy", position: { x: 22, y: 23 } },
    ] });
    const copiedByName = new Map(copied.map((node) => [node.name, node]));

    expect(new Set(copied.map(({ id }) => id)).size).toBe(5);
    expect(copied.every(({ id }) => !source.some((node) => node.id === id))).toBe(true);
    expect(copied.every(({ createdAt, modifiedAt }) => createdAt === 500 && modifiedAt === 500)).toBe(true);
    expect(copiedByName.get("Root copy")).toMatchObject({ parentId: destination.id, position: { x: 20, y: 21 } });
    expect(copiedByName.get("Empty copy")).toMatchObject({ parentId: destination.id, position: { x: 22, y: 23 } });
    expect(copiedByName.get("Nested")).toMatchObject({ name: "Nested", position: sourceByName.get("Nested")!.position, parentId: copiedByName.get("Root copy")!.id });
    expect(copiedByName.get("Nested.txt")).toMatchObject({ parentId: copiedByName.get("Nested")!.id, position: sourceByName.get("Nested.txt")!.position, mimeType: "text/markdown", manifestHash: (sourceByName.get("Nested.txt") as typeof copied[number] & { manifestHash: string }).manifestHash });
    expect(copiedByName.get("Duplicate.txt")).toMatchObject({ parentId: copiedByName.get("Root copy")!.id, position: sourceByName.get("Duplicate.txt")!.position });
    expect(chunk.writes).toBe(writesBeforeCopy);
    expect(chunk.reads).toBe(readsBeforeCopy + 1);
    expect(await (await filesystem.readFile(copiedByName.get("Nested.txt")!.id)).content.text()).toBe("copy bytes");
    const copyOperation = (await filesystem.listOperations())[0]!;
    expect(copyOperation.operation).toMatchObject({ kind: "copy", sourceNodeIds: [sourceByName.get("Root")!.id, sourceByName.get("Empty")!.id] });
    expect((await filesystem.listFileVersions(copiedByName.get("Nested.txt")!.id)).map(({ operationId }) => operationId)).toEqual([copyOperation.operationId]);

    const revision = copyOperation.localRevision;
    const readsBeforeCollision = chunk.reads;
    await expect(filesystem.copyNodes({ parentId: destination.id, roots: [{ nodeId: sourceByName.get("Root")!.id, name: "root COPY", position: { x: 0, y: 0 } }] })).rejects.toThrow("sibling");
    expect(chunk.reads).toBe(readsBeforeCollision);
    chunk.content = new Blob(["corrupt"]);
    await expect(filesystem.copyNodes({ parentId: destination.id, roots: [{ nodeId: sourceByName.get("Root")!.id, name: "Corrupt attempt", position: { x: 0, y: 0 } }] })).rejects.toThrow("does not match");
    accountRoot.directories.get("chunks")!.directories.get(hash.slice(0, 2))!.files.delete(hash);
    await expect(filesystem.copyNodes({ parentId: destination.id, roots: [{ nodeId: sourceByName.get("Root")!.id, name: "Missing attempt", position: { x: 0, y: 0 } }] })).rejects.toThrow();
    expect((await filesystem.listOperations())[0]!.localRevision).toBe(revision);
    expect(chunk.writes).toBe(writesBeforeCopy);
    filesystem.close();
  });

  test("undoes and redoes created and copied forests across reload without rewriting chunks", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 10_000;
    let timestamp = 700;
    const environment = { indexedDB, IDBKeyRange, now: () => timestamp, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Lifecycle history", pinned: true, deviceId: DEVICE });
    database.close();

    const filesystem = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const created = await filesystem.createForest({ parentId: null, nodes: [
      { key: "root", kind: "folder", name: "Original", parentKey: null, position: { x: 1, y: 2 } },
      { key: "file", kind: "file", name: "History.txt", parentKey: "root", position: { x: 3, y: 4 }, content: new Blob(["retained bytes"], { type: "text/plain" }) },
      { key: "second-root", kind: "folder", name: "Second", parentKey: null, position: { x: 7, y: 8 } },
    ] });
    const originalRoot = created.find(({ name }) => name === "Original")!;
    const secondRoot = created.find(({ name }) => name === "Second")!;
    const originalFile = created.find(({ kind }) => kind === "file")!;
    const createOperation = (await filesystem.listOperations()).find(({ operation }) => operation.kind === "create")!;
    const copied = await filesystem.copyNodes({ parentId: null, roots: [{ nodeId: originalRoot.id, name: "Copy", position: { x: 5, y: 6 } }] });
    const copiedRoot = copied.find(({ kind }) => kind === "folder")!;
    const copiedFile = copied.find(({ kind }) => kind === "file")!;
    const copyOperation = (await filesystem.listOperations()).find(({ operation }) => operation.kind === "copy")!;
    await filesystem.moveNodes([secondRoot.id], originalRoot.id);
    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;
    const chunkEntries = [...accountRoot.directories.get("chunks")!.directories.values()].flatMap((directory) => [...directory.files.values()]);
    const writesBeforeHistory = chunkEntries.map(({ writes }) => writes);

    timestamp = 800;
    const undoCopy = await filesystem.undoOperation(copyOperation.operationId);
    const undoCreate = await filesystem.undoOperation(createOperation.operationId);
    expect(new Set((await filesystem.listTrash()).map(({ id }) => id))).toEqual(new Set([originalRoot.id, copiedRoot.id]));
    expect((await filesystem.getNode(originalFile.id))?.lifecycle.kind).toBe("trashed");
    expect((await filesystem.getNode(copiedFile.id))?.lifecycle.kind).toBe("trashed");
    filesystem.close();

    const reopened = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    timestamp = 900;
    const redoCreate = await reopened.redoOperation(undoCreate.operationId);
    const redoCopy = await reopened.redoOperation(undoCopy.operationId);
    expect(redoCreate).toMatchObject({ intent: "redo", compensatesOperationId: undoCreate.operationId, operation: { kind: "restore", nodeIds: [originalRoot.id], destination: "original" } });
    expect(redoCopy).toMatchObject({ intent: "redo", compensatesOperationId: undoCopy.operationId, operation: { kind: "restore", nodeIds: [copiedRoot.id], destination: "original" } });
    expect(await reopened.listTrash()).toEqual([]);
    expect(await reopened.getNode(originalFile.id)).toMatchObject({ parentId: originalRoot.id, lifecycle: { kind: "active" } });
    expect(await reopened.getNode(secondRoot.id)).toMatchObject({ parentId: originalRoot.id, lifecycle: { kind: "active" } });
    expect(await reopened.getNode(copiedFile.id)).toMatchObject({ parentId: copiedRoot.id, lifecycle: { kind: "active" } });
    expect(await (await reopened.readFile(originalFile.id)).content.text()).toBe("retained bytes");
    expect(await (await reopened.readFile(copiedFile.id)).content.text()).toBe("retained bytes");

    const undoRedo = await reopened.undoOperation(redoCopy.operationId);
    expect((await reopened.getNode(copiedRoot.id))?.lifecycle.kind).toBe("trashed");
    await reopened.redoOperation(undoRedo.operationId);
    expect((await reopened.getNode(copiedRoot.id))?.lifecycle.kind).toBe("active");
    await reopened.trashNodes([copiedRoot.id]);
    await expect(reopened.redoOperation(undoRedo.operationId)).rejects.toThrow("no longer current");
    expect(chunkEntries.map(({ writes }) => writes)).toEqual(writesBeforeHistory);
    reopened.close();
  });

  test("preflights missing, trashed, overlapping, deep, and 257-node copies without OPFS", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 2_000;
    const environment = { indexedDB, IDBKeyRange, now: () => 600, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Copy validation", pinned: true, deviceId: DEVICE });
    database.close();
    const filesystem = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const basic = await filesystem.createForest({ parentId: null, nodes: [
      { key: "root", kind: "folder", name: "Basic", parentKey: null, position: { x: 0, y: 0 } },
      { key: "child", kind: "folder", name: "Child", parentKey: "root", position: { x: 0, y: 0 } },
      { key: "trashed", kind: "folder", name: "Trashed", parentKey: null, position: { x: 0, y: 0 } },
    ] });
    await filesystem.trashNodes([basic[2]!.id]);
    const chain = await filesystem.createForest({ parentId: null, nodes: Array.from({ length: 65 }, (_, index) => ({ key: `${index}`, kind: "folder" as const, name: `Depth ${index}`, parentKey: index === 0 ? null : `${index - 1}`, position: { x: 0, y: 0 } })) });
    const depthSource = await filesystem.createForest({ parentId: null, nodes: [
      { key: "root", kind: "folder", name: "Depth source", parentKey: null, position: { x: 0, y: 0 } },
      { key: "child", kind: "folder", name: "Depth child", parentKey: "root", position: { x: 0, y: 0 } },
    ] });
    const large = await filesystem.createForest({ parentId: null, nodes: [
      { key: "root", kind: "folder", name: "Large", parentKey: null, position: { x: 0, y: 0 } },
      ...Array.from({ length: 255 }, (_, index) => ({ key: `child-${index}`, kind: "folder" as const, name: `Large child ${index}`, parentKey: "root", position: { x: 0, y: 0 } })),
    ] });
    await filesystem.createFolder({ name: "Large overflow", parentId: large[0]!.id });
    const revision = (await filesystem.listOperations())[0]!.localRevision;

    await expect(filesystem.copyNodes({ parentId: null, roots: [{ nodeId: stableId(999), name: "Missing", position: { x: 0, y: 0 } }] })).rejects.toThrow("active source roots");
    await expect(filesystem.copyNodes({ parentId: null, roots: [{ nodeId: basic[2]!.id, name: "Trashed copy", position: { x: 0, y: 0 } }] })).rejects.toThrow("active source roots");
    await expect(filesystem.copyNodes({ parentId: null, roots: [
      { nodeId: basic[0]!.id, name: "Basic copy", position: { x: 0, y: 0 } },
      { nodeId: basic[1]!.id, name: "Child copy", position: { x: 0, y: 0 } },
    ] })).rejects.toThrow("overlap");
    await expect(filesystem.copyNodes({ parentId: chain.at(-1)!.id, roots: [{ nodeId: depthSource[0]!.id, name: "Too deep", position: { x: 0, y: 0 } }] })).rejects.toThrow("too deep");
    await expect(filesystem.copyNodes({ parentId: null, roots: Array.from({ length: 257 }, (_, index) => ({ nodeId: stableId(3_000 + index), name: `Root ${index}`, position: { x: 0, y: 0 } })) })).rejects.toThrow("between 1 and 256");
    await expect(filesystem.copyNodes({ parentId: null, roots: [{ nodeId: large[0]!.id, name: "Large copy", position: { x: 0, y: 0 } }] })).rejects.toThrow("too large");
    expect((await filesystem.listOperations())[0]!.localRevision).toBe(revision);
    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;
    expect(accountRoot.directories.has("chunks")).toBe(false);
    filesystem.close();
  });

  test("transfers a complete tree between facades without touching manifests or chunks", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 6_000;
    let timestamp = 800;
    const environment = { indexedDB, IDBKeyRange, now: () => timestamp, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const destinationWorkspace = stableId(4);
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "Source", pinned: true, deviceId: DEVICE });
    await database.createWorkspace({ id: destinationWorkspace, name: "Destination", pinned: false, deviceId: DEVICE });
    database.close();
    const source = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const destination = await openWorkspaceFilesystem(ACCOUNT, destinationWorkspace, environment);
    const content = new Blob(["transfer bytes"], { type: "text/plain" });
    const created = await source.createForest({ parentId: null, nodes: [
      { key: "root", kind: "folder", name: "Tree", parentKey: null, position: { x: 1, y: 2 } },
      { key: "nested", kind: "folder", name: "Nested", parentKey: "root", position: { x: 3, y: 4 } },
      { key: "file", kind: "file", name: "File.txt", parentKey: "nested", position: { x: 5, y: 6 }, content },
      { key: "empty", kind: "folder", name: "Empty", parentKey: null, position: { x: 7, y: 8 } },
    ] });
    const destinationParent = await destination.createFolder({ name: "Inbox" });
    const byName = new Map(created.map((node) => [node.name, node]));
    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;
    const chunkEntries = [...accountRoot.directories.get("chunks")!.directories.values()].flatMap((directory) => [...directory.files.values()]);
    const countersBefore = chunkEntries.map(({ reads, writes }) => ({ reads, writes }));
    const verification = await openFilesystemDatabase(ACCOUNT, environment);
    const retainedBefore = await verification.listRetainedChunkHashes();
    verification.close();

    timestamp = 900;
    const transfer = await source.transferNodes(destinationWorkspace, [byName.get("Empty")!.id, byName.get("Tree")!.id], destinationParent.id);
    expect(transfer).toMatchObject({ destinationLocalRevision: 2, operation: { kind: "transfer", destinationWorkspaceId: destinationWorkspace, parentId: destinationParent.id, modifiedAt: 900 }, versionNodeIds: [] });
    expect(await source.getNode(byName.get("Tree")!.id)).toBeUndefined();
    expect(await source.listChildren(null)).toEqual([]);
    await expect(source.readFile(byName.get("File.txt")!.id)).rejects.toThrow("active file");
    expect(chunkEntries.map(({ reads, writes }) => ({ reads, writes }))).toEqual(countersBefore);
    expect((await destination.listChildren(destinationParent.id)).map(({ name }) => name).sort()).toEqual(["Empty", "Tree"]);
    expect(await destination.getNode(byName.get("Nested")!.id)).toMatchObject({ workspaceId: destinationWorkspace, parentId: byName.get("Tree")!.id, modifiedAt: 900 });
    expect(await destination.getNode(byName.get("File.txt")!.id)).toMatchObject({ workspaceId: destinationWorkspace, parentId: byName.get("Nested")!.id, modifiedAt: 900 });
    expect(await (await destination.readFile(byName.get("File.txt")!.id)).content.text()).toBe("transfer bytes");
    expect((await destination.listOperations()).some(({ operationId }) => operationId === transfer.operationId)).toBe(false);
    const after = await openFilesystemDatabase(ACCOUNT, environment);
    expect(await after.listRetainedChunkHashes()).toEqual(retainedBefore);
    after.close();
    source.close();
    destination.close();
  });

  test("orders opposite transfers identically while unrelated mutation progresses and cleanup waits", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 7_000;
    const secondWorkspace = stableId(4);
    const unrelatedWorkspace = stableId(5);
    const environment = { indexedDB, IDBKeyRange, now: () => 1_000, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "First", pinned: true, deviceId: DEVICE });
    await database.createWorkspace({ id: secondWorkspace, name: "Second", pinned: false, deviceId: DEVICE });
    await database.createWorkspace({ id: unrelatedWorkspace, name: "Third", pinned: false, deviceId: DEVICE });
    database.close();
    const first = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const second = await openWorkspaceFilesystem(ACCOUNT, secondWorkspace, environment);
    const unrelated = await openWorkspaceFilesystem(ACCOUNT, unrelatedWorkspace, environment);
    const firstParent = await first.createFolder({ name: "First parent" });
    const firstItem = await first.createFolder({ name: "First item" });
    const secondParent = await second.createFolder({ name: "Second parent" });
    const secondItem = await second.createFolder({ name: "Second item" });
    locks.acquisitions.length = 0;
    await Promise.all([
      first.transferNodes(secondWorkspace, [firstItem.id], secondParent.id),
      second.transferNodes(WORKSPACE, [secondItem.id], firstParent.id),
    ]);
    const firstLock = `hiraya-web2-v1-${ACCOUNT_HASH}-workspace-${WORKSPACE}`;
    const secondLock = `hiraya-web2-v1-${ACCOUNT_HASH}-workspace-${secondWorkspace}`;
    expect(locks.acquisitions.filter(({ name }) => name === firstLock || name === secondLock).map(({ name }) => name)).toEqual([firstLock, secondLock, firstLock, secondLock]);
    expect(await second.getNode(firstItem.id)).toMatchObject({ workspaceId: secondWorkspace, parentId: secondParent.id });
    expect(await first.getNode(secondItem.id)).toMatchObject({ workspaceId: WORKSPACE, parentId: firstParent.id });

    let releaseBlocker!: () => void;
    const blockerRelease = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    let blockerAcquired!: () => void;
    const blockerReady = new Promise<void>((resolve) => { blockerAcquired = resolve; });
    const blocker = locks.request(secondLock, { mode: "exclusive" }, async () => {
      blockerAcquired();
      await blockerRelease;
    });
    await blockerReady;
    const heldItem = await first.createFolder({ name: "Held item" });
    const secondCalls = locks.calls.filter(({ name }) => name === secondLock).length;
    const transfer = first.transferNodes(secondWorkspace, [heldItem.id], secondParent.id);
    await locks.waitForCallCount(secondLock, secondCalls + 1);
    await unrelated.createFolder({ name: "Unblocked" });
    let cleanupFinished = false;
    const accountLock = `hiraya-web2-v1-${ACCOUNT_HASH}-storage`;
    const exclusiveAcquisitions = () => locks.acquisitions.filter(({ name, mode }) => name === accountLock && mode === "exclusive").length;
    const acquisitionsBeforeCleanup = exclusiveAcquisitions();
    const cleanup = first.removeOrphans().then(() => { cleanupFinished = true; });
    await locks.waitForCallCount(accountLock, locks.calls.filter(({ name }) => name === accountLock).length);
    expect(cleanupFinished).toBe(false);
    expect(exclusiveAcquisitions()).toBe(acquisitionsBeforeCleanup);
    releaseBlocker();
    await Promise.all([blocker, transfer, cleanup]);
    expect(cleanupFinished).toBe(true);
    expect(exclusiveAcquisitions()).toBe(acquisitionsBeforeCleanup + 1);
    expect((await unrelated.listChildren(null)).map(({ name }) => name).includes("Unblocked")).toBe(true);
    first.close();
    second.close();
    unrelated.close();
  });

  test("allows unrelated workspace mutations while account cleanup remains coordinated", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    const otherWorkspace = stableId(4);
    let nextId = 5_000;
    const environment = { indexedDB, IDBKeyRange, now: () => 700, originRoot: memoryOpfsHandle(origin), randomUUID: () => stableId(nextId++), locks: locks as unknown as Pick<LockManager, "request"> };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    await database.createWorkspace({ id: WORKSPACE, name: "First", pinned: true, deviceId: DEVICE });
    await database.createWorkspace({ id: otherWorkspace, name: "Second", pinned: false, deviceId: DEVICE });
    database.close();
    const first = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const second = await openWorkspaceFilesystem(ACCOUNT, otherWorkspace, environment);
    const file = await first.createFile({ name: "First.txt", content: new Blob(["first"]) });
    const next = new Blob(["next"]);
    const hash = await blobHash(next);
    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;
    const chunks = accountRoot.directories.get("chunks")!;
    const shard = chunks.directories.get(hash.slice(0, 2)) ?? chunks.directory(hash.slice(0, 2));
    let staged!: () => void;
    const stagedPromise = new Promise<void>((resolve) => { staged = resolve; });
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    shard.beforeFileClose = async (name) => {
      if (name !== hash) return;
      staged();
      await releasePromise;
    };
    const write = first.writeFile(file.id, next, { expectedContentTuple: file.fieldTuples.content! });
    await stagedPromise;
    const otherMutation = second.createFolder({ name: "Unblocked" });
    try {
      const progressed = await Promise.race([otherMutation.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000))]);
      expect(progressed).toBe(true);
    } finally {
      release();
    }
    await Promise.all([write, otherMutation]);
    expect((await second.listChildren(null)).map(({ name }) => name).includes("Unblocked")).toBe(true);
    first.close();
    second.close();
  });
});

import { describe, expect, test } from "bun:test";
import { IDBDatabase, IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  filesystemDatabaseName,
  openFilesystemDatabase,
  type FilesystemDatabase,
  type WorkspaceOperationDraft,
} from "../src/filesystem/database";
import {
  WEB2_CHUNK_SIZE,
  canonicalManifestSha256,
  type Manifest,
} from "../src/filesystem/model";

const ACCOUNT = stableId(1);
const WORKSPACE = stableId(2);
const DEVICE = stableId(3);
const ACCOUNT_HASH = "11e594f481958c10e3015d0bf0447a22f068a8a647f475df15ce2c7ab4b8f3f1";

function stableId(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function environment(factory: IDBFactory, now?: () => number) {
  return { indexedDB: factory, IDBKeyRange, now };
}

function idbRequest<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function openRaw(factory: IDBFactory, name: string, version?: number, upgrade?: (database: IDBDatabase) => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = version === undefined ? factory.open(name) : factory.open(name, version);
    open.onupgradeneeded = () => upgrade?.(open.result);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function readStored(factory: IDBFactory, name: string, storeName: string, key?: IDBValidKey) {
  const database = await openRaw(factory, name);
  try {
    const store = database.transaction(storeName).objectStore(storeName);
    return key === undefined ? idbRequest(store.getAll()) : idbRequest(store.get(key));
  } finally {
    database.close();
  }
}

async function verifiedManifest(size: number, digit: number) {
  const manifest: Manifest = {
    schemaVersion: 1,
    size,
    chunkSize: WEB2_CHUNK_SIZE,
    chunks: size === 0 ? [] : [{ hash: digit.toString(16).repeat(64), size }],
  };
  return { hash: await canonicalManifestSha256(manifest), manifest };
}

function folder(id: string, name: string, parentId: string | null = null) {
  return { id, kind: "folder" as const, name, parentId, position: { x: 1, y: 2 }, createdAt: 10, modifiedAt: 10 };
}

function file(id: string, name: string, manifest: Awaited<ReturnType<typeof verifiedManifest>>, parentId: string | null = null, modifiedAt = 10) {
  return { id, kind: "file" as const, name, parentId, position: { x: 3, y: 4 }, createdAt: 10, modifiedAt, mimeType: "text/plain", size: manifest.manifest.size, manifestHash: manifest.hash };
}

function createDraft(operationId: string, nodes: ReturnType<typeof folder | typeof file>[], workspaceId = WORKSPACE): WorkspaceOperationDraft {
  return { schemaVersion: 1, kind: "create", operationId, workspaceId, deviceId: DEVICE, nodes };
}

function writeDraft(operationId: string, nodeId: string, manifest: Awaited<ReturnType<typeof verifiedManifest>>, modifiedAt: number): WorkspaceOperationDraft {
  return { schemaVersion: 1, kind: "write", operationId, workspaceId: WORKSPACE, deviceId: DEVICE, nodeId, mimeType: "text/markdown", size: manifest.manifest.size, manifestHash: manifest.hash, modifiedAt };
}

async function workspaceDatabase(factory: IDBFactory, now?: () => number, id = WORKSPACE) {
  const database = await openFilesystemDatabase(ACCOUNT, environment(factory, now));
  await database.createWorkspace({ id, name: "Workspace", pinned: true, deviceId: DEVICE });
  return database;
}

async function expectEmptyCommit(database: FilesystemDatabase, factory: IDBFactory, expectedRevision = 0) {
  expect(await database.listOperations(WORKSPACE)).toEqual([]);
  expect((await database.listWorkspaces())[0]!.localRevision).toBe(expectedRevision);
  expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "changes")).toEqual([]);
}

describe("web2 filesystem database", () => {
  test("uses only the fresh account namespace and leaves an old sentinel untouched", async () => {
    const factory = new IDBFactory();
    const oldName = "hiraya-indexeddb-v1-sentinel";
    const old = await openRaw(factory, oldName, 1, (database) => database.createObjectStore("sentinel"));
    await idbRequest(old.transaction("sentinel", "readwrite").objectStore("sentinel").put("untouched", "value"));
    old.close();

    expect(await filesystemDatabaseName(ACCOUNT)).toBe(`hiraya-web2-v1-${ACCOUNT_HASH}`);
    const database = await openFilesystemDatabase(ACCOUNT, environment(factory));
    database.close();

    expect(await readStored(factory, oldName, "sentinel", "value")).toBe("untouched");
    expect((await factory.databases()).map(({ name }) => name).sort()).toEqual([oldName, `hiraya-web2-v1-${ACCOUNT_HASH}`].sort());
  });

  test("creates the exact version 1 schema and requests strict write durability", async () => {
    const factory = new IDBFactory();
    const durabilities: Array<IDBTransactionOptions["durability"] | undefined> = [];
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (storeNames, mode, options) {
      if (mode === "readwrite") durabilities.push(options?.durability);
      return originalTransaction.call(this, storeNames, mode, options);
    };
    let database: FilesystemDatabase | undefined;
    try {
      database = await workspaceDatabase(factory);
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction;
    }

    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    try {
      expect(raw.version).toBe(1);
      expect([...raw.objectStoreNames]).toEqual(["changes", "hydration-pages", "manifests", "nodes", "operations", "settings", "sync", "workspaces"]);
      const transaction = raw.transaction([...raw.objectStoreNames]);
      const expected = {
        workspaces: { keyPath: "id", indexes: [] },
        nodes: { keyPath: "id", indexes: ["by-workspace-lifecycle", "by-workspace-parent-lifecycle"] },
        manifests: { keyPath: "hash", indexes: [] },
        operations: { keyPath: "operationId", indexes: ["by-workspace-revision", "by-workspace-state-revision"] },
        changes: { keyPath: ["workspaceId", "revision"], indexes: [] },
        sync: { keyPath: "workspaceId", indexes: [] },
        settings: { keyPath: ["workspaceId", "namespace", "key"], indexes: [] },
        "hydration-pages": { keyPath: ["workspaceId", "targetId", "pageIndex"], indexes: [] },
      };
      for (const [name, schema] of Object.entries(expected)) {
        const store = transaction.objectStore(name);
        expect(store.keyPath).toEqual(schema.keyPath);
        expect(store.autoIncrement).toBe(false);
        expect([...store.indexNames]).toEqual(schema.indexes);
      }
      expect(transaction.objectStore("nodes").index("by-workspace-parent-lifecycle")).toMatchObject({ keyPath: ["workspaceId", "parentKey", "lifecycleKey"], unique: false, multiEntry: false });
      expect(transaction.objectStore("nodes").index("by-workspace-lifecycle")).toMatchObject({ keyPath: ["workspaceId", "lifecycleKey"], unique: false, multiEntry: false });
      expect(transaction.objectStore("operations").index("by-workspace-revision")).toMatchObject({ keyPath: ["workspaceId", "localRevision"], unique: true, multiEntry: false });
      expect(transaction.objectStore("operations").index("by-workspace-state-revision")).toMatchObject({ keyPath: ["workspaceId", "stateKind", "localRevision"], unique: false, multiEntry: false });
    } finally {
      raw.close();
      database?.close();
    }
    expect(durabilities.length).toBeGreaterThan(0);
    expect(durabilities.every((durability) => durability === "strict")).toBe(true);
  });

  test("initializes workspace and sync state atomically and reloads them unchanged", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const expected = { id: WORKSPACE, name: "Workspace", pinned: true, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 };
    expect(await database.listWorkspaces()).toEqual([expected]);
    const name = await filesystemDatabaseName(ACCOUNT);
    expect(await readStored(factory, name, "sync", WORKSPACE)).toEqual({ workspaceId: WORKSPACE, deviceId: DEVICE, cursor: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 });
    database.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect(await reopened.listWorkspaces()).toEqual([expected]);
    reopened.close();
  });

  test("commits a folder and file forest with exact records, inverse, change, and clocks", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    const manifest = await verifiedManifest(3, 1);
    const rootId = stableId(10);
    const fileId = stableId(11);
    const looseFileId = stableId(12);
    const operationId = stableId(20);
    const stored = await database.commitOperation({
      operation: createDraft(operationId, [folder(rootId, "Folder"), file(fileId, "Nested.txt", manifest, rootId), file(looseFileId, "Loose.txt", manifest)]),
      manifests: [manifest],
    });

    expect(stored).toMatchObject({ operationId, localRevision: 1, stateKind: "pending", intent: "forward", compensatesOperationId: null, inverse: { kind: "create", rootNodeIds: [rootId, looseFileId] }, versionNodeIds: [fileId, looseFileId] });
    expect(stored.operation.logicalTime).toBe(100);
    expect(await database.listChildren(WORKSPACE, null)).toHaveLength(2);
    expect((await database.listChildren(WORKSPACE, rootId)).map(({ id }) => id)).toEqual([fileId]);
    const createdFile = await database.getNode(fileId);
    expect(createdFile).toMatchObject({ workspaceId: WORKSPACE, id: fileId, lifecycle: { kind: "active" }, size: 3, manifestHash: manifest.hash });
    expect(createdFile).not.toHaveProperty("parentKey");
    expect(createdFile).not.toHaveProperty("lifecycleKey");
    expect(createdFile!.fieldTuples).toEqual({
      name: { logicalTime: 100, operationId },
      parent: { logicalTime: 100, operationId },
      lifecycle: { logicalTime: 100, operationId },
      position: { logicalTime: 100, operationId },
      content: { logicalTime: 100, operationId },
    });
    expect((await database.getNode(rootId))!.fieldTuples.content).toBeNull();
    expect(await database.getManifest(manifest.hash)).toEqual(manifest.manifest);

    const name = await filesystemDatabaseName(ACCOUNT);
    expect(await readStored(factory, name, "changes", [WORKSPACE, 1])).toEqual({ workspaceId: WORKSPACE, revision: 1, operationId, affectedIdentities: stored.affectedIdentities });
    expect(await readStored(factory, name, "sync", WORKSPACE)).toEqual({ workspaceId: WORKSPACE, deviceId: DEVICE, cursor: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 100 });
    expect(await database.listWorkspaces()).toEqual([{ id: WORKSPACE, name: "Workspace", pinned: true, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 1 }]);
    database.close();
  });

  test("atomically rejects missing, wrongly hashed, and size-mismatched manifests", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const manifest = await verifiedManifest(3, 2);
    const draft = createDraft(stableId(30), [file(stableId(31), "File.txt", manifest)]);
    await expect(database.commitOperation({ operation: draft })).rejects.toThrow("missing manifest");
    await expect(database.commitOperation({ operation: draft, manifests: [{ hash: "f".repeat(64), manifest: manifest.manifest }] })).rejects.toThrow("canonical bytes");
    await expect(database.commitOperation({ operation: createDraft(stableId(32), [{ ...file(stableId(33), "Wrong.txt", manifest), size: 4 }]), manifests: [manifest] })).rejects.toThrow("size does not match");
    await expectEmptyCommit(database, factory);
    expect(await database.getNode(stableId(31))).toBeUndefined();
    expect(await database.getManifest(manifest.hash)).toBeUndefined();
    database.close();
  });

  test("atomically rejects missing and file parents", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    await expect(database.commitOperation({ operation: createDraft(stableId(40), [folder(stableId(41), "Child", stableId(42))]) })).rejects.toThrow("parent does not exist");
    await expectEmptyCommit(database, factory);

    const manifest = await verifiedManifest(1, 3);
    const parentFileId = stableId(43);
    await database.commitOperation({ operation: createDraft(stableId(44), [file(parentFileId, "Parent.txt", manifest)]), manifests: [manifest] });
    await expect(database.commitOperation({ operation: createDraft(stableId(45), [folder(stableId(46), "Child", parentFileId)]) })).rejects.toThrow("active folder");
    expect(await database.listOperations(WORKSPACE)).toHaveLength(1);
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(1);
    expect(await database.getNode(stableId(46))).toBeUndefined();
    database.close();
  });

  test("atomically rejects global node ID reuse and case-insensitive sibling collisions", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const reusedId = stableId(50);
    await database.commitOperation({ operation: createDraft(stableId(51), [folder(reusedId, "Existing")]) });
    const otherWorkspace = stableId(52);
    await database.createWorkspace({ id: otherWorkspace, name: "Other", pinned: false, deviceId: DEVICE });
    await expect(database.commitOperation({ operation: createDraft(stableId(53), [folder(reusedId, "Elsewhere")], otherWorkspace) })).rejects.toThrow("already exists");
    await expect(database.commitOperation({ operation: createDraft(stableId(54), [folder(stableId(55), "existing")]) })).rejects.toThrow("sibling");
    await expect(database.commitOperation({ operation: createDraft(stableId(56), [folder(stableId(57), "Same"), folder(stableId(58), "same")]) })).rejects.toThrow("duplicate sibling names");
    expect(await database.listOperations(WORKSPACE)).toHaveLength(1);
    expect(await database.listOperations(otherWorkspace)).toEqual([]);
    expect(await database.getNode(stableId(55))).toBeUndefined();
    database.close();
  });

  test("write changes only file content fields and captures the exact previous version", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 200);
    const originalManifest = await verifiedManifest(1, 4);
    const nextManifest = await verifiedManifest(2, 5);
    const nodeId = stableId(60);
    const createId = stableId(61);
    const writeId = stableId(62);
    await database.commitOperation({ operation: createDraft(createId, [file(nodeId, "Notes.txt", originalManifest)]), manifests: [originalManifest] });
    const before = await database.getNode(nodeId);
    const stored = await database.commitOperation({ operation: writeDraft(writeId, nodeId, nextManifest, 99), manifests: [nextManifest], intent: "restore", compensatesOperationId: createId });
    const after = await database.getNode(nodeId);

    expect(stored.inverse).toEqual({ kind: "write", nodeId, mimeType: "text/plain", size: 1, manifestHash: originalManifest.hash, modifiedAt: 10 });
    expect(stored).toMatchObject({ localRevision: 2, intent: "restore", compensatesOperationId: createId, versionNodeIds: [nodeId] });
    expect(after).toEqual({
      ...before,
      mimeType: "text/markdown",
      size: 2,
      manifestHash: nextManifest.hash,
      modifiedAt: 99,
      fieldTuples: { ...before!.fieldTuples, content: { logicalTime: 201, operationId: writeId } },
    });
    database.close();
  });

  test("advances the logical clock monotonically when wall time does not move", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 500);
    const first = await verifiedManifest(1, 6);
    const second = await verifiedManifest(2, 7);
    const third = await verifiedManifest(3, 8);
    const nodeId = stableId(70);
    const one = await database.commitOperation({ operation: createDraft(stableId(71), [file(nodeId, "Clock.txt", first)]), manifests: [first] });
    const two = await database.commitOperation({ operation: writeDraft(stableId(72), nodeId, second, 11), manifests: [second] });
    const three = await database.commitOperation({ operation: writeDraft(stableId(73), nodeId, third, 12), manifests: [third] });
    expect([one.operation.logicalTime, two.operation.logicalTime, three.operation.logicalTime]).toEqual([500, 501, 502]);
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "sync", WORKSPACE)).toMatchObject({ cursor: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 502 });
    database.close();
  });

  test("replays identical operation IDs without a revision and rejects changed reuse", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 600);
    const operation = createDraft(stableId(80), [folder(stableId(81), "Replay")]);
    const first = await database.commitOperation({ operation });
    const replay = await database.commitOperation({ operation });
    expect(replay).toEqual(first);
    expect(await database.listOperations(WORKSPACE)).toEqual([first]);
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(1);
    await expect(database.commitOperation({ operation: { ...operation, nodes: [folder(stableId(81), "Changed")] } })).rejects.toThrow("cannot be reused");
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(1);
    database.close();
  });

  test("lists the current version first and caps older local versions at twenty", async () => {
    const factory = new IDBFactory();
    let time = 700;
    const database = await workspaceDatabase(factory, () => time++);
    const nodeId = stableId(90);
    const initial = await verifiedManifest(1, 9);
    const createId = stableId(91);
    await database.commitOperation({ operation: createDraft(createId, [file(nodeId, "History.txt", initial)]), manifests: [initial] });
    const second = await verifiedManifest(2, 10);
    const secondId = stableId(92);
    await database.commitOperation({ operation: writeDraft(secondId, nodeId, second, 20), manifests: [second] });
    expect((await database.listFileVersions(WORKSPACE, nodeId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([
      { operationId: secondId, current: true },
      { operationId: createId, current: false },
    ]);

    const writeIds = [secondId];
    for (let index = 0; index < 20; index += 1) {
      const manifest = await verifiedManifest(index + 3, index % 5 + 10);
      const operationId = stableId(100 + index);
      writeIds.push(operationId);
      await database.commitOperation({ operation: writeDraft(operationId, nodeId, manifest, 21 + index), manifests: [manifest] });
    }
    const versions = await database.listFileVersions(WORKSPACE, nodeId);
    expect(versions).toHaveLength(21);
    expect(versions[0]).toMatchObject({ operationId: writeIds.at(-1), current: true, modifiedAt: 40 });
    expect(versions.slice(1).map(({ operationId }) => operationId)).toEqual(writeIds.slice(0, -1).reverse());
    expect(versions.some(({ operationId }) => operationId === createId)).toBe(false);
    database.close();
  });

  test("closes and reopens an identical projection and history", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 800);
    const manifest = await verifiedManifest(2, 14);
    const nodeId = stableId(130);
    await database.commitOperation({ operation: createDraft(stableId(131), [file(nodeId, "Reload.txt", manifest)]), manifests: [manifest] });
    const before = {
      workspaces: await database.listWorkspaces(),
      node: await database.getNode(nodeId),
      operations: await database.listOperations(WORKSPACE),
      versions: await database.listFileVersions(WORKSPACE, nodeId),
    };
    database.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect({
      workspaces: await reopened.listWorkspaces(),
      node: await reopened.getNode(nodeId),
      operations: await reopened.listOperations(WORKSPACE),
      versions: await reopened.listFileVersions(WORKSPACE, nodeId),
    }).toEqual(before);
    reopened.close();
  });

  test("rejects malformed stored records instead of projecting them", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const malformedId = stableId(140);
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(raw.transaction("nodes", "readwrite").objectStore("nodes").put({ id: malformedId, parentKey: "", lifecycleKey: "active" }));
    raw.close();
    await expect(database.getNode(malformedId)).rejects.toThrow("unsupported shape");
    database.close();
  });

  test("rejects a malformed same-name database without resetting it", async () => {
    const factory = new IDBFactory();
    const name = await filesystemDatabaseName(ACCOUNT);
    const malformed = await openRaw(factory, name, 1, (database) => database.createObjectStore("sentinel"));
    await idbRequest(malformed.transaction("sentinel", "readwrite").objectStore("sentinel").put("preserved", "value"));
    malformed.close();

    await expect(openFilesystemDatabase(ACCOUNT, environment(factory))).rejects.toThrow("schema is malformed");
    const preserved = await openRaw(factory, name);
    try {
      expect(preserved.version).toBe(1);
      expect([...preserved.objectStoreNames]).toEqual(["sentinel"]);
      expect(await idbRequest(preserved.transaction("sentinel").objectStore("sentinel").get("value"))).toBe("preserved");
    } finally {
      preserved.close();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { IDBDatabase, IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
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

function copyDraft(operationId: string, sourceNodeIds: string[], nodes: ReturnType<typeof folder | typeof file>[]): Extract<WorkspaceOperationDraft, { kind: "copy" }> {
  return { schemaVersion: 1, kind: "copy", operationId, workspaceId: WORKSPACE, deviceId: DEVICE, sourceNodeIds, nodes };
}

function writeDraft(operationId: string, nodeId: string, manifest: Awaited<ReturnType<typeof verifiedManifest>>, modifiedAt: number): Extract<WorkspaceOperationDraft, { kind: "write" }> {
  return { schemaVersion: 1, kind: "write", operationId, workspaceId: WORKSPACE, deviceId: DEVICE, nodeId, mimeType: "text/markdown", size: manifest.manifest.size, manifestHash: manifest.hash, modifiedAt };
}

function versionDraft(operationId: string, nodeId: string, version: { mimeType: string; size: number; manifestHash: string; modifiedAt: number }): WorkspaceOperationDraft {
  return { schemaVersion: 1, kind: "write", operationId, workspaceId: WORKSPACE, deviceId: DEVICE, nodeId, ...version };
}

function operationBase(operationId: string) {
  return { schemaVersion: 1 as const, operationId, workspaceId: WORKSPACE, deviceId: DEVICE };
}

async function workspaceDatabase(factory: IDBFactory, now?: () => number, id = WORKSPACE) {
  const database = await openFilesystemDatabase(ACCOUNT, environment(factory, now));
  await database.createWorkspace({ id, name: "Workspace", pinned: true, deviceId: DEVICE });
  return database;
}

async function commitWrite(database: FilesystemDatabase, operation: Extract<WorkspaceOperationDraft, { kind: "write" }>, manifests: Array<Awaited<ReturnType<typeof verifiedManifest>>>) {
  const node = await database.getNode(operation.nodeId);
  if (!node || node.kind !== "file") throw new Error("The test file does not exist.");
  return database.commitOperation({ operation, manifests, expectedContentTuple: node.fieldTuples.content! });
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

  test("recovers validated device state and one operation by identity", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 90);
    const operationId = stableId(9);
    expect(await database.getSyncState(WORKSPACE)).toEqual({ workspaceId: WORKSPACE, deviceId: DEVICE, cursor: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 });
    expect(await database.getOperation(operationId)).toBeUndefined();
    const committed = await database.commitOperation({ operation: createDraft(operationId, [folder(stableId(8), "Lookup")]) });
    expect(await database.getOperation(operationId)).toEqual(committed);
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ workspaceId: WORKSPACE, deviceId: DEVICE, lastLocalLogicalTime: 90 });
    database.close();
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
    await expect(database.commitOperation({ operation: createDraft(stableId(34), [folder(stableId(35), "Folder")]), manifests: [manifest] })).rejects.toThrow("unreferenced manifest");
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
    const stored = await database.commitOperation({ operation: writeDraft(writeId, nodeId, nextManifest, 99), manifests: [nextManifest], expectedContentTuple: before!.fieldTuples.content });
    const after = await database.getNode(nodeId);

    expect(stored.inverse).toEqual({ kind: "write", nodeId, mimeType: "text/plain", size: 1, manifestHash: originalManifest.hash, modifiedAt: 10 });
    expect(stored).toMatchObject({ localRevision: 2, intent: "forward", compensatesOperationId: null, versionNodeIds: [nodeId] });
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

  test("atomically enforces an exact expected content tuple", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 300);
    const nodeId = stableId(63);
    const initial = await verifiedManifest(1, 4);
    const next = await verifiedManifest(2, 5);
    const stale = await verifiedManifest(3, 6);
    await database.commitOperation({ operation: createDraft(stableId(64), [file(nodeId, "Expected.txt", initial)]), manifests: [initial] });
    const expectedContentTuple = (await database.getNode(nodeId))!.fieldTuples.content!;
    const accepted = await database.commitOperation({ operation: writeDraft(stableId(65), nodeId, next, 20), manifests: [next], expectedContentTuple });
    const after = await database.getNode(nodeId);

    expect(accepted.expectedContentTuple).toEqual(expectedContentTuple);
    await expect(database.commitOperation({ operation: writeDraft(stableId(149), nodeId, stale, 21), manifests: [stale] } as never)).rejects.toThrow("exact expected content tuple");
    await expect(database.commitOperation({ operation: writeDraft(stableId(66), nodeId, stale, 21), manifests: [stale], expectedContentTuple })).rejects.toThrow("content changed");
    expect(await database.getNode(nodeId)).toEqual(after);
    expect(await database.getOperation(stableId(66))).toBeUndefined();
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(2);
    database.close();
  });

  test("accepts durable write compensation chains and rejects invalid metadata atomically", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 400);
    const nodeId = stableId(67);
    const initial = await verifiedManifest(1, 7);
    const next = await verifiedManifest(2, 8);
    const createId = stableId(68);
    const writeId = stableId(69);
    await database.commitOperation({ operation: createDraft(createId, [file(nodeId, "Compensation.txt", initial)]), manifests: [initial] });
    const createTuple = (await database.getNode(nodeId))!.fieldTuples.content!;
    const write = await database.commitOperation({ operation: writeDraft(writeId, nodeId, next, 20), manifests: [next], expectedContentTuple: createTuple });
    const writeTuple = { logicalTime: write.operation.logicalTime, operationId: write.operationId };
    const inverse = write.inverse.kind === "write" ? write.inverse : undefined;
    expect(inverse).toBeDefined();

    await expect(database.commitOperation({ operation: versionDraft(stableId(150), nodeId, inverse!), intent: "forward", compensatesOperationId: writeId, expectedContentTuple: writeTuple })).rejects.toThrow("forward operation");
    await expect(database.commitOperation({ operation: versionDraft(stableId(151), nodeId, inverse!), intent: "undo", compensatesOperationId: stableId(999), expectedContentTuple: writeTuple })).rejects.toThrow("existing operation");
    await expect(database.commitOperation({ operation: versionDraft(stableId(152), nodeId, inverse!), intent: "undo", compensatesOperationId: createId, expectedContentTuple: writeTuple })).rejects.toThrow("Create and copy undo");
    await expect(database.commitOperation({ operation: versionDraft(stableId(153), nodeId, inverse!), intent: "redo", compensatesOperationId: writeId, expectedContentTuple: writeTuple })).rejects.toThrow("undo inverse");

    const otherWorkspace = stableId(154);
    const otherOperationId = stableId(155);
    await database.createWorkspace({ id: otherWorkspace, name: "Other", pinned: false, deviceId: DEVICE });
    await database.commitOperation({ operation: createDraft(otherOperationId, [folder(stableId(156), "Elsewhere")], otherWorkspace) });
    await expect(database.commitOperation({ operation: versionDraft(stableId(157), nodeId, inverse!), intent: "undo", compensatesOperationId: otherOperationId, expectedContentTuple: writeTuple })).rejects.toThrow("same workspace");

    await database.commitOperation({ operation: { ...operationBase(stableId(160)), kind: "rename", nodeId, name: "Renamed.txt", modifiedAt: 99 } });
    const undoId = stableId(158);
    const undo = await database.commitOperation({ operation: versionDraft(undoId, nodeId, inverse!), intent: "undo", compensatesOperationId: writeId, expectedContentTuple: writeTuple });
    expect(undo).toMatchObject({ intent: "undo", compensatesOperationId: writeId });
    expect(await database.getNode(nodeId)).toMatchObject({ name: "Renamed.txt", manifestHash: initial.hash });
    const redoId = stableId(159);
    const redoInverse = undo.inverse.kind === "write" ? undo.inverse : undefined;
    const redoInput = { operation: versionDraft(redoId, nodeId, redoInverse!), intent: "redo" as const, compensatesOperationId: undoId, expectedContentTuple: { logicalTime: undo.operation.logicalTime, operationId: undoId } };
    const redo = await database.commitOperation(redoInput);
    expect(redo).toMatchObject({ intent: "redo", compensatesOperationId: undoId });
    expect(await database.commitOperation(redoInput)).toEqual(redo);
    await expect(database.commitOperation({ ...redoInput, intent: "restore", compensatesOperationId: createId })).rejects.toThrow("cannot be reused");
    await expect(database.commitOperation({ ...redoInput, compensatesOperationId: createId })).rejects.toThrow("cannot be reused");
    expect((await database.getNode(nodeId))?.manifestHash).toBe(next.hash);
    const restore = await database.commitOperation({ operation: versionDraft(stableId(163), nodeId, inverse!), intent: "restore", compensatesOperationId: createId, expectedContentTuple: { logicalTime: redo.operation.logicalTime, operationId: redoId } });
    expect(restore).toMatchObject({ intent: "restore", compensatesOperationId: createId });
    expect((await database.getNode(nodeId))?.manifestHash).toBe(initial.hash);
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
    const two = await commitWrite(database, writeDraft(stableId(72), nodeId, second, 11), [second]);
    const three = await commitWrite(database, writeDraft(stableId(73), nodeId, third, 12), [third]);
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

  test("copies complete source forests with strict history, dynamic identities, replay, and reopen", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 650);
    const manifest = await verifiedManifest(3, 12);
    const sourceRootId = stableId(170);
    const sourceFolderId = stableId(171);
    const sourceFileId = stableId(172);
    const emptyRootId = stableId(173);
    const destinationId = stableId(174);
    const sourceRoot = folder(sourceRootId, "Source");
    const sourceFolder = folder(sourceFolderId, "Nested", sourceRootId);
    const sourceFile = file(sourceFileId, "Notes.txt", manifest, sourceFolderId);
    const emptyRoot = folder(emptyRootId, "Empty");
    await database.commitOperation({ operation: createDraft(stableId(175), [sourceRoot, sourceFolder, sourceFile, emptyRoot, folder(destinationId, "Destination")]), manifests: [manifest] });

    const copiedRootId = stableId(176);
    const copiedFolderId = stableId(177);
    const copiedFileId = stableId(178);
    const copiedEmptyId = stableId(179);
    const copyId = stableId(180);
    const nodes = [
      { ...sourceRoot, id: copiedRootId, name: "Source copy", parentId: destinationId, position: { x: 90, y: 91 }, createdAt: 77, modifiedAt: 77 },
      { ...sourceFolder, id: copiedFolderId, parentId: copiedRootId, createdAt: 77, modifiedAt: 77 },
      { ...sourceFile, id: copiedFileId, parentId: copiedFolderId, createdAt: 77, modifiedAt: 77 },
      { ...emptyRoot, id: copiedEmptyId, name: "Empty copy", parentId: destinationId, position: { x: 92, y: 93 }, createdAt: 77, modifiedAt: 77 },
    ];
    const operation = copyDraft(copyId, [sourceRootId, emptyRootId], nodes);
    const copied = await database.commitOperation({ operation });

    expect(copied).toMatchObject({ inverse: { kind: "copy", rootNodeIds: [copiedRootId, copiedEmptyId], sourceNodeIds: [sourceRootId, sourceFolderId, sourceFileId, emptyRootId].sort(), sourceFileNodeIds: [sourceFileId] }, versionNodeIds: [copiedFileId], localRevision: 2 });
    expect(copied.affectedIdentities).toEqual([...copied.affectedIdentities].sort());
    for (const id of [sourceRootId, sourceFolderId, sourceFileId, emptyRootId]) expect(copied.affectedIdentities).toContain(`node:${WORKSPACE}:${id}`);
    expect(copied.affectedIdentities).toContain(`content:${WORKSPACE}:${sourceFileId}`);
    expect(await database.getNode(sourceFileId)).toMatchObject(sourceFile);
    expect(await database.getNode(copiedRootId)).toMatchObject({ name: "Source copy", parentId: destinationId, position: { x: 90, y: 91 }, createdAt: 77, modifiedAt: 77 });
    expect(await database.getNode(copiedFolderId)).toMatchObject({ name: sourceFolder.name, parentId: copiedRootId, position: sourceFolder.position, createdAt: 77, modifiedAt: 77 });
    expect(await database.getNode(copiedFileId)).toMatchObject({ name: sourceFile.name, parentId: copiedFolderId, mimeType: sourceFile.mimeType, size: sourceFile.size, manifestHash: sourceFile.manifestHash, createdAt: 77, modifiedAt: 77 });
    expect((await database.listFileVersions(WORKSPACE, copiedFileId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([{ operationId: copyId, current: true }]);
    const nextManifest = await verifiedManifest(4, 13);
    const writeId = stableId(184);
    await commitWrite(database, writeDraft(writeId, copiedFileId, nextManifest, 78), [nextManifest]);
    expect((await database.listFileVersions(WORKSPACE, copiedFileId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([
      { operationId: writeId, current: true },
      { operationId: copyId, current: false },
    ]);
    expect(await database.commitOperation({ operation })).toEqual(copied);
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(3);

    const beforeReopen = {
      nodes: await Promise.all(nodes.map(({ id }) => database.getNode(id))),
      operations: await database.listOperations(WORKSPACE),
      versions: await database.listFileVersions(WORKSPACE, copiedFileId),
    };
    database.close();
    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect({
      nodes: await Promise.all(nodes.map(({ id }) => reopened.getNode(id))),
      operations: await reopened.listOperations(WORKSPACE),
      versions: await reopened.listFileVersions(WORKSPACE, copiedFileId),
    }).toEqual(beforeReopen);
    await reopened.commitOperation({ operation: { ...operationBase(stableId(181)), kind: "trash", nodeIds: [copiedRootId], trashedAt: 80 } });
    await reopened.commitOperation({ operation: { ...operationBase(stableId(182)), kind: "purge", nodeIds: [copiedRootId] } });
    await expect(reopened.commitOperation({ operation: createDraft(stableId(183), [folder(copiedFileId, "Reused")]) })).rejects.toThrow("retained operation history");
    reopened.close();
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
    await commitWrite(database, writeDraft(secondId, nodeId, second, 20), [second]);
    expect((await database.listFileVersions(WORKSPACE, nodeId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([
      { operationId: secondId, current: true },
      { operationId: createId, current: false },
    ]);

    const writeIds = [secondId];
    for (let index = 0; index < 20; index += 1) {
      const manifest = await verifiedManifest(index + 3, index % 5 + 10);
      const operationId = stableId(100 + index);
      writeIds.push(operationId);
      await commitWrite(database, writeDraft(operationId, nodeId, manifest, 21 + index), [manifest]);
    }
    const versions = await database.listFileVersions(WORKSPACE, nodeId);
    expect(versions).toHaveLength(21);
    expect(versions[0]).toMatchObject({ operationId: writeIds.at(-1), current: true, modifiedAt: 40 });
    expect(versions.slice(1).map(({ operationId }) => operationId)).toEqual(writeIds.slice(0, -1).reverse());
    expect(versions.some(({ operationId }) => operationId === createId)).toBe(false);
    database.close();
  });

  test("commits exact metadata, lifecycle, and setting projections through purge and reopen", async () => {
    const factory = new IDBFactory();
    let time = 900;
    const database = await workspaceDatabase(factory, () => time++);
    const manifest = await verifiedManifest(3, 15);
    const sourceId = stableId(200);
    const destinationId = stableId(201);
    const treeId = stableId(202);
    const fileId = stableId(203);
    const retainedTrashId = stableId(204);
    const createId = stableId(210);
    await database.commitOperation({ operation: createDraft(createId, [
      folder(sourceId, "Source"),
      folder(destinationId, "Destination"),
      folder(treeId, "Tree", sourceId),
      file(fileId, "Notes.txt", manifest, treeId),
      folder(retainedTrashId, "Later"),
    ]), manifests: [manifest] });
    const createdFile = (await database.getNode(fileId))!;

    const renameId = stableId(211);
    const rename = await database.commitOperation({ operation: { ...operationBase(renameId), kind: "rename", nodeId: fileId, name: "Renamed.txt", modifiedAt: 20 } });
    const renamedFile = (await database.getNode(fileId))!;
    expect(rename.inverse).toEqual({ kind: "rename", nodeId: fileId, name: "Notes.txt", modifiedAt: 10 });
    expect(renamedFile).toEqual({ ...createdFile, name: "Renamed.txt", modifiedAt: 20, fieldTuples: { ...createdFile.fieldTuples, name: { logicalTime: 901, operationId: renameId } } });

    const positionId = stableId(212);
    const position = await database.commitOperation({ operation: { ...operationBase(positionId), kind: "position", positions: [{ nodeId: fileId, position: { x: 9, y: 8 } }] } });
    const positionedFile = (await database.getNode(fileId))!;
    expect(position.inverse).toEqual({ kind: "position", positions: [{ nodeId: fileId, position: { x: 3, y: 4 } }] });
    expect(positionedFile).toEqual({ ...renamedFile, position: { x: 9, y: 8 }, fieldTuples: { ...renamedFile.fieldTuples, position: { logicalTime: 902, operationId: positionId } } });

    const treeBeforeMove = (await database.getNode(treeId))!;
    const moveId = stableId(213);
    const move = await database.commitOperation({ operation: { ...operationBase(moveId), kind: "move", nodeIds: [treeId], parentId: destinationId, modifiedAt: 30 } });
    expect(move.inverse).toEqual({ kind: "move", roots: [{ nodeId: treeId, parentId: sourceId, modifiedAt: 10 }] });
    expect(move.affectedIdentities).toEqual([
      `folder:${WORKSPACE}:${destinationId}`,
      `folder:${WORKSPACE}:${sourceId}`,
      `node:${WORKSPACE}:${treeId}`,
    ].sort());
    expect((await readStored(factory, await filesystemDatabaseName(ACCOUNT), "changes", [WORKSPACE, 4]) as { affectedIdentities: string[] }).affectedIdentities).toEqual(move.affectedIdentities);
    expect(await database.getNode(treeId)).toEqual({ ...treeBeforeMove, parentId: destinationId, modifiedAt: 30, fieldTuples: { ...treeBeforeMove.fieldTuples, parent: { logicalTime: 903, operationId: moveId } } });
    expect(await database.getNode(fileId)).toEqual(positionedFile);

    const trashId = stableId(214);
    const trash = await database.commitOperation({ operation: { ...operationBase(trashId), kind: "trash", nodeIds: [fileId, treeId], trashedAt: 40 } });
    expect(trash.inverse).toEqual({ kind: "trash", roots: [{ nodeId: treeId, parentId: destinationId }], nodeIds: [treeId, fileId].sort() });
    expect(trash.affectedIdentities).toEqual([
      `folder:${WORKSPACE}:${destinationId}`,
      `folder:${WORKSPACE}:root`,
      `node:${WORKSPACE}:${fileId}`,
      `node:${WORKSPACE}:${treeId}`,
      `trash:${WORKSPACE}`,
    ].sort());
    expect((await database.listTrash(WORKSPACE)).map(({ id }) => id)).toEqual([treeId]);
    expect((await database.getNode(treeId))?.parentId).toBeNull();
    expect((await database.getNode(fileId))?.parentId).toBe(treeId);
    expect((await database.getNode(fileId))?.fieldTuples).toEqual({ ...positionedFile.fieldTuples, lifecycle: { logicalTime: 904, operationId: trashId } });
    expect((await database.getNode(fileId) as Extract<Awaited<ReturnType<FilesystemDatabase["getNode"]>>, { kind: "file" }>).manifestHash).toBe(manifest.hash);

    const restoreId = stableId(215);
    const restore = await database.commitOperation({ operation: { ...operationBase(restoreId), kind: "restore", nodeIds: [treeId], destination: "original", modifiedAt: 50 } });
    expect(restore.inverse).toMatchObject({ kind: "restore", roots: [{ nodeId: treeId, parentId: null }] });
    expect(restore.inverse.kind === "restore" && restore.inverse.nodes.every(({ lifecycle }) => lifecycle.trashedAt === 40)).toBe(true);
    expect(restore.affectedIdentities).toEqual(trash.affectedIdentities);
    expect((await database.getNode(treeId))?.parentId).toBe(destinationId);
    expect((await database.getNode(fileId))?.lifecycle).toEqual({ kind: "active" });
    expect((await database.listFileVersions(WORKSPACE, fileId)).map(({ operationId, modifiedAt }) => ({ operationId, modifiedAt }))).toEqual([{ operationId: createId, modifiedAt: 10 }]);

    await database.commitOperation({ operation: { ...operationBase(stableId(216)), kind: "trash", nodeIds: [treeId], trashedAt: 60 } });
    const purge = await database.commitOperation({ operation: { ...operationBase(stableId(217)), kind: "purge", nodeIds: [treeId] } });
    expect(purge.inverse).toEqual({ kind: "purge", nodeIds: [treeId, fileId].sort(), reason: "Permanent purge cannot be undone." });
    expect(purge.affectedIdentities).toEqual([
      `folder:${WORKSPACE}:root`,
      `node:${WORKSPACE}:${fileId}`,
      `node:${WORKSPACE}:${treeId}`,
      `trash:${WORKSPACE}`,
    ].sort());
    expect(await database.getNode(treeId)).toBeUndefined();
    await expect(database.commitOperation({ operation: createDraft(stableId(218), [folder(treeId, "Reused")]) })).rejects.toThrow("retained operation history");

    const setNullId = stableId(219);
    const setNull = await database.commitOperation({ operation: { ...operationBase(setNullId), kind: "set", namespace: "editor", key: "theme", value: null } });
    expect(setNull.inverse).toEqual({ kind: "set", namespace: "editor", key: "theme", previous: { exists: false } });
    const setManyDraft = { ...operationBase(stableId(220)), kind: "set-many" as const, namespace: "editor" as const, settings: [{ key: "theme", value: { dark: true } }, { key: "font", value: null }] };
    const setMany = await database.commitOperation({ operation: setManyDraft });
    expect(setMany.inverse).toEqual({ kind: "set-many", namespace: "editor", settings: [{ key: "theme", previous: { exists: true, value: null } }, { key: "font", previous: { exists: false } }] });
    const revisionAfterSettings = (await database.listWorkspaces())[0]!.localRevision;
    expect(await database.commitOperation({ operation: setManyDraft })).toEqual(setMany);
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revisionAfterSettings);
    expect((await database.listSettings(WORKSPACE, "editor")).map(({ key, value, logicalTime, operationId }) => ({ key, value, logicalTime, operationId }))).toEqual([
      { key: "font", value: null, logicalTime: setMany.operation.logicalTime, operationId: setMany.operationId },
      { key: "theme", value: { dark: true }, logicalTime: setMany.operation.logicalTime, operationId: setMany.operationId },
    ]);
    expect((await database.getSetting(WORKSPACE, "editor", "font"))?.value).toBeNull();
    expect(await database.getSetting(WORKSPACE, "editor", "absent")).toBeUndefined();
    expect(await database.listRetainedChunkHashes()).toEqual(["f".repeat(64)]);

    await database.commitOperation({ operation: { ...operationBase(stableId(221)), kind: "trash", nodeIds: [retainedTrashId], trashedAt: 70 } });
    const beforeReopen = { active: await database.listChildren(WORKSPACE, null), trash: await database.listTrash(WORKSPACE), settings: await database.listSettings(WORKSPACE, "editor"), operations: await database.listOperations(WORKSPACE) };
    database.close();
    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect({ active: await reopened.listChildren(WORKSPACE, null), trash: await reopened.listTrash(WORKSPACE), settings: await reopened.listSettings(WORKSPACE, "editor"), operations: await reopened.listOperations(WORKSPACE) }).toEqual(beforeReopen);
    expect(await reopened.getNode(treeId)).toBeUndefined();
    reopened.close();
  });

  test("rejects metadata collisions, invalid destinations, depth overflow, and partial batches atomically", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_000);
    const manifest = await verifiedManifest(1, 1);
    const firstId = stableId(230);
    const secondId = stableId(231);
    const destinationId = stableId(232);
    const childId = stableId(233);
    const destinationFileId = stableId(234);
    await database.commitOperation({ operation: createDraft(stableId(235), [
      folder(firstId, "First"), folder(secondId, "Second"), folder(destinationId, "Destination"), folder(childId, "Child", firstId), file(destinationFileId, "File.txt", manifest), folder(stableId(236), "FIRST", destinationId),
    ]), manifests: [manifest] });
    const beforeFirst = await database.getNode(firstId);
    const beforeSecond = await database.getNode(secondId);

    await expect(database.commitOperation({ operation: { ...operationBase(stableId(237)), kind: "rename", nodeId: secondId, name: "first", modifiedAt: 20 } })).rejects.toThrow("sibling");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(238)), kind: "move", nodeIds: [firstId, secondId], parentId: destinationId, modifiedAt: 21 } })).rejects.toThrow("sibling");
    expect(await database.getNode(firstId)).toEqual(beforeFirst);
    expect(await database.getNode(secondId)).toEqual(beforeSecond);
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(239)), kind: "move", nodeIds: [firstId], parentId: stableId(999), modifiedAt: 22 } })).rejects.toThrow("does not exist");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(240)), kind: "move", nodeIds: [firstId], parentId: destinationFileId, modifiedAt: 22 } })).rejects.toThrow("active folder");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(241)), kind: "move", nodeIds: [firstId], parentId: childId, modifiedAt: 22 } })).rejects.toThrow("descendant");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(242)), kind: "move", nodeIds: [firstId, childId], parentId: null, modifiedAt: 22 } })).rejects.toThrow("overlap");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(246)), kind: "rename", nodeId: secondId, name: "Changed", modifiedAt: 22 }, intent: "undo", compensatesOperationId: stableId(235) } as never)).rejects.toThrow("forward intent only");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(247)), kind: "copy", sourceNodeIds: [firstId], nodes: [folder(stableId(248), "Copy")] } })).rejects.toThrow("complete source forest");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(249)), kind: "transfer", nodeIds: [firstId], destinationWorkspaceId: stableId(250), parentId: null, modifiedAt: 22 } } as never)).rejects.toThrow("Transfer operations");

    await expect(database.commitOperation({ operation: { ...operationBase(stableId(243)), kind: "position", positions: [{ nodeId: firstId, position: { x: 100, y: 100 } }, { nodeId: stableId(998), position: { x: 0, y: 0 } }] } })).rejects.toThrow("active nodes");
    expect(await database.getNode(firstId)).toEqual(beforeFirst);
    await database.commitOperation({ operation: { ...operationBase(stableId(244)), kind: "set", namespace: "editor", key: "safe", value: true } });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(245)), kind: "set-many", namespace: "editor", settings: [{ key: "safe", value: false }, { key: "safe", value: null }] } } as never)).rejects.toThrow("duplicate keys");
    expect((await database.getSetting(WORKSPACE, "editor", "safe"))?.value).toBe(true);

    const tooDeep = Array.from({ length: 66 }, (_, index) => folder(stableId(400 + index), `Too deep ${index}`, index === 0 ? null : stableId(399 + index)));
    await expect(database.commitOperation({ operation: createDraft(stableId(466), tooDeep) })).rejects.toThrow("too deep");
    expect(await database.getNode(stableId(400))).toBeUndefined();
    const overflowParentId = stableId(367);
    const overflowChildId = stableId(368);
    await database.commitOperation({ operation: createDraft(stableId(369), [folder(overflowParentId, "Overflow parent"), folder(overflowChildId, "Overflow child", overflowParentId)]) });
    await database.commitOperation({ operation: { ...operationBase(stableId(500)), kind: "trash", nodeIds: [overflowChildId], trashedAt: 1 } });
    const chain = Array.from({ length: 65 }, (_, index) => folder(stableId(300 + index), `Depth ${index}`, index === 0 ? null : stableId(299 + index)));
    await database.commitOperation({ operation: createDraft(stableId(365), chain) });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(366)), kind: "move", nodeIds: [secondId], parentId: stableId(364), modifiedAt: 23 } })).rejects.toThrow("too deep");
    await database.commitOperation({ operation: { ...operationBase(stableId(501)), kind: "move", nodeIds: [overflowParentId], parentId: stableId(363), modifiedAt: 24 } });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(502)), kind: "restore", nodeIds: [overflowChildId], destination: "original", modifiedAt: 25 } })).rejects.toThrow("too deep");
    expect(await database.getNode(secondId)).toEqual(beforeSecond);
    database.close();
  });

  test("rejects malformed, unavailable, overlapping, colliding, and too-deep copy snapshots atomically", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_025);
    const manifest = await verifiedManifest(2, 13);
    const sourceRootId = stableId(520);
    const sourceFileId = stableId(521);
    const destinationId = stableId(522);
    const collisionId = stableId(523);
    const trashedId = stableId(524);
    const sourceRoot = folder(sourceRootId, "Source");
    const sourceFile = file(sourceFileId, "File.txt", manifest, sourceRootId);
    await database.commitOperation({ operation: createDraft(stableId(525), [sourceRoot, sourceFile, folder(destinationId, "Destination"), folder(collisionId, "Taken", destinationId), folder(trashedId, "Trashed")]), manifests: [manifest] });
    await database.commitOperation({ operation: { ...operationBase(stableId(526)), kind: "trash", nodeIds: [trashedId], trashedAt: 1 } });
    const otherWorkspace = stableId(527);
    const otherRoot = stableId(528);
    await database.createWorkspace({ id: otherWorkspace, name: "Other", pinned: false, deviceId: DEVICE });
    await database.commitOperation({ operation: createDraft(stableId(529), [folder(otherRoot, "Other source")], otherWorkspace) });
    const chain = Array.from({ length: 65 }, (_, index) => folder(stableId(600 + index), `Copy depth ${index}`, index === 0 ? null : stableId(599 + index)));
    await database.commitOperation({ operation: createDraft(stableId(665), chain) });
    const revision = (await database.listWorkspaces())[0]!.localRevision;
    const snapshot = (rootId: string, fileId: string, name = "Source copy") => [
      { ...sourceRoot, id: rootId, name, parentId: destinationId, createdAt: 88, modifiedAt: 88 },
      { ...sourceFile, id: fileId, parentId: rootId, createdAt: 88, modifiedAt: 88 },
    ];

    await expect(database.commitOperation({ operation: copyDraft(stableId(530), [sourceRootId], snapshot(stableId(531), stableId(532)).slice(0, 1)) })).rejects.toThrow("complete source forest");
    await expect(database.commitOperation({ operation: copyDraft(stableId(533), [sourceRootId], [
      snapshot(stableId(534), stableId(535))[0]!,
      { ...folder(stableId(535), "Invented", stableId(534)), createdAt: 88, modifiedAt: 88 },
    ]) })).rejects.toThrow("source snapshot");
    const changed = snapshot(stableId(536), stableId(537));
    changed[1] = { ...changed[1]!, position: { x: 999, y: 4 } };
    await expect(database.commitOperation({ operation: copyDraft(stableId(538), [sourceRootId], changed) })).rejects.toThrow("source snapshot");
    await expect(database.commitOperation({ operation: copyDraft(stableId(539), [stableId(999)], [{ ...folder(stableId(540), "Missing"), createdAt: 88, modifiedAt: 88 }]) })).rejects.toThrow("active source roots");
    await expect(database.commitOperation({ operation: copyDraft(stableId(541), [trashedId], [{ ...folder(stableId(542), "Trashed copy"), parentId: destinationId, createdAt: 88, modifiedAt: 88 }]) })).rejects.toThrow("active source roots");
    await expect(database.commitOperation({ operation: copyDraft(stableId(543), [otherRoot], [{ ...folder(stableId(544), "Cross-workspace"), parentId: destinationId, createdAt: 88, modifiedAt: 88 }]) })).rejects.toThrow("active source roots");
    await expect(database.commitOperation({ operation: copyDraft(stableId(545), [sourceRootId, sourceFileId], [
      ...snapshot(stableId(546), stableId(547)),
      { ...sourceFile, id: stableId(548), name: "File root copy.txt", parentId: destinationId, createdAt: 88, modifiedAt: 88 },
    ]) })).rejects.toThrow("overlap");
    await expect(database.commitOperation({ operation: copyDraft(stableId(549), [sourceRootId], snapshot(stableId(550), stableId(551), "taken")) })).rejects.toThrow("sibling");
    const tooDeep = snapshot(stableId(552), stableId(553));
    tooDeep[0] = { ...tooDeep[0]!, parentId: stableId(664) };
    await expect(database.commitOperation({ operation: copyDraft(stableId(554), [sourceRootId], tooDeep) })).rejects.toThrow("too deep");

    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revision);
    expect(await database.getNode(stableId(531))).toBeUndefined();
    expect(await database.getOperation(stableId(554))).toBeUndefined();
    database.close();
  });

  test("bounds authoritative copy expansion at 256 nodes before projection", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const rootId = stableId(700);
    const firstBatch = [folder(rootId, "Large source"), ...Array.from({ length: 255 }, (_, index) => folder(stableId(701 + index), `Child ${index}`, rootId))];
    await database.commitOperation({ operation: createDraft(stableId(956), firstBatch) });
    await database.commitOperation({ operation: createDraft(stableId(957), [folder(stableId(958), "Overflow child", rootId)]) });
    const revision = (await database.listWorkspaces())[0]!.localRevision;
    await expect(database.commitOperation({ operation: copyDraft(stableId(959), [rootId], [{ ...folder(stableId(960), "Large copy"), createdAt: 20, modifiedAt: 20 }]) })).rejects.toThrow("too large");
    const oversized = Array.from({ length: 257 }, (_, index) => ({ ...folder(stableId(1_000 + index), `Copy ${index}`), createdAt: 20, modifiedAt: 20 }));
    await expect(database.commitOperation({ operation: copyDraft(stableId(1_300), [rootId], oversized) })).rejects.toThrow("batch");
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revision);
    expect(await database.getNode(stableId(960))).toBeUndefined();
    database.close();
  });

  test("rolls back copy projection and rejects malformed retained copy identities", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_040);
    const manifest = await verifiedManifest(1, 14);
    const sourceId = stableId(1_400);
    const sourceFileId = stableId(1_401);
    const source = folder(sourceId, "Source");
    const sourceFile = file(sourceFileId, "File.txt", manifest, sourceId);
    await database.commitOperation({ operation: createDraft(stableId(1_402), [source, sourceFile]), manifests: [manifest] });
    const copiedId = stableId(1_403);
    const copiedFileId = stableId(1_404);
    const operationId = stableId(1_405);
    const operation = copyDraft(operationId, [sourceId], [
      { ...source, id: copiedId, name: "Copy", createdAt: 30, modifiedAt: 30 },
      { ...sourceFile, id: copiedFileId, parentId: copiedId, createdAt: 30, modifiedAt: 30 },
    ]);
    const revision = (await database.listWorkspaces())[0]!.localRevision;
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "operations" && (value as { operationId?: unknown }).operationId === operationId) throw new DOMException("Injected copy failure", "AbortError");
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    try {
      await expect(database.commitOperation({ operation })).rejects.toThrow("Injected copy failure");
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    expect(await database.getNode(copiedId)).toBeUndefined();
    expect(await database.getNode(copiedFileId)).toBeUndefined();
    expect(await database.getOperation(operationId)).toBeUndefined();
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revision);

    const committed = await database.commitOperation({ operation: { ...operation, operationId: stableId(1_406) } });
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(raw.transaction("operations", "readwrite").objectStore("operations").put({ ...committed, affectedIdentities: committed.affectedIdentities.map((identity) => identity === `content:${WORKSPACE}:${sourceFileId}` ? `content:${WORKSPACE}:${stableId(9_999)}` : identity).sort() }));
    raw.close();
    await expect(database.getOperation(committed.operationId)).rejects.toThrow("derived metadata");
    database.close();
  });

  test("rolls back projected metadata when a later transaction write fails", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_050);
    const nodeId = stableId(367);
    const operationId = stableId(368);
    await database.commitOperation({ operation: createDraft(stableId(369), [folder(nodeId, "Original")]) });
    const before = await database.getNode(nodeId);
    const revision = (await database.listWorkspaces())[0]!.localRevision;
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "operations" && (value as { operationId?: unknown }).operationId === operationId) throw new DOMException("Injected failure", "AbortError");
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    try {
      await expect(database.commitOperation({ operation: { ...operationBase(operationId), kind: "rename", nodeId, name: "Changed", modifiedAt: 20 } })).rejects.toThrow("Injected failure");
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    expect(await database.getNode(nodeId)).toEqual(before);
    expect(await database.getOperation(operationId)).toBeUndefined();
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revision);
    database.close();
  });

  test("requires valid restore destinations and supports an atomic root fallback after collisions clear", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_100);
    const parentId = stableId(370);
    const childId = stableId(371);
    const conflictId = stableId(372);
    const nestedConflictId = stableId(385);
    await database.commitOperation({ operation: createDraft(stableId(373), [folder(parentId, "Parent"), folder(childId, "Child", parentId)]) });
    await database.commitOperation({ operation: { ...operationBase(stableId(374)), kind: "trash", nodeIds: [childId], trashedAt: 1 } });
    await database.commitOperation({ operation: createDraft(stableId(386), [folder(nestedConflictId, "child", parentId)]) });
    await database.commitOperation({ operation: { ...operationBase(stableId(375)), kind: "trash", nodeIds: [parentId], trashedAt: 2 } });
    expect((await database.listTrash(WORKSPACE)).map(({ id }) => id)).toEqual([parentId, childId]);
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(376)), kind: "restore", nodeIds: [parentId, childId], destination: "original", modifiedAt: 3 } })).rejects.toThrow("sibling");
    await database.commitOperation({ operation: { ...operationBase(stableId(390)), kind: "restore", nodeIds: [parentId], destination: "original", modifiedAt: 4 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(391)), kind: "rename", nodeId: nestedConflictId, name: "Other", modifiedAt: 5 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(392)), kind: "trash", nodeIds: [parentId], trashedAt: 6 } });
    const coRestore = await database.commitOperation({ operation: { ...operationBase(stableId(393)), kind: "restore", nodeIds: [parentId, childId], destination: "original", modifiedAt: 7 } });
    expect(coRestore.inverse).toMatchObject({ kind: "restore", roots: [{ nodeId: parentId, parentId: null, modifiedAt: 4 }, { nodeId: childId, parentId: null, modifiedAt: 10 }] });
    expect(await database.getNode(parentId)).toMatchObject({ parentId: null, modifiedAt: 7, lifecycle: { kind: "active" } });
    expect(await database.getNode(childId)).toMatchObject({ parentId, modifiedAt: 7, lifecycle: { kind: "active" } });
    await database.commitOperation({ operation: { ...operationBase(stableId(377)), kind: "trash", nodeIds: [childId], trashedAt: 8 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(378)), kind: "trash", nodeIds: [parentId], trashedAt: 9 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(379)), kind: "purge", nodeIds: [parentId] } });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(380)), kind: "restore", nodeIds: [childId], destination: "original", modifiedAt: 10 } })).rejects.toThrow("original parent");

    await database.commitOperation({ operation: createDraft(stableId(381), [folder(conflictId, "child")]) });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(382)), kind: "restore", nodeIds: [childId], destination: "root", modifiedAt: 11 } })).rejects.toThrow("sibling");
    expect((await database.listTrash(WORKSPACE)).map(({ id }) => id)).toEqual([childId]);
    await database.commitOperation({ operation: { ...operationBase(stableId(383)), kind: "trash", nodeIds: [conflictId], trashedAt: 12 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(384)), kind: "restore", nodeIds: [childId], destination: "root", modifiedAt: 13 } });
    expect(await database.getNode(childId)).toMatchObject({ parentId: null, lifecycle: { kind: "active" } });
    expect((await database.listTrash(WORKSPACE)).map(({ id }) => id)).toEqual([conflictId]);
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

  test("rejects malformed stored nodes and inverse metadata instead of projecting them", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const malformedId = stableId(140);
    const operationId = stableId(141);
    const stored = await database.commitOperation({ operation: createDraft(operationId, [folder(stableId(142), "Valid")]) });
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    const transaction = raw.transaction(["nodes", "operations"], "readwrite");
    await Promise.all([
      idbRequest(transaction.objectStore("nodes").put({ id: malformedId, parentKey: "", lifecycleKey: "active" })),
      idbRequest(transaction.objectStore("operations").put({ ...stored, inverse: { ...stored.inverse, unexpected: true } })),
    ]);
    raw.close();
    await expect(database.getNode(malformedId)).rejects.toThrow("unsupported shape");
    await expect(database.getOperation(operationId)).rejects.toThrow("unsupported shape");
    database.close();
  });

  test("enumerates retained chunk hashes and rejects noncanonical stored manifests", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const first = await verifiedManifest(1, 1);
    const second = await verifiedManifest(2, 2);
    const firstNodeId = stableId(161);
    const operation = createDraft(stableId(160), [file(firstNodeId, "First.txt", first), file(stableId(162), "Second.txt", second)]);
    const committed = await database.commitOperation({ operation, manifests: [first, second] });
    expect(await database.listRetainedChunkHashes()).toEqual(["1".repeat(64), "2".repeat(64)]);

    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(raw.transaction("manifests", "readwrite").objectStore("manifests").put({ hash: first.hash, manifest: { ...first.manifest, chunks: [{ hash: "3".repeat(64), size: 1 }] } }));
    raw.close();
    expect(await database.commitOperation({ operation })).toEqual(committed);
    await expect(database.getManifest(first.hash)).rejects.toThrow("canonical bytes");
    await expect(database.listFileVersions(WORKSPACE, firstNodeId)).rejects.toThrow("canonical bytes");
    await expect(database.commitOperation({ operation: writeDraft(stableId(164), firstNodeId, first, 20), expectedContentTuple: (await database.getNode(firstNodeId))!.fieldTuples.content })).rejects.toThrow("canonical bytes");
    await expect(database.listRetainedChunkHashes()).rejects.toThrow("canonical bytes");
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

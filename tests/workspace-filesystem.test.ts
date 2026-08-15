import { describe, expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { getAccountOpfsRoot } from "../src/filesystem/chunks";
import { openFilesystemDatabase } from "../src/filesystem/database";
import { WEB2_CHUNK_SIZE, WEB2_OPFS_PREFIX, sha256Hex } from "../src/filesystem/model";
import { openWorkspaceFilesystem } from "../src/platform/storage/workspace-filesystem";
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
  depth = 0;
  private readonly tails = new Map<string, Promise<void>>();

  async request<T>(name: string, options: LockOptions, operation: () => Promise<T>) {
    this.calls.push({ name, mode: options.mode });
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(name, previous.then(() => turn));
    await previous;
    this.depth += 1;
    try {
      return await operation();
    } finally {
      this.depth -= 1;
      release();
    }
  }
}

describe("workspace filesystem storage", () => {
  test("persists the locked offline create, write, undo, redo, restore, and cleanup journey", async () => {
    const indexedDB = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = new TestLocks();
    let nextId = 10;
    let timestamp = 1_000;
    const randomUUID = () => {
      expect(locks.depth).toBe(1);
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
    const undoNewest = await filesystem.undoWrite(secondWrite.operationId);
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(middle));
    const undoMiddle = await filesystem.undoWrite(firstWrite.operationId);
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(oldest));
    const redoMiddle = await filesystem.redoWrite(undoMiddle.operationId);
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(middle));
    const redoNewest = await filesystem.redoWrite(undoNewest.operationId);
    expect(await blobHash((await filesystem.readFile(file.id)).content)).toBe(await blobHash(newest));
    expect(redoMiddle).toMatchObject({ intent: "redo", compensatesOperationId: undoMiddle.operationId });
    expect(redoNewest).toMatchObject({ intent: "redo", compensatesOperationId: undoNewest.operationId });

    const beforeReopen = { content: await blobHash((await filesystem.readFile(file.id)).content), operations: await filesystem.listOperations() };
    filesystem.close();
    const reopened = await openWorkspaceFilesystem(ACCOUNT, WORKSPACE, environment);
    const [reloadedFolder] = await reopened.listChildren(null);
    const [reloadedFile] = await reopened.listChildren(reloadedFolder!.id);
    expect(reloadedFolder).toMatchObject({ id: folder.id, kind: "folder", name: "Documents" });
    expect(reloadedFile).toMatchObject({ id: file.id, kind: "file", name: "Notes.txt" });
    expect(await reopened.getNode(reloadedFile!.id)).toEqual(reloadedFile);
    expect({ content: await blobHash((await reopened.readFile(reloadedFile!.id)).content), operations: await reopened.listOperations() }).toEqual(beforeReopen);
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
    const undoRestore = await reopened.undoWrite(restore.operationId);
    expect(await blobHash((await reopened.readFile(file.id)).content)).toBe(await blobHash(newest));

    const accountRoot = origin.directories.get(`${WEB2_OPFS_PREFIX}${ACCOUNT_HASH}`)!;
    const orphanHash = await sha256Hex(new TextEncoder().encode("rejected"));
    const sharedHash = await sha256Hex(shared);
    expect(memoryChunk(accountRoot, orphanHash)).toBeDefined();
    const raceContent = new Blob(["race"], { type: "text/plain" });
    const raceHash = await sha256Hex(await raceContent.arrayBuffer());
    const chunks = accountRoot.directories.get("chunks")!;
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

    expect(locks.calls).toHaveLength(13);
    expect(locks.calls).toEqual(Array.from({ length: 13 }, () => ({ name: `hiraya-web2-v1-${ACCOUNT_HASH}-storage`, mode: "exclusive" })));
    expect(await getAccountOpfsRoot(ACCOUNT, memoryOpfsHandle(origin))).toBe(memoryOpfsHandle(accountRoot));
    competing.close();
    reopened.close();
  });
});

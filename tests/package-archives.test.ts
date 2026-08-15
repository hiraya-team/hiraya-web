import { describe, expect, test } from "bun:test";
import { indexedDB } from "fake-indexeddb";
import { sha256Blob } from "../src/lib/blob-transfer";
import { readApprovedPackageArchive, releaseApprovedPackageArchive, saveApprovedPackageArchive } from "../src/platform/storage/blobs";
import { configureStorageNamespace } from "../src/platform/storage/namespace";
import { initializeDatabase } from "../src/platform/storage/database-client";
import { blockAccountAppOperation, discardAccountAppOperation, enqueueAccountAppOperation, readAccountApps, readAppStorage, reconcileAccountApps, retryAccountAppOperation } from "../src/platform/storage/repositories";

class MemoryDirectory {
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, Blob>();

  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions) {
    const existing = this.directories.get(name);
    if (existing) return existing as unknown as FileSystemDirectoryHandle;
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const directory = new MemoryDirectory();
    this.directories.set(name, directory);
    return directory as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
    if (!this.files.has(name) && !options?.create) throw new DOMException("Not found", "NotFoundError");
    if (!this.files.has(name)) this.files.set(name, new Blob());
    return {
      getFile: async () => new File([this.files.get(name)!], name, { type: this.files.get(name)!.type }),
      createWritable: async () => {
        let content = this.files.get(name)!;
        return {
          write: async (next: FileSystemWriteChunkType) => { content = next instanceof Blob ? next : new Blob([String(next)]); },
          close: async () => { this.files.set(name, content); },
        };
      },
    } as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.directories.delete(name)) throw new DOMException("Not found", "NotFoundError");
  }

}

describe("approved package archives", () => {
  test("saves and reads digest-addressed archives in the selected namespace", async () => {
    const root = new MemoryDirectory();
    const values = new Map<string, string>();
    Object.defineProperties(globalThis, {
      indexedDB: { configurable: true, value: indexedDB },
      navigator: { configurable: true, value: { storage: { getDirectory: async () => root }, locks: { request: (_name: string, callback: () => unknown) => callback() } } },
      localStorage: { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } },
      sessionStorage: { configurable: true, value: { getItem: () => null } },
    });
    await configureStorageNamespace("archive-test");

    const archive = new Blob(["package bytes"], { type: "application/vnd.hiraya.app" });
    const digest = await sha256Blob(archive);
    await saveApprovedPackageArchive(digest, archive);
    expect(await (await readApprovedPackageArchive(digest)).text()).toBe("package bytes");
  });

  test("atomically recovers account app operations", async () => {
    await initializeDatabase();

    const appId = "dev.hiraya.notes";
    const manifest = { schemaVersion: 2 as const, uiRuntime: 1 as const, id: appId, name: "Notes", version: "1.0.0", entrypoint: "index.html", permissions: ["storage" as const], fileTypes: [] };
    const ref = (kind: "installation" | "handlers" | "manifest", id: string, app = "") => ({ blobId: id, resourceId: id, revision: 1, size: 2, sha256: "a".repeat(64), path: kind === "manifest" ? `.hiraya/account/apps/${app}/manifest.json` : `.hiraya/account/${kind}.json`, name: `${kind}.json`, mimeType: "application/json" });
    const installed = { appId, manifest, generations: { installationGeneration: 2, dataGeneration: 3, itemRevision: 1 }, manifestResource: ref("manifest", "manifest", appId), package: { blobId: "package", revision: 1, size: 10, sha256: "b".repeat(64) } };
    await reconcileAccountApps({ appsRevision: 1, apps: [{ ...installed, data: [] }], handlerHints: {}, resources: { installation: ref("installation", "installation"), handlers: ref("handlers", "handlers") }, installation: { apps: [installed] } });

    const operation = { schemaVersion: 1 as const, kind: "put-data" as const, appId, key: "draft", dataGeneration: 3, value: { text: "local" } };
    const queued = await enqueueAccountAppOperation(operation, { kind: "put", appId, key: "draft", value: operation.value });
    expect(await readAppStorage(appId, "draft")).toEqual({ text: "local" });
    await blockAccountAppOperation(queued.record.operationId, "stale", "generation_conflict");
    expect((await readAccountApps()).outbox[0]?.status).toBe("blocked");
    expect((await retryAccountAppOperation(queued.record.operationId)).operation).toMatchObject({ dataGeneration: 3 });
    await blockAccountAppOperation(queued.record.operationId, "stale", "generation_conflict");
    const later = await enqueueAccountAppOperation({ ...operation, value: { text: "later" } }, { kind: "put", appId, key: "draft", value: { text: "later" } });
    await expect(discardAccountAppOperation(queued.record.operationId)).rejects.toThrow("must be restored");
    expect((await readAccountApps()).outbox[0]?.status).toBe("blocked");
    expect(await readAppStorage(appId, "draft")).toEqual({ text: "later" });
    await discardAccountAppOperation(queued.record.operationId, { kind: "replace", appId, values: [["draft", { text: "later" }]] });
    expect((await readAccountApps()).outbox).toHaveLength(1);
    expect(await readAppStorage(appId, "draft")).toEqual({ text: "later" });
    await blockAccountAppOperation(later.record.operationId, "stale", "generation_conflict");
    await discardAccountAppOperation(later.record.operationId, { kind: "delete", appId, key: "draft" });
    expect((await readAccountApps()).outbox).toEqual([]);
    expect(await readAppStorage(appId, "draft")).toBeUndefined();

    const clear = await enqueueAccountAppOperation({ schemaVersion: 1, kind: "clear-data", appId, dataGeneration: 3 }, { kind: "clear", appId });
    const afterClear = await enqueueAccountAppOperation({ ...operation, dataGeneration: 3 }, { kind: "put", appId, key: "draft", value: operation.value });
    expect(afterClear.record.operation).toMatchObject({ kind: "put-data", dataGeneration: 4 });
    const baseline = (await readAccountApps()).state.baseline!;
    const advanced = {
      ...baseline,
      apps: baseline.apps.map((app) => ({ ...app, generations: { ...app.generations, dataGeneration: 4 } })),
      installation: { apps: baseline.installation.apps.map((app) => ({ ...app, generations: { ...app.generations, dataGeneration: 4 } })) },
    };
    await reconcileAccountApps(advanced, clear.record.operationId);
    await reconcileAccountApps(advanced, afterClear.record.operationId);

    const oversized = { schemaVersion: 1 as const, kind: "put-data" as const, appId, key: "large", dataGeneration: 3, value: "x".repeat(70_000) };
    await expect(enqueueAccountAppOperation(oversized, { kind: "put", appId, key: "large", value: oversized.value })).rejects.toThrow("quota");
    expect((await readAccountApps()).outbox).toEqual([]);

    const archive = new Blob(["queued package"]);
    const digest = await sha256Blob(archive);
    let packageOperationId = "";
    await saveApprovedPackageArchive(digest, archive, async () => {
      packageOperationId = (await enqueueAccountAppOperation({ schemaVersion: 1, kind: "install", appId, manifest, digest, md5: "a".repeat(32), size: archive.size })).record.operationId;
    });
    await releaseApprovedPackageArchive(digest);
    expect(await (await readApprovedPackageArchive(digest)).text()).toBe("queued package");
    await reconcileAccountApps((await readAccountApps()).state.baseline!, packageOperationId);
    await releaseApprovedPackageArchive(digest);
    await expect(readApprovedPackageArchive(digest)).rejects.toHaveProperty("name", "NotFoundError");
  });
});

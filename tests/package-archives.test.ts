import { describe, expect, test } from "bun:test";
import { indexedDB } from "fake-indexeddb";
import { sha256Blob } from "../src/lib/blob-transfer";
import { deleteApprovedPackageArchive, readApprovedPackageArchive, releaseApprovedPackageArchive, saveApprovedPackageArchive } from "../src/platform/storage/blobs";
import { configureStorageNamespace, indexedDatabaseName } from "../src/platform/storage/namespace";
import { initializeDatabase } from "../src/platform/storage/database-client";
import { blockAccountAppOperation, discardAccountAppOperation, enqueueAccountAppOperation, installApp, listFileAssociations, listInstalledApps, readAccountApps, readAppStorage, reconcileAccountApps, retireMarkdownPreview, retryAccountAppOperation, setFileAssociation, writeAppStorage } from "../src/platform/storage/repositories";

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
  test("saves, reads, and explicitly deletes digest-addressed archives in the selected namespace", async () => {
    const root = new MemoryDirectory();
    const values = new Map<string, string>();
    Object.defineProperties(globalThis, {
      indexedDB: { configurable: true, value: indexedDB },
      navigator: { configurable: true, value: { storage: { getDirectory: async () => root }, locks: { request: (_name: string, callback: () => unknown) => callback() } } },
      localStorage: { configurable: true, value: { getItem: (key: string) => key.startsWith("hiraya-indexeddb-reset-") ? "complete" : values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } },
      sessionStorage: { configurable: true, value: { getItem: () => null } },
    });
    await configureStorageNamespace("archive-test");

    const archive = new Blob(["package bytes"], { type: "application/vnd.hiraya.app" });
    const digest = await sha256Blob(archive);
    await saveApprovedPackageArchive(digest, archive);
    expect(await (await readApprovedPackageArchive(digest)).text()).toBe("package bytes");
    await deleteApprovedPackageArchive(digest);
    await expect(readApprovedPackageArchive(digest)).rejects.toHaveProperty("name", "NotFoundError");
    await deleteApprovedPackageArchive(digest);
  });

  test("upgrades IndexedDB and atomically recovers account app operations", async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(indexedDatabaseName(), 1);
      open.onupgradeneeded = () => {
        const storage = open.result.createObjectStore("app-storage", { keyPath: ["appId", "key"] });
        storage.createIndex("appId", "appId");
        open.result.createObjectStore("installed-apps", { keyPath: "appId" });
        const associations = open.result.createObjectStore("file-associations", { keyPath: "matcher" });
        associations.createIndex("appId", "appId");
      };
      open.onsuccess = () => { open.result.close(); resolve(); };
      open.onerror = () => reject(open.error);
    });
    await initializeDatabase();

    const retiredArchive = new Blob(["retired package"]);
    const retiredDigest = await sha256Blob(retiredArchive);
    const systemManifest = (id: string, name: string) => ({ schemaVersion: 2 as const, uiRuntime: 1 as const, id, name, version: "1.0.0", entrypoint: "index.html", permissions: ["storage" as const, "files:read" as const], fileTypes: [".md"] });
    await saveApprovedPackageArchive(retiredDigest, retiredArchive);
    await installApp({ appId: "app.hiraya.media-viewer", source: "system", packageEntryId: null, archivePath: "system-apps/media-viewer.hiraya.app", digest: "b".repeat(64), version: "1.0.0", manifest: systemManifest("app.hiraya.media-viewer", "Media Viewer"), approvedAt: 2 });
    await installApp({ appId: "app.hiraya.markdown-preview", source: "system", packageEntryId: null, archivePath: "system-apps/markdown-preview.hiraya.app", digest: retiredDigest, version: "1.0.0", manifest: systemManifest("app.hiraya.markdown-preview", "Markdown Preview"), approvedAt: 1 });
    await writeAppStorage("app.hiraya.markdown-preview", "draft", { value: true }, 1024, 10);
    await setFileAssociation({ matcher: ".md", appId: "app.hiraya.markdown-preview", createdAt: 42 });
    expect(await retireMarkdownPreview()).toBe(retiredDigest);
    expect(await retireMarkdownPreview()).toBeNull();
    expect((await listInstalledApps()).map((app) => app.appId)).not.toContain("app.hiraya.markdown-preview");
    expect(await readAppStorage("app.hiraya.markdown-preview", "draft")).toBeUndefined();
    expect(await listFileAssociations()).toContainEqual({ matcher: ".md", appId: "app.hiraya.media-viewer", createdAt: 42 });
    await releaseApprovedPackageArchive(retiredDigest);
    await expect(readApprovedPackageArchive(retiredDigest)).rejects.toHaveProperty("name", "NotFoundError");
    await expect(installApp({ appId: "app.hiraya.markdown-preview", source: "desktop", packageEntryId: "package", archivePath: null, digest: "c".repeat(64), version: "1.0.0", manifest: systemManifest("app.hiraya.markdown-preview", "Markdown Preview"), approvedAt: 3 })).rejects.toThrow("reserved");

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

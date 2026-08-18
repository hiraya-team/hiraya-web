import { describe, expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openFilesystemDatabase } from "../src/filesystem/database";
import { sha256Hex } from "../src/filesystem/model";
import { openApprovedPackageArchives } from "../src/platform/storage/approved-package-archives";
import { MemoryDirectory, memoryOpfsHandle } from "./support/memory-opfs";

const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-000000000002";
const ACCOUNT_HASH = "11e594f481958c10e3015d0bf0447a22f068a8a647f475df15ce2c7ab4b8f3f1";
const manifest = { schemaVersion: 2 as const, uiRuntime: 1 as const, id: "dev.hiraya.notes", name: "Notes", version: "1.0.0", entrypoint: "index.html", permissions: ["storage" as const], fileTypes: [] };
const blobRef = (id: string, sha256: string, size: number) => ({ blobId: id, revision: 1, size, sha256 });
const resource = (kind: "installation" | "handlers" | "manifest", id: string, appId = "") => ({ ...blobRef(id, "a".repeat(64), 2), resourceId: id, path: kind === "manifest" ? `.hiraya/account/apps/${appId}/manifest.json` : `.hiraya/account/${kind}.json`, name: `${kind}.json`, mimeType: "application/json" as const });

function accountSnapshot(digest?: string, size = 1) {
  const app = digest ? { appId: manifest.id, manifest, generations: { installationGeneration: 1, dataGeneration: 0, itemRevision: 1 }, manifestResource: resource("manifest", "manifest", manifest.id), package: blobRef("package", digest, size) } : undefined;
  return { appsRevision: 1, apps: app ? [{ ...app, data: [] }] : [], handlerHints: {}, resources: { installation: resource("installation", "installation"), handlers: resource("handlers", "handlers") }, installation: { apps: app ? [app] : [] } };
}

async function archive(value: string) {
  const blob = new Blob([value], { type: "application/vnd.hiraya.app" });
  return { blob, digest: await sha256Hex(await blob.arrayBuffer()) };
}

describe("fresh approved package archives", () => {
  test("uses the fresh account root and verifies digest-addressed bytes", async () => {
    const factory = new IDBFactory();
    const origin = new MemoryDirectory();
    const old = origin.directory(".hiraya-storage-deadbeef").directory(".hiraya-approved-package-archives");
    old.file("sentinel", new Blob(["untouched"]));
    const lockNames: string[] = [];
    const locks = { request: async (name: string, callback: () => Promise<unknown>) => { lockNames.push(name); return callback(); } } as unknown as Pick<LockManager, "request">;
    const archives = await openApprovedPackageArchives(ACCOUNT, { storageId: ACCOUNT, indexedDB: factory, IDBKeyRange, originRoot: memoryOpfsHandle(origin), locks });
    const saved = await archive("package bytes");
    let retainedBytes = "";
    await archives.save(saved.digest, saved.blob, async () => { retainedBytes = await (await archives.read(saved.digest)).text(); });
    expect(retainedBytes).toBe("package bytes");
    expect(await (await archives.read(saved.digest)).text()).toBe("package bytes");
    await expect(archives.save(saved.digest, new Blob(["changed"]))).rejects.toThrow("digest");
    expect(await (await archives.read(saved.digest)).text()).toBe("package bytes");
    expect(origin.directories.get(".hiraya-storage-deadbeef")?.directories.get(".hiraya-approved-package-archives")).toBe(old);
    expect(origin.directories.get(`.hiraya-web2-${ACCOUNT_HASH}`)?.directories.has("approved-package-archives")).toBe(true);
    expect(new Set(lockNames)).toEqual(new Set([`hiraya-web2-v1-${ACCOUNT_HASH}-package-archives`]));

    const corrupted = await archive("corrupt on close");
    const directory = origin.directories.get(`.hiraya-web2-${ACCOUNT_HASH}`)!.directories.get("approved-package-archives")!;
    directory.file(corrupted.digest).corruptNextClose = true;
    let published = false;
    await expect(archives.save(corrupted.digest, corrupted.blob, async () => { published = true; })).rejects.toThrow("digest");
    expect(published).toBe(false);
    archives.close();
  });

  test("retains installed and queued packages and releases true orphans", async () => {
    const factory = new IDBFactory();
    const origin = new MemoryDirectory();
    const environment = { storageId: ACCOUNT, indexedDB: factory, IDBKeyRange, originRoot: memoryOpfsHandle(origin), randomUUID: () => CLIENT };
    const database = await openFilesystemDatabase(ACCOUNT, environment);
    const archives = await openApprovedPackageArchives(ACCOUNT, environment);
    const local = await archive("local package");
    await archives.save(local.digest, local.blob);
    await database.installApp({ appId: manifest.id, source: "desktop", packageEntryId: "package", archivePath: null, digest: local.digest, version: manifest.version, manifest, approvedAt: 1 });
    await archives.release(local.digest);
    expect(await (await archives.read(local.digest)).text()).toBe("local package");
    await database.uninstallApp(manifest.id);
    await archives.release(local.digest);
    await expect(archives.read(local.digest)).rejects.toHaveProperty("name", "NotFoundError");

    const baseline = await archive("baseline package");
    await archives.save(baseline.digest, baseline.blob);
    await database.reconcileAccountApps(accountSnapshot(baseline.digest, baseline.blob.size));
    await archives.release(baseline.digest);
    expect(await (await archives.read(baseline.digest)).text()).toBe("baseline package");
    await database.reconcileAccountApps(accountSnapshot());
    await archives.release(baseline.digest);
    await expect(archives.read(baseline.digest)).rejects.toHaveProperty("name", "NotFoundError");

    const queued = await archive("queued package");
    let operationId = "";
    await archives.save(queued.digest, queued.blob, async () => {
      operationId = (await database.enqueueAccountAppOperation({ schemaVersion: 1, kind: "install", appId: manifest.id, manifest, digest: queued.digest, md5: "a".repeat(32), size: queued.blob.size })).record.operationId;
    });
    await archives.release(queued.digest);
    expect(await (await archives.read(queued.digest)).text()).toBe("queued package");
    await database.blockAccountAppOperation(operationId, "rejected", "invalid");
    await database.discardAccountAppOperation(operationId);
    await archives.release(queued.digest);
    await expect(archives.read(queued.digest)).rejects.toHaveProperty("name", "NotFoundError");

    const orphan = await archive("orphaned after metadata failure");
    await expect(archives.save(orphan.digest, orphan.blob, async () => { throw new Error("Injected metadata failure"); })).rejects.toThrow("Injected metadata failure");
    expect(await (await archives.read(orphan.digest)).text()).toBe("orphaned after metadata failure");
    await archives.release(orphan.digest);
    await expect(archives.read(orphan.digest)).rejects.toHaveProperty("name", "NotFoundError");
    archives.close();
    database.close();
  });

  test("serializes overlapping writes across archive facades", async () => {
    const factory = new IDBFactory();
    const origin = new MemoryDirectory();
    const locks = { request: (_name: string, callback: () => Promise<unknown>) => callback() } as unknown as Pick<LockManager, "request">;
    const environment = { storageId: ACCOUNT, indexedDB: factory, IDBKeyRange, originRoot: memoryOpfsHandle(origin), locks };
    const firstFacade = await openApprovedPackageArchives(ACCOUNT, environment);
    const secondFacade = await openApprovedPackageArchives(ACCOUNT, environment);
    const first = await archive("first");
    const second = await archive("second");
    const directory = origin.directories.get(`.hiraya-web2-${ACCOUNT_HASH}`)!.directories.get("approved-package-archives")!;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    directory.beforeFileClose = async (name) => {
      if (name !== first.digest) return;
      entered();
      await releasePromise;
    };
    const firstWrite = firstFacade.save(first.digest, first.blob);
    await enteredPromise;
    let secondFinished = false;
    const secondWrite = secondFacade.save(second.digest, second.blob).then(() => { secondFinished = true; });
    await Promise.resolve();
    expect(secondFinished).toBe(false);
    expect(directory.files.has(second.digest)).toBe(false);
    release();
    await Promise.all([firstWrite, secondWrite]);
    expect(secondFinished).toBe(true);
    firstFacade.close();
    secondFacade.close();
  });
});

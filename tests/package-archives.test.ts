import { describe, expect, test } from "bun:test";
import { sha256Blob } from "../src/lib/blob-transfer";
import { deleteApprovedPackageArchive, readApprovedPackageArchive, saveApprovedPackageArchive } from "../src/platform/storage/blobs";
import { configureStorageNamespace } from "../src/platform/storage/namespace";

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
      navigator: { configurable: true, value: { storage: { getDirectory: async () => root } } },
      localStorage: { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } },
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
});

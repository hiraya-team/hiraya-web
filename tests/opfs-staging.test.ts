import { describe, expect, test } from "bun:test";
import { contentMatchesCacheMarker, parseContentCacheMarker, rollbackSafeReplacement, stageOperationContentsInDirectory } from "../src/platform/storage/blobs";

describe("pending content staging", () => {
  test("detects same-size remote cache corruption from the persisted descriptor digest", async () => {
    const marker = { catalogId: "catalog", contentRevision: 4, size: 4, sha256: "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589" };
    expect(await contentMatchesCacheMarker(new Blob(["abcd"]), marker)).toBe(true);
    expect(await contentMatchesCacheMarker(new Blob(["abce"]), marker)).toBe(false);
  });

  test("treats pre-digest cache markers as migration misses", () => {
    expect(parseContentCacheMarker({ catalogId: "catalog", contentRevision: 4, size: 4 })).toBeNull();
  });

  test("restores previous bytes when local metadata commit fails", async () => {
    let content = "old";
    let cleaned = false;
    await expect(rollbackSafeReplacement(
      async () => { content = "new"; },
      async () => { throw new Error("metadata failure"); },
      async () => { content = "old"; },
      async () => { cleaned = true; },
    )).rejects.toThrow("metadata failure");
    expect(content).toBe("old");
    expect(cleaned).toBe(false);
  });

  test("publishes a completion manifest only after every staged file", async () => {
    const writes: string[] = [];
    const operationDirectory = {} as FileSystemDirectoryHandle;
    const pending = { getDirectoryHandle: async () => operationDirectory } as unknown as FileSystemDirectoryHandle;
    await stageOperationContentsInDirectory(pending, "operation-1", new Map([["first", new Blob(["a"])], ["second", new Blob(["bb"])]]), async (_directory, name) => { writes.push(name); });
    expect(writes).toEqual(["first", "second", ".complete"]);
  });

  test("removes the whole operation directory after a partial write failure", async () => {
    const removed: Array<{ name: string; recursive?: boolean }> = [];
    const operationDirectory = {} as FileSystemDirectoryHandle;
    const pending = {
      getDirectoryHandle: async () => operationDirectory,
      removeEntry: async (name: string, options?: FileSystemRemoveOptions) => { removed.push({ name, recursive: options?.recursive }); },
    } as unknown as FileSystemDirectoryHandle;
    let writes = 0;
    const contents = new Map([["first", new Blob(["a"])], ["second", new Blob(["b"])]]);

    await expect(stageOperationContentsInDirectory(pending, "operation-1", contents, async () => {
      writes += 1;
      if (writes === 2) throw new Error("disk full");
    })).rejects.toThrow("disk full");
    expect(writes).toBe(2);
    expect(removed).toEqual([{ name: "operation-1", recursive: true }]);
  });
});

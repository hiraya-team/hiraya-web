import { describe, expect, test } from "bun:test";
import { contentMatchesCacheMarker, operationContentIds, operationMaterializationContentIds, parseContentCacheMarker, removeUnretainedCachedContent, rollbackSafeReplacement, saveApprovedPackageArchive, stageOperationContentsInDirectory, stageStagedContentVariantInDirectory } from "../src/platform/storage/blobs";
import { BUILTIN_THEMES } from "../src/lib/themes";
import { DEFAULT_WALLPAPER } from "../src/types";

describe("pending content staging", () => {
  test("rejects approved package archives that do not match their content address", async () => {
    await expect(saveApprovedPackageArchive("not-a-digest", new Blob(["package"]))).rejects.toThrow("digest is invalid");
    await expect(saveApprovedPackageArchive("a".repeat(64), new Blob(["package"]))).rejects.toThrow("does not match");
  });

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

  test("stages merged Mine under an immutable key before the outbox selects it", async () => {
    const writes: string[] = [];
    const directory = {} as FileSystemDirectoryHandle;
    const key = ".mine-00000000-0000-4000-8000-000000000000";
    expect(await stageStagedContentVariantInDirectory(directory, new Blob(["merged"]), key, async (_directory, name) => { writes.push(name); })).toBe(key);
    expect(writes).toEqual([key]);
  });

  test("stages the hidden asset owned by a theme-package install", () => {
    const operation = {
      schemaVersion: 1 as const,
      kind: "install-theme-package" as const,
      theme: { id: "aurora", name: "Aurora", definition: BUILTIN_THEMES["hiraya-dusk"].definition, wallpaper: { assetId: "theme-asset", kind: "scene" as const, size: 4, sha256: "0".repeat(64), revision: 0 } },
      assetId: "theme-asset",
      wallpaperKind: "scene" as const,
      size: 4,
      layout: { snapToGrid: false, wallpaper: { ...DEFAULT_WALLPAPER, source: "theme:aurora" as const } },
    };
    expect(operationContentIds(operation)).toEqual(["theme-asset"]);
    expect(operationMaterializationContentIds(operation)).toEqual([]);
    expect(operationContentIds({ ...operation, theme: { id: "aurora", name: "Aurora", definition: operation.theme.definition }, wallpaperKind: null })).toEqual([]);
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

  test("removes cached bytes and markers no desktop retains", async () => {
    const removed: string[] = [];
    const cache = {
      async *entries() { yield ["keep", {}]; yield ["drop", {}]; },
      removeEntry: async (id: string) => { removed.push(`marker:${id}`); },
    } as unknown as FileSystemDirectoryHandle;
    const files = { removeEntry: async (id: string) => { removed.push(`content:${id}`); } } as unknown as FileSystemDirectoryHandle;

    await removeUnretainedCachedContent(new Set(["keep"]), cache, files);
    expect(removed).toEqual(["content:drop", "marker:drop"]);
  });
});

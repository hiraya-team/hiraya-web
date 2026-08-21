import { describe, expect, test } from "bun:test";
import { HirayaSdkError, type DirectoryEntry, type FileHandle, type FolderHandle, type HirayaClient } from "@hiraya-team/apps-sdk";
import { HirayaFileSystem } from "./vfs";

/** Provides the root test fixture. */
const root = "folder_root0000000000" as FolderHandle;
/** Provides the first folder test fixture. */
const folderA = "folder_aaaaaaaaaaaaaaaa" as FolderHandle;
/** Provides the second folder test fixture. */
const folderB = "folder_bbbbbbbbbbbbbbbb" as FolderHandle;
/** Provides the file test fixture. */
const file = "file_aaaaaaaaaaaaaaaa" as FileHandle;

/** Creates a folder test fixture. */
function folder(handle: FolderHandle, name: string, parent: FolderHandle | null): DirectoryEntry {
  return { kind: "folder", metadata: { handle, name, parent, modifiedAt: 0 } };
}

/** Builds the source file test fixture. */
function sourceFile(parent: FolderHandle = root): DirectoryEntry {
  return { kind: "file", metadata: { handle: file, name: "source.txt", parent, modifiedAt: 0, size: 4, mimeType: "text/plain", contentRevision: 1 } };
}

describe("HirayaFileSystem", () => {
  test("rejects copying a folder into its own subtree before creating anything", async () => {
    let creates = 0;
    const client = { files: {
      list: async (handle: FolderHandle) => handle === root ? [folder(folderA, "a", root)] : [],
      createFolder: async () => { creates += 1; throw new Error("unexpected create"); },
    } } as unknown as HirayaClient;
    await expect(new HirayaFileSystem(client, root).copy("/a", "/a/copy", true)).rejects.toThrow("cannot copy a folder into itself");
    expect(creates).toBe(0);
  });

  test("deletes a destination when opening its staged write fails", async () => {
    const deleted: Array<FileHandle | FolderHandle> = [];
    const client = { files: {
      list: async (handle: FolderHandle) => handle === root ? [sourceFile()] : [],
      createFile: async () => sourceFile().metadata,
      beginWrite: async () => { throw new HirayaSdkError("full", "QUOTA_EXCEEDED"); },
      delete: async (handle: FileHandle | FolderHandle) => { deleted.push(handle); },
    } } as unknown as HirayaClient;
    await expect(new HirayaFileSystem(client, root).copy("/source.txt", "/copy.txt", false)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(deleted).toEqual([file]);
  });

  test("rolls a cross-folder move back when its rename fails", async () => {
    const moves: Array<{ handle: FileHandle | FolderHandle; parent: FolderHandle | null }> = [];
    const client = { files: {
      list: async (handle: FolderHandle) => handle === root ? [folder(folderA, "a", root), folder(folderB, "b", root)] : handle === folderA ? [sourceFile(folderA)] : [],
      move: async (handle: FileHandle | FolderHandle, parent: FolderHandle | null) => { moves.push({ handle, parent }); },
      rename: async () => { throw new HirayaSdkError("conflict", "CONFLICT"); },
    } } as unknown as HirayaClient;
    await expect(new HirayaFileSystem(client, root).move("/a/source.txt", "/b/renamed.txt")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(moves).toEqual([{ handle: file, parent: folderB }, { handle: file, parent: folderA }]);
  });
});

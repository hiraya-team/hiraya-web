import { describe, expect, test } from "bun:test";
import type { DirectoryEntry, FileHandle, FolderHandle } from "@hiraya-team/apps-sdk";
import { editorFileKind, filterWorkspaceEntries, isEditableFile, isWithinFolder, sortWorkspaceEntries } from "./workspace";

const folder = (name: string, handle = name as FolderHandle, parent: FolderHandle | null = null): DirectoryEntry => ({ kind: "folder", metadata: { handle, name, modifiedAt: 0, parent } });
const file = (name: string, mimeType = "application/octet-stream", handle = name as FileHandle, parent: FolderHandle | null = null): DirectoryEntry => ({ kind: "file", metadata: { handle, name, mimeType, size: 0, modifiedAt: 0, parent, contentRevision: 1 } });

describe("Integrated Editor workspace", () => {
  test("sorts folders first and names naturally", () => {
    expect(sortWorkspaceEntries([file("file10.txt"), folder("src"), file("file2.txt"), folder("Assets")]).map((entry) => entry.metadata.name)).toEqual(["Assets", "src", "file2.txt", "file10.txt"]);
  });

  test("filters names case-insensitively", () => {
    expect(filterWorkspaceEntries([folder("Source"), file("README.md"), file("notes.txt")], "read").map((entry) => entry.metadata.name)).toEqual(["README.md"]);
  });

  test("recognizes editable text without treating binary files as source", () => {
    expect(isEditableFile((file("README", "text/plain") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe(true);
    expect(isEditableFile((file("script.ts") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe(true);
    expect(isEditableFile((file("photo.png", "image/png") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe(false);
  });

  test("selects native previews and a safe fallback for non-text files", () => {
    expect(editorFileKind((file("photo.PNG") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe("image");
    expect(editorFileKind((file("report.bin", "application/pdf") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe("pdf");
    expect(editorFileKind((file("song.mp3") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe("audio");
    expect(editorFileKind((file("clip.webm") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe("video");
    expect(editorFileKind((file("ambient.hiraya.scene") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe("scene");
    expect(editorFileKind((file("archive.zip", "application/zip") as Extract<DirectoryEntry, { kind: "file" }>).metadata)).toBe("metadata");
  });

  test("finds descendants without looping through malformed ancestry", () => {
    const root = "root" as FolderHandle;
    const nested = "nested" as FolderHandle;
    const parents = new Map<string, FolderHandle | null>([[nested, root], ["file", nested], ["cycle", "cycle" as FolderHandle]]);
    expect(isWithinFolder("file", root, parents)).toBe(true);
    expect(isWithinFolder("cycle", root, parents)).toBe(false);
  });
});

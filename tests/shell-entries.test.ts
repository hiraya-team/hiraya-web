import { describe, expect, test } from "bun:test";
import { canMutateShellDrop, canonicalSelectionIds, downloadedThumbnailEntry, isProtectedShellEntry, isVirtualThumbnailEntry, protectedShellSource, protectedWindowDisposition, shellEntries, virtualThumbnailSource, VIRTUAL_HIRAYA_ROOT_ID } from "../src/ui/shell-entries";
import type { SystemEntry, TrashItem } from "../src/lib/contracts";
import { isValidId, systemEntryPath } from "../src/lib/contracts";
import type { DesktopEntry } from "../src/types";

const entries: DesktopEntry[] = [
  { kind: "folder", id: "hidden", name: ".hiraya", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 1, y: 1 } },
  { kind: "file", id: "image-id", name: "photo.jpg", parentId: null, createdAt: 1, modifiedAt: 2, position: { x: 2, y: 2 }, mimeType: "image/jpeg", size: 10 },
  { kind: "file", id: "dot", name: ".env", parentId: null, createdAt: 1, modifiedAt: 2, position: { x: 3, y: 3 }, mimeType: "text/plain", size: 1 },
  { kind: "file", id: "hidden-child", name: "visible-name.txt", parentId: "hidden", createdAt: 1, modifiedAt: 2, position: { x: 4, y: 4 }, mimeType: "text/plain", size: 1 },
  { kind: "file", id: "svg", name: "vector.svg", parentId: null, createdAt: 1, modifiedAt: 2, position: { x: 5, y: 5 }, mimeType: "image/svg+xml", size: 10 },
  { kind: "file", id: "video", name: "clip.mp4", parentId: null, createdAt: 1, modifiedAt: 2, position: { x: 6, y: 6 }, mimeType: "VIDEO/MP4", size: 10 },
];

describe("desktop shell entries", () => {
  test("hides dot entries by default and derives protected thumbnails only when enabled", () => {
    expect(shellEntries(entries, { "image-id": 4, svg: 4, video: 5 }, false, true).map((entry) => entry.name)).toEqual(["photo.jpg", "vector.svg", "clip.mp4"]);
    const shown = shellEntries(entries, { "image-id": 4, svg: 4, video: 5 }, true, true);
    expect(shown.find((entry) => entry.id === VIRTUAL_HIRAYA_ROOT_ID)?.name).toBe(".hiraya (System)");
    const file = shown.find((entry) => entry.kind === "file" && entry.name === "thumbnail-v1.webp")!;
    expect(virtualThumbnailSource(file)).toEqual({ entryId: "image-id", contentRevision: 4 });
    expect(shown.filter((entry) => entry.kind === "file" && entry.name === "thumbnail-v1.webp")).toHaveLength(2);
    expect(entries).toHaveLength(6);
    expect(entries[0].name).toBe(".hiraya");
  });

  test("uses case-insensitive system collision names and noncanonical read-only IDs", () => {
    const collision = entries.map((entry) => entry.id === "hidden" ? { ...entry, name: ".HIRAYA" } : entry);
    const shown = shellEntries(collision, { "image-id": 4 }, true, true);
    const root = shown.find((entry) => entry.id === VIRTUAL_HIRAYA_ROOT_ID)!;
    const file = shown.find((entry) => entry.kind === "file" && entry.name === "thumbnail-v1.webp")!;
    expect(root.name).toBe(".hiraya (System)");
    expect(isVirtualThumbnailEntry(root)).toBeTrue();
    expect(isVirtualThumbnailEntry(file)).toBeTrue();
    expect(isValidId(root.id)).toBeFalse();
    expect(isValidId(file.id)).toBeFalse();
  });

  test("projects downloaded size and type into transient file metadata", () => {
    const file = shellEntries(entries, { "image-id": 4 }, true, true).find((entry) => entry.kind === "file" && entry.name === "thumbnail-v1.webp")!;
    expect(downloadedThumbnailEntry(file as Extract<DesktopEntry, { kind: "file" }>, new Blob(["ready"], { type: "image/webp" }))).toMatchObject({ size: 5, mimeType: "image/webp" });
  });

  test("does not advertise oversized sources or non-positive revisions", () => {
    const candidates: DesktopEntry[] = [
      { kind: "file", id: "large", name: "large.jpg", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "image/jpeg", size: 100 * 1024 * 1024 + 1 },
      { kind: "file", id: "zero", name: "zero.jpg", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "image/jpeg", size: 1 },
      { kind: "file", id: "valid", name: "valid.jpg", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "image/jpeg; quality=90", size: 100 * 1024 * 1024 },
    ];
    const shown = shellEntries(candidates, { large: 1, zero: 0, valid: 1 }, true, true);
    expect(shown.filter((entry) => entry.kind === "file" && entry.name === "thumbnail-v1.webp")).toHaveLength(1);
    expect(virtualThumbnailSource(shown.find((entry) => entry.kind === "file" && entry.name === "thumbnail-v1.webp")!)).toEqual({ entryId: "valid", contentRevision: 1 });
  });

  test("rejects virtual drag endpoints and canonicalizes mutation selections", () => {
    const virtualFile = "virtual:thumbnail/file/image-id/4";
    expect(canMutateShellDrop(virtualFile, null)).toBeFalse();
    expect(canMutateShellDrop("image-id", VIRTUAL_HIRAYA_ROOT_ID)).toBeFalse();
    expect(canMutateShellDrop("image-id", null)).toBeTrue();
    expect(canonicalSelectionIds(entries, [virtualFile, "image-id"])).toEqual(["image-id"]);
    expect(canonicalSelectionIds(entries, [virtualFile])).toEqual([]);
  });

  test("projects system metadata and complete Trash subtrees with collision-safe names", () => {
    const system: SystemEntry[] = [
      { kind: "file", id: "layout", name: "layout.json", systemRole: "layout", path: systemEntryPath("layout"), mimeType: "application/json", size: 2, revision: 2, contentRevision: 2, sha256: "a".repeat(64) },
      { kind: "file", id: "editor", name: "editor-settings.json", systemRole: "editor-settings", path: systemEntryPath("editor-settings"), mimeType: "application/json", size: 2, revision: 2, contentRevision: 2, sha256: "b".repeat(64) },
    ];
    const trashedFolder = { kind: "folder" as const, id: "trash-root", name: "Plans", parentId: null, createdAt: 1, modifiedAt: 4, position: { x: 0, y: 0 }, revision: 4, contentRevision: 0 };
    const trashedFile = { kind: "file" as const, id: "trash-file", name: "plan.json", parentId: "trash-root", createdAt: 1, modifiedAt: 4, position: { x: 0, y: 0 }, mimeType: "application/json", size: 2, revision: 4, contentRevision: 4 };
    const trash: TrashItem[] = [
      { entry: trashedFolder, entries: [trashedFile, trashedFolder], deletedAt: 5, descendantCount: 1 },
      { entry: { ...trashedFolder, id: "trash-root-2" }, entries: [{ ...trashedFolder, id: "trash-root-2" }], deletedAt: 4, descendantCount: 0 },
    ];
    const shown = shellEntries(entries, {}, true, false, system, trash);
    const byName = (name: string) => shown.find((entry) => entry.name === name)!;
    expect(byName("layout.json").parentId).toBe(byName("settings").id);
    expect(byName("layout.json").modifiedAt).toBe(0);
    expect(byName("editor.json").parentId).toBe(byName("settings").id);
    expect(byName("Plans").parentId).toBe(byName("trash").id);
    expect(byName("Plans (2)").parentId).toBe(byName("trash").id);
    expect(byName("plan.json").parentId).toBe(byName("Plans").id);
    expect(protectedShellSource(byName("layout.json"))).toEqual({ kind: "system", entryId: "layout" });
    expect(protectedShellSource(byName("plan.json"))).toEqual({ kind: "trash", rootId: "trash-root", entryId: "trash-file" });
    expect(isProtectedShellEntry(byName("plan.json"))).toBeTrue();
    expect(canMutateShellDrop(byName("plan.json"), null)).toBeFalse();
  });

  test("keeps the protected root available while its contents are loading", () => {
    expect(shellEntries([], {}, true, false, [], [], true).map((entry) => entry.name)).toEqual([".hiraya"]);
  });

  test("reloads changed protected windows and closes removed resources", () => {
    expect(protectedWindowDisposition(2, 2)).toBe("keep");
    expect(protectedWindowDisposition(2, 3)).toBe("reload");
    expect(protectedWindowDisposition(2, null)).toBe("close");
  });
});

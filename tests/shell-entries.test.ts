import { describe, expect, test } from "bun:test";
import { canMutateShellDrop, canonicalSelectionIds, downloadedThumbnailEntry, isVirtualThumbnailEntry, shellEntries, virtualThumbnailSource, VIRTUAL_HIRAYA_ROOT_ID } from "../src/ui/shell-entries";
import { isValidId } from "../src/lib/contracts";
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
});

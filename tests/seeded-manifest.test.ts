import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { exportSeededDesktop } from "../src/lib/seeded";
import { parsePortableSeededManifest, toPortableSeededManifest } from "../src/lib/seeded-manifest";
import { desktopStateSnapshot } from "./fixtures";
import { DEFAULT_WALLPAPER } from "../src/types";
import { HIRAYA_SCENE_MIME_TYPE } from "../src/domain/scene";

describe("seeded packages", () => {
  test("accepts only schema version 1 with complete entries", () => {
    const snapshot = desktopStateSnapshot();
    snapshot.entries = [{ kind: "file", id: "file", name: "read me.txt", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 3 }];
    const value = toPortableSeededManifest(snapshot, () => "content/read%20me.txt");
    expect(value.schemaVersion).toBe(1);
    expect(parsePortableSeededManifest(value)).toEqual(value);
    expect(() => parsePortableSeededManifest({ ...value, schemaVersion: 7 })).toThrow("unsupported format");
    const incomplete = value.entries.map((entry) => { const copy = { ...entry } as Partial<typeof entry>; delete copy.createdAt; return copy; });
    expect(() => parsePortableSeededManifest({ ...value, entries: incomplete })).toThrow("creation date");
  });

  test("preserves current layout, appearance, empty folders, and normalized content URLs", () => {
    const snapshot = desktopStateSnapshot();
    snapshot.layout = { snapToGrid: true, wallpaper: { ...DEFAULT_WALLPAPER, source: "ember" } };
    snapshot.entries = [
      { kind: "folder", id: "empty", name: "Empty", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: -40, y: 20 } },
      { kind: "file", id: "file", name: "notes.txt", parentId: null, createdAt: 2, modifiedAt: 2, position: { x: 60, y: 20 }, mimeType: "text/plain", size: 0 },
    ];
    snapshot.layout.widgets = [{ id: "calendar", kind: "calendar", x: 10, y: 20, width: 240, height: 180 }];
    snapshot.layout.iconGroups = [{ folderId: "empty", width: 300, height: 220 }];
    const value = toPortableSeededManifest(snapshot, () => "content/notes.txt");
    expect(parsePortableSeededManifest(value)).toMatchObject({ schemaVersion: 1, layout: snapshot.layout, appearance: snapshot.appearance, entries: snapshot.entries });
    expect(() => parsePortableSeededManifest({ ...value, entries: value.entries.map((entry) => entry.kind === "file" ? { ...entry, contentUrl: "../notes.txt" } : entry) })).toThrow("normalized relative");
  });

  test("imports legacy preset strings and exports structured wallpaper", () => {
    const snapshot = desktopStateSnapshot();
    const value = toPortableSeededManifest(snapshot, () => "content/unused");
    const legacy = parsePortableSeededManifest({ ...value, layout: { snapToGrid: false, wallpaper: "grove" } });
    expect(legacy.layout.wallpaper).toEqual({ ...DEFAULT_WALLPAPER, source: "grove" });
    expect(toPortableSeededManifest({ ...snapshot, layout: legacy.layout }, () => "content/unused").layout.wallpaper.source).toBe("grove");
  });

  test("strictly validates seeded Scene widget references", () => {
    const snapshot = desktopStateSnapshot();
    snapshot.entries = [{ kind: "file", id: "scene", name: "demo.hiraya.scene", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: HIRAYA_SCENE_MIME_TYPE, size: 12 }];
    snapshot.layout.widgets = [{ id: "scene-widget", kind: "scene", fileId: "scene", x: 10, y: 10, width: 420, height: 300 }];
    const value = toPortableSeededManifest(snapshot, () => "content/demo.hiraya.scene");
    expect(parsePortableSeededManifest(value).layout.widgets[0]).toMatchObject({ kind: "scene", fileId: "scene" });
    expect(() => parsePortableSeededManifest({ ...value, entries: value.entries.map((entry) => entry.kind === "file" ? { ...entry, mimeType: "application/zip" } : entry) })).toThrow("Scene widget must reference");
  });

  test("exports a portable ZIP with exact bytes, hierarchy, and empty folders", async () => {
    const snapshot = desktopStateSnapshot();
    snapshot.entries = [
      { kind: "folder", id: "folder", name: "Project", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
      { kind: "folder", id: "empty", name: "Empty", parentId: "folder", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
      { kind: "file", id: "file", name: "read me.txt", parentId: "folder", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 5 },
    ];
    const archive = await exportSeededDesktop(snapshot, async (id) => {
      expect(id).toBe("file");
      return new Blob(["hello"], { type: "text/plain" });
    });
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(archive.type).toBe("application/zip");
    expect(strFromU8(files["hiraya-seeded/content/Project/read%20me.txt"]!)).toBe("hello");
    expect(files["hiraya-seeded/content/Project/Empty/"]).toBeDefined();
    const manifest = parsePortableSeededManifest(JSON.parse(strFromU8(files["hiraya-seeded/manifest.json"]!)));
    expect(manifest.entries).toEqual([
      snapshot.entries[0],
      snapshot.entries[1],
      { ...snapshot.entries[2], contentUrl: "content/Project/read%20me.txt" },
    ]);
  });
});

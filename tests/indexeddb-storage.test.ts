import { describe, expect, test } from "bun:test";
import { assertUniqueDesktopEntryIds } from "../src/platform/storage/database-client";
import { desktopStateSnapshot } from "./fixtures";

function state(entries: ReturnType<typeof desktopStateSnapshot>["entries"]) {
  const snapshot = desktopStateSnapshot();
  return { entries, autoArrangeIcons: snapshot.layout.autoArrangeIcons, snapToGrid: snapshot.layout.snapToGrid, gridSize: snapshot.layout.gridSize, wallpaper: snapshot.layout.wallpaper, editorSettings: snapshot.editorSettings, appearance: snapshot.appearance, sync: snapshot.sync };
}

const file = { kind: "file" as const, id: "shared-id", name: "notes.txt", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 0 };

describe("IndexedDB desktop aggregates", () => {
  test("permits an existing entry ID retained by its desktop", () => {
    expect(() => assertUniqueDesktopEntryIds([{ id: "source", state: state([file]) }])).not.toThrow();
  });

  test("rejects an entry ID owned by another desktop", () => {
    expect(() => assertUniqueDesktopEntryIds([{ id: "source", state: state([file]) }, { id: "destination", state: state([file]) }])).toThrow("duplicate entry IDs");
  });

  test("validates both final aggregate states for an atomic transfer", () => {
    expect(() => assertUniqueDesktopEntryIds([{ id: "source", state: state([]) }, { id: "destination", state: state([file]) }])).not.toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import { indexedDB } from "fake-indexeddb";
import { assertUniqueDesktopEntryIds, DATABASE_VERSION, resetDatabaseSchema } from "../src/platform/storage/database-client";
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

test("resets an incompatible version 2 database into the current schema", async () => {
  const name = `indexeddb-reset-${crypto.randomUUID()}`;
  const legacy = indexedDB.open(name, 2);
  legacy.onupgradeneeded = () => legacy.result.createObjectStore("quarantined-apps").put("legacy", "retired");
  const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
    legacy.onsuccess = () => resolve(legacy.result);
    legacy.onerror = () => reject(legacy.error);
  });
  oldDatabase.close();

  const current = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(name, DATABASE_VERSION);
    open.onupgradeneeded = () => resetDatabaseSchema(open.result);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  expect(current.version).toBe(DATABASE_VERSION);
  expect([...current.objectStoreNames]).toEqual(["account-app-client-state", "account-app-outbox", "account-apps", "activity", "app-storage", "client-state", "desktops", "file-associations", "installed-apps", "outbox", "preferences", "sessions"]);
  current.close();
});

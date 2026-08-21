import { describe, expect, test } from "bun:test";
import { buildOfflineAvailability, dedupeOfflineRoots, offlineFilesUnderRoots, offlineStatusLabel, outboxProtectedFileIds, type OfflineStorageInventory } from "../src/lib/offline-availability";
import type { OutboxRecord } from "../src/lib/outbox";
import type { DesktopEntry } from "../src/types";

/** Provides the entries test fixture. */
const entries: DesktopEntry[] = [
  { kind: "folder", id: "root", name: "Root", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { kind: "file", id: "a", name: "a.txt", parentId: "root", mimeType: "text/plain", size: 10, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { kind: "folder", id: "nested", name: "Nested", parentId: "root", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { kind: "file", id: "b", name: "b.txt", parentId: "nested", mimeType: "text/plain", size: 20, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { kind: "folder", id: "empty", name: "Empty", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
];

/** Creates an inventory test fixture. */
function inventory(overrides: Partial<OfflineStorageInventory> = {}): OfflineStorageInventory {
  return { desktopId: "desktop", authoritativeLocal: false, files: {}, cachedBytes: 0, protectedBytes: 0, releasableBytes: 0, browserStorage: null, ...overrides };
}

describe("offline availability model", () => {
  test("deduplicates overlapping roots and expands folders recursively", () => {
    expect(dedupeOfflineRoots(entries, ["root", "a", "nested"])).toEqual(["root"]);
    expect(offlineFilesUnderRoots(entries, ["root", "nested"]).map((file) => file.id)).toEqual(["a", "b"]);
  });

  test("distinguishes fully, partially, and online-only content", () => {
    const model = buildOfflineAvailability(entries, inventory({
      files: { a: { cached: true, cachedBytes: 10, storedBytes: 10, pending: false, protected: false }, b: { cached: false, cachedBytes: 0, storedBytes: 0, pending: false, protected: false } },
      cachedBytes: 10,
    }));
    expect(model.entries.a.status).toBe("available");
    expect(model.entries.b.status).toBe("online-only");
    expect(model.entries.root.status).toBe("partial");
    expect(model.entries.root.availableFileCount).toBe(1);
    expect(model.entries.root.downloadBytes).toBe(20);
  });

  test("counts pending protected bytes as available without describing server synchronization", () => {
    const model = buildOfflineAvailability(entries, inventory({ files: {
      a: { cached: true, cachedBytes: 10, storedBytes: 10, pending: false, protected: false },
      b: { cached: true, cachedBytes: 20, storedBytes: 20, pending: true, protected: true },
    } }));
    expect(model.entries.nested.status).toBe("available");
    expect(model.entries.root.status).toBe("available");
    expect(model.entries.b.pending).toBe(true);
    expect(model.entries.b.status).toBe("available");
    expect(model.entries.b.downloadBytes).toBe(0);
  });

  test("reports browser-authoritative entries as stored in this browser", () => {
    const model = buildOfflineAvailability(entries, inventory({ authoritativeLocal: true }));
    expect(model.entries.a.status).toBe("local");
    expect(model.entries.root.status).toBe("local");
    expect(offlineStatusLabel(model.entries.a)).toBe("Stored in this browser");
  });

  test("reports blocked protected content as Available locally", () => {
    const model = buildOfflineAvailability(entries, inventory({ files: {
      a: { cached: true, cachedBytes: 0, storedBytes: 10, pending: false, protected: true },
    } }));
    expect(model.entries.a.status).toBe("available");
  });

  test("does not report missing protected bytes as available offline", () => {
    const model = buildOfflineAvailability(entries, inventory({ files: {
      a: { cached: false, cachedBytes: 0, storedBytes: 0, pending: true, protected: true },
    } }));
    expect(model.entries.a.status).toBe("online-only");
    expect(model.entries.a.downloadBytes).toBe(10);
  });

  test("uses updating only for active offline downloads", () => {
    const model = buildOfflineAvailability(entries, inventory(), { updatingIds: new Set(["b"]) });
    expect(model.entries.b.status).toBe("updating");
    expect(model.entries.nested.status).toBe("updating");
    expect(model.entries.root.status).toBe("updating");
  });

  test("reports empty folders independently of storage authority", () => {
    const remote = buildOfflineAvailability(entries, inventory());
    const local = buildOfflineAvailability(entries, inventory({ authoritativeLocal: true }));
    expect(remote.entries.empty.status).toBe("empty");
    expect(local.entries.empty.status).toBe("empty");
    expect(offlineStatusLabel(remote.entries.empty)).toBe("Empty folder");
  });

  test("protects transferred files and folder descendants across desktops", () => {
    const transfer: OutboxRecord = { operationId: "transfer", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "source", operation: { schemaVersion: 1, kind: "entry-transfer", entryIds: ["root"], destinationDesktopId: "destination", parentId: null }, status: "pending", error: null };
    expect([...outboxProtectedFileIds([transfer], [{ entries }])].sort()).toEqual(["a", "b"]);
  });
});

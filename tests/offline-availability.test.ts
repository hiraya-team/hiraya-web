import { describe, expect, test } from "bun:test";
import { buildOfflineAvailability, dedupeOfflineRoots, offlineFilesUnderRoots, outboxProtectedFileIds, outboxSyncingEntryIds, type OfflineStorageInventory } from "../src/lib/offline-availability";
import type { OutboxRecord } from "../src/lib/outbox";
import type { DesktopEntry } from "../src/types";

const entries: DesktopEntry[] = [
  { kind: "folder", id: "root", name: "Root", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { kind: "file", id: "a", name: "a.txt", parentId: "root", mimeType: "text/plain", size: 10, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { kind: "folder", id: "nested", name: "Nested", parentId: "root", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
  { kind: "file", id: "b", name: "b.txt", parentId: "nested", mimeType: "text/plain", size: 20, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } },
];

function inventory(overrides: Partial<OfflineStorageInventory> = {}): OfflineStorageInventory {
  return { desktopId: "desktop", authoritativeLocal: false, files: {}, cachedBytes: 0, protectedBytes: 0, releasableBytes: 0, browserStorage: null, ...overrides };
}

describe("offline availability model", () => {
  test("deduplicates overlapping roots and expands folders recursively", () => {
    expect(dedupeOfflineRoots(entries, ["root", "a", "nested"])).toEqual(["root"]);
    expect(offlineFilesUnderRoots(entries, ["root", "nested"]).map((file) => file.id)).toEqual(["a", "b"]);
  });

  test("reports partial remote folders as Virtual", () => {
    const model = buildOfflineAvailability(entries, inventory({
      files: { a: { cached: true, cachedBytes: 10, storedBytes: 10, pending: false, protected: false }, b: { cached: false, cachedBytes: 0, storedBytes: 0, pending: false, protected: false } },
      cachedBytes: 10,
    }));
    expect(model.entries.a.status).toBe("synced");
    expect(model.entries.b.status).toBe("virtual");
    expect(model.entries.root.status).toBe("virtual");
    expect(model.entries.root.downloadBytes).toBe(20);
  });

  test("reports pending entry work as Syncing and keeps its bytes protected", () => {
    const model = buildOfflineAvailability(entries, inventory({ files: {
      a: { cached: true, cachedBytes: 10, storedBytes: 10, pending: false, protected: false },
      b: { cached: true, cachedBytes: 20, storedBytes: 20, pending: true, protected: true },
    } }));
    expect(model.entries.nested.status).toBe("syncing");
    expect(model.entries.root.status).toBe("syncing");
    expect(model.entries.b.pending).toBe(true);
    expect(model.entries.b.downloadBytes).toBe(0);
  });

  test("reports browser-authoritative entries as Available locally", () => {
    const model = buildOfflineAvailability(entries, inventory({ authoritativeLocal: true }));
    expect(model.entries.a.status).toBe("local");
    expect(model.entries.root.status).toBe("local");
  });

  test("reports blocked protected content as Available locally", () => {
    const model = buildOfflineAvailability(entries, inventory({ files: {
      a: { cached: false, cachedBytes: 0, storedBytes: 10, pending: false, protected: true },
    } }));
    expect(model.entries.a.status).toBe("local");
  });

  test("derives syncing from pending metadata mutations without turning blocked failures into an icon state", () => {
    const pending: OutboxRecord = { operationId: "rename", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desktop", operation: { schemaVersion: 1, kind: "patch-entry", entryId: "nested", changes: { name: "Renamed" } }, status: "pending", error: null };
    const blocked = { ...pending, operationId: "blocked", status: "blocked", error: "conflict" } satisfies OutboxRecord;
    expect([...outboxSyncingEntryIds([pending])]).toEqual(["nested"]);
    expect(outboxSyncingEntryIds([blocked]).size).toBe(0);
    const model = buildOfflineAvailability(entries, inventory(), { pendingIds: outboxSyncingEntryIds([pending]) });
    expect(model.entries.nested.status).toBe("syncing");
    expect(model.entries.root.status).toBe("syncing");
  });

  test("protects transferred files and folder descendants across desktops", () => {
    const transfer: OutboxRecord = { operationId: "transfer", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "source", operation: { schemaVersion: 1, kind: "entry-transfer", entryIds: ["root"], destinationDesktopId: "destination", parentId: null }, status: "pending", error: null };
    expect([...outboxProtectedFileIds([transfer], [{ entries }])].sort()).toEqual(["a", "b"]);
  });
});

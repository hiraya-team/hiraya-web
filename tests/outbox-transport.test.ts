import { describe, expect, test } from "bun:test";
import { sendOutboxOperation } from "../src/platform/sync/outbox-transport";
import type { OutboxOperation, OutboxRecord } from "../src/lib/outbox";
import { remoteDesktopIdentity, remoteDesktopState } from "./fixtures";

describe("legacy schema-8 outbox replay", () => {
  test("omits absent revision preconditions across representative operations", async () => {
    const remote = remoteDesktopState();
    const desktop = remoteDesktopIdentity("desk", "Renamed");
    const operations: OutboxOperation[] = [
      { schemaVersion: 1, kind: "rename-desktop", desktop },
      { schemaVersion: 1, kind: "delete-desktop", desktopId: "other" },
      { schemaVersion: 1, kind: "patch-entry", entryId: "file-1", changes: { name: "local.txt" } },
      { schemaVersion: 1, kind: "delete", entryId: "file-1" },
      { schemaVersion: 1, kind: "move-entries", entryIds: ["file-1"], parentId: null },
      { schemaVersion: 1, kind: "save-content", entryId: "file-1", mimeType: "text/plain", size: 4, modifiedAt: 2, stagedContentKey: ".mine-00000000-0000-4000-8000-000000000000" },
      { schemaVersion: 1, kind: "root-entry-positions", positions: [{ entryId: "file-1", position: { x: 1, y: 2 } }] },
      { schemaVersion: 1, kind: "layout", layout: remote.layout },
      { schemaVersion: 1, kind: "editor-settings", settings: remote.editorSettings },
      { schemaVersion: 1, kind: "select-theme", themeId: remote.appearance.selectedThemeId },
    ];
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const pendingReads: Array<string | undefined> = [];
    for (const [index, operation] of operations.entries()) {
      const record: OutboxRecord = { operationId: String(index + 1), sequence: index + 1, clientId: "client", catalogId: "catalog-1", desktopId: "desk", operation, status: "pending", error: null, attemptCount: 0, lastAttemptAt: null };
      await sendOutboxOperation(record, {
        fetch: (async () => new Response(null, { status: 204 })) as typeof fetch,
        requireAuthentication: (response) => response,
        readPendingContent: async (_operationId, _entryId, stagedContentKey) => { pendingReads.push(stagedContentKey); return new Blob(["note"]); },
        requestJson: async (input, init) => {
          requests.push({ url: String(input), init });
          return String(input).endsWith("/blob-mutations") ? { state: "committed", catalogRevision: 2 } : {};
        },
      });
    }
    expect(pendingReads).toEqual([".mine-00000000-0000-4000-8000-000000000000"]);

    for (const { init } of requests) {
      expect(new Headers(init?.headers).has("X-Hiraya-Base-Revision")).toBe(false);
      if (typeof init?.body === "string") {
        const body = JSON.parse(init.body);
        expect(body.baseRevision).toBeUndefined();
        expect(body.baseContentRevision).toBeUndefined();
        expect(body.baseRevisions).toBeUndefined();
        if (Array.isArray(body.items)) expect(body.items.every((item: Record<string, unknown>) => item.baseContentRevision === undefined)).toBe(true);
      }
    }
  });
});

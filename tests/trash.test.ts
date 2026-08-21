import { describe, expect, test } from "bun:test";
import { parseContentAccessDescriptor, parseTrashDeleteResult, parseTrashDocument, parseTrashRestoreResult } from "../src/lib/contracts";
import { API_ROUTES } from "../src/lib/api-routes";
import { SyncEngine, TrashUnavailableError, type SyncEngineOptions } from "../src/lib/sync";
import { sha256Blob } from "../src/lib/blob-transfer";
import { desktopStateSnapshot, remoteDesktopState } from "./fixtures";

/** Provides a fake event source test double. */
class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Registers a listener on the test event source. */
  addEventListener() {}
  /** Closes the test event source. */
  close() {}
}

/** Provides the folder test fixture. */
const folder = {
  kind: "folder" as const,
  id: "folder-1",
  name: "Plans",
  parentId: "old-parent",
  createdAt: 1,
  modifiedAt: 2,
  position: { x: 4, y: 8 },
  revision: 3,
  contentRevision: 0,
};

/** Provides the file test fixture. */
const file = {
  kind: "file" as const,
  id: "file-1",
  name: "plan.txt",
  parentId: "folder-1",
  createdAt: 1,
  modifiedAt: 2,
  position: { x: 0, y: 0 },
  mimeType: "text/plain",
  size: 4,
  revision: 3,
  contentRevision: 3,
};

describe("Trash contracts", () => {
  test("validates schema version 2, ordering, entries, and counts", () => {
    const document = { schemaVersion: 2, catalogId: "catalog", catalogRevision: 4, desktopId: "desk", items: [
      { entry: folder, entries: [folder, file], deletedAt: 20, descendantCount: 1 },
      { entry: { ...file, id: "file-2", parentId: null }, entries: [{ ...file, id: "file-2", parentId: null }], deletedAt: 10, descendantCount: 0 },
    ] };
    expect(parseTrashDocument(document, "desk")).toEqual(document);
    expect(parseTrashDocument({ ...document, items: [{ ...document.items[0], entries: [file, folder] }, document.items[1]] }, "desk").items[0].entries.map((entry) => entry.id)).toEqual([file.id, folder.id]);
    expect(() => parseTrashDocument({ ...document, schemaVersion: 1 })).toThrow("schema version");
    expect(() => parseTrashDocument({ ...document, desktopId: "other" }, "desk")).toThrow("different desktop");
    expect(() => parseTrashDocument(document, "desk", "other-catalog")).toThrow("different catalog");
    expect(() => parseTrashDocument({ ...document, items: [...document.items].reverse() })).toThrow("newest-first");
    expect(() => parseTrashDocument({ ...document, items: [{ ...document.items[0], descendantCount: -1 }] })).toThrow("descendant count");
    expect(() => parseTrashDocument({ ...document, items: [{ ...document.items[0], entry: { ...folder, revision: 5 }, entries: [{ ...folder, revision: 5 }, file] }] })).toThrow("newer than its catalog");
    expect(() => parseTrashDocument({ ...document, items: [{ ...document.items[0], entry: { ...folder, revision: 2 } }] })).toThrow("does not match");
    expect(() => parseTrashDocument({ ...document, items: [{ ...document.items[0], entries: [folder] }] })).toThrow("descendant count");
    expect(() => parseTrashDocument({ ...document, items: [{ ...document.items[0], entries: [folder, { ...file, parentId: "missing" }] }] })).toThrow("missing parent");
    expect(() => parseTrashDocument({ ...document, items: [{ ...document.items[0], entry: { ...folder, parentId: file.id }, entries: [{ ...folder, parentId: file.id }, file] }] })).toThrow("outside its subtree");
  });

  test("validates restore subtrees with an external original parent and delete receipts", () => {
    const restored = [{ ...folder, revision: 5 }, { ...file, revision: 5 }];
    expect(parseTrashRestoreResult({ catalogRevision: 5, entries: restored }, folder.id)).toEqual({ catalogRevision: 5, entries: restored });
    expect(() => parseTrashRestoreResult({ catalogRevision: 5, entries: [file] }, folder.id)).toThrow("root entry");
    expect(() => parseTrashRestoreResult({ catalogRevision: 5, entries: restored }, folder.id, "root")).toThrow("restore its root");
    expect(() => parseTrashRestoreResult({ catalogRevision: 5, entries: [{ ...folder, parentId: null, revision: 4 }, { ...file, revision: 5 }] }, folder.id, "root")).toThrow("entry revisions");
    expect(parseTrashDeleteResult({ catalogRevision: 6, deletedIds: [folder.id, file.id] })).toEqual({ catalogRevision: 6, deletedIds: [folder.id, file.id] });
    expect(() => parseTrashDeleteResult({ catalogRevision: 6, deletedIds: [folder.id, folder.id] })).toThrow("duplicate");
  });

  test("builds the encoded Trash listing route", () => {
    expect(API_ROUTES.desktopTrash("desk one")).toBe("/api/desktops/desk%20one/trash");
  });
});

describe("Trash API wrappers", () => {
  test("rejects a Trash listing from a different catalog authority", async () => {
    const engine = new SyncEngine({ expectedCatalogId: "expected", fetch: (async () => Response.json({ schemaVersion: 2, catalogId: "other", catalogRevision: 4, desktopId: "desk", items: [] })) as typeof fetch });
    await expect(engine.listTrash("desk")).rejects.toThrow("different catalog");
  });

  test("reads actual Trash file content through its root-qualified descriptor", async () => {
    const content = new Blob(["plan"], { type: "text/plain" });
    const sha256 = await sha256Blob(content);
    const requests: string[] = [];
    const engine = new SyncEngine({ directBlobOrigin: "https://blob.test", fetch: (async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === API_ROUTES.desktopTrashContent("desk", file.id, file.contentRevision, folder.id)) return Response.json({ desktopId: "desk", trashRootId: folder.id, entryId: file.id, contentRevision: file.contentRevision, size: file.size, sha256, access: { url: "https://blob.test/trash-file", method: "GET", headers: {}, expiresAt: Date.now() + 60_000 } });
      if (url === "https://blob.test/trash-file") return new Response(content);
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch, expectedCatalogId: "catalog" });
    expect(await (await engine.readTrashFile("desk", "catalog", folder.id, { ...file, sha256 })).text()).toBe("plan");
    expect(requests).toEqual([API_ROUTES.desktopTrashContent("desk", file.id, file.contentRevision, folder.id), "https://blob.test/trash-file"]);
    const descriptor = { desktopId: "desk", trashRootId: folder.id, entryId: file.id, contentRevision: file.contentRevision, size: file.size, sha256, access: { url: "https://blob.test/trash-file", method: "GET", headers: {}, expiresAt: Date.now() + 60_000 } };
    expect(() => parseContentAccessDescriptor({ ...descriptor, desktopId: "other" }, file.id, file.contentRevision, file.size, "https://blob.test", { desktopId: "desk", trashRootId: folder.id, sha256 })).toThrow("different desktop");
    expect(() => parseContentAccessDescriptor({ ...descriptor, trashRootId: "other" }, file.id, file.contentRevision, file.size, "https://blob.test", { desktopId: "desk", trashRootId: folder.id, sha256 })).toThrow("different Trash root");
    expect(() => parseContentAccessDescriptor({ ...descriptor, sha256: "0".repeat(64) }, file.id, file.contentRevision, file.size, "https://blob.test", { desktopId: "desk", trashRootId: folder.id, sha256 })).toThrow("SHA-256");
  });

  test("reports frontend-only Trash as unavailable without fetching", async () => {
    let fetched = false;
    const engine = new SyncEngine({ frontendOnly: true, fetch: (async () => { fetched = true; throw new Error("unexpected"); }) as typeof fetch });
    await expect(engine.listTrash("desk")).rejects.toBeInstanceOf(TrashUnavailableError);
    await expect(engine.restoreTrash("desk", folder.id, "root", folder.revision)).rejects.toBeInstanceOf(TrashUnavailableError);
    await expect(engine.permanentlyDeleteTrash("desk", folder.id, folder.revision)).rejects.toBeInstanceOf(TrashUnavailableError);
    expect(fetched).toBe(false);
  });

  test("uses backend methods, bodies, credentials, and idempotency headers", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const engine = new SyncEngine({ fetch: (async (input, init) => {
      requests.push({ url: String(input), init });
       if (String(input).endsWith("/entries/transactions")) return Response.json({ state: "committed", catalogRevision: init?.body?.toString().includes("entry.restore") ? 5 : 6 });
       return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 4, desktopId: "desk", items: [{ entry: folder, entries: [folder, file], deletedAt: 20, descendantCount: 1 }] });
    }) as typeof fetch });

    await engine.listTrash("desk");
    await expect(engine.restoreTrash("desk", folder.id, "root", folder.revision)).resolves.toEqual({ catalogRevision: 5, entries: [] });
    await engine.permanentlyDeleteTrash("desk", folder.id, folder.revision);

    expect(requests.map(({ url, init }) => [url, init?.method ?? "GET"])).toEqual([
      ["/api/desktops/desk/trash", "GET"],
      ["/api/desktops/desk/entries/transactions", "POST"],
      ["/api/desktops/desk/entries/transactions", "POST"],
    ]);
    expect(requests.every(({ init }) => init?.credentials === "same-origin" && init.cache === "no-store")).toBe(true);
    expect(requests[1].init?.body).toBe(JSON.stringify({ operations: [{ type: "entry.restore", entryId: folder.id, baseRevision: folder.revision, parentId: null }] }));
    expect(requests[2].init?.body).toBe(JSON.stringify({ operations: [{ type: "entry.purge", entryId: folder.id, baseRevision: folder.revision }] }));
    const restoreHeaders = new Headers(requests[1].init?.headers);
    const deleteHeaders = new Headers(requests[2].init?.headers);
    expect(restoreHeaders.get("X-Hiraya-Client-ID")).toBeTruthy();
    expect(restoreHeaders.get("X-Hiraya-Client-ID")).toBe(deleteHeaders.get("X-Hiraya-Client-ID"));
    expect(restoreHeaders.get("X-Hiraya-Operation-ID")).not.toBe(deleteHeaders.get("X-Hiraya-Operation-ID"));
  });

  test("does not advance the observed revision or swallow restore reconciliation failures", async () => {
    let current = desktopStateSnapshot();
    let applications = 0;
    const storage = {
      loadDesktop: async () => current,
      readDesktopState: async () => current,
      applyRemoteDesktop: async (next: typeof current) => {
        applications += 1;
        if (applications > 1) throw new Error("projection failed");
        current = next;
        return current;
      },
      bindOutboxCatalog: async () => undefined,
      readOutbox: async () => [],
    } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/entries/transactions") && init?.method === "POST") return Response.json({ state: "committed", catalogRevision: 2 });
      if (String(input) === "/api/desktops/desk?projection=web") return Response.json({ ...remoteDesktopState(), catalogRevision: applications === 0 ? 1 : 2 });
      throw new Error(`Unexpected request: ${String(input)}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ storage, fetch: fetchImpl, eventSource: FakeEventSource as unknown as typeof EventSource });
    await engine.start("desk", { x: 0, y: 0 });

    const revisionBeforeRestore = Reflect.get(engine, "catalogRevision");
    await expect(engine.restoreTrash("desk", folder.id, "root", folder.revision)).rejects.toThrow("projection failed");
    expect(Reflect.get(engine, "catalogRevision")).toBe(revisionBeforeRestore);
    await engine.stop();
  });
});

import { describe, expect, test } from "bun:test";
import { API_ROUTES } from "../src/lib/api-routes";
import { parseContentAccessDescriptor, parseSystemEntriesDocument, parseSystemEntryDocument, systemEntryPath, type SystemEntry } from "../src/lib/contracts";
import { sha256Blob } from "../src/lib/blob-transfer";
import { SyncEngine, type SyncEngineOptions } from "../src/lib/sync";
import { desktopStateSnapshot } from "./fixtures";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "../src/lib/themes";

/** Provides the base entry test fixture. */
const baseEntry: SystemEntry = {
  kind: "file",
  id: "desk:system:layout",
  name: "layout.json",
  systemRole: "layout",
  path: systemEntryPath("layout"),
  mimeType: "application/json",
  size: 2,
  revision: 3,
  contentRevision: 3,
  sha256: "a".repeat(64),
};

/** Provides the required entries test fixture. */
const requiredEntries: SystemEntry[] = [
  baseEntry,
  { ...baseEntry, id: "desk:system:editor-settings", name: "editor-settings.json", systemRole: "editor-settings", path: systemEntryPath("editor-settings") },
  { ...baseEntry, id: "desk:system:theme-selection", name: "theme-selection.json", systemRole: "theme-selection", path: systemEntryPath("theme-selection") },
];

describe("protected system contracts", () => {
  test("validates identities, roles, keys, paths, revisions, and routes", () => {
    const document = { schemaVersion: 2, catalogId: "catalog", catalogRevision: 3, desktopId: "desk", entries: requiredEntries };
    expect(parseSystemEntriesDocument(document, "desk")).toEqual(document);
    expect(parseSystemEntryDocument({ ...document, entry: baseEntry, entries: undefined }, "desk", baseEntry.id)).toEqual(baseEntry);
    expect(() => parseSystemEntriesDocument({ ...document, desktopId: "other" }, "desk")).toThrow("different desktop");
    expect(() => parseSystemEntriesDocument(document, "desk", "other-catalog")).toThrow("different catalog");
    expect(() => parseSystemEntriesDocument({ ...document, entries: requiredEntries.map((entry) => entry.id === baseEntry.id ? { ...entry, systemRole: "unknown" } : entry) }, "desk")).toThrow("role");
    expect(() => parseSystemEntriesDocument({ ...document, entries: requiredEntries.map((entry) => entry.id === baseEntry.id ? { ...entry, mimeType: "text/plain" } : entry) }, "desk")).toThrow("MIME type");
    expect(() => parseSystemEntriesDocument({ ...document, entries: requiredEntries.map((entry) => entry.id === baseEntry.id ? { ...entry, size: 0 } : entry) }, "desk")).toThrow("empty");
    expect(() => parseSystemEntriesDocument({ ...document, entries: requiredEntries.map((entry) => entry.id === baseEntry.id ? { ...entry, path: ".hiraya/desktop/layout.json" } : entry) }, "desk")).toThrow("metadata path");
    expect(() => parseSystemEntriesDocument({ ...document, entries: [...requiredEntries, { ...baseEntry, id: "duplicate-layout" }] }, "desk")).toThrow("duplicate role keys");
    expect(() => parseSystemEntriesDocument({ ...document, entries: requiredEntries.filter((entry) => entry.systemRole !== "editor-settings") }, "desk")).toThrow("exactly one editor-settings");
    const definition = { ...baseEntry, id: "theme-definition", name: "custom.theme.json", systemRole: "theme-definition" as const, systemKey: "custom", path: systemEntryPath("theme-definition", "custom") };
    const themePackage = { ...baseEntry, id: "theme-package", name: "custom.hiraya.app", systemRole: "theme-package" as const, systemKey: "custom", path: systemEntryPath("theme-package", "custom"), mimeType: "application/vnd.hiraya.theme+zip" };
    expect(parseSystemEntriesDocument({ ...document, entries: [...requiredEntries, definition, themePackage] }, "desk").entries).toHaveLength(5);
    expect(() => parseSystemEntriesDocument({ ...document, entries: [...requiredEntries, themePackage] }, "desk")).toThrow("missing its theme definition");
    expect(() => parseSystemEntriesDocument({ ...document, entries: [...requiredEntries, definition, { ...definition, id: "duplicate-definition" }] }, "desk")).toThrow("duplicate role keys");
    expect(() => parseSystemEntriesDocument({ ...document, entries: requiredEntries.map((entry) => entry.id === baseEntry.id ? { ...entry, revision: 4, contentRevision: 4 } : entry) }, "desk")).toThrow("newer than its catalog");
    expect(() => parseContentAccessDescriptor({ desktopId: "other", entryId: baseEntry.id, contentRevision: 3, size: 2, sha256: baseEntry.sha256, access: { url: "https://blob.test/file", method: "GET", headers: {}, expiresAt: 1 } }, baseEntry.id, 3, 2, "https://blob.test", { desktopId: "desk" })).toThrow("different desktop");
    expect(() => parseContentAccessDescriptor({ schemaVersion: 2, catalogId: "other", desktopId: "desk", entryId: baseEntry.id, contentRevision: 3, size: 2, sha256: baseEntry.sha256, access: { url: "https://blob.test/file", method: "GET", headers: {}, expiresAt: 1 } }, baseEntry.id, 3, 2, "https://blob.test", { catalogId: "catalog", desktopId: "desk" })).toThrow("different catalog");
    expect(API_ROUTES.desktopSystemEntries("desk one")).toBe("/api/desktops/desk%20one/system/entries");
    expect(API_ROUTES.desktopSystemEntry("desk one", "entry/one")).toBe("/api/desktops/desk%20one/system/entries/entry%2Fone");
    expect(API_ROUTES.desktopTrashContent("desk one", "entry/one", 3, "root/one")).toBe("/api/desktops/desk%20one/entries/entry%2Fone/content?revision=3&trashRootId=root%2Fone");
  });

  test("lists, refreshes, and integrity-checks physical server resources", async () => {
    const body = new Blob(["{}"], { type: "application/json" });
    const entry = { ...baseEntry, sha256: await sha256Blob(body) };
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === API_ROUTES.desktopSystemEntries("desk")) return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 3, desktopId: "desk", entries: [entry, ...requiredEntries.slice(1)] });
      if (url === API_ROUTES.desktopSystemEntry("desk", entry.id)) return Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 3, desktopId: "desk", entry });
      if (url === API_ROUTES.desktopContent("desk", entry.id, entry.contentRevision)) return Response.json({ desktopId: "desk", entryId: entry.id, systemRole: "layout", systemKey: "", contentRevision: 3, size: 2, sha256: entry.sha256, access: { url: "https://blob.test/layout", method: "GET", headers: {}, expiresAt: Date.now() + 60_000 } });
      if (url === "https://blob.test/layout") return new Response(body);
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const engine = new SyncEngine({ fetch: fetchImpl, directBlobOrigin: "https://blob.test", expectedCatalogId: "catalog" });
    expect((await engine.listSystemEntries("desk")).entries[0]).toEqual(entry);
    expect(await (await engine.readSystemFile("desk", "catalog", entry)).text()).toBe("{}");
    expect(requests).toEqual([
      API_ROUTES.desktopSystemEntries("desk"),
      API_ROUTES.desktopSystemEntry("desk", entry.id),
      API_ROUTES.desktopContent("desk", entry.id, entry.contentRevision),
      "https://blob.test/layout",
    ]);
  });

  test("rejects a system resource that changed after its listing", async () => {
    const changed = { ...baseEntry, revision: 4, contentRevision: 4, sha256: "b".repeat(64) };
    const engine = new SyncEngine({ expectedCatalogId: "catalog", fetch: (async () => Response.json({ schemaVersion: 2, catalogId: "catalog", catalogRevision: 4, desktopId: "desk", entry: changed })) as typeof fetch });
    await expect(engine.readSystemFile("desk", "catalog", baseEntry)).rejects.toThrow("changed while it was loading");
  });

  test("projects canonical frontend-only JSON from the existing local aggregate", async () => {
    const snapshot = desktopStateSnapshot();
    const customTheme = { id: "custom", name: "Custom", definition: BUILTIN_THEMES[DEFAULT_THEME_ID].definition };
    snapshot.appearance = { selectedThemeId: customTheme.id, customThemes: [customTheme] };
    snapshot.sync.themeSelectionRevision = 2;
    snapshot.sync.themeRevisions[customTheme.id] = 2;
    const storage = { loadDesktop: async () => snapshot } as unknown as NonNullable<SyncEngineOptions["storage"]>;
    const engine = new SyncEngine({ frontendOnly: true, storage });
    await engine.start("desk", { x: 0, y: 0 });
    const document = await engine.listSystemEntries("desk");
    expect(document.entries.map((entry) => entry.systemRole)).toEqual(["layout", "editor-settings", "theme-selection", "theme-definition"]);
    expect(document.entries.map((entry) => entry.path)).toEqual([systemEntryPath("layout"), systemEntryPath("editor-settings"), systemEntryPath("theme-selection"), systemEntryPath("theme-definition", customTheme.id)]);
    const expected = [snapshot.layout, snapshot.editorSettings, { themeId: snapshot.appearance.selectedThemeId }, customTheme];
    for (const [index, entry] of document.entries.entries()) expect(JSON.parse(await (await engine.readSystemFile("desk", document.catalogId, entry)).text())).toEqual(expected[index]);
    await expect(engine.listSystemEntries("other")).rejects.toThrow("inactive local desktop");
    await expect(engine.readSystemFile("desk", document.catalogId, { ...document.entries[0], sha256: "0".repeat(64) })).rejects.toThrow("changed");
    await engine.stop();
  });
});

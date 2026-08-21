import { describe, expect, test } from "bun:test";
import { breadcrumbForEntry, localSearchResults, parseSearchResponse } from "../src/lib/search";
import { localDesktopIdentity } from "../src/lib/permissions";
import type { DesktopEntry } from "../src/types";

/** Provides the folder test fixture. */
const folder: DesktopEntry = { kind: "folder", id: "folder", name: "Plans", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
/** Provides the file test fixture. */
const file: DesktopEntry = { kind: "file", id: "file", name: "Q3.txt", parentId: folder.id, createdAt: 1, modifiedAt: 2, position: { x: 1, y: 1 }, mimeType: "text/plain", size: 3 };
/** Provides the wire file test fixture. */
const wireFile = { ...file, revision: 4, contentRevision: 4 };
/** Provides the result test fixture. */
const result = {
  authorityCatalogId: "authority",
  catalogRevision: 5,
  desktop: { id: "desk", name: "Work" },
  entry: wireFile,
  breadcrumbs: [{ id: folder.id, name: folder.name }],
};
/** Provides the response test fixture. */
const response = { schemaVersion: 1, query: "plans q3", limit: 50, truncated: false, results: [result] };

describe("desktop search models", () => {
  test("derives matching context from live desktop hierarchy", () => {
    expect(breadcrumbForEntry([folder, file], file)).toEqual(["Plans"]);
    expect(localSearchResults(localDesktopIdentity("desk", "Work"), [folder, file], true)[1]).toMatchObject({ desktopName: "Work", breadcrumb: ["Plans"], stale: true });
  });

  test("strictly parses contextual server results and rejects duplicates", () => {
    expect(parseSearchResponse(response, "plans q3")).toMatchObject({ query: "plans q3", limit: 50, truncated: false, results: [{ authorityCatalogId: "authority", catalogRevision: 5, desktopId: "desk", desktopName: "Work", breadcrumb: ["Plans"], stale: false }] });
    expect(() => parseSearchResponse({ ...response, schemaVersion: 2 })).toThrow("unsupported format");
    expect(() => parseSearchResponse({ ...response, query: " " })).toThrow("query");
    expect(() => parseSearchResponse(response, "different")).toThrow("different query");
    expect(() => parseSearchResponse({ ...response, limit: 0 })).toThrow("limit");
    expect(() => parseSearchResponse({ ...response, truncated: true })).toThrow("truncation");
    expect(() => parseSearchResponse({ ...response, results: [result, result] })).toThrow("duplicate");
    expect(() => parseSearchResponse({ ...response, results: [{ ...result, authorityCatalogId: "../bad" }] })).toThrow("authority catalog ID");
    expect(() => parseSearchResponse({ ...response, results: [{ ...result, catalogRevision: -1 }] })).toThrow("catalog revision");
    expect(() => parseSearchResponse({ ...response, results: [{ ...result, entry: { ...wireFile, revision: 6 } }] })).toThrow("newer than its catalog");
    expect(() => parseSearchResponse({ ...response, results: [{ ...result, breadcrumbs: [3] }] })).toThrow("breadcrumbs");
    expect(() => parseSearchResponse({ ...response, results: [{ ...result, breadcrumbs: [{ id: "other", name: "Other" }] }] })).toThrow("invalid order");
    expect(() => parseSearchResponse({ ...response, results: [{ ...result, breadcrumbs: [{ id: folder.id, name: folder.name }, { id: folder.id, name: folder.name }] }] })).toThrow("duplicate or cyclic");
  });

});

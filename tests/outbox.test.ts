import { describe, expect, test } from "bun:test";
import { applyOutboxOperation, desktopPendingOperationProtection, normalizeOutboxOperation, outboxDesktopRetentionIds, outboxRecordsDependingOnDesktop, parseRevisionConflictDetails, rebaseOutboxOperationAfterAcknowledgement, rebaseOutboxOperationForConflict, transferEntriesBetweenDesktopStates, type OutboxRecord } from "../src/lib/outbox";
import { desktopStateSnapshot, remoteDesktopIdentity } from "./fixtures";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "../src/lib/themes";
import { DEFAULT_WALLPAPER } from "../src/types";

function state() {
  const snapshot = desktopStateSnapshot();
  return { entries: snapshot.entries, snapToGrid: snapshot.layout.snapToGrid, wallpaper: snapshot.layout.wallpaper, editorSettings: snapshot.editorSettings, appearance: snapshot.appearance, sync: snapshot.sync };
}

describe("strict outbox", () => {
  test("requires operation schema version 1", () => {
    const operation = { schemaVersion: 1 as const, kind: "layout" as const, layout: { snapToGrid: true, wallpaper: { ...DEFAULT_WALLPAPER } } };
    expect(normalizeOutboxOperation(operation)).toEqual(operation);
    expect(applyOutboxOperation(state(), operation).snapToGrid).toBe(true);
    expect(() => normalizeOutboxOperation({ ...operation, schemaVersion: 2 } as never)).toThrow("schema version");
  });

  test("uses stable desktop identity instead of catalog-wide rename and delete revisions", () => {
    const desktop = { ...remoteDesktopIdentity("desk", "Renamed") };
    expect(normalizeOutboxOperation({ schemaVersion: 1, kind: "rename-desktop", desktop, baseRevision: 99 })).toEqual({ schemaVersion: 1, kind: "rename-desktop", desktop });
    expect(normalizeOutboxOperation({ schemaVersion: 1, kind: "delete-desktop", desktopId: desktop.id, baseRevision: 99 })).toEqual({ schemaVersion: 1, kind: "delete-desktop", desktopId: desktop.id });
  });

  test("projects canonical entry transfers and retains both desktops", () => {
    const folder = { kind: "folder" as const, id: "tree", name: "Tree", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const source = { ...state(), entries: [folder] };
    const operation = { schemaVersion: 1 as const, kind: "entry-transfer" as const, entryIds: [folder.id], destinationDesktopId: "destination", parentId: null };
    expect(applyOutboxOperation(source, operation).entries).toEqual([]);
    const record: OutboxRecord = { operationId: "1", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "source", operation, status: "pending", error: null };
    expect([...outboxDesktopRetentionIds([record], "catalog")].sort()).toEqual(["destination", "source"]);
    expect([...outboxDesktopRetentionIds([record], "replacement")]).toEqual([]);
  });

  test("projects offline CRUD, content, layout, settings, positions, and themes", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const file = { kind: "file" as const, id: "file", name: "note.txt", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 10, y: 10 }, mimeType: "text/plain", size: 0 };
    let projected = applyOutboxOperation(state(), { schemaVersion: 1, kind: "create", entries: [folder, file] });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "update-entry", entry: { ...folder, name: "Documents" } });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "save-content", entry: { ...file, size: 4, modifiedAt: 2 } });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "root-entry-positions", positions: [{ entryId: file.id, position: { x: -20, y: 30 } }] });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "layout", layout: { snapToGrid: true, wallpaper: { ...DEFAULT_WALLPAPER, source: "grove" } } });
    const settings = { ...projected.editorSettings, fontSize: 17, autoFormat: true };
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "editor-settings", settings });
    const theme = { id: "custom", name: "Custom", definition: BUILTIN_THEMES[DEFAULT_THEME_ID].definition };
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "upsert-theme", theme });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "select-theme", themeId: theme.id });

    expect(projected.entries.find(({ id }) => id === folder.id)?.name).toBe("Documents");
    expect(projected.entries.find(({ id }) => id === file.id)).toMatchObject({ size: 4, position: { x: -20, y: 30 } });
    expect(projected).toMatchObject({ snapToGrid: true, wallpaper: { source: "grove" }, editorSettings: settings });
    expect(projected.appearance.selectedThemeId).toBe(theme.id);

    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "delete", entryId: folder.id });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "delete-theme", themeId: theme.id });
    expect(projected.entries.map(({ id }) => id)).toEqual([file.id]);
    expect(projected.appearance).toEqual({ selectedThemeId: DEFAULT_THEME_ID, customThemes: [] });
  });

  test("projects operations on entries beneath an existing folder", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const file = { kind: "file" as const, id: "file", name: "note.txt", parentId: folder.id, createdAt: 1, modifiedAt: 1, position: { x: 10, y: 10 }, mimeType: "text/plain", size: 0 };
    let projected = { ...state(), entries: [folder] };

    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "create", entries: [file] });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "update-entry", entry: { ...file, name: "renamed.txt", modifiedAt: 2 } });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "save-content", entry: { ...file, name: "renamed.txt", size: 4, modifiedAt: 3 } });

    expect(projected.entries.find(({ id }) => id === file.id)).toMatchObject({ parentId: folder.id, name: "renamed.txt", size: 4 });
  });

  test("replays a move with one persisted timestamp", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const file = { kind: "file" as const, id: "file", name: "note.txt", parentId: null, createdAt: 1, modifiedAt: 2, position: { x: 10, y: 10 }, mimeType: "text/plain", size: 0 };
    const operation = { schemaVersion: 1 as const, kind: "move-entries" as const, entryIds: [file.id], parentId: folder.id, modifiedAt: 1234 };
    const initial = { ...state(), entries: [folder, file] };

    const first = applyOutboxOperation(initial, operation);
    const replayed = applyOutboxOperation(initial, normalizeOutboxOperation(JSON.parse(JSON.stringify(operation))));
    expect(first.entries).toEqual(replayed.entries);
    expect(first.entries.find(({ id }) => id === file.id)).toMatchObject({ parentId: folder.id, modifiedAt: 1234 });
  });

  test("replays legacy moves without inventing a timestamp", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const file = { kind: "file" as const, id: "file", name: "note.txt", parentId: null, createdAt: 1, modifiedAt: 42, position: { x: 10, y: 10 }, mimeType: "text/plain", size: 0 };
    const projected = applyOutboxOperation({ ...state(), entries: [folder, file] }, { schemaVersion: 1, kind: "move-entries", entryIds: [file.id], parentId: folder.id });
    expect(projected.entries.find(({ id }) => id === file.id)?.modifiedAt).toBe(42);
  });

  test("preserves disjoint remote entry fields while applying local intent", () => {
    const file = { kind: "file" as const, id: "file", name: "remote-name.txt", parentId: null, createdAt: 1, modifiedAt: 9, position: { x: 90, y: 80 }, mimeType: "text/plain", size: 1 };
    const projected = applyOutboxOperation({ ...state(), entries: [file] }, { schemaVersion: 1, kind: "save-content", entryId: file.id, mimeType: "text/markdown", size: 4, modifiedAt: 10, baseContentRevision: 2 });
    expect(projected.entries[0]).toEqual({ ...file, mimeType: "text/markdown", size: 4, modifiedAt: 10 });
  });

  test("rebases only causally acknowledged resource revisions", () => {
    const snapshot = { ...state(), sync: { ...state().sync, catalogRevision: 5, entryRevisions: { "own-change": 5, concurrent: 6 } } };
    const own = rebaseOutboxOperationAfterAcknowledgement(snapshot, { schemaVersion: 1, kind: "patch-entry", entryId: "own-change", baseRevision: 2, changes: { name: "next" } }, 5);
    const concurrent = rebaseOutboxOperationAfterAcknowledgement(snapshot, { schemaVersion: 1, kind: "patch-entry", entryId: "concurrent", baseRevision: 2, changes: { name: "stale" } }, 5);
    expect(own).toMatchObject({ baseRevision: 5 });
    expect(concurrent).toMatchObject({ baseRevision: 2 });
  });

  test("validates conflict details and rebases only the matching resource", () => {
    const conflict = parseRevisionConflictDetails({ resourceKind: "entry", resourceId: "file", expectedRevision: 2, actualRevision: 7 });
    expect(conflict).not.toBeNull();
    expect(rebaseOutboxOperationForConflict({ schemaVersion: 1, kind: "patch-entry", entryId: "file", baseRevision: 2, changes: { name: "local.txt" } }, conflict!)).toMatchObject({ baseRevision: 7 });
    expect(rebaseOutboxOperationForConflict({ schemaVersion: 1, kind: "patch-entry", entryId: "other", baseRevision: 2, changes: { name: "local.txt" } }, conflict!)).toBeNull();
    expect(parseRevisionConflictDetails({ resourceKind: "entry", resourceId: "file", expectedRevision: -1, actualRevision: 7 })).toBeNull();
    expect(parseRevisionConflictDetails({ resourceKind: "entry", resourceId: "file", expectedRevision: 2, actualRevision: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
  });

  test("rejects operations whose parent is absent from the desktop", () => {
    const file = { kind: "file" as const, id: "file", name: "note.txt", parentId: "missing", createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 0 };
    expect(() => applyOutboxOperation(state(), { schemaVersion: 1, kind: "create", entries: [file] })).toThrow("missing parent folder");
  });

  test("transfers entry trees and their revisions between desktop states", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const file = { kind: "file" as const, id: "file", name: "note.txt", parentId: folder.id, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "text/plain", size: 4 };
    const source = { ...state(), entries: [folder, file], sync: { ...state().sync, catalogId: "catalog", catalogRevision: 8, entryRevisions: { folder: 6, file: 7 }, contentRevisions: { file: 5 } } };
    const destination = { ...state(), sync: { ...state().sync, catalogId: "catalog", catalogRevision: 7, entryRevisions: { existing: 2 }, contentRevisions: {} } };
    const transferred = transferEntriesBetweenDesktopStates(source, destination, [folder.id], null, 10);

    expect(transferred.source.entries).toEqual([]);
    expect(transferred.source.sync).toMatchObject({ catalogId: "catalog", catalogRevision: 8, entryRevisions: {}, contentRevisions: {} });
    expect(transferred.destination.entries).toEqual([{ ...folder, modifiedAt: 10 }, file]);
    expect(transferred.destination.sync).toMatchObject({ catalogId: "catalog", catalogRevision: 8, entryRevisions: { existing: 2, folder: 6, file: 7 }, contentRevisions: { file: 5 } });
  });

  test("resets a selected image when deleting or transferring its ancestor", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const file = { kind: "file" as const, id: "image", name: "wallpaper.png", parentId: folder.id, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "image/png", size: 4 };
    const source = { ...state(), entries: [folder, file], wallpaper: { ...DEFAULT_WALLPAPER, source: `file:${file.id}` as const }, sync: { ...state().sync, catalogId: "catalog", catalogRevision: 8, layoutRevision: 3 } };
    const destination = { ...state(), sync: { ...state().sync, catalogId: "catalog" } };

    const deleted = applyOutboxOperation(source, { schemaVersion: 1, kind: "delete", entryId: folder.id });
    const transferred = transferEntriesBetweenDesktopStates(source, destination, [folder.id], null).source;
    expect(deleted.wallpaper).toEqual(DEFAULT_WALLPAPER);
    expect(deleted.sync.layoutRevision).toBe(8);
    expect(transferred.wallpaper).toEqual(DEFAULT_WALLPAPER);
    expect(transferred.sync.layoutRevision).toBe(8);
  });

  test("protects desktops owning or referenced by pending and blocked operations", () => {
    const transfer: OutboxRecord = { operationId: "transfer", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "source", operation: { schemaVersion: 1, kind: "entry-transfer", entryIds: ["file"], destinationDesktopId: "destination", parentId: null }, status: "pending", error: null };
    expect(desktopPendingOperationProtection([transfer], "source")).toContain("pending or blocked");
    expect(desktopPendingOperationProtection([transfer], "destination")).toContain("pending or blocked");
    expect(desktopPendingOperationProtection([transfer], "clean")).toBe("");
    const destinationEdit: OutboxRecord = { ...transfer, operationId: "destination-edit", sequence: 2, desktopId: "destination", operation: { schemaVersion: 1, kind: "editor-settings", settings: state().editorSettings } };
    const unrelated: OutboxRecord = { ...destinationEdit, operationId: "unrelated", sequence: 3, desktopId: "other" };
    expect(outboxRecordsDependingOnDesktop([transfer, destinationEdit, unrelated], "source").map((record) => record.operationId)).toEqual(["transfer"]);
    expect(outboxRecordsDependingOnDesktop([transfer, destinationEdit, unrelated], "destination").map((record) => record.operationId)).toEqual(["transfer", "destination-edit"]);
  });
});

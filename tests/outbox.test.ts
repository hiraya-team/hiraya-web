import { describe, expect, test } from "bun:test";
import { applyOutboxOperation, desktopPendingOperationProtection, normalizeOutboxOperation, outboxBlockingRecord, outboxDesktopRetentionIds, outboxRecordsDependingOnDesktop, parseRevisionConflictDetails, rebaseOutboxOperationAfterAcknowledgement, rebaseOutboxOperationForConflict, resolveOutboxRevisionConflict, transferEntriesBetweenDesktopStates, type OutboxRecord } from "../src/lib/outbox";
import { desktopStateSnapshot, remoteDesktopIdentity } from "./fixtures";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "../src/lib/themes";
import { DEFAULT_WALLPAPER } from "../src/types";

/** Returns the current state. */
function state() {
  const snapshot = desktopStateSnapshot();
  return { entries: snapshot.entries, autoArrangeIcons: snapshot.layout.autoArrangeIcons, snapToGrid: snapshot.layout.snapToGrid, gridSize: snapshot.layout.gridSize, wallpaper: snapshot.layout.wallpaper, widgets: snapshot.layout.widgets, iconGroups: snapshot.layout.iconGroups, editorSettings: snapshot.editorSettings, appearance: snapshot.appearance, sync: snapshot.sync };
}

describe("strict outbox", () => {
  test("requires operation schema version 1", () => {
    const operation = { schemaVersion: 1 as const, kind: "layout" as const, layout: { snapToGrid: true, wallpaper: { ...DEFAULT_WALLPAPER } } };
    expect(normalizeOutboxOperation(operation)).toEqual({ ...operation, layout: { ...operation.layout, autoArrangeIcons: true, gridSize: 24, widgets: [], iconGroups: [] } });
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
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "patch-entry", entryId: folder.id, changes: { name: "Documents" } });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "save-content", entryId: file.id, mimeType: file.mimeType, size: 4, modifiedAt: 2 });
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

  test("rebases independent file creation template edits by extension", () => {
    const base = state();
    const localSettings = { ...base.editorSettings, fileCreationTemplates: base.editorSettings.fileCreationTemplates.map((item) => item.extension === ".json" ? { ...item, content: "local" } : item) };
    const remote = desktopStateSnapshot();
    remote.editorSettings = { ...remote.editorSettings, fileCreationTemplates: remote.editorSettings.fileCreationTemplates.map((item) => item.extension === ".url" ? { ...item, content: "remote" } : item) };
    const result = resolveOutboxRevisionConflict({ schemaVersion: 1, kind: "editor-settings", settings: localSettings, baseRevision: 1, conflictBase: base.editorSettings }, { resourceKind: "editor-settings", resourceId: "desk", expectedRevision: 1, actualRevision: 2 }, remote);
    expect(result.kind).toBe("rebase");
    if (result.kind === "rebase") expect(result.operation.settings.fileCreationTemplates.map(({ extension, content }) => [extension, content])).toContainEqual([".json", "local"]);
    if (result.kind === "rebase") expect(result.operation.settings.fileCreationTemplates.map(({ extension, content }) => [extension, content])).toContainEqual([".url", "remote"]);
  });

  test("atomically removes a replaced package wallpaper and its selected layout source", () => {
    const wallpaper = { assetId: "old-asset", kind: "scene" as const, size: 4, sha256: "a".repeat(64), revision: 2 };
    const installed = { id: "aurora", name: "Aurora", definition: BUILTIN_THEMES[DEFAULT_THEME_ID].definition, wallpaper };
    const widget = { id: "clock", kind: "clock" as const, x: 0, y: 0, width: 200, height: 100 };
    const initial = { ...state(), widgets: [widget], wallpaper: { ...DEFAULT_WALLPAPER, source: "theme:aurora" as const }, appearance: { selectedThemeId: installed.id, customThemes: [installed] } };
    const replacement = { id: installed.id, name: "Aurora Plain", definition: installed.definition };
    const operation = {
      schemaVersion: 1 as const,
      kind: "install-theme-package" as const,
      theme: replacement,
      assetId: "replacement-asset",
      wallpaperKind: null,
      size: 0,
      layout: { snapToGrid: false, wallpaper: { ...DEFAULT_WALLPAPER } },
    };
    const projected = applyOutboxOperation(initial, normalizeOutboxOperation(operation));
    expect(projected.appearance).toEqual({ selectedThemeId: replacement.id, customThemes: [replacement] });
    expect(projected.wallpaper).toEqual(DEFAULT_WALLPAPER);
    expect(projected.widgets).toEqual([widget]);
  });

  test("projects operations on entries beneath an existing folder", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const file = { kind: "file" as const, id: "file", name: "note.txt", parentId: folder.id, createdAt: 1, modifiedAt: 1, position: { x: 10, y: 10 }, mimeType: "text/plain", size: 0 };
    let projected = { ...state(), entries: [folder] };

    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "create", entries: [file] });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "patch-entry", entryId: file.id, changes: { name: "renamed.txt", modifiedAt: 2 } });
    projected = applyOutboxOperation(projected, { schemaVersion: 1, kind: "save-content", entryId: file.id, mimeType: file.mimeType, size: 4, modifiedAt: 3 });

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

  test("accepts only generated immutable staged-content keys", () => {
    const operation = { schemaVersion: 1 as const, kind: "save-content" as const, entryId: "file", mimeType: "text/plain", size: 4, modifiedAt: 10, baseContentRevision: 2, stagedContentKey: ".mine-00000000-0000-4000-8000-000000000000" };
    expect(normalizeOutboxOperation(operation)).toEqual(operation);
    expect(() => normalizeOutboxOperation({ ...operation, stagedContentKey: "../file" })).toThrow("unsupported metadata");
  });

  test("rebases only causally acknowledged resource revisions", () => {
    const changed = { ...state().entries[0], id: "own-change", name: "first", position: { x: 20, y: 30 } };
    const snapshot = { ...state(), entries: [changed], sync: { ...state().sync, catalogRevision: 5, entryRevisions: { "own-change": 5, concurrent: 6 } } };
    const own = rebaseOutboxOperationAfterAcknowledgement(snapshot, { schemaVersion: 1, kind: "patch-entry", entryId: "own-change", baseRevision: 2, conflictBase: { name: "old", parentId: null, position: { x: 0, y: 0 } }, changes: { name: "next" } }, 5);
    const concurrent = rebaseOutboxOperationAfterAcknowledgement(snapshot, { schemaVersion: 1, kind: "patch-entry", entryId: "concurrent", baseRevision: 2, changes: { name: "stale" } }, 5);
    expect(own).toMatchObject({ baseRevision: 5, conflictBase: { name: "first", position: { x: 20, y: 30 } } });
    expect(concurrent).toMatchObject({ baseRevision: 2 });
  });

  test("validates conflict details and rebases only the matching resource", () => {
    const conflict = parseRevisionConflictDetails({ resourceKind: "entry", resourceId: "file", expectedRevision: 2, actualRevision: 7 });
    expect(conflict).not.toBeNull();
    expect(rebaseOutboxOperationForConflict({ schemaVersion: 1, kind: "patch-entry", entryId: "file", baseRevision: 2, changes: { name: "local.txt" } }, conflict!)).toMatchObject({ baseRevision: 7 });
    expect(rebaseOutboxOperationForConflict({ schemaVersion: 1, kind: "patch-entry", entryId: "other", baseRevision: 2, changes: { name: "local.txt" } }, conflict!)).toBeNull();
    expect(parseRevisionConflictDetails({ resourceKind: "entry", resourceId: "file", expectedRevision: -1, actualRevision: 7 })).toBeNull();
    expect(parseRevisionConflictDetails({ resourceKind: "entry", resourceId: "file", expectedRevision: 2, actualRevision: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(parseRevisionConflictDetails({ resourceKind: "layout", resourceId: "", expectedRevision: 2, actualRevision: 7 })).not.toBeNull();
    expect(parseRevisionConflictDetails({ resourceKind: "entry", resourceId: "", expectedRevision: 2, actualRevision: 7 })).toBeNull();
  });

  test("automatically rebases disjoint entry changes and blocks same-field changes", () => {
    const base = { ...desktopStateSnapshot().entries[0], name: "note.txt", position: { x: 0, y: 0 } };
    const conflict = { resourceKind: "entry" as const, resourceId: base.id, expectedRevision: 1, actualRevision: 2 };
    const operation = { schemaVersion: 1 as const, kind: "patch-entry" as const, entryId: base.id, baseRevision: 1, conflictBase: { name: base.name, parentId: base.parentId, position: base.position }, changes: { name: "local.txt" } };
    const remote = { ...desktopStateSnapshot(), entries: [{ ...base, position: { x: 40, y: 50 } }], sync: { ...desktopStateSnapshot().sync, entryRevisions: { [base.id]: 2 } } };

    expect(resolveOutboxRevisionConflict(operation, conflict, remote)).toMatchObject({ kind: "rebase", operation: { baseRevision: 2, changes: { name: "local.txt" } } });
    expect(resolveOutboxRevisionConflict(operation, conflict, { ...remote, entries: [{ ...base, name: "remote.txt" }] })).toEqual({ kind: "blocked", fields: ["name"] });
  });

  test("recognizes revision conflicts whose intent is already authoritative", () => {
    const snapshot = desktopStateSnapshot();
    const remote = { ...snapshot, appearance: { ...snapshot.appearance, selectedThemeId: "warm-paper" }, sync: { ...snapshot.sync, themeSelectionRevision: 2 } };
    const operation = { schemaVersion: 1 as const, kind: "select-theme" as const, themeId: "warm-paper", baseRevision: 1 };
    const conflict = { resourceKind: "theme-selection" as const, resourceId: "desk", expectedRevision: 1, actualRevision: 2 };

    expect(resolveOutboxRevisionConflict(operation, conflict, remote)).toEqual({ kind: "satisfied" });
    expect(resolveOutboxRevisionConflict(operation, conflict, { ...remote, appearance: { ...remote.appearance, selectedThemeId: DEFAULT_THEME_ID } })).toEqual({ kind: "blocked", fields: ["theme-selection"] });
  });

  test("leaves content conflicts for durable blob resolution", () => {
    const snapshot = desktopStateSnapshot();
    const operation = { schemaVersion: 1 as const, kind: "save-content" as const, entryId: "file", mimeType: "text/plain", size: 5, modifiedAt: 2, baseContentRevision: 1 };
    const conflict = { resourceKind: "content" as const, resourceId: operation.entryId, expectedRevision: 1, actualRevision: 2 };
    expect(resolveOutboxRevisionConflict(operation, conflict, { ...snapshot, sync: { ...snapshot.sync, contentRevisions: { [operation.entryId]: 2 } } })).toEqual({ kind: "blocked", fields: ["content"] });
  });

  test("three-way merges disjoint layout fields without overwriting remote state", () => {
    const snapshot = desktopStateSnapshot();
    const operation = { schemaVersion: 1 as const, kind: "layout" as const, layout: { ...snapshot.layout, autoArrangeIcons: false, snapToGrid: true }, baseRevision: 1, conflictBase: snapshot.layout };
    const remote = { ...snapshot, layout: { ...snapshot.layout, wallpaper: { ...snapshot.layout.wallpaper, dim: 0.8 } }, sync: { ...snapshot.sync, layoutRevision: 2 } };
    const resolution = resolveOutboxRevisionConflict(operation, { resourceKind: "layout", resourceId: "desk", expectedRevision: 1, actualRevision: 2 }, remote);

    expect(resolution).toMatchObject({ kind: "rebase", operation: { baseRevision: 2, layout: { autoArrangeIcons: false, snapToGrid: true, wallpaper: { dim: 0.8 } } } });
    expect(resolveOutboxRevisionConflict(operation, { resourceKind: "layout", resourceId: "desk", expectedRevision: 1, actualRevision: 2 }, { ...remote, layout: { ...remote.layout, autoArrangeIcons: false } })).toMatchObject({ kind: "rebase" });
  });

  test("three-way merges layout items by stable ID and blocks the same item", () => {
    const snapshot = desktopStateSnapshot();
    const clock = { id: "clock", kind: "clock" as const, x: 0, y: 0, width: 200, height: 100 };
    const calendar = { id: "calendar", kind: "calendar" as const, x: 220, y: 0, width: 240, height: 180 };
    const base = { ...snapshot.layout, widgets: [clock], iconGroups: [{ folderId: "one", width: 200, height: 200 }] };
    const operation = { schemaVersion: 1 as const, kind: "layout" as const, layout: { ...base, widgets: [{ ...clock, x: 20 }], iconGroups: [{ ...base.iconGroups[0], width: 240 }] }, baseRevision: 1, conflictBase: base };
    const remote = { ...snapshot, layout: { ...base, widgets: [clock, calendar], iconGroups: [...base.iconGroups, { folderId: "two", width: 300, height: 220 }] }, sync: { ...snapshot.sync, layoutRevision: 2 } };
    const conflict = { resourceKind: "layout" as const, resourceId: "desk", expectedRevision: 1, actualRevision: 2 };

    expect(resolveOutboxRevisionConflict(operation, conflict, remote)).toMatchObject({ kind: "rebase", operation: { layout: { widgets: [{ id: "clock", x: 20 }, { id: "calendar" }], iconGroups: [{ folderId: "one", width: 240 }, { folderId: "two" }] } } });
    expect(resolveOutboxRevisionConflict(operation, conflict, { ...remote, layout: { ...base, widgets: [{ ...clock, y: 20 }] } })).toEqual({ kind: "blocked", fields: ["widgets"] });
    expect(resolveOutboxRevisionConflict(operation, conflict, { ...remote, layout: { ...base, iconGroups: [{ ...base.iconGroups[0], height: 240 }] } })).toEqual({ kind: "blocked", fields: ["icon groups"] });
    expect(resolveOutboxRevisionConflict({ ...operation, layout: { ...base, widgets: [], iconGroups: [] } }, conflict, { ...remote, layout: { ...base, widgets: [], iconGroups: [] } })).toEqual({ kind: "satisfied" });
  });

  test("identifies pending changes waiting on an earlier causal conflict", () => {
    const blocked: OutboxRecord = { operationId: "1", sequence: 1, clientId: "client", catalogId: "catalog", desktopId: "desk", operation: { schemaVersion: 1, kind: "patch-entry", entryId: "file", changes: { name: "blocked.txt" } }, status: "blocked", error: "conflict" };
    const dependent: OutboxRecord = { ...blocked, operationId: "2", sequence: 2, operation: { schemaVersion: 1, kind: "patch-entry", entryId: "file", changes: { position: { x: 1, y: 2 } } }, status: "pending", error: null };
    const independent: OutboxRecord = { ...dependent, operationId: "3", sequence: 3, operation: { schemaVersion: 1, kind: "editor-settings", settings: state().editorSettings } };
    expect(outboxBlockingRecord([blocked, dependent, independent], dependent)).toBe(blocked);
    expect(outboxBlockingRecord([blocked, dependent, independent], independent)).toBeNull();
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

  test("resets a selected file while preserving its recoverable Scene widget", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const file = { kind: "file" as const, id: "scene", name: "wallpaper.hiraya.scene", parentId: folder.id, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "application/vnd.hiraya.scene+zip", size: 4 };
    const sceneWidget = { id: "scene-widget", kind: "scene" as const, fileId: file.id, x: 1, y: 2, width: 320, height: 180 };
    const source = { ...state(), entries: [folder, file], wallpaper: { ...DEFAULT_WALLPAPER, source: `file:${file.id}` as const }, widgets: [sceneWidget], sync: { ...state().sync, catalogId: "catalog", catalogRevision: 8, layoutRevision: 3 } };
    const destination = { ...state(), sync: { ...state().sync, catalogId: "catalog" } };

    const deleted = applyOutboxOperation(source, { schemaVersion: 1, kind: "delete", entryId: folder.id });
    const transferred = transferEntriesBetweenDesktopStates(source, destination, [folder.id], null).source;
    expect(deleted.wallpaper).toEqual(DEFAULT_WALLPAPER);
    expect(deleted.widgets).toEqual([sceneWidget]);
    expect(deleted.sync.layoutRevision).toBe(8);
    expect(transferred.wallpaper).toEqual(DEFAULT_WALLPAPER);
    expect(transferred.widgets).toEqual([sceneWidget]);
    expect(transferred.sync.layoutRevision).toBe(8);
  });

  test("prunes icon groups after grouped folders are deleted, reparented, or transferred", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "Folder", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const parent = { ...folder, id: "parent", name: "Parent" };
    const grouped = { ...state(), entries: [folder, parent], iconGroups: [{ folderId: folder.id, width: 320, height: 240 }], sync: { ...state().sync, catalogId: "catalog", catalogRevision: 8, layoutRevision: 3 } };
    const destination = { ...state(), sync: { ...state().sync, catalogId: "catalog" } };

    expect(applyOutboxOperation(grouped, { schemaVersion: 1, kind: "delete", entryId: folder.id }).iconGroups).toEqual([]);
    expect(applyOutboxOperation(grouped, { schemaVersion: 1, kind: "patch-entry", entryId: folder.id, changes: { parentId: parent.id } }).iconGroups).toEqual([]);
    expect(applyOutboxOperation(grouped, { schemaVersion: 1, kind: "move-entries", entryIds: [folder.id], parentId: parent.id }).iconGroups).toEqual([]);
    expect(transferEntriesBetweenDesktopStates(grouped, destination, [folder.id], null).source.iconGroups).toEqual([]);
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

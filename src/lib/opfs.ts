import { DEFAULT_GRID_SIZE, DEFAULT_WALLPAPER, type DesktopEntry, type DesktopIdentity, type DesktopLayout, type RootEntryPositionUpdate, type EditorSettings, type EntryPosition, type FileEntry, type FolderEntry } from "../types";
import type { DesktopStateSnapshot } from "../domain/desktop-state";
import { ContentRevisionConflictError, type SaveFileOptions } from "../domain/files";
import type { LocalPreferences } from "../domain/preferences";
import { assertUniqueName, namesMatch, validateEntryName } from "./entry-validation";
import { parseBundledSeededManifest, type SeededManifest } from "./seeded-manifest";
import { validateWallpaperImage } from "./wallpaper-image";
import {
  DEFAULT_EDITOR_SETTINGS,
  emptySyncState,
  desktopStateLayout,
  parseDesktopState,
} from "./desktop-state";
import { normalizeDesktopName, parseDesktopIdentity, parseLayout, parsePosition, parseRootEntryPositionUpdates } from "./contracts";
import { iconGroupsAfterEntryChange, wallpaperAfterEntryRemoval, type OutboxOperation, type OutboxRecord } from "./outbox";
import { DEFAULT_THEME_STATE, parseCustomTheme, parseThemeState } from "./themes";
import type { CustomTheme, ThemeWallpaperPackage } from "../domain/theme";
import type { WindowSession } from "./window-session";
import { activityRecord, type ActivityQuery, type NewActivityRecord } from "./activity";
import { resolveDesktopContext } from "./desktop-catalog";
import { localDesktopIdentity } from "./permissions";
import type { FileAssociation, InstalledApp } from "../apps/installed-apps";
import type { JsonValue } from "@hiraya-team/apps-contracts";
import { offlineFilesUnderRoots, outboxProtectedFileIds, type OfflineStorageInventory } from "./offline-availability";
import { callDatabase, initializeDatabase } from "../platform/storage/database-client";
import { contentMatchesCacheMarker, getFilesDirectory, materializeOutbox, operationContentIds, prepareLocalContentReplacement, publishLocalContentReplacement, readContentCacheMarker, readContentConflictBase, readContentConflictServer, readStagedContent, recoverLocalContentReplacements, removeContentCacheMarker, removeStagedOperation, removeUnretainedCachedContent, stageOperationContents, stageStagedContentVariant, writeContent, writeContentCacheMarker, writeContentConflictBase, writeContentConflictServer } from "../platform/storage/blobs";
import { FRONTEND_ONLY, estimateStorage, getActiveDesktopContext, isNotFound, serializeStorage, setDesktopContext } from "../platform/storage/namespace";
import * as repositories from "../platform/storage/repositories";
import { sha256Blob } from "./blob-transfer";
import { importedFileMimeType, isSceneFile } from "../domain/scene";

type DesktopState = import("../domain/desktop-state").PersistedDesktopState;

// Local aliases keep mutation code focused on state transitions rather than persistence mechanics.
type Manifest = DesktopState;
const parseManifestV13 = parseDesktopState;
const manifestLayout = desktopStateLayout;

async function writeDesktopState(state: DesktopState, activity?: NewActivityRecord) {
  await callDatabase("replaceDesktopState", { state, activity });
  desktopLoad = Promise.resolve(state);
}

function activityDetails(entries: DesktopEntry[]) {
  const names = entries.slice(0, 18).map((entry) => `${entry.kind === "file" ? "File" : "Folder"}: ${entry.name}`);
  if (entries.length > names.length) names.push(`Additional items: ${entries.length - names.length}`);
  return names;
}

function locationDetail(entries: DesktopEntry[], parentId: string | null) {
  return `Location: ${parentId === null ? "Desktop" : entries.find((entry) => entry.id === parentId)?.name ?? "Unknown folder"}`;
}

function assertValidDesktopState(state: DesktopState) {
  parseDesktopState(state);
}

async function createDesktopStateFromSeeded(seeded: SeededManifest): Promise<DesktopState> {
  const parsedSeeded = parseBundledSeededManifest(seeded);
  const files = parsedSeeded.entries.filter((entry) => entry.kind === "file");
  const contents = await Promise.all(files.map(async (entry) => {
    const response = await fetch(entry.contentUrl);
    if (!response.ok) throw new Error(`The seeded file “${entry.name}” could not be loaded (${response.status}).`);
    const blob = await response.blob();
    if (blob.size !== entry.size) {
      throw new Error(`The seeded file “${entry.name}” has size ${blob.size}, but its manifest declares ${entry.size}.`);
    }
    return blob.slice(0, blob.size, entry.mimeType);
  }));
  const wallpaperFileId = parsedSeeded.layout.wallpaper.source.startsWith("file:") ? parsedSeeded.layout.wallpaper.source.slice(5) : null;
  if (wallpaperFileId) {
    const index = files.findIndex((entry) => entry.id === wallpaperFileId);
    if (!isSceneFile(files[index])) await validateWallpaperImage(new File([contents[index]], files[index].name, { type: files[index].mimeType }));
  }
  const entries: DesktopEntry[] = parsedSeeded.entries.map((entry) => {
    if (entry.kind === "folder") return entry;
    const { contentUrl, ...file } = entry;
    void contentUrl;
    return file;
  });
  const created: DesktopState = {
    entries,
    autoArrangeIcons: parsedSeeded.layout.autoArrangeIcons,
    snapToGrid: parsedSeeded.layout.snapToGrid,
    gridSize: parsedSeeded.layout.gridSize,
    wallpaper: parsedSeeded.layout.wallpaper,
    widgets: parsedSeeded.layout.widgets,
    iconGroups: parsedSeeded.layout.iconGroups,
    editorSettings: parsedSeeded.editorSettings,
    appearance: parsedSeeded.appearance,
    sync: emptySyncState(),
  };
  assertValidDesktopState(created);
  for (const [index, file] of files.entries()) await writeContent(file.id, contents[index]);
  return created;
}

async function readActiveDesktopState(seeded: SeededManifest | null = null): Promise<DesktopState> {
  await ensureLocalDatabase();
  const desktopId = getActiveDesktopContext();
  if (!desktopId) throw new Error("No desktop is active.");
  try {
    return parseDesktopState(await callDatabase("readDesktop", { desktopId }, desktopId));
  } catch (error) {
    if (!seeded) throw error;
    const desktop = localDesktopIdentity(crypto.randomUUID(), "Desktop");
    const state = await createDesktopStateFromSeeded(seeded);
    await callDatabase("createDesktop", { desktop, state }, null);
    setDesktopContext(desktop.id);
    return state;
  }
}

async function recoverLocalFileTransactions() {
  await recoverLocalContentReplacements(async (journal) => {
    try {
      const state = parseDesktopState(await callDatabase("readDesktop", { desktopId: journal.desktopId }, null));
      const entry = state.entries.find((candidate): candidate is FileEntry => candidate.id === journal.id && candidate.kind === "file");
      return entry?.mimeType === journal.saved.mimeType && entry.size === journal.saved.size && entry.modifiedAt === journal.saved.modifiedAt;
    } catch { return false; }
  });
}

async function ensureLocalDatabase() {
  databaseInitialization ??= initializeDatabase().then(recoverLocalFileTransactions).catch((error) => {
    databaseInitialization = null;
    throw error;
  });
  await databaseInitialization;
}

const readManifest = readActiveDesktopState;
const writeManifest = writeDesktopState;
const assertValidManifest = assertValidDesktopState;

async function globallyProtectedFileIdsUnsafe(records: readonly OutboxRecord[]) {
  const registry = await callDatabase("listDesktops", undefined, null);
  const states: Manifest[] = [];
  for (const desktop of registry.desktops) states.push(parseManifestV13(await callDatabase("readDesktop", { desktopId: desktop.id }, null)));
  return outboxProtectedFileIds(records, states);
}

function stateContentIds(state: Pick<DesktopState, "entries" | "appearance">) {
  return [
    ...state.entries.filter((entry) => entry.kind === "file").map((entry) => entry.id),
    ...state.appearance.customThemes.flatMap((theme) => theme.wallpaper ? [theme.wallpaper.assetId] : []),
  ];
}


function findParent(entries: DesktopEntry[], parentId: string | null) {
  if (parentId === null) return;
  const parent = entries.find((entry) => entry.id === parentId);
  if (!parent) throw new Error("That parent folder no longer exists.");
  if (parent.kind !== "folder") throw new Error("Files cannot contain other entries.");
  return parent;
}

function getEntry(entries: DesktopEntry[], id: string) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("That entry no longer exists.");
  return entry;
}

function getFileEntry(entries: DesktopEntry[], id: string): FileEntry {
  const entry = getEntry(entries, id);
  if (entry.kind !== "file") throw new Error("Folders do not have file content.");
  return entry;
}

let desktopLoad: Promise<DesktopState> | null = null;
let databaseInitialization: Promise<void> | null = null;

function emptyDesktopState(): DesktopState {
  return { entries: [], autoArrangeIcons: true, snapToGrid: false, gridSize: DEFAULT_GRID_SIZE, wallpaper: DEFAULT_WALLPAPER, widgets: [], iconGroups: [], editorSettings: DEFAULT_EDITOR_SETTINGS, appearance: DEFAULT_THEME_STATE, sync: emptySyncState() };
}

async function listDesktopsUnsafe(seeded: SeededManifest | null = null) {
  await ensureLocalDatabase();
  const result = await callDatabase("listDesktops", undefined, null);
  const desktops = result.desktops.map((desktop) => parseDesktopIdentity(desktop, true));
  if (desktops.length === 0 && seeded) {
    const desktop = localDesktopIdentity(crypto.randomUUID(), "Desktop");
    await callDatabase("createDesktop", { desktop, state: await createDesktopStateFromSeeded(seeded) }, null);
    desktops.push(desktop);
  }
  const activeDesktopId = resolveDesktopContext(getActiveDesktopContext(), desktops);
  if (activeDesktopId) setDesktopContext(activeDesktopId);
  return { desktops, activeDesktopId };
}

async function createDesktopUnsafe(nameValue: string) {
  await ensureLocalDatabase();
  const desktop = localDesktopIdentity(crypto.randomUUID(), normalizeDesktopName(nameValue));
  const registry = await callDatabase("listDesktops", undefined);
  if (registry.desktops.some((candidate) => candidate.name.toLocaleLowerCase() === desktop.name.toLocaleLowerCase())) throw new Error("A desktop with that name already exists.");
  const state = emptyDesktopState();
  const activeDesktopId = getActiveDesktopContext();
  if (activeDesktopId) {
    const active = parseDesktopState(await callDatabase("readDesktop", { desktopId: activeDesktopId }, activeDesktopId));
    state.sync.catalogId = active.sync.catalogId;
    state.sync.catalogRevision = active.sync.catalogRevision;
  }
  return parseDesktopIdentity(await callDatabase("createDesktop", { desktop, state }), true);
}

async function createOfflineDesktopUnsafe(nameValue: string) {
  await ensureLocalDatabase();
  const desktop = localDesktopIdentity(crypto.randomUUID(), normalizeDesktopName(nameValue));
  const registry = await callDatabase("listDesktops", undefined, null);
  if (registry.desktops.length !== 0) throw new Error("An offline desktop can only initialize an empty browser catalog.");
  const result = await callDatabase("createOfflineDesktop", { desktop, state: emptyDesktopState() }, null);
  setDesktopContext(desktop.id);
  desktopLoad = Promise.resolve(emptyDesktopState());
  return { ...result, desktop: parseDesktopIdentity(result.desktop, true) };
}

async function ensureDesktopUnsafe(value: DesktopIdentity) {
  await ensureLocalDatabase();
  const desktop = parseDesktopIdentity(value, true);
  const registry = await callDatabase("listDesktops", undefined);
  const existing = registry.desktops.find((candidate) => candidate.id === desktop.id);
  if (existing) {
    const hasPendingRename = (await callDatabase("readOutbox", undefined)).some((record) => record.operation.kind === "rename-desktop" && record.operation.desktop.id === desktop.id);
    if (!hasPendingRename && existing.name !== desktop.name) await callDatabase("renameDesktop", { desktopId: desktop.id, name: desktop.name });
    await callDatabase("updateDesktopIdentity", { desktop: hasPendingRename ? { ...desktop, name: existing.name } : desktop });
    return desktop;
  }
  return parseDesktopIdentity(await callDatabase("createDesktop", { desktop, state: emptyDesktopState() }), true);
}

async function renameDesktopUnsafe(desktopId: string, nameValue: string) {
  const name = normalizeDesktopName(nameValue);
  const registry = await callDatabase("listDesktops", undefined);
  if (registry.desktops.some((candidate) => candidate.id !== desktopId && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A desktop with that name already exists.");
  return parseDesktopIdentity(await callDatabase("renameDesktop", { desktopId, name }), true);
}

async function switchDesktopUnsafe(desktopId: string) {
  const manifest = parseDesktopState(await callDatabase("readDesktop", { desktopId }, desktopId));
  setDesktopContext(desktopId);
  desktopLoad = Promise.resolve(manifest);
  await materializeOutbox(await callDatabase("readOutbox", undefined), true);
  return { entries: manifest.entries, layout: desktopStateLayout(manifest), editorSettings: manifest.editorSettings, appearance: manifest.appearance, sync: manifest.sync };
}

async function deleteDesktopUnsafe(desktopId: string) {
  const deleted = parseDesktopState(await callDatabase("readDesktop", { desktopId }));
  const registry = await callDatabase("listDesktops", undefined);
  const retained = new Set<string>();
  for (const desktop of registry.desktops) {
    if (desktop.id === desktopId) continue;
    const manifest = parseDesktopState(await callDatabase("readDesktop", { desktopId: desktop.id }));
    for (const id of stateContentIds(manifest)) retained.add(id);
  }
  await callDatabase("deleteDesktop", { desktopId });
  try {
    const directory = await getFilesDirectory();
    for (const id of stateContentIds(deleted)) if (!retained.has(id)) {
      await directory.removeEntry(id).catch(() => undefined);
      await removeContentCacheMarker(id);
    }
  } catch (error) { console.warn("Hiraya could not clean up deleted desktop content.", error); }
}

async function enqueueDesktopCreateUnsafe(nameValue: string) {
  await ensureLocalDatabase();
  const desktop = localDesktopIdentity(crypto.randomUUID(), normalizeDesktopName(nameValue));
  const registry = await callDatabase("listDesktops", undefined);
  if (registry.desktops.some((candidate) => candidate.name.toLocaleLowerCase() === desktop.name.toLocaleLowerCase())) throw new Error("A desktop with that name already exists.");
  const state = emptyDesktopState();
  const activeDesktopId = getActiveDesktopContext();
  if (activeDesktopId) {
    const active = parseDesktopState(await callDatabase("readDesktop", { desktopId: activeDesktopId }, activeDesktopId));
    state.sync.catalogId = active.sync.catalogId;
    state.sync.catalogRevision = active.sync.catalogRevision;
  }
  const reservation = await callDatabase("reserveOperation", undefined);
  return callDatabase("enqueueDesktopCreate", { operationId: reservation.operationId, catalogId: state.sync.catalogId, desktop, state });
}

async function enqueueDesktopRenameUnsafe(desktopId: string, nameValue: string, baseRevision: number) {
  const name = normalizeDesktopName(nameValue);
  const registry = await callDatabase("listDesktops", undefined);
  if (registry.desktops.some((candidate) => candidate.id !== desktopId && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A desktop with that name already exists.");
  const existing = registry.desktops.find((candidate) => candidate.id === desktopId);
  if (!existing) throw new Error("That desktop no longer exists.");
  const owner = parseDesktopState(await callDatabase("readDesktop", { desktopId: getActiveDesktopContext()! }, null));
  const reservation = await callDatabase("reserveOperation", undefined);
  return callDatabase("enqueueDesktopRename", { operationId: reservation.operationId, catalogId: owner.sync.catalogId, desktop: { ...existing, name }, baseRevision });
}

async function enqueueDesktopDeleteUnsafe(ownerDesktopId: string, desktopId: string, baseRevision: number) {
  const deleted = parseDesktopState(await callDatabase("readDesktop", { desktopId }, null));
  const owner = parseDesktopState(await callDatabase("readDesktop", { desktopId: ownerDesktopId }, null));
  const reservation = await callDatabase("reserveOperation", undefined);
  const result = await callDatabase("enqueueDesktopDelete", { operationId: reservation.operationId, catalogId: owner.sync.catalogId, ownerDesktopId, desktopId, baseRevision }, null);
  try {
    const retained = await retainedContentIdsUnsafe();
    const directory = await getFilesDirectory();
    for (const id of stateContentIds(deleted)) if (!retained.has(id)) {
      await directory.removeEntry(id).catch(() => undefined);
      await removeContentCacheMarker(id);
    }
  } catch (error) { console.warn("Hiraya could not clean up deleted desktop content.", error); }
  return result;
}

async function retainedContentIdsUnsafe() {
  const registry = await callDatabase("listDesktops", undefined, null);
  const retained = new Set<string>();
  for (const desktop of registry.desktops) {
    const manifest = parseDesktopState(await callDatabase("readDesktop", { desktopId: desktop.id }, null));
    for (const id of stateContentIds(manifest)) retained.add(id);
  }
  return retained;
}

async function pruneLocalDesktopsUnsafe(retainedDesktopIds: string[]) {
  const registry = await callDatabase("listDesktops", undefined, null);
  const retainedDesktops = new Set(retainedDesktopIds);
  const candidates: string[] = [];
  for (const desktop of registry.desktops) {
    if (retainedDesktops.has(desktop.id) || desktop.id === getActiveDesktopContext()) continue;
    const manifest = parseDesktopState(await callDatabase("readDesktop", { desktopId: desktop.id }, null));
    candidates.push(...stateContentIds(manifest));
  }
  await callDatabase("pruneDesktops", { retainedDesktopIds }, getActiveDesktopContext());
  const retainedFiles = await retainedContentIdsUnsafe();
  try {
    const directory = await getFilesDirectory();
    for (const id of candidates) if (!retainedFiles.has(id)) {
      await directory.removeEntry(id).catch(() => undefined);
      await removeContentCacheMarker(id);
    }
  } catch (error) { console.warn("Hiraya could not clean up stale desktop content.", error); }
}

async function readDesktopEntriesUnsafe(desktopId: string) {
  const manifest = parseDesktopState(await callDatabase("readDesktop", { desktopId }));
  return manifest.entries;
}

async function transferEntriesUnsafe(sourceDesktopId: string, destinationDesktopId: string, entryIds: string[], parentId: string | null) {
  const result = await callDatabase("transferEntries", { sourceDesktopId, destinationDesktopId, entryIds, parentId });
  const source = parseDesktopState(result.source);
  desktopLoad = Promise.resolve(source);
  return { entries: source.entries, layout: desktopStateLayout(source), editorSettings: source.editorSettings, appearance: source.appearance, sync: source.sync };
}

async function loadDesktopUnsafe(_viewport: EntryPosition, seeded: SeededManifest | null = null): Promise<DesktopStateSnapshot> {
  desktopLoad ??= readActiveDesktopState(seeded).catch((error) => {
    desktopLoad = null;
    throw error;
  });
  const manifest = await desktopLoad;
  await materializeOutbox(await callDatabase("readOutbox", undefined), true);
  return { entries: manifest.entries, layout: desktopStateLayout(manifest), editorSettings: manifest.editorSettings, appearance: manifest.appearance, sync: manifest.sync };
}

async function applyRemoteDesktopUnsafe(snapshot: DesktopStateSnapshot, contents: Map<string, Blob>, acknowledgedOperationId?: string, desktopId = getActiveDesktopContext(), force = false, useAcknowledgedContent = true, acknowledgedRevision?: number, removeAcknowledged = false) {
  if (!desktopId) throw new Error("No desktop is active.");
  const current = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  if (!force && current.sync.catalogId === snapshot.sync.catalogId && current.sync.catalogRevision >= snapshot.sync.catalogRevision) {
    return { entries: current.entries, layout: manifestLayout(current), editorSettings: current.editorSettings, appearance: current.appearance, sync: current.sync };
  }
  const next: Manifest = {
    entries: snapshot.entries,
    autoArrangeIcons: snapshot.layout.autoArrangeIcons,
    snapToGrid: snapshot.layout.snapToGrid,
    gridSize: snapshot.layout.gridSize,
    wallpaper: snapshot.layout.wallpaper,
    widgets: snapshot.layout.widgets,
    iconGroups: snapshot.layout.iconGroups,
    editorSettings: snapshot.editorSettings,
    appearance: snapshot.appearance,
    sync: snapshot.sync,
  };
  assertValidManifest(next);
  const acknowledgedRecord = acknowledgedOperationId && useAcknowledgedContent
    ? (await callDatabase("readOutbox", undefined, null)).find((record) => record.operationId === acknowledgedOperationId)
    : undefined;
  const acknowledgedOperation = acknowledgedRecord?.operation;
  const acknowledgedTheme = acknowledgedOperation?.kind === "install-theme-package" && acknowledgedOperation.wallpaperKind !== null
    ? next.appearance.customThemes.find((theme) => theme.id === acknowledgedOperation.theme.id && theme.wallpaper?.assetId === acknowledgedOperation.assetId)
    : undefined;
  const acknowledgedThemeContent = acknowledgedTheme?.wallpaper
    ? await readStagedContent(acknowledgedRecord!.operationId, acknowledgedTheme.wallpaper.assetId)
    : null;

  for (const entry of snapshot.entries) {
    if (entry.kind !== "file") continue;
    const changedContent = current.sync.catalogId !== snapshot.sync.catalogId || current.sync.contentRevisions[entry.id] !== snapshot.sync.contentRevisions[entry.id];
    if (!changedContent) continue;
    let content = contents.get(entry.id);
    if (!content && acknowledgedRecord && operationContentIds(acknowledgedRecord.operation).includes(entry.id)) {
      content = await readStagedContent(acknowledgedRecord.operationId, entry.id, acknowledgedRecord.operation.kind === "save-content" ? acknowledgedRecord.operation.stagedContentKey : undefined);
    }
    await removeContentCacheMarker(entry.id);
    if (!content) continue;
    if (content.size !== entry.size) throw new Error(`The server returned invalid contents for “${entry.name}”.`);
    await writeContent(entry.id, content.slice(0, content.size, entry.mimeType));
    // Reconciliation content can originate in the local outbox. Only direct
    // downloads accompanied by a verified server descriptor publish a cache marker.
  }
  const reconciled = await callDatabase("applyRemoteWithOutbox", { state: next, acknowledgedOperationId, acknowledgedRevision, removeAcknowledged }, desktopId);
  const projected = parseDesktopState(reconciled.state);
  if (desktopId === getActiveDesktopContext()) desktopLoad = Promise.resolve(projected);
  if (acknowledgedTheme?.wallpaper && acknowledgedThemeContent) {
    try { await cacheThemePackageUnsafe(desktopId, acknowledgedTheme.id, acknowledgedTheme.wallpaper, acknowledgedThemeContent); }
    catch (error) { console.warn("Hiraya could not retain the installed theme package locally.", error); }
  }
  await materializeOutbox(await callDatabase("readOutbox", undefined), true);

  const retained = await retainedContentIdsUnsafe();
  const directory = await getFilesDirectory();
  for (const id of stateContentIds(current)) {
    if (retained.has(id)) continue;
    try {
      await directory.removeEntry(id);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) console.warn("Hiraya could not clean up stale file content.", error);
    }
    await removeContentCacheMarker(id);
  }
  if (acknowledgedOperation?.kind === "install-theme-package" || acknowledgedOperation?.kind === "delete-theme") {
    await removeUnretainedCachedContent(retained);
  }
  return { entries: projected.entries, layout: manifestLayout(projected), editorSettings: projected.editorSettings, appearance: projected.appearance, sync: projected.sync };
}

async function resolveSatisfiedMutationUnsafe(snapshot: DesktopStateSnapshot, operationId: string, acknowledgedRevision: number, desktopId = getActiveDesktopContext()) {
  const resolved = await applyRemoteDesktopUnsafe(snapshot, new Map(), operationId, desktopId, true, false, acknowledgedRevision, true);
  await removeStagedOperation(operationId);
  return resolved;
}

async function enqueueMutationUnsafe(operation: OutboxOperation, contents: Map<string, Blob> = new Map()) {
  const reservation = await callDatabase("reserveOperation", undefined);
  const required = operationContentIds(operation);
  if (required.some((id) => !contents.has(id)) || contents.size !== required.length) throw new Error("Queued file content is incomplete.");
  await stageOperationContents(reservation.operationId, contents);
  let committed = false;
  try {
    if (operation.kind === "save-content" && operation.baseContentRevision !== undefined) {
      const desktopId = getActiveDesktopContext();
      const manifest = await readManifest();
      const records = await callDatabase("readOutbox", undefined, null);
      const prior = records.filter((record) => record.desktopId === desktopId && record.operation.kind === "save-content" && record.operation.entryId === operation.entryId).at(-1);
      let base = prior?.operation.kind === "save-content" && prior.operation.baseContentRevision !== undefined ? await readContentConflictBase(prior.operationId, prior.operation.baseContentRevision) : null;
      if (!base && manifest.sync.catalogId) {
        const marker = await readContentCacheMarker(operation.entryId);
        if (marker?.catalogId === manifest.sync.catalogId && marker.contentRevision === operation.baseContentRevision) {
          try {
            const stored = await (await (await getFilesDirectory()).getFileHandle(operation.entryId)).getFile();
            if (await contentMatchesCacheMarker(stored, marker)) base = stored;
          } catch (error) { if (!isNotFound(error)) throw error; }
        }
      }
      if (base) await writeContentConflictBase(reservation.operationId, operation.baseContentRevision, base);
    }
    const result = await callDatabase("enqueueMutation", {
      operationId: reservation.operationId,
      catalogId: (await readManifest()).sync.catalogId,
      operation,
    });
    committed = true;
    const manifest = parseDesktopState(result.state);
    desktopLoad = Promise.resolve(manifest);
    return {
      desktop: { entries: manifest.entries, layout: manifestLayout(manifest), editorSettings: manifest.editorSettings, appearance: manifest.appearance, sync: manifest.sync },
      record: result.record,
    };
  } catch (error) {
    if (!committed) await removeStagedOperation(reservation.operationId);
    throw error;
  }
}

async function resolveContentConflictKeepBothUnsafe(operationId: string, remote: DesktopStateSnapshot, sibling: FileEntry) {
  const selected = (await callDatabase("readOutbox", undefined, null)).find((record) => record.operationId === operationId);
  if (!selected || selected.operation.kind !== "save-content") throw new Error("That blocked content conflict no longer exists.");
  const content = await readStagedContent(operationId, selected.operation.entryId, selected.operation.stagedContentKey);
  const reservation = await callDatabase("reserveOperation", undefined, null);
  const operation: OutboxOperation = { schemaVersion: 1, kind: "create", entries: [sibling] };
  await stageOperationContents(reservation.operationId, new Map([[sibling.id, content]]));
  let committed = false;
  try {
    const state: Manifest = { entries: remote.entries, autoArrangeIcons: remote.layout.autoArrangeIcons, snapToGrid: remote.layout.snapToGrid, gridSize: remote.layout.gridSize, wallpaper: remote.layout.wallpaper, widgets: remote.layout.widgets, iconGroups: remote.layout.iconGroups, editorSettings: remote.editorSettings, appearance: remote.appearance, sync: remote.sync };
    const result = await callDatabase("resolveContentConflictKeepBoth", { operationId, replacementOperationId: reservation.operationId, state, operation }, selected.desktopId);
    committed = true;
    const projected = parseDesktopState(result.state);
    if (selected.desktopId === getActiveDesktopContext()) desktopLoad = Promise.resolve(projected);
    await removeStagedOperation(operationId);
    return { desktop: { entries: projected.entries, layout: manifestLayout(projected), editorSettings: projected.editorSettings, appearance: projected.appearance, sync: projected.sync }, record: result.record };
  } catch (error) {
    if (!committed) await removeStagedOperation(reservation.operationId);
    throw error;
  }
}

async function enqueueTransferUnsafe(sourceDesktopId: string, destinationDesktopId: string, entryIds: string[], parentId: string | null) {
  const reservation = await callDatabase("reserveOperation", undefined);
  const result = await callDatabase("enqueueTransfer", {
    operationId: reservation.operationId,
    catalogId: (await readManifest()).sync.catalogId,
    sourceDesktopId,
    destinationDesktopId,
    entryIds,
    parentId,
  });
  const manifest = parseDesktopState(result.state);
  desktopLoad = Promise.resolve(manifest);
  return {
    desktop: { entries: manifest.entries, layout: manifestLayout(manifest), editorSettings: manifest.editorSettings, appearance: manifest.appearance, sync: manifest.sync },
    record: result.record,
  };
}

async function acknowledgeMutationUnsafe(operationId: string) {
  await callDatabase("acknowledgeMutation", { operationId });
  await removeStagedOperation(operationId);
}

async function discardDesktopProjectionUnsafe(desktopId: string, operationId: string) {
  const result = await callDatabase("discardDesktopProjection", { desktopId, operationId }, null);
  for (const id of result.operationIds) await removeStagedOperation(id);
  try {
    const directory = await getFilesDirectory();
    for (const id of result.fileIds) {
      await directory.removeEntry(id).catch(() => undefined);
      await removeContentCacheMarker(id);
    }
  } catch (error) { console.warn("Hiraya could not clean up discarded desktop content.", error); }
  return result;
}

async function saveEditorSettingsUnsafe(settings: EditorSettings) {
  const manifest = { ...await readManifest(), editorSettings: settings };
  assertValidManifest(manifest);
  await writeManifest(manifest, activityRecord("Changed editor settings", [
    `Auto-save: ${settings.autoSave ? "On" : "Off"}`,
    `Font size: ${settings.fontSize}`,
    `Language: ${settings.language}`,
  ]));
}

async function saveDesktopLayoutUnsafe(layout: DesktopLayout) {
  const manifest = await readManifest();
  const parsed = parseLayout(layout);
  const next = { ...manifest, autoArrangeIcons: parsed.autoArrangeIcons, snapToGrid: parsed.snapToGrid, gridSize: parsed.gridSize, wallpaper: parsed.wallpaper, widgets: parsed.widgets, iconGroups: parsed.iconGroups };
  assertValidManifest(next);
  await writeManifest(next, activityRecord("Changed desktop layout", [
    `Auto-arrange icons: ${parsed.autoArrangeIcons ? "On" : "Off"}`,
    `Snap to grid: ${parsed.snapToGrid ? "On" : "Off"}`,
    `Grid size: ${parsed.gridSize}px`,
    `Wallpaper: ${parsed.wallpaper.source}`,
  ]));
}

async function selectThemeUnsafe(themeId: string) {
  const manifest = await readManifest();
  const appearance = parseThemeState({ ...manifest.appearance, selectedThemeId: themeId });
  await writeManifest({ ...manifest, appearance }, activityRecord("Selected theme", [`Theme: ${appearance.selectedThemeId}`]));
  return appearance;
}

async function saveCustomThemeUnsafe(value: CustomTheme) {
  const manifest = await readManifest();
  const theme = parseCustomTheme(value);
  const exists = manifest.appearance.customThemes.some((item) => item.id === theme.id);
  const customThemes = exists
    ? manifest.appearance.customThemes.map((item) => item.id === theme.id ? theme : item)
    : [...manifest.appearance.customThemes, theme];
  const appearance = parseThemeState({ ...manifest.appearance, customThemes });
  await writeManifest({ ...manifest, appearance }, activityRecord(exists ? "Updated custom theme" : "Created custom theme", [`Theme: ${theme.name}`, `Theme ID: ${theme.id}`]));
  return theme;
}

async function deleteCustomThemeUnsafe(themeId: string) {
  const manifest = await readManifest();
  const next = applyThemeDelete(manifest, themeId);
  const deleted = manifest.appearance.customThemes.find((theme) => theme.id === themeId)!;
  await writeManifest(next, activityRecord("Deleted custom theme", [`Theme: ${deleted.name}`, `Theme ID: ${themeId}`]));
  return next.appearance;
}

function applyThemeDelete(manifest: Manifest, themeId: string) {
  // Keep local and queued mutation semantics identical.
  return parseManifestV13((() => {
    if (!manifest.appearance.customThemes.some((theme) => theme.id === themeId)) throw new Error("That custom theme no longer exists.");
    const customThemes = manifest.appearance.customThemes.filter((theme) => theme.id !== themeId);
    const selectedThemeId = manifest.appearance.selectedThemeId === themeId ? DEFAULT_THEME_STATE.selectedThemeId : manifest.appearance.selectedThemeId;
    return { ...manifest, appearance: parseThemeState({ selectedThemeId, customThemes }) };
  })());
}

async function createTextFileUnsafe(nameValue: string, parentId: string | null, position: EntryPosition) {
  const name = validateEntryName(nameValue);
  const manifest = await readManifest();
  findParent(manifest.entries, parentId);
  assertUniqueName(manifest.entries, name, parentId);

  const now = Date.now();
  const file: FileEntry = {
    kind: "file",
    id: crypto.randomUUID(),
    name,
    parentId,
    mimeType: "text/plain",
    size: 0,
    createdAt: now,
    modifiedAt: now,
    position: parsePosition(position),
  };
  await writeContent(file.id, "");
  try {
    await writeManifest({ ...manifest, entries: [...manifest.entries, file] }, activityRecord("Created file", [`File: ${file.name}`, locationDetail(manifest.entries, parentId)]));
  } catch (error) {
    try { await (await getFilesDirectory()).removeEntry(file.id); } catch { /* best-effort orphan cleanup */ }
    throw error;
  }
  return file;
}

async function createFileUnsafe(nameValue: string, parentId: string | null, position: EntryPosition, content: Blob, mimeType?: string) {
  const name = validateEntryName(nameValue);
  const manifest = await readManifest();
  findParent(manifest.entries, parentId);
  assertUniqueName(manifest.entries, name, parentId);
  const now = Date.now();
  const file: FileEntry = {
    kind: "file",
    id: crypto.randomUUID(),
    name,
    parentId,
    mimeType: mimeType ?? (content.type || "application/octet-stream"),
    size: content.size,
    createdAt: now,
    modifiedAt: now,
    position: parsePosition(position),
  };
  const next = { ...manifest, entries: [...manifest.entries, file] };
  assertValidManifest(next);
  await writeContent(file.id, content.slice(0, content.size, file.mimeType));
  try {
    await writeManifest(next, activityRecord("Created file", [`File: ${file.name}`, `Size: ${file.size} bytes`, locationDetail(manifest.entries, parentId)]));
  } catch (error) {
    try { await (await getFilesDirectory()).removeEntry(file.id); } catch { /* best-effort rollback */ }
    throw error;
  }
  return file;
}

async function createFolderUnsafe(nameValue: string, parentId: string | null, position: EntryPosition) {
  const name = validateEntryName(nameValue);
  const manifest = await readManifest();
  findParent(manifest.entries, parentId);
  assertUniqueName(manifest.entries, name, parentId);

  const now = Date.now();
  const folder: FolderEntry = {
    kind: "folder",
    id: crypto.randomUUID(),
    name,
    parentId,
    createdAt: now,
    modifiedAt: now,
    position: parsePosition(position),
  };
  await writeManifest({ ...manifest, entries: [...manifest.entries, folder] }, activityRecord("Created folder", [`Folder: ${folder.name}`, locationDetail(manifest.entries, parentId)]));
  return folder;
}

async function importFilesUnsafe(
  files: File[],
  parentId: string | null,
  positions: EntryPosition[],
): Promise<FileEntry[]> {
  if (files.length !== positions.length) throw new Error("Each imported file needs a desktop position.");
  const parsedPositions = positions.map(parsePosition);
  const manifest = await readManifest();
  findParent(manifest.entries, parentId);
  const names = files.map((file) => validateEntryName(file.name));

  for (const [index, name] of names.entries()) {
    assertUniqueName(manifest.entries, name, parentId);
    if (names.slice(0, index).some((candidate) => namesMatch(candidate, name))) {
      throw new Error(`The upload contains more than one file named “${name}”.`);
    }
  }

  const createdAt = Date.now();
  const imported: FileEntry[] = files.map((source, index) => ({
    kind: "file",
    id: crypto.randomUUID(),
    name: names[index],
    parentId,
    mimeType: importedFileMimeType(source),
    size: source.size,
    createdAt,
    modifiedAt: source.lastModified || createdAt,
    position: parsedPositions[index],
  }));
  const written: string[] = [];
  try {
    for (const [index, file] of imported.entries()) { await writeContent(file.id, files[index]); written.push(file.id); }
    await writeManifest({
      ...manifest,
      entries: [...manifest.entries, ...imported],
    }, activityRecord(imported.length === 1 ? "Imported file" : "Imported files", [...activityDetails(imported), locationDetail(manifest.entries, parentId)]));
  } catch (error) {
    try { const directory = await getFilesDirectory(); for (const id of written) await directory.removeEntry(id).catch(() => undefined); } catch { /* best-effort orphan cleanup */ }
    throw error;
  }
  return imported;
}

async function createEntriesUnsafe(entries: DesktopEntry[], contents: Map<string, Blob>) {
  const manifest = await readManifest();
  const next = { ...manifest, entries: [...manifest.entries, ...entries] };
  assertValidManifest(next);
  const files = entries.filter((entry): entry is FileEntry => entry.kind === "file");
  if (contents.size !== files.length || files.some((entry) => contents.get(entry.id)?.size !== entry.size)) throw new Error("Copied file content is incomplete.");
  const written: string[] = [];
  try {
    for (const entry of files) {
      await writeContent(entry.id, contents.get(entry.id)!);
      written.push(entry.id);
    }
    await writeManifest(next, activityRecord(entries.length === 1 ? "Pasted item" : "Pasted items", activityDetails(entries)));
  } catch (error) {
    try {
      const directory = await getFilesDirectory();
      for (const id of written) await directory.removeEntry(id).catch(() => undefined);
    } catch { /* best-effort rollback */ }
    throw error;
  }
  return entries;
}

async function renameEntryUnsafe(id: string, nameValue: string) {
  const name = validateEntryName(nameValue);
  const manifest = await readManifest();
  const existing = getEntry(manifest.entries, id);
  assertUniqueName(manifest.entries, name, existing.parentId, id);
  const renamed: DesktopEntry = { ...existing, name, modifiedAt: Date.now() };
  await writeManifest({
    ...manifest,
    entries: manifest.entries.map((entry) => (entry.id === id ? renamed : entry)),
  }, activityRecord(`Renamed ${existing.kind}`, [`From: ${existing.name}`, `To: ${renamed.name}`]));
  return renamed;
}

async function deleteEntryUnsafe(id: string): Promise<DesktopEntry[]> {
  const manifest = await readManifest();
  getEntry(manifest.entries, id);
  const deletedIds = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of manifest.entries) {
      if (entry.parentId !== null && deletedIds.has(entry.parentId) && !deletedIds.has(entry.id)) {
        deletedIds.add(entry.id);
        changed = true;
      }
    }
  }
  const deleted = manifest.entries.filter((entry) => deletedIds.has(entry.id));
  const entries = manifest.entries.filter((entry) => !deletedIds.has(entry.id));
  // Remove visible metadata first; failed blob cleanup can then only leave invisible orphans.
  await writeManifest({
    ...manifest,
    entries,
    wallpaper: wallpaperAfterEntryRemoval(entries, manifest.wallpaper),
    iconGroups: iconGroupsAfterEntryChange(entries, manifest.iconGroups),
  }, activityRecord(deleted.length === 1 ? `Deleted ${deleted[0].kind}` : "Deleted items", activityDetails(deleted)));
  try {
    const directory = await getFilesDirectory();
    for (const entry of deleted) {
      if (entry.kind !== "file") continue;
      try {
        await directory.removeEntry(entry.id);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) {
          console.warn("Hiraya could not clean up deleted file content.", error);
        }
      }
    }
  } catch (error) {
    console.warn("Hiraya could not clean up deleted file content.", error);
  }
  return deleted;
}

async function deleteEntriesUnsafe(ids: string[]): Promise<DesktopEntry[]> {
  if (!ids.length) return [];
  const manifest = await readManifest();
  const selected = new Set(ids);
  if (selected.size !== ids.length || ids.some((id) => !manifest.entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
  const deletedIds = new Set(ids);
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of manifest.entries) if (entry.parentId && deletedIds.has(entry.parentId) && !deletedIds.has(entry.id)) {
      deletedIds.add(entry.id);
      changed = true;
    }
  }
  const deleted = manifest.entries.filter((entry) => deletedIds.has(entry.id));
  const entries = manifest.entries.filter((entry) => !deletedIds.has(entry.id));
  await writeManifest(
    {
      ...manifest,
      entries,
      wallpaper: wallpaperAfterEntryRemoval(entries, manifest.wallpaper),
      iconGroups: iconGroupsAfterEntryChange(entries, manifest.iconGroups),
    },
    activityRecord(deleted.length === 1 ? `Deleted ${deleted[0].kind}` : "Deleted items", activityDetails(deleted)),
  );
  try {
    const directory = await getFilesDirectory();
    for (const entry of deleted) if (entry.kind === "file") await directory.removeEntry(entry.id).catch(() => undefined);
  } catch (error) { console.warn("Hiraya could not clean up deleted file content.", error); }
  return deleted;
}

async function moveEntryUnsafe(id: string, parentId: string | null, position: EntryPosition) {
  const manifest = await readManifest();
  const existing = getEntry(manifest.entries, id);
  findParent(manifest.entries, parentId);
  if (id === parentId) throw new Error("An entry cannot be moved into itself.");

  let ancestorId = parentId;
  while (ancestorId !== null) {
    if (ancestorId === id) throw new Error("A folder cannot be moved into one of its descendants.");
    ancestorId = getEntry(manifest.entries, ancestorId).parentId;
  }
  assertUniqueName(manifest.entries, existing.name, parentId, id);

  const moved: DesktopEntry = { ...existing, parentId, position: parsePosition(position), modifiedAt: Date.now() };
  const entries = manifest.entries.map((entry) => (entry.id === id ? moved : entry));
  await writeManifest({
    ...manifest,
    entries,
    iconGroups: iconGroupsAfterEntryChange(entries, manifest.iconGroups),
  }, activityRecord(`Moved ${existing.kind}`, [`${existing.kind === "file" ? "File" : "Folder"}: ${existing.name}`, locationDetail(manifest.entries, parentId)]));
  return moved;
}

async function moveEntriesUnsafe(ids: string[], parentId: string | null) {
  const manifest = await readManifest();
  findParent(manifest.entries, parentId);
  const moving = new Set(ids);
  if (!ids.length || moving.size !== ids.length || ids.some((id) => !manifest.entries.some((entry) => entry.id === id))) throw new Error("An entry no longer exists.");
  const modifiedAt = Date.now();
  const entries = manifest.entries.map((entry) => moving.has(entry.id) ? { ...entry, parentId, modifiedAt } : entry);
  const next: Manifest = { ...manifest, entries, iconGroups: iconGroupsAfterEntryChange(entries, manifest.iconGroups) };
  assertValidManifest(next);
  const moved = next.entries.filter((entry) => moving.has(entry.id));
  await writeManifest(next, activityRecord(moved.length === 1 ? `Moved ${moved[0].kind}` : "Moved items", [...activityDetails(moved), locationDetail(manifest.entries, parentId)]));
  return moved;
}

async function updateRootEntryPositionsUnsafe(positionValues: RootEntryPositionUpdate[]) {
  const manifest = await readManifest();
  const positions = parseRootEntryPositionUpdates(positionValues, manifest.entries);
  const byId = new Map(positions.map(({ entryId, position }) => [entryId, position]));
  const next: Manifest = {
    ...manifest,
    entries: manifest.entries.map((entry) => byId.has(entry.id) ? { ...entry, position: byId.get(entry.id)! } : entry),
  };
  assertValidManifest(next);
  const moved = positions.map(({ entryId }) => getEntry(next.entries, entryId));
  await writeManifest(next, activityRecord(moved.length === 1 ? "Moved desktop item" : "Arranged desktop items", activityDetails(moved)));
  return moved;
}

async function updateEntryPositionUnsafe(id: string, position: EntryPosition) {
  const manifest = await readManifest();
  const existing = getEntry(manifest.entries, id);
  const updated: DesktopEntry = { ...existing, position: parsePosition(position) };
  await writeManifest({
    ...manifest,
    entries: manifest.entries.map((entry) => (entry.id === id ? updated : entry)),
  }, activityRecord("Moved desktop item", activityDetails([updated])));
  return updated;
}

async function readFileUnsafe(id: FileEntry["id"]): Promise<File> {
  const manifest = await readManifest();
  const entry = getFileEntry(manifest.entries, id);
  const pending = (await callDatabase("readOutbox", undefined, null)).filter((record) => operationContentIds(record.operation).includes(id)).at(-1);
  if (pending) {
    const stored = await readStagedContent(pending.operationId, id, pending.operation.kind === "save-content" ? pending.operation.stagedContentKey : undefined);
    return new File([stored], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
  }
  const directory = await getFilesDirectory();
  const handle = await directory.getFileHandle(id);
  const stored = await handle.getFile();
  return new File([stored], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
}

async function readCachedFileUnsafe(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision?: number): Promise<File | null> {
  const manifest = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  const entry = getFileEntry(manifest.entries, id);
  const pendingContent = (await callDatabase("readOutbox", undefined, null)).filter((record) =>
    record.desktopId === desktopId && operationContentIds(record.operation).includes(id)).at(-1);
  const hasPendingContent = pendingContent !== undefined;
  let marker = null as Awaited<ReturnType<typeof readContentCacheMarker>>;
  if (!hasPendingContent) {
    marker = await readContentCacheMarker(id);
    if (!marker || marker.catalogId !== catalogId || marker.contentRevision !== contentRevision || marker.size !== entry.size) return null;
  }
  try {
    const stored = pendingContent ? await readStagedContent(pendingContent.operationId, id, pendingContent.operation.kind === "save-content" ? pendingContent.operation.stagedContentKey : undefined) : await (await (await getFilesDirectory()).getFileHandle(id)).getFile();
    if (stored.size !== entry.size) {
      if (!hasPendingContent) await removeContentCacheMarker(id);
      return null;
    }
    // Strong revalidation policy: hash every persistent remote-cache read. This
    // catches same-size OPFS corruption both online and offline.
    if (!hasPendingContent && marker && !await contentMatchesCacheMarker(stored, marker)) {
      await removeContentCacheMarker(id);
      return null;
    }
    return new File([stored], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
  } catch (error) {
    if (isNotFound(error)) {
      if (!hasPendingContent) await removeContentCacheMarker(id);
      return null;
    }
    throw error;
  }
}

function matchesThemePackage(state: Manifest, themeId: string, expected: ThemeWallpaperPackage) {
  const wallpaper = state.appearance.customThemes.find((theme) => theme.id === themeId)?.wallpaper;
  return wallpaper?.assetId === expected.assetId
    && wallpaper.kind === expected.kind
    && wallpaper.size === expected.size
    && wallpaper.sha256 === expected.sha256
    && wallpaper.revision === expected.revision;
}

async function readCachedThemePackageUnsafe(desktopId: string, themeId: string, expected: ThemeWallpaperPackage): Promise<Blob | null> {
  const manifest = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  if (!manifest.sync.catalogId || !matchesThemePackage(manifest, themeId, expected)) return null;
  const marker = await readContentCacheMarker(expected.assetId);
  if (!marker || marker.catalogId !== manifest.sync.catalogId || marker.contentRevision !== expected.revision || marker.size !== expected.size || marker.sha256 !== expected.sha256) return null;
  try {
    const stored = await (await (await getFilesDirectory()).getFileHandle(expected.assetId)).getFile();
    if (!await contentMatchesCacheMarker(stored, marker)) {
      await removeContentCacheMarker(expected.assetId);
      return null;
    }
    return stored;
  } catch (error) {
    if (isNotFound(error)) {
      await removeContentCacheMarker(expected.assetId);
      return null;
    }
    throw error;
  }
}

async function cacheThemePackageUnsafe(desktopId: string, themeId: string, expected: ThemeWallpaperPackage, content: Blob) {
  const manifest = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  if (!manifest.sync.catalogId || !matchesThemePackage(manifest, themeId, expected)) return false;
  const marker = { catalogId: manifest.sync.catalogId, contentRevision: expected.revision, size: expected.size, sha256: expected.sha256 };
  if (!await contentMatchesCacheMarker(content, marker)) throw new Error("The theme package failed local cache verification.");
  await writeContent(expected.assetId, content);
  await writeContentCacheMarker(expected.assetId, marker);
  return true;
}

async function cacheRemoteFileUnsafe(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision: number, sha256: string, content: Blob): Promise<File | null> {
  const manifest = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  const entry = manifest.entries.find((candidate): candidate is FileEntry => candidate.id === id && candidate.kind === "file");
  if (!entry || manifest.sync.catalogId !== catalogId || manifest.sync.contentRevisions[id] !== contentRevision) return null;
  const hasPendingContent = (await callDatabase("readOutbox", undefined, null)).some((record) =>
    record.desktopId === desktopId && operationContentIds(record.operation).includes(id));
  if (hasPendingContent) return readCachedFileUnsafe(desktopId, catalogId, id, contentRevision);
  if (content.size !== entry.size) throw new Error(`The server contents of “${entry.name}” have an unexpected size.`);
  if (!/^[a-f0-9]{64}$/.test(sha256) || await sha256Blob(content) !== sha256) throw new Error(`The server contents of “${entry.name}” failed integrity verification.`);
  const stored = content.slice(0, content.size, entry.mimeType);
  await writeContent(id, stored);
  await writeContentCacheMarker(id, { catalogId, contentRevision, size: entry.size, sha256 });
  return new File([stored], entry.name, { type: entry.mimeType, lastModified: entry.modifiedAt });
}

async function removeCachedFileUnsafe(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision: number) {
  const manifest = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  const entry = getFileEntry(manifest.entries, id);
  if (manifest.sync.catalogId !== catalogId || manifest.sync.contentRevisions[id] !== contentRevision) return false;
  const protectedIds = await globallyProtectedFileIdsUnsafe(await callDatabase("readOutbox", undefined, null));
  if (protectedIds.has(id)) throw new Error("Pending file content cannot be removed from offline storage.");
  const marker = await readContentCacheMarker(id);
  if (!marker || marker.catalogId !== catalogId || marker.contentRevision !== contentRevision || marker.size !== entry.size) return false;

  // Remove availability first so interrupted cleanup cannot leave an unverified cache hit.
  await removeContentCacheMarker(id);
  try {
    await (await getFilesDirectory()).removeEntry(id);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  return true;
}

async function loadOfflineInventoryUnsafe(desktopId: string): Promise<OfflineStorageInventory> {
  const manifest = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  const outbox = await callDatabase("readOutbox", undefined, null);
  const pendingIds = new Set(outbox.filter((record) => record.status === "pending").flatMap((record) => operationContentIds(record.operation)));
  const globallyProtectedIds = await globallyProtectedFileIdsUnsafe(outbox);
  const authoritativeLocal = FRONTEND_ONLY || manifest.sync.catalogId === null;
  const files: OfflineStorageInventory["files"] = {};
  let cachedBytes = 0;
  let protectedBytes = 0;
  let releasableBytes = 0;
  const directory = await getFilesDirectory();

  for (const entry of manifest.entries) {
    if (entry.kind !== "file") continue;
    const pending = pendingIds.has(entry.id);
    const protectedContent = authoritativeLocal || globallyProtectedIds.has(entry.id);
    let storedSize: number | null = null;
    try { storedSize = (await (await directory.getFileHandle(entry.id)).getFile()).size; }
    catch (error) { if (!isNotFound(error)) throw error; }
    if (protectedContent) {
      const available = storedSize === entry.size;
      files[entry.id] = { cached: available, cachedBytes: 0, storedBytes: storedSize ?? 0, pending, protected: true };
      if (available) protectedBytes += entry.size;
      continue;
    }
    const marker = await readContentCacheMarker(entry.id);
    const revision = manifest.sync.contentRevisions[entry.id];
    const valid = marker !== null && marker.catalogId === manifest.sync.catalogId && marker.contentRevision === revision && marker.size === entry.size && storedSize === entry.size;
    files[entry.id] = { cached: valid, cachedBytes: valid ? entry.size : 0, storedBytes: storedSize ?? 0, pending: false, protected: false };
    if (valid) cachedBytes += entry.size;
    if (storedSize !== null) releasableBytes += storedSize;
  }
  let browserStorage: OfflineStorageInventory["browserStorage"] = null;
  try {
    const estimate = await estimateStorage();
    if (Number.isFinite(estimate.usage) && Number.isFinite(estimate.quota)) browserStorage = { usage: estimate.usage!, quota: estimate.quota! };
  } catch { /* Browser-wide storage estimates are optional. */ }
  return { desktopId, authoritativeLocal, files, cachedBytes, protectedBytes, releasableBytes, browserStorage };
}

async function releaseOfflineCopiesUnsafe(desktopId: string, rootIds?: string[]) {
  const manifest = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  const inventory = await loadOfflineInventoryUnsafe(desktopId);
  const candidates = rootIds ? offlineFilesUnderRoots(manifest.entries, rootIds) : manifest.entries.filter((entry): entry is FileEntry => entry.kind === "file");
  let releasedBytes = 0;
  let releasedFiles = 0;
  let skippedFiles = 0;
  const directory = await getFilesDirectory();
  for (const file of candidates) {
    const stored = inventory.files[file.id];
    if (!stored?.storedBytes) continue;
    if (stored.protected) { skippedFiles += 1; continue; }
    await removeContentCacheMarker(file.id);
    try { await directory.removeEntry(file.id); } catch (error) { if (!isNotFound(error)) throw error; }
    releasedBytes += stored.storedBytes;
    releasedFiles += 1;
  }
  return { releasedBytes, releasedFiles, skippedFiles };
}

async function readDesktopStateUnsafe(desktopId: string): Promise<DesktopStateSnapshot> {
  const manifest = parseManifestV13(await callDatabase("readDesktop", { desktopId }, null));
  return { entries: manifest.entries, layout: manifestLayout(manifest), editorSettings: manifest.editorSettings, appearance: manifest.appearance, sync: manifest.sync };
}

async function resolveFileByRelativePathUnsafe(
  fromFileId: FileEntry["id"],
  relativePath: string,
): Promise<FileEntry> {
  const manifest = await readManifest();
  const source = getFileEntry(manifest.entries, fromFileId);
  const path = relativePath.split(/[?#]/, 1)[0];
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error("That link is not a local relative file path.");
  }

  let parentId = source.parentId;
  let resolved: DesktopEntry | undefined;
  const encodedSegments = path.split("/");
  for (const [index, encodedSegment] of encodedSegments.entries()) {
    let segment: string;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch {
      throw new Error("That link contains invalid URL encoding.");
    }
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parentId === null) throw new Error("That link points outside the desktop.");
      const parent = getEntry(manifest.entries, parentId);
      parentId = parent.parentId;
      resolved = undefined;
      continue;
    }
    if (segment.includes("/") || segment.includes("\\") || [...segment].some((character) => character.charCodeAt(0) < 32)) {
      throw new Error("That link contains an invalid file name.");
    }
    resolved = manifest.entries.find(
      (entry) => entry.parentId === parentId && entry.name.localeCompare(segment, undefined, { sensitivity: "accent" }) === 0,
    );
    if (!resolved) throw new Error(`No local file exists at “${relativePath}”.`);
    if (index < encodedSegments.length - 1 && resolved.kind !== "folder") {
      throw new Error(`No local file exists at “${relativePath}”.`);
    }
    parentId = resolved.kind === "folder" ? resolved.id : resolved.parentId;
  }

  if (!resolved || resolved.kind !== "file") throw new Error(`No local file exists at “${relativePath}”.`);
  return resolved;
}

async function saveFileUnsafe(id: FileEntry["id"], content: Blob, options: SaveFileOptions = {}): Promise<FileEntry> {
  const manifest = await readManifest();
  const existing = getFileEntry(manifest.entries, id);
  const actualRevision = manifest.sync.contentRevisions[id] ?? 0;
  if (options.expectedContentRevision !== undefined && options.expectedContentRevision !== actualRevision) {
    throw new ContentRevisionConflictError(options.expectedContentRevision, actualRevision);
  }
  const saved: FileEntry = {
    ...existing,
    mimeType: options.mimeType ?? existing.mimeType,
    size: content.size,
    // Recovery distinguishes committed metadata from the previous row even
    // for same-size saves performed within one clock millisecond.
    modifiedAt: Math.max(Date.now(), existing.modifiedAt + 1),
  };
  const next = { ...manifest, entries: manifest.entries.map((entry) => (entry.id === id ? saved : entry)) };
  assertValidManifest(next);
  const desktopId = getActiveDesktopContext();
  if (!desktopId) throw new Error("No desktop is active.");
  const prepared = await prepareLocalContentReplacement(desktopId, id, { mimeType: saved.mimeType, size: saved.size, modifiedAt: saved.modifiedAt }, content.slice(0, content.size, saved.mimeType));
  await publishLocalContentReplacement(prepared, () => writeManifest(next, activityRecord("Edited file", [`File: ${saved.name}`, `Size: ${saved.size} bytes`])));
  return saved;
}

async function saveTextFileUnsafe(id: FileEntry["id"], content: string): Promise<FileEntry> {
  return saveFileUnsafe(id, new Blob([content]));
}

export function loadDesktop(viewport: EntryPosition, seeded: SeededManifest | null = null) {
  return serializeStorage(() => loadDesktopUnsafe(viewport, seeded));
}

export function readCurrentDesktop(): Promise<DesktopStateSnapshot> {
  return serializeStorage(async () => {
    const manifest = await readManifest();
    return { entries: manifest.entries, layout: manifestLayout(manifest), editorSettings: manifest.editorSettings, appearance: manifest.appearance, sync: manifest.sync };
  });
}

export function applyRemoteDesktop(snapshot: DesktopStateSnapshot, contents: Map<string, Blob>, acknowledgedOperationId?: string, desktopId?: string, force = false, useAcknowledgedContent = true, acknowledgedRevision?: number) {
  return serializeStorage(() => applyRemoteDesktopUnsafe(snapshot, contents, acknowledgedOperationId, desktopId, force, useAcknowledgedContent, acknowledgedRevision));
}

export function saveEditorSettings(settings: EditorSettings) { return serializeStorage(() => saveEditorSettingsUnsafe(settings)); }
export function saveDesktopLayout(layout: DesktopLayout) { return serializeStorage(() => saveDesktopLayoutUnsafe(layout)); }
export function selectTheme(themeId: string) { return serializeStorage(() => selectThemeUnsafe(themeId)); }
export function saveCustomTheme(theme: CustomTheme) { return serializeStorage(() => saveCustomThemeUnsafe(theme)); }
export function deleteCustomTheme(themeId: string) { return serializeStorage(() => deleteCustomThemeUnsafe(themeId)); }
export function createTextFile(name: string, parentId: string | null, position: EntryPosition) { return serializeStorage(() => createTextFileUnsafe(name, parentId, position)); }
export function createFile(name: string, parentId: string | null, position: EntryPosition, content: Blob, mimeType?: string) { return serializeStorage(() => createFileUnsafe(name, parentId, position, content, mimeType)); }
export function createFolder(name: string, parentId: string | null, position: EntryPosition) { return serializeStorage(() => createFolderUnsafe(name, parentId, position)); }
export function importFiles(files: File[], parentId: string | null, positions: EntryPosition[]) { return serializeStorage(() => importFilesUnsafe(files, parentId, positions)); }
export function createEntries(entries: DesktopEntry[], contents: Map<string, Blob>) { return serializeStorage(() => createEntriesUnsafe(entries, contents)); }
export function renameEntry(id: string, name: string) { return serializeStorage(() => renameEntryUnsafe(id, name)); }
export function deleteEntry(id: string) { return serializeStorage(() => deleteEntryUnsafe(id)); }
export function deleteEntries(ids: string[]) { return serializeStorage(() => deleteEntriesUnsafe(ids)); }
export function moveEntry(id: string, parentId: string | null, position: EntryPosition) { return serializeStorage(() => moveEntryUnsafe(id, parentId, position)); }
export function moveEntries(ids: string[], parentId: string | null) { return serializeStorage(() => moveEntriesUnsafe(ids, parentId)); }
export function updateRootEntryPositions(positions: RootEntryPositionUpdate[]) { return serializeStorage(() => updateRootEntryPositionsUnsafe(positions)); }
export function updateEntryPosition(id: string, position: EntryPosition) { return serializeStorage(() => updateEntryPositionUnsafe(id, position)); }
export function readFile(id: FileEntry["id"]) { return serializeStorage(() => readFileUnsafe(id)); }
export function readCachedFile(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision: number) { return serializeStorage(() => readCachedFileUnsafe(desktopId, catalogId, id, contentRevision)); }
export function cacheRemoteFile(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision: number, sha256: string, content: Blob) { return serializeStorage(() => cacheRemoteFileUnsafe(desktopId, catalogId, id, contentRevision, sha256, content)); }
export function removeCachedFile(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision: number) { return serializeStorage(() => removeCachedFileUnsafe(desktopId, catalogId, id, contentRevision)); }
export function readCachedThemePackage(desktopId: string, themeId: string, expected: ThemeWallpaperPackage) { return serializeStorage(() => readCachedThemePackageUnsafe(desktopId, themeId, expected)); }
export function cacheThemePackage(desktopId: string, themeId: string, expected: ThemeWallpaperPackage, content: Blob) { return serializeStorage(() => cacheThemePackageUnsafe(desktopId, themeId, expected, content)); }
export function loadOfflineInventory(desktopId: string) { return serializeStorage(() => loadOfflineInventoryUnsafe(desktopId)); }
export function releaseOfflineCopies(desktopId: string, rootIds?: string[]) { return serializeStorage(() => releaseOfflineCopiesUnsafe(desktopId, rootIds)); }
export function readDesktopState(desktopId: string) { return serializeStorage(() => readDesktopStateUnsafe(desktopId)); }
export function resolveFileByRelativePath(fromFileId: FileEntry["id"], relativePath: string) { return serializeStorage(() => resolveFileByRelativePathUnsafe(fromFileId, relativePath)); }
export function saveTextFile(id: FileEntry["id"], content: string) { return serializeStorage(() => saveTextFileUnsafe(id, content)); }
export function saveFile(id: FileEntry["id"], content: Blob, options?: SaveFileOptions) { return serializeStorage(() => saveFileUnsafe(id, content, options)); }
export function readLocalPreferences() { return serializeStorage(() => repositories.readPreferences()); }
export function saveLocalPreferences(preferences: LocalPreferences) { return serializeStorage(() => repositories.savePreferences(preferences)); }
export function listDesktops(seeded: SeededManifest | null = null) { return serializeStorage(() => listDesktopsUnsafe(seeded)); }
export function createDesktop(name: string) { return serializeStorage(() => createDesktopUnsafe(name)); }
export function createOfflineDesktop(name: string) { return serializeStorage(() => createOfflineDesktopUnsafe(name)); }
export function ensureDesktop(desktop: DesktopIdentity) { return serializeStorage(() => ensureDesktopUnsafe(desktop)); }
export function renameDesktop(desktopId: string, name: string) { return serializeStorage(() => renameDesktopUnsafe(desktopId, name)); }
export function deleteDesktop(desktopId: string) { return serializeStorage(() => deleteDesktopUnsafe(desktopId)); }
export function switchDesktop(desktopId: string) { return serializeStorage(() => switchDesktopUnsafe(desktopId)); }
export function pruneLocalDesktops(retainedDesktopIds: string[]) { return serializeStorage(() => pruneLocalDesktopsUnsafe(retainedDesktopIds)); }
export function readDesktopEntries(desktopId: string) { return serializeStorage(() => readDesktopEntriesUnsafe(desktopId)); }
export function transferEntries(sourceDesktopId: string, destinationDesktopId: string, entryIds: string[], parentId: string | null) { return serializeStorage(() => transferEntriesUnsafe(sourceDesktopId, destinationDesktopId, entryIds, parentId)); }
export function readWindowSession(desktopId: string) { return serializeStorage(() => repositories.readWindowSession(desktopId)); }
export function saveWindowSession(desktopId: string, session: WindowSession) { return serializeStorage(() => repositories.saveWindowSession(desktopId, session)); }
export function enqueueMutation(operation: OutboxOperation | ((current: DesktopStateSnapshot) => OutboxOperation), contents?: Map<string, Blob>) {
  return serializeStorage(async () => {
    if (typeof operation !== "function") return enqueueMutationUnsafe(operation, contents);
    const desktopId = getActiveDesktopContext();
    if (!desktopId) throw new Error("No desktop is active.");
    return enqueueMutationUnsafe(operation(await readDesktopStateUnsafe(desktopId)), contents);
  });
}
export function enqueueDesktopCreate(name: string) { return serializeStorage(() => enqueueDesktopCreateUnsafe(name)); }
export function enqueueDesktopRename(desktopId: string, name: string, baseRevision: number) { return serializeStorage(() => enqueueDesktopRenameUnsafe(desktopId, name, baseRevision)); }
export function enqueueDesktopDelete(ownerDesktopId: string, desktopId: string, baseRevision: number) { return serializeStorage(() => enqueueDesktopDeleteUnsafe(ownerDesktopId, desktopId, baseRevision)); }
export function enqueueTransfer(sourceDesktopId: string, destinationDesktopId: string, entryIds: string[], parentId: string | null) { return serializeStorage(() => enqueueTransferUnsafe(sourceDesktopId, destinationDesktopId, entryIds, parentId)); }
export function readOutbox() { return serializeStorage(() => callDatabase("readOutbox", undefined)); }
export function bindOutboxCatalog(catalogId: string) { return serializeStorage(() => callDatabase("bindOutboxCatalog", { catalogId }, null)); }
export function acknowledgeMutation(operationId: string) { return serializeStorage(() => acknowledgeMutationUnsafe(operationId)); }
export function resolveSatisfiedMutation(snapshot: DesktopStateSnapshot, operationId: string, acknowledgedRevision: number, desktopId?: string) { return serializeStorage(() => resolveSatisfiedMutationUnsafe(snapshot, operationId, acknowledgedRevision, desktopId)); }
export function blockMutation(operationId: string, error: string, errorCode: string | null = null, conflictDetails: import("./outbox").RevisionConflictDetails | null = null) { return serializeStorage(() => callDatabase("blockMutation", { operationId, error, errorCode, conflictDetails })); }
export function rebaseBlockedMutation(operationId: string, operation: OutboxOperation) { return serializeStorage(() => callDatabase("rebaseBlockedMutation", { operationId, operation })); }
export function recordMutationAttempt(operationId: string, attemptedAt: number) { return serializeStorage(() => callDatabase("recordMutationAttempt", { operationId, attemptedAt })); }
export function discardDesktopProjection(desktopId: string, operationId: string) { return serializeStorage(() => discardDesktopProjectionUnsafe(desktopId, operationId)); }
export function readPendingContent(operationId: string, entryId: string, stagedContentKey?: string) { return serializeStorage(() => readStagedContent(operationId, entryId, stagedContentKey)); }
export function readContentConflict(operationId: string, entryId: string, baseRevision: number, stagedContentKey?: string) { return serializeStorage(async () => ({ mine: await readStagedContent(operationId, entryId, stagedContentKey), base: await readContentConflictBase(operationId, baseRevision), server: await readContentConflictServer(operationId) })); }
export function retainContentConflictBase(operationId: string, revision: number, content: Blob) { return serializeStorage(() => writeContentConflictBase(operationId, revision, content)); }
export function retainContentConflictServer(operationId: string, content: Blob) { return serializeStorage(() => writeContentConflictServer(operationId, content)); }
export function stagePendingContentVariant(operationId: string, content: Blob) { return serializeStorage(() => stageStagedContentVariant(operationId, content)); }
export function resolveContentConflictKeepBoth(operationId: string, remote: DesktopStateSnapshot, sibling: FileEntry) { return serializeStorage(() => resolveContentConflictKeepBothUnsafe(operationId, remote, sibling)); }
export function listActivity(query: ActivityQuery = {}) { return serializeStorage(() => callDatabase("listActivity", query)); }
export function listInstalledApps() { return serializeStorage(() => repositories.listInstalledApps()); }
export function installApp(install: InstalledApp) { return serializeStorage(() => repositories.installApp(install)); }
export function uninstallApp(appId: string) { return serializeStorage(() => repositories.uninstallApp(appId)); }
export function listQuarantinedApps() { return serializeStorage(() => repositories.listQuarantinedApps()); }
export function removeQuarantinedApp(appId: string) { return serializeStorage(() => repositories.removeQuarantinedApp(appId)); }
export function listFileAssociations() { return serializeStorage(() => repositories.listFileAssociations()); }
export function setFileAssociation(association: FileAssociation) { return serializeStorage(() => repositories.setFileAssociation(association)); }
export function removeFileAssociation(matcher: string) { return serializeStorage(() => repositories.removeFileAssociation(matcher)); }
export function resetFileAssociations() { return serializeStorage(() => repositories.resetFileAssociations()); }
export function readAppStorage(appId: string, key: string) { return serializeStorage(() => repositories.readAppStorage(appId, key)); }
export function writeAppStorage(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number) { return serializeStorage(() => repositories.writeAppStorage(appId, key, value, maxBytes, maxEntries)); }
export function removeAppStorage(appId: string, key: string) { return serializeStorage(() => repositories.removeAppStorage(appId, key)); }
export function clearAppStorage(appId: string) { return serializeStorage(() => repositories.clearAppStorage(appId)); }

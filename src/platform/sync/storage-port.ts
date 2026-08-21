import * as browserStorage from "../../lib/opfs";
import type { DesktopStateSnapshot } from "../../domain/desktop-state";
import type { SaveFileOptions } from "../../domain/files";
import type { CustomTheme, ThemeState } from "../../domain/theme";
import type { ActivityPage, ActivityQuery } from "../../lib/activity";
import type { OfflineStorageInventory } from "../../lib/offline-availability";
import type { OutboxOperation, OutboxRecord, RevisionConflictDetails } from "../../lib/outbox";
import type { SeededManifest } from "../../lib/seeded-manifest";
import type { DesktopEntry, DesktopIdentity, DesktopLayout, EditorSettings, EntryPosition, FileEntry, FolderEntry, RootEntryPositionUpdate } from "../../types";

type DesktopRegistry = { desktops: DesktopIdentity[]; activeDesktopId: string | null };
type QueuedMutation = { desktop: DesktopStateSnapshot; record: OutboxRecord };
export type OutboxOperationFactory = (current: DesktopStateSnapshot) => OutboxOperation;

export interface SyncStorage {
  loadDesktop(viewport: EntryPosition, seeded?: SeededManifest | null): Promise<DesktopStateSnapshot>;
  readCurrentDesktop(): Promise<DesktopStateSnapshot>;
  applyRemoteDesktop(snapshot: DesktopStateSnapshot, contents: Map<string, Blob>, acknowledgedOperationId?: string, desktopId?: string, force?: boolean, useAcknowledgedContent?: boolean, acknowledgedRevision?: number): Promise<DesktopStateSnapshot>;
  readDesktopState(desktopId: string): Promise<DesktopStateSnapshot>;

  createTextFile(name: string, parentId: string | null, position: EntryPosition): Promise<FileEntry>;
  createFile(name: string, parentId: string | null, position: EntryPosition, content: Blob, mimeType?: string): Promise<FileEntry>;
  createFolder(name: string, parentId: string | null, position: EntryPosition): Promise<FolderEntry>;
  importFiles(files: File[], parentId: string | null, positions: EntryPosition[]): Promise<FileEntry[]>;
  createEntries(entries: DesktopEntry[], contents: Map<string, Blob>): Promise<DesktopEntry[]>;
  renameEntry(id: string, name: string): Promise<DesktopEntry>;
  deleteEntry(id: string): Promise<DesktopEntry[]>;
  deleteEntries(ids: string[]): Promise<DesktopEntry[]>;
  moveEntry(id: string, parentId: string | null, position: EntryPosition): Promise<DesktopEntry>;
  moveEntries(ids: string[], parentId: string | null): Promise<DesktopEntry[]>;
  transferEntries(sourceDesktopId: string, destinationDesktopId: string, entryIds: string[], parentId: string | null): Promise<DesktopStateSnapshot>;
  updateEntryPosition(id: string, position: EntryPosition): Promise<DesktopEntry>;
  updateRootEntryPositions(positions: RootEntryPositionUpdate[]): Promise<DesktopEntry[]>;

  readFile(id: FileEntry["id"]): Promise<File>;
  readCachedFile(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision?: number): Promise<File | null>;
  cacheRemoteFile(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision: number, sha256: string, content: Blob, acknowledgedOperationId?: string): Promise<File | null>;
  removeCachedFile(desktopId: string, catalogId: string, id: FileEntry["id"], contentRevision: number): Promise<unknown>;
  resolveFileByRelativePath(fromFileId: FileEntry["id"], relativePath: string): Promise<FileEntry>;
  saveFile(id: FileEntry["id"], content: Blob, options?: SaveFileOptions): Promise<FileEntry>;
  saveTextFile(id: FileEntry["id"], content: string): Promise<FileEntry>;

  saveDesktopLayout(layout: DesktopLayout): Promise<void>;
  saveEditorSettings(settings: EditorSettings): Promise<void>;
  selectTheme(themeId: string): Promise<ThemeState>;
  saveCustomTheme(theme: CustomTheme): Promise<CustomTheme>;
  deleteCustomTheme(themeId: string): Promise<ThemeState>;

  listDesktops(seeded?: SeededManifest | null): Promise<DesktopRegistry>;
  createDesktop(name: string): Promise<DesktopIdentity>;
  createOfflineDesktop(name: string): Promise<{ desktop: DesktopIdentity }>;
  ensureDesktop(desktop: DesktopIdentity): Promise<DesktopIdentity>;
  renameDesktop(desktopId: string, name: string): Promise<DesktopIdentity>;
  deleteDesktop(desktopId: string): Promise<unknown>;

  enqueueMutation(operation: OutboxOperation | OutboxOperationFactory, contents?: Map<string, Blob>): Promise<QueuedMutation>;
  enqueueDesktopCreate(name: string): Promise<{ desktop: DesktopIdentity; record: OutboxRecord }>;
  enqueueDesktopRename(desktopId: string, name: string, baseRevision: number): Promise<{ desktop: DesktopIdentity; record: OutboxRecord }>;
  enqueueDesktopDelete(ownerDesktopId: string, desktopId: string, baseRevision: number): Promise<{ record: OutboxRecord }>;
  enqueueTransfer(sourceDesktopId: string, destinationDesktopId: string, entryIds: string[], parentId: string | null): Promise<QueuedMutation>;
  readOutbox(): Promise<OutboxRecord[]>;
  bindOutboxCatalog(catalogId: string): Promise<unknown>;
  acknowledgeMutation(operationId: string): Promise<unknown>;
  resolveSatisfiedMutation(snapshot: DesktopStateSnapshot, operationId: string, acknowledgedRevision: number, desktopId?: string): Promise<DesktopStateSnapshot>;
  blockMutation(operationId: string, error: string, errorCode?: string | null, conflictDetails?: RevisionConflictDetails | null): Promise<unknown>;
  rebaseBlockedMutation(operationId: string, operation: OutboxOperation): Promise<OutboxRecord>;
  recordMutationAttempt?(operationId: string, attemptedAt: number): Promise<unknown>;
  discardDesktopProjection(desktopId: string, operationId: string): Promise<{ affectedDesktopIds: string[] }>;
  readPendingContent(operationId: string, entryId: string, stagedContentKey?: string): Promise<Blob>;
  readContentConflict(operationId: string, entryId: string, baseRevision: number, stagedContentKey?: string): Promise<{ mine: Blob; base: Blob | null; server: Blob | null }>;
  retainContentConflictBase(operationId: string, revision: number, content: Blob): Promise<unknown>;
  retainContentConflictServer(operationId: string, content: Blob): Promise<unknown>;
  stagePendingContentVariant(operationId: string, content: Blob): Promise<string>;
  resolveContentConflictKeepBoth(operationId: string, remote: DesktopStateSnapshot, sibling: FileEntry): Promise<QueuedMutation>;

  loadOfflineInventory(desktopId: string): Promise<OfflineStorageInventory>;
  releaseOfflineCopies(desktopId: string, rootIds?: string[]): Promise<{ releasedBytes: number; releasedFiles: number; skippedFiles: number }>;
  listActivity(query?: ActivityQuery): Promise<ActivityPage>;
}

/** Provides browser storage for the synchronization engine. */
export const browserSyncStorage: SyncStorage = browserStorage;

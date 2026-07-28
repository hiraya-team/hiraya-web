import type { DesktopEntry, FileEntry } from "../types";
import type { PersistedDesktopState } from "../domain/desktop-state";
import type { OutboxOperation, OutboxRecord } from "./outbox";

export type OfflineAvailabilityStatus = "local" | "available" | "partial" | "online-only" | "updating" | "empty";

export type OfflineFileInventory = {
  cached: boolean;
  cachedBytes: number;
  storedBytes: number;
  pending: boolean;
  protected: boolean;
};

export type OfflineStorageInventory = {
  desktopId: string;
  authoritativeLocal: boolean;
  files: Record<string, OfflineFileInventory>;
  cachedBytes: number;
  protectedBytes: number;
  releasableBytes: number;
  browserStorage: { usage: number; quota: number } | null;
};

export type OfflineEntryAvailability = {
  status: OfflineAvailabilityStatus;
  cached: boolean;
  protected: boolean;
  pending: boolean;
  fileCount: number;
  availableFileCount: number;
  bytes: number;
  downloadBytes: number;
};

export type OfflineAvailabilityModel = {
  entries: Record<string, OfflineEntryAvailability>;
};

function entryMap(entries: readonly DesktopEntry[]) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function operationReferenceIds(operation: OutboxOperation) {
  if (operation.kind === "create") return operation.entries.map((entry) => entry.id);
  if (operation.kind === "patch-entry" || operation.kind === "save-content") return [operation.entryId];
  if (operation.kind === "delete") return [operation.entryId];
  if (operation.kind === "delete-entries" || operation.kind === "move-entries" || operation.kind === "entry-transfer") return operation.entryIds;
  if (operation.kind === "root-entry-positions") return operation.positions.map((position) => position.entryId);
  if (operation.kind === "layout" && operation.layout.wallpaper.source.startsWith("file:")) return [operation.layout.wallpaper.source.slice(5)];
  return [];
}

export function outboxProtectedFileIds(records: readonly OutboxRecord[], states: readonly Pick<PersistedDesktopState, "entries">[]) {
  const protectedIds = new Set<string>();
  const referencedIds = new Set<string>();
  for (const record of records) {
    if (record.operation.kind === "save-content") protectedIds.add(record.operation.entryId);
    if (record.operation.kind === "create") for (const entry of record.operation.entries) if (entry.kind === "file") protectedIds.add(entry.id);
    for (const id of operationReferenceIds(record.operation)) referencedIds.add(id);
  }
  for (const state of states) {
    const included = new Set(referencedIds);
    for (let changed = true; changed;) {
      changed = false;
      for (const entry of state.entries) if (entry.parentId && included.has(entry.parentId) && !included.has(entry.id)) { included.add(entry.id); changed = true; }
    }
    for (const entry of state.entries) if (entry.kind === "file" && included.has(entry.id)) protectedIds.add(entry.id);
  }
  return protectedIds;
}

export function dedupeOfflineRoots(entries: readonly DesktopEntry[], ids: readonly string[]) {
  const byId = entryMap(entries);
  const selected = new Set(ids);
  if (!selected.size || selected.size !== ids.length || ids.some((id) => !byId.has(id))) throw new Error("An offline selection contains an entry that no longer exists.");
  return ids.filter((id) => {
    let parentId = byId.get(id)!.parentId;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return true;
  });
}

export function offlineFilesUnderRoots(entries: readonly DesktopEntry[], rootIds: readonly string[]) {
  const roots = new Set(dedupeOfflineRoots(entries, rootIds));
  const included = new Set(roots);
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of entries) if (entry.parentId && included.has(entry.parentId) && !included.has(entry.id)) {
      included.add(entry.id);
      changed = true;
    }
  }
  return entries.filter((entry): entry is FileEntry => entry.kind === "file" && included.has(entry.id));
}

export function buildOfflineAvailability(
  entries: readonly DesktopEntry[],
  inventory: OfflineStorageInventory,
  activity: { updatingIds?: ReadonlySet<string> } = {},
): OfflineAvailabilityModel {
  const children = new Map<string, DesktopEntry[]>();
  for (const entry of entries) if (entry.parentId) children.set(entry.parentId, [...children.get(entry.parentId) ?? [], entry]);
  const result: Record<string, OfflineEntryAvailability> = {};

  const visit = (entry: DesktopEntry): OfflineEntryAvailability => {
    if (entry.kind === "file") {
      const stored = inventory.files[entry.id] ?? { cached: false, cachedBytes: 0, storedBytes: 0, pending: false, protected: false };
      const available = stored.cached;
      const status: OfflineAvailabilityStatus = activity.updatingIds?.has(entry.id)
        ? "updating"
        : inventory.authoritativeLocal ? "local" : available ? "available" : "online-only";
      return result[entry.id] = {
        status, cached: stored.cached, protected: stored.protected,
        pending: stored.pending, fileCount: 1, availableFileCount: available ? 1 : 0, bytes: entry.size,
        downloadBytes: available ? 0 : entry.size,
      };
    }
    const descendants = (children.get(entry.id) ?? []).map(visit);
    const fileCount = descendants.reduce((total, child) => total + child.fileCount, 0);
    const availableFileCount = descendants.reduce((total, child) => total + child.availableFileCount, 0);
    const protectedContent = descendants.some((child) => child.protected);
    const pending = descendants.some((child) => child.pending);
    const updating = activity.updatingIds?.has(entry.id) === true || descendants.some((child) => child.status === "updating");
    const status: OfflineAvailabilityStatus = fileCount === 0 ? "empty"
      : updating ? "updating"
      : inventory.authoritativeLocal ? "local"
      : availableFileCount === fileCount ? "available"
      : availableFileCount > 0 ? "partial" : "online-only";
    return result[entry.id] = {
      status, cached: fileCount > 0 && descendants.every((child) => child.cached),
      protected: protectedContent, pending, fileCount, availableFileCount,
      bytes: descendants.reduce((total, child) => total + child.bytes, 0),
      downloadBytes: descendants.reduce((total, child) => total + child.downloadBytes, 0),
    };
  };
  for (const entry of entries) if (entry.parentId === null) visit(entry);
  return { entries: result };
}

export function offlineStatusLabel(value: OfflineEntryAvailability) {
  if (value.status === "local") return "Stored in this browser";
  if (value.status === "available") return "Available offline";
  if (value.status === "partial") return "Partially available offline";
  if (value.status === "online-only") return "Online only";
  if (value.status === "updating") return "Updating offline copy";
  return "Empty folder";
}

export function offlineStatusDescription(value: OfflineEntryAvailability) {
  if (value.status === "local") return "This browser stores the authoritative local content.";
  if (value.status === "available") return value.fileCount === 1 ? "This file can be opened without a connection." : `All ${value.fileCount} files can be opened without a connection.`;
  if (value.status === "partial") return `${value.availableFileCount} of ${value.fileCount} files can be opened without a connection.`;
  if (value.status === "online-only") return value.fileCount === 1 ? "Connect to download this file before using it offline." : `Connect to download these ${value.fileCount} files before using them offline.`;
  if (value.status === "updating") return "A local offline copy is being downloaded or updated.";
  return "This folder contains no files to store offline.";
}

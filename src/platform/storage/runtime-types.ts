import type { FileEntry, DesktopIdentity } from "../../types";
import type { CatalogQuota } from "../../lib/desktop-catalog";
export type { FileTransferState, OfflineOperationProgress, SyncStatus } from "../../domain/sync-status";

export type DesktopRegistry = {
  schemaVersion: 2;
  catalogId: string | null;
  catalogRevision: number;
  desktops: DesktopIdentity[];
  activeDesktopId: string | null;
  quota: CatalogQuota | null;
};

export type ContentConflictBundle = {
  operationId: string;
  desktopId: string;
  entryId: string;
  expectedRevision: number;
  serverRevision: number;
  mine: Blob;
  base: Blob | null;
  server: Blob;
  mineMetadata: Pick<FileEntry, "name" | "mimeType" | "size" | "modifiedAt">;
  serverMetadata: Pick<FileEntry, "name" | "mimeType" | "size" | "modifiedAt">;
};

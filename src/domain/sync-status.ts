export type SyncStatus = "connecting" | "online" | "offline" | "blocked" | "upgrade-required" | "error" | "local";

export type FileTransferState = {
  id: string;
  entryId: string;
  fileName: string;
  direction: "upload" | "download";
  phase: "hashing" | "access" | "uploading" | "finalizing" | "downloading" | "complete" | "failed";
  transferredBytes: number;
  totalBytes: number;
  error: string | null;
};

export type OfflineOperationProgress = {
  desktopId: string;
  generation: number;
  operationId: string;
  phase: "downloading" | "complete" | "error";
  completed: number;
  total: number;
  failed: number;
  bytesCompleted: number;
  totalBytes: number;
  updatingIds: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
};

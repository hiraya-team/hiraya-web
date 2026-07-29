import { parseBlobMutationPreparation } from "../../lib/contracts";
import { API_ROUTES } from "../../lib/api-routes";
import { mapWithConcurrency, uploadBlobDigests } from "../../lib/blob-transfer";
import type { OutboxOperation, OutboxRecord } from "../../lib/outbox";
import { SyncRequestError } from "./http-client";
import { uploadDirectBlob } from "./direct-upload";

export type BlobUploadPhase = "hashing" | "access" | "uploading" | "finalizing";

type OutboxTransportDependencies = {
  fetch: typeof fetch;
  signal?: AbortSignal;
  requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown>;
  requireAuthentication(response: Response): Response;
  readPendingContent(operationId: string, entryId: string): Promise<Blob>;
  createXMLHttpRequest?: () => XMLHttpRequest;
  onBlobUploadProgress?(entryId: string, phase: BlobUploadPhase, transferredBytes: number, totalBytes: number): void;
};

function retryableBlobCommitError(error: unknown): error is SyncRequestError {
  return error instanceof SyncRequestError && (error.status === 410 || error.status === 404 && error.message === "upload reservation not found" || error.status === 409 && (
    error.message === "a reserved upload is missing" ||
    error.message === "a reserved upload failed size or checksum verification"
  ));
}

function idempotencyHeaders(record: OutboxRecord, headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("X-Hiraya-Client-ID", record.clientId);
  result.set("X-Hiraya-Operation-ID", record.operationId);
  return result;
}

function revisionHeaders(revision?: number) {
  return revision === undefined ? undefined : { "X-Hiraya-Base-Revision": String(revision) };
}

async function abortBlobMutation(record: OutboxRecord, uploadId: string, dependencies: OutboxTransportDependencies) {
  try {
    const response = await dependencies.fetch(API_ROUTES.desktopBlobMutation(record.desktopId, uploadId), {
      method: "DELETE",
      headers: idempotencyHeaders(record),
      credentials: "same-origin",
      cache: "no-store",
      signal: dependencies.signal,
    });
    dependencies.requireAuthentication(response);
  } catch {
    // A later replay starts with a fresh prepare, so abort cleanup is best effort.
  }
}

async function sendBlobMutation(record: OutboxRecord & { operation: Extract<OutboxOperation, { kind: "create" | "save-content" }> }, dependencies: OutboxTransportDependencies) {
  const operation = record.operation;
  const files = operation.kind === "create" ? operation.entries.filter((entry) => entry.kind === "file") : [{ id: operation.entryId, name: operation.entryId, size: operation.size }];
  const contents = new Map<string, Blob>();
  const hashes = new Map(await mapWithConcurrency(files, 3, async (entry) => {
    dependencies.onBlobUploadProgress?.(entry.id, "hashing", 0, entry.size);
    const content = await dependencies.readPendingContent(record.operationId, entry.id);
    if (content.size !== entry.size) throw new Error(`The staged contents of “${entry.name}” have an unexpected size.`);
    contents.set(entry.id, content);
    const digest = await uploadBlobDigests(content, (bytes) => dependencies.onBlobUploadProgress?.(entry.id, "hashing", bytes, entry.size), dependencies.signal);
    dependencies.onBlobUploadProgress?.(entry.id, "access", 0, entry.size);
    return [entry.id, digest] as const;
  }));
  const prepared = parseBlobMutationPreparation(await dependencies.requestJson(API_ROUTES.desktopBlobMutations(record.desktopId), {
    method: "POST",
    headers: idempotencyHeaders(record, { "Content-Type": "application/json" }),
    body: JSON.stringify({ kind: operation.kind, items: operation.kind === "create"
      ? operation.entries.map((entry) => ({ entry, ...(entry.kind === "file" ? hashes.get(entry.id)! : { sha256: "", md5: "" }) }))
      : [{ entryId: operation.entryId, mimeType: operation.mimeType, size: operation.size, baseContentRevision: operation.baseContentRevision, ...hashes.get(operation.entryId)! }] }),
  }), files.map((entry) => entry.id));
  if (prepared.state === "committed") {
    for (const entry of files) dependencies.onBlobUploadProgress?.(entry.id, "finalizing", entry.size, entry.size);
    return prepared;
  }
  let commitStarted = false;
  const uploadAbort = new AbortController();
  const abortUploads = () => uploadAbort.abort(dependencies.signal?.reason);
  if (dependencies.signal?.aborted) abortUploads();
  else dependencies.signal?.addEventListener("abort", abortUploads, { once: true });
  try {
    await mapWithConcurrency(prepared.items, 3, async (target) => {
      try {
        const content = contents.get(target.entryId)!;
        dependencies.onBlobUploadProgress?.(target.entryId, "uploading", 0, content.size);
        await uploadDirectBlob(target.access, content, {
          signal: uploadAbort.signal,
          createRequest: dependencies.createXMLHttpRequest,
          onProgress: (bytes) => dependencies.onBlobUploadProgress?.(target.entryId, "uploading", bytes, content.size),
        });
      } catch (error) {
        uploadAbort.abort(error);
        if (dependencies.signal?.aborted) throw error;
        throw new SyncRequestError("Direct file upload failed. The change remains queued.", null, false);
      }
      dependencies.onBlobUploadProgress?.(target.entryId, "finalizing", contents.get(target.entryId)!.size, contents.get(target.entryId)!.size);
    });
    commitStarted = true;
    try {
      return await dependencies.requestJson(API_ROUTES.desktopBlobMutationCommit(record.desktopId, prepared.uploadId), {
        method: "POST",
        headers: idempotencyHeaders(record),
      });
    } catch (error) {
      if (retryableBlobCommitError(error)) throw new SyncRequestError(error.message, error.status, false);
      throw error;
    }
  } catch (error) {
    if (!commitStarted) await abortBlobMutation(record, prepared.uploadId, dependencies);
    throw error;
  } finally {
    dependencies.signal?.removeEventListener("abort", abortUploads);
  }
}

export async function sendOutboxOperation(record: OutboxRecord, dependencies: OutboxTransportDependencies) {
  const operation = record.operation;
  const desktopId = record.desktopId;
  const headers = (value?: HeadersInit) => idempotencyHeaders(record, value);
  switch (operation.kind) {
    case "create-desktop":
      return dependencies.requestJson(API_ROUTES.desktops, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ id: operation.desktop.id, name: operation.desktop.name }) });
    case "rename-desktop":
      return dependencies.requestJson(API_ROUTES.desktop(operation.desktop.id), { method: "PATCH", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ name: operation.desktop.name, baseRevision: operation.baseRevision }) });
    case "delete-desktop":
      return dependencies.requestJson(API_ROUTES.desktop(operation.desktopId), { method: "DELETE", headers: headers(revisionHeaders(operation.baseRevision)) });
    case "create":
    case "save-content":
      return sendBlobMutation(record as OutboxRecord & { operation: Extract<OutboxOperation, { kind: "create" | "save-content" }> }, dependencies);
    case "patch-entry":
      return dependencies.requestJson(API_ROUTES.desktopEntry(desktopId, operation.entryId), { method: "PATCH", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ baseRevision: operation.baseRevision, changes: operation.changes }) });
    case "delete":
      return dependencies.requestJson(API_ROUTES.desktopEntry(desktopId, operation.entryId), { method: "DELETE", headers: headers(revisionHeaders(operation.baseRevision)) });
    case "delete-entries":
      return dependencies.requestJson(API_ROUTES.desktopDeleteEntries(desktopId), { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ entryIds: operation.entryIds, baseRevisions: operation.baseRevisions }) });
    case "move-entries":
      return dependencies.requestJson(API_ROUTES.desktopMoveEntries(desktopId), { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ entryIds: operation.entryIds, baseRevisions: operation.baseRevisions, parentId: operation.parentId }) });
    case "entry-transfer":
      return dependencies.requestJson(API_ROUTES.entryTransfers, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ sourceDesktopId: desktopId, destinationDesktopId: operation.destinationDesktopId, entryIds: operation.entryIds, parentId: operation.parentId }) });
    case "root-entry-positions":
      return dependencies.requestJson(API_ROUTES.desktopRootEntryPositions(desktopId), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ positions: operation.positions, baseRevisions: operation.baseRevisions }) });
    case "layout":
      return dependencies.requestJson(API_ROUTES.desktopLayout(desktopId), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ layout: operation.layout, baseRevision: operation.baseRevision }) });
    case "editor-settings":
      return dependencies.requestJson(API_ROUTES.desktopEditorSettings(desktopId), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ ...operation.settings, baseRevision: operation.baseRevision }) });
    case "select-theme":
      return dependencies.requestJson(API_ROUTES.desktopThemeSelection(desktopId), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ themeId: operation.themeId, baseRevision: operation.baseRevision }) });
    case "upsert-theme":
      return dependencies.requestJson(API_ROUTES.desktopTheme(desktopId, operation.theme.id), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ ...operation.theme, baseRevision: operation.baseRevision }) });
    case "delete-theme":
      return dependencies.requestJson(API_ROUTES.desktopTheme(desktopId, operation.themeId), { method: "DELETE", headers: headers(revisionHeaders(operation.baseRevision)) });
  }
}

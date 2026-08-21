import { API_ROUTES, authenticatedHeaders } from "../../lib/api-routes";
import { isRecord, isValidId, parseDirectBlobAccess } from "../../lib/contracts";
import { mapWithConcurrency, uploadBlobDigests } from "../../lib/blob-transfer";
import type { OutboxRecord } from "../../lib/outbox";
import { SyncRequestError } from "./http-client";
import { uploadDirectBlob } from "./direct-upload";

export type BlobUploadPhase = "hashing" | "access" | "uploading" | "finalizing";

type OutboxTransportDependencies = {
  fetch: typeof fetch;
  directBlobOrigin?: string;
  signal?: AbortSignal;
  requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown>;
  requireAuthentication(response: Response): Response;
  readPendingContent(operationId: string, entryId: string, stagedContentKey?: string): Promise<Blob>;
  createXMLHttpRequest?: () => XMLHttpRequest;
  onBlobUploadProgress?(entryId: string, phase: BlobUploadPhase, transferredBytes: number, totalBytes: number): void;
};

type Upload = { id: string; name: string; size: number; content: Blob; sha256: string; md5: string };
type PreparedTransaction = { state: "committed"; catalogRevision: number } | { state: "prepared"; transactionId: string; items: Array<{ entryId: string; access: ReturnType<typeof parseDirectBlobAccess> }> };

/** Builds idempotent synchronization request headers. */
function headers(record: OutboxRecord, value?: HeadersInit) {
  const result = authenticatedHeaders(value);
  result.set("X-Hiraya-Client-ID", record.clientId);
  result.set("X-Hiraya-Operation-ID", record.operationId);
  return result;
}

/** Computes system entry ID. */
function systemEntryId(desktopId: string, role: "layout" | "editor-settings" | "theme-selection" | "theme-definition", key?: string) {
  return `${desktopId}:system:${role}${key ? `:${key}` : ""}`;
}

/** Builds the base transaction operation fields. */
function base(value: number | undefined) { return value === undefined ? {} : { baseRevision: value }; }
/** Converts an outbox record to entry transaction operations. */
function transactionOperations(record: OutboxRecord, uploads: readonly Upload[]) {
  const operation = record.operation;
  const desktopId = record.desktopId;
  const digest = (id: string) => {
    const upload = uploads.find((item) => item.id === id);
    return upload ? { sha256: upload.sha256, md5: upload.md5 } : { sha256: "", md5: "" };
  };
  switch (operation.kind) {
    case "create":
      return operation.entries.map((entry) => ({ type: "entry.create", entry, ...digest(entry.id) }));
    case "patch-entry":
      return [{ type: "entry.patch", entryId: operation.entryId, ...base(operation.baseRevision), changes: { name: operation.changes.name, parentId: operation.changes.parentId, position: operation.changes.position } }];
    case "save-content":
      return [{ type: "entry.content.write", entryId: operation.entryId, mimeType: operation.mimeType, size: operation.size, ...base(operation.baseContentRevision), ...digest(operation.entryId) }];
    case "delete":
      return [{ type: "entry.trash", entryId: operation.entryId, ...base(operation.baseRevision) }];
    case "delete-entries":
      return operation.entryIds.map((entryId) => ({ type: "entry.trash", entryId, ...base(operation.baseRevisions?.[entryId]) }));
    case "move-entries":
      return operation.entryIds.map((entryId) => ({ type: "entry.patch", entryId, ...base(operation.baseRevisions?.[entryId]), changes: { parentId: operation.parentId } }));
    case "root-entry-positions":
      return operation.positions.map(({ entryId, position }) => ({ type: "entry.patch", entryId, ...base(operation.baseRevisions?.[entryId]), changes: { parentId: null, position } }));
    case "entry-transfer":
      return [{ type: "entry.transfer", desktopId, destinationDesktopId: operation.destinationDesktopId, entryIds: operation.entryIds, parentId: operation.parentId }];
    case "layout":
      return [{ type: "entry.content.write", entryId: systemEntryId(desktopId, "layout"), systemRole: "layout", ...base(operation.baseRevision), content: operation.layout }];
    case "editor-settings":
      return [{ type: "entry.content.write", entryId: systemEntryId(desktopId, "editor-settings"), systemRole: "editor-settings", ...base(operation.baseRevision), content: operation.settings }];
    case "select-theme":
      return [{ type: "entry.content.write", entryId: systemEntryId(desktopId, "theme-selection"), systemRole: "theme-selection", ...base(operation.baseRevision), content: { themeId: operation.themeId } }];
    case "upsert-theme":
      return [{ type: "entry.content.write", entryId: systemEntryId(desktopId, "theme-definition", operation.theme.id), systemRole: "theme-definition", systemKey: operation.theme.id, ...base(operation.baseRevision), content: { id: operation.theme.id, name: operation.theme.name, definition: operation.theme.definition } }];
    case "delete-theme":
      return [{ type: "entry.purge", entryId: systemEntryId(desktopId, "theme-definition", operation.themeId), systemRole: "theme-definition", systemKey: operation.themeId, ...base(operation.baseRevision) }];
    case "install-theme-package": {
      const definition = { type: "entry.content.write", entryId: systemEntryId(desktopId, "theme-definition", operation.theme.id), systemRole: "theme-definition", systemKey: operation.theme.id, ...base(operation.baseThemeRevision), content: { id: operation.theme.id, name: operation.theme.name, definition: operation.theme.definition } };
      const selection = { type: "entry.content.write", entryId: systemEntryId(desktopId, "theme-selection"), systemRole: "theme-selection", ...base(operation.baseSelectionRevision), content: { themeId: operation.theme.id } };
      const layout = { type: "entry.content.write", entryId: systemEntryId(desktopId, "layout"), systemRole: "layout", ...base(operation.baseLayoutRevision), content: operation.layout };
      if (operation.wallpaperKind === null) return [definition, selection, layout];
      return [definition, { type: "entry.create", entry: { kind: "file", id: operation.assetId, name: `${operation.theme.name}.hiraya.app`, parentId: null, createdAt: null, modifiedAt: 0, position: { x: 0, y: 0 }, mimeType: "application/vnd.hiraya.theme+zip", size: operation.size }, systemRole: "theme-package", systemKey: operation.theme.id, packageKind: operation.wallpaperKind, ...digest(operation.assetId) }, selection, layout];
    }
    default:
      return [];
  }
}

/** Parses and validates preparation. */
function parsePreparation(value: unknown, expectedIds: readonly string[], directBlobOrigin?: string): PreparedTransaction {
  if (!isRecord(value) || value.state !== "prepared" && value.state !== "committed") throw new Error("The entry transaction response is invalid.");
  if (value.state === "committed") {
    if (!Number.isSafeInteger(value.catalogRevision) || Number(value.catalogRevision) <= 0) throw new Error("The committed entry transaction has an invalid revision.");
    return { state: "committed", catalogRevision: Number(value.catalogRevision) };
  }
  if (typeof value.transactionId !== "string" || !value.transactionId || value.transactionId.length > 1024 || [...value.transactionId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) < 0 || !Array.isArray(value.items)) throw new Error("The entry transaction response is invalid.");
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length || value.items.length !== expected.size) throw new Error("The entry transaction returned unexpected upload targets.");
  const items = value.items.map((candidate) => {
    if (!isRecord(candidate) || !isValidId(candidate.entryId) || !expected.delete(candidate.entryId)) throw new Error("The entry transaction returned unexpected upload targets.");
    return { entryId: candidate.entryId, access: parseDirectBlobAccess(candidate.access, "PUT", directBlobOrigin) };
  });
  if (expected.size) throw new Error("The entry transaction did not return every upload target.");
  return { state: "prepared", transactionId: value.transactionId, items };
}

/** Best-effort cancels a prepared entry transaction. */
async function cancel(record: OutboxRecord, transactionId: string, dependencies: OutboxTransportDependencies) {
  try {
    const response = await dependencies.fetch(API_ROUTES.desktopEntryTransaction(record.desktopId, transactionId), { method: "DELETE", headers: headers(record), credentials: "same-origin", cache: "no-store", signal: dependencies.signal });
    dependencies.requireAuthentication(response);
  } catch { /* A later replay starts with a fresh prepare; cancellation is best effort. */ }
}

/** Loads and hashes content required by an outbox operation. */
async function pendingUploads(record: OutboxRecord, dependencies: OutboxTransportDependencies) {
  const operation = record.operation;
  const files = operation.kind === "create" ? operation.entries.filter((entry) => entry.kind === "file").map(({ id, name, size }) => ({ id, name, size, key: undefined }))
    : operation.kind === "save-content" ? [{ id: operation.entryId, name: operation.entryId, size: operation.size, key: operation.stagedContentKey }]
      : operation.kind === "install-theme-package" && operation.wallpaperKind !== null ? [{ id: operation.assetId, name: `${operation.theme.name}.hiraya.app`, size: operation.size, key: undefined }] : [];
  return mapWithConcurrency(files, 3, async (file): Promise<Upload> => {
    dependencies.onBlobUploadProgress?.(file.id, "hashing", 0, file.size);
    const content = await dependencies.readPendingContent(record.operationId, file.id, file.key);
    if (content.size !== file.size) throw new Error(`The staged contents of “${file.name}” have an unexpected size.`);
    const digests = await uploadBlobDigests(content, (bytes) => dependencies.onBlobUploadProgress?.(file.id, "hashing", bytes, file.size), dependencies.signal);
    dependencies.onBlobUploadProgress?.(file.id, "access", 0, file.size);
    return { ...file, content, ...digests };
  });
}

/** Prepares, uploads, and commits an entry transaction. */
async function sendTransaction(record: OutboxRecord, dependencies: OutboxTransportDependencies) {
  const uploads = await pendingUploads(record, dependencies);
  const prepared = parsePreparation(await dependencies.requestJson(API_ROUTES.desktopEntryTransactions(record.desktopId), {
    method: "POST",
    headers: headers(record, { "Content-Type": "application/json" }),
    body: JSON.stringify({ operations: transactionOperations(record, uploads) }),
  }), uploads.map(({ id }) => id), dependencies.directBlobOrigin);
  if (prepared.state === "committed") return { response: prepared, verifiedUploads: new Map(uploads.map(({ id, sha256 }) => [id, sha256])) };
  let commitStarted = false;
  try {
    await mapWithConcurrency(prepared.items, 3, async (target) => {
      const upload = uploads.find(({ id }) => id === target.entryId)!;
      dependencies.onBlobUploadProgress?.(upload.id, "uploading", 0, upload.size);
      try {
        await uploadDirectBlob(target.access, upload.content, { signal: dependencies.signal, createRequest: dependencies.createXMLHttpRequest, onProgress: (bytes) => dependencies.onBlobUploadProgress?.(upload.id, "uploading", bytes, upload.size) });
      } catch (error) {
        if (dependencies.signal?.aborted) throw error;
        throw new SyncRequestError("Direct file upload failed. The change remains queued.", null, false);
      }
      dependencies.onBlobUploadProgress?.(upload.id, "finalizing", upload.size, upload.size);
    });
    commitStarted = true;
    let response: unknown;
    try {
      response = await dependencies.requestJson(API_ROUTES.desktopEntryTransactionCommit(record.desktopId, prepared.transactionId), { method: "POST", headers: headers(record) });
    } catch (error) {
      if (error instanceof SyncRequestError && (error.status === 410 || error.status === 404 && error.message === "upload reservation not found" || error.status === 409 && (error.message === "a reserved upload is missing" || error.message === "a reserved upload failed size or checksum verification"))) {
        throw new SyncRequestError(error.message, error.status, false);
      }
      throw error;
    }
    return { response, verifiedUploads: new Map(uploads.map(({ id, sha256 }) => [id, sha256])) };
  } catch (error) {
    if (!commitStarted) await cancel(record, prepared.transactionId, dependencies);
    throw error;
  }
}

/** Sends an outbox operation to the synchronization API. */
export async function sendOutboxOperation(record: OutboxRecord, dependencies: OutboxTransportDependencies) {
  const operation = record.operation;
  const result = async (response: Promise<unknown>) => ({ response: await response, verifiedUploads: new Map<string, string>() });
  if (operation.kind === "create-desktop") return result(dependencies.requestJson(API_ROUTES.desktops, { method: "POST", headers: headers(record, { "Content-Type": "application/json" }), body: JSON.stringify({ id: operation.desktop.id, name: operation.desktop.name }) }));
  if (operation.kind === "rename-desktop") return result(dependencies.requestJson(API_ROUTES.desktop(operation.desktop.id), { method: "PATCH", headers: headers(record, { "Content-Type": "application/json" }), body: JSON.stringify({ name: operation.desktop.name, baseRevision: operation.baseRevision }) }));
  if (operation.kind === "delete-desktop") return result(dependencies.requestJson(API_ROUTES.desktop(operation.desktopId), { method: "DELETE", headers: headers(record, operation.baseRevision === undefined ? undefined : { "X-Hiraya-Base-Revision": String(operation.baseRevision) }) }));
  return sendTransaction(record, dependencies);
}

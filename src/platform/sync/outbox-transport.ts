import { parseBlobMutationPreparation } from "../../lib/contracts";
import { API_ROUTES } from "../../lib/api-routes";
import { mapWithConcurrency, uploadBlobDigests } from "../../lib/blob-transfer";
import type { OutboxOperation, OutboxRecord } from "../../lib/outbox";
import type { FileEntry } from "../../types";
import { SyncRequestError } from "./http-client";

type OutboxTransportDependencies = {
  fetch: typeof fetch;
  requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown>;
  requireAuthentication(response: Response): Response;
  readPendingContent(operationId: string, entryId: string): Promise<Blob>;
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

async function abortBlobMutation(record: OutboxRecord, uploadId: string, dependencies: OutboxTransportDependencies) {
  try {
    const response = await dependencies.fetch(API_ROUTES.desktopBlobMutation(record.desktopId, uploadId), {
      method: "DELETE",
      headers: idempotencyHeaders(record),
      credentials: "same-origin",
      cache: "no-store",
    });
    dependencies.requireAuthentication(response);
  } catch {
    // A later replay starts with a fresh prepare, so abort cleanup is best effort.
  }
}

async function sendBlobMutation(record: OutboxRecord & { operation: Extract<OutboxOperation, { kind: "create" | "save-content" }> }, dependencies: OutboxTransportDependencies) {
  const operation = record.operation;
  const files = operation.kind === "create" ? operation.entries.filter((entry): entry is FileEntry => entry.kind === "file") : [operation.entry];
  const contents = new Map<string, Blob>();
  const hashes = new Map(await mapWithConcurrency(files, 3, async (entry) => {
    const content = await dependencies.readPendingContent(record.operationId, entry.id);
    if (content.size !== entry.size) throw new Error(`The staged contents of “${entry.name}” have an unexpected size.`);
    contents.set(entry.id, content);
    return [entry.id, await uploadBlobDigests(content)] as const;
  }));
  const entries = operation.kind === "create" ? operation.entries : [operation.entry];
  const prepared = parseBlobMutationPreparation(await dependencies.requestJson(API_ROUTES.desktopBlobMutations(record.desktopId), {
    method: "POST",
    headers: idempotencyHeaders(record, { "Content-Type": "application/json" }),
    body: JSON.stringify({ kind: operation.kind, items: entries.map((entry) => ({ entry, ...(entry.kind === "file" ? hashes.get(entry.id)! : { sha256: "", md5: "" }) })) }),
  }), files.map((entry) => entry.id));
  if (prepared.state === "committed") return;
  let commitStarted = false;
  try {
    await mapWithConcurrency(prepared.items, 3, async (target) => {
      let response: Response;
      try {
        response = await dependencies.fetch(target.access.url, {
          method: target.access.method,
          headers: target.access.headers,
          body: contents.get(target.entryId)!,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
        });
      } catch {
        throw new SyncRequestError("Direct file upload failed. The change remains queued.", null, false);
      }
      if (!response.ok) throw new SyncRequestError(`Direct file upload failed (${response.status}). The change remains queued.`, null, false);
    });
    commitStarted = true;
    try {
      await dependencies.requestJson(API_ROUTES.desktopBlobMutationCommit(record.desktopId, prepared.uploadId), {
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
  }
}

export async function sendOutboxOperation(record: OutboxRecord, dependencies: OutboxTransportDependencies) {
  const operation = record.operation;
  const desktopId = record.desktopId;
  const headers = (value?: HeadersInit) => idempotencyHeaders(record, value);
  switch (operation.kind) {
    case "create-desktop":
      await dependencies.requestJson(API_ROUTES.desktops, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ id: operation.desktop.id, name: operation.desktop.name }) });
      return;
    case "rename-desktop":
      await dependencies.requestJson(API_ROUTES.desktop(operation.desktop.id), { method: "PATCH", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ name: operation.desktop.name }) });
      return;
    case "delete-desktop":
      await dependencies.requestJson(API_ROUTES.desktop(operation.desktopId), { method: "DELETE", headers: headers() });
      return;
    case "create":
    case "save-content":
      await sendBlobMutation(record as OutboxRecord & { operation: Extract<OutboxOperation, { kind: "create" | "save-content" }> }, dependencies);
      return;
    case "update-entry":
      await dependencies.requestJson(API_ROUTES.desktopEntry(desktopId, operation.entry.id), { method: "PATCH", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(operation.entry) });
      return;
    case "delete":
      await dependencies.requestJson(API_ROUTES.desktopEntry(desktopId, operation.entryId), { method: "DELETE", headers: headers() });
      return;
    case "delete-entries":
      await dependencies.requestJson(API_ROUTES.desktopDeleteEntries(desktopId), { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ entryIds: operation.entryIds }) });
      return;
    case "move-entries":
      await dependencies.requestJson(API_ROUTES.desktopMoveEntries(desktopId), { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ entryIds: operation.entryIds, parentId: operation.parentId }) });
      return;
    case "entry-transfer":
      await dependencies.requestJson(API_ROUTES.entryTransfers, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ sourceDesktopId: desktopId, destinationDesktopId: operation.destinationDesktopId, entryIds: operation.entryIds, parentId: operation.parentId }) });
      return;
    case "root-entry-positions":
      await dependencies.requestJson(API_ROUTES.desktopRootEntryPositions(desktopId), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(operation.positions) });
      return;
    case "layout":
      await dependencies.requestJson(API_ROUTES.desktopLayout(desktopId), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(operation.layout) });
      return;
    case "editor-settings":
      await dependencies.requestJson(API_ROUTES.desktopEditorSettings(desktopId), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(operation.settings) });
      return;
    case "select-theme":
      await dependencies.requestJson(API_ROUTES.desktopThemeSelection(desktopId), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ themeId: operation.themeId }) });
      return;
    case "upsert-theme":
      await dependencies.requestJson(API_ROUTES.desktopTheme(desktopId, operation.theme.id), { method: "PUT", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(operation.theme) });
      return;
    case "delete-theme":
      await dependencies.requestJson(API_ROUTES.desktopTheme(desktopId, operation.themeId), { method: "DELETE", headers: headers() });
  }
}

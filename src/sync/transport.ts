import { WEB2_SCHEMA_VERSION, sha256Hex } from "../filesystem/model";
import {
  WEB2_PROTOCOL_HEADER,
  WEB2_SYNC_PROTOCOL,
  parseAccountEventHint,
  parseBootstrap,
  parseBootstrapRequest,
  parseChunkDownloadRequest,
  parseChunkDownloadResult,
  parseChunkUploadRequest,
  parseChunkUploadResult,
  parseHydrationPage,
  parseHydrationRequest,
  parsePullRequest,
  parsePullResult,
  parsePushBatchResult,
  parsePushRequest,
  parseWeb2Session,
  type AccountEventHint,
  type Bootstrap,
  type BootstrapRequest,
  type ChunkDownloadRequest,
  type ChunkDownloadResult,
  type ChunkTransferDescriptor,
  type ChunkUploadRequest,
  type ChunkUploadResult,
  type HydrationPage,
  type HydrationRequest,
  type PullRequest,
  type PullResult,
  type PushBatchResult,
  type PushRequest,
  type Web2Session,
} from "./protocol";

export class Web2HTTPError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "Authentication is required." : `Synchronization request failed with status ${status}.`);
    this.name = "Web2HTTPError";
  }
}

async function responseJSON(response: Response) {
  if (!response.ok) throw new Web2HTTPError(response.status);
  if (response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new Error("A synchronization response is not JSON.");
  return response.json() as Promise<unknown>;
}

async function post(path: string, value: unknown, signal?: AbortSignal) {
  return responseJSON(await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL },
    body: JSON.stringify(value),
    signal,
  }));
}

function workspaceRoute(workspaceId: string, suffix: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/sync/${suffix}`;
}

export async function fetchWeb2Session(signal?: AbortSignal): Promise<Web2Session> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal });
  return parseWeb2Session(await responseJSON(response));
}

export async function bootstrapWeb2(requestValue: BootstrapRequest, signal?: AbortSignal): Promise<Bootstrap> {
  const request = parseBootstrapRequest(requestValue);
  const result = parseBootstrap(await post(workspaceRoute(request.workspaceId, "bootstrap"), request, signal));
  if (result.workspace.id !== request.workspaceId || result.deviceId !== request.deviceId || result.rootPage.generationId !== request.generationId) throw new Error("A bootstrap response does not match its request.");
  return result;
}

export async function hydrateWeb2(requestValue: HydrationRequest, signal?: AbortSignal): Promise<HydrationPage> {
  const request = parseHydrationRequest(requestValue);
  const result = parseHydrationPage(await post(workspaceRoute(request.workspaceId, "hydrate"), request, signal));
  if (result.workspaceId !== request.workspaceId || result.deviceId !== request.deviceId || result.generationId !== request.generationId || result.pageIndex !== request.pageIndex) throw new Error("A hydration response does not match its request.");
  return result;
}

export async function pullWeb2(requestValue: PullRequest, signal?: AbortSignal): Promise<PullResult> {
  const request = parsePullRequest(requestValue);
  const result = parsePullResult(await post(workspaceRoute(request.workspaceId, "pull"), request, signal));
  if (result.workspaceId !== request.workspaceId || result.deviceId !== request.deviceId || result.fromCursor !== request.cursor) throw new Error("A pull response does not match its request.");
  return result;
}

export async function pushWeb2(requestValue: PushRequest, signal?: AbortSignal): Promise<PushBatchResult> {
  const request = parsePushRequest(requestValue);
  const result = parsePushBatchResult(await post(workspaceRoute(request.workspaceId, "push"), request, signal));
  if (result.results.length !== request.operations.length || result.results.some((receipt, index) => receipt.workspaceId !== request.workspaceId || receipt.operationId !== request.operations[index]!.operationId)) throw new Error("A push response does not match its request.");
  return result;
}

export async function negotiateWeb2ChunkUpload(requestValue: ChunkUploadRequest, directBlobOrigin: string, signal?: AbortSignal): Promise<ChunkUploadResult> {
  const request = await parseChunkUploadRequest(requestValue);
  const result = await parseChunkUploadResult(await post(workspaceRoute(request.workspaceId, "chunks/uploads"), request, signal), request.manifest, directBlobOrigin);
  if (result.workspaceId !== request.workspaceId || result.deviceId !== request.deviceId || result.operationId !== request.operationId || result.manifestHash !== request.manifestHash) throw new Error("A chunk upload response does not match its request.");
  return result;
}

export async function negotiateWeb2ChunkDownload(requestValue: ChunkDownloadRequest, directBlobOrigin: string, signal?: AbortSignal): Promise<ChunkDownloadResult> {
  const request = parseChunkDownloadRequest(requestValue);
  const result = await parseChunkDownloadResult(await post(workspaceRoute(request.workspaceId, "chunks/downloads"), request, signal), directBlobOrigin);
  if (result.workspaceId !== request.workspaceId || result.deviceId !== request.deviceId || result.manifestHash !== request.manifestHash) throw new Error("A chunk download response does not match its request.");
  return result;
}

export async function uploadWeb2Chunk(descriptor: ChunkTransferDescriptor<"PUT">, bytes: Uint8Array, signal?: AbortSignal) {
  if (bytes.byteLength !== descriptor.size || await sha256Hex(bytes) !== descriptor.hash) throw new Error("A local chunk does not match its transfer descriptor.");
  const response = await fetch(descriptor.url, { method: "PUT", credentials: "omit", headers: descriptor.headers, body: Uint8Array.from(bytes).buffer, signal });
  if (!response.ok) throw new Error(`Chunk upload failed with status ${response.status}.`);
}

export async function downloadWeb2Chunk(descriptor: ChunkTransferDescriptor<"GET">, signal?: AbortSignal) {
  const response = await fetch(descriptor.url, { method: "GET", credentials: "omit", headers: descriptor.headers, cache: "no-store", signal });
  if (!response.ok) throw new Error(`Chunk download failed with status ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== descriptor.size || await sha256Hex(bytes) !== descriptor.hash) throw new Error("A downloaded chunk does not match its transfer descriptor.");
  return bytes;
}

function eventData(block: string) {
  const lines = block.split(/\r?\n/).filter((line) => line.startsWith("data:"));
  return lines.length === 0 ? null : lines.map((line) => line.slice(5).replace(/^ /, "")).join("\n");
}

export async function listenForWeb2Events(signal: AbortSignal, receive: (event: AccountEventHint) => void | Promise<void>) {
  const response = await fetch(`/api/sync/events?protocol=${encodeURIComponent(WEB2_SYNC_PROTOCOL)}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL },
    signal,
  });
  if (!response.ok) throw new Web2HTTPError(response.status);
  if (response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/event-stream" || !response.body) throw new Error("The synchronization event stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop()!;
      for (const block of blocks) {
        if (block.length > 64 * 1024) throw new Error("The synchronization event stream exceeded its message limit.");
        const data = eventData(block);
        if (data !== null) await receive(parseAccountEventHint(JSON.parse(data)));
        if (signal.aborted) return;
      }
      if (buffer.length > 64 * 1024) throw new Error("The synchronization event stream exceeded its message limit.");
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!signal.aborted) throw new Error("The synchronization event stream ended unexpectedly.");
}

export const web2ProtocolMetadata = { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL } as const;

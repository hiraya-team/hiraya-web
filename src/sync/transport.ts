import { WEB2_MAX_BATCH_ITEMS, WEB2_SCHEMA_VERSION, isRecord, parseNonNegativeSafeInteger, parsePositiveSafeInteger, parseSha256, parseStableId, sha256Hex } from "../filesystem/model";
import { AccountAppsRequestError, parseAccountAppDataKey, parseAccountAppId } from "../lib/account-app-contract";
import {
  WEB2_PROTOCOL_HEADER,
  WEB2_OPERATION_HEADER,
  WEB2_SYNC_PROTOCOL,
  parseWeb2EventHint,
  parseWeb2AccountAppData,
  parseWeb2AccountAppDataRequest,
  parseWeb2AccountAppGenerationRequest,
  parseWeb2AccountAppHandlersRequest,
  parseWeb2AccountAppInstallRequest,
  parseWeb2AccountAppPackage,
  parseWeb2AccountAppsSnapshot,
  parseBootstrap,
  parseBootstrapRequest,
  parseChunkDownloadRequest,
  parseChunkDownloadResult,
  parseChunkUploadRequest,
  parseChunkUploadResult,
  parseHydrationPage,
  parseHydrationRequest,
  parseInvitationList,
  parseInvitationRequest,
  parsePullRequest,
  parsePullResult,
  parsePublicationRequest,
  parsePublicationState,
  parsePublicNodeContent,
  parsePublicWeb2ThumbnailDescriptor,
  parsePublicWorkspacePage,
  parseNodePublicationRequest,
  parsePushBatchResult,
  parsePushRequest,
  parseSharingMemberRequest,
  parseSharingRoleRequest,
  parseSharingState,
  parseShortLinkList,
  parseShortLinkRequest,
  parseWeb2Session,
  parseWeb2ThumbnailDescriptor,
  parseWeb2ThumbnailPending,
  parseWeb2ActivityResponse,
  parseWeb2SearchResponse,
  parseWorkspaceCreateRequest,
  parseWorkspaceInvitationList,
  parseWorkspaceInvitationRequest,
  parseWorkspacePreferencesRequest,
  parseWorkspaceRenameRequest,
  type Web2EventHint,
  type Web2AccountApp,
  type Web2AccountAppDataRequest,
  type Web2AccountAppInstallRequest,
  type Web2AccountAppsSnapshot,
  type Bootstrap,
  type BootstrapRequest,
  type ChunkDownloadRequest,
  type ChunkDownloadResult,
  type ChunkTransferDescriptor,
  type ChunkUploadRequest,
  type ChunkUploadResult,
  type HydrationPage,
  type HydrationRequest,
  type InvitationList,
  type InvitationRequest,
  type PullRequest,
  type PullResult,
  type PublicationRequest,
  type PublicationState,
  type PublicNodeContent,
  type PublicWeb2ThumbnailDescriptor,
  type PublicWorkspacePage,
  type NodePublicationRequest,
  type PushBatchResult,
  type PushRequest,
  type SharingMemberRequest,
  type SharingRoleRequest,
  type SharingState,
  type ShortLinkList,
  type ShortLinkRequest,
  type Web2Session,
  type Web2ThumbnailDescriptor,
  type Web2ThumbnailPending,
  type Web2ActivityResponse,
  type Web2SearchResponse,
  type WorkspaceCreateRequest,
  type WorkspaceInvitationList,
  type WorkspaceInvitationRequest,
  type WorkspacePreferencesRequest,
  type WorkspaceRenameRequest,
} from "./protocol";

export class Web2HTTPError extends Error {
  constructor(readonly status: number, message?: string, readonly code: string | null = null) {
		super(message ?? (status === 401 ? "Authentication is required." : `Synchronization request failed with status ${status}.`));
    this.name = "Web2HTTPError";
  }
}

async function web2HTTPError(response: Response) {
  let payload: unknown = null;
  const contentLength = Number(response.headers.get("Content-Length"));
  try {
    if (response.body && (!Number.isFinite(contentLength) || contentLength <= 64 * 1024)) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
      if (size <= 64 * 1024) {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        try { payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { /* Use the status fallback. */ }
      }
    } else if (response.body) {
      await response.body.cancel();
    }
  } catch { payload = null; }
  const message = isRecord(payload) && typeof payload.error === "string" && payload.error ? payload.error : undefined;
  const code = isRecord(payload) && typeof payload.code === "string" && payload.code ? payload.code : null;
  return new Web2HTTPError(response.status, message, code);
}

export class Web2NetworkError extends Error {
  constructor() {
    super("The synchronization network is unavailable.");
    this.name = "Web2NetworkError";
  }
}

async function networkFetch(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Web2NetworkError();
  }
}

async function responseJSON(response: Response, expectedStatus = 200) {
  if (response.status !== expectedStatus) throw await web2HTTPError(response);
  if (response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new Error("A synchronization response is not JSON.");
  try {
    return await response.json() as unknown;
  } catch {
    throw new Web2NetworkError();
  }
}

async function post(path: string, value: unknown, signal?: AbortSignal) {
  return responseJSON(await networkFetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL },
    body: JSON.stringify(value),
    signal,
  }));
}

async function control(operationIdValue: string, method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, expectedStatus: 201 | 204, value?: unknown, signal?: AbortSignal) {
  const operationId = parseStableId(operationIdValue, "The control operation ID is invalid.");
  const response = await networkFetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...(value === undefined ? {} : { "Content-Type": "application/json" }), [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL, [WEB2_OPERATION_HEADER]: operationId },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal,
  });
	if (response.status !== expectedStatus) throw await web2HTTPError(response);
  if (await response.text() !== "") throw new Error("A workspace control response is not empty.");
  return response;
}

function workspaceRoute(workspaceId: string, suffix: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/sync/${suffix}`;
}

export async function fetchWeb2Session(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Web2Session> {
  let response: Response;
  try {
    response = await fetchImpl("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Web2NetworkError();
  }
  return parseWeb2Session(await responseJSON(response));
}

function accountAppsRoute(accountId: string, appId?: string, suffix = "") {
  return `/api/accounts/${encodeURIComponent(accountId)}/apps${appId === undefined ? "" : `/${encodeURIComponent(appId)}`}${suffix}`;
}

async function web2AccountAppControl(accountIdValue: string, operationIdValue: string, method: "PUT" | "DELETE", path: string, value: unknown, signal?: AbortSignal) {
  parseStableId(accountIdValue, "The account app account ID is invalid.");
  const operationId = parseStableId(operationIdValue, "The account app operation ID is invalid.");
  const response = await networkFetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL, [WEB2_OPERATION_HEADER]: operationId }, body: JSON.stringify(value), signal });
  if (response.status !== 204) {
    const payload = await response.json().catch(() => null) as unknown;
    const message = isRecord(payload) && typeof payload.error === "string" && payload.error ? payload.error : `Account apps could not be synchronized (${response.status}).`;
    const code = isRecord(payload) && typeof payload.code === "string" && payload.code ? payload.code : null;
    throw new AccountAppsRequestError(response.status, message, code);
  }
  if (await response.text() !== "") throw new Error("An account app control response is not empty.");
}

export async function fetchWeb2AccountApps(accountIdValue: string, signal?: AbortSignal): Promise<Web2AccountAppsSnapshot> {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const response = await networkFetch(accountAppsRoute(accountId), { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  const result = parseWeb2AccountAppsSnapshot(await responseJSON(response));
  if (result.accountId !== accountId) throw new Error("An account app inventory does not match its request.");
  return result;
}

export async function putWeb2AccountApp(accountIdValue: string, appIdValue: string, operationId: string, requestValue: Web2AccountAppInstallRequest, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const appId = parseAccountAppId(appIdValue);
  const request = parseWeb2AccountAppInstallRequest(requestValue);
  if (request.manifest.id !== appId) throw new Error("An account app installation does not match its route.");
  await web2AccountAppControl(accountId, operationId, "PUT", accountAppsRoute(accountId, appId), request, signal);
}

export async function deleteWeb2AccountApp(accountIdValue: string, appIdValue: string, operationId: string, installationGeneration: number, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const appId = parseAccountAppId(appIdValue);
  const request = parseWeb2AccountAppGenerationRequest({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, installationGeneration }, "installationGeneration");
  await web2AccountAppControl(accountId, operationId, "DELETE", accountAppsRoute(accountId, appId), request, signal);
}

export async function putWeb2AccountAppHandlers(accountIdValue: string, operationId: string, hints: Record<string, string>, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const request = parseWeb2AccountAppHandlersRequest({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, hints });
  await web2AccountAppControl(accountId, operationId, "PUT", `${accountAppsRoute(accountId)}/handlers`, request, signal);
}

export async function putWeb2AccountAppData(accountIdValue: string, appIdValue: string, keyValue: string, operationId: string, requestValue: Web2AccountAppDataRequest, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const appId = parseAccountAppId(appIdValue);
  const key = parseAccountAppDataKey(keyValue);
  const request = parseWeb2AccountAppDataRequest(requestValue);
  await web2AccountAppControl(accountId, operationId, "PUT", `${accountAppsRoute(accountId, appId)}/data/${encodeURIComponent(key)}`, request, signal);
}

export async function deleteWeb2AccountAppData(accountIdValue: string, appIdValue: string, keyValue: string, operationId: string, dataGeneration: number, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const appId = parseAccountAppId(appIdValue);
  const key = parseAccountAppDataKey(keyValue);
  const request = parseWeb2AccountAppGenerationRequest({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, dataGeneration }, "dataGeneration");
  await web2AccountAppControl(accountId, operationId, "DELETE", `${accountAppsRoute(accountId, appId)}/data/${encodeURIComponent(key)}`, request, signal);
}

export async function clearWeb2AccountAppData(accountIdValue: string, appIdValue: string, operationId: string, dataGeneration: number, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const appId = parseAccountAppId(appIdValue);
  const request = parseWeb2AccountAppGenerationRequest({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, dataGeneration }, "dataGeneration");
  await web2AccountAppControl(accountId, operationId, "DELETE", `${accountAppsRoute(accountId, appId)}/data`, request, signal);
}

export async function fetchWeb2AccountAppData(accountIdValue: string, app: Web2AccountApp, keyValue: string, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const appId = parseAccountAppId(app.appId);
  const key = parseAccountAppDataKey(keyValue);
  const expected = app.data.find((item) => item.key === key);
  if (!expected) return undefined;
  const response = await networkFetch(`${accountAppsRoute(accountId, appId)}/data/${encodeURIComponent(key)}`, { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  const result = await parseWeb2AccountAppData(await responseJSON(response));
  if (result.accountId !== accountId || result.appId !== appId || result.key !== key || result.dataGeneration !== expected.dataGeneration || result.revision !== expected.revision || result.size !== expected.size || result.sha256 !== expected.sha256) throw new Error("Account app data does not match its inventory metadata.");
  return result.value;
}

export async function downloadWeb2AccountAppPackage(accountIdValue: string, app: Web2AccountApp, directBlobOrigin: string, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The account app account ID is invalid.");
  const appId = parseAccountAppId(app.appId);
  const response = await networkFetch(`${accountAppsRoute(accountId, appId)}/package`, { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  const result = await parseWeb2AccountAppPackage(await responseJSON(response), directBlobOrigin);
  if (result.accountId !== accountId || result.appId !== appId || result.manifestHash !== app.package.manifestHash || result.size !== app.package.size || result.sha256 !== app.package.sha256 || JSON.stringify(result.appManifest) !== JSON.stringify(app.manifest)) throw new Error("An account app package does not match its inventory metadata.");
  const downloaded = new Map((await Promise.all(result.chunks.map(async (descriptor) => [descriptor.hash, await downloadWeb2Chunk(descriptor, signal)] as const))));
  const archiveBytes = new Uint8Array(result.size);
  let offset = 0;
  for (const chunk of result.manifest.chunks) {
    const bytes = downloaded.get(chunk.hash);
    if (!bytes || bytes.byteLength !== chunk.size || offset + bytes.byteLength > archiveBytes.byteLength) throw new Error("An account app package chunk is unavailable.");
    archiveBytes.set(bytes, offset);
    offset += bytes.byteLength;
  }
  if (offset !== archiveBytes.byteLength || await sha256Hex(archiveBytes) !== result.sha256) throw new Error("An account app package failed integrity validation.");
  const { inspectAppArchive } = await import("@hiraya-team/app-cli");
  const inspection = await inspectAppArchive(archiveBytes);
  if (inspection.digest !== result.sha256 || JSON.stringify(inspection.manifest) !== JSON.stringify(result.appManifest)) throw new Error("An account app package failed archive inspection.");
  return { archive: new Blob([archiveBytes], { type: "application/vnd.hiraya.app+zip" }), inspection };
}

export async function createWeb2Workspace(accountIdValue: string, operationId: string, requestValue: WorkspaceCreateRequest, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The workspace account ID is invalid.");
  const request = parseWorkspaceCreateRequest(requestValue);
  const response = await control(operationId, "POST", `/api/accounts/${encodeURIComponent(accountId)}/workspaces`, 201, request, signal);
  if (response.headers.get("Location") !== `/api/workspaces/${encodeURIComponent(request.id)}`) throw new Error("A workspace creation response has an invalid location.");
}

export async function renameWeb2Workspace(workspaceIdValue: string, operationId: string, requestValue: WorkspaceRenameRequest, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The workspace ID is invalid.");
  const request = parseWorkspaceRenameRequest(requestValue);
  await control(operationId, "PATCH", `/api/workspaces/${encodeURIComponent(workspaceId)}`, 204, request, signal);
}

export async function deleteWeb2Workspace(workspaceIdValue: string, operationId: string, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The workspace ID is invalid.");
  await control(operationId, "DELETE", `/api/workspaces/${encodeURIComponent(workspaceId)}`, 204, undefined, signal);
}

export async function setWeb2WorkspacePreferences(accountIdValue: string, operationId: string, requestValue: WorkspacePreferencesRequest, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The workspace account ID is invalid.");
  const request = parseWorkspacePreferencesRequest(requestValue);
  await control(operationId, "PUT", `/api/accounts/${encodeURIComponent(accountId)}/workspace-preferences`, 204, request, signal);
}

function sharingRoute(workspaceId: string, suffix = "") {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/sharing${suffix}`;
}

export async function fetchWeb2Sharing(workspaceIdValue: string, signal?: AbortSignal): Promise<SharingState> {
  const workspaceId = parseStableId(workspaceIdValue, "The sharing workspace ID is invalid.");
  const response = await networkFetch(sharingRoute(workspaceId), { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  const result = parseSharingState(await responseJSON(response));
  if (result.workspaceId !== workspaceId) throw new Error("A sharing response does not match its request.");
  return result;
}

export async function putWeb2SharingMember(workspaceIdValue: string, operationId: string, requestValue: SharingMemberRequest, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The sharing workspace ID is invalid.");
  await control(operationId, "PUT", sharingRoute(workspaceId, "/members"), 204, parseSharingMemberRequest(requestValue), signal);
}

export async function updateWeb2SharingMember(workspaceIdValue: string, userIdValue: string, operationId: string, requestValue: SharingRoleRequest, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The sharing workspace ID is invalid.");
  const userId = parseStableId(userIdValue, "The sharing user ID is invalid.");
  await control(operationId, "PUT", sharingRoute(workspaceId, `/members/${encodeURIComponent(userId)}`), 204, parseSharingRoleRequest(requestValue), signal);
}

export async function deleteWeb2SharingMember(workspaceIdValue: string, userIdValue: string, operationId: string, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The sharing workspace ID is invalid.");
  const userId = parseStableId(userIdValue, "The sharing user ID is invalid.");
  await control(operationId, "DELETE", sharingRoute(workspaceId, `/members/${encodeURIComponent(userId)}`), 204, undefined, signal);
}

export async function putWeb2SharingAudience(workspaceIdValue: string, operationId: string, requestValue: SharingRoleRequest, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The sharing workspace ID is invalid.");
  await control(operationId, "PUT", sharingRoute(workspaceId, "/audience"), 204, parseSharingRoleRequest(requestValue), signal);
}

export async function deleteWeb2SharingAudience(workspaceIdValue: string, operationId: string, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The sharing workspace ID is invalid.");
  await control(operationId, "DELETE", sharingRoute(workspaceId, "/audience"), 204, undefined, signal);
}

export async function searchWeb2(query: string, limit = 50, signal?: AbortSignal): Promise<Web2SearchResponse> {
  if (typeof query !== "string" || [...query].length < 1 || [...query].length > 200 || !query.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("The search request is invalid.");
  const response = await networkFetch(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`, { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  return parseWeb2SearchResponse(await responseJSON(response), query);
}

export async function fetchWeb2Activity(query: { before?: number; limit?: number; workspaceId?: string; q?: string } = {}, signal?: AbortSignal): Promise<Web2ActivityResponse> {
  const parameters = new URLSearchParams();
  const limit = query.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("The activity limit is invalid.");
  parameters.set("limit", String(limit));
  if (query.before !== undefined) parameters.set("before", String(parsePositiveSafeInteger(query.before, "The activity cursor is invalid.")));
  if (query.workspaceId !== undefined) parameters.set("workspaceId", parseStableId(query.workspaceId, "The activity workspace ID is invalid."));
  if (query.q !== undefined) {
    if (typeof query.q !== "string" || [...query.q].length > 200) throw new Error("The activity query is invalid.");
    parameters.set("q", query.q);
  }
  const response = await networkFetch(`/api/activity?${parameters}`, { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  return parseWeb2ActivityResponse(await responseJSON(response));
}

function publicationRoute(workspaceId: string, nodeId?: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/publication${nodeId === undefined ? "" : `/nodes/${encodeURIComponent(nodeId)}`}`;
}

export async function fetchWeb2Publication(workspaceIdValue: string, signal?: AbortSignal): Promise<PublicationState> {
  const workspaceId = parseStableId(workspaceIdValue, "The publication workspace ID is invalid.");
  const response = await networkFetch(publicationRoute(workspaceId), { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  const result = parsePublicationState(await responseJSON(response));
  if (result.workspaceId !== workspaceId) throw new Error("A publication response does not match its request.");
  return result;
}

export async function putWeb2Publication(workspaceIdValue: string, operationId: string, requestValue: PublicationRequest, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The publication workspace ID is invalid.");
  await control(operationId, "PUT", publicationRoute(workspaceId), 204, parsePublicationRequest(requestValue), signal);
}

export async function deleteWeb2Publication(workspaceIdValue: string, operationId: string, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The publication workspace ID is invalid.");
  await control(operationId, "DELETE", publicationRoute(workspaceId), 204, undefined, signal);
}

export async function putWeb2NodePublication(workspaceIdValue: string, nodeIdValue: string, operationId: string, requestValue: NodePublicationRequest, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The publication workspace ID is invalid.");
  const nodeId = parseStableId(nodeIdValue, "The published node ID is invalid.");
  await control(operationId, "PUT", publicationRoute(workspaceId, nodeId), 204, parseNodePublicationRequest(requestValue), signal);
}

export async function deleteWeb2NodePublication(workspaceIdValue: string, nodeIdValue: string, operationId: string, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The publication workspace ID is invalid.");
  const nodeId = parseStableId(nodeIdValue, "The published node ID is invalid.");
  await control(operationId, "DELETE", publicationRoute(workspaceId, nodeId), 204, undefined, signal);
}

function publicAlias(value: string) {
  return parseNodePublicationRequest({ ...web2ProtocolMetadata, alias: value }).alias;
}

function publicWorkspaceRoute(workspaceAlias: string, itemAlias?: string) {
  return `/api/public/workspaces/${encodeURIComponent(workspaceAlias)}${itemAlias === undefined ? "" : `/items/${encodeURIComponent(itemAlias)}`}`;
}

export async function fetchPublicWorkspacePage(workspaceAliasValue: string, options: { itemAlias?: string; asOf?: number; after?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PublicWorkspacePage> {
  const workspaceAlias = publicAlias(workspaceAliasValue);
  const itemAlias = options.itemAlias === undefined ? undefined : publicAlias(options.itemAlias);
  const parameters = new URLSearchParams();
  if (options.after !== undefined) {
    parameters.set("after", parseStableId(options.after, "The public page cursor is invalid."));
    if (options.asOf === undefined) throw new Error("A public page continuation requires its snapshot sequence.");
  }
  if (options.asOf !== undefined) parameters.set("asOf", String(parseNonNegativeSafeInteger(options.asOf, "The public snapshot sequence is invalid.")));
  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > WEB2_MAX_BATCH_ITEMS) throw new Error("The public page limit is invalid.");
    parameters.set("limit", String(options.limit));
  }
  const query = parameters.size === 0 ? "" : `?${parameters}`;
  const response = await networkFetch(publicWorkspaceRoute(workspaceAlias, itemAlias) + query, { credentials: "omit", cache: "no-store", signal });
  const result = parsePublicWorkspacePage(await responseJSON(response));
  if (result.workspaceAlias !== workspaceAlias || result.itemAlias !== (itemAlias ?? null) || options.asOf !== undefined && result.asOf !== options.asOf) throw new Error("A public workspace response does not match its request.");
  return result;
}

export async function fetchPublicNodeContent(workspaceAliasValue: string, nodeIdValue: string, manifestHashValue: string, asOfValue: number, itemAliasValue?: string, signal?: AbortSignal): Promise<PublicNodeContent> {
  const workspaceAlias = publicAlias(workspaceAliasValue);
  const itemAlias = itemAliasValue === undefined ? undefined : publicAlias(itemAliasValue);
  const nodeId = parseStableId(nodeIdValue, "The public node ID is invalid.");
  const manifestHash = parseSha256(manifestHashValue, "The public manifest hash is invalid.");
  const asOf = parseNonNegativeSafeInteger(asOfValue, "The public snapshot sequence is invalid.");
  const parameters = new URLSearchParams({ manifestHash, asOf: String(asOf) });
  const response = await networkFetch(`${publicWorkspaceRoute(workspaceAlias, itemAlias)}/nodes/${encodeURIComponent(nodeId)}/content?${parameters}`, { credentials: "same-origin", cache: "no-store", signal });
  const result = await parsePublicNodeContent(await responseJSON(response));
  if (result.workspaceAlias !== workspaceAlias || result.itemAlias !== (itemAlias ?? null) || result.nodeId !== nodeId || result.manifestHash !== manifestHash || result.asOf !== asOf) throw new Error("A public file response does not match its request.");
  return result;
}

export type Web2ThumbnailFetchResult<T extends Web2ThumbnailDescriptor = Web2ThumbnailDescriptor> = { state: "pending"; value: Web2ThumbnailPending; retryAfterMs: number } | { state: "ready"; value: T };

function thumbnailRetryAfter(response: Response) {
  const header = response.headers.get("Retry-After");
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? Math.min(3_600_000, Math.ceil(seconds * 1_000)) : 250;
}

export async function fetchWeb2Thumbnail(workspaceIdValue: string, nodeIdValue: string, contentOperationIdValue: string, manifestHashValue: string, expectedOrigin: string, signal?: AbortSignal): Promise<Web2ThumbnailFetchResult> {
  const expected = { workspaceId: parseStableId(workspaceIdValue, "The thumbnail workspace ID is invalid."), nodeId: parseStableId(nodeIdValue, "The thumbnail node ID is invalid."), contentOperationId: parseStableId(contentOperationIdValue, "The thumbnail content operation ID is invalid."), manifestHash: parseSha256(manifestHashValue, "The thumbnail manifest hash is invalid.") };
  const parameters = new URLSearchParams({ contentOperationId: expected.contentOperationId, manifestHash: expected.manifestHash, profile: "thumbnail-v1" });
  const response = await networkFetch(`/api/workspaces/${encodeURIComponent(expected.workspaceId)}/nodes/${encodeURIComponent(expected.nodeId)}/thumbnail?${parameters}`, { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  const value = await responseJSON(response, response.status === 202 ? 202 : 200);
  if (response.status === 202) return { state: "pending", value: parseWeb2ThumbnailPending(value, expected), retryAfterMs: thumbnailRetryAfter(response) };
  if (response.status !== 200) throw new Web2HTTPError(response.status);
  return { state: "ready", value: parseWeb2ThumbnailDescriptor(value, expected, expectedOrigin) };
}

export async function fetchPublicWeb2Thumbnail(workspaceAliasValue: string, nodeIdValue: string, contentOperationIdValue: string, manifestHashValue: string, asOfValue: number, itemAliasValue?: string, signal?: AbortSignal): Promise<Web2ThumbnailFetchResult<PublicWeb2ThumbnailDescriptor>> {
  const workspaceAlias = publicAlias(workspaceAliasValue);
  const itemAlias = itemAliasValue === undefined ? undefined : publicAlias(itemAliasValue);
  const expected = { workspaceAlias, itemAlias: itemAlias ?? null, workspaceId: "", nodeId: parseStableId(nodeIdValue, "The public thumbnail node ID is invalid."), contentOperationId: parseStableId(contentOperationIdValue, "The public thumbnail content operation ID is invalid."), manifestHash: parseSha256(manifestHashValue, "The public thumbnail manifest hash is invalid."), asOf: parseNonNegativeSafeInteger(asOfValue, "The public thumbnail snapshot is invalid.") };
  const parameters = new URLSearchParams({ contentOperationId: expected.contentOperationId, manifestHash: expected.manifestHash, profile: "thumbnail-v1", asOf: String(expected.asOf) });
  const response = await networkFetch(`${publicWorkspaceRoute(workspaceAlias, itemAlias)}/nodes/${encodeURIComponent(expected.nodeId)}/thumbnail?${parameters}`, { credentials: "omit", cache: "no-store", signal });
  const value = await responseJSON(response, response.status === 202 ? 202 : 200);
  if (response.status === 202) {
    if (!isRecord(value)) throw new Error("A pending public thumbnail response has an unsupported shape.");
    const workspaceId = parseStableId(value.workspaceId, "A pending public thumbnail workspace ID is invalid.");
    return { state: "pending", value: parseWeb2ThumbnailPending(value, { workspaceId, nodeId: expected.nodeId }), retryAfterMs: thumbnailRetryAfter(response) };
  }
  if (response.status !== 200) throw new Web2HTTPError(response.status);
  if (!isRecord(value)) throw new Error("A public thumbnail descriptor has an unsupported shape.");
  expected.workspaceId = parseStableId(value.workspaceId, "A public thumbnail workspace ID is invalid.");
  return { state: "ready", value: parsePublicWeb2ThumbnailDescriptor(value, expected) };
}

function shortLinkRoute(accountId: string, slug?: string) {
  return `/api/accounts/${encodeURIComponent(accountId)}/short-links${slug === undefined ? "" : `/${encodeURIComponent(slug)}`}`;
}

export async function fetchWeb2ShortLinks(accountIdValue: string, signal?: AbortSignal): Promise<ShortLinkList> {
  const accountId = parseStableId(accountIdValue, "The short-link account ID is invalid.");
  const response = await networkFetch(shortLinkRoute(accountId), { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  const result = parseShortLinkList(await responseJSON(response));
  if (result.accountId !== accountId) throw new Error("A short-link response does not match its request.");
  return result;
}

export async function putWeb2ShortLink(accountIdValue: string, operationId: string, requestValue: ShortLinkRequest, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The short-link account ID is invalid.");
  const request = parseShortLinkRequest(requestValue);
  await control(operationId, "PUT", shortLinkRoute(accountId, request.slug), 204, request, signal);
}

export async function deleteWeb2ShortLink(accountIdValue: string, slugValue: string, operationId: string, signal?: AbortSignal) {
  const accountId = parseStableId(accountIdValue, "The short-link account ID is invalid.");
  const slug = publicAlias(slugValue);
  await control(operationId, "DELETE", shortLinkRoute(accountId, slug), 204, undefined, signal);
}

export function createWeb2InvitationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function fetchWeb2Invitations(signal?: AbortSignal): Promise<InvitationList> {
  const response = await networkFetch("/api/admin/invitations", { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  return parseInvitationList(await responseJSON(response));
}

export async function putWeb2Invitation(operationId: string, requestValue: InvitationRequest, signal?: AbortSignal) {
  const request = parseInvitationRequest(requestValue);
  await control(operationId, "PUT", `/api/admin/invitations/${encodeURIComponent(request.id)}`, 204, request, signal);
}

export async function deleteWeb2Invitation(invitationIdValue: string, operationId: string, signal?: AbortSignal) {
  const invitationId = parseStableId(invitationIdValue, "The invitation ID is invalid.");
  await control(operationId, "DELETE", `/api/admin/invitations/${encodeURIComponent(invitationId)}`, 204, undefined, signal);
}

function workspaceInvitationRoute(workspaceId: string, invitationId?: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/sharing/invitations${invitationId === undefined ? "" : `/${encodeURIComponent(invitationId)}`}`;
}

export async function fetchWeb2WorkspaceInvitations(workspaceIdValue: string, signal?: AbortSignal): Promise<WorkspaceInvitationList> {
  const workspaceId = parseStableId(workspaceIdValue, "The workspace invitation workspace ID is invalid.");
  const response = await networkFetch(workspaceInvitationRoute(workspaceId), { credentials: "same-origin", cache: "no-store", headers: { [WEB2_PROTOCOL_HEADER]: WEB2_SYNC_PROTOCOL }, signal });
  const result = parseWorkspaceInvitationList(await responseJSON(response));
  if (result.workspaceId !== workspaceId) throw new Error("A workspace invitation response does not match its request.");
  return result;
}

export async function putWeb2WorkspaceInvitation(workspaceIdValue: string, operationId: string, requestValue: WorkspaceInvitationRequest, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The workspace invitation workspace ID is invalid.");
  const request = parseWorkspaceInvitationRequest(requestValue);
  await control(operationId, "PUT", workspaceInvitationRoute(workspaceId, request.id), 204, request, signal);
}

export async function deleteWeb2WorkspaceInvitation(workspaceIdValue: string, invitationIdValue: string, operationId: string, signal?: AbortSignal) {
  const workspaceId = parseStableId(workspaceIdValue, "The workspace invitation workspace ID is invalid.");
  const invitationId = parseStableId(invitationIdValue, "The workspace invitation ID is invalid.");
  await control(operationId, "DELETE", workspaceInvitationRoute(workspaceId, invitationId), 204, undefined, signal);
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
  const result = await parseChunkDownloadResult(await post(workspaceRoute(request.workspaceId, "chunks/downloads"), request, signal), directBlobOrigin, request.haveChunks);
  if (result.workspaceId !== request.workspaceId || result.deviceId !== request.deviceId || result.manifestHash !== request.manifestHash) throw new Error("A chunk download response does not match its request.");
  return result;
}

export async function uploadWeb2Chunk(descriptor: ChunkTransferDescriptor<"PUT">, bytes: Uint8Array, signal?: AbortSignal) {
  if (bytes.byteLength !== descriptor.size || await sha256Hex(bytes) !== descriptor.hash) throw new Error("A local chunk does not match its transfer descriptor.");
  const response = await networkFetch(descriptor.url, { method: "PUT", credentials: "omit", headers: descriptor.headers, body: Uint8Array.from(bytes).buffer, redirect: "error", referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Web2HTTPError(response.status);
}

export async function downloadWeb2Chunk(descriptor: ChunkTransferDescriptor<"GET">, signal?: AbortSignal) {
  const response = await networkFetch(descriptor.url, { method: "GET", credentials: "omit", headers: descriptor.headers, cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Web2HTTPError(response.status);
  if (!response.body || Number(response.headers.get("Content-Length")) > descriptor.size) throw new Error("A downloaded chunk exceeds its transfer descriptor.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > descriptor.size) {
      await reader.cancel();
      throw new Error("A downloaded chunk exceeds its transfer descriptor.");
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  if (bytes.byteLength !== descriptor.size || await sha256Hex(bytes) !== descriptor.hash) throw new Error("A downloaded chunk does not match its transfer descriptor.");
  return bytes;
}

function eventData(block: string) {
  const lines = block.split(/\r?\n/).filter((line) => line.startsWith("data:"));
  return lines.length === 0 ? null : lines.map((line) => line.slice(5).replace(/^ /, "")).join("\n");
}

export async function listenForWeb2Events(signal: AbortSignal, receive: (event: Web2EventHint) => void | Promise<void>, directoryRevision = 0) {
  if (!Number.isSafeInteger(directoryRevision) || directoryRevision < 0) throw new Error("The directory revision is invalid.");
  const response = await networkFetch(`/api/sync/events?protocol=${encodeURIComponent(WEB2_SYNC_PROTOCOL)}&directoryRevision=${directoryRevision}`, {
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
        if (data !== null) await receive(parseWeb2EventHint(JSON.parse(data)));
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

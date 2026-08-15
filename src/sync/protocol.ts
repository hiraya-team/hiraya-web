import {
  WEB2_CHUNK_SIZE,
  WEB2_MAX_ANCESTRY_DEPTH,
  WEB2_MAX_BATCH_ITEMS,
  WEB2_SCHEMA_VERSION,
  assertExactKeys,
  canonicalManifestSha256,
  isRecord,
  parseCanonicalName,
  parseManifest,
  parseNode,
  parseNonNegativeSafeInteger,
  parsePositiveSafeInteger,
  parseSetting,
  parseSettingKey,
  parseSettingNamespace,
  parseSha256,
  parseStableId,
  type Manifest,
  type Node,
  type Setting,
  type SettingNamespace,
} from "../filesystem/model";
import { parseWorkspaceOperation, type WorkspaceOperation } from "../filesystem/operations";

export const WEB2_SYNC_PROTOCOL = "web2-sync-v1" as const;
export const WEB2_PROTOCOL_HEADER = "X-Hiraya-Protocol" as const;

type TargetBase = { workspaceId: string; asOf: number };
export type HydrationTarget = TargetBase & (
  | { kind: "folder-page"; parentId: string | null; limit: number }
  | { kind: "exact-nodes"; nodeIds: string[] }
  | { kind: "ancestry"; nodeId: string; maxDepth: number }
  | { kind: "exact-settings"; namespace: SettingNamespace; keys: string[] }
  | { kind: "setting-namespace"; namespace: SettingNamespace; limit: number }
);
export type HydrationPage = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  workspaceId: string;
  deviceId: string;
  target: HydrationTarget;
  nodes: Node[];
  settings: Setting[];
  nextPageToken: string | null;
};
export type WorkspaceSummary = { id: string; name: string; pinned: boolean };
export type WorkspaceBootstrapState = WorkspaceSummary & { headSequence: number; snapshotBarrier: number; logFloor: number };
export type Bootstrap = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  accountId: string;
  deviceId: string;
  cursor: number;
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceBootstrapState;
  rootPage: HydrationPage;
  shellSettings: Setting[];
};
export type SequencedOperation = { sequence: number; operation: WorkspaceOperation };
export type PushRequest = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  workspaceId: string;
  deviceId: string;
  operations: WorkspaceOperation[];
};
type PullBase = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  workspaceId: string;
  deviceId: string;
  fromCursor: number;
  cursor: number;
  headSequence: number;
};
export type PullResult = PullBase & (
  | { kind: "operations"; operations: SequencedOperation[] }
  | { kind: "reset"; resetBarrier: number; pages: HydrationPage[] }
);
export type PushResult = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  workspaceId: string;
  operationId: string;
} & (
  | { kind: "accepted"; sequence: number; headSequence: number; outcome: "applied" | "superseded" }
  | { kind: "rejected"; code: "invalid" | "forbidden" | "quota" | "missing-chunks" | "not-found" | "operation-id-reuse"; message: string }
);
export type OperationReceipt = { operationId: string; inputHash: string; result: PushResult };
export type ChunkTransferDescriptor<Method extends "PUT" | "GET" = "PUT" | "GET"> = { hash: string; size: number; method: Method; url: string; headers: Record<string, string> };
export type ChunkUploadRequest = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  kind: "chunk-upload-request";
  workspaceId: string;
  deviceId: string;
  operationId: string;
  manifestHash: string;
  manifest: Manifest;
};
export type ChunkUploadResult = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  kind: "chunk-upload-result";
  workspaceId: string;
  deviceId: string;
  operationId: string;
  manifestHash: string;
  transferId: string;
  expiresAt: number;
  missingChunks: ChunkTransferDescriptor<"PUT">[];
};
export type ChunkDownloadRequest = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  kind: "chunk-download-request";
  workspaceId: string;
  deviceId: string;
  manifestHash: string;
  haveChunks: string[];
};
export type ChunkDownloadResult = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  kind: "chunk-download-result";
  workspaceId: string;
  deviceId: string;
  manifestHash: string;
  manifest: Manifest;
  chunks: ChunkTransferDescriptor<"GET">[];
};

function parseWireBase(value: Record<string, unknown>) {
  if (value.schemaVersion !== WEB2_SCHEMA_VERSION || value.protocol !== WEB2_SYNC_PROTOCOL) throw new Error("A synchronization message has unsupported protocol metadata.");
  return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL } as const;
}

function boundedIds(value: unknown, message: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error(message);
  const ids = value.map((id) => parseStableId(id, message));
  if (new Set(ids).size !== ids.length) throw new Error(message);
  return ids;
}

function boundedKeys(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A hydration setting-key batch is invalid.");
  const keys = value.map(parseSettingKey);
  if (new Set(keys).size !== keys.length) throw new Error("A hydration setting-key batch contains duplicates.");
  return keys;
}

function pageLimit(value: unknown) {
  const limit = parsePositiveSafeInteger(value, "A hydration page limit is invalid.");
  if (limit > WEB2_MAX_BATCH_ITEMS) throw new Error("A hydration page limit is invalid.");
  return limit;
}

export function parseHydrationTarget(value: unknown): HydrationTarget {
  if (!isRecord(value) || typeof value.kind !== "string") throw new Error("A hydration target has an unsupported shape.");
  const workspaceId = parseStableId(value.workspaceId, "A hydration workspace ID is invalid.");
  const asOf = parseNonNegativeSafeInteger(value.asOf, "A hydration sequence is invalid.");
  switch (value.kind) {
    case "folder-page":
      assertExactKeys(value, ["kind", "workspaceId", "asOf", "parentId", "limit"], "A folder hydration target has an unsupported shape.");
      return { kind: "folder-page", workspaceId, asOf, parentId: value.parentId === null ? null : parseStableId(value.parentId, "A hydrated folder ID is invalid."), limit: pageLimit(value.limit) };
    case "exact-nodes":
      assertExactKeys(value, ["kind", "workspaceId", "asOf", "nodeIds"], "An exact-node hydration target has an unsupported shape.");
      return { kind: "exact-nodes", workspaceId, asOf, nodeIds: boundedIds(value.nodeIds, "An exact-node hydration batch is invalid.") };
    case "ancestry": {
      assertExactKeys(value, ["kind", "workspaceId", "asOf", "nodeId", "maxDepth"], "An ancestry hydration target has an unsupported shape.");
      const maxDepth = parsePositiveSafeInteger(value.maxDepth, "An ancestry hydration depth is invalid.");
      if (maxDepth > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("An ancestry hydration depth is invalid.");
      return { kind: "ancestry", workspaceId, asOf, nodeId: parseStableId(value.nodeId, "An ancestry node ID is invalid."), maxDepth };
    }
    case "exact-settings":
      assertExactKeys(value, ["kind", "workspaceId", "asOf", "namespace", "keys"], "An exact-setting hydration target has an unsupported shape.");
      return { kind: "exact-settings", workspaceId, asOf, namespace: parseSettingNamespace(value.namespace), keys: boundedKeys(value.keys) };
    case "setting-namespace":
      assertExactKeys(value, ["kind", "workspaceId", "asOf", "namespace", "limit"], "A setting-namespace hydration target has an unsupported shape.");
      return { kind: "setting-namespace", workspaceId, asOf, namespace: parseSettingNamespace(value.namespace), limit: pageLimit(value.limit) };
    default:
      throw new Error("A hydration target kind is unsupported.");
  }
}

function parsePageToken(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 4096 || [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  })) throw new Error("A hydration page token is invalid.");
  return value;
}

function parseBoundedRecords<T>(value: unknown, parse: (candidate: unknown) => T, message: string) {
  if (!Array.isArray(value) || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error(message);
  return value.map(parse);
}

export function parseHydrationPage(value: unknown): HydrationPage {
  if (!isRecord(value)) throw new Error("A hydration page has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "deviceId", "target", "nodes", "settings", "nextPageToken"], "A hydration page has an unsupported shape.");
  const wire = parseWireBase(value);
  const workspaceId = parseStableId(value.workspaceId, "A hydration page workspace ID is invalid.");
  const deviceId = parseStableId(value.deviceId, "A hydration page device ID is invalid.");
  const target = parseHydrationTarget(value.target);
  const nodes = parseBoundedRecords(value.nodes, parseNode, "A hydration node page is invalid.");
  const settings = parseBoundedRecords(value.settings, parseSetting, "A hydration setting page is invalid.");
  if (target.workspaceId !== workspaceId || nodes.some((node) => node.workspaceId !== workspaceId) || settings.some((setting) => setting.workspaceId !== workspaceId)) throw new Error("A hydration page mixes workspaces.");
  if (new Set(nodes.map(({ id }) => id)).size !== nodes.length) throw new Error("A hydration page contains duplicate node IDs.");
  if (new Set(settings.map(({ namespace, key }) => `${namespace}\0${key}`)).size !== settings.length) throw new Error("A hydration page contains duplicate setting keys.");
  return { ...wire, workspaceId, deviceId, target, nodes, settings, nextPageToken: value.nextPageToken === null ? null : parsePageToken(value.nextPageToken) };
}

function parseWorkspaceSummary(value: unknown): WorkspaceSummary {
  if (!isRecord(value)) throw new Error("A workspace summary has an unsupported shape.");
  assertExactKeys(value, ["id", "name", "pinned"], "A workspace summary has an unsupported shape.");
  if (typeof value.pinned !== "boolean") throw new Error("A workspace summary has invalid pinning metadata.");
  return { id: parseStableId(value.id, "A workspace ID is invalid."), name: parseCanonicalName(value.name, "A workspace name is invalid."), pinned: value.pinned };
}

function parseWorkspaceState(value: unknown): WorkspaceBootstrapState {
  if (!isRecord(value)) throw new Error("A workspace bootstrap state has an unsupported shape.");
  assertExactKeys(value, ["id", "name", "pinned", "headSequence", "snapshotBarrier", "logFloor"], "A workspace bootstrap state has an unsupported shape.");
  const summary = parseWorkspaceSummary({ id: value.id, name: value.name, pinned: value.pinned });
  const headSequence = parseNonNegativeSafeInteger(value.headSequence, "A workspace head is invalid.");
  const snapshotBarrier = parseNonNegativeSafeInteger(value.snapshotBarrier, "A workspace snapshot barrier is invalid.");
  const logFloor = parseNonNegativeSafeInteger(value.logFloor, "A workspace log floor is invalid.");
  if (logFloor > snapshotBarrier || snapshotBarrier > headSequence) throw new Error("A workspace sequence range is invalid.");
  return { ...summary, headSequence, snapshotBarrier, logFloor };
}

export function parseBootstrap(value: unknown): Bootstrap {
  if (!isRecord(value)) throw new Error("A bootstrap response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "accountId", "deviceId", "cursor", "workspaces", "workspace", "rootPage", "shellSettings"], "A bootstrap response has an unsupported shape.");
  const wire = parseWireBase(value);
  const accountId = parseStableId(value.accountId, "A bootstrap account ID is invalid.");
  const deviceId = parseStableId(value.deviceId, "A bootstrap device ID is invalid.");
  const cursor = parseNonNegativeSafeInteger(value.cursor, "A bootstrap cursor is invalid.");
  if (!Array.isArray(value.workspaces) || value.workspaces.length === 0 || value.workspaces.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A bootstrap workspace directory is invalid.");
  const workspaces = value.workspaces.map(parseWorkspaceSummary);
  const workspace = parseWorkspaceState(value.workspace);
  const rootPage = parseHydrationPage(value.rootPage);
  const shellSettings = parseBoundedRecords(value.shellSettings, parseSetting, "Bootstrap shell settings are invalid.");
  if (new Set(workspaces.map(({ id }) => id)).size !== workspaces.length || !workspaces.some(({ id }) => id === workspace.id)) throw new Error("A bootstrap workspace directory is inconsistent.");
  if (cursor > workspace.headSequence || rootPage.workspaceId !== workspace.id || rootPage.deviceId !== deviceId || rootPage.target.kind !== "folder-page" || rootPage.target.parentId !== null || rootPage.target.asOf !== workspace.headSequence) throw new Error("A bootstrap root page is inconsistent.");
  if (shellSettings.some((setting) => setting.workspaceId !== workspace.id) || new Set(shellSettings.map(({ namespace, key }) => `${namespace}\0${key}`)).size !== shellSettings.length) throw new Error("Bootstrap shell settings are inconsistent.");
  return { ...wire, accountId, deviceId, cursor, workspaces, workspace, rootPage, shellSettings };
}

function parsePullBase(value: Record<string, unknown>): PullBase {
  const wire = parseWireBase(value);
  const fromCursor = parseNonNegativeSafeInteger(value.fromCursor, "A pull cursor is invalid.");
  const cursor = parseNonNegativeSafeInteger(value.cursor, "A pull cursor is invalid.");
  const headSequence = parseNonNegativeSafeInteger(value.headSequence, "A pull head is invalid.");
  if (cursor < fromCursor || headSequence < cursor) throw new Error("A pull sequence range is invalid.");
  return { ...wire, workspaceId: parseStableId(value.workspaceId, "A pull workspace ID is invalid."), deviceId: parseStableId(value.deviceId, "A pull device ID is invalid."), fromCursor, cursor, headSequence };
}

export function parsePullResult(value: unknown): PullResult {
  if (!isRecord(value) || value.kind !== "operations" && value.kind !== "reset") throw new Error("A pull result has an unsupported shape.");
  const baseKeys = ["schemaVersion", "protocol", "kind", "workspaceId", "deviceId", "fromCursor", "cursor", "headSequence"];
  if (value.kind === "operations") {
    assertExactKeys(value, [...baseKeys, "operations"], "An operation pull result has an unsupported shape.");
    const base = parsePullBase(value);
    const operations = parseBoundedRecords(value.operations, (candidate): SequencedOperation => {
      if (!isRecord(candidate)) throw new Error("A pulled operation has an unsupported shape.");
      assertExactKeys(candidate, ["sequence", "operation"], "A pulled operation has an unsupported shape.");
      return { sequence: parsePositiveSafeInteger(candidate.sequence, "A pulled operation sequence is invalid."), operation: parseWorkspaceOperation(candidate.operation) };
    }, "A pulled operation batch is invalid.");
    if (operations.some(({ operation }) => operation.workspaceId !== base.workspaceId || operation.deviceId === "") || operations.some(({ sequence }, index) => sequence <= base.fromCursor || sequence > base.cursor || index > 0 && operations[index - 1]!.sequence >= sequence) || operations.length > 0 && operations.at(-1)!.sequence !== base.cursor || operations.length === 0 && base.cursor !== base.fromCursor || new Set(operations.map(({ operation }) => operation.operationId)).size !== operations.length) throw new Error("A pulled operation batch is inconsistent.");
    return { ...base, kind: "operations", operations };
  }
  assertExactKeys(value, [...baseKeys, "resetBarrier", "pages"], "A reset pull result has an unsupported shape.");
  const base = parsePullBase(value);
  const resetBarrier = parseNonNegativeSafeInteger(value.resetBarrier, "A pull reset barrier is invalid.");
  if (!Array.isArray(value.pages) || value.pages.length === 0 || value.pages.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A pull reset page batch is invalid.");
  const pages = value.pages.map(parseHydrationPage);
  if (resetBarrier !== base.cursor || pages.some((page) => page.workspaceId !== base.workspaceId || page.deviceId !== base.deviceId || page.target.asOf !== resetBarrier)) throw new Error("A pull reset is inconsistent.");
  return { ...base, kind: "reset", resetBarrier, pages };
}

const PUSH_REJECTION_CODES = new Set(["invalid", "forbidden", "quota", "missing-chunks", "not-found", "operation-id-reuse"]);

export function parsePushResult(value: unknown): PushResult {
  if (!isRecord(value) || value.kind !== "accepted" && value.kind !== "rejected") throw new Error("A push result has an unsupported shape.");
  const baseKeys = ["schemaVersion", "protocol", "kind", "workspaceId", "operationId"];
  const wire = parseWireBase(value);
  const workspaceId = parseStableId(value.workspaceId, "A push workspace ID is invalid.");
  const operationId = parseStableId(value.operationId, "A pushed operation ID is invalid.");
  if (value.kind === "accepted") {
    assertExactKeys(value, [...baseKeys, "sequence", "headSequence", "outcome"], "An accepted push result has an unsupported shape.");
    const sequence = parsePositiveSafeInteger(value.sequence, "An accepted operation sequence is invalid.");
    const headSequence = parsePositiveSafeInteger(value.headSequence, "An accepted operation head is invalid.");
    if (headSequence < sequence || value.outcome !== "applied" && value.outcome !== "superseded") throw new Error("An accepted push result is invalid.");
    return { ...wire, kind: "accepted", workspaceId, operationId, sequence, headSequence, outcome: value.outcome };
  }
  assertExactKeys(value, [...baseKeys, "code", "message"], "A rejected push result has an unsupported shape.");
  if (typeof value.code !== "string" || !PUSH_REJECTION_CODES.has(value.code) || typeof value.message !== "string" || !value.message || value.message.length > 1024) throw new Error("A rejected push result is invalid.");
  return { ...wire, kind: "rejected", workspaceId, operationId, code: value.code as Extract<PushResult, { kind: "rejected" }>["code"], message: value.message };
}

export function parsePushRequest(value: unknown): PushRequest {
  if (!isRecord(value)) throw new Error("A push request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "deviceId", "operations"], "A push request has an unsupported shape.");
  const wire = parseWireBase(value);
  const workspaceId = parseStableId(value.workspaceId, "A push workspace ID is invalid.");
  const deviceId = parseStableId(value.deviceId, "A push device ID is invalid.");
  if (!Array.isArray(value.operations) || value.operations.length === 0 || value.operations.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A push operation batch is invalid.");
  const operations = value.operations.map(parseWorkspaceOperation);
  if (operations.some((operation) => operation.workspaceId !== workspaceId || operation.deviceId !== deviceId) || new Set(operations.map(({ operationId }) => operationId)).size !== operations.length) throw new Error("A push operation batch is inconsistent.");
  return { ...wire, workspaceId, deviceId, operations };
}

export function parseOperationReceipt(value: unknown): OperationReceipt {
  if (!isRecord(value)) throw new Error("An operation receipt has an unsupported shape.");
  assertExactKeys(value, ["operationId", "inputHash", "result"], "An operation receipt has an unsupported shape.");
  const operationId = parseStableId(value.operationId, "A receipt operation ID is invalid.");
  const result = parsePushResult(value.result);
  if (result.operationId !== operationId) throw new Error("An operation receipt has inconsistent identity.");
  return { operationId, inputHash: parseSha256(value.inputHash, "A receipt input hash is invalid."), result };
}

export function replayOperationReceipt(receipt: OperationReceipt, operationIdValue: unknown, inputHashValue: unknown): PushResult | null {
  const operationId = parseStableId(operationIdValue, "A replayed operation ID is invalid.");
  const inputHash = parseSha256(inputHashValue, "A replayed input hash is invalid.");
  if (operationId !== receipt.operationId) return null;
  if (inputHash === receipt.inputHash) return receipt.result;
  return {
    schemaVersion: WEB2_SCHEMA_VERSION,
    protocol: WEB2_SYNC_PROTOCOL,
    kind: "rejected",
    workspaceId: receipt.result.workspaceId,
    operationId,
    code: "operation-id-reuse",
    message: "The operation ID was reused with different canonical input.",
  };
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~\w-]+$/;
const FORBIDDEN_HEADERS = new Set(["authorization", "connection", "content-length", "cookie", "host", "origin", "referer", "transfer-encoding", "upgrade"]);

function parseTransferUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("A chunk transfer URL is invalid.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("A chunk transfer URL is invalid."); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback) || url.username || url.password || url.hash) throw new Error("A chunk transfer URL is unsafe.");
  return url.href;
}

function parseTransferHeaders(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > 16) throw new Error("Chunk transfer headers are invalid.");
  const seen = new Set<string>();
  return Object.fromEntries(Object.entries(value).map(([name, headerValue]) => {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name) || seen.has(lower) || FORBIDDEN_HEADERS.has(lower) || lower.startsWith("proxy-") || lower.startsWith("sec-") || typeof headerValue !== "string" || /[\r\n]/.test(headerValue)) throw new Error("Chunk transfer headers are unsafe.");
    seen.add(lower);
    return [name, headerValue];
  }));
}

function parseTransferDescriptors<Method extends "PUT" | "GET">(value: unknown, expectedMethod: Method) {
  if (!Array.isArray(value) || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A chunk transfer batch is invalid.");
  const descriptors = value.map((candidate): ChunkTransferDescriptor<Method> => {
    if (!isRecord(candidate)) throw new Error("A chunk transfer descriptor has an unsupported shape.");
    assertExactKeys(candidate, ["hash", "size", "method", "url", "headers"], "A chunk transfer descriptor has an unsupported shape.");
    const size = parsePositiveSafeInteger(candidate.size);
    if (size > WEB2_CHUNK_SIZE || candidate.method !== expectedMethod) throw new Error("A chunk transfer descriptor is invalid.");
    return { hash: parseSha256(candidate.hash), size, method: expectedMethod, url: parseTransferUrl(candidate.url), headers: parseTransferHeaders(candidate.headers) };
  });
  if (new Set(descriptors.map(({ hash }) => hash)).size !== descriptors.length) throw new Error("A chunk transfer batch contains duplicate hashes.");
  return descriptors;
}

export async function parseChunkUploadRequest(value: unknown): Promise<ChunkUploadRequest> {
  if (!isRecord(value) || value.kind !== "chunk-upload-request") throw new Error("A chunk upload request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "deviceId", "operationId", "manifestHash", "manifest"], "A chunk upload request has an unsupported shape.");
  const wire = parseWireBase(value);
  const manifest = parseManifest(value.manifest);
  const manifestHash = parseSha256(value.manifestHash, "A manifest hash is invalid.");
  if (await canonicalManifestSha256(manifest) !== manifestHash) throw new Error("A manifest hash does not match its canonical bytes.");
  return { ...wire, kind: "chunk-upload-request", workspaceId: parseStableId(value.workspaceId), deviceId: parseStableId(value.deviceId), operationId: parseStableId(value.operationId), manifestHash, manifest };
}

export async function parseChunkUploadResult(value: unknown, expectedManifestValue: unknown): Promise<ChunkUploadResult> {
  if (!isRecord(value) || value.kind !== "chunk-upload-result") throw new Error("A chunk upload result has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "deviceId", "operationId", "manifestHash", "transferId", "expiresAt", "missingChunks"], "A chunk upload result has an unsupported shape.");
  const wire = parseWireBase(value);
  const expectedManifest = parseManifest(expectedManifestValue);
  const manifestHash = parseSha256(value.manifestHash);
  if (await canonicalManifestSha256(expectedManifest) !== manifestHash) throw new Error("An upload result is for a different manifest.");
  const missingChunks = parseTransferDescriptors(value.missingChunks, "PUT");
  const refs = new Map(expectedManifest.chunks.map((chunk) => [chunk.hash, chunk.size]));
  if (missingChunks.some((chunk) => refs.get(chunk.hash) !== chunk.size)) throw new Error("An upload chunk is absent from its manifest.");
  return { ...wire, kind: "chunk-upload-result", workspaceId: parseStableId(value.workspaceId), deviceId: parseStableId(value.deviceId), operationId: parseStableId(value.operationId), manifestHash, transferId: parseStableId(value.transferId, "A chunk transfer ID is invalid."), expiresAt: parseNonNegativeSafeInteger(value.expiresAt, "A chunk transfer expiration is invalid."), missingChunks };
}

export function parseChunkDownloadRequest(value: unknown): ChunkDownloadRequest {
  if (!isRecord(value) || value.kind !== "chunk-download-request") throw new Error("A chunk download request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "deviceId", "manifestHash", "haveChunks"], "A chunk download request has an unsupported shape.");
  const wire = parseWireBase(value);
  if (!Array.isArray(value.haveChunks) || value.haveChunks.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A local chunk inventory is invalid.");
  const haveChunks = value.haveChunks.map((hash) => parseSha256(hash));
  if (new Set(haveChunks).size !== haveChunks.length) throw new Error("A local chunk inventory contains duplicate hashes.");
  return { ...wire, kind: "chunk-download-request", workspaceId: parseStableId(value.workspaceId), deviceId: parseStableId(value.deviceId), manifestHash: parseSha256(value.manifestHash), haveChunks };
}

export async function parseChunkDownloadResult(value: unknown): Promise<ChunkDownloadResult> {
  if (!isRecord(value) || value.kind !== "chunk-download-result") throw new Error("A chunk download result has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "deviceId", "manifestHash", "manifest", "chunks"], "A chunk download result has an unsupported shape.");
  const wire = parseWireBase(value);
  const manifest = parseManifest(value.manifest);
  const manifestHash = parseSha256(value.manifestHash);
  if (await canonicalManifestSha256(manifest) !== manifestHash) throw new Error("A manifest hash does not match its canonical bytes.");
  const chunks = parseTransferDescriptors(value.chunks, "GET");
  const refs = new Map(manifest.chunks.map((chunk) => [chunk.hash, chunk.size]));
  if (chunks.some((chunk) => refs.get(chunk.hash) !== chunk.size)) throw new Error("A downloaded chunk is absent from its manifest.");
  return { ...wire, kind: "chunk-download-result", workspaceId: parseStableId(value.workspaceId), deviceId: parseStableId(value.deviceId), manifestHash, manifest, chunks };
}

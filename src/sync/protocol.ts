import {
  WEB2_CHUNK_SIZE,
  WEB2_MAX_BATCH_ITEMS,
  WEB2_SCHEMA_VERSION,
  assertExactKeys,
  canonicalManifestSha256,
  isRecord,
  parseCanonicalName,
  parseManifest,
  parseNodeRecord,
  parseNonNegativeSafeInteger,
  parsePositiveSafeInteger,
  parseSetting,
  parseSha256,
  parseStableId,
  type Manifest,
  type NodeRecord,
  type Setting,
} from "../filesystem/model";
import { compareCanonicalStrings, parseHydrationPageData, parseHydrationPageToken, parseHydrationTarget, type HydrationPageData, type HydrationTarget } from "../filesystem/hydration";
export type { HydrationTarget } from "../filesystem/hydration";
export { parseHydrationTarget } from "../filesystem/hydration";
import { parseWorkspaceOperation, type WorkspaceOperation } from "../filesystem/operations";

export const WEB2_SYNC_PROTOCOL = "web2-sync-v1" as const;
export const WEB2_PROTOCOL_HEADER = "X-Hiraya-Protocol" as const;

export type HydrationPage = HydrationPageData & {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
};
export type HydrationRequest = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  workspaceId: string;
  deviceId: string;
  generationId: string;
  pageIndex: number;
  target: HydrationTarget;
  pageToken: string | null;
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
  workspaceSettings: Setting[];
};
export type PullRequest = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  workspaceId: string;
  deviceId: string;
  cursor: number;
};
export type PulledOperation = {
  sequence: number;
  operationId: string;
  companion: { workspaceId: string; sequence: number } | null;
  nodes: NodeRecord[];
  settings: Setting[];
};
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
  snapshotBarrier: number;
  logFloor: number;
  observedLogicalTime: number;
};
export type PullResult = PullBase & (
  | { kind: "operations"; operations: PulledOperation[] }
  | { kind: "reset"; resetBarrier: number }
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

export function parseHydrationRequest(value: unknown): HydrationRequest {
  if (!isRecord(value)) throw new Error("A hydration request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "deviceId", "generationId", "pageIndex", "target", "pageToken"], "A hydration request has an unsupported shape.");
  const wire = parseWireBase(value);
  const workspaceId = parseStableId(value.workspaceId, "A hydration request workspace ID is invalid.");
  const deviceId = parseStableId(value.deviceId, "A hydration request device ID is invalid.");
  const generationId = parseStableId(value.generationId, "A hydration generation ID is invalid.");
  const pageIndex = parseNonNegativeSafeInteger(value.pageIndex, "A hydration page index is invalid.");
  const target = parseHydrationTarget(value.target);
  const pageToken = value.pageToken === null ? null : parseHydrationPageToken(value.pageToken);
  if (target.workspaceId !== workspaceId || pageIndex === 0 !== (pageToken === null)) throw new Error("A hydration request has inconsistent pagination metadata.");
  if (target.kind !== "folder-page" && target.kind !== "setting-namespace" && (pageIndex !== 0 || pageToken !== null)) throw new Error("That hydration selector cannot paginate.");
  return { ...wire, workspaceId, deviceId, generationId, pageIndex, target, pageToken };
}

function parseBoundedRecords<T>(value: unknown, parse: (candidate: unknown) => T, message: string) {
  if (!Array.isArray(value) || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error(message);
  return value.map(parse);
}

export function parseHydrationPage(value: unknown): HydrationPage {
  if (!isRecord(value)) throw new Error("A hydration page has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "deviceId", "generationId", "pageIndex", "observedLogicalTime", "target", "nodes", "settings", "nextPageToken"], "A hydration page has an unsupported shape.");
  const wire = parseWireBase(value);
  return { ...wire, ...parseHydrationPageData(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "schemaVersion" && key !== "protocol"))) };
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
  assertExactKeys(value, ["schemaVersion", "protocol", "accountId", "deviceId", "cursor", "workspaces", "workspace", "rootPage", "workspaceSettings"], "A bootstrap response has an unsupported shape.");
  const wire = parseWireBase(value);
  const accountId = parseStableId(value.accountId, "A bootstrap account ID is invalid.");
  const deviceId = parseStableId(value.deviceId, "A bootstrap device ID is invalid.");
  const cursor = parseNonNegativeSafeInteger(value.cursor, "A bootstrap cursor is invalid.");
  if (!Array.isArray(value.workspaces) || value.workspaces.length === 0 || value.workspaces.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A bootstrap workspace directory is invalid.");
  const workspaces = value.workspaces.map(parseWorkspaceSummary);
  const workspace = parseWorkspaceState(value.workspace);
  const rootPage = parseHydrationPage(value.rootPage);
  const workspaceSettings = parseBoundedRecords(value.workspaceSettings, parseSetting, "Bootstrap workspace settings are invalid.");
  if (new Set(workspaces.map(({ id }) => id)).size !== workspaces.length || !workspaces.some(({ id }) => id === workspace.id)) throw new Error("A bootstrap workspace directory is inconsistent.");
  if (cursor > workspace.headSequence || rootPage.workspaceId !== workspace.id || rootPage.deviceId !== deviceId || rootPage.pageIndex !== 0 || rootPage.target.kind !== "folder-page" || rootPage.target.parentId !== null || rootPage.target.asOf !== workspace.headSequence) throw new Error("A bootstrap root page is inconsistent.");
  if (workspaceSettings.some((setting) => setting.workspaceId !== workspace.id) || new Set(workspaceSettings.map(({ namespace, key }) => `${namespace}\0${key}`)).size !== workspaceSettings.length) throw new Error("Bootstrap workspace settings are inconsistent.");
  return { ...wire, accountId, deviceId, cursor, workspaces, workspace, rootPage, workspaceSettings };
}

function parsePullBase(value: Record<string, unknown>): PullBase {
  const wire = parseWireBase(value);
  const fromCursor = parseNonNegativeSafeInteger(value.fromCursor, "A pull cursor is invalid.");
  const cursor = parseNonNegativeSafeInteger(value.cursor, "A pull cursor is invalid.");
  const headSequence = parseNonNegativeSafeInteger(value.headSequence, "A pull head is invalid.");
  const snapshotBarrier = parseNonNegativeSafeInteger(value.snapshotBarrier, "A pull snapshot barrier is invalid.");
  const logFloor = parseNonNegativeSafeInteger(value.logFloor, "A pull log floor is invalid.");
  const observedLogicalTime = parseNonNegativeSafeInteger(value.observedLogicalTime, "A pull observed logical time is invalid.");
  if (cursor < fromCursor || headSequence < cursor || logFloor > snapshotBarrier || snapshotBarrier > headSequence) throw new Error("A pull sequence range is invalid.");
  return { ...wire, workspaceId: parseStableId(value.workspaceId, "A pull workspace ID is invalid."), deviceId: parseStableId(value.deviceId, "A pull device ID is invalid."), fromCursor, cursor, headSequence, snapshotBarrier, logFloor, observedLogicalTime };
}

export function parsePullRequest(value: unknown): PullRequest {
  if (!isRecord(value)) throw new Error("A pull request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "deviceId", "cursor"], "A pull request has an unsupported shape.");
  return { ...parseWireBase(value), workspaceId: parseStableId(value.workspaceId, "A pull request workspace ID is invalid."), deviceId: parseStableId(value.deviceId, "A pull request device ID is invalid."), cursor: parseNonNegativeSafeInteger(value.cursor, "A pull request cursor is invalid.") };
}

export function parsePullResult(value: unknown): PullResult {
  if (!isRecord(value) || value.kind !== "operations" && value.kind !== "reset") throw new Error("A pull result has an unsupported shape.");
  const baseKeys = ["schemaVersion", "protocol", "kind", "workspaceId", "deviceId", "fromCursor", "cursor", "headSequence", "snapshotBarrier", "logFloor", "observedLogicalTime"];
  if (value.kind === "operations") {
    assertExactKeys(value, [...baseKeys, "operations"], "An operation pull result has an unsupported shape.");
    const base = parsePullBase(value);
    const operations = parseBoundedRecords(value.operations, (candidate): PulledOperation => {
      if (!isRecord(candidate)) throw new Error("A pulled operation has an unsupported shape.");
      assertExactKeys(candidate, ["sequence", "operationId", "companion", "nodes", "settings"], "A pulled operation has an unsupported shape.");
      const sequence = parsePositiveSafeInteger(candidate.sequence, "A pulled operation sequence is invalid.");
      const operationId = parseStableId(candidate.operationId, "A pulled operation ID is invalid.");
      let companion: PulledOperation["companion"] = null;
      if (candidate.companion !== null) {
        if (!isRecord(candidate.companion)) throw new Error("A pulled operation companion has an unsupported shape.");
        assertExactKeys(candidate.companion, ["workspaceId", "sequence"], "A pulled operation companion has an unsupported shape.");
        companion = { workspaceId: parseStableId(candidate.companion.workspaceId, "A pulled operation companion workspace ID is invalid."), sequence: parsePositiveSafeInteger(candidate.companion.sequence, "A pulled operation companion sequence is invalid.") };
      }
      if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.settings) || candidate.nodes.length + candidate.settings.length === 0 || candidate.nodes.length + candidate.settings.length > WEB2_MAX_BATCH_ITEMS || candidate.nodes.length > 0 && candidate.settings.length > 0) throw new Error("A pulled operation record batch is invalid.");
      const nodes = candidate.nodes.map(parseNodeRecord);
      const settings = candidate.settings.map(parseSetting);
      const settingIdentities = settings.map(({ namespace, key }) => `${namespace}\0${key}`);
      if (new Set(nodes.map(({ id }) => id)).size !== nodes.length || nodes.some(({ id }, index) => index > 0 && compareCanonicalStrings(nodes[index - 1]!.id, id) >= 0) || new Set(settingIdentities).size !== settings.length || settingIdentities.some((identity, index) => index > 0 && compareCanonicalStrings(settingIdentities[index - 1]!, identity) >= 0)) throw new Error("Pulled operation records are not canonically ordered.");
      return { sequence, operationId, companion, nodes, settings };
    }, "A pulled operation batch is invalid.");
    const logicalTimes = operations.flatMap(({ nodes, settings }) => [...nodes.flatMap((node) => "purged" in node ? [node.logicalTime] : Object.values(node.fieldTuples).flatMap((tuple) => tuple === null ? [] : [tuple.logicalTime])), ...settings.map(({ logicalTime }) => logicalTime)]);
    if (base.fromCursor < base.logFloor || operations.some(({ sequence }, index) => sequence !== base.fromCursor + index + 1) || operations.length > 0 && operations.at(-1)!.sequence !== base.cursor || operations.length === 0 && base.cursor !== base.fromCursor || base.cursor < base.headSequence && operations.length === 0 || new Set(operations.map(({ operationId }) => operationId)).size !== operations.length || logicalTimes.some((logicalTime) => logicalTime > base.observedLogicalTime) || operations.some(({ companion, nodes, settings }) => companion === null ? [...nodes, ...settings].some(({ workspaceId }) => workspaceId !== base.workspaceId) : companion.workspaceId === base.workspaceId || settings.length > 0 || nodes.some(({ workspaceId }) => workspaceId !== base.workspaceId && workspaceId !== companion.workspaceId))) throw new Error("A pulled operation batch is inconsistent.");
    return { ...base, kind: "operations", operations };
  }
  assertExactKeys(value, [...baseKeys, "resetBarrier"], "A reset pull result has an unsupported shape.");
  const base = parsePullBase(value);
  const resetBarrier = parseNonNegativeSafeInteger(value.resetBarrier, "A pull reset barrier is invalid.");
  if (base.fromCursor >= base.logFloor || resetBarrier !== base.cursor || resetBarrier !== base.snapshotBarrier) throw new Error("A pull reset is inconsistent.");
  return { ...base, kind: "reset", resetBarrier };
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

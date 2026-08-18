import {
  WEB2_CHUNK_SIZE,
  WEB2_BOOTSTRAP_SETTING_KEYS,
  WEB2_MAX_ANCESTRY_DEPTH,
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
  sha256Hex,
  type Manifest,
  type NodeRecord,
  type ActiveSetting,
  type Setting,
} from "../filesystem/model";
import { compareCanonicalStrings, parseHydrationPageData, parseHydrationPageToken, parseHydrationTarget, type HydrationPageData, type HydrationTarget } from "../filesystem/hydration";
export type { HydrationTarget } from "../filesystem/hydration";
export { parseHydrationTarget } from "../filesystem/hydration";
import { parseWorkspaceOperation, type WorkspaceOperation } from "../filesystem/operations";
import { parseJsonValue, parseManifestV2, type HirayaAppManifestV2, type JsonValue } from "@hiraya-team/apps-contracts";
import { parseAccountAppDataKey, parseAccountAppId } from "../lib/account-app-contract";
import { RESERVED_SYSTEM_APP_IDS } from "../apps/system-app-ids";
import type { Web2Session } from "./session";
export { parseWeb2Session } from "./session";
export type { AccountQuota, QuotaMeasure, Web2Session } from "./session";

export const WEB2_SYNC_PROTOCOL = "web2-sync-v1" as const;
export const WEB2_PROTOCOL_HEADER = "X-Hiraya-Protocol" as const;
export const WEB2_OPERATION_HEADER = "X-Hiraya-Operation-ID" as const;

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
export type BootstrapRequest = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  workspaceId: string;
  deviceId: string;
  generationId: string;
  rootLimit: number;
};
export type WorkspaceSummary = { id: string; name: string; pinned: boolean };
export type WorkspaceCreateRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; id: string; name: string };
export type WorkspaceRenameRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; name: string };
export type WorkspacePreferencesRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; workspaces: { id: string; pinned: boolean }[] };
export type SharingRole = "manager" | "writer" | "reader";
export type SharingMember = { userId: string; email: string; displayName: string; role: "owner" | SharingRole };
export type SharingState = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; workspaceId: string; members: SharingMember[]; audience: { kind: "authenticated-users"; role: SharingRole } | null };
export type SharingMemberRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; email: string; role: SharingRole };
export type SharingRoleRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; role: SharingRole };
export type Web2SearchResult = { accountId: string; workspaceId: string; workspaceName: string; node: NodeRecord; breadcrumbs: { id: string; name: string }[] };
export type Web2SearchResponse = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; query: string; limit: number; truncated: boolean; results: Web2SearchResult[] };
export type Web2ActivityItem = { id: number; accountId: string; workspaceId: string; workspaceName: string; sequence: number; operationId: string; kind: WorkspaceOperation["kind"]; timestamp: number; actor: Web2Session["user"]; nodeIds: string[] };
export type Web2ActivityResponse = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; activities: Web2ActivityItem[]; nextBefore: number | null };
export type PublicationRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; alias: string; shareEntire: boolean };
export type NodePublicationRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; alias: string };
export type PublicationState = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; workspaceId: string; alias: string | null; url: string | null; shareEntire: boolean; items: { nodeId: string; name: string; kind: "file" | "folder"; alias: string; url: string }[] };
export type PublicWorkspacePage = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; workspaceAlias: string; itemAlias: string | null; workspaceId: string; workspaceName: string; publishedRootId: string | null; asOf: number; owner: { id: string; displayName: string; avatar: string }; nodes: NodeRecord[]; settings: ActiveSetting[]; nextAfter: string | null };
export type PublicNodeContent = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; workspaceAlias: string; itemAlias: string | null; nodeId: string; asOf: number; manifestHash: string; manifest: Manifest; chunks: ChunkTransferDescriptor<"GET">[] };
export type ShortLinkRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; slug: string; destinationUrl: string; enabled: boolean };
export type ShortLink = { slug: string; url: string; destinationUrl: string; enabled: boolean; createdAt: number; updatedAt: number };
export type ShortLinkList = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; accountId: string; shortLinks: ShortLink[] };
export type Web2AccountAppGenerations = { installationGeneration: number; dataGeneration: number; itemRevision: number };
export type Web2AccountAppDataItem = { key: string; dataGeneration: number; revision: number; size: number; sha256: string };
export type Web2AccountApp = { appId: string; manifest: HirayaAppManifestV2; generations: Web2AccountAppGenerations; package: { manifestHash: string; size: number; sha256: string }; data: Web2AccountAppDataItem[] };
export type Web2AccountAppTombstone = { appId: string; generations: Web2AccountAppGenerations };
export type Web2AccountAppsSnapshot = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; accountId: string; appsRevision: number; handlerHints: Record<string, string>; apps: Web2AccountApp[]; tombstones: Web2AccountAppTombstone[] };
export type Web2AccountAppInstallRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; manifest: HirayaAppManifestV2; packageManifestHash: string; packageSize: number; packageSha256: string; installationGeneration: number; itemRevision: number };
export type Web2AccountAppDataRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; dataGeneration: number; value: JsonValue };
export type Web2AccountAppPackage = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; accountId: string; appId: string; appManifest: HirayaAppManifestV2; manifestHash: string; size: number; sha256: string; manifest: Manifest; chunks: ChunkTransferDescriptor<"GET">[] };
export type Web2AccountAppData = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; accountId: string; appId: string; key: string; dataGeneration: number; revision: number; size: number; sha256: string; value: JsonValue };
export type InvitationRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; id: string; token: string; email: string | null; expiresAt: number };
export type Invitation = { id: string; email: string | null; expiresAt: number; createdAt: number };
export type InvitationList = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; invitations: Invitation[] };
export type WorkspaceInvitationRequest = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; id: string; token: string; email: string; role: SharingRole };
export type WorkspaceInvitation = { id: string; email: string; role: SharingRole; createdAt: number };
export type WorkspaceInvitationList = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; workspaceId: string; invitations: WorkspaceInvitation[] };
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
export type PushBatchResult = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  results: PushResult[];
};
export type AccountEventHint = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  kind: "workspace-head";
  accountId: string;
  workspaceId: string;
  headSequence: number;
};
export type DirectoryEventHint = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; kind: "directory"; revision: number };
export type AccountAppsEventHint = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; kind: "account-apps"; accountId: string; appsRevision: number };
export type Web2EventHint = AccountEventHint | AccountAppsEventHint | DirectoryEventHint;
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
export type Web2ThumbnailDescriptor = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  kind: "thumbnail";
  workspaceId: string;
  nodeId: string;
  contentOperationId: string;
  manifestHash: string;
  profile: "thumbnail-v1";
  mimeType: "image/webp";
  width: number;
  height: number;
  size: number;
  sha256: string;
  access: { url: string; method: "GET"; headers: Record<string, string>; expiresAt: number };
};
export type PublicWeb2ThumbnailDescriptor = Web2ThumbnailDescriptor & { workspaceAlias: string; itemAlias: string | null; asOf: number };
export type Web2ThumbnailPending = { schemaVersion: typeof WEB2_SCHEMA_VERSION; protocol: typeof WEB2_SYNC_PROTOCOL; kind: "thumbnail"; workspaceId: string; nodeId: string; state: "pending" | "running" | "publishing" | "failed" | "deleting" };

function parseWireBase(value: Record<string, unknown>) {
  if (value.schemaVersion !== WEB2_SCHEMA_VERSION || value.protocol !== WEB2_SYNC_PROTOCOL) throw new Error("A synchronization message has unsupported protocol metadata.");
  return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL } as const;
}

export function parseBootstrapRequest(value: unknown): BootstrapRequest {
  if (!isRecord(value)) throw new Error("A bootstrap request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "deviceId", "generationId", "rootLimit"], "A bootstrap request has an unsupported shape.");
  const rootLimit = parsePositiveSafeInteger(value.rootLimit, "A bootstrap root limit is invalid.");
  if (rootLimit > WEB2_MAX_BATCH_ITEMS) throw new Error("A bootstrap root limit is invalid.");
  return { ...parseWireBase(value), workspaceId: parseStableId(value.workspaceId), deviceId: parseStableId(value.deviceId), generationId: parseStableId(value.generationId), rootLimit };
}

export function parseWorkspaceCreateRequest(value: unknown): WorkspaceCreateRequest {
  if (!isRecord(value)) throw new Error("A workspace creation request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "id", "name"], "A workspace creation request has an unsupported shape.");
  return { ...parseWireBase(value), id: parseStableId(value.id, "A workspace ID is invalid."), name: parseCanonicalName(value.name, "A workspace name is invalid.") };
}

export function parseWorkspaceRenameRequest(value: unknown): WorkspaceRenameRequest {
  if (!isRecord(value)) throw new Error("A workspace rename request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "name"], "A workspace rename request has an unsupported shape.");
  return { ...parseWireBase(value), name: parseCanonicalName(value.name, "A workspace name is invalid.") };
}

export function parseWorkspacePreferencesRequest(value: unknown): WorkspacePreferencesRequest {
  if (!isRecord(value)) throw new Error("A workspace preferences request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaces"], "A workspace preferences request has an unsupported shape.");
  if (!Array.isArray(value.workspaces) || value.workspaces.length === 0 || value.workspaces.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A workspace preference directory is invalid.");
  const workspaces = value.workspaces.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("A workspace preference has an unsupported shape.");
    assertExactKeys(candidate, ["id", "pinned"], "A workspace preference has an unsupported shape.");
    if (typeof candidate.pinned !== "boolean") throw new Error("A workspace preference is invalid.");
    return { id: parseStableId(candidate.id, "A workspace preference ID is invalid."), pinned: candidate.pinned };
  });
  if (new Set(workspaces.map(({ id }) => id)).size !== workspaces.length) throw new Error("A workspace preference directory contains duplicate IDs.");
  return { ...parseWireBase(value), workspaces };
}

function parseSharingRole(value: unknown): SharingRole {
  if (value !== "manager" && value !== "writer" && value !== "reader") throw new Error("A sharing role is invalid.");
  return value;
}

function parseDisplayName(value: unknown, message = "A display name is invalid.") {
  if (typeof value !== "string" || [...value].length < 1 || [...value].length > 100) throw new Error(message);
  return value;
}

export function parseSharingMemberRequest(value: unknown): SharingMemberRequest {
  if (!isRecord(value)) throw new Error("A sharing member request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "email", "role"], "A sharing member request has an unsupported shape.");
  if (typeof value.email !== "string" || !value.email.trim() || value.email.length > 320) throw new Error("A sharing email is invalid.");
  return { ...parseWireBase(value), email: value.email.trim().toLowerCase(), role: parseSharingRole(value.role) };
}

export function parseSharingRoleRequest(value: unknown): SharingRoleRequest {
  if (!isRecord(value)) throw new Error("A sharing role request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "role"], "A sharing role request has an unsupported shape.");
  return { ...parseWireBase(value), role: parseSharingRole(value.role) };
}

export function parseSharingState(value: unknown): SharingState {
  if (!isRecord(value)) throw new Error("A sharing response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "members", "audience"], "A sharing response has an unsupported shape.");
  if (!Array.isArray(value.members) || value.members.length === 0 || value.members.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A sharing member directory is invalid.");
  const members = value.members.map((candidate, index): SharingMember => {
    if (!isRecord(candidate)) throw new Error("A sharing member has an unsupported shape.");
    assertExactKeys(candidate, ["userId", "email", "displayName", "role"], "A sharing member has an unsupported shape.");
    if (typeof candidate.email !== "string" || !candidate.email || candidate.email.length > 320) throw new Error("A sharing member email is invalid.");
    const role = candidate.role === "owner" ? "owner" : parseSharingRole(candidate.role);
    if ((index === 0) !== (role === "owner")) throw new Error("A sharing member directory has an invalid owner.");
    return { userId: parseStableId(candidate.userId, "A sharing member ID is invalid."), email: candidate.email, displayName: parseDisplayName(candidate.displayName, "A sharing member name is invalid."), role };
  });
  if (new Set(members.map(({ userId }) => userId)).size !== members.length) throw new Error("A sharing member directory contains duplicate users.");
  let audience: SharingState["audience"] = null;
  if (value.audience !== null) {
    if (!isRecord(value.audience)) throw new Error("A sharing audience has an unsupported shape.");
    assertExactKeys(value.audience, ["kind", "role"], "A sharing audience has an unsupported shape.");
    if (value.audience.kind !== "authenticated-users") throw new Error("A sharing audience is invalid.");
    audience = { kind: "authenticated-users", role: parseSharingRole(value.audience.role) };
  }
  return { ...parseWireBase(value), workspaceId: parseStableId(value.workspaceId, "A sharing workspace ID is invalid."), members, audience };
}

export function parseWeb2SearchResponse(value: unknown, expectedQuery?: string): Web2SearchResponse {
  if (!isRecord(value)) throw new Error("A search response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "query", "limit", "truncated", "results"], "A search response has an unsupported shape.");
  const query = typeof value.query === "string" && [...value.query].length >= 1 && [...value.query].length <= 200 && value.query.trim() ? value.query : null;
  if (query === null || expectedQuery !== undefined && query !== expectedQuery) throw new Error("A search response has an invalid query.");
  const limit = parsePositiveSafeInteger(value.limit, "A search response has an invalid limit.");
  if (limit > 100 || typeof value.truncated !== "boolean" || !Array.isArray(value.results) || value.results.length > limit || value.truncated && value.results.length !== limit) throw new Error("A search response has invalid bounds.");
  const seen = new Set<string>();
  const results = value.results.map((candidate): Web2SearchResult => {
    if (!isRecord(candidate)) throw new Error("A search result has an unsupported shape.");
    assertExactKeys(candidate, ["accountId", "workspaceId", "workspaceName", "node", "breadcrumbs"], "A search result has an unsupported shape.");
    const accountId = parseStableId(candidate.accountId, "A search account ID is invalid.");
    const workspaceId = parseStableId(candidate.workspaceId, "A search workspace ID is invalid.");
    const node = parseNodeRecord(candidate.node);
    if ("purged" in node || node.workspaceId !== workspaceId || node.lifecycle.kind !== "active") throw new Error("A search node is invalid.");
    if (!Array.isArray(candidate.breadcrumbs) || candidate.breadcrumbs.length > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("Search breadcrumbs are invalid.");
    const breadcrumbIds = new Set<string>([node.id]);
    const breadcrumbs = candidate.breadcrumbs.map((part) => {
      if (!isRecord(part)) throw new Error("A search breadcrumb has an unsupported shape.");
      assertExactKeys(part, ["id", "name"], "A search breadcrumb has an unsupported shape.");
      const id = parseStableId(part.id, "A search breadcrumb ID is invalid.");
      if (breadcrumbIds.has(id)) throw new Error("Search breadcrumbs contain a cycle.");
      breadcrumbIds.add(id);
      return { id, name: parseCanonicalName(part.name, "A search breadcrumb name is invalid.") };
    });
    const key = `${workspaceId}\0${node.id}`;
    if (seen.has(key)) throw new Error("A search response contains duplicate nodes.");
    seen.add(key);
    return { accountId, workspaceId, workspaceName: parseCanonicalName(candidate.workspaceName, "A search workspace name is invalid."), node, breadcrumbs };
  });
  return { ...parseWireBase(value), query, limit, truncated: value.truncated, results };
}

const activityKinds = new Set<WorkspaceOperation["kind"]>(["create", "write", "copy", "rename", "move", "position", "transfer", "trash", "restore", "purge", "set", "set-many", "unset", "unset-many"]);

export function parseWeb2ActivityResponse(value: unknown): Web2ActivityResponse {
  if (!isRecord(value)) throw new Error("An activity response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "activities", "nextBefore"], "An activity response has an unsupported shape.");
  if (!Array.isArray(value.activities) || value.activities.length > 100) throw new Error("An activity response has invalid bounds.");
  let previous = Number.MAX_SAFE_INTEGER;
  const activities = value.activities.map((candidate): Web2ActivityItem => {
    if (!isRecord(candidate)) throw new Error("An activity item has an unsupported shape.");
    assertExactKeys(candidate, ["id", "accountId", "workspaceId", "workspaceName", "sequence", "operationId", "kind", "timestamp", "actor", "nodeIds"], "An activity item has an unsupported shape.");
    const id = parsePositiveSafeInteger(candidate.id, "An activity ID is invalid.");
    if (id >= previous || !activityKinds.has(candidate.kind as WorkspaceOperation["kind"])) throw new Error("An activity sequence is invalid.");
    previous = id;
    if (!isRecord(candidate.actor)) throw new Error("An activity actor has an unsupported shape.");
    assertExactKeys(candidate.actor, ["id", "email", "displayName", "deploymentAdmin"], "An activity actor has an unsupported shape.");
    if (typeof candidate.actor.email !== "string" || !candidate.actor.email || candidate.actor.email.length > 320 || typeof candidate.actor.deploymentAdmin !== "boolean") throw new Error("An activity actor is invalid.");
    if (!Array.isArray(candidate.nodeIds) || candidate.nodeIds.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Activity node IDs are invalid.");
    const nodeIds = candidate.nodeIds.map((nodeId) => parseStableId(nodeId, "An activity node ID is invalid."));
    if (new Set(nodeIds).size !== nodeIds.length) throw new Error("Activity node IDs contain duplicates.");
    return {
      id,
      accountId: parseStableId(candidate.accountId, "An activity account ID is invalid."),
      workspaceId: parseStableId(candidate.workspaceId, "An activity workspace ID is invalid."),
      workspaceName: parseCanonicalName(candidate.workspaceName, "An activity workspace name is invalid."),
      sequence: parsePositiveSafeInteger(candidate.sequence, "An activity workspace sequence is invalid."),
      operationId: parseStableId(candidate.operationId, "An activity operation ID is invalid."),
      kind: candidate.kind as WorkspaceOperation["kind"],
      timestamp: parseNonNegativeSafeInteger(candidate.timestamp, "An activity timestamp is invalid."),
      actor: { id: parseStableId(candidate.actor.id, "An activity actor ID is invalid."), email: candidate.actor.email, displayName: parseDisplayName(candidate.actor.displayName, "An activity actor name is invalid."), deploymentAdmin: candidate.actor.deploymentAdmin },
      nodeIds,
    };
  });
  const nextBefore = value.nextBefore === null ? null : parsePositiveSafeInteger(value.nextBefore, "An activity cursor is invalid.");
  if (nextBefore !== null && (activities.length === 0 || nextBefore !== activities[activities.length - 1]!.id)) throw new Error("An activity cursor is inconsistent.");
  return { ...parseWireBase(value), activities, nextBefore };
}

const publicationAliasPattern = /^(?=.{3,48}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/;

function parsePublicationAlias(value: unknown) {
  if (typeof value !== "string" || !publicationAliasPattern.test(value)) throw new Error("A publication alias is invalid.");
  return value;
}

export function parsePublicationRequest(value: unknown): PublicationRequest {
  if (!isRecord(value)) throw new Error("A publication request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "alias", "shareEntire"], "A publication request has an unsupported shape.");
  if (typeof value.shareEntire !== "boolean") throw new Error("A publication request is invalid.");
  return { ...parseWireBase(value), alias: parsePublicationAlias(value.alias), shareEntire: value.shareEntire };
}

export function parseNodePublicationRequest(value: unknown): NodePublicationRequest {
  if (!isRecord(value)) throw new Error("A node publication request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "alias"], "A node publication request has an unsupported shape.");
  return { ...parseWireBase(value), alias: parsePublicationAlias(value.alias) };
}

export function parsePublicationState(value: unknown): PublicationState {
  if (!isRecord(value)) throw new Error("A publication response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "alias", "url", "shareEntire", "items"], "A publication response has an unsupported shape.");
  if (typeof value.shareEntire !== "boolean" || !Array.isArray(value.items) || value.items.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A publication response is invalid.");
  let alias: string | null = null;
  let url: string | null = null;
  if (value.alias !== null || value.url !== null) {
    alias = parsePublicationAlias(value.alias);
    if (value.url !== `/published/${alias}`) throw new Error("A publication URL is invalid.");
    url = value.url;
  }
  if (value.shareEntire && alias === null) throw new Error("A publication response is inconsistent.");
  const seenNodes = new Set<string>();
  const seenAliases = new Set<string>();
  const items = value.items.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("A published item has an unsupported shape.");
    assertExactKeys(candidate, ["nodeId", "name", "kind", "alias", "url"], "A published item has an unsupported shape.");
    const nodeId = parseStableId(candidate.nodeId, "A published node ID is invalid.");
    const itemAlias = parsePublicationAlias(candidate.alias);
    const kind = candidate.kind;
    if (alias === null || kind !== "file" && kind !== "folder" || candidate.url !== `/published/${alias}/${itemAlias}` || seenNodes.has(nodeId) || seenAliases.has(itemAlias)) throw new Error("A published item is invalid.");
    seenNodes.add(nodeId);
    seenAliases.add(itemAlias);
    return { nodeId, name: parseCanonicalName(candidate.name, "A published node name is invalid."), kind: kind as "file" | "folder", alias: itemAlias, url: candidate.url };
  });
  return { ...parseWireBase(value), workspaceId: parseStableId(value.workspaceId, "A publication workspace ID is invalid."), alias, url, shareEntire: value.shareEntire, items };
}

export function parsePublicWorkspacePage(value: unknown): PublicWorkspacePage {
  if (!isRecord(value)) throw new Error("A public workspace response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceAlias", "itemAlias", "workspaceId", "workspaceName", "publishedRootId", "asOf", "owner", "nodes", "settings", "nextAfter"], "A public workspace response has an unsupported shape.");
  const workspaceAlias = parsePublicationAlias(value.workspaceAlias);
  const itemAlias = value.itemAlias === null ? null : parsePublicationAlias(value.itemAlias);
  const workspaceId = parseStableId(value.workspaceId, "A public workspace ID is invalid.");
  const publishedRootId = value.publishedRootId === null ? null : parseStableId(value.publishedRootId, "A published root ID is invalid.");
  if ((itemAlias === null) !== (publishedRootId === null)) throw new Error("A public workspace selector is inconsistent.");
  if (!isRecord(value.owner)) throw new Error("A public workspace owner has an unsupported shape.");
  assertExactKeys(value.owner, ["id", "displayName", "avatar"], "A public workspace owner has an unsupported shape.");
  if (typeof value.owner.avatar !== "string" || !/^identicon:[0-9a-f]{16}$/.test(value.owner.avatar)) throw new Error("A public workspace owner avatar is invalid.");
  if (!Array.isArray(value.nodes) || value.nodes.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A public workspace node page is invalid.");
  const nodes = value.nodes.map(parseNodeRecord);
  if (nodes.some((node) => "purged" in node || node.workspaceId !== workspaceId || node.lifecycle.kind !== "active") || new Set(nodes.map(({ id }) => id)).size !== nodes.length || nodes.some(({ id }, index) => index > 0 && nodes[index - 1]!.id >= id)) throw new Error("A public workspace node page is inconsistent.");
  const parsedSettings = parseBoundedRecords(value.settings, parseSetting, "A public workspace setting page is invalid.");
  if (parsedSettings.length > 31) throw new Error("A public workspace response has invalid focused settings.");
  const settings: ActiveSetting[] = [];
  let previousIdentity = "";
  let customThemes = 0;
  for (const setting of parsedSettings) {
    if (setting.deleted) throw new Error("A public workspace response has invalid focused settings.");
    const focused = setting.namespace === "custom-themes"
      || setting.namespace === "desktop-grid" && ["auto-arrange-icons", "grid-size", "snap-to-grid"].includes(setting.key)
      || ["wallpaper", "widgets", "icon-groups"].includes(setting.namespace) && setting.key === "layout"
      || setting.namespace === "theme-selection" && setting.key === "selected";
    const identity = `${setting.namespace}\u0000${setting.key}`;
    if (setting.workspaceId !== workspaceId || !focused || previousIdentity && compareCanonicalStrings(previousIdentity, identity) >= 0) throw new Error("A public workspace response has invalid focused settings.");
    if (setting.namespace === "custom-themes") customThemes += 1;
    previousIdentity = identity;
    settings.push(setting);
  }
  if (itemAlias !== null && settings.length > 0 || customThemes > 24) throw new Error("A public workspace response has invalid focused settings.");
  const nextAfter = value.nextAfter === null ? null : parseStableId(value.nextAfter, "A public workspace cursor is invalid.");
  if (nextAfter !== null && (nodes.length === 0 || nextAfter !== nodes[nodes.length - 1]!.id)) throw new Error("A public workspace cursor is inconsistent.");
  return {
    ...parseWireBase(value),
    workspaceAlias,
    itemAlias,
    workspaceId,
    workspaceName: parseCanonicalName(value.workspaceName, "A public workspace name is invalid."),
    publishedRootId,
    asOf: parseNonNegativeSafeInteger(value.asOf, "A public workspace snapshot is invalid."),
    owner: { id: parseStableId(value.owner.id, "A public owner ID is invalid."), displayName: parseDisplayName(value.owner.displayName, "A public owner name is invalid."), avatar: value.owner.avatar },
    nodes,
    settings,
    nextAfter,
  };
}

function parseShortLinkDestination(value: unknown) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("A short-link destination is invalid.");
  let destination: URL;
  try { destination = new URL(value); } catch { throw new Error("A short-link destination is invalid."); }
  if (destination.protocol !== "https:" || destination.username || destination.password) throw new Error("A short-link destination is invalid.");
  return value;
}

export function parseShortLinkRequest(value: unknown): ShortLinkRequest {
  if (!isRecord(value)) throw new Error("A short-link request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "slug", "destinationUrl", "enabled"], "A short-link request has an unsupported shape.");
  if (typeof value.enabled !== "boolean") throw new Error("A short-link request is invalid.");
  return { ...parseWireBase(value), slug: parsePublicationAlias(value.slug), destinationUrl: parseShortLinkDestination(value.destinationUrl), enabled: value.enabled };
}

function parseShortLink(value: unknown): ShortLink {
  if (!isRecord(value)) throw new Error("A short link has an unsupported shape.");
  assertExactKeys(value, ["slug", "url", "destinationUrl", "enabled", "createdAt", "updatedAt"], "A short link has an unsupported shape.");
  const slug = parsePublicationAlias(value.slug);
  const createdAt = parseNonNegativeSafeInteger(value.createdAt, "A short-link creation time is invalid.");
  const updatedAt = parseNonNegativeSafeInteger(value.updatedAt, "A short-link update time is invalid.");
  if (value.url !== `/r/${slug}` || typeof value.enabled !== "boolean" || updatedAt < createdAt) throw new Error("A short link is invalid.");
  return { slug, url: value.url, destinationUrl: parseShortLinkDestination(value.destinationUrl), enabled: value.enabled, createdAt, updatedAt };
}

export function parseShortLinkList(value: unknown): ShortLinkList {
  if (!isRecord(value)) throw new Error("A short-link response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "accountId", "shortLinks"], "A short-link response has an unsupported shape.");
  if (!Array.isArray(value.shortLinks) || value.shortLinks.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A short-link response is invalid.");
  const shortLinks = value.shortLinks.map(parseShortLink);
  if (new Set(shortLinks.map(({ slug }) => slug)).size !== shortLinks.length) throw new Error("A short-link response contains duplicate slugs.");
  return { ...parseWireBase(value), accountId: parseStableId(value.accountId, "A short-link account ID is invalid."), shortLinks };
}

function parseInvitationEmail(value: unknown, canonical = false) {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("An invitation email is invalid.");
  const email = value.trim().toLowerCase();
  if (!email.includes("@") || new TextEncoder().encode(email).byteLength > 254 || canonical && email !== value) throw new Error("An invitation email is invalid.");
  return email;
}

function parseInvitationToken(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("An invitation token is invalid.");
  return value;
}

export function parseInvitationRequest(value: unknown): InvitationRequest {
  if (!isRecord(value)) throw new Error("An invitation request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "id", "token", "email", "expiresAt"], "An invitation request has an unsupported shape.");
  return { ...parseWireBase(value), id: parseStableId(value.id, "An invitation ID is invalid."), token: parseInvitationToken(value.token), email: parseInvitationEmail(value.email), expiresAt: parsePositiveSafeInteger(value.expiresAt, "An invitation expiration is invalid.") };
}

export function parseInvitationList(value: unknown): InvitationList {
  if (!isRecord(value)) throw new Error("An invitation response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "invitations"], "An invitation response has an unsupported shape.");
  if (!Array.isArray(value.invitations) || value.invitations.length > WEB2_MAX_BATCH_ITEMS) throw new Error("An invitation response is invalid.");
  const invitations = value.invitations.map((candidate): Invitation => {
    if (!isRecord(candidate)) throw new Error("An invitation has an unsupported shape.");
    assertExactKeys(candidate, ["id", "email", "expiresAt", "createdAt"], "An invitation has an unsupported shape.");
    const createdAt = parseNonNegativeSafeInteger(candidate.createdAt, "An invitation creation time is invalid.");
    const expiresAt = parsePositiveSafeInteger(candidate.expiresAt, "An invitation expiration is invalid.");
    if (expiresAt <= createdAt) throw new Error("An invitation expiration is inconsistent.");
    return { id: parseStableId(candidate.id, "An invitation ID is invalid."), email: parseInvitationEmail(candidate.email, true), expiresAt, createdAt };
  });
  if (new Set(invitations.map(({ id }) => id)).size !== invitations.length) throw new Error("An invitation response contains duplicate IDs.");
  return { ...parseWireBase(value), invitations };
}

export function parseWorkspaceInvitationRequest(value: unknown): WorkspaceInvitationRequest {
  if (!isRecord(value)) throw new Error("A workspace invitation request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "id", "token", "email", "role"], "A workspace invitation request has an unsupported shape.");
  const email = parseInvitationEmail(value.email);
  if (email === null) throw new Error("A workspace invitation email is required.");
  return { ...parseWireBase(value), id: parseStableId(value.id, "A workspace invitation ID is invalid."), token: parseInvitationToken(value.token), email, role: parseSharingRole(value.role) };
}

export function parseWorkspaceInvitationList(value: unknown): WorkspaceInvitationList {
  if (!isRecord(value)) throw new Error("A workspace invitation response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceId", "invitations"], "A workspace invitation response has an unsupported shape.");
  if (!Array.isArray(value.invitations) || value.invitations.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A workspace invitation response is invalid.");
  const invitations = value.invitations.map((candidate): WorkspaceInvitation => {
    if (!isRecord(candidate)) throw new Error("A workspace invitation has an unsupported shape.");
    assertExactKeys(candidate, ["id", "email", "role", "createdAt"], "A workspace invitation has an unsupported shape.");
    const email = parseInvitationEmail(candidate.email, true);
    const createdAt = parseNonNegativeSafeInteger(candidate.createdAt, "A workspace invitation creation time is invalid.");
    if (email === null) throw new Error("A workspace invitation is invalid.");
    return { id: parseStableId(candidate.id, "A workspace invitation ID is invalid."), email, role: parseSharingRole(candidate.role), createdAt };
  });
  if (new Set(invitations.map(({ id }) => id)).size !== invitations.length || new Set(invitations.map(({ email }) => email)).size !== invitations.length) throw new Error("A workspace invitation response contains duplicate IDs or emails.");
  return { ...parseWireBase(value), workspaceId: parseStableId(value.workspaceId, "A workspace invitation workspace ID is invalid."), invitations };
}

function parseWeb2AccountAppGenerations(value: unknown): Web2AccountAppGenerations {
  if (!isRecord(value)) throw new Error("Account app generations have an unsupported shape.");
  assertExactKeys(value, ["installationGeneration", "dataGeneration", "itemRevision"], "Account app generations have an unsupported shape.");
  return {
    installationGeneration: parsePositiveSafeInteger(value.installationGeneration, "An account app installation generation is invalid."),
    dataGeneration: parseNonNegativeSafeInteger(value.dataGeneration, "An account app data generation is invalid."),
    itemRevision: parsePositiveSafeInteger(value.itemRevision, "An account app item revision is invalid."),
  };
}

function parseWeb2AccountAppDataItem(value: unknown): Web2AccountAppDataItem {
  if (!isRecord(value)) throw new Error("Account app data metadata has an unsupported shape.");
  assertExactKeys(value, ["key", "dataGeneration", "revision", "size", "sha256"], "Account app data metadata has an unsupported shape.");
  const size = parsePositiveSafeInteger(value.size, "Account app data has an invalid size.");
  if (size > 64 * 1024) throw new Error("Account app data exceeds its size limit.");
  return { key: parseAccountAppDataKey(value.key), dataGeneration: parseNonNegativeSafeInteger(value.dataGeneration), revision: parsePositiveSafeInteger(value.revision), size, sha256: parseSha256(value.sha256) };
}

export function parseWeb2AccountAppsSnapshot(value: unknown): Web2AccountAppsSnapshot {
  if (!isRecord(value)) throw new Error("The Web2 account app inventory has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "accountId", "appsRevision", "handlerHints", "apps", "tombstones"], "The Web2 account app inventory has an unsupported shape.");
  if (!Array.isArray(value.apps) || !Array.isArray(value.tombstones) || value.apps.length + value.tombstones.length > WEB2_MAX_BATCH_ITEMS || !isRecord(value.handlerHints) || Object.keys(value.handlerHints).length > 128) throw new Error("The Web2 account app inventory is invalid.");
  const appsRevision = parseNonNegativeSafeInteger(value.appsRevision);
  const apps = value.apps.map((candidate): Web2AccountApp => {
    if (!isRecord(candidate)) throw new Error("A Web2 account app has an unsupported shape.");
    assertExactKeys(candidate, ["appId", "manifest", "generations", "package", "data"], "A Web2 account app has an unsupported shape.");
    const appId = parseAccountAppId(candidate.appId);
    if (RESERVED_SYSTEM_APP_IDS.has(appId) || !isRecord(candidate.package) || !Array.isArray(candidate.data) || candidate.data.length > 128) throw new Error("A Web2 account app is invalid.");
    assertExactKeys(candidate.package, ["manifestHash", "size", "sha256"], "A Web2 account app package has an unsupported shape.");
    const manifest = parseManifestV2(candidate.manifest);
    const generations = parseWeb2AccountAppGenerations(candidate.generations);
    const size = parsePositiveSafeInteger(candidate.package.size, "An account app package size is invalid.");
    if (manifest.id !== appId || size > 32 * 1024 * 1024) throw new Error("A Web2 account app is inconsistent.");
    const data = candidate.data.map(parseWeb2AccountAppDataItem);
    if (generations.installationGeneration > appsRevision || generations.dataGeneration > appsRevision || generations.itemRevision > appsRevision || new Set(data.map(({ key }) => key)).size !== data.length || data.some((item, index) => item.dataGeneration !== generations.dataGeneration || item.revision > appsRevision || index > 0 && compareCanonicalStrings(data[index - 1]!.key, item.key) >= 0)) throw new Error("Web2 account app data metadata is inconsistent.");
    return { appId, manifest, generations, package: { manifestHash: parseSha256(candidate.package.manifestHash), size, sha256: parseSha256(candidate.package.sha256) }, data };
  });
  if (new Set(apps.map(({ appId }) => appId)).size !== apps.length || apps.some((app, index) => index > 0 && apps[index - 1]!.appId >= app.appId)) throw new Error("The Web2 account app inventory is not uniquely ordered.");
  const tombstones = value.tombstones.map((candidate): Web2AccountAppTombstone => {
    if (!isRecord(candidate)) throw new Error("An account app tombstone has an unsupported shape.");
    assertExactKeys(candidate, ["appId", "generations"], "An account app tombstone has an unsupported shape.");
    const generations = parseWeb2AccountAppGenerations(candidate.generations);
    if (generations.installationGeneration > appsRevision || generations.dataGeneration > appsRevision || generations.itemRevision > appsRevision) throw new Error("An account app tombstone is newer than its inventory.");
    const appId = parseAccountAppId(candidate.appId);
    if (RESERVED_SYSTEM_APP_IDS.has(appId)) throw new Error("A system app cannot appear in account app tombstones.");
    return { appId, generations };
  });
  if (new Set(tombstones.map(({ appId }) => appId)).size !== tombstones.length || tombstones.some((item, index) => index > 0 && tombstones[index - 1]!.appId >= item.appId) || tombstones.some(({ appId }) => apps.some((app) => app.appId === appId))) throw new Error("Account app tombstones are inconsistent.");
  const installed = new Set(apps.map(({ appId }) => appId));
  const handlerHints = Object.fromEntries(Object.entries(value.handlerHints).map(([key, target]) => {
    if (!key || new TextEncoder().encode(key).byteLength > 255 || [...key].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127)) throw new Error("An account app handler key is invalid.");
    const appId = parseAccountAppId(target);
    if (!installed.has(appId)) throw new Error("An account app handler references an uninstalled app.");
    return [key, appId];
  }));
  return { ...parseWireBase(value), accountId: parseStableId(value.accountId), appsRevision, handlerHints, apps, tombstones };
}

export function parseWeb2AccountAppInstallRequest(value: unknown): Web2AccountAppInstallRequest {
  if (!isRecord(value)) throw new Error("An account app installation request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "manifest", "packageManifestHash", "packageSize", "packageSha256", "installationGeneration", "itemRevision"], "An account app installation request has an unsupported shape.");
  const manifest = parseManifestV2(value.manifest);
  const packageSize = parsePositiveSafeInteger(value.packageSize, "An account app package size is invalid.");
  if (packageSize > 32 * 1024 * 1024) throw new Error("An account app package exceeds its size limit.");
  return { ...parseWireBase(value), manifest, packageManifestHash: parseSha256(value.packageManifestHash), packageSize, packageSha256: parseSha256(value.packageSha256), installationGeneration: parseNonNegativeSafeInteger(value.installationGeneration), itemRevision: parseNonNegativeSafeInteger(value.itemRevision) };
}

export function parseWeb2AccountAppDataRequest(value: unknown): Web2AccountAppDataRequest {
  if (!isRecord(value)) throw new Error("An account app data request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "dataGeneration", "value"], "An account app data request has an unsupported shape.");
  const parsed = { ...parseWireBase(value), dataGeneration: parseNonNegativeSafeInteger(value.dataGeneration), value: parseJsonValue(value.value) };
  if (new TextEncoder().encode(JSON.stringify(parsed.value)).byteLength > 64 * 1024) throw new Error("Account app data exceeds its size limit.");
  return parsed;
}

export function parseWeb2AccountAppGenerationRequest(value: unknown, field: "installationGeneration" | "dataGeneration") {
  if (!isRecord(value)) throw new Error("An account app generation request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", field], "An account app generation request has an unsupported shape.");
  return { ...parseWireBase(value), [field]: parseNonNegativeSafeInteger(value[field]) };
}

export function parseWeb2AccountAppHandlersRequest(value: unknown) {
  if (!isRecord(value) || !isRecord(value.hints) || Object.keys(value.hints).length > 128) throw new Error("An account app handlers request has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "hints"], "An account app handlers request has an unsupported shape.");
  const hints = Object.fromEntries(Object.entries(value.hints).map(([key, target]) => {
    if (!key || new TextEncoder().encode(key).byteLength > 255 || [...key].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127)) throw new Error("An account app handler key is invalid.");
    return [key, parseAccountAppId(target)];
  }));
  return { ...parseWireBase(value), hints };
}

export async function parseWeb2AccountAppPackage(value: unknown, expectedOrigin: string): Promise<Web2AccountAppPackage> {
  if (!isRecord(value)) throw new Error("A Web2 account app package has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "accountId", "appId", "appManifest", "manifestHash", "size", "sha256", "manifest", "chunks"], "A Web2 account app package has an unsupported shape.");
  const manifest = parseManifest(value.manifest);
  const manifestHash = parseSha256(value.manifestHash);
  const size = parsePositiveSafeInteger(value.size);
  if (await canonicalManifestSha256(manifest) !== manifestHash || manifest.size !== size || size > 32 * 1024 * 1024) throw new Error("A Web2 account app package manifest is inconsistent.");
  const chunks = parseTransferDescriptors(value.chunks, "GET", expectedOrigin);
  const refs = new Map(manifest.chunks.map((chunk) => [chunk.hash, chunk.size]));
  if (chunks.length !== refs.size || chunks.some((chunk) => refs.get(chunk.hash) !== chunk.size)) throw new Error("A Web2 account app package chunk batch is incomplete.");
  const appId = parseAccountAppId(value.appId);
  const appManifest = parseManifestV2(value.appManifest);
  if (appManifest.id !== appId) throw new Error("A Web2 account app package manifest changed.");
  return { ...parseWireBase(value), accountId: parseStableId(value.accountId), appId, appManifest, manifestHash, size, sha256: parseSha256(value.sha256), manifest, chunks };
}

export async function parseWeb2AccountAppData(value: unknown): Promise<Web2AccountAppData> {
  if (!isRecord(value)) throw new Error("A Web2 account app data response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "accountId", "appId", "key", "dataGeneration", "revision", "size", "sha256", "valueJson"], "A Web2 account app data response has an unsupported shape.");
  if (typeof value.valueJson !== "string") throw new Error("A Web2 account app data response has invalid canonical JSON.");
  const bytes = new TextEncoder().encode(value.valueJson);
  const size = parsePositiveSafeInteger(value.size);
  const sha256 = parseSha256(value.sha256);
  if (bytes.byteLength !== size || bytes.byteLength > 64 * 1024 || await sha256Hex(bytes) !== sha256) throw new Error("A Web2 account app data response failed integrity validation.");
  let parsedValue: JsonValue;
  try { parsedValue = parseJsonValue(JSON.parse(value.valueJson)); } catch { throw new Error("A Web2 account app data response has invalid canonical JSON."); }
  return { ...parseWireBase(value), accountId: parseStableId(value.accountId), appId: parseAccountAppId(value.appId), key: parseAccountAppDataKey(value.key), dataGeneration: parseNonNegativeSafeInteger(value.dataGeneration), revision: parsePositiveSafeInteger(value.revision), size, sha256, value: parsedValue };
}

export function parseAccountEventHint(value: unknown): AccountEventHint {
  if (!isRecord(value) || value.kind !== "workspace-head") throw new Error("An account event hint has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "accountId", "workspaceId", "headSequence"], "An account event hint has an unsupported shape.");
  return { ...parseWireBase(value), kind: "workspace-head", accountId: parseStableId(value.accountId), workspaceId: parseStableId(value.workspaceId), headSequence: parseNonNegativeSafeInteger(value.headSequence) };
}

export function parseWeb2EventHint(value: unknown): Web2EventHint {
  if (isRecord(value) && value.kind === "workspace-head") return parseAccountEventHint(value);
  if (isRecord(value) && value.kind === "account-apps") {
    assertExactKeys(value, ["schemaVersion", "protocol", "kind", "accountId", "appsRevision"], "An account app event hint has an unsupported shape.");
    return { ...parseWireBase(value), kind: "account-apps", accountId: parseStableId(value.accountId), appsRevision: parseNonNegativeSafeInteger(value.appsRevision) };
  }
  if (!isRecord(value) || value.kind !== "directory") throw new Error("A synchronization event hint has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "revision"], "A directory event hint has an unsupported shape.");
  return { ...parseWireBase(value), kind: "directory", revision: parseNonNegativeSafeInteger(value.revision, "A directory revision is invalid.") };
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
  const activeSummary = workspaces.find(({ id }) => id === workspace.id);
  if (new Set(workspaces.map(({ id }) => id)).size !== workspaces.length || workspaces.some(({ pinned }, index) => pinned && index > 0 && !workspaces[index - 1]!.pinned) || !activeSummary || activeSummary.name !== workspace.name || activeSummary.pinned !== workspace.pinned) throw new Error("A bootstrap workspace directory is inconsistent.");
  if (cursor > workspace.headSequence || rootPage.workspaceId !== workspace.id || rootPage.deviceId !== deviceId || rootPage.pageIndex !== 0 || rootPage.target.kind !== "folder-page" || rootPage.target.parentId !== null || rootPage.target.asOf !== workspace.headSequence) throw new Error("A bootstrap root page is inconsistent.");
  if (workspaceSettings.some((setting) => setting.workspaceId !== workspace.id || setting.namespace !== "desktop-grid" || !WEB2_BOOTSTRAP_SETTING_KEYS.includes(setting.key as typeof WEB2_BOOTSTRAP_SETTING_KEYS[number]) || setting.logicalTime > rootPage.observedLogicalTime) || new Set(workspaceSettings.map(({ namespace, key }) => `${namespace}\0${key}`)).size !== workspaceSettings.length) throw new Error("Bootstrap workspace settings are inconsistent.");
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
      if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.settings) || candidate.nodes.length + candidate.settings.length > WEB2_MAX_BATCH_ITEMS || candidate.nodes.length > 0 && candidate.settings.length > 0) throw new Error("A pulled operation record batch is invalid.");
      const nodes = candidate.nodes.map(parseNodeRecord);
      const settings = candidate.settings.map(parseSetting);
      const settingIdentities = settings.map(({ namespace, key }) => `${namespace}\0${key}`);
      if (new Set(nodes.map(({ id }) => id)).size !== nodes.length || nodes.some(({ id }, index) => index > 0 && compareCanonicalStrings(nodes[index - 1]!.id, id) >= 0) || new Set(settingIdentities).size !== settings.length || settingIdentities.some((identity, index) => index > 0 && compareCanonicalStrings(settingIdentities[index - 1]!, identity) >= 0)) throw new Error("Pulled operation records are not canonically ordered.");
      return { sequence, operationId, companion, nodes, settings };
    }, "A pulled operation batch is invalid.");
    const logicalTimes = operations.flatMap(({ nodes, settings }) => [...nodes.flatMap((node) => "purged" in node ? [node.logicalTime] : Object.values(node.fieldTuples).flatMap((tuple) => tuple === null ? [] : [tuple.logicalTime])), ...settings.map(({ logicalTime }) => logicalTime)]);
    if (base.fromCursor < base.logFloor || operations.reduce((count, operation) => count + operation.nodes.length + operation.settings.length, 0) > WEB2_MAX_BATCH_ITEMS || operations.some(({ sequence }, index) => sequence !== base.fromCursor + index + 1) || operations.length > 0 && operations.at(-1)!.sequence !== base.cursor || operations.length === 0 && base.cursor !== base.fromCursor || base.cursor < base.headSequence && operations.length === 0 || new Set(operations.map(({ operationId }) => operationId)).size !== operations.length || logicalTimes.some((logicalTime) => logicalTime > base.observedLogicalTime) || operations.some(({ companion, nodes, settings }) => companion === null ? [...nodes, ...settings].some(({ workspaceId }) => workspaceId !== base.workspaceId) : companion.workspaceId === base.workspaceId || settings.length > 0 || nodes.some(({ workspaceId }) => workspaceId !== base.workspaceId && workspaceId !== companion.workspaceId))) throw new Error("A pulled operation batch is inconsistent.");
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

export function parsePushBatchResult(value: unknown): PushBatchResult {
  if (!isRecord(value)) throw new Error("A push batch result has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "results"], "A push batch result has an unsupported shape.");
  const wire = parseWireBase(value);
  if (!Array.isArray(value.results) || value.results.length === 0 || value.results.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A push result batch is invalid.");
  const results = value.results.map(parsePushResult);
  if (new Set(results.map(({ operationId }) => operationId)).size !== results.length) throw new Error("A push result batch contains duplicate operation IDs.");
  return { ...wire, results };
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

function parseTransferUrl(value: unknown, expectedOrigin?: string) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("A chunk transfer URL is invalid.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("A chunk transfer URL is invalid."); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
	let origin: string | undefined;
	try { origin = expectedOrigin === undefined ? undefined : new URL(expectedOrigin).origin; } catch { throw new Error("The authenticated chunk origin is invalid."); }
  const pageLoopback = typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && pageLoopback) || url.username || url.password || url.hash || origin !== undefined && url.origin !== origin) throw new Error("A chunk transfer URL is unsafe.");
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

function parseTransferDescriptors<Method extends "PUT" | "GET">(value: unknown, expectedMethod: Method, expectedOrigin?: string) {
  if (!Array.isArray(value) || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A chunk transfer batch is invalid.");
  const descriptors = value.map((candidate): ChunkTransferDescriptor<Method> => {
    if (!isRecord(candidate)) throw new Error("A chunk transfer descriptor has an unsupported shape.");
    assertExactKeys(candidate, ["hash", "size", "method", "url", "headers"], "A chunk transfer descriptor has an unsupported shape.");
    const size = parsePositiveSafeInteger(candidate.size);
    if (size > WEB2_CHUNK_SIZE || candidate.method !== expectedMethod) throw new Error("A chunk transfer descriptor is invalid.");
    return { hash: parseSha256(candidate.hash), size, method: expectedMethod, url: parseTransferUrl(candidate.url, expectedOrigin), headers: parseTransferHeaders(candidate.headers) };
  });
  if (new Set(descriptors.map(({ hash }) => hash)).size !== descriptors.length) throw new Error("A chunk transfer batch contains duplicate hashes.");
  return descriptors;
}

function chunkChecksum(hash: string) {
  const bytes = Uint8Array.from(hash.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  return btoa(String.fromCharCode(...bytes));
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

export async function parseChunkUploadResult(value: unknown, expectedManifestValue: unknown, expectedOrigin: string): Promise<ChunkUploadResult> {
  if (!isRecord(value) || value.kind !== "chunk-upload-result") throw new Error("A chunk upload result has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "deviceId", "operationId", "manifestHash", "transferId", "expiresAt", "missingChunks"], "A chunk upload result has an unsupported shape.");
  const wire = parseWireBase(value);
  const expectedManifest = parseManifest(expectedManifestValue);
  const manifestHash = parseSha256(value.manifestHash);
  if (await canonicalManifestSha256(expectedManifest) !== manifestHash) throw new Error("An upload result is for a different manifest.");
  const missingChunks = parseTransferDescriptors(value.missingChunks, "PUT", expectedOrigin);
  const refs = new Map(expectedManifest.chunks.map((chunk) => [chunk.hash, chunk.size]));
  if (missingChunks.some((chunk) => refs.get(chunk.hash) !== chunk.size || Object.entries(chunk.headers).find(([name]) => name.toLowerCase() === "x-amz-checksum-sha256")?.[1] !== chunkChecksum(chunk.hash))) throw new Error("An upload chunk is absent from its manifest or lacks its required checksum.");
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

export async function parseChunkDownloadResult(value: unknown, expectedOrigin: string, haveChunks?: readonly string[]): Promise<ChunkDownloadResult> {
  if (!isRecord(value) || value.kind !== "chunk-download-result") throw new Error("A chunk download result has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "deviceId", "manifestHash", "manifest", "chunks"], "A chunk download result has an unsupported shape.");
  const wire = parseWireBase(value);
  const manifest = parseManifest(value.manifest);
  const manifestHash = parseSha256(value.manifestHash);
  if (await canonicalManifestSha256(manifest) !== manifestHash) throw new Error("A manifest hash does not match its canonical bytes.");
  const chunks = parseTransferDescriptors(value.chunks, "GET", expectedOrigin);
  const refs = new Map(manifest.chunks.map((chunk) => [chunk.hash, chunk.size]));
  if (chunks.some((chunk) => refs.get(chunk.hash) !== chunk.size)) throw new Error("A downloaded chunk is absent from its manifest.");
  if (haveChunks !== undefined) {
    const covered = new Set([...haveChunks, ...chunks.map(({ hash }) => hash)]);
    if (covered.size !== refs.size || [...covered].some((hash) => !refs.has(hash))) throw new Error("A chunk download result does not cover its manifest.");
  }
  return { ...wire, kind: "chunk-download-result", workspaceId: parseStableId(value.workspaceId), deviceId: parseStableId(value.deviceId), manifestHash, manifest, chunks };
}

function parseWeb2ThumbnailAccess(value: unknown, expectedOrigin?: string): Web2ThumbnailDescriptor["access"] {
  if (!isRecord(value)) throw new Error("A thumbnail access descriptor has an unsupported shape.");
  assertExactKeys(value, ["url", "method", "headers", "expiresAt"], "A thumbnail access descriptor has an unsupported shape.");
  if (value.method !== "GET") throw new Error("A thumbnail access descriptor is invalid.");
  return { url: parseTransferUrl(value.url, expectedOrigin), method: "GET", headers: parseTransferHeaders(value.headers), expiresAt: parseNonNegativeSafeInteger(value.expiresAt, "A thumbnail access expiration is invalid.") };
}

function parseWeb2ThumbnailBase(value: Record<string, unknown>, expected: { workspaceId: string; nodeId: string; contentOperationId: string; manifestHash: string }, expectedOrigin?: string): Web2ThumbnailDescriptor {
  const wire = parseWireBase(value);
  const workspaceId = parseStableId(value.workspaceId, "A thumbnail workspace ID is invalid.");
  const nodeId = parseStableId(value.nodeId, "A thumbnail node ID is invalid.");
  const contentOperationId = parseStableId(value.contentOperationId, "A thumbnail content operation ID is invalid.");
  const manifestHash = parseSha256(value.manifestHash, "A thumbnail manifest hash is invalid.");
  const width = parsePositiveSafeInteger(value.width, "A thumbnail width is invalid.");
  const height = parsePositiveSafeInteger(value.height, "A thumbnail height is invalid.");
  const size = parsePositiveSafeInteger(value.size, "A thumbnail size is invalid.");
  if (value.kind !== "thumbnail" || workspaceId !== expected.workspaceId || nodeId !== expected.nodeId || contentOperationId !== expected.contentOperationId || manifestHash !== expected.manifestHash || value.profile !== "thumbnail-v1" || value.mimeType !== "image/webp" || width > 320 || height > 320 || size > 256 * 1024) throw new Error("A thumbnail descriptor is inconsistent.");
  return { ...wire, kind: "thumbnail", workspaceId, nodeId, contentOperationId, manifestHash, profile: "thumbnail-v1", mimeType: "image/webp", width, height, size, sha256: parseSha256(value.sha256, "A thumbnail digest is invalid."), access: parseWeb2ThumbnailAccess(value.access, expectedOrigin) };
}

export function parseWeb2ThumbnailDescriptor(value: unknown, expected: { workspaceId: string; nodeId: string; contentOperationId: string; manifestHash: string }, expectedOrigin: string): Web2ThumbnailDescriptor {
  if (!isRecord(value)) throw new Error("A thumbnail descriptor has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "nodeId", "contentOperationId", "manifestHash", "profile", "mimeType", "width", "height", "size", "sha256", "access"], "A thumbnail descriptor has an unsupported shape.");
  return parseWeb2ThumbnailBase(value, expected, expectedOrigin);
}

export function parseWeb2ThumbnailPending(value: unknown, expected: { workspaceId: string; nodeId: string }): Web2ThumbnailPending {
  if (!isRecord(value)) throw new Error("A pending thumbnail response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "nodeId", "state"], "A pending thumbnail response has an unsupported shape.");
  const wire = parseWireBase(value);
  const workspaceId = parseStableId(value.workspaceId, "A pending thumbnail workspace ID is invalid.");
  const nodeId = parseStableId(value.nodeId, "A pending thumbnail node ID is invalid.");
  const states = new Set(["pending", "running", "publishing", "failed", "deleting"]);
  if (value.kind !== "thumbnail" || workspaceId !== expected.workspaceId || nodeId !== expected.nodeId || typeof value.state !== "string" || !states.has(value.state)) throw new Error("A pending thumbnail response is inconsistent.");
  return { ...wire, kind: "thumbnail", workspaceId, nodeId, state: value.state as Web2ThumbnailPending["state"] };
}

export function parsePublicWeb2ThumbnailDescriptor(value: unknown, expected: { workspaceAlias: string; itemAlias: string | null; workspaceId: string; nodeId: string; contentOperationId: string; manifestHash: string; asOf: number }): PublicWeb2ThumbnailDescriptor {
  if (!isRecord(value)) throw new Error("A public thumbnail descriptor has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "kind", "workspaceId", "nodeId", "contentOperationId", "manifestHash", "profile", "mimeType", "width", "height", "size", "sha256", "access", "workspaceAlias", "itemAlias", "asOf"], "A public thumbnail descriptor has an unsupported shape.");
  if (value.workspaceAlias !== expected.workspaceAlias || value.itemAlias !== expected.itemAlias || value.asOf !== expected.asOf) throw new Error("A public thumbnail descriptor is inconsistent.");
  return { ...parseWeb2ThumbnailBase(value, expected), workspaceAlias: expected.workspaceAlias, itemAlias: expected.itemAlias, asOf: parseNonNegativeSafeInteger(value.asOf, "A public thumbnail snapshot is invalid.") };
}

export async function parsePublicNodeContent(value: unknown): Promise<PublicNodeContent> {
  if (!isRecord(value)) throw new Error("A public file response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "workspaceAlias", "itemAlias", "nodeId", "asOf", "manifestHash", "manifest", "chunks"], "A public file response has an unsupported shape.");
  const manifest = parseManifest(value.manifest);
  const manifestHash = parseSha256(value.manifestHash, "A public manifest hash is invalid.");
  if (await canonicalManifestSha256(manifest) !== manifestHash) throw new Error("A public manifest hash does not match its canonical bytes.");
  const chunks = parseTransferDescriptors(value.chunks, "GET");
  const refs = new Map(manifest.chunks.map((chunk) => [chunk.hash, chunk.size]));
  if (chunks.length !== refs.size || chunks.some((chunk) => refs.get(chunk.hash) !== chunk.size)) throw new Error("A public chunk batch does not cover its manifest.");
  return {
    ...parseWireBase(value),
    workspaceAlias: parsePublicationAlias(value.workspaceAlias),
    itemAlias: value.itemAlias === null ? null : parsePublicationAlias(value.itemAlias),
    nodeId: parseStableId(value.nodeId, "A public node ID is invalid."),
    asOf: parseNonNegativeSafeInteger(value.asOf, "A public file snapshot is invalid."),
    manifestHash,
    manifest,
    chunks,
  };
}

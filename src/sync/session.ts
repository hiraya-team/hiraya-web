import { parseStableId } from "../filesystem/ids";
import { WEB2_SYNC_PROTOCOL } from "./constants";

/** Defines the Web2 schema version. */
const WEB2_SCHEMA_VERSION = 1 as const;
/** Defines the maximum Web2 batch size. */
const WEB2_MAX_BATCH_ITEMS = 256;

/** Reports whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates exact keys. */
function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], message: string) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(message);
}

/** Parses and validates a canonical display name. */
function parseCanonicalName(value: unknown, message: string) {
  if (typeof value !== "string" || !value || value !== value.trim() || value === "." || value === ".." || value.includes("/") || value.includes("\\") || [...value].length > 180 || [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  })) throw new Error(message);
  return value;
}

/** Parses and validates a non-negative safe integer. */
function parseNonNegativeSafeInteger(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(message);
  return Number(value);
}

/** Parses and validates positive safe integer. */
function parsePositiveSafeInteger(value: unknown, message: string) {
  const result = parseNonNegativeSafeInteger(value, message);
  if (result === 0) throw new Error(message);
  return result;
}

export type QuotaMeasure = { used: number; limit: number };
export type AccountQuota = { storageBytes: QuotaMeasure; workspaces: QuotaMeasure; nodes: QuotaMeasure };
export type Web2Session = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  protocol: typeof WEB2_SYNC_PROTOCOL;
  user: { id: string; email: string; displayName: string; deploymentAdmin: boolean };
  accounts: { id: string; name: string; storageId: string; quota: AccountQuota | null; workspaces: { id: string; name: string; pinned: boolean; role: "owner" | "manager" | "writer" | "reader" }[] }[];
  directoryRevision: number;
  directBlobOrigin: string | null;
  buildTimestamp: string;
};

/** Parses and validates direct blob origin. */
function parseDirectBlobOrigin(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2048) throw new Error("The authenticated chunk origin is invalid.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("The authenticated chunk origin is invalid."); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const pageLoopback = typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]");
  if (url.origin !== value || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && loopback && pageLoopback)) throw new Error("The authenticated chunk origin is invalid.");
  return value;
}

/** Parses and validates a Web2 session. */
export function parseWeb2Session(value: unknown): Web2Session {
  if (!isRecord(value)) throw new Error("A session response has an unsupported shape.");
  assertExactKeys(value, ["schemaVersion", "protocol", "user", "accounts", "directoryRevision", "directBlobOrigin", "buildTimestamp"], "A session response has an unsupported shape.");
  if (value.schemaVersion !== WEB2_SCHEMA_VERSION || value.protocol !== WEB2_SYNC_PROTOCOL) throw new Error("A synchronization message has unsupported protocol metadata.");
  if (!isRecord(value.user)) throw new Error("A session user has an unsupported shape.");
  assertExactKeys(value.user, ["id", "email", "displayName", "deploymentAdmin"], "A session user has an unsupported shape.");
  if (typeof value.user.email !== "string" || !value.user.email || value.user.email.length > 320 || typeof value.user.deploymentAdmin !== "boolean") throw new Error("A session user is invalid.");
  if (typeof value.user.displayName !== "string" || [...value.user.displayName].length < 1 || [...value.user.displayName].length > 100) throw new Error("A session display name is invalid.");
  if (!Array.isArray(value.accounts) || value.accounts.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A session account directory is invalid.");
  const accounts = value.accounts.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("A session account has an unsupported shape.");
    assertExactKeys(candidate, ["id", "name", "storageId", "quota", "workspaces"], "A session account has an unsupported shape.");
    if (!Array.isArray(candidate.workspaces) || candidate.workspaces.length === 0 || candidate.workspaces.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A session workspace directory is invalid.");
    const workspaces = candidate.workspaces.map((workspace) => {
      if (!isRecord(workspace)) throw new Error("A session workspace has an unsupported shape.");
      assertExactKeys(workspace, ["id", "name", "pinned", "role"], "A session workspace has an unsupported shape.");
      if (typeof workspace.pinned !== "boolean") throw new Error("A workspace summary has invalid pinning metadata.");
      if (workspace.role !== "owner" && workspace.role !== "manager" && workspace.role !== "writer" && workspace.role !== "reader") throw new Error("A sharing role is invalid.");
      const role: "owner" | "manager" | "writer" | "reader" = workspace.role;
      return { id: parseStableId(workspace.id, "A workspace ID is invalid."), name: parseCanonicalName(workspace.name, "A workspace name is invalid."), pinned: workspace.pinned, role };
    });
    if (new Set(workspaces.map(({ id }) => id)).size !== workspaces.length) throw new Error("A session workspace directory contains duplicate IDs.");
    let quota: AccountQuota | null = null;
    if (candidate.quota !== null) {
      if (!isRecord(candidate.quota)) throw new Error("A session account quota has an unsupported shape.");
      assertExactKeys(candidate.quota, ["storageBytes", "workspaces", "nodes"], "A session account quota has an unsupported shape.");
      const measure = (input: unknown): QuotaMeasure => {
        if (!isRecord(input)) throw new Error("A session account quota measure has an unsupported shape.");
        assertExactKeys(input, ["used", "limit"], "A session account quota measure has an unsupported shape.");
        return { used: parseNonNegativeSafeInteger(input.used, "A session account quota usage is invalid."), limit: parsePositiveSafeInteger(input.limit, "A session account quota limit is invalid.") };
      };
      quota = { storageBytes: measure(candidate.quota.storageBytes), workspaces: measure(candidate.quota.workspaces), nodes: measure(candidate.quota.nodes) };
    }
    const ownedWorkspaces = workspaces.filter(({ role }) => role === "owner").length;
    if (quota === null ? ownedWorkspaces !== 0 : ownedWorkspaces !== workspaces.length || quota.workspaces.used < workspaces.length) throw new Error("A session account quota does not match workspace ownership.");
    return { id: parseStableId(candidate.id, "A session account ID is invalid."), name: parseCanonicalName(candidate.name, "A session account name is invalid."), storageId: parseStableId(candidate.storageId, "A session storage ID is invalid."), quota, workspaces };
  });
  if (new Set(accounts.map(({ id }) => id)).size !== accounts.length || new Set(accounts.map(({ storageId }) => storageId)).size !== accounts.length || accounts.reduce((count, account) => count + account.workspaces.length, 0) > WEB2_MAX_BATCH_ITEMS) throw new Error("A session account directory is inconsistent.");
  if (typeof value.buildTimestamp !== "string" || !value.buildTimestamp || value.buildTimestamp.length > 1024) throw new Error("A session build identity is invalid.");
  return {
    schemaVersion: WEB2_SCHEMA_VERSION,
    protocol: WEB2_SYNC_PROTOCOL,
    user: { id: parseStableId(value.user.id, "A session user ID is invalid."), email: value.user.email, displayName: value.user.displayName, deploymentAdmin: value.user.deploymentAdmin },
    accounts,
    directoryRevision: parseNonNegativeSafeInteger(value.directoryRevision, "A session directory revision is invalid."),
    directBlobOrigin: parseDirectBlobOrigin(value.directBlobOrigin),
    buildTimestamp: value.buildTimestamp,
  };
}

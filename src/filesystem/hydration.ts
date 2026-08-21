import {
  WEB2_MAX_ANCESTRY_DEPTH,
  WEB2_MAX_BATCH_ITEMS,
  assertExactKeys,
  isRecord,
  parseNodeRecord,
  parseNonNegativeSafeInteger,
  parsePositiveSafeInteger,
  parseSetting,
  parseSettingKeyForNamespace,
  parseSettingNamespace,
  parseStableId,
  type NodeRecord,
  type Setting,
  type SettingNamespace,
} from "./model";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export type HydrationTarget = { workspaceId: string; asOf: number } & (
  | { kind: "folder-page"; parentId: string | null; limit: number }
  | { kind: "exact-nodes"; nodeIds: string[] }
  | { kind: "ancestry"; nodeId: string; maxDepth: number }
  | { kind: "exact-settings"; namespace: SettingNamespace; keys: string[] }
  | { kind: "setting-namespace"; namespace: SettingNamespace; limit: number }
);

export type HydrationPageData = {
  workspaceId: string;
  deviceId: string;
  generationId: string;
  pageIndex: number;
  observedLogicalTime: number;
  target: HydrationTarget;
  nodes: NodeRecord[];
  settings: Setting[];
  nextPageToken: string | null;
};

/** Compares strings in canonical lexical order. */
export function compareCanonicalStrings(left: string, right: string) {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

/** Returns values in canonical string order. */
function ordered(values: string[]) {
  return values.every((value, index) => index === 0 || compareCanonicalStrings(values[index - 1]!, value) < 0);
}

/** Returns a bounded list of IDs. */
function boundedIds(value: unknown, message: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error(message);
  const ids = value.map((id) => parseStableId(id, message));
  if (new Set(ids).size !== ids.length || !ordered(ids)) throw new Error(message);
  return ids;
}

/** Returns bounded keys. */
function boundedKeys(value: unknown, namespace: SettingNamespace) {
  if (!Array.isArray(value) || value.length === 0 || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A hydration setting-key batch is invalid.");
  const keys = value.map((key) => parseSettingKeyForNamespace(namespace, key).key);
  if (new Set(keys).size !== keys.length) throw new Error("A hydration setting-key batch contains duplicates.");
  if (!ordered(keys)) throw new Error("A hydration setting-key batch is not canonically ordered.");
  return keys;
}

/** Calculates the effective hydration page limit. */
function pageLimit(value: unknown) {
  const limit = parsePositiveSafeInteger(value, "A hydration page limit is invalid.");
  if (limit > WEB2_MAX_BATCH_ITEMS) throw new Error("A hydration page limit is invalid.");
  return limit;
}

/** Parses and validates hydration target. */
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
    case "exact-settings": {
      assertExactKeys(value, ["kind", "workspaceId", "asOf", "namespace", "keys"], "An exact-setting hydration target has an unsupported shape.");
      const namespace = parseSettingNamespace(value.namespace);
      return { kind: "exact-settings", workspaceId, asOf, namespace, keys: boundedKeys(value.keys, namespace) };
    }
    case "setting-namespace":
      assertExactKeys(value, ["kind", "workspaceId", "asOf", "namespace", "limit"], "A setting-namespace hydration target has an unsupported shape.");
      return { kind: "setting-namespace", workspaceId, asOf, namespace: parseSettingNamespace(value.namespace), limit: pageLimit(value.limit) };
    default:
      throw new Error("A hydration target kind is unsupported.");
  }
}

/** Parses and validates hydration page token. */
export function parseHydrationPageToken(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 4096 || [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  })) throw new Error("A hydration page token is invalid.");
  return value;
}

/** Parses and validates hydration page data. */
export function parseHydrationPageData(value: unknown): HydrationPageData {
  if (!isRecord(value)) throw new Error("A hydration page has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "deviceId", "generationId", "pageIndex", "observedLogicalTime", "target", "nodes", "settings", "nextPageToken"], "A hydration page has an unsupported shape.");
  const workspaceId = parseStableId(value.workspaceId, "A hydration page workspace ID is invalid.");
  const deviceId = parseStableId(value.deviceId, "A hydration page device ID is invalid.");
  const generationId = parseStableId(value.generationId, "A hydration generation ID is invalid.");
  const pageIndex = parseNonNegativeSafeInteger(value.pageIndex, "A hydration page index is invalid.");
  const observedLogicalTime = parseNonNegativeSafeInteger(value.observedLogicalTime, "A hydration observed logical time is invalid.");
  const target = parseHydrationTarget(value.target);
  if (!Array.isArray(value.nodes) || value.nodes.length > WEB2_MAX_BATCH_ITEMS || !Array.isArray(value.settings) || value.settings.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A hydration page record batch is invalid.");
  const nodes = value.nodes.map(parseNodeRecord);
  const settings = value.settings.map(parseSetting);
  if (target.workspaceId !== workspaceId || nodes.some((node) => node.workspaceId !== workspaceId) || settings.some((setting) => setting.workspaceId !== workspaceId)) throw new Error("A hydration page mixes workspaces.");
  if (new Set(nodes.map(({ id }) => id)).size !== nodes.length || new Set(settings.map(({ namespace, key }) => `${namespace}\0${key}`)).size !== settings.length) throw new Error("A hydration page contains duplicate records.");
  const nextPageToken = value.nextPageToken === null ? null : parseHydrationPageToken(value.nextPageToken);
  const recordLogicalTimes = [...nodes.flatMap((node) => "purged" in node ? [node.logicalTime] : Object.values(node.fieldTuples).flatMap((tuple) => tuple === null ? [] : [tuple.logicalTime])), ...settings.map(({ logicalTime }) => logicalTime)];
  if (recordLogicalTimes.some((logicalTime) => logicalTime > observedLogicalTime)) throw new Error("A hydration page exceeds its observed logical time.");
  switch (target.kind) {
    case "folder-page":
      if (settings.length > 0 || nodes.some((node) => "purged" in node || node.lifecycle.kind !== "active" || node.parentId !== target.parentId) || nodes.length > target.limit || !ordered(nodes.map(({ id }) => id))) throw new Error("A folder hydration page does not match its selector.");
      break;
    case "exact-nodes":
      if (settings.length > 0 || nodes.some(({ id }) => !target.nodeIds.includes(id)) || !ordered(nodes.map(({ id }) => id)) || pageIndex !== 0 || nextPageToken !== null) throw new Error("An exact-node hydration page does not match its selector.");
      break;
    case "ancestry": {
      if (settings.length > 0 || pageIndex !== 0 || nextPageToken !== null || nodes.length > target.maxDepth || nodes.length > 0 && nodes[0]!.id !== target.nodeId) throw new Error("An ancestry hydration page does not match its selector.");
      for (let index = 1; index < nodes.length; index += 1) {
        const child = nodes[index - 1]!;
        const parent = nodes[index]!;
        if ("purged" in child || child.parentId !== parent.id || !("purged" in parent) && parent.kind !== "folder") throw new Error("An ancestry hydration page is not a child-to-root chain.");
      }
      const last = nodes.at(-1);
      if (last && !("purged" in last) && last.parentId !== null && nodes.some(({ id }) => id === last.parentId)) throw new Error("An ancestry hydration page contains a cycle.");
      if (last && nodes.length < target.maxDepth && !("purged" in last) && last.parentId !== null) throw new Error("An ancestry hydration page ends before its root or depth bound.");
      break;
    }
    case "exact-settings":
      if (nodes.length > 0 || settings.some(({ namespace, key }) => namespace !== target.namespace || !target.keys.includes(key)) || !ordered(settings.map(({ key }) => key)) || pageIndex !== 0 || nextPageToken !== null) throw new Error("An exact-setting hydration page does not match its selector.");
      break;
    case "setting-namespace":
      if (nodes.length > 0 || settings.some(({ namespace }) => namespace !== target.namespace) || settings.length > target.limit || !ordered(settings.map(({ key }) => key))) throw new Error("A setting-namespace hydration page does not match its selector.");
      break;
  }
  return { workspaceId, deviceId, generationId, pageIndex, observedLogicalTime, target, nodes, settings, nextPageToken };
}

/** Computes hydration target ID. */
export function hydrationTargetId(target: HydrationTarget) {
  const selector = target.kind === "folder-page" ? { kind: target.kind, parentId: target.parentId }
    : target.kind === "exact-nodes" ? { kind: target.kind, nodeIds: target.nodeIds }
      : target.kind === "ancestry" ? { kind: target.kind, nodeId: target.nodeId, maxDepth: target.maxDepth }
        : target.kind === "exact-settings" ? { kind: target.kind, namespace: target.namespace, keys: target.keys }
          : { kind: target.kind, namespace: target.namespace };
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(selector))));
}

import {
  WEB2_MAX_BATCH_ITEMS,
  WEB2_SCHEMA_VERSION,
  assertExactKeys,
  isRecord,
  parseCanonicalName,
  parseMimeType,
  parseNonNegativeSafeInteger,
  parsePosition,
  parseSettingNamespace,
  parseWorkspaceSetting,
  parseSha256,
  parseStableId,
  type JsonValue,
  type Position,
  type SettingNamespace,
} from "./model";

type OperationBase = {
  schemaVersion: typeof WEB2_SCHEMA_VERSION;
  operationId: string;
  workspaceId: string;
  deviceId: string;
  logicalTime: number;
};
type NewNodeBase = {
  id: string;
  name: string;
  parentId: string | null;
  position: Position;
  createdAt: number;
  modifiedAt: number;
};
export type NewNode =
  | NewNodeBase & { kind: "folder" }
  | NewNodeBase & { kind: "file"; mimeType: string; size: number; manifestHash: string };
export type SettingChange = { key: string; value: JsonValue };
export type WorkspaceOperation = OperationBase & (
  | { kind: "create"; nodes: NewNode[] }
  | { kind: "write"; nodeId: string; mimeType: string; size: number; manifestHash: string; modifiedAt: number }
  | { kind: "copy"; sourceNodeIds: string[]; nodes: NewNode[] }
  | { kind: "rename"; nodeId: string; name: string; modifiedAt: number }
  | { kind: "move"; nodeIds: string[]; parentId: string | null; modifiedAt: number }
  | { kind: "position"; positions: Array<{ nodeId: string; position: Position }> }
  | { kind: "transfer"; nodeIds: string[]; destinationWorkspaceId: string; parentId: string | null; modifiedAt: number }
  | { kind: "trash"; nodeIds: string[]; trashedAt: number }
  | { kind: "restore"; nodeIds: string[]; destination: "original" | "root"; modifiedAt: number }
  | { kind: "purge"; nodeIds: string[] }
  | { kind: "set"; namespace: SettingNamespace; key: string; value: JsonValue }
  | { kind: "set-many"; namespace: SettingNamespace; settings: SettingChange[] }
);

const BASE_KEYS = ["schemaVersion", "kind", "operationId", "workspaceId", "deviceId", "logicalTime"] as const;

function exactOperation(value: Record<string, unknown>, payloadKeys: readonly string[]) {
  assertExactKeys(value, [...BASE_KEYS, ...payloadKeys], "An operation has an unsupported shape.");
}

function parseBase(value: Record<string, unknown>): OperationBase {
  if (value.schemaVersion !== WEB2_SCHEMA_VERSION) throw new Error("An operation has an unsupported schema version.");
  return {
    schemaVersion: WEB2_SCHEMA_VERSION,
    operationId: parseStableId(value.operationId, "An operation ID is invalid."),
    workspaceId: parseStableId(value.workspaceId, "An operation workspace ID is invalid."),
    deviceId: parseStableId(value.deviceId, "An operation device ID is invalid."),
    logicalTime: parseNonNegativeSafeInteger(value.logicalTime, "An operation logical time is invalid."),
  };
}

function boundedNonemptyArray(value: unknown, message: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error(message);
  return value;
}

function parseIdArray(value: unknown, message: string) {
  const ids = boundedNonemptyArray(value, message).map((id) => parseStableId(id, message));
  if (new Set(ids).size !== ids.length) throw new Error(message);
  return ids;
}

function parseNewNode(value: unknown): NewNode {
  if (!isRecord(value) || value.kind !== "folder" && value.kind !== "file") throw new Error("A created node has an unsupported shape.");
  const baseKeys = ["id", "kind", "name", "parentId", "position", "createdAt", "modifiedAt"];
  assertExactKeys(value, value.kind === "file" ? [...baseKeys, "mimeType", "size", "manifestHash"] : baseKeys, "A created node has an unsupported shape.");
  const base: NewNodeBase = {
    id: parseStableId(value.id, "A created node ID is invalid."),
    name: parseCanonicalName(value.name, "A created node name is invalid."),
    parentId: value.parentId === null ? null : parseStableId(value.parentId, "A created node parent ID is invalid."),
    position: parsePosition(value.position),
    createdAt: parseNonNegativeSafeInteger(value.createdAt, "A created node creation time is invalid."),
    modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt, "A created node modification time is invalid."),
  };
  if (base.parentId === base.id) throw new Error("A created node cannot be its own parent.");
  if (value.kind === "folder") return { ...base, kind: "folder" };
  return {
    ...base,
    kind: "file",
    mimeType: parseMimeType(value.mimeType, "A created file MIME type is invalid."),
    size: parseNonNegativeSafeInteger(value.size, "A created file size is invalid."),
    manifestHash: parseSha256(value.manifestHash, "A created file manifest hash is invalid."),
  };
}

function parseNewNodes(value: unknown) {
  const nodes = boundedNonemptyArray(value, "A created node batch is invalid.").map(parseNewNode);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error("A created node batch contains duplicate IDs.");
  const siblings = new Set<string>();
  for (const node of nodes) {
    if (node.parentId !== null && byId.get(node.parentId)?.kind === "file") throw new Error("A created node parent must be a folder.");
    const sibling = `${node.parentId ?? ""}\0${node.name.toLowerCase()}`;
    if (siblings.has(sibling)) throw new Error("A created node batch contains duplicate sibling names.");
    siblings.add(sibling);
    const seen = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null && byId.has(parentId)) {
      if (seen.has(parentId)) throw new Error("A created node batch contains a cycle.");
      seen.add(parentId);
      parentId = byId.get(parentId)!.parentId;
    }
  }
  return nodes;
}

function parsePositions(value: unknown) {
  const positions = boundedNonemptyArray(value, "A position batch is invalid.").map((candidate) => {
    if (!isRecord(candidate)) throw new Error("A position update has an unsupported shape.");
    assertExactKeys(candidate, ["nodeId", "position"], "A position update has an unsupported shape.");
    return { nodeId: parseStableId(candidate.nodeId, "A position node ID is invalid."), position: parsePosition(candidate.position) };
  });
  if (new Set(positions.map(({ nodeId }) => nodeId)).size !== positions.length) throw new Error("A position batch contains duplicate node IDs.");
  return positions;
}

function parseSettings(value: unknown, namespace: SettingNamespace) {
  const settings = boundedNonemptyArray(value, "A setting batch is invalid.").map((candidate): SettingChange => {
    if (!isRecord(candidate)) throw new Error("A setting change has an unsupported shape.");
    assertExactKeys(candidate, ["key", "value"], "A setting change has an unsupported shape.");
    const setting = parseWorkspaceSetting(namespace, candidate.key, candidate.value);
    return { key: setting.key, value: setting.value };
  });
  if (new Set(settings.map(({ key }) => key)).size !== settings.length) throw new Error("A setting batch contains duplicate keys.");
  return settings;
}

export function parseWorkspaceOperation(value: unknown): WorkspaceOperation {
  if (!isRecord(value) || typeof value.kind !== "string") throw new Error("An operation has an unsupported shape.");
  const base = parseBase(value);
  switch (value.kind) {
    case "create": {
      exactOperation(value, ["nodes"]);
      return { ...base, kind: "create", nodes: parseNewNodes(value.nodes) };
    }
    case "write":
      exactOperation(value, ["nodeId", "mimeType", "size", "manifestHash", "modifiedAt"]);
      return { ...base, kind: "write", nodeId: parseStableId(value.nodeId, "A written node ID is invalid."), mimeType: parseMimeType(value.mimeType), size: parseNonNegativeSafeInteger(value.size), manifestHash: parseSha256(value.manifestHash), modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt) };
    case "copy": {
      exactOperation(value, ["sourceNodeIds", "nodes"]);
      const sourceNodeIds = parseIdArray(value.sourceNodeIds, "A copy source batch is invalid.");
      const nodes = parseNewNodes(value.nodes);
      if (nodes.some(({ id }) => sourceNodeIds.includes(id))) throw new Error("Copied nodes require new stable IDs.");
      return { ...base, kind: "copy", sourceNodeIds, nodes };
    }
    case "rename":
      exactOperation(value, ["nodeId", "name", "modifiedAt"]);
      return { ...base, kind: "rename", nodeId: parseStableId(value.nodeId), name: parseCanonicalName(value.name), modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt) };
    case "move": {
      exactOperation(value, ["nodeIds", "parentId", "modifiedAt"]);
      const nodeIds = parseIdArray(value.nodeIds, "A move batch is invalid.");
      const parentId = value.parentId === null ? null : parseStableId(value.parentId, "A move parent ID is invalid.");
      if (parentId !== null && nodeIds.includes(parentId)) throw new Error("A moved root cannot be its destination parent.");
      return { ...base, kind: "move", nodeIds, parentId, modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt) };
    }
    case "position":
      exactOperation(value, ["positions"]);
      return { ...base, kind: "position", positions: parsePositions(value.positions) };
    case "transfer": {
      exactOperation(value, ["nodeIds", "destinationWorkspaceId", "parentId", "modifiedAt"]);
      const nodeIds = parseIdArray(value.nodeIds, "A transfer batch is invalid.");
      const destinationWorkspaceId = parseStableId(value.destinationWorkspaceId, "A destination workspace ID is invalid.");
      if (destinationWorkspaceId === base.workspaceId) throw new Error("A transfer requires a different destination workspace.");
      return { ...base, kind: "transfer", nodeIds, destinationWorkspaceId, parentId: value.parentId === null ? null : parseStableId(value.parentId, "A transfer parent ID is invalid."), modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt) };
    }
    case "trash":
      exactOperation(value, ["nodeIds", "trashedAt"]);
      return { ...base, kind: "trash", nodeIds: parseIdArray(value.nodeIds, "A Trash batch is invalid."), trashedAt: parseNonNegativeSafeInteger(value.trashedAt) };
    case "restore":
      exactOperation(value, ["nodeIds", "destination", "modifiedAt"]);
      if (value.destination !== "original" && value.destination !== "root") throw new Error("A restore destination is invalid.");
      return { ...base, kind: "restore", nodeIds: parseIdArray(value.nodeIds, "A restore batch is invalid."), destination: value.destination, modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt) };
    case "purge":
      exactOperation(value, ["nodeIds"]);
      return { ...base, kind: "purge", nodeIds: parseIdArray(value.nodeIds, "A purge batch is invalid.") };
    case "set":
      exactOperation(value, ["namespace", "key", "value"]);
      return { ...base, kind: "set", ...parseWorkspaceSetting(value.namespace, value.key, value.value) };
    case "set-many": {
      exactOperation(value, ["namespace", "settings"]);
      const namespace = parseSettingNamespace(value.namespace);
      return { ...base, kind: "set-many", namespace, settings: parseSettings(value.settings, namespace) };
    }
    default:
      throw new Error("An operation kind is unsupported.");
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported operation: ${JSON.stringify(value)}`);
}

export function operationAffectedIdentities(operation: WorkspaceOperation) {
  const affected = new Set<string>();
  const node = (workspaceId: string, nodeId: string) => affected.add(`node:${workspaceId}:${nodeId}`);
  const content = (workspaceId: string, nodeId: string) => affected.add(`content:${workspaceId}:${nodeId}`);
  const folder = (workspaceId: string, parentId: string | null) => affected.add(`folder:${workspaceId}:${parentId ?? "root"}`);
  const created = (nodes: readonly NewNode[]) => {
    for (const item of nodes) {
      node(operation.workspaceId, item.id);
      folder(operation.workspaceId, item.parentId);
      if (item.kind === "file") content(operation.workspaceId, item.id);
    }
  };
  switch (operation.kind) {
    case "create": created(operation.nodes); break;
    case "write": node(operation.workspaceId, operation.nodeId); content(operation.workspaceId, operation.nodeId); break;
    case "copy": created(operation.nodes); break;
    case "rename": node(operation.workspaceId, operation.nodeId); break;
    case "move": operation.nodeIds.forEach((id) => node(operation.workspaceId, id)); folder(operation.workspaceId, operation.parentId); break;
    case "position": operation.positions.forEach(({ nodeId }) => node(operation.workspaceId, nodeId)); break;
    case "transfer":
      for (const id of operation.nodeIds) { node(operation.workspaceId, id); node(operation.destinationWorkspaceId, id); }
      folder(operation.destinationWorkspaceId, operation.parentId);
      break;
    case "trash": operation.nodeIds.forEach((id) => node(operation.workspaceId, id)); affected.add(`trash:${operation.workspaceId}`); break;
    case "restore": operation.nodeIds.forEach((id) => node(operation.workspaceId, id)); affected.add(`trash:${operation.workspaceId}`); if (operation.destination === "root") folder(operation.workspaceId, null); break;
    case "purge": operation.nodeIds.forEach((id) => node(operation.workspaceId, id)); affected.add(`trash:${operation.workspaceId}`); break;
    case "set": affected.add(`setting:${operation.workspaceId}:${operation.namespace}:${operation.key}`); break;
    case "set-many": operation.settings.forEach(({ key }) => affected.add(`setting:${operation.workspaceId}:${operation.namespace}:${key}`)); break;
    default: assertNever(operation);
  }
  return [...affected].sort();
}

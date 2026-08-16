import {
  WEB2_INDEXED_DB_PREFIX,
  WEB2_MAX_ANCESTRY_DEPTH,
  WEB2_MAX_BATCH_ITEMS,
  assertExactKeys,
  canonicalManifestSha256,
  isRecord,
  parseCanonicalName,
  parseManifest,
  parseMimeType,
  parseNode,
  parseNodeLifecycle,
  parseNonNegativeSafeInteger,
  parseOperationTuple,
  parsePosition,
  parsePositiveSafeInteger,
  parseSha256,
  parseStableId,
  parseSetting,
  parseSettingKeyForNamespace,
  parseSettingNamespace,
  parseWorkspaceSetting,
  sha256Hex,
  type JsonValue,
  type Manifest,
  type Node,
  type NodeLifecycle,
  type OperationTuple,
  type Position,
  type Setting,
  type SettingNamespace,
} from "./model";
import {
  operationAffectedIdentities,
  parseWorkspaceOperation,
  type WorkspaceOperation,
} from "./operations";

const DATABASE_VERSION = 1;
const FILE_VERSION_HISTORY_LIMIT = 20;
const MAX_WORKSPACES = WEB2_MAX_BATCH_ITEMS;
const STORES = ["workspaces", "nodes", "manifests", "operations", "changes", "sync", "settings", "hydration-pages"] as const;
const STORE_SCHEMA = {
  workspaces: { keyPath: "id", indexes: {} },
  nodes: {
    keyPath: "id",
    indexes: {
      "by-workspace-parent-lifecycle": { keyPath: ["workspaceId", "parentKey", "lifecycleKey"], unique: false },
      "by-workspace-lifecycle": { keyPath: ["workspaceId", "lifecycleKey"], unique: false },
    },
  },
  manifests: { keyPath: "hash", indexes: {} },
  operations: {
    keyPath: "operationId",
    indexes: {
      "by-workspace-revision": { keyPath: ["workspaceId", "localRevision"], unique: true },
      "by-workspace-state-revision": { keyPath: ["workspaceId", "stateKind", "localRevision"], unique: false },
    },
  },
  changes: { keyPath: ["workspaceId", "revision"], indexes: {} },
  sync: { keyPath: "workspaceId", indexes: {} },
  settings: { keyPath: ["workspaceId", "namespace", "key"], indexes: {} },
  "hydration-pages": { keyPath: ["workspaceId", "targetId", "pageIndex"], indexes: {} },
} as const;

export type Workspace = {
  id: string;
  name: string;
  pinned: boolean;
  ordinal: number;
  headSequence: number;
  snapshotBarrier: number;
  logFloor: number;
  localRevision: number;
};

export type SyncState = {
  workspaceId: string;
  deviceId: string;
  cursor: number;
  lastObservedLogicalTime: number;
  lastLocalLogicalTime: number;
};

type LocallyCommittableOperation = Extract<WorkspaceOperation, { kind: "create" | "write" | "copy" | "rename" | "move" | "position" | "transfer" | "trash" | "restore" | "purge" | "set" | "set-many" }>;
export type WorkspaceOperationDraft = {
  [Kind in LocallyCommittableOperation["kind"]]: Omit<Extract<LocallyCommittableOperation, { kind: Kind }>, "logicalTime">;
}[LocallyCommittableOperation["kind"]];

export type OperationIntent = "forward" | "undo" | "redo" | "restore";
type PreviousSetting = { exists: false } | { exists: true; value: JsonValue };
export type OperationInverse =
  | { kind: "create"; rootNodeIds: string[] }
  | { kind: "copy"; rootNodeIds: string[]; sourceNodeIds: string[]; sourceFileNodeIds: string[] }
  | { kind: "write"; nodeId: string; mimeType: string; size: number; manifestHash: string; modifiedAt: number }
  | { kind: "rename"; nodeId: string; name: string; modifiedAt: number }
  | { kind: "move"; roots: Array<{ nodeId: string; parentId: string | null; modifiedAt: number }> }
  | { kind: "transfer"; nodes: Array<{ nodeId: string; parentId: string | null; modifiedAt: number }>; fileNodeIds: string[] }
  | { kind: "position"; positions: Array<{ nodeId: string; position: Position }> }
  | { kind: "trash"; roots: Array<{ nodeId: string; parentId: string | null }>; nodeIds: string[] }
  | { kind: "restore"; roots: Array<{ nodeId: string; parentId: string | null; modifiedAt: number }>; nodes: Array<{ nodeId: string; lifecycle: Extract<NodeLifecycle, { kind: "trashed" }> }> }
  | { kind: "purge"; nodeIds: string[]; reason: "Permanent purge cannot be undone." }
  | { kind: "set"; namespace: SettingNamespace; key: string; previous: PreviousSetting }
  | { kind: "set-many"; namespace: SettingNamespace; settings: Array<{ key: string; previous: PreviousSetting }> };

export type StoredOperation = {
  operationId: string;
  workspaceId: string;
  localRevision: number;
  destinationLocalRevision: number | null;
  stateKind: "pending";
  intent: OperationIntent;
  compensatesOperationId: string | null;
  expectedContentTuple: OperationTuple | null;
  operation: LocallyCommittableOperation;
  inverse: OperationInverse;
  affectedIdentities: string[];
  versionNodeIds: string[];
};

export type ChangeRecord = {
  workspaceId: string;
  revision: number;
  operationId: string;
  affectedIdentities: string[];
};

export type FileVersion = {
  nodeId: string;
  operationId: string;
  logicalTime: number;
  mimeType: string;
  size: number;
  manifestHash: string;
  modifiedAt: number;
  current: boolean;
};

export type FilesystemDatabaseEnvironment = {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  now?: () => number;
};

type CommitOperationBase = {
  manifests?: Array<{ hash: string; manifest: Manifest }>;
  intent?: OperationIntent;
  compensatesOperationId?: string | null;
};
export type CommitOperationInput = CommitOperationBase & (
  | { operation: Extract<WorkspaceOperationDraft, { kind: "create" }>; expectedContentTuple?: never }
  | { operation: Extract<WorkspaceOperationDraft, { kind: "write" }>; expectedContentTuple: OperationTuple }
  | { operation: Exclude<WorkspaceOperationDraft, { kind: "create" | "write" }>; expectedContentTuple?: never }
);

export type FilesystemDatabase = {
  close(): void;
  createWorkspace(value: { id: string; name: string; pinned: boolean; deviceId: string }): Promise<Workspace>;
  listWorkspaces(): Promise<Workspace[]>;
  renameWorkspace(workspaceId: string, name: string): Promise<Workspace>;
  setWorkspacePreferences(preferences: Array<{ id: string; pinned: boolean }>): Promise<Workspace[]>;
  deleteWorkspace(workspaceId: string): Promise<Workspace[]>;
  getNode(id: string): Promise<Node | undefined>;
  listChildren(workspaceId: string, parentId: string | null, limit?: number): Promise<Node[]>;
  assertChildNamesAvailable(workspaceId: string, parentId: string | null, names: string[]): Promise<void>;
  assertNodeIdsAvailable(ids: string[]): Promise<void>;
  listTrash(workspaceId: string): Promise<Node[]>;
  getSetting(workspaceId: string, namespace: SettingNamespace, key: string): Promise<Setting | undefined>;
  listSettings(workspaceId: string, namespace: SettingNamespace): Promise<Setting[]>;
  getSyncState(workspaceId: string): Promise<SyncState>;
  getManifest(hash: string): Promise<Manifest | undefined>;
  getOperation(operationId: string): Promise<StoredOperation | undefined>;
  commitOperation(value: CommitOperationInput): Promise<StoredOperation>;
  listChanges(workspaceId: string, afterRevision: number, limit?: number): Promise<ChangeRecord[]>;
  listOperations(workspaceId: string, limit?: number): Promise<StoredOperation[]>;
  listFileVersions(workspaceId: string, nodeId: string): Promise<FileVersion[]>;
  listRetainedChunkHashes(): Promise<string[]>;
};

type StoredNode = Node & { parentKey: string; lifecycleKey: string };
type StoredManifest = { hash: string; manifest: Manifest };

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Filesystem storage failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("The filesystem transaction was cancelled."));
    transaction.onerror = () => reject(transaction.error ?? new Error("The filesystem transaction failed."));
  });
}

async function transact<T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => Promise<T>) {
  const transaction = mode === "readwrite"
    ? db.transaction(stores, mode, { durability: "strict" })
    : db.transaction(stores, mode);
  const done = transactionDone(transaction);
  try {
    const result = await operation(transaction);
    await done;
    return result;
  } catch (error) {
    try { transaction.abort(); } catch { /* The transaction already ended. */ }
    await done.catch(() => undefined);
    throw error;
  }
}

function parseWorkspace(value: unknown): Workspace {
  if (!isRecord(value)) throw new Error("A stored workspace has an unsupported shape.");
  assertExactKeys(value, ["id", "name", "pinned", "ordinal", "headSequence", "snapshotBarrier", "logFloor", "localRevision"], "A stored workspace has an unsupported shape.");
  if (typeof value.pinned !== "boolean") throw new Error("A stored workspace has invalid pinning metadata.");
  const workspace = {
    id: parseStableId(value.id, "A stored workspace ID is invalid."),
    name: parseCanonicalName(value.name, "A stored workspace name is invalid."),
    pinned: value.pinned,
    ordinal: parseNonNegativeSafeInteger(value.ordinal, "A stored workspace ordinal is invalid."),
    headSequence: parseNonNegativeSafeInteger(value.headSequence, "A stored workspace head is invalid."),
    snapshotBarrier: parseNonNegativeSafeInteger(value.snapshotBarrier, "A stored workspace snapshot barrier is invalid."),
    logFloor: parseNonNegativeSafeInteger(value.logFloor, "A stored workspace log floor is invalid."),
    localRevision: parseNonNegativeSafeInteger(value.localRevision, "A stored workspace revision is invalid."),
  };
  if (workspace.logFloor > workspace.snapshotBarrier || workspace.snapshotBarrier > workspace.headSequence) throw new Error("A stored workspace sequence range is invalid.");
  return workspace;
}

function parseWorkspaceList(values: unknown[]) {
  const workspaces = values.map(parseWorkspace).sort((left, right) => left.ordinal - right.ordinal);
  if (workspaces.length > MAX_WORKSPACES || workspaces.some(({ ordinal }, index) => ordinal !== index) || new Set(workspaces.map(({ name }) => name.toLowerCase())).size !== workspaces.length) throw new Error("Stored workspace directory metadata is invalid.");
  let unpinned = false;
  for (const workspace of workspaces) {
    if (!workspace.pinned) unpinned = true;
    else if (unpinned) throw new Error("Stored workspace directory metadata is invalid.");
  }
  return workspaces;
}

function parseSyncState(value: unknown): SyncState {
  if (!isRecord(value)) throw new Error("Stored synchronization state has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "deviceId", "cursor", "lastObservedLogicalTime", "lastLocalLogicalTime"], "Stored synchronization state has an unsupported shape.");
  return {
    workspaceId: parseStableId(value.workspaceId, "A stored synchronization workspace ID is invalid."),
    deviceId: parseStableId(value.deviceId, "A stored synchronization device ID is invalid."),
    cursor: parseNonNegativeSafeInteger(value.cursor, "A stored synchronization cursor is invalid."),
    lastObservedLogicalTime: parseNonNegativeSafeInteger(value.lastObservedLogicalTime, "A stored observed logical time is invalid."),
    lastLocalLogicalTime: parseNonNegativeSafeInteger(value.lastLocalLogicalTime, "A stored local logical time is invalid."),
  };
}

function parseStoredNode(value: unknown): StoredNode {
  if (!isRecord(value) || typeof value.parentKey !== "string" || typeof value.lifecycleKey !== "string") throw new Error("A stored node has an unsupported shape.");
  const nodeValue = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "parentKey" && key !== "lifecycleKey"));
  const node = parseNode(nodeValue);
  const parentKey = node.parentId ?? "";
  if (value.parentKey !== parentKey || value.lifecycleKey !== node.lifecycle.kind) throw new Error("A stored node has inconsistent index metadata.");
  return { ...node, parentKey, lifecycleKey: node.lifecycle.kind };
}

function nodeRecord(value: StoredNode) {
  return parseNode(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "parentKey" && key !== "lifecycleKey")));
}

function storeNode(value: Node | StoredNode): StoredNode {
  const node = "parentKey" in value ? nodeRecord(value) : parseNode(value);
  return { ...node, parentKey: node.parentId ?? "", lifecycleKey: node.lifecycle.kind };
}

function parseStoredManifest(value: unknown): StoredManifest {
  if (!isRecord(value)) throw new Error("A stored manifest has an unsupported shape.");
  assertExactKeys(value, ["hash", "manifest"], "A stored manifest has an unsupported shape.");
  return { hash: parseSha256(value.hash, "A stored manifest hash is invalid."), manifest: parseManifest(value.manifest) };
}

async function validateStoredManifest(value: unknown, expectedHash?: string) {
  const record = parseStoredManifest(value);
  if (expectedHash !== undefined && record.hash !== expectedHash) throw new Error("Stored manifest identity metadata is inconsistent.");
  if (await canonicalManifestSha256(record.manifest) !== record.hash) throw new Error("A stored manifest hash does not match its canonical bytes.");
  return record;
}

function parseIntent(value: unknown): OperationIntent {
  if (value !== "forward" && value !== "undo" && value !== "redo" && value !== "restore") throw new Error("An operation intent is invalid.");
  return value;
}

function parseStringSet(value: unknown, message: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) throw new Error(message);
  const result = value as string[];
  if (new Set(result).size !== result.length) throw new Error(message);
  return result;
}

function parseStoredIds(value: unknown, message: string, allowEmpty = false, maxItems: number | null = WEB2_MAX_BATCH_ITEMS) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0 || maxItems !== null && value.length > maxItems) throw new Error(message);
  const result = value.map((id) => parseStableId(id, message));
  if (new Set(result).size !== result.length) throw new Error(message);
  return result;
}

function isSorted(values: readonly string[]) {
  return values.every((value, index) => index === 0 || values[index - 1]! <= value);
}

function parseInverseRoot(value: unknown, message: string) {
  if (!isRecord(value)) throw new Error(message);
  assertExactKeys(value, ["nodeId", "parentId"], message);
  return { nodeId: parseStableId(value.nodeId, message), parentId: value.parentId === null ? null : parseStableId(value.parentId, message) };
}

function parsePreviousSetting(value: unknown, namespace: SettingNamespace, key: string): PreviousSetting {
  if (!isRecord(value) || typeof value.exists !== "boolean") throw new Error("Stored setting inverse metadata has an unsupported shape.");
  if (!value.exists) {
    assertExactKeys(value, ["exists"], "Stored setting inverse metadata has an unsupported shape.");
    return { exists: false };
  }
  assertExactKeys(value, ["exists", "value"], "Stored setting inverse metadata has an unsupported shape.");
  return { exists: true, value: parseWorkspaceSetting(namespace, key, value.value).value };
}

function parseOperationInverse(value: unknown): OperationInverse {
  if (!isRecord(value) || typeof value.kind !== "string") throw new Error("Stored operation inverse metadata has an unsupported shape.");
  switch (value.kind) {
    case "create":
      assertExactKeys(value, ["kind", "rootNodeIds"], "Stored operation inverse metadata has an unsupported shape.");
      return { kind: "create", rootNodeIds: parseStoredIds(value.rootNodeIds, "Stored create inverse roots are invalid.") };
    case "copy": {
      assertExactKeys(value, ["kind", "rootNodeIds", "sourceNodeIds", "sourceFileNodeIds"], "Stored operation inverse metadata has an unsupported shape.");
      const rootNodeIds = parseStoredIds(value.rootNodeIds, "Stored copy inverse roots are invalid.");
      const sourceNodeIds = parseStoredIds(value.sourceNodeIds, "Stored copy source node IDs are invalid.");
      const sourceFileNodeIds = parseStoredIds(value.sourceFileNodeIds, "Stored copy source file IDs are invalid.", true);
      if (!isSorted(sourceNodeIds) || !isSorted(sourceFileNodeIds) || sourceFileNodeIds.some((id) => !sourceNodeIds.includes(id))) throw new Error("Stored copy source IDs are invalid.");
      return { kind: "copy", rootNodeIds, sourceNodeIds, sourceFileNodeIds };
    }
    case "write":
      assertExactKeys(value, ["kind", "nodeId", "mimeType", "size", "manifestHash", "modifiedAt"], "Stored operation inverse metadata has an unsupported shape.");
      return { kind: "write", nodeId: parseStableId(value.nodeId, "A stored write inverse node ID is invalid."), mimeType: parseMimeType(value.mimeType, "A stored write inverse MIME type is invalid."), size: parseNonNegativeSafeInteger(value.size, "A stored write inverse size is invalid."), manifestHash: parseSha256(value.manifestHash, "A stored write inverse manifest hash is invalid."), modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt, "A stored write inverse modification time is invalid.") };
    case "rename":
      assertExactKeys(value, ["kind", "nodeId", "name", "modifiedAt"], "Stored operation inverse metadata has an unsupported shape.");
      return { kind: "rename", nodeId: parseStableId(value.nodeId), name: parseCanonicalName(value.name), modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt) };
    case "move": {
      assertExactKeys(value, ["kind", "roots"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored move inverse roots are invalid.");
      const roots = value.roots.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored move inverse roots are invalid.");
        assertExactKeys(candidate, ["nodeId", "parentId", "modifiedAt"], "Stored move inverse roots are invalid.");
        return { nodeId: parseStableId(candidate.nodeId), parentId: candidate.parentId === null ? null : parseStableId(candidate.parentId), modifiedAt: parseNonNegativeSafeInteger(candidate.modifiedAt) };
      });
      if (new Set(roots.map(({ nodeId }) => nodeId)).size !== roots.length) throw new Error("Stored move inverse roots are invalid.");
      return { kind: "move", roots };
    }
    case "transfer": {
      assertExactKeys(value, ["kind", "nodes", "fileNodeIds"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored transfer inverse nodes are invalid.");
      const nodes = value.nodes.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored transfer inverse nodes are invalid.");
        assertExactKeys(candidate, ["nodeId", "parentId", "modifiedAt"], "Stored transfer inverse nodes are invalid.");
        return { nodeId: parseStableId(candidate.nodeId), parentId: candidate.parentId === null ? null : parseStableId(candidate.parentId), modifiedAt: parseNonNegativeSafeInteger(candidate.modifiedAt) };
      });
      const nodeIds = nodes.map(({ nodeId }) => nodeId);
      const fileNodeIds = parseStoredIds(value.fileNodeIds, "Stored transfer inverse file IDs are invalid.", true);
      if (!isSorted(nodeIds) || new Set(nodeIds).size !== nodeIds.length || !isSorted(fileNodeIds) || fileNodeIds.some((id) => !nodeIds.includes(id))) throw new Error("Stored transfer inverse metadata is invalid.");
      return { kind: "transfer", nodes, fileNodeIds };
    }
    case "position": {
      assertExactKeys(value, ["kind", "positions"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.positions) || value.positions.length === 0 || value.positions.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored position inverse metadata is invalid.");
      const positions = value.positions.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored position inverse metadata is invalid.");
        assertExactKeys(candidate, ["nodeId", "position"], "Stored position inverse metadata is invalid.");
        return { nodeId: parseStableId(candidate.nodeId), position: parsePosition(candidate.position) };
      });
      if (new Set(positions.map(({ nodeId }) => nodeId)).size !== positions.length) throw new Error("Stored position inverse metadata is invalid.");
      return { kind: "position", positions };
    }
    case "trash": {
      assertExactKeys(value, ["kind", "roots", "nodeIds"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored Trash inverse roots are invalid.");
      const roots = value.roots.map((candidate) => parseInverseRoot(candidate, "Stored Trash inverse roots are invalid."));
      const nodeIds = parseStoredIds(value.nodeIds, "Stored Trash inverse node IDs are invalid.");
      if (!isSorted(nodeIds) || new Set(roots.map(({ nodeId }) => nodeId)).size !== roots.length || roots.some(({ nodeId }) => !nodeIds.includes(nodeId))) throw new Error("Stored Trash inverse roots are invalid.");
      return { kind: "trash", roots, nodeIds };
    }
    case "restore": {
      assertExactKeys(value, ["kind", "roots", "nodes"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.roots) || value.roots.length === 0 || value.roots.length > WEB2_MAX_BATCH_ITEMS || !Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored restore inverse metadata is invalid.");
      const roots = value.roots.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored restore inverse roots are invalid.");
        assertExactKeys(candidate, ["nodeId", "parentId", "modifiedAt"], "Stored restore inverse roots are invalid.");
        return { nodeId: parseStableId(candidate.nodeId), parentId: candidate.parentId === null ? null : parseStableId(candidate.parentId), modifiedAt: parseNonNegativeSafeInteger(candidate.modifiedAt) };
      });
      const nodes = value.nodes.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored restore inverse nodes are invalid.");
        assertExactKeys(candidate, ["nodeId", "lifecycle"], "Stored restore inverse nodes are invalid.");
        const lifecycle = parseNodeLifecycle(candidate.lifecycle);
        if (lifecycle.kind !== "trashed") throw new Error("Stored restore inverse nodes are invalid.");
        return { nodeId: parseStableId(candidate.nodeId), lifecycle };
      });
      if (!isSorted(nodes.map(({ nodeId }) => nodeId)) || new Set(roots.map(({ nodeId }) => nodeId)).size !== roots.length || new Set(nodes.map(({ nodeId }) => nodeId)).size !== nodes.length || roots.some(({ nodeId }) => !nodes.some((node) => node.nodeId === nodeId))) throw new Error("Stored restore inverse metadata is invalid.");
      return { kind: "restore", roots, nodes };
    }
    case "purge": {
      assertExactKeys(value, ["kind", "nodeIds", "reason"], "Stored operation inverse metadata has an unsupported shape.");
      if (value.reason !== "Permanent purge cannot be undone.") throw new Error("Stored purge inverse metadata is invalid.");
      const nodeIds = parseStoredIds(value.nodeIds, "Stored purge inverse node IDs are invalid.");
      if (!isSorted(nodeIds)) throw new Error("Stored purge inverse node IDs are invalid.");
      return { kind: "purge", nodeIds, reason: value.reason };
    }
    case "set": {
      assertExactKeys(value, ["kind", "namespace", "key", "previous"], "Stored operation inverse metadata has an unsupported shape.");
      const { namespace, key } = parseSettingKeyForNamespace(value.namespace, value.key);
      return { kind: "set", namespace, key, previous: parsePreviousSetting(value.previous, namespace, key) };
    }
    case "set-many": {
      assertExactKeys(value, ["kind", "namespace", "settings"], "Stored operation inverse metadata has an unsupported shape.");
      if (!Array.isArray(value.settings) || value.settings.length === 0 || value.settings.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored setting batch inverse metadata is invalid.");
      const namespace = parseSettingNamespace(value.namespace);
      const settings = value.settings.map((candidate) => {
        if (!isRecord(candidate)) throw new Error("Stored setting batch inverse metadata is invalid.");
        assertExactKeys(candidate, ["key", "previous"], "Stored setting batch inverse metadata is invalid.");
        const key = parseSettingKeyForNamespace(namespace, candidate.key).key;
        return { key, previous: parsePreviousSetting(candidate.previous, namespace, key) };
      });
      if (new Set(settings.map(({ key }) => key)).size !== settings.length) throw new Error("Stored setting batch inverse metadata is invalid.");
      return { kind: "set-many", namespace, settings };
    }
    default:
      throw new Error("Stored operation inverse metadata has an unsupported shape.");
  }
}

function operationVersionNodeIds(operation: LocallyCommittableOperation) {
  if (operation.kind === "create" || operation.kind === "copy") return operation.nodes.filter((node) => node.kind === "file").map(({ id }) => id);
  return operation.kind === "write" ? [operation.nodeId] : [];
}

function createdRootIds(operation: Extract<WorkspaceOperation, { kind: "create" | "copy" }>) {
  const ids = new Set(operation.nodes.map(({ id }) => id));
  return operation.nodes.filter(({ parentId }) => parentId === null || !ids.has(parentId)).map(({ id }) => id);
}

function equalValues(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function localAffectedIdentities(operation: LocallyCommittableOperation, inverse: OperationInverse) {
  if (operation.kind === "transfer" && inverse.kind === "transfer") {
    const { source, destination } = transferAffectedIdentities(operation, inverse);
    return [...new Set([...source, ...destination])].sort();
  }
  const affected = new Set(operationAffectedIdentities(operation));
  const node = (nodeId: string) => affected.add(`node:${operation.workspaceId}:${nodeId}`);
  const content = (nodeId: string) => affected.add(`content:${operation.workspaceId}:${nodeId}`);
  const folder = (parentId: string | null) => affected.add(`folder:${operation.workspaceId}:${parentId ?? "root"}`);
  if (inverse.kind === "copy") {
    inverse.sourceNodeIds.forEach(node);
    inverse.sourceFileNodeIds.forEach(content);
  }
  switch (inverse.kind) {
    case "move":
      for (const root of inverse.roots) { node(root.nodeId); folder(root.parentId); folder(operation.kind === "move" ? operation.parentId : null); }
      break;
    case "trash":
      inverse.nodeIds.forEach(node);
      for (const root of inverse.roots) { folder(root.parentId); folder(null); }
      break;
    case "restore": {
      inverse.nodes.forEach(({ nodeId }) => node(nodeId));
      for (const root of inverse.roots) {
        folder(root.parentId);
        const lifecycle = inverse.nodes.find(({ nodeId }) => nodeId === root.nodeId)!.lifecycle;
        folder(operation.kind === "restore" && operation.destination === "original" ? lifecycle.originalParentId : null);
      }
      break;
    }
    case "purge":
      inverse.nodeIds.forEach(node);
      folder(null);
      break;
  }
  return [...affected].sort();
}

function transferAffectedIdentities(operation: Extract<LocallyCommittableOperation, { kind: "transfer" }>, inverse: Extract<OperationInverse, { kind: "transfer" }>) {
  const source = new Set<string>();
  const destination = new Set<string>();
  const fileNodeIds = new Set(inverse.fileNodeIds);
  const addNodeIdentities = (affected: Set<string>, workspaceId: string, nodeId: string) => {
    affected.add(`node:${workspaceId}:${nodeId}`);
    affected.add(`${fileNodeIds.has(nodeId) ? "content" : "folder"}:${workspaceId}:${nodeId}`);
  };
  for (const { nodeId } of inverse.nodes) {
    addNodeIdentities(source, operation.workspaceId, nodeId);
    addNodeIdentities(destination, operation.destinationWorkspaceId, nodeId);
  }
  for (const rootId of operation.nodeIds) {
    const root = inverse.nodes.find(({ nodeId }) => nodeId === rootId);
    if (root) source.add(`folder:${operation.workspaceId}:${root.parentId ?? "root"}`);
  }
  destination.add(`folder:${operation.destinationWorkspaceId}:${operation.parentId ?? "root"}`);
  return { source: [...source].sort(), destination: [...destination].sort() };
}

function changeForWorkspace(stored: StoredOperation, workspaceId: string): ChangeRecord | undefined {
  if (stored.operation.kind === "transfer" && stored.inverse.kind === "transfer") {
    const identities = transferAffectedIdentities(stored.operation, stored.inverse);
    if (workspaceId === stored.workspaceId) return { workspaceId, revision: stored.localRevision, operationId: stored.operationId, affectedIdentities: identities.source };
    if (workspaceId === stored.operation.destinationWorkspaceId && stored.destinationLocalRevision !== null) return { workspaceId, revision: stored.destinationLocalRevision, operationId: stored.operationId, affectedIdentities: identities.destination };
    return;
  }
  if (workspaceId !== stored.workspaceId) return;
  return { workspaceId, revision: stored.localRevision, operationId: stored.operationId, affectedIdentities: stored.affectedIdentities };
}

function parseStoredOperation(value: unknown): StoredOperation {
  if (!isRecord(value)) throw new Error("A stored operation has an unsupported shape.");
  assertExactKeys(value, ["operationId", "workspaceId", "localRevision", "destinationLocalRevision", "stateKind", "intent", "compensatesOperationId", "expectedContentTuple", "operation", "inverse", "affectedIdentities", "versionNodeIds"], "A stored operation has an unsupported shape.");
  if (value.stateKind !== "pending") throw new Error("A stored operation state is invalid.");
  const operation = parseWorkspaceOperation(value.operation);
  const stored = {
    operationId: parseStableId(value.operationId, "A stored operation ID is invalid."),
    workspaceId: parseStableId(value.workspaceId, "A stored operation workspace ID is invalid."),
    localRevision: parsePositiveSafeInteger(value.localRevision, "A stored operation revision is invalid."),
    destinationLocalRevision: value.destinationLocalRevision === null ? null : parsePositiveSafeInteger(value.destinationLocalRevision, "A stored destination operation revision is invalid."),
    stateKind: "pending" as const,
    intent: parseIntent(value.intent),
    compensatesOperationId: value.compensatesOperationId === null ? null : parseStableId(value.compensatesOperationId, "A compensated operation ID is invalid."),
    expectedContentTuple: value.expectedContentTuple === null ? null : parseOperationTuple(value.expectedContentTuple),
    operation,
    inverse: parseOperationInverse(value.inverse),
    affectedIdentities: parseStringSet(value.affectedIdentities, "Stored operation identities are invalid."),
    versionNodeIds: parseStringSet(value.versionNodeIds, "Stored operation version node IDs are invalid.").map((id) => parseStableId(id, "A stored operation version node ID is invalid.")),
  };
  if (stored.operationId !== operation.operationId || stored.workspaceId !== operation.workspaceId) throw new Error("Stored operation identity metadata is inconsistent.");
  if (operation.kind === "transfer" && stored.destinationLocalRevision === null || operation.kind !== "transfer" && stored.destinationLocalRevision !== null) throw new Error("Stored operation destination revision metadata is inconsistent.");
  if (stored.intent === "forward" && stored.compensatesOperationId !== null || stored.intent !== "forward" && stored.compensatesOperationId === null) throw new Error("Stored operation compensation metadata is inconsistent.");
  if (operation.kind === "write" && stored.expectedContentTuple === null || operation.kind !== "write" && stored.expectedContentTuple !== null) throw new Error("Stored operation expectation metadata is inconsistent.");
  const lifecycleCompensation = operation.kind === "trash" && stored.intent === "undo" || operation.kind === "restore" && stored.intent === "redo";
  if (operation.kind !== "write" && stored.intent !== "forward" && !lifecycleCompensation) throw new Error("Stored operation intent is unsupported for metadata projection.");
  if (!equalValues(stored.affectedIdentities, localAffectedIdentities(operation, stored.inverse)) || !equalValues(stored.versionNodeIds, operationVersionNodeIds(operation))) throw new Error("Stored operation derived metadata is inconsistent.");
  switch (operation.kind) {
    case "create":
      if (stored.inverse.kind !== "create" || !equalValues(stored.inverse.rootNodeIds, createdRootIds(operation))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "copy": {
      const inverse = stored.inverse;
      if (inverse.kind !== "copy" || !equalValues(inverse.rootNodeIds, createdRootIds(operation)) || inverse.sourceNodeIds.length !== operation.nodes.length || inverse.sourceFileNodeIds.length !== operation.nodes.filter(({ kind }) => kind === "file").length || !operation.sourceNodeIds.every((id) => inverse.sourceNodeIds.includes(id)) || inverse.sourceNodeIds.some((id) => operation.nodes.some((node) => node.id === id))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    }
    case "write":
      if (stored.inverse.kind !== "write" || stored.inverse.nodeId !== operation.nodeId) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "rename":
      if (stored.inverse.kind !== "rename" || stored.inverse.nodeId !== operation.nodeId) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "move":
      if (stored.inverse.kind !== "move" || !equalValues(stored.inverse.roots.map(({ nodeId }) => nodeId), operation.nodeIds)) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "transfer": {
      const inverse = stored.inverse;
      if (inverse.kind !== "transfer" || operation.nodeIds.some((nodeId) => !inverse.nodes.some((node) => node.nodeId === nodeId))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    }
    case "position":
      if (stored.inverse.kind !== "position" || !equalValues(stored.inverse.positions.map(({ nodeId }) => nodeId), operation.positions.map(({ nodeId }) => nodeId))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "trash": {
      if (stored.inverse.kind !== "trash") throw new Error("Stored operation inverse metadata is inconsistent.");
      const inverse = stored.inverse;
      if (inverse.roots.some(({ nodeId }) => !operation.nodeIds.includes(nodeId)) || operation.nodeIds.some((nodeId) => !inverse.nodeIds.includes(nodeId))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    }
    case "restore":
      if (stored.inverse.kind !== "restore" || !equalValues(stored.inverse.roots.map(({ nodeId }) => nodeId), operation.nodeIds)) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "purge": {
      if (stored.inverse.kind !== "purge") throw new Error("Stored operation inverse metadata is inconsistent.");
      const inverse = stored.inverse;
      if (operation.nodeIds.some((nodeId) => !inverse.nodeIds.includes(nodeId))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    }
    case "set":
      if (stored.inverse.kind !== "set" || stored.inverse.namespace !== operation.namespace || stored.inverse.key !== operation.key) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
    case "set-many":
      if (stored.inverse.kind !== "set-many" || stored.inverse.namespace !== operation.namespace || !equalValues(stored.inverse.settings.map(({ key }) => key), operation.settings.map(({ key }) => key))) throw new Error("Stored operation inverse metadata is inconsistent.");
      break;
  }
  return stored;
}

function parseChangeRecord(value: unknown): ChangeRecord {
  if (!isRecord(value)) throw new Error("A stored change record has an unsupported shape.");
  assertExactKeys(value, ["workspaceId", "revision", "operationId", "affectedIdentities"], "A stored change record has an unsupported shape.");
  return {
    workspaceId: parseStableId(value.workspaceId, "A stored change workspace ID is invalid."),
    revision: parsePositiveSafeInteger(value.revision, "A stored change revision is invalid."),
    operationId: parseStableId(value.operationId, "A stored change operation ID is invalid."),
    affectedIdentities: parseStringSet(value.affectedIdentities, "Stored change identities are invalid."),
  };
}

function sameKeyPath(left: string | string[] | null, right: string | readonly string[]) {
  return equalValues(left, right);
}

function validateSchema(db: IDBDatabase) {
  if (db.version !== DATABASE_VERSION || !equalValues([...db.objectStoreNames], [...STORES].sort())) throw new Error("The filesystem database schema is malformed.");
  const transaction = db.transaction([...STORES], "readonly");
  for (const name of STORES) {
    const store = transaction.objectStore(name);
    const expected = STORE_SCHEMA[name];
    if (store.autoIncrement || !sameKeyPath(store.keyPath, expected.keyPath) || !equalValues([...store.indexNames], Object.keys(expected.indexes).sort())) throw new Error("The filesystem database schema is malformed.");
    for (const [indexName, indexSchema] of Object.entries(expected.indexes)) {
      const index = store.index(indexName);
      if (!sameKeyPath(index.keyPath, indexSchema.keyPath) || index.unique !== indexSchema.unique || index.multiEntry) throw new Error("The filesystem database schema is malformed.");
    }
  }
}

function createSchema(db: IDBDatabase) {
  db.createObjectStore("workspaces", { keyPath: "id" });
  const nodes = db.createObjectStore("nodes", { keyPath: "id" });
  nodes.createIndex("by-workspace-parent-lifecycle", ["workspaceId", "parentKey", "lifecycleKey"]);
  nodes.createIndex("by-workspace-lifecycle", ["workspaceId", "lifecycleKey"]);
  db.createObjectStore("manifests", { keyPath: "hash" });
  const operations = db.createObjectStore("operations", { keyPath: "operationId" });
  operations.createIndex("by-workspace-revision", ["workspaceId", "localRevision"], { unique: true });
  operations.createIndex("by-workspace-state-revision", ["workspaceId", "stateKind", "localRevision"]);
  db.createObjectStore("changes", { keyPath: ["workspaceId", "revision"] });
  db.createObjectStore("sync", { keyPath: "workspaceId" });
  db.createObjectStore("settings", { keyPath: ["workspaceId", "namespace", "key"] });
  db.createObjectStore("hydration-pages", { keyPath: ["workspaceId", "targetId", "pageIndex"] });
}

function openDatabase(factory: IDBFactory, name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(name, DATABASE_VERSION);
    let settled = false;
    let upgradeError: unknown;
    open.onupgradeneeded = (event) => {
      try {
        if (event.oldVersion !== 0) throw new Error("The filesystem database schema cannot be upgraded in place.");
        createSchema(open.result);
      } catch (error) {
        upgradeError = error;
        open.transaction?.abort();
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      if (settled) { db.close(); return; }
      try {
        validateSchema(db);
      } catch (error) {
        settled = true;
        db.close();
        reject(error);
        return;
      }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => {
      if (settled) return;
      settled = true;
      reject(upgradeError ?? open.error ?? new Error("The filesystem database could not be opened."));
    };
    open.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("The filesystem database is open in another tab with an incompatible version."));
    };
  });
}

export async function filesystemDatabaseName(accountId: string) {
  const canonicalId = parseStableId(accountId, "The account ID is invalid.");
  return `${WEB2_INDEXED_DB_PREFIX}${await sha256Hex(new TextEncoder().encode(canonicalId))}`;
}

function nextSafeInteger(value: number, message: string) {
  if (value >= Number.MAX_SAFE_INTEGER) throw new Error(message);
  return value + 1;
}

async function normalizeCommitInput(value: CommitOperationInput) {
  if (!isRecord(value) || !("operation" in value) || Object.keys(value).some((key) => !["operation", "manifests", "intent", "compensatesOperationId", "expectedContentTuple"].includes(key))) throw new Error("A filesystem commit has an unsupported shape.");
  if (!isRecord(value.operation) || Object.prototype.hasOwnProperty.call(value.operation, "logicalTime")) throw new Error("An operation draft must not supply a logical time.");
  const operation = parseWorkspaceOperation({ ...value.operation, logicalTime: 0 });
  const manifestValues = value.manifests ?? [];
  if (!Array.isArray(manifestValues) || manifestValues.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A commit manifest batch is invalid.");
  const manifests = await Promise.all(manifestValues.map(async (candidate): Promise<StoredManifest> => {
    if (!isRecord(candidate)) throw new Error("A commit manifest has an unsupported shape.");
    assertExactKeys(candidate, ["hash", "manifest"], "A commit manifest has an unsupported shape.");
    const record = { hash: parseSha256(candidate.hash, "A commit manifest hash is invalid."), manifest: parseManifest(candidate.manifest) };
    if (await canonicalManifestSha256(record.manifest) !== record.hash) throw new Error("A manifest hash does not match its canonical bytes.");
    return record;
  }));
  if (new Set(manifests.map(({ hash }) => hash)).size !== manifests.length) throw new Error("A commit manifest batch contains duplicate hashes.");
  const referencedHashes = new Set(manifestHashes(operation));
  if (manifests.some(({ hash }) => !referencedHashes.has(hash))) throw new Error("A commit includes an unreferenced manifest.");
  if (operation.kind !== "create" && operation.kind !== "write" && manifests.length > 0) throw new Error("Metadata operations cannot include manifests.");
  const intent = parseIntent(value.intent ?? "forward");
  const compensatesOperationId = value.compensatesOperationId === undefined || value.compensatesOperationId === null ? null : parseStableId(value.compensatesOperationId, "A compensated operation ID is invalid.");
  const expectedContentTuple = value.expectedContentTuple === undefined || value.expectedContentTuple === null ? null : parseOperationTuple(value.expectedContentTuple);
  if (intent === "forward" && compensatesOperationId !== null) throw new Error("A forward operation cannot compensate another operation.");
  if (intent !== "forward" && compensatesOperationId === null) throw new Error("A compensating operation must reference an existing operation.");
  if (operation.kind === "write" && expectedContentTuple === null) throw new Error("A write requires an exact expected content tuple.");
  if (operation.kind !== "write" && expectedContentTuple !== null) throw new Error("Metadata operations cannot use a content expectation.");
  const lifecycleCompensation = operation.kind === "trash" && intent === "undo" || operation.kind === "restore" && intent === "redo";
  if (operation.kind !== "write" && intent !== "forward" && !lifecycleCompensation) throw new Error("That metadata operation intent is unsupported.");
  return {
    operation,
    manifests,
    intent,
    compensatesOperationId,
    expectedContentTuple,
  };
}

function replayOperation(operation: LocallyCommittableOperation) {
  return { ...operation, logicalTime: 0 };
}

function manifestHashes(operation: LocallyCommittableOperation) {
  if (operation.kind === "create" || operation.kind === "copy") return [...new Set(operation.nodes.filter((node) => node.kind === "file").map(({ manifestHash }) => manifestHash))];
  return operation.kind === "write" ? [operation.manifestHash] : [];
}

function fileVersionFromOperation(operation: LocallyCommittableOperation, nodeId: string): FileVersion | undefined {
  if (operation.kind === "write") {
    if (operation.nodeId !== nodeId) return undefined;
    return { nodeId, operationId: operation.operationId, logicalTime: operation.logicalTime, mimeType: operation.mimeType, size: operation.size, manifestHash: operation.manifestHash, modifiedAt: operation.modifiedAt, current: false };
  }
  if (operation.kind !== "create" && operation.kind !== "copy") return undefined;
  const node = operation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.kind !== "file") return undefined;
  return { nodeId, operationId: operation.operationId, logicalTime: operation.logicalTime, mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash, modifiedAt: node.modifiedAt, current: false };
}

type LifecycleUndoExpectation = { rootNodeIds: string[]; nodeIds: string[] };

async function lifecycleUndoExpectation(target: StoredOperation, readOperation: (operationId: string) => Promise<StoredOperation | undefined>, seen = new Set<string>()): Promise<LifecycleUndoExpectation | undefined> {
  if (seen.has(target.operationId)) return undefined;
  seen.add(target.operationId);
  if ((target.operation.kind === "create" || target.operation.kind === "copy") && target.intent === "forward" && (target.inverse.kind === "create" || target.inverse.kind === "copy")) {
    return { rootNodeIds: target.inverse.rootNodeIds, nodeIds: target.operation.nodes.map(({ id }) => id).sort() };
  }
  if (target.operation.kind !== "restore" || target.intent !== "redo" || target.inverse.kind !== "restore" || target.operation.destination !== "original") return undefined;
  const undo = await readOperation(target.compensatesOperationId!);
  if (!undo || undo.workspaceId !== target.workspaceId || undo.operation.kind !== "trash" || undo.intent !== "undo" || undo.inverse.kind !== "trash") return undefined;
  const previous = await readOperation(undo.compensatesOperationId!);
  if (!previous || previous.workspaceId !== target.workspaceId) return undefined;
  const expectation = await lifecycleUndoExpectation(previous, readOperation, seen);
  if (!expectation || !equalValues(undo.operation.nodeIds, expectation.rootNodeIds) || !equalValues(undo.inverse.nodeIds, expectation.nodeIds) || !equalValues(target.operation.nodeIds, undo.inverse.roots.map(({ nodeId }) => nodeId)) || !equalValues(target.inverse.nodes.map(({ nodeId }) => nodeId), undo.inverse.nodeIds)) return undefined;
  return { rootNodeIds: target.operation.nodeIds, nodeIds: target.inverse.nodes.map(({ nodeId }) => nodeId).sort() };
}

export async function openFilesystemDatabase(accountId: string, environment: FilesystemDatabaseEnvironment = {}): Promise<FilesystemDatabase> {
  const factory = environment.indexedDB ?? globalThis.indexedDB;
  const keyRange = environment.IDBKeyRange ?? globalThis.IDBKeyRange;
  if (!factory || !keyRange) throw new Error("IndexedDB filesystem storage is unavailable.");
  const db = await openDatabase(factory, await filesystemDatabaseName(accountId));
  const now = environment.now ?? Date.now;
  const readStoredManifests = async (hashes: readonly string[]) => {
    const values = await transact(db, "manifests", "readonly", (transaction) => Promise.all(hashes.map((hash) => request(transaction.objectStore("manifests").get(hash)))));
    const records = new Map<string, StoredManifest>();
    for (let index = 0; index < hashes.length; index += 1) {
      const value = values[index];
      if (value !== undefined) records.set(hashes[index]!, await validateStoredManifest(value, hashes[index]));
    }
    return records;
  };
  const assertChildNamesAvailableInTransaction = async (transaction: IDBTransaction, workspaceId: string, parentId: string | null, names: readonly string[], excludedIds = new Set<string>()) => {
    const folded = names.map((name) => parseCanonicalName(name).toLowerCase());
    if (new Set(folded).size !== folded.length) throw new Error("An active sibling already uses that name.");
    const wanted = new Set(folded);
    await new Promise<void>((resolve, reject) => {
      const cursor = transaction.objectStore("nodes").index("by-workspace-parent-lifecycle").openCursor(keyRange.only([workspaceId, parentId ?? "", "active"]));
      cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem sibling names could not be read."));
      cursor.onsuccess = () => {
        try {
          if (!cursor.result) { resolve(); return; }
          const sibling = parseStoredNode(cursor.result.value);
          if (!excludedIds.has(sibling.id) && wanted.has(sibling.name.toLowerCase())) { reject(new Error("An active sibling already uses that name.")); return; }
          cursor.result.continue();
        } catch (error) {
          reject(error);
        }
      };
    });
  };
  const assertNodeIdsAvailableInTransaction = async (transaction: IDBTransaction, values: readonly string[]) => {
    const ids = values.map((id) => parseStableId(id, "A created node ID is invalid."));
    if (ids.length === 0 || ids.length > WEB2_MAX_BATCH_ITEMS || new Set(ids).size !== ids.length) throw new Error("Created node IDs must be unique and bounded.");
    const nodes = transaction.objectStore("nodes");
    for (const id of ids) if (await request(nodes.get(id)) !== undefined) throw new Error("A node ID already exists.");
    const pending = new Set(ids);
    // ponytail: retained-ID lookup is O(operation history); add a dedicated reservation index when history size makes this measurable.
    await new Promise<void>((resolve, reject) => {
      const cursor = transaction.objectStore("operations").openCursor();
      cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem operation history could not be read."));
      cursor.onsuccess = () => {
        try {
          if (!cursor.result) { resolve(); return; }
          const stored = parseStoredOperation(cursor.result.value);
          if ((stored.operation.kind === "create" || stored.operation.kind === "copy") && stored.operation.nodes.some(({ id }) => pending.has(id))) { reject(new Error("A node ID was already used by retained operation history.")); return; }
          cursor.result.continue();
        } catch (error) {
          reject(error);
        }
      };
    });
  };

  return {
    close: () => db.close(),

    createWorkspace: async (value) => {
      if (!isRecord(value)) throw new Error("A workspace creation request has an unsupported shape.");
      assertExactKeys(value, ["id", "name", "pinned", "deviceId"], "A workspace creation request has an unsupported shape.");
      if (typeof value.pinned !== "boolean") throw new Error("Workspace pinning metadata is invalid.");
      const id = parseStableId(value.id, "A workspace ID is invalid.");
      const deviceId = parseStableId(value.deviceId, "A workspace device ID is invalid.");
      const name = parseCanonicalName(value.name, "A workspace name is invalid.");
      const sync = parseSyncState({ workspaceId: id, deviceId, cursor: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 });
      return transact(db, ["workspaces", "sync"], "readwrite", async (transaction) => {
        const workspaces = transaction.objectStore("workspaces");
        const existingWorkspace = await request(workspaces.get(id));
        const existingSync = await request(transaction.objectStore("sync").get(id));
        if (existingWorkspace !== undefined) { parseWorkspace(existingWorkspace); throw new Error("That workspace already exists."); }
        if (existingSync !== undefined) { parseSyncState(existingSync); throw new Error("Stored synchronization state exists without its workspace."); }
        const current = parseWorkspaceList(await request(workspaces.getAll()));
        if (current.length === MAX_WORKSPACES) throw new Error("The workspace directory is full.");
        if (current.some((workspace) => workspace.name.toLowerCase() === name.toLowerCase())) throw new Error("A workspace already uses that name.");
        const insertion = value.pinned ? current.findIndex(({ pinned }) => !pinned) : current.length;
        const ordered = [...current];
        const workspace = parseWorkspace({ id, name, pinned: value.pinned, ordinal: insertion < 0 ? current.length : insertion, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 });
        ordered.splice(workspace.ordinal, 0, workspace);
        const updated = ordered.map((candidate, ordinal) => parseWorkspace({ ...candidate, ordinal }));
        await Promise.all([
          ...updated.map((candidate) => request(candidate.id === id ? workspaces.add(candidate) : workspaces.put(candidate))),
          request(transaction.objectStore("sync").add(sync)),
        ]);
        return updated[workspace.ordinal]!;
      });
    },

    listWorkspaces: () => transact(db, "workspaces", "readonly", async (transaction) => {
      const values = await request(transaction.objectStore("workspaces").getAll());
      return parseWorkspaceList(values);
    }),

    renameWorkspace: async (workspaceId, name) => {
      const id = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalName = parseCanonicalName(name, "A workspace name is invalid.");
      return transact(db, "workspaces", "readwrite", async (transaction) => {
        const store = transaction.objectStore("workspaces");
        const workspaces = parseWorkspaceList(await request(store.getAll()));
        const workspace = workspaces.find((candidate) => candidate.id === id);
        if (!workspace) throw new Error("That workspace does not exist.");
        if (workspaces.some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === canonicalName.toLowerCase())) throw new Error("A workspace already uses that name.");
        const renamed = parseWorkspace({ ...workspace, name: canonicalName });
        await request(store.put(renamed));
        return renamed;
      });
    },

    setWorkspacePreferences: async (preferences) => {
      if (!Array.isArray(preferences) || preferences.length === 0 || preferences.length > MAX_WORKSPACES) throw new Error("Workspace preferences are invalid.");
      const parsed = preferences.map((preference) => {
        if (!isRecord(preference)) throw new Error("Workspace preferences are invalid.");
        assertExactKeys(preference, ["id", "pinned"], "Workspace preferences are invalid.");
        if (typeof preference.pinned !== "boolean") throw new Error("Workspace preferences are invalid.");
        return { id: parseStableId(preference.id, "A workspace preference ID is invalid."), pinned: preference.pinned };
      });
      if (new Set(parsed.map(({ id }) => id)).size !== parsed.length || parsed.some(({ pinned }, index) => index > 0 && pinned && !parsed[index - 1]!.pinned)) throw new Error("Workspace preferences are invalid.");
      return transact(db, "workspaces", "readwrite", async (transaction) => {
        const store = transaction.objectStore("workspaces");
        const current = parseWorkspaceList(await request(store.getAll()));
        const byId = new Map(current.map((workspace) => [workspace.id, workspace]));
        if (parsed.length !== current.length || parsed.some(({ id }) => !byId.has(id))) throw new Error("Workspace preferences must include the complete directory.");
        const updated = parsed.map(({ id, pinned }, ordinal) => parseWorkspace({ ...byId.get(id)!, pinned, ordinal }));
        await Promise.all(updated.map((workspace) => request(store.put(workspace))));
        return updated;
      });
    },

    deleteWorkspace: async (workspaceId) => {
      const id = parseStableId(workspaceId, "A workspace ID is invalid.");
      const storeNames = ["workspaces", "nodes", "sync", "settings", "changes", "hydration-pages"];
      return transact(db, storeNames, "readwrite", async (transaction) => {
        const workspacesStore = transaction.objectStore("workspaces");
        const current = parseWorkspaceList(await request(workspacesStore.getAll()));
        if (!current.some((workspace) => workspace.id === id)) throw new Error("That workspace does not exist.");
        if (current.length === 1) throw new Error("The final workspace cannot be deleted.");
        const nodes = transaction.objectStore("nodes");
        const settings = transaction.objectStore("settings");
        const changes = transaction.objectStore("changes");
        const hydrationPages = transaction.objectStore("hydration-pages");
        // ponytail: deletion scans the account to remove malformed index rows; add workspace indexes if measured catalogs make this slow.
        const [nodeValues, nodeKeys, settingKeys, changeKeys, hydrationKeys] = await Promise.all([
          request(nodes.getAll()),
          request(nodes.getAllKeys()),
          request(settings.getAllKeys()),
          request(changes.getAllKeys()),
          request(hydrationPages.getAllKeys()),
        ]);
        const nodeIds = nodeKeys.filter((_, index) => isRecord(nodeValues[index]) && nodeValues[index].workspaceId === id);
        const belongsToWorkspace = (key: IDBValidKey) => Array.isArray(key) && key[0] === id;
        const remaining = current.filter((workspace) => workspace.id !== id).map((workspace, ordinal) => parseWorkspace({ ...workspace, ordinal }));
        await Promise.all([
          ...nodeIds.map((nodeId) => request(nodes.delete(nodeId))),
          ...settingKeys.filter(belongsToWorkspace).map((key) => request(settings.delete(key))),
          ...changeKeys.filter(belongsToWorkspace).map((key) => request(changes.delete(key))),
          ...hydrationKeys.filter(belongsToWorkspace).map((key) => request(hydrationPages.delete(key))),
          ...remaining.map((workspace) => request(workspacesStore.put(workspace))),
          request(workspacesStore.delete(id)),
          request(transaction.objectStore("sync").delete(id)),
        ]);
        return remaining;
      });
    },

    getNode: async (id) => {
      const canonicalId = parseStableId(id, "A node ID is invalid.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("nodes").get(canonicalId));
        return value === undefined ? undefined : nodeRecord(parseStoredNode(value));
      });
    },

    listChildren: async (workspaceId, parentId, limit) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalParentId = parentId === null ? null : parseStableId(parentId, "A parent node ID is invalid.");
      const boundedLimit = limit === undefined ? undefined : parsePositiveSafeInteger(limit, "A child list limit is invalid.");
      if (boundedLimit !== undefined && boundedLimit > WEB2_MAX_BATCH_ITEMS + 1) throw new Error("A child list limit is too large.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const index = transaction.objectStore("nodes").index("by-workspace-parent-lifecycle");
        const range = keyRange.only([canonicalWorkspaceId, canonicalParentId ?? "", "active"]);
        const values = await request(boundedLimit === undefined ? index.getAll(range) : index.getAll(range, boundedLimit));
        return values.map((value) => nodeRecord(parseStoredNode(value)));
      });
    },

    assertChildNamesAvailable: async (workspaceId, parentId, names) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalParentId = parentId === null ? null : parseStableId(parentId, "A parent node ID is invalid.");
      if (!Array.isArray(names) || names.length === 0 || names.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A sibling name batch is invalid.");
      return transact(db, "nodes", "readonly", (transaction) => assertChildNamesAvailableInTransaction(transaction, canonicalWorkspaceId, canonicalParentId, names));
    },

    assertNodeIdsAvailable: async (ids) => {
      if (!Array.isArray(ids)) throw new Error("Created node IDs are invalid.");
      return transact(db, ["nodes", "operations"], "readonly", (transaction) => assertNodeIdsAvailableInTransaction(transaction, ids));
    },

    listTrash: async (workspaceId) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const values = await request(transaction.objectStore("nodes").index("by-workspace-lifecycle").getAll(keyRange.only([canonicalWorkspaceId, "trashed"])));
        return values.map(parseStoredNode).filter(({ parentId }) => parentId === null).sort((left, right) => {
          if (left.lifecycle.kind !== "trashed" || right.lifecycle.kind !== "trashed") throw new Error("Stored Trash index metadata is inconsistent.");
          return right.lifecycle.trashedAt - left.lifecycle.trashedAt || right.fieldTuples.lifecycle.logicalTime - left.fieldTuples.lifecycle.logicalTime || left.id.localeCompare(right.id);
        }).map(nodeRecord);
      });
    },

    getSetting: async (workspaceId, namespace, key) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const { namespace: canonicalNamespace, key: canonicalKey } = parseSettingKeyForNamespace(namespace, key);
      return transact(db, "settings", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("settings").get([canonicalWorkspaceId, canonicalNamespace, canonicalKey]));
        return value === undefined ? undefined : parseSetting(value);
      });
    },

    listSettings: async (workspaceId, namespace) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalNamespace = parseSettingNamespace(namespace);
      return transact(db, "settings", "readonly", async (transaction) => {
        const values = await request(transaction.objectStore("settings").getAll(keyRange.bound([canonicalWorkspaceId, canonicalNamespace, ""], [canonicalWorkspaceId, canonicalNamespace, "\uffff"])));
        return values.map(parseSetting);
      });
    },

    getSyncState: async (workspaceId) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      return transact(db, ["workspaces", "sync"], "readonly", async (transaction) => {
        const [workspaceValue, syncValue] = await Promise.all([
          request(transaction.objectStore("workspaces").get(canonicalWorkspaceId)),
          request(transaction.objectStore("sync").get(canonicalWorkspaceId)),
        ]);
        if (workspaceValue === undefined || syncValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        const sync = parseSyncState(syncValue);
        if (workspace.id !== sync.workspaceId) throw new Error("Stored synchronization state does not match its workspace.");
        return sync;
      });
    },

    getManifest: async (hash) => {
      const canonicalHash = parseSha256(hash, "A manifest hash is invalid.");
      return (await readStoredManifests([canonicalHash])).get(canonicalHash)?.manifest;
    },

    getOperation: async (operationId) => {
      const canonicalOperationId = parseStableId(operationId, "An operation ID is invalid.");
      return transact(db, "operations", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("operations").get(canonicalOperationId));
        return value === undefined ? undefined : parseStoredOperation(value);
      });
    },

    commitOperation: async (value) => {
      const normalized = await normalizeCommitInput(value);
      const replayedValue = await transact(db, "operations", "readonly", (transaction) => request(transaction.objectStore("operations").get(normalized.operation.operationId)));
      if (replayedValue !== undefined) {
        const replayed = parseStoredOperation(replayedValue);
        if (!equalValues(replayOperation(replayed.operation), normalized.operation) || replayed.intent !== normalized.intent || replayed.compensatesOperationId !== normalized.compensatesOperationId || !equalValues(replayed.expectedContentTuple, normalized.expectedContentTuple)) throw new Error("An operation ID cannot be reused with different input.");
        return replayed;
      }
      const suppliedManifests = new Map(normalized.manifests.map((record) => [record.hash, record]));
      const hashes = [...new Set([...suppliedManifests.keys(), ...manifestHashes(normalized.operation)])];
      const validatedStoredManifests = await readStoredManifests(hashes);
      return transact(db, ["workspaces", "nodes", "manifests", "operations", "changes", "sync", "settings"], "readwrite", async (transaction) => {
        const operations = transaction.objectStore("operations");
        const existingValue = await request(operations.get(normalized.operation.operationId));
        if (existingValue !== undefined) {
          const existing = parseStoredOperation(existingValue);
          if (!equalValues(replayOperation(existing.operation), normalized.operation) || existing.intent !== normalized.intent || existing.compensatesOperationId !== normalized.compensatesOperationId || !equalValues(existing.expectedContentTuple, normalized.expectedContentTuple)) throw new Error("An operation ID cannot be reused with different input.");
          return existing;
        }

        const workspaceValue = await request(transaction.objectStore("workspaces").get(normalized.operation.workspaceId));
        const syncValue = await request(transaction.objectStore("sync").get(normalized.operation.workspaceId));
        if (workspaceValue === undefined || syncValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        const sync = parseSyncState(syncValue);
        if (sync.workspaceId !== workspace.id || sync.deviceId !== normalized.operation.deviceId) throw new Error("The operation device does not own this local workspace state.");
        let destinationWorkspace: Workspace | undefined;
        let destinationSync: SyncState | undefined;
        if (normalized.operation.kind === "transfer") {
          const [destinationWorkspaceValue, destinationSyncValue] = await Promise.all([
            request(transaction.objectStore("workspaces").get(normalized.operation.destinationWorkspaceId)),
            request(transaction.objectStore("sync").get(normalized.operation.destinationWorkspaceId)),
          ]);
          if (destinationWorkspaceValue === undefined || destinationSyncValue === undefined) throw new Error("The transfer destination workspace does not exist.");
          destinationWorkspace = parseWorkspace(destinationWorkspaceValue);
          destinationSync = parseSyncState(destinationSyncValue);
          if (destinationSync.workspaceId !== destinationWorkspace.id || destinationSync.deviceId !== normalized.operation.deviceId) throw new Error("The operation device does not own the transfer destination workspace state.");
        }

        let compensated: StoredOperation | undefined;
        let expectedLifecycleNodeIds: string[] | undefined;
        let expectedLifecycleTuple: OperationTuple | undefined;
        const readOperation = async (operationId: string) => {
          const value = await request(operations.get(operationId));
          return value === undefined ? undefined : parseStoredOperation(value);
        };
        if (normalized.compensatesOperationId !== null) {
          compensated = await readOperation(normalized.compensatesOperationId);
          if (!compensated) throw new Error("A compensating operation must reference an existing operation.");
          if (compensated.workspaceId !== workspace.id) throw new Error("A compensating operation must reference the same workspace.");
          if (normalized.operation.kind === "write") {
            const compensatingWrite = normalized.operation;
            const matchesContent = (version: Pick<FileVersion, "nodeId" | "mimeType" | "size" | "manifestHash">) => equalValues({
              nodeId: compensatingWrite.nodeId,
              mimeType: compensatingWrite.mimeType,
              size: compensatingWrite.size,
              manifestHash: compensatingWrite.manifestHash,
            }, { nodeId: version.nodeId, mimeType: version.mimeType, size: version.size, manifestHash: version.manifestHash });
            if (normalized.intent === "undo" && (compensated.operation.kind !== "write" || compensated.intent !== "forward" && compensated.intent !== "redo" && compensated.intent !== "restore" || compensated.operation.nodeId !== normalized.operation.nodeId || compensated.inverse.kind !== "write" || !matchesContent(compensated.inverse))) throw new Error("An undo must apply a write inverse for that file.");
            if (normalized.intent === "redo" && (compensated.intent !== "undo" || compensated.operation.kind !== "write" || compensated.operation.nodeId !== normalized.operation.nodeId || compensated.inverse.kind !== "write" || !matchesContent(compensated.inverse))) throw new Error("A redo must apply an undo inverse for that file.");
            const restoredVersion = normalized.intent === "restore" ? fileVersionFromOperation(compensated.operation, normalized.operation.nodeId) : undefined;
            if (normalized.intent === "restore" && (!restoredVersion || !matchesContent(restoredVersion))) throw new Error("A restore must apply the referenced version of that file.");
          } else if (normalized.operation.kind === "trash" && normalized.intent === "undo") {
            const expectation = await lifecycleUndoExpectation(compensated, readOperation);
            if (!expectation || !equalValues(normalized.operation.nodeIds, expectation.rootNodeIds)) throw new Error("An undo must move the exact created forest to Trash.");
            expectedLifecycleNodeIds = expectation.nodeIds;
            expectedLifecycleTuple = { logicalTime: compensated.operation.logicalTime, operationId: compensated.operationId };
          } else if (normalized.operation.kind === "restore" && normalized.intent === "redo") {
            if (compensated.operation.kind !== "trash" || compensated.intent !== "undo" || compensated.inverse.kind !== "trash") throw new Error("A redo must restore the exact forest from its undo.");
            const target = await readOperation(compensated.compensatesOperationId!);
            const expectation = target && target.workspaceId === workspace.id ? await lifecycleUndoExpectation(target, readOperation) : undefined;
            if (!expectation || !equalValues(compensated.operation.nodeIds, expectation.rootNodeIds) || !equalValues(compensated.inverse.nodeIds, expectation.nodeIds) || normalized.operation.destination !== "original" || !equalValues(normalized.operation.nodeIds, compensated.inverse.roots.map(({ nodeId }) => nodeId))) throw new Error("A redo must restore the exact forest from its undo.");
            expectedLifecycleNodeIds = compensated.inverse.nodeIds;
            expectedLifecycleTuple = { logicalTime: compensated.operation.logicalTime, operationId: compensated.operationId };
          } else {
            throw new Error("That operation cannot compensate filesystem history.");
          }
        }

        const storedManifests = new Map<string, StoredManifest>();
        await Promise.all(hashes.map(async (hash) => {
          const storedValue = await request(transaction.objectStore("manifests").get(hash));
          const validated = validatedStoredManifests.get(hash);
          if (storedValue === undefined) {
            if (validated) throw new Error("A stored manifest changed during the filesystem commit.");
            return;
          }
          const stored = parseStoredManifest(storedValue);
          if (!validated || !equalValues(stored, validated)) throw new Error("A stored manifest changed during the filesystem commit.");
          const supplied = suppliedManifests.get(hash);
          if (supplied && !equalValues(stored.manifest, supplied.manifest)) throw new Error("A manifest hash is already stored with different content.");
          storedManifests.set(hash, stored);
        }));
        const resolvedManifest = (hash: string) => suppliedManifests.get(hash) ?? storedManifests.get(hash);
        for (const hash of manifestHashes(normalized.operation)) if (!resolvedManifest(hash)) throw new Error("An operation references a missing manifest.");

        const wallTime = parseNonNegativeSafeInteger(now(), "The current time is invalid.");
        const logicalTime = Math.max(wallTime, ...[sync, ...(destinationSync ? [destinationSync] : [])].flatMap((state) => [
          nextSafeInteger(state.lastObservedLogicalTime, "The observed logical clock is exhausted."),
          nextSafeInteger(state.lastLocalLogicalTime, "The local logical clock is exhausted."),
        ]));
        const parsedOperation = parseWorkspaceOperation({ ...normalized.operation, logicalTime });
        const operation = parsedOperation;
        const tuple = { logicalTime, operationId: operation.operationId };
        const nodes = transaction.objectStore("nodes");
        const settingsStore = transaction.objectStore("settings");
        const nodeCache = new Map<string, StoredNode | undefined>();
        const readNode = async (id: string) => {
          if (nodeCache.has(id)) return nodeCache.get(id);
          const value = await request(nodes.get(id));
          const node = value === undefined ? undefined : parseStoredNode(value);
          nodeCache.set(id, node);
          return node;
        };
        const childrenInLifecycle = async (parent: StoredNode, lifecycle: "active" | "trashed", limit?: number) => {
          const index = nodes.index("by-workspace-parent-lifecycle");
          const range = keyRange.only([parent.workspaceId, parent.id, lifecycle]);
          const values = await request(limit === undefined ? index.getAll(range) : index.getAll(range, limit));
          return values.map(parseStoredNode).sort((left, right) => left.id.localeCompare(right.id));
        };
        const ancestors = async (node: StoredNode) => {
          const result: StoredNode[] = [];
          const seen = new Set([node.id]);
          let parentId = node.parentId;
          while (parentId !== null) {
            const parent = await readNode(parentId);
            if (!parent || parent.workspaceId !== node.workspaceId || parent.kind !== "folder" || parent.lifecycle.kind !== node.lifecycle.kind || seen.has(parent.id)) throw new Error("The stored node hierarchy is invalid.");
            result.push(parent);
            seen.add(parent.id);
            if (result.length > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("The node hierarchy is too deep.");
            parentId = parent.parentId;
          }
          return result;
        };
        const expandSubtrees = async (roots: StoredNode[], lifecycle: "active" | "trashed", message: string, maxItems: number | null = WEB2_MAX_BATCH_ITEMS) => {
          const seen = new Set<string>();
          const result: Array<{ root: StoredNode; nodes: Array<{ node: StoredNode; depth: number }> }> = [];
          for (const root of roots) {
            const expanded: Array<{ node: StoredNode; depth: number }> = [];
            const pending: Array<{ node: StoredNode; depth: number }> = [];
            const enqueue = (node: StoredNode, depth: number) => {
              if (seen.has(node.id)) throw new Error("Selected filesystem roots overlap.");
              if (maxItems !== null && seen.size === maxItems) throw new Error(message);
              seen.add(node.id);
              pending.push({ node, depth });
            };
            enqueue(root, 0);
            for (let index = 0; index < pending.length; index += 1) {
              const current = pending[index]!;
              expanded.push(current);
              const remaining = maxItems === null ? undefined : maxItems - seen.size;
              const children = await childrenInLifecycle(current.node, lifecycle, remaining === undefined ? undefined : remaining + 1);
              if (remaining !== undefined && children.length > remaining) throw new Error(message);
              for (const child of children) enqueue(child, current.depth + 1);
            }
            result.push({ root, nodes: expanded });
          }
          return result;
        };
        const validateDestinationNames = async (items: Array<{ node: { id: string; name: string }; parentId: string | null }>, excludedIds: Set<string>, destinationWorkspaceId = workspace.id) => {
          const byParent = new Map<string | null, string[]>();
          for (const { node, parentId } of items) byParent.set(parentId, [...(byParent.get(parentId) ?? []), node.name]);
          for (const [parentId, names] of byParent) await assertChildNamesAvailableInTransaction(transaction, destinationWorkspaceId, parentId, names, excludedIds);
        };
        const previousSetting = (setting: Setting | undefined): PreviousSetting => setting === undefined ? { exists: false } : { exists: true, value: setting.value };
        const readSetting = async (namespace: SettingNamespace, key: string) => {
          const value = await request(settingsStore.get([workspace.id, namespace, key]));
          if (value === undefined) return undefined;
          const setting = parseSetting(value);
          if (setting.workspaceId !== workspace.id || setting.namespace !== namespace || setting.key !== key) throw new Error("Stored setting identity metadata is inconsistent.");
          return setting;
        };

        let inverse: OperationInverse;
        const projectedNodes = new Map<string, StoredNode>();
        const addedNodeIds = new Set<string>();
        const deletedNodeIds: string[] = [];
        const projectedSettings: Setting[] = [];
        let copySourceNodes: StoredNode[] = [];
        switch (operation.kind) {
          case "create":
          case "copy": {
            if (operation.kind === "copy") {
              const sourceRoots = await Promise.all(operation.sourceNodeIds.map(async (id) => {
                const node = await readNode(id);
                if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A copy requires active source roots in their workspace.");
                return node;
              }));
              const expanded = await expandSubtrees(sourceRoots, "active", "A copied forest is too large.");
              copySourceNodes = expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node));
              if (copySourceNodes.length !== operation.nodes.length) throw new Error("A copy must contain a complete source forest snapshot.");
              const destinationIds = new Set(operation.nodes.map(({ id }) => id));
              const destinationRoots = operation.nodes.filter(({ parentId }) => parentId === null || !destinationIds.has(parentId));
              if (destinationRoots.length !== sourceRoots.length) throw new Error("A copy must map each source root to one destination root.");
              const timestamp = operation.nodes[0]!.createdAt;
              if (operation.nodes.some((node) => node.createdAt !== timestamp || node.modifiedAt !== timestamp)) throw new Error("Copied nodes require one creation and modification timestamp.");

              const sourceChildren = new Map<string, StoredNode[]>();
              const sourceRootIds = new Set(sourceRoots.map(({ id }) => id));
              for (const source of copySourceNodes) if (!sourceRootIds.has(source.id)) {
                const children = sourceChildren.get(source.parentId!) ?? [];
                children.push(source);
                sourceChildren.set(source.parentId!, children);
              }
              const destinationChildren = new Map<string, typeof operation.nodes>();
              for (const destination of operation.nodes) if (destinationIds.has(destination.parentId ?? "")) {
                const children = destinationChildren.get(destination.parentId!) ?? [];
                children.push(destination);
                destinationChildren.set(destination.parentId!, children);
              }
              const matchedDestinations = new Set<string>();
              const validateSnapshot = (source: StoredNode, destination: typeof operation.nodes[number], root: boolean) => {
                if (source.kind !== destination.kind) throw new Error("A copied node kind does not match its source snapshot.");
                if (!root && (source.name !== destination.name || !equalValues(source.position, destination.position))) throw new Error("A copied descendant does not match its source snapshot.");
                if (source.kind === "file" && destination.kind === "file" && (source.mimeType !== destination.mimeType || source.size !== destination.size || source.manifestHash !== destination.manifestHash)) throw new Error("Copied file metadata does not match its source snapshot.");
                matchedDestinations.add(destination.id);
                const sourceValues = sourceChildren.get(source.id) ?? [];
                const destinationValues = destinationChildren.get(destination.id) ?? [];
                if (sourceValues.length !== destinationValues.length) throw new Error("A copy must contain a complete source forest snapshot.");
                for (const sourceChild of sourceValues) {
                  const destinationChild = destinationValues.find(({ name }) => name === sourceChild.name);
                  if (!destinationChild) throw new Error("A copied descendant does not match its source snapshot.");
                  validateSnapshot(sourceChild, destinationChild, false);
                }
              };
              for (let index = 0; index < sourceRoots.length; index += 1) validateSnapshot(sourceRoots[index]!, destinationRoots[index]!, true);
              if (matchedDestinations.size !== operation.nodes.length) throw new Error("A copy contains invented destination nodes.");
            }
            const createdIds = new Set(operation.nodes.map(({ id }) => id));
            await assertNodeIdsAvailableInTransaction(transaction, [...createdIds]);

            const externalParentIds = [...new Set(operation.nodes.map(({ parentId }) => parentId).filter((parentId): parentId is string => parentId !== null && !createdIds.has(parentId)))];
            await Promise.all(externalParentIds.map(async (id) => {
              const parent = await readNode(id);
              if (!parent) throw new Error("A created node parent does not exist.");
              if (parent.workspaceId !== workspace.id || parent.kind !== "folder" || parent.lifecycle.kind !== "active") throw new Error("A created node parent must be an active folder in its workspace.");
            }));
            await validateDestinationNames(operation.nodes.filter(({ parentId }) => parentId === null || !createdIds.has(parentId)).map((node) => ({ node, parentId: node.parentId })), new Set());
            const createdById = new Map(operation.nodes.map((node) => [node.id, node]));
            const createdDepths = new Map<string, number>();
            const createdDepth = async (id: string): Promise<number> => {
              const cached = createdDepths.get(id);
              if (cached !== undefined) return cached;
              const node = createdById.get(id)!;
              let depth = 0;
              if (node.parentId !== null) {
                if (createdById.has(node.parentId)) depth = await createdDepth(node.parentId) + 1;
                else {
                  const parent = await readNode(node.parentId);
                  if (!parent) throw new Error("A created node parent does not exist.");
                  depth = (await ancestors(parent)).length + 1;
                }
              }
              if (depth > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("The created hierarchy is too deep.");
              createdDepths.set(id, depth);
              return depth;
            };
            await Promise.all(operation.nodes.map(({ id }) => createdDepth(id)));
            for (const node of operation.nodes) {
              if (node.kind === "file" && resolvedManifest(node.manifestHash)!.manifest.size !== node.size) throw new Error("A created file size does not match its manifest.");
              const projected = storeNode(parseNode({ ...node, workspaceId: operation.workspaceId, lifecycle: { kind: "active" }, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: node.kind === "file" ? tuple : null } }));
              projectedNodes.set(node.id, projected);
              addedNodeIds.add(node.id);
            }
            inverse = operation.kind === "copy"
              ? { kind: "copy", rootNodeIds: createdRootIds(operation), sourceNodeIds: copySourceNodes.map(({ id }) => id).sort(), sourceFileNodeIds: copySourceNodes.filter(({ kind }) => kind === "file").map(({ id }) => id).sort() }
              : { kind: "create", rootNodeIds: createdRootIds(operation) };
            break;
          }
          case "write": {
            const node = await readNode(operation.nodeId);
            if (!node) throw new Error("The written file does not exist.");
            if (node.workspaceId !== workspace.id || node.kind !== "file" || node.lifecycle.kind !== "active") throw new Error("A write requires an active file in its workspace.");
            if (!equalValues(node.fieldTuples.content, normalized.expectedContentTuple)) throw new Error("The file content changed before this write could commit.");
            if (compensated && (normalized.intent === "undo" || normalized.intent === "redo")) {
              const compensatedVersion = fileVersionFromOperation(compensated.operation, node.id);
              if (!compensatedVersion || !equalValues({ mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash }, { mimeType: compensatedVersion.mimeType, size: compensatedVersion.size, manifestHash: compensatedVersion.manifestHash })) throw new Error("The compensated operation is not the current file version.");
            }
            if (resolvedManifest(operation.manifestHash)!.manifest.size !== operation.size) throw new Error("A written file size does not match its manifest.");
            inverse = { kind: "write", nodeId: node.id, mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash, modifiedAt: node.modifiedAt };
            projectedNodes.set(node.id, storeNode({ ...node, mimeType: operation.mimeType, size: operation.size, manifestHash: operation.manifestHash, modifiedAt: operation.modifiedAt, fieldTuples: { ...node.fieldTuples, content: tuple } }));
            break;
          }
          case "rename": {
            const node = await readNode(operation.nodeId);
            if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A rename requires an active node in its workspace.");
            await validateDestinationNames([{ node: { id: node.id, name: operation.name }, parentId: node.parentId }], new Set([node.id]));
            inverse = { kind: "rename", nodeId: node.id, name: node.name, modifiedAt: node.modifiedAt };
            projectedNodes.set(node.id, storeNode({ ...node, name: operation.name, modifiedAt: operation.modifiedAt, fieldTuples: { ...node.fieldTuples, name: tuple } }));
            break;
          }
          case "move": {
            const roots = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A move requires active nodes in their workspace.");
              return node;
            }));
            const selected = new Set(operation.nodeIds);
            for (const root of roots) if ((await ancestors(root)).some(({ id }) => selected.has(id))) throw new Error("Moved roots cannot overlap.");
            let destination: StoredNode | undefined;
            if (operation.parentId !== null) {
              destination = await readNode(operation.parentId);
              if (!destination) throw new Error("The move destination does not exist.");
              if (destination.workspaceId !== workspace.id || destination.kind !== "folder" || destination.lifecycle.kind !== "active") throw new Error("The move destination must be an active folder in this workspace.");
              if (selected.has(destination.id) || (await ancestors(destination)).some(({ id }) => selected.has(id))) throw new Error("A node cannot be moved into itself or its descendant.");
            }
            const expanded = await expandSubtrees(roots, "active", "A moved subtree is too large.", null);
            const destinationDepth = destination ? (await ancestors(destination)).length + 1 : 0;
            if (expanded.some(({ nodes: expandedNodes }) => destinationDepth + Math.max(...expandedNodes.map(({ depth }) => depth)) > WEB2_MAX_ANCESTRY_DEPTH)) throw new Error("The move destination would make the hierarchy too deep.");
            await validateDestinationNames(roots.map((node) => ({ node, parentId: operation.parentId })), selected);
            inverse = { kind: "move", roots: roots.map(({ id, parentId, modifiedAt }) => ({ nodeId: id, parentId, modifiedAt })) };
            for (const root of roots) projectedNodes.set(root.id, storeNode({ ...root, parentId: operation.parentId, modifiedAt: operation.modifiedAt, fieldTuples: { ...root.fieldTuples, parent: tuple } }));
            break;
          }
          case "transfer": {
            if (!destinationWorkspace || !destinationSync) throw new Error("The transfer destination workspace does not exist.");
            const roots = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A transfer requires active source roots in their workspace.");
              return node;
            }));
            const selected = new Set(operation.nodeIds);
            for (const root of roots) if ((await ancestors(root)).some(({ id }) => selected.has(id))) throw new Error("Transferred roots cannot overlap.");
            const expanded = await expandSubtrees(roots, "active", "A transferred forest is too large.");
            const movedNodes = expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node)).sort((left, right) => left.id.localeCompare(right.id));
            let destination: StoredNode | undefined;
            if (operation.parentId !== null) {
              destination = await readNode(operation.parentId);
              if (!destination || destination.workspaceId !== destinationWorkspace.id || destination.kind !== "folder" || destination.lifecycle.kind !== "active") throw new Error("The transfer destination parent must be an active folder in the destination workspace.");
            }
            const destinationDepth = destination ? (await ancestors(destination)).length + 1 : 0;
            if (expanded.some(({ nodes: expandedNodes }) => destinationDepth + Math.max(...expandedNodes.map(({ depth }) => depth)) > WEB2_MAX_ANCESTRY_DEPTH)) throw new Error("The transfer destination would make the hierarchy too deep.");
            await validateDestinationNames(roots.map((node) => ({ node, parentId: operation.parentId })), new Set(), destinationWorkspace.id);
            inverse = {
              kind: "transfer",
              nodes: movedNodes.map(({ id, parentId, modifiedAt }) => ({ nodeId: id, parentId, modifiedAt })),
              fileNodeIds: movedNodes.filter(({ kind }) => kind === "file").map(({ id }) => id),
            };
            for (const node of movedNodes) projectedNodes.set(node.id, storeNode({
              ...node,
              workspaceId: destinationWorkspace.id,
              parentId: selected.has(node.id) ? operation.parentId : node.parentId,
              modifiedAt: operation.modifiedAt,
              fieldTuples: { ...node.fieldTuples, parent: tuple },
            }));
            break;
          }
          case "position": {
            const previous: Array<{ nodeId: string; position: Position }> = [];
            for (const change of operation.positions) {
              const node = await readNode(change.nodeId);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("A position update requires active nodes in their workspace.");
              previous.push({ nodeId: node.id, position: node.position });
              projectedNodes.set(node.id, storeNode({ ...node, position: change.position, fieldTuples: { ...node.fieldTuples, position: tuple } }));
            }
            inverse = { kind: "position", positions: previous };
            break;
          }
          case "trash": {
            const selectedNodes = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "active") throw new Error("Trash requires active nodes in their workspace.");
              return node;
            }));
            const selected = new Set(operation.nodeIds);
            const roots: StoredNode[] = [];
            for (const node of selectedNodes) if (!(await ancestors(node)).some(({ id }) => selected.has(id))) roots.push(node);
            const expanded = await expandSubtrees(roots, "active", "A Trash subtree batch is too large.");
            const expandedNodes = expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node));
            if (expectedLifecycleTuple && expandedNodes.some(({ fieldTuples }) => !equalValues(fieldTuples.lifecycle, expectedLifecycleTuple))) throw new Error("The compensated lifecycle operation is no longer current.");
            const rootIds = new Set(roots.map(({ id }) => id));
            inverse = { kind: "trash", roots: roots.map(({ id, parentId }) => ({ nodeId: id, parentId })), nodeIds: expandedNodes.map(({ id }) => id).sort() };
            for (const node of expandedNodes) projectedNodes.set(node.id, storeNode({ ...node, parentId: rootIds.has(node.id) ? null : node.parentId, lifecycle: { kind: "trashed", trashedAt: operation.trashedAt, originalParentId: node.parentId }, fieldTuples: { ...node.fieldTuples, parent: rootIds.has(node.id) ? tuple : node.fieldTuples.parent, lifecycle: tuple } }));
            break;
          }
          case "restore": {
            const roots = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "trashed" || node.parentId !== null) throw new Error("Restore requires actual trashed roots in their workspace.");
              return node;
            }));
            const expanded = await expandSubtrees(roots, "trashed", "A restore subtree batch is too large.");
            const expandedNodes = expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node)).sort((left, right) => left.id.localeCompare(right.id));
            if (expectedLifecycleTuple && expandedNodes.some(({ fieldTuples }) => !equalValues(fieldTuples.lifecycle, expectedLifecycleTuple))) throw new Error("The compensated lifecycle operation is no longer current.");
            const restoringById = new Map(expandedNodes.map((node) => [node.id, node]));
            const destinations = new Map<string, string | null>();
            for (const root of roots) {
              if (root.lifecycle.kind !== "trashed") throw new Error("Restore requires trashed roots.");
              const parentId = operation.destination === "original" ? root.lifecycle.originalParentId : null;
              if (parentId !== null) {
                const parent = restoringById.get(parentId) ?? await readNode(parentId);
                if (!parent) throw new Error("The original parent no longer exists.");
                if (parent.workspaceId !== workspace.id || parent.kind !== "folder" || !restoringById.has(parentId) && parent.lifecycle.kind !== "active") throw new Error("The original parent is not an active folder.");
              }
              destinations.set(root.id, parentId);
            }
            const rootIds = new Set(roots.map(({ id }) => id));
            const finalParents = new Map(expandedNodes.map((node) => [node.id, rootIds.has(node.id) ? destinations.get(node.id)! : node.parentId]));
            await validateDestinationNames(expandedNodes.map((node) => ({ node, parentId: finalParents.get(node.id)! })), new Set(restoringById.keys()));
            const finalDepths = new Map<string, number>();
            const finalDepth = async (id: string, visiting = new Set<string>()): Promise<number> => {
              const cached = finalDepths.get(id);
              if (cached !== undefined) return cached;
              if (visiting.has(id)) throw new Error("The restored hierarchy contains a cycle.");
              visiting.add(id);
              const parentId = finalParents.get(id)!;
              let depth = 0;
              if (parentId !== null) {
                if (restoringById.has(parentId)) depth = await finalDepth(parentId, visiting) + 1;
                else {
                  const parent = await readNode(parentId);
                  if (!parent) throw new Error("The restore destination does not exist.");
                  depth = (await ancestors(parent)).length + 1;
                }
              }
              visiting.delete(id);
              if (depth > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("The restored hierarchy is too deep.");
              finalDepths.set(id, depth);
              return depth;
            };
            await Promise.all(expandedNodes.map(({ id }) => finalDepth(id)));
            inverse = { kind: "restore", roots: roots.map(({ id, parentId, modifiedAt }) => ({ nodeId: id, parentId, modifiedAt })), nodes: expandedNodes.map((node) => {
              if (node.lifecycle.kind !== "trashed") throw new Error("Restore requires trashed nodes.");
              return { nodeId: node.id, lifecycle: node.lifecycle };
            }) };
            for (const node of expandedNodes) projectedNodes.set(node.id, storeNode({ ...node, parentId: finalParents.get(node.id)!, lifecycle: { kind: "active" }, modifiedAt: rootIds.has(node.id) ? operation.modifiedAt : node.modifiedAt, fieldTuples: { ...node.fieldTuples, parent: rootIds.has(node.id) ? tuple : node.fieldTuples.parent, lifecycle: tuple } }));
            break;
          }
          case "purge": {
            const roots = await Promise.all(operation.nodeIds.map(async (id) => {
              const node = await readNode(id);
              if (!node || node.workspaceId !== workspace.id || node.lifecycle.kind !== "trashed" || node.parentId !== null) throw new Error("Purge requires actual trashed roots in their workspace.");
              return node;
            }));
            const expanded = await expandSubtrees(roots, "trashed", "A purge subtree batch is too large.");
            deletedNodeIds.push(...expanded.flatMap(({ nodes: values }) => values.map(({ node }) => node.id)).sort());
            inverse = { kind: "purge", nodeIds: [...deletedNodeIds], reason: "Permanent purge cannot be undone." };
            break;
          }
          case "set": {
            const previous = await readSetting(operation.namespace, operation.key);
            inverse = { kind: "set", namespace: operation.namespace, key: operation.key, previous: previousSetting(previous) };
            projectedSettings.push(parseSetting({ workspaceId: workspace.id, namespace: operation.namespace, key: operation.key, value: operation.value, logicalTime, operationId: operation.operationId }));
            break;
          }
          case "set-many": {
            const previous = await Promise.all(operation.settings.map(async ({ key }) => ({ key, previous: previousSetting(await readSetting(operation.namespace, key)) })));
            inverse = { kind: "set-many", namespace: operation.namespace, settings: previous };
            projectedSettings.push(...operation.settings.map(({ key, value }) => parseSetting({ workspaceId: workspace.id, namespace: operation.namespace, key, value, logicalTime, operationId: operation.operationId })));
            break;
          }
        }

        if (expectedLifecycleNodeIds) {
          const actualNodeIds = inverse.kind === "trash" ? inverse.nodeIds : inverse.kind === "restore" ? inverse.nodes.map(({ nodeId }) => nodeId) : [];
          if (!equalValues(actualNodeIds, expectedLifecycleNodeIds)) throw new Error("A lifecycle compensation must cover the exact original forest.");
        }

        const localRevision = nextSafeInteger(workspace.localRevision, "The workspace revision is exhausted.");
        const destinationLocalRevision = destinationWorkspace ? nextSafeInteger(destinationWorkspace.localRevision, "The destination workspace revision is exhausted.") : null;
        const transferIdentities = operation.kind === "transfer" && inverse.kind === "transfer" ? transferAffectedIdentities(operation, inverse) : undefined;
        const affectedIdentities = transferIdentities ? [...new Set([...transferIdentities.source, ...transferIdentities.destination])].sort() : localAffectedIdentities(operation, inverse);
        const stored = parseStoredOperation({
          operationId: operation.operationId,
          workspaceId: operation.workspaceId,
          localRevision,
          destinationLocalRevision,
          stateKind: "pending",
          intent: normalized.intent,
          compensatesOperationId: normalized.compensatesOperationId,
          expectedContentTuple: normalized.expectedContentTuple,
          operation,
          inverse,
          affectedIdentities,
          versionNodeIds: operationVersionNodeIds(operation),
        });
        const changes = [parseChangeRecord({ workspaceId: workspace.id, revision: localRevision, operationId: operation.operationId, affectedIdentities: transferIdentities?.source ?? affectedIdentities })];
        if (destinationWorkspace && destinationLocalRevision !== null && transferIdentities) changes.push(parseChangeRecord({ workspaceId: destinationWorkspace.id, revision: destinationLocalRevision, operationId: operation.operationId, affectedIdentities: transferIdentities.destination }));
        const nextWorkspace = parseWorkspace({ ...workspace, localRevision });
        const nextSync = parseSyncState({ ...sync, lastLocalLogicalTime: logicalTime });
        const writes: IDBRequest[] = [];
        for (const manifest of normalized.manifests) if (!storedManifests.has(manifest.hash)) writes.push(transaction.objectStore("manifests").add(manifest));
        for (const node of projectedNodes.values()) writes.push(addedNodeIds.has(node.id) ? nodes.add(node) : nodes.put(node));
        for (const nodeId of deletedNodeIds) writes.push(nodes.delete(nodeId));
        for (const setting of projectedSettings) writes.push(settingsStore.put(setting));
        writes.push(operations.add(stored));
        for (const change of changes) writes.push(transaction.objectStore("changes").add(change));
        writes.push(transaction.objectStore("workspaces").put(nextWorkspace));
        writes.push(transaction.objectStore("sync").put(nextSync));
        if (destinationWorkspace && destinationSync && destinationLocalRevision !== null) {
          writes.push(transaction.objectStore("workspaces").put(parseWorkspace({ ...destinationWorkspace, localRevision: destinationLocalRevision })));
          writes.push(transaction.objectStore("sync").put(parseSyncState({ ...destinationSync, lastLocalLogicalTime: logicalTime })));
        }
        await Promise.all(writes.map((write) => request(write)));
        return stored;
      });
    },

    listChanges: async (workspaceId, afterRevision, limit = WEB2_MAX_BATCH_ITEMS) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalRevision = parseNonNegativeSafeInteger(afterRevision, "A change replay revision is invalid.");
      const boundedLimit = parsePositiveSafeInteger(limit, "A change replay limit is invalid.");
      if (boundedLimit > WEB2_MAX_BATCH_ITEMS) throw new Error("A change replay limit is too large.");
      return transact(db, ["workspaces", "changes", "operations"], "readonly", async (transaction) => {
        const workspaceValue = await request(transaction.objectStore("workspaces").get(canonicalWorkspaceId));
        if (workspaceValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        if (canonicalRevision > workspace.localRevision) throw new Error("A change replay revision is ahead of the workspace.");
        if (canonicalRevision === workspace.localRevision) return [];
        const firstRevision = nextSafeInteger(canonicalRevision, "The change replay revision is exhausted.");
        const values = await request(transaction.objectStore("changes").getAll(keyRange.bound([canonicalWorkspaceId, firstRevision], [canonicalWorkspaceId, Number.MAX_SAFE_INTEGER]), boundedLimit));
        const changes = values.map(parseChangeRecord);
        const expectedCount = Math.min(boundedLimit, workspace.localRevision - canonicalRevision);
        if (changes.length !== expectedCount || changes.some((change, index) => change.workspaceId !== canonicalWorkspaceId || change.revision !== firstRevision + index)) throw new Error("Stored workspace changes are not contiguous.");
        const operations = transaction.objectStore("operations");
        await Promise.all(changes.map(async (change) => {
          const operationValue = await request(operations.get(change.operationId));
          const expected = operationValue === undefined ? undefined : changeForWorkspace(parseStoredOperation(operationValue), canonicalWorkspaceId);
          if (!expected || !equalValues(change, expected)) throw new Error("A stored workspace change does not match its operation.");
        }));
        return changes;
      });
    },

    listOperations: async (workspaceId, limit = 50) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const boundedLimit = parsePositiveSafeInteger(limit, "An operation list limit is invalid.");
      if (boundedLimit > WEB2_MAX_BATCH_ITEMS) throw new Error("An operation list limit is too large.");
      return transact(db, "operations", "readonly", async (transaction) => new Promise<StoredOperation[]>((resolve, reject) => {
        const result: StoredOperation[] = [];
        const cursor = transaction.objectStore("operations").index("by-workspace-revision").openCursor(keyRange.bound([canonicalWorkspaceId, 0], [canonicalWorkspaceId, Number.MAX_SAFE_INTEGER]), "prev");
        cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem operation history could not be read."));
        cursor.onsuccess = () => {
          try {
            if (!cursor.result || result.length === boundedLimit) { resolve(result); return; }
            result.push(parseStoredOperation(cursor.result.value));
            cursor.result.continue();
          } catch (error) {
            reject(error);
          }
        };
      }));
    },

    listFileVersions: async (workspaceId, nodeId) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalNodeId = parseStableId(nodeId, "A node ID is invalid.");
      const versions = await transact(db, ["nodes", "operations"], "readonly", async (transaction) => {
        const nodeValue = await request(transaction.objectStore("nodes").get(canonicalNodeId));
        if (nodeValue === undefined) throw new Error("That file does not exist.");
        const node = parseStoredNode(nodeValue);
        if (node.workspaceId !== canonicalWorkspaceId || node.kind !== "file") throw new Error("File versions require a file in its workspace.");
        if (node.fieldTuples.content === null) throw new Error("A stored file is missing its content tuple.");
        const contentTuple = node.fieldTuples.content;
        const currentOperationValue = await request(transaction.objectStore("operations").get(contentTuple.operationId));
        const retainedCurrent = currentOperationValue === undefined ? undefined : fileVersionFromOperation(parseStoredOperation(currentOperationValue).operation, node.id);
        if (retainedCurrent && (retainedCurrent.logicalTime !== contentTuple.logicalTime || retainedCurrent.mimeType !== node.mimeType || retainedCurrent.size !== node.size || retainedCurrent.manifestHash !== node.manifestHash)) throw new Error("The current file version is inconsistent with its retained operation.");
        const current = {
          nodeId: node.id,
          operationId: contentTuple.operationId,
          logicalTime: contentTuple.logicalTime,
          mimeType: node.mimeType,
          size: node.size,
          manifestHash: node.manifestHash,
          modifiedAt: retainedCurrent?.modifiedAt ?? node.modifiedAt,
          current: true,
        } satisfies FileVersion;
        const older = await new Promise<FileVersion[]>((resolve, reject) => {
          const result: FileVersion[] = [];
          // ponytail: this bounded scan avoids a schema change; add a node-version index when measured history size makes it slow.
          const cursor = transaction.objectStore("operations").openCursor();
          cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem version history could not be read."));
          cursor.onsuccess = () => {
            try {
              if (!cursor.result) { resolve(result); return; }
              const stored = parseStoredOperation(cursor.result.value);
              if (stored.versionNodeIds.includes(canonicalNodeId) && stored.operationId !== current.operationId) {
                const version = fileVersionFromOperation(stored.operation, canonicalNodeId);
                if (version) {
                  const index = result.findIndex((existing) => version.logicalTime > existing.logicalTime || version.logicalTime === existing.logicalTime && version.operationId > existing.operationId);
                  result.splice(index === -1 ? result.length : index, 0, version);
                  if (result.length > FILE_VERSION_HISTORY_LIMIT) result.pop();
                }
              }
              cursor.result.continue();
            } catch (error) {
              reject(error);
            }
          };
        });
        return [current, ...older];
      });
      const manifests = await readStoredManifests([...new Set(versions.map(({ manifestHash }) => manifestHash))]);
      for (const version of versions) {
        const manifest = manifests.get(version.manifestHash);
        if (!manifest) throw new Error("A file version references a missing manifest.");
        if (manifest.manifest.size !== version.size) throw new Error("A file version has inconsistent manifest metadata.");
      }
      return versions;
    },

    listRetainedChunkHashes: async () => {
      const values = await transact(db, "manifests", "readonly", (transaction) => request(transaction.objectStore("manifests").getAll()));
      const hashes = new Set<string>();
      for (const value of values) for (const chunk of (await validateStoredManifest(value)).manifest.chunks) hashes.add(chunk.hash);
      return [...hashes].sort();
    },
  };
}

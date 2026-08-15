import {
  WEB2_INDEXED_DB_PREFIX,
  WEB2_MAX_BATCH_ITEMS,
  assertExactKeys,
  canonicalManifestSha256,
  isRecord,
  parseCanonicalName,
  parseManifest,
  parseMimeType,
  parseNode,
  parseNonNegativeSafeInteger,
  parsePositiveSafeInteger,
  parseSha256,
  parseStableId,
  sha256Hex,
  type Manifest,
  type Node,
} from "./model";
import {
  operationAffectedIdentities,
  parseWorkspaceOperation,
  type WorkspaceOperation,
} from "./operations";

const DATABASE_VERSION = 1;
const FILE_VERSION_HISTORY_LIMIT = 20;
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

type LocallyCommittableOperation = Extract<WorkspaceOperation, { kind: "create" | "write" }>;
export type WorkspaceOperationDraft = {
  [Kind in LocallyCommittableOperation["kind"]]: Omit<Extract<LocallyCommittableOperation, { kind: Kind }>, "logicalTime">;
}[LocallyCommittableOperation["kind"]];

export type OperationIntent = "forward" | "undo" | "redo" | "restore";
export type OperationInverse =
  | { kind: "create"; rootNodeIds: string[] }
  | { kind: "write"; nodeId: string; mimeType: string; size: number; manifestHash: string; modifiedAt: number };

export type StoredOperation = {
  operationId: string;
  workspaceId: string;
  localRevision: number;
  stateKind: "pending";
  intent: OperationIntent;
  compensatesOperationId: string | null;
  operation: Extract<WorkspaceOperation, { kind: "create" | "write" }>;
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

export type CommitOperationInput = {
  operation: WorkspaceOperationDraft;
  manifests?: Array<{ hash: string; manifest: Manifest }>;
  intent?: OperationIntent;
  compensatesOperationId?: string | null;
};

export type FilesystemDatabase = {
  close(): void;
  createWorkspace(value: { id: string; name: string; pinned: boolean; deviceId: string }): Promise<Workspace>;
  listWorkspaces(): Promise<Workspace[]>;
  getNode(id: string): Promise<Node | undefined>;
  listChildren(workspaceId: string, parentId: string | null): Promise<Node[]>;
  getManifest(hash: string): Promise<Manifest | undefined>;
  commitOperation(value: CommitOperationInput): Promise<StoredOperation>;
  listOperations(workspaceId: string, limit?: number): Promise<StoredOperation[]>;
  listFileVersions(workspaceId: string, nodeId: string): Promise<FileVersion[]>;
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
  assertExactKeys(value, ["id", "name", "pinned", "headSequence", "snapshotBarrier", "logFloor", "localRevision"], "A stored workspace has an unsupported shape.");
  if (typeof value.pinned !== "boolean") throw new Error("A stored workspace has invalid pinning metadata.");
  const workspace = {
    id: parseStableId(value.id, "A stored workspace ID is invalid."),
    name: parseCanonicalName(value.name, "A stored workspace name is invalid."),
    pinned: value.pinned,
    headSequence: parseNonNegativeSafeInteger(value.headSequence, "A stored workspace head is invalid."),
    snapshotBarrier: parseNonNegativeSafeInteger(value.snapshotBarrier, "A stored workspace snapshot barrier is invalid."),
    logFloor: parseNonNegativeSafeInteger(value.logFloor, "A stored workspace log floor is invalid."),
    localRevision: parseNonNegativeSafeInteger(value.localRevision, "A stored workspace revision is invalid."),
  };
  if (workspace.logFloor > workspace.snapshotBarrier || workspace.snapshotBarrier > workspace.headSequence) throw new Error("A stored workspace sequence range is invalid.");
  return workspace;
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

function parseOperationInverse(value: unknown): OperationInverse {
  if (!isRecord(value) || value.kind !== "create" && value.kind !== "write") throw new Error("Stored operation inverse metadata has an unsupported shape.");
  if (value.kind === "create") {
    assertExactKeys(value, ["kind", "rootNodeIds"], "Stored operation inverse metadata has an unsupported shape.");
    if (!Array.isArray(value.rootNodeIds) || value.rootNodeIds.length === 0 || value.rootNodeIds.length > WEB2_MAX_BATCH_ITEMS) throw new Error("Stored create inverse roots are invalid.");
    const rootNodeIds = value.rootNodeIds.map((id) => parseStableId(id, "A stored create inverse root ID is invalid."));
    if (new Set(rootNodeIds).size !== rootNodeIds.length) throw new Error("Stored create inverse roots are invalid.");
    return { kind: "create", rootNodeIds };
  }
  assertExactKeys(value, ["kind", "nodeId", "mimeType", "size", "manifestHash", "modifiedAt"], "Stored operation inverse metadata has an unsupported shape.");
  return {
    kind: "write",
    nodeId: parseStableId(value.nodeId, "A stored write inverse node ID is invalid."),
    mimeType: parseMimeType(value.mimeType, "A stored write inverse MIME type is invalid."),
    size: parseNonNegativeSafeInteger(value.size, "A stored write inverse size is invalid."),
    manifestHash: parseSha256(value.manifestHash, "A stored write inverse manifest hash is invalid."),
    modifiedAt: parseNonNegativeSafeInteger(value.modifiedAt, "A stored write inverse modification time is invalid."),
  };
}

function operationVersionNodeIds(operation: Extract<WorkspaceOperation, { kind: "create" | "write" }>) {
  return operation.kind === "create" ? operation.nodes.filter((node) => node.kind === "file").map(({ id }) => id) : [operation.nodeId];
}

function createRootIds(operation: Extract<WorkspaceOperation, { kind: "create" }>) {
  const ids = new Set(operation.nodes.map(({ id }) => id));
  return operation.nodes.filter(({ parentId }) => parentId === null || !ids.has(parentId)).map(({ id }) => id);
}

function equalValues(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseStoredOperation(value: unknown): StoredOperation {
  if (!isRecord(value)) throw new Error("A stored operation has an unsupported shape.");
  assertExactKeys(value, ["operationId", "workspaceId", "localRevision", "stateKind", "intent", "compensatesOperationId", "operation", "inverse", "affectedIdentities", "versionNodeIds"], "A stored operation has an unsupported shape.");
  if (value.stateKind !== "pending") throw new Error("A stored operation state is invalid.");
  const operation = parseWorkspaceOperation(value.operation);
  if (operation.kind !== "create" && operation.kind !== "write") throw new Error("A stored operation kind is unsupported by this database slice.");
  const stored = {
    operationId: parseStableId(value.operationId, "A stored operation ID is invalid."),
    workspaceId: parseStableId(value.workspaceId, "A stored operation workspace ID is invalid."),
    localRevision: parsePositiveSafeInteger(value.localRevision, "A stored operation revision is invalid."),
    stateKind: "pending" as const,
    intent: parseIntent(value.intent),
    compensatesOperationId: value.compensatesOperationId === null ? null : parseStableId(value.compensatesOperationId, "A compensated operation ID is invalid."),
    operation,
    inverse: parseOperationInverse(value.inverse),
    affectedIdentities: parseStringSet(value.affectedIdentities, "Stored operation identities are invalid."),
    versionNodeIds: parseStringSet(value.versionNodeIds, "Stored operation version node IDs are invalid.").map((id) => parseStableId(id, "A stored operation version node ID is invalid.")),
  };
  if (stored.operationId !== operation.operationId || stored.workspaceId !== operation.workspaceId) throw new Error("Stored operation identity metadata is inconsistent.");
  if (!equalValues(stored.affectedIdentities, operationAffectedIdentities(operation)) || !equalValues(stored.versionNodeIds, operationVersionNodeIds(operation))) throw new Error("Stored operation derived metadata is inconsistent.");
  if (operation.kind === "create") {
    if (stored.inverse.kind !== "create" || !equalValues(stored.inverse.rootNodeIds, createRootIds(operation))) throw new Error("Stored operation inverse metadata is inconsistent.");
  } else if (stored.inverse.kind !== "write" || stored.inverse.nodeId !== operation.nodeId) throw new Error("Stored operation inverse metadata is inconsistent.");
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
  if (!isRecord(value) || !("operation" in value) || Object.keys(value).some((key) => !["operation", "manifests", "intent", "compensatesOperationId"].includes(key))) throw new Error("A filesystem commit has an unsupported shape.");
  if (!isRecord(value.operation) || Object.prototype.hasOwnProperty.call(value.operation, "logicalTime")) throw new Error("An operation draft must not supply a logical time.");
  const operation = parseWorkspaceOperation({ ...value.operation, logicalTime: 0 });
  if (operation.kind !== "create" && operation.kind !== "write") throw new Error("Only create and write operations are supported by this database slice.");
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
  return {
    operation,
    manifests,
    intent: parseIntent(value.intent ?? "forward"),
    compensatesOperationId: value.compensatesOperationId === undefined || value.compensatesOperationId === null ? null : parseStableId(value.compensatesOperationId, "A compensated operation ID is invalid."),
  };
}

function replayOperation(operation: Extract<WorkspaceOperation, { kind: "create" | "write" }>) {
  return { ...operation, logicalTime: 0 };
}

function manifestHashes(operation: Extract<WorkspaceOperation, { kind: "create" | "write" }>) {
  return operation.kind === "create"
    ? [...new Set(operation.nodes.filter((node) => node.kind === "file").map(({ manifestHash }) => manifestHash))]
    : [operation.manifestHash];
}

function fileVersionFromOperation(operation: Extract<WorkspaceOperation, { kind: "create" | "write" }>, nodeId: string): FileVersion | undefined {
  if (operation.kind === "write") {
    if (operation.nodeId !== nodeId) return undefined;
    return { nodeId, operationId: operation.operationId, logicalTime: operation.logicalTime, mimeType: operation.mimeType, size: operation.size, manifestHash: operation.manifestHash, modifiedAt: operation.modifiedAt, current: false };
  }
  const node = operation.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.kind !== "file") return undefined;
  return { nodeId, operationId: operation.operationId, logicalTime: operation.logicalTime, mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash, modifiedAt: node.modifiedAt, current: false };
}

export async function openFilesystemDatabase(accountId: string, environment: FilesystemDatabaseEnvironment = {}): Promise<FilesystemDatabase> {
  const factory = environment.indexedDB ?? globalThis.indexedDB;
  const keyRange = environment.IDBKeyRange ?? globalThis.IDBKeyRange;
  if (!factory || !keyRange) throw new Error("IndexedDB filesystem storage is unavailable.");
  const db = await openDatabase(factory, await filesystemDatabaseName(accountId));
  const now = environment.now ?? Date.now;

  return {
    close: () => db.close(),

    createWorkspace: async (value) => {
      if (!isRecord(value)) throw new Error("A workspace creation request has an unsupported shape.");
      assertExactKeys(value, ["id", "name", "pinned", "deviceId"], "A workspace creation request has an unsupported shape.");
      if (typeof value.pinned !== "boolean") throw new Error("Workspace pinning metadata is invalid.");
      const id = parseStableId(value.id, "A workspace ID is invalid.");
      const deviceId = parseStableId(value.deviceId, "A workspace device ID is invalid.");
      const workspace = parseWorkspace({ id, name: parseCanonicalName(value.name, "A workspace name is invalid."), pinned: value.pinned, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 });
      const sync = parseSyncState({ workspaceId: id, deviceId, cursor: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 });
      return transact(db, ["workspaces", "sync"], "readwrite", async (transaction) => {
        const existingWorkspace = await request(transaction.objectStore("workspaces").get(id));
        const existingSync = await request(transaction.objectStore("sync").get(id));
        if (existingWorkspace !== undefined) { parseWorkspace(existingWorkspace); throw new Error("That workspace already exists."); }
        if (existingSync !== undefined) { parseSyncState(existingSync); throw new Error("Stored synchronization state exists without its workspace."); }
        await Promise.all([
          request(transaction.objectStore("workspaces").add(workspace)),
          request(transaction.objectStore("sync").add(sync)),
        ]);
        return workspace;
      });
    },

    listWorkspaces: () => transact(db, "workspaces", "readonly", async (transaction) => {
      const values = await request(transaction.objectStore("workspaces").getAll());
      return values.map(parseWorkspace);
    }),

    getNode: async (id) => {
      const canonicalId = parseStableId(id, "A node ID is invalid.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("nodes").get(canonicalId));
        return value === undefined ? undefined : nodeRecord(parseStoredNode(value));
      });
    },

    listChildren: async (workspaceId, parentId) => {
      const canonicalWorkspaceId = parseStableId(workspaceId, "A workspace ID is invalid.");
      const canonicalParentId = parentId === null ? null : parseStableId(parentId, "A parent node ID is invalid.");
      return transact(db, "nodes", "readonly", async (transaction) => {
        const values = await request(transaction.objectStore("nodes").index("by-workspace-parent-lifecycle").getAll(keyRange.only([canonicalWorkspaceId, canonicalParentId ?? "", "active"])));
        return values.map((value) => nodeRecord(parseStoredNode(value)));
      });
    },

    getManifest: async (hash) => {
      const canonicalHash = parseSha256(hash, "A manifest hash is invalid.");
      return transact(db, "manifests", "readonly", async (transaction) => {
        const value = await request(transaction.objectStore("manifests").get(canonicalHash));
        if (value === undefined) return undefined;
        const record = parseStoredManifest(value);
        if (record.hash !== canonicalHash) throw new Error("Stored manifest identity metadata is inconsistent.");
        return record.manifest;
      });
    },

    commitOperation: async (value) => {
      const normalized = await normalizeCommitInput(value);
      return transact(db, ["workspaces", "nodes", "manifests", "operations", "changes", "sync"], "readwrite", async (transaction) => {
        const operations = transaction.objectStore("operations");
        const existingValue = await request(operations.get(normalized.operation.operationId));
        if (existingValue !== undefined) {
          const existing = parseStoredOperation(existingValue);
          if (!equalValues(replayOperation(existing.operation), normalized.operation) || existing.intent !== normalized.intent || existing.compensatesOperationId !== normalized.compensatesOperationId) throw new Error("An operation ID cannot be reused with different input.");
          return existing;
        }

        const workspaceValue = await request(transaction.objectStore("workspaces").get(normalized.operation.workspaceId));
        const syncValue = await request(transaction.objectStore("sync").get(normalized.operation.workspaceId));
        if (workspaceValue === undefined || syncValue === undefined) throw new Error("That workspace does not exist.");
        const workspace = parseWorkspace(workspaceValue);
        const sync = parseSyncState(syncValue);
        if (sync.workspaceId !== workspace.id || sync.deviceId !== normalized.operation.deviceId) throw new Error("The operation device does not own this local workspace state.");

        const suppliedManifests = new Map(normalized.manifests.map((record) => [record.hash, record]));
        const hashes = [...new Set([...suppliedManifests.keys(), ...manifestHashes(normalized.operation)])];
        const storedManifests = new Map<string, StoredManifest>();
        await Promise.all(hashes.map(async (hash) => {
          const storedValue = await request(transaction.objectStore("manifests").get(hash));
          if (storedValue === undefined) return;
          const stored = parseStoredManifest(storedValue);
          if (stored.hash !== hash) throw new Error("Stored manifest identity metadata is inconsistent.");
          const supplied = suppliedManifests.get(hash);
          if (supplied && !equalValues(stored.manifest, supplied.manifest)) throw new Error("A manifest hash is already stored with different content.");
          storedManifests.set(hash, stored);
        }));
        const resolvedManifest = (hash: string) => suppliedManifests.get(hash) ?? storedManifests.get(hash);
        for (const hash of manifestHashes(normalized.operation)) if (!resolvedManifest(hash)) throw new Error("An operation references a missing manifest.");

        let inverse: OperationInverse;
        let projectedNodes: StoredNode[];
        if (normalized.operation.kind === "create") {
          const createdIds = new Set(normalized.operation.nodes.map(({ id }) => id));
          const existingNodes = await Promise.all(normalized.operation.nodes.map(({ id }) => request(transaction.objectStore("nodes").get(id))));
          for (const value of existingNodes) if (value !== undefined) { parseStoredNode(value); throw new Error("A node ID already exists."); }

          const externalParentIds = [...new Set(normalized.operation.nodes.map(({ parentId }) => parentId).filter((parentId): parentId is string => parentId !== null && !createdIds.has(parentId)))];
          await Promise.all(externalParentIds.map(async (id) => {
            const parentValue = await request(transaction.objectStore("nodes").get(id));
            if (parentValue === undefined) throw new Error("A created node parent does not exist.");
            const parent = parseStoredNode(parentValue);
            if (parent.workspaceId !== workspace.id || parent.kind !== "folder" || parent.lifecycle.kind !== "active") throw new Error("A created node parent must be an active folder in its workspace.");
          }));

          const externalParentKeys = [...new Set(normalized.operation.nodes.filter(({ parentId }) => parentId === null || !createdIds.has(parentId)).map(({ parentId }) => parentId ?? ""))];
          const siblingNames = new Set<string>();
          await Promise.all(externalParentKeys.map(async (parentKey) => {
            const values = await request(transaction.objectStore("nodes").index("by-workspace-parent-lifecycle").getAll(keyRange.only([workspace.id, parentKey, "active"])));
            for (const value of values) {
              const sibling = parseStoredNode(value);
              siblingNames.add(`${parentKey}\0${sibling.name.toLowerCase()}`);
            }
          }));
          for (const node of normalized.operation.nodes) {
            if (node.kind === "file" && resolvedManifest(node.manifestHash)!.manifest.size !== node.size) throw new Error("A created file size does not match its manifest.");
            const parentKey = node.parentId ?? "";
            if ((node.parentId === null || !createdIds.has(node.parentId)) && siblingNames.has(`${parentKey}\0${node.name.toLowerCase()}`)) throw new Error("An active sibling already uses that name.");
          }
          inverse = { kind: "create", rootNodeIds: createRootIds(normalized.operation) };
          projectedNodes = [];
        } else {
          const nodeValue = await request(transaction.objectStore("nodes").get(normalized.operation.nodeId));
          if (nodeValue === undefined) throw new Error("The written file does not exist.");
          const node = parseStoredNode(nodeValue);
          if (node.workspaceId !== workspace.id || node.kind !== "file" || node.lifecycle.kind !== "active") throw new Error("A write requires an active file in its workspace.");
          if (resolvedManifest(normalized.operation.manifestHash)!.manifest.size !== normalized.operation.size) throw new Error("A written file size does not match its manifest.");
          inverse = { kind: "write", nodeId: node.id, mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash, modifiedAt: node.modifiedAt };
          projectedNodes = [node];
        }

        const observedNext = nextSafeInteger(sync.lastObservedLogicalTime, "The observed logical clock is exhausted.");
        const localNext = nextSafeInteger(sync.lastLocalLogicalTime, "The local logical clock is exhausted.");
        const wallTime = parseNonNegativeSafeInteger(now(), "The current time is invalid.");
        const logicalTime = Math.max(wallTime, observedNext, localNext);
        const operation = parseWorkspaceOperation({ ...normalized.operation, logicalTime });
        if (operation.kind !== "create" && operation.kind !== "write") throw new Error("Only create and write operations are supported by this database slice.");
        const tuple = { logicalTime, operationId: operation.operationId };
        if (operation.kind === "create") {
          projectedNodes = operation.nodes.map((node) => storeNode(parseNode({
            ...node,
            workspaceId: operation.workspaceId,
            lifecycle: { kind: "active" },
            fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: node.kind === "file" ? tuple : null },
          })));
        } else {
          const previous = projectedNodes[0]!;
          if (previous.kind !== "file") throw new Error("A write requires a file.");
          projectedNodes = [storeNode({ ...previous, mimeType: operation.mimeType, size: operation.size, manifestHash: operation.manifestHash, modifiedAt: operation.modifiedAt, fieldTuples: { ...previous.fieldTuples, content: tuple } })];
        }

        const localRevision = nextSafeInteger(workspace.localRevision, "The workspace revision is exhausted.");
        const affectedIdentities = operationAffectedIdentities(operation);
        const stored = parseStoredOperation({
          operationId: operation.operationId,
          workspaceId: operation.workspaceId,
          localRevision,
          stateKind: "pending",
          intent: normalized.intent,
          compensatesOperationId: normalized.compensatesOperationId,
          operation,
          inverse,
          affectedIdentities,
          versionNodeIds: operationVersionNodeIds(operation),
        });
        const change = parseChangeRecord({ workspaceId: workspace.id, revision: localRevision, operationId: operation.operationId, affectedIdentities });
        const nextWorkspace = parseWorkspace({ ...workspace, localRevision });
        const nextSync = parseSyncState({ ...sync, lastLocalLogicalTime: logicalTime });
        const writes: IDBRequest[] = [];
        for (const manifest of normalized.manifests) if (!storedManifests.has(manifest.hash)) writes.push(transaction.objectStore("manifests").add(manifest));
        for (const node of projectedNodes) writes.push(operation.kind === "create" ? transaction.objectStore("nodes").add(node) : transaction.objectStore("nodes").put(node));
        writes.push(operations.add(stored));
        writes.push(transaction.objectStore("changes").add(change));
        writes.push(transaction.objectStore("workspaces").put(nextWorkspace));
        writes.push(transaction.objectStore("sync").put(nextSync));
        await Promise.all(writes.map((write) => request(write)));
        return stored;
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
      return transact(db, ["nodes", "operations", "manifests"], "readonly", async (transaction) => {
        const nodeValue = await request(transaction.objectStore("nodes").get(canonicalNodeId));
        if (nodeValue === undefined) throw new Error("That file does not exist.");
        const node = parseStoredNode(nodeValue);
        if (node.workspaceId !== canonicalWorkspaceId || node.kind !== "file") throw new Error("File versions require a file in its workspace.");
        if (node.fieldTuples.content === null) throw new Error("A stored file is missing its content tuple.");
        const contentTuple = node.fieldTuples.content;
        const current = {
          nodeId: node.id,
          operationId: contentTuple.operationId,
          logicalTime: contentTuple.logicalTime,
          mimeType: node.mimeType,
          size: node.size,
          manifestHash: node.manifestHash,
          modifiedAt: node.modifiedAt,
          current: true,
        } satisfies FileVersion;
        const older = await new Promise<FileVersion[]>((resolve, reject) => {
          const result: FileVersion[] = [];
          const cursor = transaction.objectStore("operations").index("by-workspace-revision").openCursor(keyRange.bound([canonicalWorkspaceId, 0], [canonicalWorkspaceId, Number.MAX_SAFE_INTEGER]), "prev");
          cursor.onerror = () => reject(cursor.error ?? new Error("Filesystem version history could not be read."));
          cursor.onsuccess = () => {
            try {
              if (!cursor.result || result.length === FILE_VERSION_HISTORY_LIMIT) { resolve(result); return; }
              const stored = parseStoredOperation(cursor.result.value);
              if (stored.versionNodeIds.includes(canonicalNodeId) && stored.operationId !== current.operationId) {
                const version = fileVersionFromOperation(stored.operation, canonicalNodeId);
                if (version) result.push(version);
              }
              cursor.result.continue();
            } catch (error) {
              reject(error);
            }
          };
        });
        for (const version of [current, ...older]) {
          const manifestValue = await request(transaction.objectStore("manifests").get(version.manifestHash));
          if (manifestValue === undefined) throw new Error("A file version references a missing manifest.");
          const manifest = parseStoredManifest(manifestValue);
          if (manifest.hash !== version.manifestHash || manifest.manifest.size !== version.size) throw new Error("A file version has inconsistent manifest metadata.");
        }
        return [current, ...older];
      });
    },
  };
}

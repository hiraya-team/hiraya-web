import { getAccountOpfsRoot, readChunk, reconstructBlob, removeOrphanChunks, stageBlob } from "../../filesystem/chunks";
import {
  filesystemDatabaseName,
  openFilesystemDatabase,
  type FileVersion,
  type FilesystemDatabaseEnvironment,
  type StoredOperation,
} from "../../filesystem/database";
import {
  WEB2_MAX_ANCESTRY_DEPTH,
  WEB2_MAX_BATCH_ITEMS,
  WEB2_SCHEMA_VERSION,
  isRecord,
  parseCanonicalName,
  parseMimeType,
  parseNonNegativeSafeInteger,
  parsePosition,
  parseStableId,
  type JsonValue,
  type Node,
  type OperationTuple,
  type Position,
  type Setting,
  type SettingNamespace,
} from "../../filesystem/model";
import type { NewNode, SettingChange } from "../../filesystem/operations";

export type WorkspaceFilesystemEnvironment = FilesystemDatabaseEnvironment & {
  originRoot?: FileSystemDirectoryHandle;
  randomUUID?: () => string;
  locks?: Pick<LockManager, "request">;
};

type CreateForestNodeBase = {
  key: string;
  name: string;
  parentKey: string | null;
  position: Position;
  modifiedAt?: number;
};

export type CreateForestNode =
  | CreateForestNodeBase & { kind: "folder" }
  | CreateForestNodeBase & { kind: "file"; content: Blob; mimeType?: string };

export type CopyNodeRoot = { nodeId: string; name: string; position: Position };

type PreparedForestNode =
  | Omit<CreateForestNodeBase, "modifiedAt" | "position"> & { kind: "folder"; position: Position; modifiedAt: number }
  | Omit<CreateForestNodeBase, "modifiedAt" | "position"> & { kind: "file"; position: Position; modifiedAt: number; content: Blob; mimeType: string };

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertShape(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], message: string) {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) throw new Error(message);
}

function parseTransientKey(value: unknown, message: string) {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
  return value;
}

function prepareForest(value: unknown, timestamp: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A created forest must contain between 1 and 256 nodes.");
  const nodes = value.map((candidate): PreparedForestNode => {
    if (!isRecord(candidate) || candidate.kind !== "folder" && candidate.kind !== "file") throw new Error("A created forest node has an unsupported shape.");
    const required = ["key", "kind", "name", "parentKey", "position"];
    assertShape(candidate, candidate.kind === "file" ? [...required, "content"] : required, candidate.kind === "file" ? ["mimeType", "modifiedAt"] : ["modifiedAt"], "A created forest node has an unsupported shape.");
    const base = {
      key: parseTransientKey(candidate.key, "A created forest key is invalid."),
      name: parseCanonicalName(candidate.name, "A created forest name is invalid."),
      parentKey: candidate.parentKey === null ? null : parseTransientKey(candidate.parentKey, "A created forest parent key is invalid."),
      position: parsePosition(candidate.position),
      modifiedAt: parseNonNegativeSafeInteger(candidate.modifiedAt ?? timestamp, "A created forest modification time is invalid."),
    };
    if (candidate.kind === "folder") return { ...base, kind: "folder" };
    if (!(candidate.content instanceof Blob)) throw new TypeError("File content must be a Blob.");
    return { ...base, kind: "file", content: candidate.content, mimeType: parseMimeType(candidate.mimeType ?? (candidate.content.type || "application/octet-stream"), "A created file MIME type is invalid.") };
  });
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  if (byKey.size !== nodes.length) throw new Error("A created forest contains duplicate keys.");
  const siblingNames = new Map<string | null, Set<string>>();
  for (const node of nodes) {
    if (node.parentKey !== null) {
      const parent = byKey.get(node.parentKey);
      if (!parent) throw new Error("A created forest parent key does not exist.");
      if (parent.kind !== "folder") throw new Error("A created forest parent must be a folder.");
    }
    const names = siblingNames.get(node.parentKey) ?? new Set<string>();
    const name = node.name.toLowerCase();
    if (names.has(name)) throw new Error("A created forest contains duplicate sibling names.");
    names.add(name);
    siblingNames.set(node.parentKey, names);
  }
  const depths = new Map<string, number>();
  const depth = (key: string, visiting = new Set<string>()): number => {
    const cached = depths.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) throw new Error("A created forest contains a cycle.");
    visiting.add(key);
    const node = byKey.get(key)!;
    const result = node.parentKey === null ? 0 : depth(node.parentKey, visiting) + 1;
    visiting.delete(key);
    if (result > WEB2_MAX_ANCESTRY_DEPTH) throw new Error("The created forest is too deep.");
    depths.set(key, result);
    return result;
  };
  for (const node of nodes) depth(node.key);
  return { nodes, maxDepth: Math.max(...depths.values()) };
}

function prepareCopyRoots(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > WEB2_MAX_BATCH_ITEMS) throw new Error("A copy must contain between 1 and 256 roots.");
  const roots = value.map((candidate): CopyNodeRoot => {
    if (!isRecord(candidate)) throw new Error("A copy root has an unsupported shape.");
    assertShape(candidate, ["nodeId", "name", "position"], [], "A copy root has an unsupported shape.");
    return { nodeId: parseStableId(candidate.nodeId, "A copy source node ID is invalid."), name: parseCanonicalName(candidate.name, "A copied root name is invalid."), position: parsePosition(candidate.position) };
  });
  if (new Set(roots.map(({ nodeId }) => nodeId)).size !== roots.length) throw new Error("A copy contains duplicate source roots.");
  return roots;
}

export type WorkspaceFilesystem = {
  createForest(value: { parentId: string | null; nodes: CreateForestNode[] }): Promise<Node[]>;
  createFolder(value: { name: string; parentId?: string | null; position?: Position }): Promise<Node>;
  createFile(value: { name: string; content: Blob; mimeType?: string; parentId?: string | null; position?: Position }): Promise<Node>;
  copyNodes(value: { parentId: string | null; roots: CopyNodeRoot[] }): Promise<Node[]>;
  getNode(nodeId: string): Promise<Node | undefined>;
  listChildren(parentId: string | null): Promise<Node[]>;
  listTrash(): Promise<Node[]>;
  getSetting(namespace: SettingNamespace, key: string): Promise<Setting | undefined>;
  listSettings(namespace: SettingNamespace): Promise<Setting[]>;
  readFile(nodeId: string): Promise<{ content: Blob; contentTuple: OperationTuple }>;
  writeFile(nodeId: string, content: Blob, value: { expectedContentTuple: OperationTuple; mimeType?: string }): Promise<StoredOperation>;
  renameNode(nodeId: string, name: string): Promise<StoredOperation>;
  moveNodes(nodeIds: string[], parentId: string | null): Promise<StoredOperation>;
  transferNodes(destinationWorkspaceId: string, nodeIds: string[], parentId: string | null): Promise<StoredOperation>;
  setNodePositions(positions: Array<{ nodeId: string; position: Position }>): Promise<StoredOperation>;
  trashNodes(nodeIds: string[]): Promise<StoredOperation>;
  restoreNodes(nodeIds: string[], destination: "original" | "root"): Promise<StoredOperation>;
  purgeNodes(nodeIds: string[]): Promise<StoredOperation>;
  setSetting(namespace: SettingNamespace, key: string, value: JsonValue): Promise<StoredOperation>;
  setSettings(namespace: SettingNamespace, settings: SettingChange[]): Promise<StoredOperation>;
  listOperations(limit?: number): Promise<StoredOperation[]>;
  listFileVersions(nodeId: string): Promise<FileVersion[]>;
  readFileVersion(nodeId: string, operationId: string): Promise<Blob>;
  undoOperation(operationId: string): Promise<StoredOperation>;
  redoOperation(operationId: string): Promise<StoredOperation>;
  restoreFileVersion(nodeId: string, operationId: string): Promise<StoredOperation>;
  removeOrphans(): Promise<void>;
  close(): void;
};

export async function openWorkspaceFilesystem(accountId: string, workspaceId: string, environment: WorkspaceFilesystemEnvironment = {}): Promise<WorkspaceFilesystem> {
  const database = await openFilesystemDatabase(accountId, environment);
  try {
    const sync = await database.getSyncState(workspaceId);
    const root = await getAccountOpfsRoot(accountId, environment.originRoot);
    const databaseName = await filesystemDatabaseName(accountId);
    const accountLockName = `${databaseName}-storage`;
    const locks = environment.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
    const now = environment.now ?? Date.now;
    const randomUUID = environment.randomUUID ?? (() => crypto.randomUUID());
    const lockedWorkspaces = <T>(workspaceIds: string[], operation: () => Promise<T>) => {
      if (!locks) throw new Error("Web Locks are required for fresh filesystem mutations.");
      const lockNames = [...new Set(workspaceIds.map((id) => parseStableId(id, "A workspace ID is invalid.")))].sort().map((id) => `${databaseName}-workspace-${id}`);
      const acquire = (index: number): Promise<T> => index === lockNames.length
        ? operation()
        : locks.request(lockNames[index]!, { mode: "exclusive" }, () => acquire(index + 1));
      return locks.request(accountLockName, { mode: "shared" }, () => acquire(0));
    };
    const locked = <T>(operation: () => Promise<T>) => lockedWorkspaces([workspaceId], operation);
    const cleanupLocked = <T>(operation: () => Promise<T>) => {
      if (!locks) throw new Error("Web Locks are required for fresh filesystem mutations.");
      return locks.request(accountLockName, { mode: "exclusive" }, operation);
    };
    const fileNode = async (nodeId: string) => {
      const node = await database.getNode(nodeId);
      if (!node || node.workspaceId !== workspaceId || node.kind !== "file" || node.lifecycle.kind !== "active") throw new Error("That active file does not exist in this workspace.");
      return node;
    };
    const content = async (mimeType: string, size: number, manifestHash: string) => {
      const manifest = await database.getManifest(manifestHash);
      if (!manifest) throw new Error("File content references a missing manifest.");
      if (manifest.size !== size) throw new Error("File content does not match its manifest size.");
      return reconstructBlob(root, manifest, mimeType);
    };
    const commitVersion = async (nodeId: string, version: Pick<FileVersion, "mimeType" | "size" | "manifestHash">, expectedContentTuple: OperationTuple, intent: "undo" | "redo" | "restore", compensatesOperationId: string) => {
      await content(version.mimeType, version.size, version.manifestHash);
      return database.commitOperation({
        operation: {
          schemaVersion: WEB2_SCHEMA_VERSION,
          kind: "write",
          operationId: randomUUID(),
          workspaceId,
          deviceId: sync.deviceId,
          nodeId,
          mimeType: version.mimeType,
          size: version.size,
          manifestHash: version.manifestHash,
          modifiedAt: now(),
        },
        intent,
        compensatesOperationId,
        expectedContentTuple,
      });
    };

    const preflightDestination = async (parentValue: unknown, roots: readonly { name: string }[], maxRelativeDepth: number, depthMessage: string) => {
      const parentId = parentValue === null ? null : parseStableId(parentValue, "A destination parent ID is invalid.");
      let destinationDepth = 0;
      if (parentId !== null) {
        const seen = new Set<string>();
        let currentId: string | null = parentId;
        while (currentId !== null) {
          if (seen.has(currentId)) throw new Error("The destination hierarchy contains a cycle.");
          seen.add(currentId);
          const current: Node | undefined = await database.getNode(currentId);
          if (!current || current.workspaceId !== workspaceId || current.kind !== "folder" || current.lifecycle.kind !== "active") throw new Error("The destination parent must be an active folder in this workspace.");
          destinationDepth += 1;
          if (destinationDepth > WEB2_MAX_ANCESTRY_DEPTH) throw new Error(depthMessage);
          currentId = current.parentId;
        }
      }
      if (destinationDepth + maxRelativeDepth > WEB2_MAX_ANCESTRY_DEPTH) throw new Error(depthMessage);
      await database.assertChildNamesAvailable(workspaceId, parentId, roots.map(({ name }) => name));
      return parentId;
    };

    const readCreatedNodes = async (ids: readonly string[]) => Promise.all(ids.map(async (id) => {
      const node = await database.getNode(id);
      if (!node) throw new Error("A committed node is missing from the filesystem projection.");
      return node;
    }));

    const createForest = (value: { parentId: string | null; nodes: CreateForestNode[] }) => locked(async () => {
      if (!isRecord(value)) throw new Error("A forest creation request has an unsupported shape.");
      assertShape(value, ["parentId", "nodes"], [], "A forest creation request has an unsupported shape.");
      const timestamp = parseNonNegativeSafeInteger(now(), "The current time is invalid.");
      const prepared = prepareForest(value.nodes, timestamp);
      const roots = prepared.nodes.filter(({ parentKey }) => parentKey === null);
      const parentId = await preflightDestination(value.parentId, roots, prepared.maxDepth, "The created hierarchy is too deep.");
      const ids = new Map(prepared.nodes.map((node) => [node.key, randomUUID()]));
      const operationId = randomUUID();
      await database.assertNodeIdsAvailable([...ids.values()]);
      if (await database.getOperation(operationId)) throw new Error("An operation ID is already in use.");
      const stagedByKey = new Map<string, Awaited<ReturnType<typeof stageBlob>>>();
      const manifests = new Map<string, Awaited<ReturnType<typeof stageBlob>>>();
      for (const node of prepared.nodes) if (node.kind === "file") {
        const staged = await stageBlob(root, node.content);
        stagedByKey.set(node.key, staged);
        manifests.set(staged.manifestHash, staged);
      }
      const nodes: NewNode[] = prepared.nodes.map((node) => {
        const base = {
          id: ids.get(node.key)!,
          name: node.name,
          parentId: node.parentKey === null ? parentId : ids.get(node.parentKey)!,
          position: node.position,
          createdAt: timestamp,
          modifiedAt: node.modifiedAt,
        };
        if (node.kind === "folder") return { ...base, kind: "folder" };
        const staged = stagedByKey.get(node.key)!;
        return { ...base, kind: "file", mimeType: node.mimeType, size: staged.manifest.size, manifestHash: staged.manifestHash };
      });
      await database.commitOperation({
        operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "create", operationId, workspaceId, deviceId: sync.deviceId, nodes },
        manifests: [...manifests.values()].map(({ manifest, manifestHash }) => ({ hash: manifestHash, manifest })),
      });
      return readCreatedNodes(nodes.map(({ id }) => id));
    });

    const copyNodes = (value: { parentId: string | null; roots: CopyNodeRoot[] }) => locked(async () => {
      if (!isRecord(value)) throw new Error("A copy request has an unsupported shape.");
      assertShape(value, ["parentId", "roots"], [], "A copy request has an unsupported shape.");
      const roots = prepareCopyRoots(value.roots);
      const timestamp = parseNonNegativeSafeInteger(now(), "The current time is invalid.");
      const sourceRoots = await Promise.all(roots.map(async ({ nodeId }) => {
        const node = await database.getNode(nodeId);
        if (!node || node.workspaceId !== workspaceId || node.lifecycle.kind !== "active") throw new Error("A copy requires active source roots in this workspace.");
        return node;
      }));
      const seen = new Set<string>();
      const expanded: Array<Array<{ node: Node; depth: number }>> = [];
      for (const sourceRoot of sourceRoots) {
        if (seen.has(sourceRoot.id)) throw new Error("Copied roots cannot overlap.");
        seen.add(sourceRoot.id);
        const nodes: Array<{ node: Node; depth: number }> = [];
        const pending = [{ node: sourceRoot, depth: 0 }];
        for (let index = 0; index < pending.length; index += 1) {
          const current = pending[index]!;
          if (seen.size > WEB2_MAX_BATCH_ITEMS) throw new Error("A copied forest is too large.");
          nodes.push(current);
          const remaining = WEB2_MAX_BATCH_ITEMS - seen.size;
          const children = await database.listChildren(workspaceId, current.node.id, remaining + 1);
          if (children.length > remaining) throw new Error("A copied forest is too large.");
          for (const child of children) {
            if (child.workspaceId !== workspaceId || child.lifecycle.kind !== "active") throw new Error("The copied source hierarchy is invalid.");
            if (seen.has(child.id)) throw new Error("Copied roots cannot overlap.");
            seen.add(child.id);
            pending.push({ node: child, depth: current.depth + 1 });
          }
        }
        expanded.push(nodes);
      }
      const maxDepth = Math.max(...expanded.flatMap((nodes) => nodes.map(({ depth }) => depth)));
      const parentId = await preflightDestination(value.parentId, roots, maxDepth, "The copy destination would make the hierarchy too deep.");
      const sourceNodes = expanded.flatMap((nodes) => nodes.map(({ node }) => node));
      const ids = new Map(sourceNodes.map((node) => [node.id, randomUUID()]));
      const operationId = randomUUID();
      await database.assertNodeIdsAvailable([...ids.values()]);
      if (await database.getOperation(operationId)) throw new Error("An operation ID is already in use.");

      const chunks = new Map<string, { hash: string; size: number }>();
      const files = expanded.flatMap((nodes) => nodes.map(({ node }) => node)).filter((node): node is Extract<Node, { kind: "file" }> => node.kind === "file");
      for (const file of files) {
        const manifest = await database.getManifest(file.manifestHash);
        if (!manifest) throw new Error("Copied file content references a missing manifest.");
        if (manifest.size !== file.size) throw new Error("Copied file content does not match its manifest size.");
        for (const chunk of manifest.chunks) {
          const existing = chunks.get(chunk.hash);
          if (existing && existing.size !== chunk.size) throw new Error("Copied manifests contain inconsistent chunk metadata.");
          chunks.set(chunk.hash, chunk);
        }
      }
      for (const chunk of chunks.values()) await readChunk(root, chunk);

      const nodes: NewNode[] = [];
      for (let rootIndex = 0; rootIndex < expanded.length; rootIndex += 1) {
        const override = roots[rootIndex]!;
        for (const { node, depth } of expanded[rootIndex]!) {
          const base = {
            id: ids.get(node.id)!,
            name: depth === 0 ? override.name : node.name,
            parentId: depth === 0 ? parentId : ids.get(node.parentId!)!,
            position: depth === 0 ? override.position : node.position,
            createdAt: timestamp,
            modifiedAt: timestamp,
          };
          nodes.push(node.kind === "folder" ? { ...base, kind: "folder" } : { ...base, kind: "file", mimeType: node.mimeType, size: node.size, manifestHash: node.manifestHash });
        }
      }
      await database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "copy", operationId, workspaceId, deviceId: sync.deviceId, sourceNodeIds: roots.map(({ nodeId }) => nodeId), nodes } });
      return readCreatedNodes(nodes.map(({ id }) => id));
    });

    return {
      createForest,
      createFolder: (value) => createForest({ parentId: value.parentId ?? null, nodes: [{ key: "root", kind: "folder", name: value.name, parentKey: null, position: value.position ?? { x: 0, y: 0 } }] }).then(([node]) => node!),
      createFile: (value) => createForest({ parentId: value.parentId ?? null, nodes: [{ key: "root", kind: "file", name: value.name, parentKey: null, position: value.position ?? { x: 0, y: 0 }, content: value.content, mimeType: value.mimeType }] }).then(([node]) => node!),
      copyNodes,

      getNode: async (nodeId) => {
        const node = await database.getNode(nodeId);
        return node?.workspaceId === workspaceId ? node : undefined;
      },
      listChildren: (parentId) => database.listChildren(workspaceId, parentId),
      listTrash: () => database.listTrash(workspaceId),
      getSetting: (namespace, key) => database.getSetting(workspaceId, namespace, key),
      listSettings: (namespace) => database.listSettings(workspaceId, namespace),

      readFile: async (nodeId) => {
        const node = await fileNode(nodeId);
        return { content: await content(node.mimeType, node.size, node.manifestHash), contentTuple: node.fieldTuples.content! };
      },

      writeFile: (nodeId, contentValue, value) => locked(async () => {
        if (!(contentValue instanceof Blob)) throw new TypeError("File content must be a Blob.");
        const node = await fileNode(nodeId);
        const staged = await stageBlob(root, contentValue);
        return database.commitOperation({
          operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "write", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeId, mimeType: value.mimeType ?? (contentValue.type || node.mimeType), size: staged.manifest.size, manifestHash: staged.manifestHash, modifiedAt: now() },
          manifests: [{ hash: staged.manifestHash, manifest: staged.manifest }],
          expectedContentTuple: value.expectedContentTuple,
        });
      }),

      renameNode: (nodeId, name) => locked(() => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "rename", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeId, name, modifiedAt: now() } })),
      moveNodes: (nodeIds, parentId) => locked(() => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "move", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeIds, parentId, modifiedAt: now() } })),
      transferNodes: (destinationWorkspaceId, nodeIds, parentId) => lockedWorkspaces([workspaceId, destinationWorkspaceId], () => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "transfer", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeIds, destinationWorkspaceId, parentId, modifiedAt: now() } })),
      setNodePositions: (positions) => locked(() => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "position", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, positions } })),
      trashNodes: (nodeIds) => locked(() => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "trash", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeIds, trashedAt: now() } })),
      restoreNodes: (nodeIds, destination) => locked(() => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "restore", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeIds, destination, modifiedAt: now() } })),
      purgeNodes: (nodeIds) => locked(() => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "purge", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeIds } })),
      setSetting: (namespace, key, value) => locked(() => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "set", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, namespace, key, value } })),
      setSettings: (namespace, settings) => locked(() => database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "set-many", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, namespace, settings } })),

      listOperations: (limit) => database.listOperations(workspaceId, limit),
      listFileVersions: (nodeId) => database.listFileVersions(workspaceId, nodeId),

      readFileVersion: async (nodeId, operationId) => {
        const version = (await database.listFileVersions(workspaceId, nodeId)).find((candidate) => candidate.operationId === operationId);
        if (!version) throw new Error("That file version is no longer available.");
        return content(version.mimeType, version.size, version.manifestHash);
      },

      undoOperation: (operationId) => locked(async () => {
        const target = await database.getOperation(operationId);
        if (!target || target.workspaceId !== workspaceId) throw new Error("That operation does not exist in this workspace.");
        if (target.operation.kind === "write" && (target.intent === "forward" || target.intent === "redo" || target.intent === "restore") && target.inverse.kind === "write") {
          const current = await fileNode(target.operation.nodeId);
          return commitVersion(target.operation.nodeId, target.inverse, current.fieldTuples.content!, "undo", target.operationId);
        }
        const rootNodeIds = (target.operation.kind === "create" || target.operation.kind === "copy") && target.intent === "forward" && (target.inverse.kind === "create" || target.inverse.kind === "copy")
          ? target.inverse.rootNodeIds
          : target.operation.kind === "restore" && target.intent === "redo" && target.inverse.kind === "restore" ? target.operation.nodeIds : undefined;
        if (!rootNodeIds) throw new Error("Only a write, create, copy, or lifecycle redo can be undone.");
        return database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "trash", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeIds: rootNodeIds, trashedAt: now() }, intent: "undo", compensatesOperationId: target.operationId });
      }),

      redoOperation: (operationId) => locked(async () => {
        const target = await database.getOperation(operationId);
        if (!target || target.workspaceId !== workspaceId || target.intent !== "undo") throw new Error("Only an undo can be redone.");
        if (target.operation.kind === "write" && target.inverse.kind === "write") {
          const current = await fileNode(target.operation.nodeId);
          return commitVersion(target.operation.nodeId, target.inverse, current.fieldTuples.content!, "redo", target.operationId);
        }
        if (target.operation.kind !== "trash" || target.inverse.kind !== "trash") throw new Error("Only an undo can be redone.");
        return database.commitOperation({ operation: { schemaVersion: WEB2_SCHEMA_VERSION, kind: "restore", operationId: randomUUID(), workspaceId, deviceId: sync.deviceId, nodeIds: target.inverse.roots.map(({ nodeId }) => nodeId), destination: "original", modifiedAt: now() }, intent: "redo", compensatesOperationId: target.operationId });
      }),

      restoreFileVersion: (nodeId, operationId) => locked(async () => {
        const versions = await database.listFileVersions(workspaceId, nodeId);
        const version = versions.find((candidate) => candidate.operationId === operationId);
        if (!version || version.current) throw new Error("That historical file version is no longer available.");
        const node = await fileNode(nodeId);
        return commitVersion(nodeId, version, node.fieldTuples.content!, "restore", operationId);
      }),

      removeOrphans: () => cleanupLocked(async () => removeOrphanChunks(root, await database.listRetainedChunkHashes())),
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

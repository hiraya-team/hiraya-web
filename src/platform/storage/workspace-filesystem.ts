import { getAccountOpfsRoot, reconstructBlob, removeOrphanChunks, stageBlob } from "../../filesystem/chunks";
import {
  filesystemDatabaseName,
  openFilesystemDatabase,
  type FileVersion,
  type FilesystemDatabaseEnvironment,
  type StoredOperation,
} from "../../filesystem/database";
import { WEB2_SCHEMA_VERSION, type JsonValue, type Node, type OperationTuple, type Position, type Setting, type SettingNamespace } from "../../filesystem/model";
import type { SettingChange } from "../../filesystem/operations";

export type WorkspaceFilesystemEnvironment = FilesystemDatabaseEnvironment & {
  originRoot?: FileSystemDirectoryHandle;
  randomUUID?: () => string;
  locks?: Pick<LockManager, "request">;
};

export type WorkspaceFilesystem = {
  createFolder(value: { name: string; parentId?: string | null; position?: Position }): Promise<Node>;
  createFile(value: { name: string; content: Blob; mimeType?: string; parentId?: string | null; position?: Position }): Promise<Node>;
  getNode(nodeId: string): Promise<Node | undefined>;
  listChildren(parentId: string | null): Promise<Node[]>;
  listTrash(): Promise<Node[]>;
  getSetting(namespace: SettingNamespace, key: string): Promise<Setting | undefined>;
  listSettings(namespace: SettingNamespace): Promise<Setting[]>;
  readFile(nodeId: string): Promise<{ content: Blob; contentTuple: OperationTuple }>;
  writeFile(nodeId: string, content: Blob, value: { expectedContentTuple: OperationTuple; mimeType?: string }): Promise<StoredOperation>;
  renameNode(nodeId: string, name: string): Promise<StoredOperation>;
  moveNodes(nodeIds: string[], parentId: string | null): Promise<StoredOperation>;
  setNodePositions(positions: Array<{ nodeId: string; position: Position }>): Promise<StoredOperation>;
  trashNodes(nodeIds: string[]): Promise<StoredOperation>;
  restoreNodes(nodeIds: string[], destination: "original" | "root"): Promise<StoredOperation>;
  purgeNodes(nodeIds: string[]): Promise<StoredOperation>;
  setSetting(namespace: SettingNamespace, key: string, value: JsonValue): Promise<StoredOperation>;
  setSettings(namespace: SettingNamespace, settings: SettingChange[]): Promise<StoredOperation>;
  listOperations(limit?: number): Promise<StoredOperation[]>;
  listFileVersions(nodeId: string): Promise<FileVersion[]>;
  readFileVersion(nodeId: string, operationId: string): Promise<Blob>;
  undoWrite(operationId: string): Promise<StoredOperation>;
  redoWrite(operationId: string): Promise<StoredOperation>;
  restoreFileVersion(nodeId: string, operationId: string): Promise<StoredOperation>;
  removeOrphans(): Promise<void>;
  close(): void;
};

export async function openWorkspaceFilesystem(accountId: string, workspaceId: string, environment: WorkspaceFilesystemEnvironment = {}): Promise<WorkspaceFilesystem> {
  const database = await openFilesystemDatabase(accountId, environment);
  try {
    const sync = await database.getSyncState(workspaceId);
    const root = await getAccountOpfsRoot(accountId, environment.originRoot);
    const lockName = `${await filesystemDatabaseName(accountId)}-storage`;
    const locks = environment.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
    const now = environment.now ?? Date.now;
    const randomUUID = environment.randomUUID ?? (() => crypto.randomUUID());
    const locked = <T>(operation: () => Promise<T>) => {
      if (!locks) throw new Error("Web Locks are required for fresh filesystem mutations.");
      return locks.request(lockName, { mode: "exclusive" }, operation);
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

    return {
      createFolder: (value) => locked(async () => {
        const nodeId = randomUUID();
        const timestamp = now();
        await database.commitOperation({ operation: {
          schemaVersion: WEB2_SCHEMA_VERSION,
          kind: "create",
          operationId: randomUUID(),
          workspaceId,
          deviceId: sync.deviceId,
          nodes: [{ id: nodeId, kind: "folder", name: value.name, parentId: value.parentId ?? null, position: value.position ?? { x: 0, y: 0 }, createdAt: timestamp, modifiedAt: timestamp }],
        } });
        return (await database.getNode(nodeId))!;
      }),

      createFile: (value) => locked(async () => {
        if (!(value.content instanceof Blob)) throw new TypeError("File content must be a Blob.");
        const staged = await stageBlob(root, value.content);
        const nodeId = randomUUID();
        const timestamp = now();
        await database.commitOperation({
          operation: {
            schemaVersion: WEB2_SCHEMA_VERSION,
            kind: "create",
            operationId: randomUUID(),
            workspaceId,
            deviceId: sync.deviceId,
            nodes: [{ id: nodeId, kind: "file", name: value.name, parentId: value.parentId ?? null, position: value.position ?? { x: 0, y: 0 }, createdAt: timestamp, modifiedAt: timestamp, mimeType: value.mimeType ?? (value.content.type || "application/octet-stream"), size: staged.manifest.size, manifestHash: staged.manifestHash }],
          },
          manifests: [{ hash: staged.manifestHash, manifest: staged.manifest }],
        });
        return (await database.getNode(nodeId))!;
      }),

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

      undoWrite: (operationId) => locked(async () => {
        const target = await database.getOperation(operationId);
        if (!target || target.workspaceId !== workspaceId) throw new Error("That operation does not exist in this workspace.");
        if (target.operation.kind === "create") throw new Error("Create undo is unsupported until lifecycle projection exists.");
        if (target.operation.kind !== "write" || target.intent !== "forward" && target.intent !== "redo" && target.intent !== "restore" || target.inverse.kind !== "write") throw new Error("Only a write, redo, or restore can be undone.");
        const current = await fileNode(target.operation.nodeId);
        return commitVersion(target.operation.nodeId, target.inverse, current.fieldTuples.content!, "undo", target.operationId);
      }),

      redoWrite: (operationId) => locked(async () => {
        const target = await database.getOperation(operationId);
        if (!target || target.workspaceId !== workspaceId || target.intent !== "undo" || target.operation.kind !== "write" || target.inverse.kind !== "write") throw new Error("Only an undo can be redone.");
        const current = await fileNode(target.operation.nodeId);
        return commitVersion(target.operation.nodeId, target.inverse, current.fieldTuples.content!, "redo", target.operationId);
      }),

      restoreFileVersion: (nodeId, operationId) => locked(async () => {
        const versions = await database.listFileVersions(workspaceId, nodeId);
        const version = versions.find((candidate) => candidate.operationId === operationId);
        if (!version || version.current) throw new Error("That historical file version is no longer available.");
        const node = await fileNode(nodeId);
        return commitVersion(nodeId, version, node.fieldTuples.content!, "restore", operationId);
      }),

      removeOrphans: () => locked(async () => removeOrphanChunks(root, await database.listRetainedChunkHashes())),
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

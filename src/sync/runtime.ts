import { readChunk } from "../filesystem/chunks";
import { WEB2_MAX_BATCH_ITEMS, WEB2_SCHEMA_VERSION, parseStableId, type SettingNamespace } from "../filesystem/model";
import type { FilesystemDatabase, StoredOperation } from "../filesystem/database";
import type { HydrationTarget } from "../filesystem/hydration";
import type { WorkspaceOperation } from "../filesystem/operations";
import type { AccountSyncCallbacks } from "./engine";
import type { HydrationCoordinator } from "./hydration";
import {
  WEB2_SYNC_PROTOCOL,
  type BootstrapRequest,
  type ChunkUploadRequest,
  type HydrationRequest,
  type PullRequest,
  type PushRequest,
} from "./protocol";
import {
  Web2HTTPError,
  Web2NetworkError,
  bootstrapWeb2,
  hydrateWeb2,
  listenForWeb2Events,
  negotiateWeb2ChunkUpload,
  pullWeb2,
  pushWeb2,
  uploadWeb2Chunk,
} from "./transport";

const supportedPushKinds = new Set<WorkspaceOperation["kind"]>(["write", "position", "set", "set-many", "unset", "unset-many"]);

type RuntimeTransport = {
  bootstrap(request: BootstrapRequest, signal: AbortSignal): ReturnType<typeof bootstrapWeb2>;
  hydrate(request: HydrationRequest, signal: AbortSignal): ReturnType<typeof hydrateWeb2>;
  pull(request: PullRequest, signal: AbortSignal): ReturnType<typeof pullWeb2>;
  push(request: PushRequest, signal: AbortSignal): ReturnType<typeof pushWeb2>;
  negotiateUpload(request: ChunkUploadRequest, origin: string, signal: AbortSignal): ReturnType<typeof negotiateWeb2ChunkUpload>;
  readLocalChunk: typeof readChunk;
  uploadChunk: typeof uploadWeb2Chunk;
  listen(signal: AbortSignal, receive: Parameters<typeof listenForWeb2Events>[1]): ReturnType<typeof listenForWeb2Events>;
};

const nativeTransport: RuntimeTransport = {
  bootstrap: bootstrapWeb2,
  hydrate: hydrateWeb2,
  pull: pullWeb2,
  push: pushWeb2,
  negotiateUpload: negotiateWeb2ChunkUpload,
  readLocalChunk: readChunk,
  uploadChunk: uploadWeb2Chunk,
  listen: listenForWeb2Events,
};

export type Web2SyncRuntime = {
  bootstrap(workspaceId: string, signal?: AbortSignal): Promise<void>;
  callbacks: AccountSyncCallbacks;
};

export type Web2SyncRuntimeOptions = {
  accountId: string;
  directBlobOrigin: string;
  database: Pick<FilesystemDatabase, "completeRejectedDiscards" | "getManifest" | "getOrCreateDeviceId" | "getSyncState" | "getWorkspaceBootstrapState" | "listUnsettledOperations" | "listWorkspaces" | "recordPushRejections">;
  hydration: Pick<HydrationCoordinator, "applyPull" | "bootstrap" | "hydrate">;
  opfsRoot: FileSystemDirectoryHandle;
  transport?: RuntimeTransport;
  randomUUID?: () => string;
  retryDelayMs?: number;
};

function retryable(error: unknown) {
  return error instanceof Web2NetworkError || error instanceof Web2HTTPError && (error.status === 408 || error.status === 429 || error.status >= 500);
}

function wait(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function operationTreeNodeIds(stored: StoredOperation) {
  const { operation, inverse } = stored;
  if (operation.kind === "transfer" && inverse.kind === "transfer") return inverse.nodes.map(({ nodeId }) => nodeId);
  if (operation.kind === "trash" && inverse.kind === "trash") return inverse.nodeIds;
  if (operation.kind === "restore" && inverse.kind === "restore") return inverse.nodes.map(({ nodeId }) => nodeId);
  if (operation.kind === "purge" && inverse.kind === "purge") return inverse.nodeIds;
  if (operation.kind === "create" || operation.kind === "copy") return operation.nodes.map(({ id }) => id);
  return "nodeIds" in operation ? operation.nodeIds : [];
}

function operationBlockKeys(stored: StoredOperation) {
  const { operation } = stored;
  const field = (workspaceId: string, nodeId: string, name: string) => `node:${workspaceId}:${nodeId}:${name}`;
  switch (operation.kind) {
    case "create":
    case "copy": return operationTreeNodeIds(stored).map((id) => field(operation.workspaceId, id, "existence"));
    case "write": return [field(operation.workspaceId, operation.nodeId, "content")];
    case "rename": return [field(operation.workspaceId, operation.nodeId, "name")];
    case "move":
      return operation.nodeIds.map((nodeId) => field(operation.workspaceId, nodeId, "parent"));
    case "transfer": return operationTreeNodeIds(stored).flatMap((nodeId) => [field(operation.workspaceId, nodeId, "existence"), field(operation.destinationWorkspaceId, nodeId, "existence")]);
    case "trash":
    case "restore": return operationTreeNodeIds(stored).map((nodeId) => field(operation.workspaceId, nodeId, "lifecycle"));
    case "purge": return operationTreeNodeIds(stored).map((nodeId) => field(operation.workspaceId, nodeId, "existence"));
    case "position": return operation.positions.map(({ nodeId }) => field(operation.workspaceId, nodeId, "position"));
    case "set":
    case "unset": return [`setting:${operation.workspaceId}:${operation.namespace}:${operation.key}`];
    case "set-many": return operation.settings.map(({ key }) => `setting:${operation.workspaceId}:${operation.namespace}:${key}`);
    case "unset-many": return operation.keys.map((key) => `setting:${operation.workspaceId}:${operation.namespace}:${key}`);
  }
}

function operationRequiredKeys(stored: StoredOperation) {
  const { operation } = stored;
  const existence = (workspaceId: string, nodeId: string) => `node:${workspaceId}:${nodeId}:existence`;
  const requirements = operationBlockKeys(stored);
  switch (operation.kind) {
    case "write":
    case "rename": return [...requirements, existence(operation.workspaceId, operation.nodeId)];
    case "move":
    case "trash":
    case "restore":
    case "purge": return [...requirements, ...operationTreeNodeIds(stored).map((nodeId) => existence(operation.workspaceId, nodeId))];
    case "position": return [...requirements, ...operation.positions.map(({ nodeId }) => existence(operation.workspaceId, nodeId))];
    case "transfer": return [...requirements, ...operationTreeNodeIds(stored).flatMap((nodeId) => [existence(operation.workspaceId, nodeId), existence(operation.destinationWorkspaceId, nodeId)])];
    default: return requirements;
  }
}

function selectReplayableOperations(unsettled: StoredOperation[], externalBlockers: Iterable<string> = []) {
  const blockers = new Map<string, Set<string>>();
  for (const key of externalBlockers) blockers.set(key, new Set(["cross-workspace-transfer"]));
  const operations: WorkspaceOperation[] = [];
  const block = (stored: StoredOperation, keys: string[]) => keys.forEach((key) => {
    const operations = blockers.get(key) ?? new Set<string>();
    operations.add(stored.operationId);
    blockers.set(key, operations);
  });
  for (const stored of unsettled) {
    const keys = operationBlockKeys(stored);
    if (stored.stateKind === "rejected") {
      if (stored.overlayKind === "active") block(stored, keys);
      continue;
    }
    if (!supportedPushKinds.has(stored.operation.kind)) {
      block(stored, keys);
      continue;
    }
    const blockedBy = new Set(operationRequiredKeys(stored).flatMap((key) => [...(blockers.get(key) ?? [])]));
    if (blockedBy.size > 0 && (stored.compensatesOperationId === null || [...blockedBy].some((operationId) => operationId !== stored.compensatesOperationId))) {
      block(stored, keys);
      continue;
    }
    if (stored.compensatesOperationId !== null) for (const key of keys) {
      blockers.get(key)?.delete(stored.compensatesOperationId);
      if (blockers.get(key)?.size === 0) blockers.delete(key);
    }
    operations.push(stored.operation);
  }
  return operations;
}

export function createWeb2SyncRuntime(options: Web2SyncRuntimeOptions): Web2SyncRuntime {
  const accountId = parseStableId(options.accountId, "The synchronization account ID is invalid.");
  if (!options.directBlobOrigin) throw new Error("Web2 synchronization requires direct chunk storage.");
  const transport = options.transport ?? nativeTransport;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const retryDelayMs = options.retryDelayMs ?? 500;
  const boundWorkspaces = new Set<string>();
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) throw new Error("The synchronization retry delay is invalid.");

  const requestHydration = (request: HydrationRequest, signal: AbortSignal) => transport.hydrate(request, signal);
  const uploadWriteChunks = async (operation: Extract<WorkspaceOperation, { kind: "write" }>, signal: AbortSignal) => {
    const manifest = await options.database.getManifest(operation.manifestHash);
    if (!manifest || manifest.size !== operation.size) throw new Error("A pending write references a missing manifest.");
    const request: ChunkUploadRequest = {
      schemaVersion: WEB2_SCHEMA_VERSION,
      protocol: WEB2_SYNC_PROTOCOL,
      kind: "chunk-upload-request",
      workspaceId: operation.workspaceId,
      deviceId: operation.deviceId,
      operationId: operation.operationId,
      manifestHash: operation.manifestHash,
      manifest,
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await transport.negotiateUpload(request, options.directBlobOrigin, signal);
      if (result.missingChunks.length === 0) return;
      let expired = false;
      for (const descriptor of result.missingChunks) {
        const content = await transport.readLocalChunk(options.opfsRoot, descriptor);
        try {
          await transport.uploadChunk(descriptor, new Uint8Array(await content.arrayBuffer()), signal);
        } catch (error) {
          if (error instanceof Web2HTTPError && error.status === 403) { expired = true; break; }
          throw error;
        }
      }
      if (expired) continue;
    }
    throw new Web2NetworkError();
  };

  const pullToHead = async (workspaceId: string, signal: AbortSignal) => {
    let sync = await options.database.getSyncState(workspaceId);
    // ponytail: 1024 data pages plus one final durable cursor acknowledgment.
    for (let page = 0; page < 1025; page++) {
      const result = await transport.pull({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, workspaceId, deviceId: sync.deviceId, cursor: sync.cursor }, signal);
      await options.hydration.applyPull(result, requestHydration, { signal });
      if (result.cursor === result.headSequence && result.fromCursor === result.cursor) return;
      if (result.kind === "operations" && result.cursor <= sync.cursor) throw new Error("Synchronization pull did not advance its cursor.");
      sync = await options.database.getSyncState(workspaceId);
    }
    throw new Error("Synchronization pull exceeded its page limit.");
  };

  const scanUnsettled = async (workspaceId: string) => {
    const unsettled: StoredOperation[] = [];
    let afterRevision = 0;
    // ponytail: scan at most the accepted 10k outbox ceiling; dependency keys stay bounded by that durable input.
    for (let page = 0; page < 40; page++) {
      const records = await options.database.listUnsettledOperations(workspaceId, afterRevision, WEB2_MAX_BATCH_ITEMS);
      unsettled.push(...records);
      if (records.length < WEB2_MAX_BATCH_ITEMS) break;
      afterRevision = records.at(-1)!.localRevision;
    }
    return unsettled;
  };

  const destinationTransferBlockers = async (workspaceId: string) => {
    const blocked = new Set<string>();
    for (const source of await options.database.listWorkspaces()) for (const stored of await scanUnsettled(source.id)) {
      const operation = stored.operation;
      if (stored.overlayKind === "active" && operation.kind === "transfer" && operation.destinationWorkspaceId === workspaceId) {
        operationTreeNodeIds(stored).forEach((nodeId) => blocked.add(`node:${workspaceId}:${nodeId}:existence`));
      }
    }
    return blocked;
  };

  const selectOutboxBatch = async (workspaceId: string) => {
    return selectReplayableOperations(await scanUnsettled(workspaceId), await destinationTransferBlockers(workspaceId)).slice(0, WEB2_MAX_BATCH_ITEMS);
  };

  const repairDeferredRejections = async (workspaceId: string, signal: AbortSignal) => {
    const deferred = (await scanUnsettled(workspaceId)).filter((stored) => stored.stateKind === "rejected" && stored.overlayKind === "deferred");
    if (deferred.length === 0) return;
    const workspaces = new Map((await options.database.listWorkspaces()).map((workspace) => [workspace.id, workspace]));
    const nodes = new Map<string, Set<string>>();
    const settings = new Map<string, { workspaceId: string; namespace: SettingNamespace; keys: Set<string> }>();
    const addNode = (targetWorkspaceId: string, nodeId: string) => {
      const ids = nodes.get(targetWorkspaceId) ?? new Set<string>();
      ids.add(nodeId);
      nodes.set(targetWorkspaceId, ids);
    };
    for (const stored of deferred) {
      const { operation } = stored;
      switch (operation.kind) {
        case "create":
        case "copy": operation.nodes.forEach(({ id }) => addNode(operation.workspaceId, id)); break;
        case "write":
        case "rename": addNode(operation.workspaceId, operation.nodeId); break;
        case "move":
        case "trash":
        case "restore":
        case "purge": operationTreeNodeIds(stored).forEach((nodeId) => addNode(operation.workspaceId, nodeId)); break;
        case "position": operation.positions.forEach(({ nodeId }) => addNode(operation.workspaceId, nodeId)); break;
        case "transfer": operationTreeNodeIds(stored).forEach((nodeId) => { addNode(operation.workspaceId, nodeId); addNode(operation.destinationWorkspaceId, nodeId); }); break;
        case "set":
        case "unset": {
          const id = `${operation.workspaceId}\0${operation.namespace}`;
          const group = settings.get(id) ?? { workspaceId: operation.workspaceId, namespace: operation.namespace, keys: new Set<string>() };
          group.keys.add(operation.key);
          settings.set(id, group);
          break;
        }
        case "set-many":
        case "unset-many": {
          const id = `${operation.workspaceId}\0${operation.namespace}`;
          const group = settings.get(id) ?? { workspaceId: operation.workspaceId, namespace: operation.namespace, keys: new Set<string>() };
          const keys = operation.kind === "set-many" ? operation.settings.map(({ key }) => key) : operation.keys;
          keys.forEach((key) => group.keys.add(key));
          settings.set(id, group);
          break;
        }
      }
    }
    const targets: HydrationTarget[] = [];
    for (const [targetWorkspaceId, ids] of nodes) {
      const workspace = workspaces.get(targetWorkspaceId);
      if (!workspace) throw new Error("A rejected operation references an unavailable workspace.");
      const sorted = [...ids].sort();
      for (let index = 0; index < sorted.length; index += WEB2_MAX_BATCH_ITEMS) targets.push({ kind: "exact-nodes", workspaceId: targetWorkspaceId, asOf: workspace.headSequence, nodeIds: sorted.slice(index, index + WEB2_MAX_BATCH_ITEMS) });
    }
    for (const { workspaceId: targetWorkspaceId, namespace, keys } of settings.values()) {
      const workspace = workspaces.get(targetWorkspaceId);
      if (!workspace) throw new Error("A rejected operation references an unavailable workspace.");
      const sorted = [...keys].sort();
      for (let index = 0; index < sorted.length; index += WEB2_MAX_BATCH_ITEMS) targets.push({ kind: "exact-settings", workspaceId: targetWorkspaceId, asOf: workspace.headSequence, namespace, keys: sorted.slice(index, index + WEB2_MAX_BATCH_ITEMS) });
    }
    for (const target of targets) await options.hydration.hydrate(target, requestHydration, { signal });
    const operationIds = deferred.map(({ operationId }) => operationId);
    for (let index = 0; index < operationIds.length; index += WEB2_MAX_BATCH_ITEMS) await options.database.completeRejectedDiscards(operationIds.slice(index, index + WEB2_MAX_BATCH_ITEMS));
  };

  const synchronizeWorkspace = async (workspaceId: string, signal: AbortSignal) => {
    await pullToHead(workspaceId, signal);
    await repairDeferredRejections(workspaceId, signal);
    for (let batch = 0; batch < 40; batch++) {
      const sync = await options.database.getSyncState(workspaceId);
      const operations = await selectOutboxBatch(workspaceId);
      if (operations.length === 0) return;
      for (const operation of operations) if (operation.kind === "write") await uploadWriteChunks(operation, signal);
      const result = await transport.push({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, workspaceId, deviceId: sync.deviceId, operations }, signal);
      const rejected = result.results.filter((candidate) => candidate.kind === "rejected");
      if (rejected.length > 0) await options.database.recordPushRejections(rejected.map(({ operationId, workspaceId, code, message }) => ({ operationId, workspaceId, code, message })));
      await pullToHead(workspaceId, signal);
    }
    if ((await selectOutboxBatch(workspaceId)).length === 0) return;
    throw new Error("Synchronization outbox exceeded its batch limit.");
  };

  const synchronizeOnce = async (signal: AbortSignal) => {
    for (const workspace of await options.database.listWorkspaces()) {
      signal.throwIfAborted();
      if (!boundWorkspaces.has(workspace.id)) continue;
      await synchronizeWorkspace(workspace.id, signal);
    }
  };

  return {
    bootstrap: async (workspaceIdValue, suppliedSignal) => {
      const workspaceId = parseStableId(workspaceIdValue, "The bootstrap workspace ID is invalid.");
      const signal = suppliedSignal ?? new AbortController().signal;
      const bootstrap = await options.database.getWorkspaceBootstrapState(workspaceId);
      if (bootstrap) {
        if (bootstrap.staged) await options.hydration.hydrate(bootstrap.target, requestHydration, { signal });
        boundWorkspaces.add(workspaceId);
        await pullToHead(workspaceId, signal);
        return;
      }
      const deviceId = await options.database.getOrCreateDeviceId();
      const request: BootstrapRequest = { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, workspaceId, deviceId, generationId: randomUUID(), rootLimit: WEB2_MAX_BATCH_ITEMS };
      const result = await transport.bootstrap(request, signal);
      await options.hydration.bootstrap(result, { signal });
      await options.hydration.hydrate(result.rootPage.target, requestHydration, { signal });
      boundWorkspaces.add(workspaceId);
    },
    callbacks: {
      synchronize: async (signal) => {
        let delay = retryDelayMs;
        while (!signal.aborted) {
          try {
            await synchronizeOnce(signal);
            return;
          } catch (error) {
            if (!retryable(error)) throw error;
            await wait(delay, signal);
            delay = Math.min(Math.max(delay * 2, 1), 30_000);
          }
        }
      },
      listen: (signal, wake) => transport.listen(signal, (event) => {
        if (event.accountId === accountId) wake();
      }),
    },
  };
}

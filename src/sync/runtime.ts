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
  type PulledOperation,
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

/** Lists operation kinds supported for synchronization push. */
const supportedPushKinds = new Set<WorkspaceOperation["kind"]>(["create", "write", "copy", "rename", "move", "position", "transfer", "trash", "restore", "purge", "set", "set-many", "unset", "unset-many"]);
/** Lists push operations that change filesystem structure. */
const structuralPushKinds = new Set<WorkspaceOperation["kind"]>(["create", "copy", "move", "transfer", "trash", "restore", "purge"]);

export type Web2SyncRuntimeTransport = {
  bootstrap(request: BootstrapRequest, signal: AbortSignal): ReturnType<typeof bootstrapWeb2>;
  hydrate(request: HydrationRequest, signal: AbortSignal): ReturnType<typeof hydrateWeb2>;
  pull(request: PullRequest, signal: AbortSignal): ReturnType<typeof pullWeb2>;
  push(request: PushRequest, signal: AbortSignal): ReturnType<typeof pushWeb2>;
  negotiateUpload(request: ChunkUploadRequest, origin: string, signal: AbortSignal): ReturnType<typeof negotiateWeb2ChunkUpload>;
  readLocalChunk: typeof readChunk;
  uploadChunk: typeof uploadWeb2Chunk;
  listen(signal: AbortSignal, receive: Parameters<typeof listenForWeb2Events>[1], directoryRevision?: number, activity?: () => void): ReturnType<typeof listenForWeb2Events>;
};

/** Provides the browser's native synchronization transport. */
const nativeTransport: Web2SyncRuntimeTransport = {
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
  hydrate(target: HydrationTarget, signal?: AbortSignal): Promise<void>;
  callbacks: AccountSyncCallbacks;
};

export type Web2SyncRuntimeOptions = {
  accountId: string;
  directBlobOrigin: string;
  database: Pick<FilesystemDatabase, "completeRejectedDiscards" | "getManifest" | "getOrCreateDeviceId" | "getSyncState" | "getWorkspaceBootstrapState" | "listUnsettledOperations" | "listWorkspaces" | "recordPushRejections">;
  hydration: Pick<HydrationCoordinator, "applyPull" | "bootstrap" | "hydrate">;
  opfsRoot: FileSystemDirectoryHandle;
  transport?: Web2SyncRuntimeTransport;
  randomUUID?: () => string;
  retryDelayMs?: number;
  directoryRevision?: number;
  onDirectoryChange?: (revision: number) => void;
  onAccountAppsChange?: (revision: number) => void;
};

/** Determines whether a synchronization failure can be retried. */
function retryable(error: unknown) {
  return error instanceof Web2NetworkError || error instanceof Web2HTTPError && (error.code === "upload-incomplete" || error.status === 408 || error.status === 429 || error.status >= 500);
}

/** Waits for an abortable delay. */
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

/** Returns node IDs covered by an operation's tree. */
function operationTreeNodeIds(stored: StoredOperation) {
  const { operation, inverse } = stored;
  if (operation.kind === "transfer" && inverse.kind === "transfer") return inverse.nodes.map(({ nodeId }) => nodeId);
  if (operation.kind === "trash" && inverse.kind === "trash") return inverse.nodeIds;
  if (operation.kind === "restore" && inverse.kind === "restore") return inverse.nodes.map(({ nodeId }) => nodeId);
  if (operation.kind === "purge" && inverse.kind === "purge") return inverse.nodeIds;
  if (operation.kind === "create" || operation.kind === "copy") return operation.nodes.map(({ id }) => id);
  return "nodeIds" in operation ? operation.nodeIds : [];
}

/** Returns dependency keys blocked by an operation. */
function operationBlockKeys(stored: StoredOperation) {
  const { operation } = stored;
  const field = (workspaceId: string, nodeId: string, name: string) => `node:${workspaceId}:${nodeId}:${name}`;
  switch (operation.kind) {
    case "create":
    case "copy": return [`structure:${operation.workspaceId}`, ...operationTreeNodeIds(stored).map((id) => field(operation.workspaceId, id, "existence"))];
    case "write": return [field(operation.workspaceId, operation.nodeId, "content")];
    case "rename": return [field(operation.workspaceId, operation.nodeId, "name")];
    case "move":
      return [`structure:${operation.workspaceId}`, ...operation.nodeIds.map((nodeId) => field(operation.workspaceId, nodeId, "parent"))];
    case "transfer": return [`structure:${operation.workspaceId}`, `structure:${operation.destinationWorkspaceId}`, ...operationTreeNodeIds(stored).flatMap((nodeId) => [field(operation.workspaceId, nodeId, "existence"), field(operation.destinationWorkspaceId, nodeId, "existence")])];
    case "trash":
    case "restore": return [`structure:${operation.workspaceId}`, ...operationTreeNodeIds(stored).map((nodeId) => field(operation.workspaceId, nodeId, "lifecycle"))];
    case "purge": return [`structure:${operation.workspaceId}`, ...operationTreeNodeIds(stored).map((nodeId) => field(operation.workspaceId, nodeId, "existence"))];
    case "position": return operation.positions.map(({ nodeId }) => field(operation.workspaceId, nodeId, "position"));
    case "set":
    case "unset": return [`setting:${operation.workspaceId}:${operation.namespace}:${operation.key}`];
    case "set-many": return operation.settings.map(({ key }) => `setting:${operation.workspaceId}:${operation.namespace}:${key}`);
    case "unset-many": return operation.keys.map((key) => `setting:${operation.workspaceId}:${operation.namespace}:${key}`);
  }
}

/** Returns dependency keys required by an operation. */
function operationRequiredKeys(stored: StoredOperation) {
  const { operation } = stored;
  const existence = (workspaceId: string, nodeId: string) => `node:${workspaceId}:${nodeId}:existence`;
  const parent = (workspaceId: string, nodeId: string) => [existence(workspaceId, nodeId), `node:${workspaceId}:${nodeId}:lifecycle`];
  const requirements = operationBlockKeys(stored);
  switch (operation.kind) {
    case "create":
    case "copy": {
      const created = new Set(operation.nodes.map(({ id }) => id));
      return [...requirements, ...operation.nodes.flatMap(({ parentId }) => parentId !== null && !created.has(parentId) ? parent(operation.workspaceId, parentId) : [])];
    }
    case "write":
    case "rename": return [...requirements, existence(operation.workspaceId, operation.nodeId)];
    case "move": return [...requirements, ...operationTreeNodeIds(stored).flatMap((nodeId) => [existence(operation.workspaceId, nodeId), `node:${operation.workspaceId}:${nodeId}:lifecycle`]), ...(operation.parentId === null ? [] : parent(operation.workspaceId, operation.parentId))];
    case "trash":
    case "purge": return [...requirements, ...operationTreeNodeIds(stored).flatMap((nodeId) => [existence(operation.workspaceId, nodeId), `node:${operation.workspaceId}:${nodeId}:lifecycle`])];
    case "restore": {
      const originalParents = operation.destination === "original" && stored.inverse.kind === "restore"
        ? stored.inverse.nodes.flatMap(({ lifecycle }) => lifecycle.originalParentId === null ? [] : parent(operation.workspaceId, lifecycle.originalParentId))
        : [];
      return [...requirements, ...operationTreeNodeIds(stored).flatMap((nodeId) => [existence(operation.workspaceId, nodeId), `node:${operation.workspaceId}:${nodeId}:lifecycle`]), ...originalParents];
    }
    case "position": return [...requirements, ...operation.positions.map(({ nodeId }) => existence(operation.workspaceId, nodeId))];
    case "transfer": return [...requirements, ...operationTreeNodeIds(stored).flatMap((nodeId) => [existence(operation.workspaceId, nodeId), `node:${operation.workspaceId}:${nodeId}:lifecycle`, existence(operation.destinationWorkspaceId, nodeId)]), ...(operation.parentId === null ? [] : parent(operation.destinationWorkspaceId, operation.parentId))];
    default: return requirements;
  }
}

/** Selects replayable operations. */
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
    if (structuralPushKinds.has(stored.operation.kind)) break;
  }
  return operations;
}

/** Creates the Web2 synchronization runtime. */
export function createWeb2SyncRuntime(options: Web2SyncRuntimeOptions): Web2SyncRuntime {
  const accountId = parseStableId(options.accountId, "The synchronization account ID is invalid.");
  if (!options.directBlobOrigin) throw new Error("Web2 synchronization requires direct chunk storage.");
  const transport = options.transport ?? nativeTransport;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const retryDelayMs = options.retryDelayMs ?? 500;
  const boundWorkspaces = new Set<string>();
  const activePulls = new Map<string, Promise<void>>();
  const pulledHeads = new Map<string, number>();
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) throw new Error("The synchronization retry delay is invalid.");

  const requestHydration = (request: HydrationRequest, signal: AbortSignal) => transport.hydrate(request, signal);
  const uploadOperationChunks = async (operation: WorkspaceOperation, signal: AbortSignal) => {
    const references = new Map<string, number>();
    const add = (manifestHash: string, size: number) => {
      const prior = references.get(manifestHash);
      if (prior !== undefined && prior !== size) throw new Error("A pending operation references one manifest with inconsistent sizes.");
      references.set(manifestHash, size);
    };
    if (operation.kind === "write") add(operation.manifestHash, operation.size);
    if (operation.kind === "create" || operation.kind === "copy") for (const node of operation.nodes) if (node.kind === "file") add(node.manifestHash, node.size);
    for (const [manifestHash, size] of [...references].sort(([left], [right]) => left.localeCompare(right))) {
      const manifest = await options.database.getManifest(manifestHash);
      if (!manifest || manifest.size !== size) throw new Error("A pending operation references a missing manifest.");
      const request: ChunkUploadRequest = {
        schemaVersion: WEB2_SCHEMA_VERSION,
        protocol: WEB2_SYNC_PROTOCOL,
        kind: "chunk-upload-request",
        workspaceId: operation.workspaceId,
        deviceId: operation.deviceId,
        operationId: operation.operationId,
        manifestHash,
        manifest,
      };
      let complete = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await transport.negotiateUpload(request, options.directBlobOrigin, signal);
        if (result.missingChunks.length === 0) { complete = true; break; }
        let expired = false;
        for (const descriptor of result.missingChunks) {
          const content = await transport.readLocalChunk(options.opfsRoot, { hash: descriptor.hash, size: descriptor.size });
          try {
            await transport.uploadChunk(descriptor, new Uint8Array(await content.arrayBuffer()), signal);
          } catch (error) {
            if (error instanceof Web2HTTPError && error.status === 403) { expired = true; break; }
            throw error;
          }
        }
        if (expired) continue;
        complete = true;
        break;
      }
      if (!complete) throw new Web2NetworkError();
    }
  };

  const repairPendingTransferCoverage = async (workspaceId: string, pulled: PulledOperation, signal: AbortSignal) => {
    const changedNodeIds = new Set(pulled.nodes.map(({ id }) => id));
    if (changedNodeIds.size === 0) return false;
    let repaired = false;
    for (const workspace of await options.database.listWorkspaces()) for (const stored of await scanUnsettled(workspace.id)) {
      const operation = stored.operation;
      if (stored.stateKind !== "pending" || stored.overlayKind !== "active" || operation.kind !== "transfer" || operation.workspaceId !== workspaceId && operation.destinationWorkspaceId !== workspaceId) continue;
      const nodeIds = operationTreeNodeIds(stored);
      if (!nodeIds.some((nodeId) => changedNodeIds.has(nodeId))) continue;
      const destinationSync = await options.database.getSyncState(operation.destinationWorkspaceId);
      const sourceSync = await options.database.getSyncState(operation.workspaceId);
      await options.hydration.hydrate({ kind: "exact-nodes", workspaceId: operation.destinationWorkspaceId, asOf: Math.max(destinationSync.cursor, destinationSync.lastHydrationAsOf, operation.destinationWorkspaceId === workspaceId ? pulled.sequence : 0), nodeIds }, requestHydration, { signal });
      await options.hydration.hydrate({ kind: "exact-nodes", workspaceId: operation.workspaceId, asOf: Math.max(sourceSync.cursor, sourceSync.lastHydrationAsOf, operation.workspaceId === workspaceId ? pulled.sequence : 0), nodeIds }, requestHydration, { signal });
      repaired = true;
    }
    return repaired;
  };

  const pullWorkspaceThrough = async (workspaceId: string, targetCursor: number | null, signal: AbortSignal) => {
    // ponytail: 1024 data pages; the next real pull acknowledges the final cursor.
    for (let page = 0; page < 1024; page++) {
      let sync = await options.database.getSyncState(workspaceId);
      if (targetCursor !== null && sync.cursor >= targetCursor) return;
      const startingCursor = sync.cursor;
      const result = await transport.pull({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, workspaceId, deviceId: sync.deviceId, cursor: sync.cursor }, signal);
      if (result.kind === "reset") {
        await options.hydration.applyPull(result, requestHydration, { signal });
      } else if (result.operations.length === 0) {
        await options.hydration.applyPull(result, requestHydration, { signal });
        if (result.cursor === result.headSequence && result.fromCursor === result.cursor) return;
      } else {
        for (const operation of result.operations) {
          if (targetCursor !== null && operation.sequence > targetCursor) break;
          sync = await options.database.getSyncState(workspaceId);
          if (sync.cursor >= operation.sequence) continue;
          if (sync.cursor !== operation.sequence - 1) throw new Error("Synchronization pull is not contiguous.");
          if (operation.companion !== null) {
            await pullWorkspaceThrough(operation.companion.workspaceId, operation.companion.sequence - 1, signal);
            sync = await options.database.getSyncState(workspaceId);
            if (sync.cursor >= operation.sequence) continue;
          }
          const page = { ...result, fromCursor: sync.cursor, cursor: operation.sequence, operations: [operation] };
          try {
            await options.hydration.applyPull(page, requestHydration, { signal });
          } catch (error) {
            if (!(error instanceof Error) || !error.message.includes("complete coverage to merge a pending transfer") || !await repairPendingTransferCoverage(workspaceId, operation, signal)) throw error;
            await options.hydration.applyPull(page, requestHydration, { signal });
          }
          if (operation.companion !== null) await pullWorkspaceThrough(operation.companion.workspaceId, null, signal);
        }
      }
      const advanced = await options.database.getSyncState(workspaceId);
      if (targetCursor !== null && advanced.cursor >= targetCursor) return;
      if (targetCursor === null && advanced.cursor === result.cursor && result.cursor === result.headSequence) return;
      if (advanced.cursor <= startingCursor && !(result.kind === "operations" && result.fromCursor === result.cursor && result.cursor === result.headSequence)) throw new Error("Synchronization pull did not advance its cursor.");
    }
    throw new Error("Synchronization pull exceeded its page limit.");
  };
  const pullToHead = (workspaceId: string, signal: AbortSignal) => {
    const active = activePulls.get(workspaceId);
    if (active) return active;
    const pull = (async () => {
      const sync = await options.database.getSyncState(workspaceId);
      if (pulledHeads.get(workspaceId) === sync.cursor) return;
      await pullWorkspaceThrough(workspaceId, null, signal);
      pulledHeads.set(workspaceId, (await options.database.getSyncState(workspaceId)).cursor);
    })().finally(() => {
      if (activePulls.get(workspaceId) === pull) activePulls.delete(workspaceId);
    });
    activePulls.set(workspaceId, pull);
    return pull;
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

  const transferPrerequisiteBlockers = async (workspaceId: string) => {
    const blocked = new Set<string>();
    for (const stored of await scanUnsettled(workspaceId)) {
      const operation = stored.operation;
      if (stored.stateKind !== "pending" || stored.overlayKind !== "active" || operation.kind !== "transfer" || operation.parentId === null) continue;
      const parentKeys = new Set([`node:${operation.destinationWorkspaceId}:${operation.parentId}:existence`, `node:${operation.destinationWorkspaceId}:${operation.parentId}:lifecycle`]);
      for (const destination of await scanUnsettled(operation.destinationWorkspaceId)) {
        if (destination.overlayKind === "active") operationBlockKeys(destination).forEach((key) => { if (parentKeys.has(key)) blocked.add(key); });
      }
    }
    return blocked;
  };

  const selectOutboxBatch = async (workspaceId: string) => {
    const blockers = new Set([...await destinationTransferBlockers(workspaceId), ...await transferPrerequisiteBlockers(workspaceId)]);
    return selectReplayableOperations(await scanUnsettled(workspaceId), blockers).slice(0, WEB2_MAX_BATCH_ITEMS);
  };

  const repairDeferredRejections = async (workspaceId: string, signal: AbortSignal) => {
    const deferred = (await scanUnsettled(workspaceId)).filter((stored) => stored.stateKind === "rejected" && stored.overlayKind === "deferred");
    if (deferred.length === 0) return;
    const workspaces = new Map((await options.database.listWorkspaces()).map((workspace) => [workspace.id, workspace]));
    for (const stored of deferred) {
      const targets: HydrationTarget[] = [];
      const addNodes = (targetWorkspaceId: string, nodeIds: string[]) => {
        const workspace = workspaces.get(targetWorkspaceId);
        if (!workspace) throw new Error("A rejected operation references an unavailable workspace.");
        const sorted = [...new Set(nodeIds)].sort();
        for (let index = 0; index < sorted.length; index += WEB2_MAX_BATCH_ITEMS) targets.push({ kind: "exact-nodes", workspaceId: targetWorkspaceId, asOf: workspace.headSequence, nodeIds: sorted.slice(index, index + WEB2_MAX_BATCH_ITEMS) });
      };
      const addSettings = (targetWorkspaceId: string, namespace: SettingNamespace, keys: string[]) => {
        const workspace = workspaces.get(targetWorkspaceId);
        if (!workspace) throw new Error("A rejected operation references an unavailable workspace.");
        const sorted = [...new Set(keys)].sort();
        for (let index = 0; index < sorted.length; index += WEB2_MAX_BATCH_ITEMS) targets.push({ kind: "exact-settings", workspaceId: targetWorkspaceId, asOf: workspace.headSequence, namespace, keys: sorted.slice(index, index + WEB2_MAX_BATCH_ITEMS) });
      };
      const { operation } = stored;
      switch (operation.kind) {
        case "create":
        case "copy": addNodes(operation.workspaceId, operation.nodes.map(({ id }) => id)); break;
        case "write":
        case "rename": addNodes(operation.workspaceId, [operation.nodeId]); break;
        case "move":
        case "trash":
        case "restore":
        case "purge": addNodes(operation.workspaceId, operationTreeNodeIds(stored)); break;
        case "position": addNodes(operation.workspaceId, operation.positions.map(({ nodeId }) => nodeId)); break;
        case "transfer": {
          const nodeIds = operationTreeNodeIds(stored);
          addNodes(operation.destinationWorkspaceId, nodeIds);
          addNodes(operation.workspaceId, nodeIds);
          break;
        }
        case "set":
        case "unset": addSettings(operation.workspaceId, operation.namespace, [operation.key]); break;
        case "set-many": addSettings(operation.workspaceId, operation.namespace, operation.settings.map(({ key }) => key)); break;
        case "unset-many": addSettings(operation.workspaceId, operation.namespace, operation.keys); break;
      }
      for (const target of targets) await options.hydration.hydrate(target, requestHydration, { signal });
      await options.database.completeRejectedDiscards([stored.operationId]);
    }
  };

  const synchronizeWorkspace = async (workspaceId: string, signal: AbortSignal) => {
    await pullToHead(workspaceId, signal);
    await repairDeferredRejections(workspaceId, signal);
    for (let batch = 0; batch < 40;) {
      const sync = await options.database.getSyncState(workspaceId);
      const operations = await selectOutboxBatch(workspaceId);
      if (operations.length === 0) return;
      for (const operation of operations) await uploadOperationChunks(operation, signal);
      const request = { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, workspaceId, deviceId: sync.deviceId, baseCursor: sync.cursor, operations } as const;
      let result;
      try {
        result = await (async () => {
          let delay = retryDelayMs;
          while (true) {
            try { return await transport.push(request, signal); }
            catch (error) {
              if (!retryable(error)) throw error;
              if (error instanceof Web2HTTPError && error.code === "upload-incomplete") for (const operation of operations) await uploadOperationChunks(operation, signal);
              await wait(delay, signal);
              signal.throwIfAborted();
              delay = Math.min(Math.max(delay * 2, 1), 30_000);
            }
          }
        })();
      } catch (error) {
        if (!(error instanceof Web2HTTPError) || error.code !== "pull-required") throw error;
        pulledHeads.delete(workspaceId);
        await pullToHead(workspaceId, signal);
        continue;
      }
      const rejected = result.results.filter((candidate) => candidate.kind === "rejected");
      if (rejected.length > 0) await options.database.recordPushRejections(rejected.map(({ operationId, workspaceId, code, message }) => ({ operationId, workspaceId, code, message })));
      pulledHeads.delete(workspaceId);
      await pullToHead(workspaceId, signal);
      batch++;
    }
    if ((await selectOutboxBatch(workspaceId)).length === 0) return;
    throw new Error("Synchronization outbox exceeded its batch limit.");
  };

  const synchronizeOnce = async (signal: AbortSignal) => {
    const workspaces = await options.database.listWorkspaces();
    const available = new Set(workspaces.map(({ id }) => id));
    const completed = new Set<string>();
    const visiting = new Set<string>();
    const synchronizeDependencies = async (workspaceId: string): Promise<void> => {
      if (completed.has(workspaceId) || visiting.has(workspaceId)) return;
      visiting.add(workspaceId);
      for (const stored of await scanUnsettled(workspaceId)) {
        const operation = stored.operation;
        if (stored.stateKind === "pending" && stored.overlayKind === "active" && operation.kind === "transfer" && available.has(operation.destinationWorkspaceId)) await synchronizeDependencies(operation.destinationWorkspaceId);
      }
      signal.throwIfAborted();
      await synchronizeWorkspace(workspaceId, signal);
      visiting.delete(workspaceId);
      completed.add(workspaceId);
    };
    for (const workspace of workspaces) {
      if (!boundWorkspaces.has(workspace.id)) continue;
      await synchronizeDependencies(workspace.id);
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
    hydrate: async (target, suppliedSignal) => {
      const signal = suppliedSignal ?? new AbortController().signal;
      await options.hydration.hydrate(target, requestHydration, { signal });
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
      listen: async (signal, wake) => {
        let fallback: ReturnType<typeof setTimeout> | undefined;
        const resetFallback = () => {
          if (fallback) clearTimeout(fallback);
          fallback = setTimeout(() => {
            boundWorkspaces.forEach((workspaceId) => pulledHeads.delete(workspaceId));
            wake();
            resetFallback();
          }, 45_000);
        };
        resetFallback();
        try {
          await transport.listen(signal, async (event) => {
            if (event.kind === "directory") options.onDirectoryChange?.(event.revision);
            else if (event.accountId !== accountId) return;
            else if (event.kind === "account-apps") options.onAccountAppsChange?.(event.appsRevision);
            else if (boundWorkspaces.has(event.workspaceId) && event.headSequence > (await options.database.getSyncState(event.workspaceId)).cursor) {
              pulledHeads.delete(event.workspaceId);
              wake();
            }
          }, options.directoryRevision ?? 0, resetFallback);
        } finally {
          if (fallback) clearTimeout(fallback);
        }
      },
    },
  };
}

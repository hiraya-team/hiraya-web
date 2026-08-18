import { describe, expect, test } from "bun:test";
import { WEB2_SCHEMA_VERSION, type Manifest } from "../src/filesystem/model";
import type { OperationInverse, StoredOperation } from "../src/filesystem/database";
import type { WorkspaceOperation } from "../src/filesystem/operations";
import { WEB2_SYNC_PROTOCOL, type PullResult, type PushBatchResult, type PushRequest } from "../src/sync/protocol";
import { createWeb2SyncRuntime, type Web2SyncRuntimeOptions, type Web2SyncRuntimeTransport } from "../src/sync/runtime";
import { Web2HTTPError, Web2NetworkError } from "../src/sync/transport";

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const ACCOUNT = id(1);
const WORKSPACE = id(2);
const DEVICE = id(3);

function stored(operation: WorkspaceOperation, affectedIdentities: string[]): StoredOperation {
  let inverse: OperationInverse;
  switch (operation.kind) {
    case "create": inverse = { kind: "create", rootNodeIds: operation.nodes.map(({ id }) => id) }; break;
    case "copy": inverse = { kind: "copy", rootNodeIds: operation.nodes.filter(({ parentId }) => parentId === null).map(({ id }) => id), sourceNodeIds: operation.sourceNodeIds, sourceFileNodeIds: [] }; break;
    case "write": inverse = { kind: "write", nodeId: operation.nodeId, mimeType: "text/plain", size: 0, manifestHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", modifiedAt: 0 }; break;
    case "rename": inverse = { kind: "rename", nodeId: operation.nodeId, name: "Before", modifiedAt: 0 }; break;
    case "move": inverse = { kind: "move", roots: operation.nodeIds.map((nodeId) => ({ nodeId, parentId: null, modifiedAt: 0 })) }; break;
    case "position": inverse = { kind: "position", positions: operation.positions }; break;
    case "transfer": inverse = { kind: "transfer", nodes: operation.nodeIds.map((nodeId) => ({ nodeId, parentId: null, modifiedAt: 0 })), fileNodeIds: [] }; break;
    case "trash": inverse = { kind: "trash", roots: operation.nodeIds.map((nodeId) => ({ nodeId, parentId: null })), nodeIds: operation.nodeIds }; break;
    case "restore": inverse = { kind: "restore", roots: operation.nodeIds.map((nodeId) => ({ nodeId, parentId: null, modifiedAt: 0 })), nodes: operation.nodeIds.map((nodeId) => ({ nodeId, lifecycle: { kind: "trashed", trashedAt: 1, originalParentId: null } })) }; break;
    case "purge": inverse = { kind: "purge", nodeIds: operation.nodeIds, reason: "Permanent purge cannot be undone." }; break;
    case "set": inverse = { kind: "set", namespace: operation.namespace, key: operation.key, previous: { exists: false } }; break;
    case "set-many": inverse = { kind: "set-many", namespace: operation.namespace, settings: operation.settings.map(({ key }) => ({ key, previous: { exists: false } })) }; break;
    case "unset": inverse = { kind: "unset", namespace: operation.namespace, key: operation.key, previous: { exists: false } }; break;
    case "unset-many": inverse = { kind: "unset-many", namespace: operation.namespace, settings: operation.keys.map((key) => ({ key, previous: { exists: false } })) }; break;
  }
  return {
    operationId: operation.operationId,
    workspaceId: operation.workspaceId,
    localRevision: 1,
    destinationLocalRevision: null,
    stateKind: "pending",
    overlayKind: "active",
    intent: "forward",
    compensatesOperationId: null,
    expectedContentTuple: operation.kind === "write" ? { logicalTime: 0, operationId: id(99) } : null,
    operation,
    inverse,
    affectedIdentities,
    versionNodeIds: [],
  } as StoredOperation;
}

function pull(cursor = 0, headSequence = cursor, workspaceId = WORKSPACE): PullResult {
  return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "operations", workspaceId, deviceId: DEVICE, fromCursor: cursor, cursor, headSequence, snapshotBarrier: 0, logFloor: 0, observedLogicalTime: 0, operations: [] };
}

function accepted(operation: WorkspaceOperation): PushBatchResult {
  return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, results: [{ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "accepted", workspaceId: operation.workspaceId, operationId: operation.operationId, sequence: 1, headSequence: 1, outcome: "applied" }] };
}

function setup(pending: StoredOperation[], overrides: Partial<Web2SyncRuntimeOptions> = {}) {
  const calls = { pushes: [] as PushRequest[], pulls: [] as number[], pullWorkspaces: [] as string[], rejected: [] as unknown[], completed: [] as string[], hydrationTargets: [] as unknown[], appliedOperations: [] as string[], directoryRevisions: [] as number[], applied: 0, bootstrap: 0, hydrated: 0, uploads: 0, order: [] as string[] };
  const cursors = new Map<string, number>([[WORKSPACE, 0]]);
  let initialized = false;
  let unsettled = [...pending];
  const settle = (operationIds: string[]) => { unsettled = unsettled.filter(({ operationId }) => !operationIds.includes(operationId)); };
  const transport = {
    bootstrap: async () => ({ workspace: { id: WORKSPACE }, deviceId: DEVICE, rootPage: { generationId: id(10) } }) as never,
    hydrate: async () => { throw new Error("unexpected hydration"); },
    pull: async (request: { workspaceId: string; cursor: number }) => { calls.pulls.push(request.cursor); calls.pullWorkspaces.push(request.workspaceId); calls.order.push("pull"); return pull(cursors.get(request.workspaceId) ?? 0, undefined, request.workspaceId); },
    push: async (request: PushRequest) => {
      calls.order.push("push");
      const result: PushBatchResult = { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, results: request.operations.map((operation, index) => ({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "accepted", workspaceId: operation.workspaceId, operationId: operation.operationId, sequence: index + 1, headSequence: index + 1, outcome: "applied" })) };
      calls.pushes.push(request);
      settle(request.operations.map(({ operationId }) => operationId));
      return result;
    },
    negotiateUpload: async () => { throw new Error("unexpected upload negotiation"); },
    readLocalChunk: async () => { throw new Error("unexpected local chunk read"); },
    uploadChunk: async () => { calls.uploads++; calls.order.push("upload"); },
    listen: async (_signal, receive, directoryRevision) => {
      calls.directoryRevisions.push(directoryRevision ?? -1);
      await receive({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "directory", revision: 7 });
      await receive({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "workspace-head", accountId: id(50), workspaceId: WORKSPACE, headSequence: 1 });
      await receive({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "workspace-head", accountId: ACCOUNT, workspaceId: WORKSPACE, headSequence: 1 });
    },
  } satisfies Web2SyncRuntimeTransport;
  const options: Web2SyncRuntimeOptions = {
    accountId: ACCOUNT,
    directBlobOrigin: "https://objects.example",
    database: {
      getManifest: async () => undefined,
      getOrCreateDeviceId: async () => DEVICE,
      getSyncState: async (workspaceId) => ({ workspaceId, deviceId: DEVICE, cursor: cursors.get(workspaceId) ?? 0, lastHydrationAsOf: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 }),
      getWorkspaceBootstrapState: async () => undefined,
      completeRejectedDiscards: async (operationIds) => { calls.completed.push(...operationIds); },
      listUnsettledOperations: async (workspaceId, afterRevision) => unsettled.filter((operation) => operation.workspaceId === workspaceId && operation.localRevision > (afterRevision ?? 0)),
      listWorkspaces: async () => initialized ? [{ id: WORKSPACE, name: "Desktop", pinned: false, ordinal: 0, headSequence: cursors.get(WORKSPACE) ?? 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 }] : [],
      recordPushRejections: async (values) => {
        calls.rejected.push(...values);
        unsettled = unsettled.map((operation) => {
          const rejection = values.find(({ operationId }) => operationId === operation.operationId);
          return rejection ? { ...operation, stateKind: "rejected", rejection: { code: rejection.code, message: rejection.message } } as StoredOperation : operation;
        });
        return unsettled.filter(({ stateKind }) => stateKind === "rejected");
      },
    },
    hydration: {
      bootstrap: async () => { initialized = true; calls.bootstrap++; return { bootstrap: undefined as never, changes: [] }; },
      hydrate: async (target) => { calls.hydrationTargets.push(target); calls.hydrated++; return []; },
      applyPull: async (value) => {
        cursors.set(value.workspaceId, value.cursor);
        if (value.kind === "operations") for (const operation of value.operations) {
          calls.appliedOperations.push(operation.operationId);
          if (operation.companion !== null) cursors.set(operation.companion.workspaceId, operation.companion.sequence);
        }
        calls.applied++;
        return { pull: value, changes: [] };
      },
    },
    opfsRoot: {} as FileSystemDirectoryHandle,
    transport,
    randomUUID: () => id(10),
    retryDelayMs: 0,
    ...overrides,
  };
  return { runtime: createWeb2SyncRuntime(options), calls, cursors, transport, options, settle };
}

describe("Web2 synchronization runtime", () => {
  test("bootstraps once and wakes only for its account", async () => {
    let directoryRevision = 0;
    const { runtime, calls } = setup([], { directoryRevision: 6, onDirectoryChange: (revision) => { directoryRevision = revision; } });
    await runtime.bootstrap(WORKSPACE);
    expect(calls.bootstrap).toBe(1);
    let wakes = 0;
    await runtime.callbacks.listen!(new AbortController().signal, () => { wakes++; });
    expect(wakes).toBe(1);
    expect(directoryRevision).toBe(7);
    expect(calls.directoryRevisions).toEqual([6]);
  });

  test("synchronizes only explicitly bootstrapped workspaces", async () => {
    const otherWorkspace = id(30);
    const base = setup([]);
    base.options.database.listWorkspaces = async () => [
      { id: WORKSPACE, name: "Desktop", pinned: false, ordinal: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 },
      { id: otherWorkspace, name: "Other", pinned: false, ordinal: 1, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 },
    ];
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    base.calls.hydrationTargets = [];
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.pullWorkspaces).toEqual([WORKSPACE]);
  });

  test("resumes a persisted root generation before marking the workspace bound", async () => {
    const base = setup([]);
    base.options.database.getWorkspaceBootstrapState = async () => ({ target: { kind: "folder-page", workspaceId: WORKSPACE, asOf: 0, parentId: null, limit: 256 }, staged: true });
    base.transport.bootstrap = async () => { throw new Error("server bootstrap must not repeat"); };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    expect(base.calls.hydrated).toBe(1);
    expect(base.calls.pulls).toEqual([0]);
  });

  test("does not republish an old completed bootstrap target", async () => {
    const base = setup([]);
    base.options.database.getWorkspaceBootstrapState = async () => ({ target: { kind: "folder-page", workspaceId: WORKSPACE, asOf: 0, parentId: null, limit: 256 }, staged: false });
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    expect(base.calls.hydrated).toBe(0);
    expect(base.calls.pulls).toEqual([0]);
  });

  test("acknowledges the final applied pull cursor", async () => {
    const base = setup([]);
    base.transport.pull = async (request) => {
      base.calls.pulls.push(request.cursor);
      return { ...pull(request.cursor, 1), fromCursor: request.cursor, cursor: 1 };
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.pulls).toEqual([0, 1]);
  });

  test("replays unrelated supported intents and durably records rejection", async () => {
    const create: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "create", operationId: id(11), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodes: [{ id: id(12), kind: "folder", name: "Offline", parentId: null, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1 }] };
    const rejectedSetting: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "set", operationId: id(13), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 2, namespace: "desktop-grid", key: "grid-size", value: 24 };
    const dependentSetting: WorkspaceOperation = { ...rejectedSetting, operationId: id(14), logicalTime: 3, value: 36 };
    const setting: WorkspaceOperation = { ...rejectedSetting, operationId: id(15), logicalTime: 4, key: "snap-to-grid", value: true };
    const rejectedCreate = { ...stored(create, [`node:${id(12)}`]), stateKind: "rejected" as const, rejection: { code: "forbidden", message: "Denied" } };
    const rejected = { ...stored(rejectedSetting, ["setting:desktop-grid:grid-size"]), stateKind: "rejected" as const, rejection: { code: "quota", message: "Quota" } };
    const { runtime, calls, transport } = setup([rejectedCreate, rejected, stored(dependentSetting, ["setting:desktop-grid:grid-size"]), stored(setting, ["setting:desktop-grid:snap-to-grid"])]);
    const requests: PushRequest[] = [];
    let attempts = 0;
    transport.push = async (request) => {
      requests.push(request);
      if (attempts++ === 0) throw new Web2NetworkError();
      expect(request.operations).toEqual([setting]);
      return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, results: [{ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "rejected", workspaceId: WORKSPACE, operationId: setting.operationId, code: "forbidden", message: "Denied" }] };
    };
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(attempts).toBe(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(calls.rejected).toEqual([{ operationId: setting.operationId, workspaceId: WORKSPACE, code: "forbidden", message: "Denied" }]);
    expect(calls.applied).toBe(2);
  });

  test("allows a compensating intent to resolve its rejected dependency", async () => {
    const rejectedWrite: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "write", operationId: id(40), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodeId: id(42), mimeType: "text/plain", size: 0, manifestHash: "a".repeat(64), modifiedAt: 1 };
    const compensation: WorkspaceOperation = { ...rejectedWrite, operationId: id(41), logicalTime: 2, manifestHash: "b".repeat(64), modifiedAt: 2 };
    const rejected = { ...stored(rejectedWrite, []), stateKind: "rejected" as const, rejection: { code: "quota", message: "Quota" } };
    const compensating = { ...stored(compensation, []), intent: "undo" as const, compensatesOperationId: rejectedWrite.operationId };
    const base = setup([rejected, compensating]);
    base.options.database.getManifest = async () => ({ schemaVersion: WEB2_SCHEMA_VERSION, size: 0, chunkSize: 1_048_576, chunks: [] });
    base.transport.negotiateUpload = async (request) => ({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "chunk-upload-result", workspaceId: WORKSPACE, deviceId: DEVICE, operationId: request.operationId, manifestHash: request.manifestHash, transferId: id(43), expiresAt: 1, missingChunks: [] });
    base.transport.push = async (request) => {
      expect(request.operations).toEqual([compensation]);
      base.settle([compensation.operationId]);
      return accepted(compensation);
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
  });

  test("does not let a rejected content write block an independent position", async () => {
    const nodeId = id(45);
    const write: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "write", operationId: id(46), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodeId, mimeType: "text/plain", size: 0, manifestHash: "a".repeat(64), modifiedAt: 1 };
    const position: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "position", operationId: id(47), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 2, positions: [{ nodeId, position: { x: 10, y: 20 } }] };
    const rejected = { ...stored(write, []), stateKind: "rejected" as const, rejection: { code: "quota", message: "Quota" } };
    const base = setup([rejected, stored(position, [])]);
    base.transport.push = async (request) => {
      expect(request.operations).toEqual([position]);
      base.settle([position.operationId]);
      return accepted(position);
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
  });

  test("repairs a deferred rejected overlay before completing its discard", async () => {
    const setting: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "set", operationId: id(48), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, namespace: "desktop-grid", key: "grid-size", value: 24 };
    const deferred = { ...stored(setting, []), stateKind: "rejected" as const, overlayKind: "deferred" as const, rejection: { code: "forbidden", message: "Denied" } };
    const base = setup([deferred]);
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    base.calls.hydrated = 0;
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.hydrated).toBe(1);
    expect(base.calls.completed).toEqual([setting.operationId]);
  });

  test("repairs a rejected transfer destination before its source", async () => {
    const destinationWorkspace = id(54);
    const nodeId = id(55);
    const transfer: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "transfer", operationId: id(56), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodeIds: [nodeId], destinationWorkspaceId: destinationWorkspace, parentId: null, modifiedAt: 1 };
    const rename: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "rename", operationId: id(62), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 2, nodeId, name: "Rejected", modifiedAt: 2 };
    const deferredRename = { ...stored(rename, []), stateKind: "rejected" as const, overlayKind: "deferred" as const, rejection: { code: "forbidden", message: "Denied" } };
    const deferred = { ...stored(transfer, []), localRevision: 2, stateKind: "rejected" as const, overlayKind: "deferred" as const, rejection: { code: "forbidden", message: "Denied" } };
    const base = setup([deferredRename, deferred]);
    base.options.database.listWorkspaces = async () => [
      { id: WORKSPACE, name: "Source", pinned: false, ordinal: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 },
      { id: destinationWorkspace, name: "Destination", pinned: false, ordinal: 1, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 },
    ];
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    base.calls.hydrationTargets = [];
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.hydrationTargets).toEqual([
      { kind: "exact-nodes", workspaceId: WORKSPACE, asOf: 0, nodeIds: [nodeId] },
      { kind: "exact-nodes", workspaceId: destinationWorkspace, asOf: 0, nodeIds: [nodeId] },
      { kind: "exact-nodes", workspaceId: WORKSPACE, asOf: 0, nodeIds: [nodeId] },
    ]);
    expect(base.calls.completed).toEqual([rename.operationId, transfer.operationId]);
  });

  test("blocks destination writes behind unsettled cross-workspace transfers", async () => {
    const sourceWorkspace = id(49);
    const rootId = id(50);
    const childId = id(53);
    const transfer: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "transfer", operationId: id(51), workspaceId: sourceWorkspace, deviceId: DEVICE, logicalTime: 1, nodeIds: [rootId], destinationWorkspaceId: WORKSPACE, parentId: null, modifiedAt: 1 };
    const write: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "write", operationId: id(52), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 2, nodeId: childId, mimeType: "text/plain", size: 0, manifestHash: "a".repeat(64), modifiedAt: 2 };
    const sourceRecord = { ...stored(transfer, []), inverse: { kind: "transfer" as const, nodes: [{ nodeId: rootId, parentId: null, modifiedAt: 0 }, { nodeId: childId, parentId: rootId, modifiedAt: 0 }], fileNodeIds: [childId] } };
    const destinationRecord = stored(write, []);
    const base = setup([]);
    base.options.database.listWorkspaces = async () => [
      { id: sourceWorkspace, name: "Source", pinned: false, ordinal: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 1 },
      { id: WORKSPACE, name: "Destination", pinned: false, ordinal: 1, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 1 },
    ];
    base.options.database.listUnsettledOperations = async (workspaceId) => workspaceId === sourceWorkspace ? [sourceRecord] : [destinationRecord];
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.pushes).toEqual([]);
  });

  test("replays destination structure before a transfer that depends on it", async () => {
    const destinationWorkspace = id(57);
    const parentId = id(58);
    const createParent: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "create", operationId: id(59), workspaceId: destinationWorkspace, deviceId: DEVICE, logicalTime: 1, nodes: [{ id: parentId, kind: "folder", name: "Destination", parentId: null, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1 }] };
    const transfer: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "transfer", operationId: id(60), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 2, nodeIds: [id(61)], destinationWorkspaceId: destinationWorkspace, parentId, modifiedAt: 2 };
    const base = setup([stored(transfer, []), stored(createParent, [])]);
    base.options.database.listWorkspaces = async () => [
      { id: WORKSPACE, name: "Source", pinned: false, ordinal: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 1 },
      { id: destinationWorkspace, name: "Destination", pinned: false, ordinal: 1, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 1 },
    ];
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.pushes.flatMap(({ operations }) => operations)).toEqual([createParent, transfer]);
  });

  test("does not deadlock opposite-direction transfers", async () => {
    const otherWorkspace = id(63);
    const outward: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "transfer", operationId: id(64), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodeIds: [id(65)], destinationWorkspaceId: otherWorkspace, parentId: null, modifiedAt: 1 };
    const inward: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "transfer", operationId: id(66), workspaceId: otherWorkspace, deviceId: DEVICE, logicalTime: 2, nodeIds: [id(67)], destinationWorkspaceId: WORKSPACE, parentId: null, modifiedAt: 2 };
    const base = setup([stored(outward, []), stored(inward, [])]);
    base.options.database.listWorkspaces = async () => [
      { id: WORKSPACE, name: "First", pinned: false, ordinal: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 1 },
      { id: otherWorkspace, name: "Second", pinned: false, ordinal: 1, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 1 },
    ];
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.pushes.flatMap(({ operations }) => operations)).toEqual([inward, outward]);
  });

  test("replays every structural operation in local revision order", async () => {
    const destinationWorkspace = id(70);
    const operations: WorkspaceOperation[] = [
      { schemaVersion: WEB2_SCHEMA_VERSION, kind: "create", operationId: id(71), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodes: [{ id: id(81), kind: "folder", name: "Created", parentId: null, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1 }] },
      { schemaVersion: WEB2_SCHEMA_VERSION, kind: "copy", operationId: id(72), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 2, sourceNodeIds: [id(82)], nodes: [{ id: id(83), kind: "folder", name: "Copied", parentId: null, position: { x: 0, y: 0 }, createdAt: 2, modifiedAt: 2 }] },
      { schemaVersion: WEB2_SCHEMA_VERSION, kind: "rename", operationId: id(73), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 3, nodeId: id(84), name: "Renamed", modifiedAt: 3 },
      { schemaVersion: WEB2_SCHEMA_VERSION, kind: "move", operationId: id(74), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 4, nodeIds: [id(85)], parentId: null, modifiedAt: 4 },
      { schemaVersion: WEB2_SCHEMA_VERSION, kind: "transfer", operationId: id(75), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 5, nodeIds: [id(86)], destinationWorkspaceId: destinationWorkspace, parentId: null, modifiedAt: 5 },
      { schemaVersion: WEB2_SCHEMA_VERSION, kind: "trash", operationId: id(76), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 6, nodeIds: [id(87)], trashedAt: 6 },
      { schemaVersion: WEB2_SCHEMA_VERSION, kind: "restore", operationId: id(77), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 7, nodeIds: [id(88)], destination: "root", modifiedAt: 7 },
      { schemaVersion: WEB2_SCHEMA_VERSION, kind: "purge", operationId: id(78), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 8, nodeIds: [id(89)] },
    ];
    const base = setup(operations.map((operation, index) => ({ ...stored(operation, []), localRevision: index + 1 })));
    await base.runtime.bootstrap(WORKSPACE);
    await base.runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.pushes.flatMap(({ operations }) => operations.map(({ kind }) => kind))).toEqual(["create", "copy", "rename", "move", "transfer", "trash", "restore", "purge"]);
  });

  test("fences structural operations behind a rejected destination parent", async () => {
    const parentId = id(90);
    const parent: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "create", operationId: id(91), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodes: [{ id: parentId, kind: "folder", name: "Parent", parentId: null, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1 }] };
    const child: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "create", operationId: id(92), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 2, nodes: [{ id: id(93), kind: "folder", name: "Child", parentId, position: { x: 0, y: 0 }, createdAt: 2, modifiedAt: 2 }] };
    const move: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "move", operationId: id(94), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 3, nodeIds: [id(95)], parentId, modifiedAt: 3 };
    const setting: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "set", operationId: id(96), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 4, namespace: "desktop-grid", key: "grid-size", value: 24 };
    const rejectedParent = { ...stored(parent, []), stateKind: "rejected" as const, rejection: { code: "forbidden", message: "Denied" } };
    const base = setup([rejectedParent, { ...stored(child, []), localRevision: 2 }, { ...stored(move, []), localRevision: 3 }, { ...stored(setting, []), localRevision: 4 }]);
    await base.runtime.bootstrap(WORKSPACE);
    await base.runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.pushes).toHaveLength(1);
    expect(base.calls.pushes[0]!.operations).toEqual([setting]);
  });

  test("pulls a transfer companion only through its predecessor", async () => {
    const destinationWorkspace = id(110);
    const destinationPreparationId = id(111);
    const transferId = id(112);
    const base = setup([]);
    base.cursors.set(destinationWorkspace, 0);
    base.options.database.listWorkspaces = async () => [
      { id: WORKSPACE, name: "Source", pinned: false, ordinal: 0, headSequence: base.cursors.get(WORKSPACE) ?? 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 },
      { id: destinationWorkspace, name: "Destination", pinned: false, ordinal: 1, headSequence: base.cursors.get(destinationWorkspace) ?? 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 },
    ];
    base.transport.pull = async (request) => {
      base.calls.pulls.push(request.cursor);
      base.calls.pullWorkspaces.push(request.workspaceId);
      if (request.workspaceId === WORKSPACE && request.cursor === 0) return {
        ...pull(0, 1, WORKSPACE), cursor: 1,
        operations: [{ sequence: 1, operationId: transferId, companion: { workspaceId: destinationWorkspace, sequence: 2 }, nodes: [], settings: [] }],
      };
      if (request.workspaceId === destinationWorkspace && request.cursor === 0) return {
        ...pull(0, 2, destinationWorkspace), cursor: 2,
        operations: [
          { sequence: 1, operationId: destinationPreparationId, companion: null, nodes: [], settings: [] },
          { sequence: 2, operationId: transferId, companion: { workspaceId: WORKSPACE, sequence: 1 }, nodes: [], settings: [] },
        ],
      };
      return pull(request.cursor, request.cursor, request.workspaceId);
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(base.calls.pullWorkspaces).toEqual([WORKSPACE, destinationWorkspace, destinationWorkspace, WORKSPACE]);
    expect(base.calls.appliedOperations).toEqual([destinationPreparationId, transferId]);
    expect(base.cursors.get(destinationWorkspace)).toBe(2);
  });

  test("hydrates a complete pending transfer group before retrying pull merge", async () => {
    const destinationWorkspace = id(113);
    const rootId = id(114);
    const childId = id(115);
    const transfer: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "transfer", operationId: id(116), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodeIds: [rootId], destinationWorkspaceId: destinationWorkspace, parentId: null, modifiedAt: 1 };
    const pending = { ...stored(transfer, []), inverse: { kind: "transfer" as const, nodes: [{ nodeId: rootId, parentId: null, modifiedAt: 0 }, { nodeId: childId, parentId: rootId, modifiedAt: 0 }], fileNodeIds: [] } };
    const base = setup([pending]);
    base.cursors.set(destinationWorkspace, 0);
    base.options.database.listWorkspaces = async () => [
      { id: WORKSPACE, name: "Source", pinned: false, ordinal: 0, headSequence: 1, snapshotBarrier: 0, logFloor: 0, localRevision: 1 },
      { id: destinationWorkspace, name: "Destination", pinned: false, ordinal: 1, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 },
    ];
    base.transport.pull = async (request) => request.workspaceId === WORKSPACE && request.cursor === 0 ? {
      ...pull(0, 1, WORKSPACE), cursor: 1,
      operations: [{ sequence: 1, operationId: id(117), companion: null, nodes: [{ id: childId } as never], settings: [] }],
    } : pull(request.cursor, request.cursor, request.workspaceId);
    const applyPull = base.options.hydration.applyPull;
    let attempts = 0;
    base.options.hydration.applyPull = async (value, requester, options) => {
      const candidate = value as PullResult;
      if (candidate.kind === "operations" && candidate.operations.length > 0 && attempts++ === 0) throw new Error("Hydration requires complete coverage to merge a pending transfer.");
      return applyPull(value, requester, options);
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    base.calls.hydrationTargets = [];
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(attempts).toBe(2);
    expect(base.calls.hydrationTargets).toEqual([
      { kind: "exact-nodes", workspaceId: destinationWorkspace, asOf: 0, nodeIds: [rootId, childId] },
      { kind: "exact-nodes", workspaceId: WORKSPACE, asOf: 1, nodeIds: [rootId, childId] },
    ]);
  });

  test("uploads every unique create and copy manifest before pushing", async () => {
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    const manifest: Manifest = { schemaVersion: WEB2_SCHEMA_VERSION, size: 0, chunkSize: 1_048_576, chunks: [] };
    const create: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "create", operationId: id(120), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodes: [
      { id: id(121), kind: "file", name: "B", parentId: null, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, mimeType: "text/plain", size: 0, manifestHash: secondHash },
      { id: id(122), kind: "file", name: "A", parentId: null, position: { x: 1, y: 0 }, createdAt: 1, modifiedAt: 1, mimeType: "text/plain", size: 0, manifestHash: firstHash },
      { id: id(123), kind: "file", name: "B2", parentId: null, position: { x: 2, y: 0 }, createdAt: 1, modifiedAt: 1, mimeType: "text/plain", size: 0, manifestHash: secondHash },
    ] };
    const copy: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "copy", operationId: id(124), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 2, sourceNodeIds: [id(125)], nodes: [{ id: id(126), kind: "file", name: "Copy", parentId: null, position: { x: 0, y: 0 }, createdAt: 2, modifiedAt: 2, mimeType: "text/plain", size: 0, manifestHash: secondHash }] };
    const base = setup([stored(create, []), { ...stored(copy, []), localRevision: 2 }]);
    base.options.database.getManifest = async () => manifest;
    const negotiations: Array<[string, string]> = [];
    base.transport.negotiateUpload = async (request) => {
      negotiations.push([request.operationId, request.manifestHash]);
      return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "chunk-upload-result", workspaceId: request.workspaceId, deviceId: request.deviceId, operationId: request.operationId, manifestHash: request.manifestHash, transferId: id(127 + negotiations.length), expiresAt: 1, missingChunks: [] };
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(negotiations).toEqual([[create.operationId, firstHash], [create.operationId, secondHash], [copy.operationId, secondHash]]);
    expect(base.calls.pushes.flatMap(({ operations }) => operations).filter((operation) => operation.kind === "create" || operation.kind === "copy")).toEqual([create, copy]);
  });

  test("pages past a full rejected prefix to replay unrelated work", async () => {
    const rejected = Array.from({ length: 256 }, (_, index) => {
      const operation: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "create", operationId: id(1000 + index), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: index + 1, nodes: [{ id: id(2000 + index), kind: "folder", name: `Folder ${index}`, parentId: null, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1 }] };
      return { ...stored(operation, []), localRevision: index + 1, stateKind: "rejected" as const, rejection: { code: "forbidden", message: "Denied" } };
    });
    const setting: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "set", operationId: id(3000), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 300, namespace: "desktop-grid", key: "grid-size", value: 24 };
    let records = [...rejected, { ...stored(setting, []), localRevision: 257 }];
    const base = setup(records);
    base.options.database.listUnsettledOperations = async (_workspaceId, afterRevision = 0, limit = 256) => records.filter(({ localRevision }) => localRevision > afterRevision).slice(0, limit);
    base.transport.push = async (request) => {
      expect(request.operations).toEqual([setting]);
      records = records.filter(({ operationId }) => operationId !== setting.operationId);
      return accepted(setting);
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
  });

  test("continues draining after a whole push batch is rejected", async () => {
    const positions = Array.from({ length: 257 }, (_, index) => {
      const operation: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "position", operationId: id(4000 + index), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: index + 1, positions: [{ nodeId: id(5000 + index), position: { x: index, y: index } }] };
      return { ...stored(operation, []), localRevision: index + 1 };
    });
    const base = setup(positions);
    let pushes = 0;
    base.transport.push = async (request) => {
      pushes++;
      if (pushes === 1) return {
        schemaVersion: WEB2_SCHEMA_VERSION,
        protocol: WEB2_SYNC_PROTOCOL,
        results: request.operations.map((operation) => ({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "rejected" as const, workspaceId: WORKSPACE, operationId: operation.operationId, code: "forbidden" as const, message: "Denied" })),
      };
      expect(request.operations).toEqual([positions[256]!.operation]);
      base.settle([positions[256]!.operationId]);
      return accepted(positions[256]!.operation);
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(pushes).toBe(2);
  });

  test("uploads write chunks before pushing the intent", async () => {
    const hash = "a".repeat(64);
    const manifest: Manifest = { schemaVersion: WEB2_SCHEMA_VERSION, size: 5, chunkSize: 1_048_576, chunks: [{ hash, size: 5 }] };
    const write: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "write", operationId: id(20), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodeId: id(21), mimeType: "text/plain", size: 5, manifestHash: "b".repeat(64), modifiedAt: 1 };
    const base = setup([stored(write, [`content:${write.nodeId}`])]);
    base.options.database.getManifest = async () => manifest;
    let negotiations = 0;
    base.transport.negotiateUpload = async () => { base.calls.order.push("negotiate"); return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "chunk-upload-result", workspaceId: WORKSPACE, deviceId: DEVICE, operationId: write.operationId, manifestHash: write.manifestHash, transferId: id(22), expiresAt: 1, missingChunks: negotiations++ === 0 ? [{ hash, size: 5, method: "PUT", url: "https://objects.example/chunk", headers: {} }] : [] }; };
    base.transport.readLocalChunk = async (_root, chunk) => {
      expect(chunk).toEqual({ hash, size: 5 });
      return new Blob(["hello"]);
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(negotiations).toBe(2);
    expect(base.calls.uploads).toBe(1);
    expect(base.calls.pushes).toHaveLength(1);
    expect(base.calls.order).toEqual(["pull", "negotiate", "upload", "negotiate", "push", "pull"]);
  });

  test("renegotiates an expired direct upload before pushing", async () => {
    const hash = "c".repeat(64);
    const manifest: Manifest = { schemaVersion: WEB2_SCHEMA_VERSION, size: 5, chunkSize: 1_048_576, chunks: [{ hash, size: 5 }] };
    const write: WorkspaceOperation = { schemaVersion: WEB2_SCHEMA_VERSION, kind: "write", operationId: id(60), workspaceId: WORKSPACE, deviceId: DEVICE, logicalTime: 1, nodeId: id(61), mimeType: "text/plain", size: 5, manifestHash: "d".repeat(64), modifiedAt: 1 };
    const base = setup([stored(write, [])]);
    base.options.database.getManifest = async () => manifest;
    let negotiations = 0;
    let uploads = 0;
    base.transport.negotiateUpload = async () => ({ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "chunk-upload-result", workspaceId: WORKSPACE, deviceId: DEVICE, operationId: write.operationId, manifestHash: write.manifestHash, transferId: id(62), expiresAt: 1, missingChunks: negotiations++ < 2 ? [{ hash, size: 5, method: "PUT", url: "https://objects.example/chunk", headers: {} }] : [] });
    base.transport.readLocalChunk = async () => new Blob(["hello"]);
    base.transport.uploadChunk = async () => {
      if (uploads++ === 0) throw new Web2HTTPError(403);
    };
    const runtime = createWeb2SyncRuntime(base.options);
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(negotiations).toBe(3);
    expect(uploads).toBe(2);
    expect(base.calls.pushes).toHaveLength(1);
  });
});

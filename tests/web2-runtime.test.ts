import { describe, expect, test } from "bun:test";
import { WEB2_SCHEMA_VERSION, type Manifest } from "../src/filesystem/model";
import type { StoredOperation } from "../src/filesystem/database";
import type { WorkspaceOperation } from "../src/filesystem/operations";
import { WEB2_SYNC_PROTOCOL, type PullResult, type PushBatchResult } from "../src/sync/protocol";
import { createWeb2SyncRuntime, type Web2SyncRuntimeOptions } from "../src/sync/runtime";
import { Web2HTTPError } from "../src/sync/transport";

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const ACCOUNT = id(1);
const WORKSPACE = id(2);
const DEVICE = id(3);

function stored(operation: WorkspaceOperation, affectedIdentities: string[]): StoredOperation {
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
    inverse: operation.kind === "write"
      ? { kind: "write", nodeId: operation.nodeId, mimeType: "text/plain", size: 0, manifestHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", modifiedAt: 0 }
      : operation.kind === "set"
        ? { kind: "set", namespace: operation.namespace, key: operation.key, previous: { exists: false } }
        : operation.kind === "transfer"
          ? { kind: "transfer", nodes: operation.nodeIds.map((nodeId) => ({ nodeId, parentId: null, modifiedAt: 0 })), fileNodeIds: [] }
        : { kind: "create", rootNodeIds: operation.kind === "create" ? operation.nodes.map(({ id }) => id) : [] },
    affectedIdentities,
    versionNodeIds: [],
  } as StoredOperation;
}

function pull(cursor = 0, headSequence = cursor): PullResult {
  return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "operations", workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: cursor, cursor, headSequence, snapshotBarrier: 0, logFloor: 0, observedLogicalTime: 0, operations: [] };
}

function accepted(operation: WorkspaceOperation): PushBatchResult {
  return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, results: [{ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "accepted", workspaceId: operation.workspaceId, operationId: operation.operationId, sequence: 1, headSequence: 1, outcome: "applied" }] };
}

function setup(pending: StoredOperation[], overrides: Partial<Web2SyncRuntimeOptions> = {}) {
  const calls = { pushes: [] as PushBatchResult[], pulls: [] as number[], pullWorkspaces: [] as string[], rejected: [] as unknown[], completed: [] as string[], applied: 0, bootstrap: 0, hydrated: 0, uploads: 0, order: [] as string[] };
  let cursor = 0;
  let initialized = false;
  let unsettled = [...pending];
  const settle = (operationIds: string[]) => { unsettled = unsettled.filter(({ operationId }) => !operationIds.includes(operationId)); };
  const transport = {
    bootstrap: async () => ({ workspace: { id: WORKSPACE }, deviceId: DEVICE, rootPage: { generationId: id(10) } }) as never,
    hydrate: async () => { throw new Error("unexpected hydration"); },
    pull: async (request: { workspaceId: string; cursor: number }) => { calls.pulls.push(request.cursor); calls.pullWorkspaces.push(request.workspaceId); calls.order.push("pull"); return pull(cursor); },
    push: async (request: { operations: WorkspaceOperation[] }) => {
      calls.order.push("push");
      const result = accepted(request.operations[0]!);
      calls.pushes.push(result);
      settle(result.results.filter(({ kind }) => kind === "accepted").map(({ operationId }) => operationId));
      return result;
    },
    negotiateUpload: async () => { throw new Error("unexpected upload negotiation"); },
    readLocalChunk: async () => { throw new Error("unexpected local chunk read"); },
    uploadChunk: async () => { calls.uploads++; calls.order.push("upload"); },
    listen: async (_signal: AbortSignal, receive: (event: { accountId: string; workspaceId: string; headSequence: number }) => void | Promise<void>) => {
      await receive({ accountId: id(50), workspaceId: WORKSPACE, headSequence: 1 });
      await receive({ accountId: ACCOUNT, workspaceId: WORKSPACE, headSequence: 1 });
    },
  } as unknown as NonNullable<Web2SyncRuntimeOptions["transport"]>;
  const options: Web2SyncRuntimeOptions = {
    accountId: ACCOUNT,
    directBlobOrigin: "https://objects.example",
    database: {
      getManifest: async () => undefined,
      getOrCreateDeviceId: async () => DEVICE,
      getSyncState: async () => ({ workspaceId: WORKSPACE, deviceId: DEVICE, cursor, lastHydrationAsOf: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 }),
      getWorkspaceBootstrapState: async () => undefined,
      completeRejectedDiscards: async (operationIds) => { calls.completed.push(...operationIds); },
      listUnsettledOperations: async (_workspaceId, afterRevision) => unsettled.filter(({ localRevision }) => localRevision > (afterRevision ?? 0)),
      listWorkspaces: async () => initialized ? [{ id: WORKSPACE, name: "Desktop", pinned: false, ordinal: 0, headSequence: cursor, snapshotBarrier: 0, logFloor: 0, localRevision: 0 }] : [],
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
      hydrate: async () => { calls.hydrated++; return []; },
      applyPull: async (value) => { cursor = value.cursor; calls.applied++; return { pull: value, changes: [] }; },
    },
    opfsRoot: {} as FileSystemDirectoryHandle,
    transport,
    randomUUID: () => id(10),
    retryDelayMs: 0,
    ...overrides,
  };
  return { runtime: createWeb2SyncRuntime(options), calls, transport, options, settle };
}

describe("Web2 synchronization runtime", () => {
  test("bootstraps once and wakes only for its account", async () => {
    const { runtime, calls } = setup([]);
    await runtime.bootstrap(WORKSPACE);
    expect(calls.bootstrap).toBe(1);
    let wakes = 0;
    await runtime.callbacks.listen!(new AbortController().signal, () => { wakes++; });
    expect(wakes).toBe(1);
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
    const rejected = { ...stored(rejectedSetting, ["setting:desktop-grid:grid-size"]), stateKind: "rejected" as const, rejection: { code: "quota", message: "Quota" } };
    const { runtime, calls, transport } = setup([stored(create, [`node:${id(12)}`]), rejected, stored(dependentSetting, ["setting:desktop-grid:grid-size"]), stored(setting, ["setting:desktop-grid:snap-to-grid"])]);
    let attempts = 0;
    transport.push = async (request) => {
      if (attempts++ === 0) throw new Web2HTTPError(503);
      expect(request.operations).toEqual([setting]);
      return { schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, results: [{ schemaVersion: WEB2_SCHEMA_VERSION, protocol: WEB2_SYNC_PROTOCOL, kind: "rejected", workspaceId: WORKSPACE, operationId: setting.operationId, code: "forbidden", message: "Denied" }] };
    };
    await runtime.bootstrap(WORKSPACE);
    await runtime.callbacks.synchronize(new AbortController().signal);
    expect(attempts).toBe(2);
    expect(calls.rejected).toEqual([{ operationId: setting.operationId, workspaceId: WORKSPACE, code: "forbidden", message: "Denied" }]);
    expect(calls.applied).toBe(3);
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
    base.transport.readLocalChunk = async () => new Blob(["hello"]);
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

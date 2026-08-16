import { hydrationTargetId, parseHydrationTarget, type HydrationTarget } from "../filesystem/hydration";
import { WEB2_SCHEMA_VERSION } from "../filesystem/model";
import type { ChangeRecord, FilesystemBootstrap, FilesystemPullOperations } from "../filesystem/database";
import type { HydrationStorage } from "../platform/storage/hydration-storage";
import {
  WEB2_SYNC_PROTOCOL,
  parseBootstrap,
  parseHydrationPage,
  parseHydrationRequest,
  parsePullResult,
  type Bootstrap,
  type HydrationPage,
  type HydrationRequest,
  type PullResult,
} from "./protocol";

export type HydrationPageRequester = (request: HydrationRequest, signal: AbortSignal) => Promise<unknown>;

export type HydrationCoordinator = {
  bootstrap(value: unknown, options?: { signal?: AbortSignal }): Promise<{ bootstrap: Bootstrap; changes: ChangeRecord[] }>;
  applyPull(value: unknown, options?: { signal?: AbortSignal }): Promise<{ pull: Extract<PullResult, { kind: "operations" }>; changes: ChangeRecord[] }>;
  hydrate(target: HydrationTarget, requestPage: HydrationPageRequester, options?: { restart?: boolean; signal?: AbortSignal }): Promise<ChangeRecord[]>;
  close(): Promise<void>;
};

function pageData(page: HydrationPage) {
  return {
    workspaceId: page.workspaceId,
    deviceId: page.deviceId,
    generationId: page.generationId,
    pageIndex: page.pageIndex,
    observedLogicalTime: page.observedLogicalTime,
    target: page.target,
    nodes: page.nodes,
    settings: page.settings,
    nextPageToken: page.nextPageToken,
  };
}

function bootstrapData(value: Bootstrap): FilesystemBootstrap {
  return {
    accountId: value.accountId,
    deviceId: value.deviceId,
    cursor: value.cursor,
    workspaces: value.workspaces,
    workspace: value.workspace,
    rootPage: pageData(value.rootPage),
    workspaceSettings: value.workspaceSettings,
  };
}

function pullData(value: Extract<PullResult, { kind: "operations" }>): FilesystemPullOperations {
  return {
    workspaceId: value.workspaceId,
    deviceId: value.deviceId,
    fromCursor: value.fromCursor,
    cursor: value.cursor,
    headSequence: value.headSequence,
    snapshotBarrier: value.snapshotBarrier,
    logFloor: value.logFloor,
    observedLogicalTime: value.observedLogicalTime,
    operations: value.operations,
  };
}

export function createHydrationCoordinator(storage: HydrationStorage, randomUUID: () => string = () => crypto.randomUUID()): HydrationCoordinator {
  if (!storage || typeof storage.bootstrap !== "function" || typeof storage.applyPull !== "function" || typeof storage.start !== "function" || typeof randomUUID !== "function") throw new TypeError("Hydration coordinator dependencies are invalid.");
  const closeController = new AbortController();
  const running = new Set<Promise<unknown>>();
  let closed = false;

  const hydrate = async (targetValue: HydrationTarget, requestPage: HydrationPageRequester, options: { restart?: boolean; signal?: AbortSignal } = {}) => {
    if (closed) throw new Error("The hydration coordinator is closed.");
    if (typeof requestPage !== "function" || options.restart !== undefined && typeof options.restart !== "boolean") throw new TypeError("Hydration coordination input is invalid.");
    const signal = options.signal ? AbortSignal.any([options.signal, closeController.signal]) : closeController.signal;
    signal.throwIfAborted();
    const target = parseHydrationTarget(targetValue);
    const targetId = hydrationTargetId(target);
    const generation = await storage.start(targetId, target, randomUUID, options.restart ?? false, signal);
    const recoverPublished = async () => await storage.getPublishedGeneration(target.workspaceId, targetId) === generation.generationId
      ? storage.publish(target.workspaceId, targetId, generation.generationId, signal)
      : undefined;
    let progress = await storage.getProgress(target.workspaceId, targetId, generation.generationId);
    if (!progress) {
      const recovered = await recoverPublished();
      if (recovered) return recovered;
      throw new Error("The hydration generation was superseded before it started.");
    }
    while (!progress.complete) {
      signal.throwIfAborted();
      const request = parseHydrationRequest({
        schemaVersion: WEB2_SCHEMA_VERSION,
        protocol: WEB2_SYNC_PROTOCOL,
        workspaceId: target.workspaceId,
        deviceId: generation.deviceId,
        generationId: generation.generationId,
        pageIndex: progress.nextPageIndex,
        target,
        pageToken: progress.pageToken,
      });
      const page = parseHydrationPage(await requestPage(request, signal));
      const complete = await storage.stage(targetId, request.pageToken, pageData(page), signal);
      const next = await storage.getProgress(target.workspaceId, targetId, generation.generationId);
      if (!next) {
        const recovered = await recoverPublished();
        if (recovered) return recovered;
        throw new Error("The hydration generation was superseded while receiving pages.");
      }
      if (next.nextPageIndex !== request.pageIndex + 1 || next.complete !== complete) throw new Error("The hydration generation was superseded while receiving pages.");
      progress = next;
    }
    signal.throwIfAborted();
    return storage.publish(target.workspaceId, targetId, generation.generationId, signal);
  };
  const bootstrap = async (value: unknown, options: { signal?: AbortSignal } = {}) => {
    if (closed) throw new Error("The hydration coordinator is closed.");
    const signal = options.signal ? AbortSignal.any([options.signal, closeController.signal]) : closeController.signal;
    signal.throwIfAborted();
    const parsed = parseBootstrap(value);
    const changes = await storage.bootstrap(bootstrapData(parsed), signal);
    return { bootstrap: parsed, changes };
  };
  const applyPull = async (value: unknown, options: { signal?: AbortSignal } = {}) => {
    if (closed) throw new Error("The hydration coordinator is closed.");
    const signal = options.signal ? AbortSignal.any([options.signal, closeController.signal]) : closeController.signal;
    signal.throwIfAborted();
    const parsed = parsePullResult(value);
    if (parsed.kind !== "operations") throw new Error("A reset pull requires reset hydration before publication.");
    const changes = await storage.applyPull(pullData(parsed), signal);
    return { pull: parsed, changes };
  };
  const track = <T>(task: Promise<T>) => {
    running.add(task);
    void task.finally(() => running.delete(task)).catch(() => undefined);
    return task;
  };

  return {
    bootstrap: (value, options) => track(bootstrap(value, options)),
    applyPull: (value, options) => track(applyPull(value, options)),
    hydrate: (target, requestPage, options) => track(hydrate(target, requestPage, options)),
    close: async () => {
      if (closed) return;
      closed = true;
      closeController.abort();
      await Promise.allSettled([...running]);
      storage.close();
    },
  };
}

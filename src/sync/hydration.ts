import { hydrationTargetId, parseHydrationTarget, type HydrationTarget } from "../filesystem/hydration";
import { WEB2_SCHEMA_VERSION } from "../filesystem/model";
import type { ChangeRecord, FilesystemBootstrap, FilesystemPullOperations, FilesystemReset, HydrationGeneration } from "../filesystem/database";
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
  applyPull(value: unknown, requestPageOrOptions?: HydrationPageRequester | { restart?: boolean; signal?: AbortSignal }, options?: { restart?: boolean; signal?: AbortSignal }): Promise<{ pull: PullResult; changes: ChangeRecord[] }>;
  hydrate(target: HydrationTarget, requestPage: HydrationPageRequester, options?: { restart?: boolean; signal?: AbortSignal }): Promise<ChangeRecord[]>;
  close(): Promise<void>;
};

/** Converts a hydration page to persisted node data. */
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

/** Converts bootstrap data to hydration pages. */
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

/** Converts pulled operations to hydration pages. */
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

/** Resets data. */
function resetData(value: Extract<PullResult, { kind: "reset" }>): FilesystemReset {
  return {
    workspaceId: value.workspaceId,
    deviceId: value.deviceId,
    fromCursor: value.fromCursor,
    cursor: value.cursor,
    headSequence: value.headSequence,
    snapshotBarrier: value.snapshotBarrier,
    logFloor: value.logFloor,
    observedLogicalTime: value.observedLogicalTime,
    resetBarrier: value.resetBarrier,
  };
}

/** Creates hydration coordinator. */
export function createHydrationCoordinator(storage: HydrationStorage, randomUUID: () => string = () => crypto.randomUUID()): HydrationCoordinator {
  if (!storage || typeof storage.bootstrap !== "function" || typeof storage.applyPull !== "function" || typeof storage.prepareReset !== "function" || typeof storage.restartResetHydration !== "function" || typeof storage.publishReset !== "function" || typeof storage.start !== "function" || typeof randomUUID !== "function") throw new TypeError("Hydration coordinator dependencies are invalid.");
  const closeController = new AbortController();
  const running = new Set<Promise<unknown>>();
  let closed = false;

  const receivePages = async (generation: HydrationGeneration, requestPage: HydrationPageRequester, signal: AbortSignal, recoverPublished?: () => Promise<ChangeRecord[] | undefined>) => {
    const targetId = hydrationTargetId(generation.target);
    let progress = await storage.getProgress(generation.workspaceId, targetId, generation.generationId);
    if (!progress) {
      const recovered = await recoverPublished?.();
      if (recovered) return recovered;
      throw new Error("The hydration generation was superseded before it started.");
    }
    while (!progress.complete) {
      signal.throwIfAborted();
      const request = parseHydrationRequest({
        schemaVersion: WEB2_SCHEMA_VERSION,
        protocol: WEB2_SYNC_PROTOCOL,
        workspaceId: generation.workspaceId,
        deviceId: generation.deviceId,
        generationId: generation.generationId,
        pageIndex: progress.nextPageIndex,
        target: generation.target,
        pageToken: progress.pageToken,
      });
      const page = parseHydrationPage(await requestPage(request, signal));
      const complete = await storage.stage(targetId, request.pageToken, pageData(page), signal);
      const next = await storage.getProgress(generation.workspaceId, targetId, generation.generationId);
      if (!next) {
        const recovered = await recoverPublished?.();
        if (recovered) return recovered;
        throw new Error("The hydration generation was superseded while receiving pages.");
      }
      if (next.nextPageIndex !== request.pageIndex + 1 || next.complete !== complete) throw new Error("The hydration generation was superseded while receiving pages.");
      progress = next;
    }
    return undefined;
  };

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
    const recovered = await receivePages(generation, requestPage, signal, recoverPublished);
    if (recovered) return recovered;
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
  const applyPull = async (value: unknown, requestPageOrOptions: HydrationPageRequester | { restart?: boolean; signal?: AbortSignal } = {}, suppliedOptions: { restart?: boolean; signal?: AbortSignal } = {}) => {
    if (closed) throw new Error("The hydration coordinator is closed.");
    const requestPage = typeof requestPageOrOptions === "function" ? requestPageOrOptions : undefined;
    const options = typeof requestPageOrOptions === "function" ? suppliedOptions : requestPageOrOptions;
    const signal = options.signal ? AbortSignal.any([options.signal, closeController.signal]) : closeController.signal;
    signal.throwIfAborted();
    const parsed = parsePullResult(value);
    if (parsed.kind === "operations") return { pull: parsed, changes: await storage.applyPull(pullData(parsed), signal) };
    if (!requestPage) throw new TypeError("A reset pull requires a hydration page requester.");
    const prepared = await storage.prepareReset(resetData(parsed), randomUUID, signal);
    if (prepared.kind === "published") return { pull: parsed, changes: prepared.changes };
    let plan = prepared.plan;
    let restart = options.restart ?? false;
    while (true) {
      for (let generation of plan.generations) {
        const targetId = hydrationTargetId(generation.target);
        const progress = await storage.getProgress(generation.workspaceId, targetId, generation.generationId);
        if (restart && progress && !progress.complete && progress.nextPageIndex > 0) {
          generation = await storage.restartResetHydration(plan.resetId, targetId, randomUUID, signal);
          restart = false;
        }
        const recovered = await receivePages(generation, requestPage, signal, async () => {
          const publication = await storage.publishReset(plan.resetId, randomUUID, signal);
          return publication.kind === "published" ? publication.changes : undefined;
        });
        if (recovered) return { pull: parsed, changes: recovered };
      }
      signal.throwIfAborted();
      const publication = await storage.publishReset(plan.resetId, randomUUID, signal);
      if (publication.kind === "published") return { pull: parsed, changes: publication.changes };
      plan = publication.plan;
    }
  };
  const track = <T>(task: Promise<T>) => {
    running.add(task);
    void task.finally(() => running.delete(task)).catch(() => undefined);
    return task;
  };

  return {
    bootstrap: (value, options) => track(bootstrap(value, options)),
    applyPull: (value, requestPageOrOptions, options) => track(applyPull(value, requestPageOrOptions, options)),
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

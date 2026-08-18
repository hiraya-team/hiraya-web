import {
  filesystemDatabaseName,
  openFilesystemDatabase,
  type ChangeRecord,
  type FilesystemBootstrap,
  type FilesystemDatabaseEnvironment,
  type FilesystemPullOperations,
  type FilesystemReset,
  type HydrationGeneration,
  type HydrationProgress,
  type ResetPreparation,
  type ResetPublication,
} from "../../filesystem/database";
import { hydrationTargetId, type HydrationPageData, type HydrationTarget } from "../../filesystem/hydration";
import { WEB2_SCHEMA_VERSION, parseStableId } from "../../filesystem/model";
import { filesystemRevisionChannelName, type FilesystemBroadcastChannel } from "./workspace-filesystem";

export type HydrationStorage = {
  bootstrap(value: FilesystemBootstrap, signal: AbortSignal): Promise<ChangeRecord[]>;
  applyPull(value: FilesystemPullOperations, signal: AbortSignal): Promise<ChangeRecord[]>;
  prepareReset(value: FilesystemReset, createGenerationId: () => string, signal: AbortSignal): Promise<ResetPreparation>;
  restartResetHydration(resetId: string, targetId: string, createGenerationId: () => string, signal: AbortSignal): Promise<HydrationGeneration>;
  publishReset(resetId: string, createGenerationId: () => string, signal: AbortSignal): Promise<ResetPublication>;
  start(targetId: string, target: HydrationTarget, createGenerationId: () => string, restart: boolean, signal: AbortSignal): Promise<HydrationGeneration>;
  getProgress(workspaceId: string, targetId: string, generationId: string): Promise<HydrationProgress | undefined>;
  getPublishedGeneration(workspaceId: string, targetId: string): Promise<string | undefined>;
  stage(targetId: string, requestPageToken: string | null, page: HydrationPageData, signal: AbortSignal): Promise<boolean>;
  publish(workspaceId: string, targetId: string, generationId: string, signal: AbortSignal): Promise<ChangeRecord[]>;
  close(): void;
};

export type HydrationStorageEnvironment = FilesystemDatabaseEnvironment & {
  locks?: Pick<LockManager, "request">;
  createBroadcastChannel?: (name: string) => FilesystemBroadcastChannel;
};

export async function openHydrationStorage(accountId: string, environment: HydrationStorageEnvironment): Promise<HydrationStorage> {
  const database = await openFilesystemDatabase(accountId, environment);
  try {
    const databaseName = await filesystemDatabaseName(environment.storageId);
    const locks = environment.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
    const createBroadcastChannel = environment.createBroadcastChannel ?? (typeof BroadcastChannel === "undefined" ? undefined : (name: string) => new BroadcastChannel(name));
    if (!locks || typeof locks.request !== "function" || typeof createBroadcastChannel !== "function") throw new Error("Web Locks and BroadcastChannel are required for hydration storage.");
    const revisions = createBroadcastChannel(filesystemRevisionChannelName(databaseName));
    const accountLock = `${databaseName}-storage`;
    let closed = false;
    const open = () => {
      if (closed) throw new Error("Hydration storage is closed.");
    };
    const withWorkspace = <T>(workspaceIdValue: string, signal: AbortSignal, operation: () => Promise<T>) => {
      const workspaceId = parseStableId(workspaceIdValue, "A workspace ID is invalid.");
      open();
      return locks.request(accountLock, { mode: "shared", signal }, () => locks.request(`${databaseName}-workspace-${workspaceId}`, { mode: "exclusive", signal }, operation));
    };
    const withAllWorkspaces = <T>(signal: AbortSignal, operation: () => Promise<T>) => locks.request(accountLock, { mode: "shared", signal }, async () => {
      const lockNames = (await database.listWorkspaces()).map(({ id }) => `${databaseName}-workspace-${id}`).sort();
      const acquire = (index: number): Promise<T> => index === lockNames.length ? operation() : locks.request(lockNames[index]!, { mode: "exclusive", signal }, () => acquire(index + 1));
      return acquire(0);
    });
    const notify = (change: ChangeRecord) => {
      try { revisions.postMessage({ schemaVersion: WEB2_SCHEMA_VERSION, workspaceId: change.workspaceId, revision: change.revision }); } catch { /* The durable change log remains authoritative. */ }
    };
    const notifyCatalog = () => {
      try { revisions.postMessage({ schemaVersion: WEB2_SCHEMA_VERSION, kind: "catalog-change" }); } catch { /* A later catalog read recovers a missed advisory wake-up. */ }
    };

    return {
      bootstrap: async (value, signal) => {
        open();
        const changes = await locks.request(accountLock, { mode: "exclusive", signal }, () => database.publishHydration(value.workspace.id, hydrationTargetId(value.rootPage.target), value.rootPage.generationId, value));
        notifyCatalog();
        changes.forEach(notify);
        return changes;
      },
      applyPull: (value, signal) => {
        open();
        return withAllWorkspaces(signal, async () => {
          const changes = await database.applyPullOperations(value);
          notifyCatalog();
          changes.forEach(notify);
          return changes;
        });
      },
      prepareReset: (value, createGenerationId, signal) => {
        open();
        return withAllWorkspaces(signal, async () => {
          const result = await database.prepareReset(value, createGenerationId);
          if (result.kind === "published") {
            notifyCatalog();
            result.changes.forEach(notify);
          }
          return result;
        });
      },
      restartResetHydration: (resetId, targetId, createGenerationId, signal) => {
        open();
        return withAllWorkspaces(signal, () => database.restartResetHydration(resetId, targetId, createGenerationId));
      },
      publishReset: (resetId, createGenerationId, signal) => {
        open();
        return withAllWorkspaces(signal, async () => {
          const result = await database.publishReset(resetId, createGenerationId);
          if (result.kind === "published") {
            notifyCatalog();
            result.changes.forEach(notify);
          }
          return result;
        });
      },
      start: (targetId, target, createGenerationId, restart, signal) => withWorkspace(target.workspaceId, signal, async () => {
        const sync = await database.getSyncState(target.workspaceId);
        const staged = restart ? undefined : await database.getHydrationGeneration(target.workspaceId, targetId);
        const coverage = restart || staged ? undefined : await database.getHydrationCoverage(target.workspaceId, targetId);
        const generation = staged?.deviceId === sync.deviceId && JSON.stringify(staged.target) === JSON.stringify(target) ? staged
          : coverage && JSON.stringify(coverage.target) === JSON.stringify(target) ? { workspaceId: target.workspaceId, deviceId: sync.deviceId, generationId: coverage.generationId, target }
            : { workspaceId: target.workspaceId, deviceId: sync.deviceId, generationId: createGenerationId(), target };
        if (coverage?.generationId === generation.generationId) return generation;
        await database.beginHydration(targetId, generation);
        return generation;
      }),
      getProgress: (workspaceId, targetId, generationId) => { open(); return database.getHydrationProgress(workspaceId, targetId, generationId); },
      getPublishedGeneration: async (workspaceId, targetId) => { open(); return (await database.getHydrationCoverage(workspaceId, targetId))?.generationId; },
      stage: (targetId, requestPageToken, page, signal) => withWorkspace(page.workspaceId, signal, () => database.stageHydrationPage(targetId, requestPageToken, page)),
      publish: (workspaceIdValue, targetId, generationId, signal) => {
        const workspaceId = parseStableId(workspaceIdValue, "A workspace ID is invalid.");
        open();
        return withAllWorkspaces(signal, async () => {
          const changes = await database.getHydrationCoverage(workspaceId, targetId).then((coverage) => coverage?.generationId === generationId ? database.getHydrationChanges(generationId) : database.publishHydration(workspaceId, targetId, generationId));
          changes.forEach(notify);
          return changes;
        });
      },
      close: () => {
        if (closed) return;
        closed = true;
        revisions.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

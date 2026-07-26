import { createStorageDbRequest, parseStorageProtocol, type StorageDbMethod, type StorageDbRequests, type StorageDbResponse, type StorageDbResponses } from "../../lib/opfs-db-protocol";
import { storageWorkerName } from "../../lib/storage-worker";
import { FRONTEND_ONLY, getActiveDesktopContext, getRoot, namespaceKey } from "./namespace";

type RpcPort = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<StorageDbResponse>) => void): void;
  start?: () => void;
  reset(): boolean;
};

let databasePort: Promise<RpcPort> | null = null;
let hostedDatabaseWorker: Worker | null = null;
let hostedDatabaseRequestId: number | null = null;
let requestId = 0;
const pendingRequests = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const OWNER_CHANGED_MESSAGE = "The local database owner changed. Retry the operation.";
const RETRYABLE_OWNER_CHANGE_METHODS = new Set<StorageDbMethod>(["status", "protocol", "listDesktops", "readDesktop", "readPreferences", "readWindowSession", "readOutbox", "listActivity", "listOfflinePins"]);
const DATABASE_REQUEST_TIMEOUT_MS = 15_000;

class LocalDatabaseOwnerChangedError extends Error {}
class LocalDatabaseTimeoutError extends Error {}

function openDatabasePort(): RpcPort {
  const key = namespaceKey();
  let port: RpcPort;
  if (typeof SharedWorker !== "undefined") {
    const shared = new SharedWorker(new URL("../../lib/opfs-shared.worker.ts", import.meta.url), { type: "module", name: storageWorkerName(FRONTEND_ONLY, key) });
    shared.port.addEventListener("message", (event) => {
      const message = event.data as { type?: string; requestId?: number; error?: string };
      if (message.type === "terminate-engine" && message.requestId === hostedDatabaseRequestId) {
        hostedDatabaseWorker?.terminate();
        hostedDatabaseWorker = null;
        hostedDatabaseRequestId = null;
        return;
      }
      if (message.type !== "need-engine" || message.requestId === undefined) return;
      if (hostedDatabaseWorker && hostedDatabaseRequestId === message.requestId) return;
      hostedDatabaseWorker?.terminate();
      const candidateRequestId = message.requestId;
      const worker = new Worker(new URL("../../lib/opfs-db.worker.ts", import.meta.url), { type: "module", name: FRONTEND_ONLY ? "hiraya-sqlite-engine" : `hiraya-sqlite-engine-${key}` });
      hostedDatabaseRequestId = candidateRequestId;
      hostedDatabaseWorker = worker;
      const channel = new MessageChannel();
      let failed = false;
      const fail = (error: string) => {
        if (failed) return;
        failed = true;
        worker.terminate();
        channel.port2.close();
        if (hostedDatabaseWorker === worker) {
          hostedDatabaseWorker = null;
          hostedDatabaseRequestId = null;
        }
        shared.port.postMessage({ type: "engine-failed", requestId: candidateRequestId, error });
      };
      channel.port2.onmessage = (message: MessageEvent<{ type?: string; error?: string }>) => {
        if (message.data.type === "engine-error") {
          fail(message.data.error ?? "The local database engine could not start.");
          return;
        }
        if (message.data.type !== "engine-ready") return;
        failed = true;
        channel.port2.onmessage = null;
        if (hostedDatabaseWorker !== worker) {
          channel.port2.close();
          return;
        }
        shared.port.postMessage({ type: "attach-engine", requestId: candidateRequestId, port: channel.port2 }, [channel.port2]);
      };
      worker.addEventListener("error", (workerError) => {
        workerError.preventDefault();
        fail(workerError.message || "The local database worker failed to load.");
      });
      worker.addEventListener("messageerror", () => fail("The local database worker sent an invalid startup message."));
      channel.port2.start();
      worker.postMessage({ type: "attach", storage: key, port: channel.port1 }, [channel.port1]);
    });
    shared.port.postMessage({ type: "configure-storage", storage: key });
    window.addEventListener("pagehide", () => {
      if (!hostedDatabaseWorker || hostedDatabaseRequestId === null) return;
      const releasedRequestId = hostedDatabaseRequestId;
      hostedDatabaseWorker.terminate();
      hostedDatabaseWorker = null;
      hostedDatabaseRequestId = null;
      shared.port.postMessage({ type: "release-engine", requestId: releasedRequestId });
    });
    port = {
      postMessage: (message, transfer) => shared.port.postMessage(message, transfer ?? []),
      addEventListener: (type, listener) => shared.port.addEventListener(type, listener),
      start: () => shared.port.start(),
      reset: () => {
        hostedDatabaseWorker?.terminate();
        hostedDatabaseWorker = null;
        hostedDatabaseRequestId = null;
        shared.port.postMessage({ type: "reset-engine" });
        return false;
      },
    };
  } else {
    const worker = new Worker(new URL("../../lib/opfs-db.worker.ts", import.meta.url), { type: "module", name: FRONTEND_ONLY ? "hiraya-storage-fallback" : `hiraya-storage-fallback-${key}` });
    worker.postMessage({ type: "configure-storage", storage: key });
    port = {
      postMessage: (message, transfer) => worker.postMessage(message, transfer ?? []),
      addEventListener: (type, listener) => worker.addEventListener(type, listener),
      reset: () => {
        worker.terminate();
        return true;
      },
    };
  }
  port.addEventListener("message", (event) => {
    const response = event.data;
    const pending = pendingRequests.get(response.id);
    if (!pending) return;
    pendingRequests.delete(response.id);
    if (response.error) pending.reject(response.error === OWNER_CHANGED_MESSAGE ? new LocalDatabaseOwnerChangedError(response.error) : new Error(response.error));
    else pending.resolve(response.result);
  });
  port.start?.();
  return port;
}

export async function callDatabase<M extends StorageDbMethod>(method: M, params: StorageDbRequests[M], desktopId: string | null = getActiveDesktopContext()): Promise<StorageDbResponses[M]> {
  await getRoot();
  for (let attempt = 0; ; attempt += 1) {
    const connection = databasePort ??= Promise.resolve().then(openDatabasePort);
    const port = await connection;
    try {
      const id = ++requestId;
      return await new Promise<StorageDbResponses[M]>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          if (!pendingRequests.delete(id)) return;
          if (port.reset() && databasePort === connection) databasePort = null;
          const error = new LocalDatabaseTimeoutError("Local storage stopped responding. Please retry the operation.");
          for (const pending of [...pendingRequests.values()]) pending.reject(error);
          pendingRequests.clear();
          reject(error);
        }, DATABASE_REQUEST_TIMEOUT_MS);
        pendingRequests.set(id, {
          resolve: (value) => {
            window.clearTimeout(timeout);
            resolve(value as StorageDbResponses[M]);
          },
          reject: (error) => {
            window.clearTimeout(timeout);
            reject(error);
          },
        });
        port.postMessage(createStorageDbRequest(id, desktopId, method, params));
      });
    } catch (error) {
      if (!(error instanceof LocalDatabaseOwnerChangedError || error instanceof LocalDatabaseTimeoutError) || attempt > 0 || !RETRYABLE_OWNER_CHANGE_METHODS.has(method)) throw error;
    }
  }
}

export async function initializeDatabase() {
  await getRoot();
  await callDatabase("status", undefined);
  parseStorageProtocol(await callDatabase("protocol", undefined, null));
}

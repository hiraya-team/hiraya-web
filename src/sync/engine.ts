import { filesystemDatabaseName } from "../filesystem/database";
import { WEB2_SCHEMA_VERSION, isRecord } from "../filesystem/model";
import {
  filesystemRevisionChannelName,
  parseRevisionNotification,
  type FilesystemBroadcastChannel,
} from "../platform/storage/workspace-filesystem";

export type AccountSyncClient = {
  wake(): void;
  close(): Promise<void>;
};

export type AccountSyncCallbacks = {
  /** Runs under the leader lock. Return after abort; do not await this client's close() from the callback. */
  synchronize(signal: AbortSignal): Promise<void>;
  /** Owns the leader's event stream. Return after abort; do not await this client's close() from the callback. */
  listen?(signal: AbortSignal, wake: () => void): Promise<void>;
  onError?(error: unknown): void | Promise<void>;
};

export type AccountSyncEnvironment = {
  locks?: Pick<LockManager, "request">;
  createBroadcastChannel?: (name: string) => FilesystemBroadcastChannel;
  leadershipRetryMs?: number;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isSyncWake(value: unknown) {
  return isRecord(value) && value.schemaVersion === WEB2_SCHEMA_VERSION && value.kind === "sync-wake" && Object.keys(value).length === 2;
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

export async function openAccountSyncClient(accountId: string, callbacks: AccountSyncCallbacks, environment: AccountSyncEnvironment = {}): Promise<AccountSyncClient> {
  if (!callbacks || typeof callbacks.synchronize !== "function" || callbacks.listen !== undefined && typeof callbacks.listen !== "function" || callbacks.onError !== undefined && typeof callbacks.onError !== "function") throw new TypeError("Account synchronization callbacks are invalid.");
  const databaseName = await filesystemDatabaseName(accountId);
  const locks = environment.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
  const createBroadcastChannel = environment.createBroadcastChannel ?? (typeof BroadcastChannel === "undefined" ? undefined : (name: string) => new BroadcastChannel(name));
  if (!locks || typeof locks.request !== "function" || typeof createBroadcastChannel !== "function") throw new Error("Web Locks and BroadcastChannel are required for account synchronization.");
  const leadershipRetryMs = environment.leadershipRetryMs ?? 1_000;
  if (!Number.isSafeInteger(leadershipRetryMs) || leadershipRetryMs < 0) throw new Error("The synchronization leadership retry delay is invalid.");

  const channel = createBroadcastChannel(filesystemRevisionChannelName(databaseName));
  const lockAbort = new AbortController();
  let resolveClose!: () => void;
  const closeRequested = new Promise<void>((resolve) => { resolveClose = resolve; });
  let closed = false;
  let leaderAbort: AbortController | undefined;
  let leaderWake: (() => void) | undefined;
  const report = (error: unknown) => {
    try { void Promise.resolve(callbacks.onError?.(error)).catch(() => undefined); } catch { /* Error reporting must not stop later synchronization. */ }
  };
  const onRevision = (event: MessageEvent<unknown>) => {
    if (parseRevisionNotification(event.data) || isSyncWake(event.data)) leaderWake?.();
  };
  channel.addEventListener("message", onRevision);

  const leadership = (async () => {
    while (!closed) {
      try {
        await locks.request(`${databaseName}-sync-leader`, { mode: "exclusive", signal: lockAbort.signal }, async () => {
          if (closed) return;
          const controller = new AbortController();
          leaderAbort = controller;
          let pending = false;
          let running: Promise<void> | undefined;
          const wake = () => {
            if (closed || controller.signal.aborted) return;
            pending = true;
            if (running) return;
            running = Promise.resolve().then(async () => {
              while (pending && !controller.signal.aborted) {
                pending = false;
                try {
                  await callbacks.synchronize(controller.signal);
                } catch (error) {
                  if (!controller.signal.aborted || !isAbortError(error)) report(error);
                }
              }
            }).finally(() => {
              running = undefined;
              if (pending && !controller.signal.aborted) wake();
            });
          };
          leaderWake = wake;
          const events = callbacks.listen
            ? Promise.resolve().then(() => callbacks.listen!(controller.signal, wake)).then(
              () => ({ kind: "ended" as const }),
              (error) => ({ kind: "error" as const, error }),
            )
            : undefined;
          wake();
          if (events) {
            const outcome = await Promise.race([closeRequested.then(() => ({ kind: "closed" as const })), events]);
            if (!closed && outcome.kind === "ended") report(new Error("The synchronization event listener ended unexpectedly."));
            if (!closed && outcome.kind === "error") report(outcome.error);
          } else {
            await closeRequested;
          }
          controller.abort();
          await running;
          if (events) await events;
          if (leaderWake === wake) leaderWake = undefined;
          if (leaderAbort === controller) leaderAbort = undefined;
        });
      } catch (error) {
        if (closed && isAbortError(error)) break;
        report(error);
      }
      if (!closed) await wait(leadershipRetryMs, lockAbort.signal);
    }
  })();

  return {
    wake: () => {
      if (leaderWake) { leaderWake(); return; }
      try { channel.postMessage({ schemaVersion: WEB2_SCHEMA_VERSION, kind: "sync-wake" }); } catch { /* A promoted leader always performs an unconditional catch-up. */ }
    },
    close: async () => {
      if (closed) return leadership;
      closed = true;
      channel.removeEventListener("message", onRevision);
      channel.close();
      leaderAbort?.abort();
      lockAbort.abort();
      resolveClose();
      await leadership;
    },
  };
}

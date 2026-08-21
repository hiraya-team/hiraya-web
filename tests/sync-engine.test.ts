import { expect, test } from "bun:test";
import { filesystemDatabaseName } from "../src/filesystem/database";
import { openAccountSyncClient } from "../src/sync/engine";
import { filesystemRevisionChannelName, type FilesystemBroadcastChannel } from "../src/platform/storage/workspace-filesystem";

/** Provides the account test fixture. */
const ACCOUNT = stableId(1);

/** Builds the stable ID test fixture. */
function stableId(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

/** Builds the deferred test fixture. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Builds the wait for test fixture. */
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for synchronization state.");
}

/** Implements an in-memory BroadcastChannel test double. */
class TestBroadcastChannels {
  private readonly channels = new Map<string, Set<Set<(event: MessageEvent<unknown>) => void>>>();

  readonly create = (name: string): FilesystemBroadcastChannel => {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const peers = this.channels.get(name) ?? new Set();
    let closed = false;
    peers.add(listeners);
    this.channels.set(name, peers);
    return {
      postMessage: (value: unknown) => {
        if (closed) throw new Error("The broadcast channel is closed.");
        for (const peer of peers) if (peer !== listeners) setTimeout(() => {
          if (peers.has(peer)) for (const listener of peer) listener({ data: value } as MessageEvent<unknown>);
        }, 0);
      },
      addEventListener: ((type: string, listener: (event: MessageEvent<unknown>) => void) => { if (!closed && type === "message") listeners.add(listener); }) as BroadcastChannel["addEventListener"],
      removeEventListener: ((type: string, listener: (event: MessageEvent<unknown>) => void) => { if (type === "message") listeners.delete(listener); }) as BroadcastChannel["removeEventListener"],
      close: () => {
        if (closed) return;
        closed = true;
        peers.delete(listeners);
        if (peers.size === 0) this.channels.delete(name);
      },
    };
  };

  /** Broadcasts a value to test channel peers. */
  broadcast(name: string, value: unknown) {
    const peers = this.channels.get(name);
    if (peers) for (const listeners of peers) setTimeout(() => {
      if (peers.has(listeners)) for (const listener of listeners) listener({ data: value } as MessageEvent<unknown>);
    }, 0);
  }
}

type LockEntry = {
  callback: (lock: Lock) => Promise<unknown> | unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  started: boolean;
  onAbort: () => void;
};

/** Implements an in-memory leader-lock test double. */
class TestLeaderLocks {
  readonly acquisitions: string[] = [];
  activeCount = 0;
  maxActiveCount = 0;
  private readonly states = new Map<string, { active: boolean; queue: LockEntry[] }>();

  /** Queues a test lock request. */
  request<T>(name: string, options: LockOptions, callback: (lock: Lock) => Promise<T> | T): Promise<T> {
    const state = this.states.get(name) ?? { active: false, queue: [] };
    this.states.set(name, state);
    return new Promise<T>((resolve, reject) => {
      const entry: LockEntry = {
        callback,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal: options.signal,
        started: false,
        onAbort: () => {
          if (entry.started) return;
          const index = state.queue.indexOf(entry);
          if (index !== -1) state.queue.splice(index, 1);
          reject(entry.signal?.reason ?? new DOMException("The lock request was aborted.", "AbortError"));
        },
      };
      if (entry.signal?.aborted) { entry.onAbort(); return; }
      entry.signal?.addEventListener("abort", entry.onAbort, { once: true });
      state.queue.push(entry);
      this.drain(name);
    });
  }

  /** Starts the next queued test lock request. */
  private drain(name: string) {
    const state = this.states.get(name)!;
    if (state.active || state.queue.length === 0) return;
    const entry = state.queue.shift()!;
    entry.started = true;
    entry.signal?.removeEventListener("abort", entry.onAbort);
    state.active = true;
    this.activeCount += 1;
    this.maxActiveCount = Math.max(this.maxActiveCount, this.activeCount);
    this.acquisitions.push(name);
    void Promise.resolve().then(() => entry.callback({ name, mode: "exclusive" } as Lock)).then(entry.resolve, entry.reject).finally(() => {
      state.active = false;
      this.activeCount -= 1;
      this.drain(name);
    });
  }
}

/** Builds the event stream test fixture. */
function eventStream(onActive: (delta: number) => void) {
  return (signal: AbortSignal) => {
    onActive(1);
    return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })).finally(() => onActive(-1));
  };
}

test("elects one account leader, coalesces wakes, drains work, and catches up after failover", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  const firstRuns: ReturnType<typeof deferred>[] = [];
  let secondRuns = 0;
  let streams = 0;
  let maxStreams = 0;
  const trackStream = (delta: number) => { streams += delta; maxStreams = Math.max(maxStreams, streams); };
  const environment = { locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create };
  const first = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => {
      const gate = deferred();
      firstRuns.push(gate);
      await gate.promise;
    },
    listen: eventStream(trackStream),
  }, environment);
  const second = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => { secondRuns += 1; },
    listen: eventStream(trackStream),
  }, environment);
  await waitFor(() => firstRuns.length === 1 && streams === 1);
  expect(secondRuns).toBe(0);

  second.wake();
  second.wake();
  second.wake();
  await new Promise((resolve) => setTimeout(resolve, 5));
  firstRuns[0]!.resolve();
  await waitFor(() => firstRuns.length === 2);
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(firstRuns).toHaveLength(2);

  const closing = first.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(secondRuns).toBe(0);
  firstRuns[1]!.resolve();
  await closing;
  await waitFor(() => secondRuns === 1 && streams === 1);
  expect(maxStreams).toBe(1);
  expect(locks.acquisitions.filter((name) => name.endsWith("-sync-leader"))).toHaveLength(2);
  await second.close();
  expect(streams).toBe(0);
});

test("wakes the leader from workspace revision and catalog notifications", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  let runs = 0;
  const client = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => { runs += 1; },
  }, { locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create });
  await waitFor(() => runs === 1);
  broadcasts.broadcast(filesystemRevisionChannelName(await filesystemDatabaseName(ACCOUNT)), { schemaVersion: 1, workspaceId: stableId(2), revision: 1 });
  await waitFor(() => runs === 2);
  broadcasts.broadcast(filesystemRevisionChannelName(await filesystemDatabaseName(ACCOUNT)), { schemaVersion: 1, kind: "catalog-change" });
  await waitFor(() => runs === 3);
  await client.close();
});

test("ignores revision and catalog notifications emitted by remote hydration", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  let runs = 0;
  const client = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => { runs += 1; },
  }, { locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create });
  await waitFor(() => runs === 1);
  const channel = filesystemRevisionChannelName(await filesystemDatabaseName(ACCOUNT));
  broadcasts.broadcast(channel, { schemaVersion: 1, workspaceId: stableId(2), revision: 1, source: "remote" });
  broadcasts.broadcast(channel, { schemaVersion: 1, kind: "catalog-change", source: "remote" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(runs).toBe(1);
  await client.close();
});

test("releases leadership when the event listener fails and promotes a queued client", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  const listenerFailure = deferred();
  const errors: unknown[] = [];
  let firstRuns = 0;
  let secondRuns = 0;
  const environment = { locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create, leadershipRetryMs: 0 };
  const first = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => { firstRuns += 1; },
    listen: async () => { await listenerFailure.promise; throw new Error("event stream failed"); },
    onError: (error) => errors.push(error),
  }, environment);
  const second = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => { secondRuns += 1; },
    listen: eventStream(() => undefined),
  }, environment);
  await waitFor(() => firstRuns === 1);
  listenerFailure.resolve();
  await waitFor(() => errors.length === 1 && secondRuns === 1);
  expect((errors[0] as Error).message).toBe("event stream failed");
  await first.close();
  await second.close();
});

test("serializes a synchronously reentrant wake", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  let triggerWake: (() => void) | undefined;
  let runs = 0;
  let active = 0;
  let maxActive = 0;
  const client = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (runs === 0) triggerWake?.();
      await Promise.resolve();
      runs += 1;
      active -= 1;
    },
    listen: async (signal, wake) => {
      triggerWake = wake;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  }, { locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create });
  await waitFor(() => runs === 2);
  expect(maxActive).toBe(1);
  await client.close();
});

test("reports a failed cycle without disabling later wakes", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  const errors: unknown[] = [];
  let runs = 0;
  const client = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => {
      runs += 1;
      if (runs === 1) throw new Error("injected sync failure");
    },
    onError: (error) => errors.push(error),
  }, { locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create });
  await waitFor(() => runs === 1 && errors.length === 1);
  client.wake();
  await waitFor(() => runs === 2);
  expect((errors[0] as Error).message).toBe("injected sync failure");
  await client.close();
});

test("reports a lock request failure and retries leadership", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  const errors: unknown[] = [];
  let requests = 0;
  let runs = 0;
  const flakyLocks = {
    request: (...args: Parameters<TestLeaderLocks["request"]>) => {
      requests += 1;
      if (requests === 1) return Promise.reject(new DOMException("Injected lock failure", "InvalidStateError"));
      return locks.request(...args);
    },
  };
  const client = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => { runs += 1; },
    onError: (error) => errors.push(error),
  }, { locks: flakyLocks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create, leadershipRetryMs: 0 });
  await waitFor(() => errors.length === 1 && runs === 1);
  expect((errors[0] as DOMException).name).toBe("InvalidStateError");
  await client.close();
});

test("observes a rejected async error reporter", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  let runs = 0;
  const client = await openAccountSyncClient(ACCOUNT, {
    synchronize: async () => { runs += 1; throw new Error("cycle failed"); },
    onError: async () => { throw new Error("reporter failed"); },
  }, { locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create });
  await waitFor(() => runs === 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await client.close();
});

test("allows different account leaders concurrently and aborts a queued follower cleanly", async () => {
  const locks = new TestLeaderLocks();
  const broadcasts = new TestBroadcastChannels();
  const firstGate = deferred();
  const otherGate = deferred();
  let firstRuns = 0;
  let otherRuns = 0;
  let followerRuns = 0;
  const environment = { locks: locks as unknown as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create };
  const first = await openAccountSyncClient(ACCOUNT, { synchronize: async () => { firstRuns += 1; await firstGate.promise; } }, environment);
  const follower = await openAccountSyncClient(ACCOUNT, { synchronize: async () => { followerRuns += 1; } }, environment);
  const other = await openAccountSyncClient(stableId(9), { synchronize: async () => { otherRuns += 1; await otherGate.promise; } }, environment);
  await waitFor(() => firstRuns === 1 && otherRuns === 1);
  expect(locks.maxActiveCount).toBe(2);
  await follower.close();
  expect(followerRuns).toBe(0);

  const closing = Promise.all([first.close(), other.close()]);
  firstGate.resolve();
  otherGate.resolve();
  await closing;
  expect(locks.activeCount).toBe(0);
});

test("requires valid callbacks, Web Locks, and BroadcastChannel", async () => {
  const broadcasts = new TestBroadcastChannels();
  await expect(openAccountSyncClient(ACCOUNT, {} as never, { locks: {} as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create })).rejects.toThrow("callbacks");
  await expect(openAccountSyncClient(ACCOUNT, { synchronize: async () => undefined }, { locks: {} as Pick<LockManager, "request">, createBroadcastChannel: broadcasts.create })).rejects.toThrow("required");
  await expect(openAccountSyncClient(ACCOUNT, { synchronize: async () => undefined }, { locks: new TestLeaderLocks() as unknown as Pick<LockManager, "request">, createBroadcastChannel: 0 as never })).rejects.toThrow("required");
});

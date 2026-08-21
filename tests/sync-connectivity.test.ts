import { expect, test } from "bun:test";
import { SyncConnectivity } from "../src/platform/sync/connectivity";

/** Implements an EventSource test double. */
class TestEventSource {
  static latest: TestEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Creates a test event source instance. */
  constructor(readonly url: string) { TestEventSource.latest = this; }
  /** Registers a listener on the test event source. */
  addEventListener() {}
  /** Marks the test event source as closed. */
  close() {}
}

test("polls only while SSE is disconnected and stops after it reopens", async () => {
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const setTimeoutImpl = ((callback: () => void, delay: number) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  }) as typeof globalThis.setTimeout;
  const clearTimeoutImpl = ((id: number) => { timers.delete(id); }) as typeof globalThis.clearTimeout;
  let checks = 0;
  let finish!: () => void;
  const connectivity = new SyncConnectivity(TestEventSource as unknown as typeof EventSource, setTimeoutImpl, clearTimeoutImpl, "/events");
  connectivity.start({
    onOpen: () => undefined,
    onError: () => undefined,
    onCatalog: () => undefined,
    onPoll: async () => { checks += 1; await new Promise<void>((resolve) => { finish = resolve; }); },
  });

  expect(timers.size).toBe(0);
  TestEventSource.latest?.onerror?.();
  TestEventSource.latest?.onerror?.();
  await Promise.resolve();
  expect(checks).toBe(1);
  expect(timers.size).toBe(0);

  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect([...timers.values()]).toEqual([{ callback: expect.any(Function), delay: 5_000 }]);
  TestEventSource.latest?.onopen?.();
  expect(timers.size).toBe(0);
  connectivity.stop();
});

test("does not reschedule a completed probe from a stopped generation", async () => {
  let timerId = 0;
  const timers = new Map<number, () => void>();
  let finish!: () => void;
  const connectivity = new SyncConnectivity(
    undefined,
    ((callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; }) as typeof globalThis.setTimeout,
    ((id: number) => { timers.delete(id); }) as typeof globalThis.clearTimeout,
    "/events",
  );
  connectivity.start({ onOpen: () => undefined, onError: () => undefined, onCatalog: () => undefined, onPoll: () => new Promise<void>((resolve) => { finish = resolve; }) });
  const [id, callback] = [...timers.entries()][0];
  timers.delete(id);
  callback();
  await Promise.resolve();
  connectivity.stop();
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(timers.size).toBe(0);
});

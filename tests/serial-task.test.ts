import { describe, expect, test } from "bun:test";
import { createLatestTaskQueue, createSerialTaskQueue } from "../src/lib/serial-task";
import { mergeDesktopLayout } from "../src/lib/outbox";
import { DEFAULT_WALLPAPER, type DesktopLayout } from "../src/types";

describe("serial task queue", () => {
  test("runs activations strictly in arrival order with unique monotonic tokens", async () => {
    const queue = createSerialTaskQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = queue.run(async (token) => {
      events.push(`start:${token}:one`);
      await firstGate;
      events.push(`finish:${token}:one`);
      return "one";
    });
    const second = queue.run(async (token) => {
      events.push(`start:${token}:two`);
      events.push(`finish:${token}:two`);
      return "two";
    });

    await Promise.resolve();
    expect(events).toEqual(["start:1:one"]);
    releaseFirst();
    expect(await Promise.all([first, second])).toEqual(["one", "two"]);
    expect(events).toEqual(["start:1:one", "finish:1:one", "start:2:two", "finish:2:two"]);
    await queue.drain();
  });

  test("continues deterministically after a rejected activation", async () => {
    const queue = createSerialTaskQueue();
    const tokens: number[] = [];
    const failed = queue.run(async (token) => { tokens.push(token); throw new Error("failed"); });
    const recovered = queue.run(async (token) => { tokens.push(token); return "recovered"; });
    await expect(failed).rejects.toThrow("failed");
    expect(await recovered).toBe("recovered");
    expect(tokens).toEqual([1, 2]);
  });
});

test("coalesces delayed saves and never lets an older save finish last", async () => {
  const saved: number[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const queue = createLatestTaskQueue<number>(async (value) => {
    saved.push(value);
    if (value === 1) await firstGate;
  });

  const first = queue.run(1);
  await Bun.sleep(1);
  const second = queue.run(2);
  const latest = queue.run(3);
  await Bun.sleep(1);
  expect(saved).toEqual([1]);
  releaseFirst();
  await Promise.all([first, second, latest]);
  expect(saved).toEqual([1, 3]);
});

test("merges remote layout changes into a delayed draft without changing its base", async () => {
  const base: DesktopLayout = { autoArrangeIcons: true, snapToGrid: false, gridSize: 24, wallpaper: DEFAULT_WALLPAPER, widgets: [{ id: "clock", kind: "clock", x: 10, y: 10, width: 220, height: 150 }], iconGroups: [] };
  const saved: Array<{ base: DesktopLayout; layout: DesktopLayout }> = [];
  const queue = createLatestTaskQueue<{ base: DesktopLayout; layout: DesktopLayout }>(async (draft) => { saved.push(draft); }, 20);
  const draft = { base, layout: { ...base, widgets: [{ ...base.widgets[0], x: 30 }] } };
  void queue.run(draft);
  const remote = { ...base, wallpaper: { ...base.wallpaper, dim: 0.4 }, widgets: [{ ...base.widgets[0], y: 40 }, { id: "calendar", kind: "calendar" as const, x: 300, y: 10, width: 220, height: 150 }] };
  const merged = { ...draft, layout: mergeDesktopLayout(draft.base, draft.layout, remote) };
  await queue.run(merged);

  expect(saved).toEqual([merged]);
  expect(saved[0].base).toBe(base);
  expect(saved[0].layout).toMatchObject({ wallpaper: { dim: 0.4 }, widgets: [{ id: "clock", x: 30, y: 10 }, { id: "calendar", x: 300 }] });
});

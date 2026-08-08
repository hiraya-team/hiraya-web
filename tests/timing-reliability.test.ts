import { describe, expect, test } from "bun:test";
import { waitForAnimations } from "../src/ui/animation-completion";
import { EDGE_DWELL_MS, resetEdgeDwell, updateEdgeDwell, type EdgeDwellState } from "../src/ui/edge-entry";
import { writeClipboardText } from "../src/ui/clipboard-copy";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function rejectable() {
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((_, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

describe("desktop timing reliability", () => {
  test("an edge dwell restarts across edges, fires once, and resets after leaving", () => {
    const state: EdgeDwellState = { direction: null, latched: false, timer: null };
    const callbacks = new Map<number, () => void>();
    const delays = new Map<number, number>();
    const changes: Array<string | null> = [];
    const ready: string[] = [];
    let nextTimer = 0;
    const timers = {
      set: (callback: () => void, delay: number) => {
        const timer = ++nextTimer;
        callbacks.set(timer, callback);
        delays.set(timer, delay);
        return timer;
      },
      clear: (timer: number) => {
        callbacks.delete(timer);
      },
    };

    updateEdgeDwell(state, "left", (direction) => ready.push(direction), (direction) => changes.push(direction), timers);
    expect(delays.get(1)).toBe(EDGE_DWELL_MS);
    updateEdgeDwell(state, "left", (direction) => ready.push(direction), (direction) => changes.push(direction), timers);
    expect(nextTimer).toBe(1);

    updateEdgeDwell(state, "up", (direction) => ready.push(direction), (direction) => changes.push(direction), timers);
    expect(callbacks.has(1)).toBe(false);
    callbacks.get(2)?.();
    expect(ready).toEqual(["up"]);
    expect(changes).toEqual(["left", "up", null]);

    updateEdgeDwell(state, "right", (direction) => ready.push(direction), (direction) => changes.push(direction), timers);
    expect(nextTimer).toBe(2);
    updateEdgeDwell(state, null, (direction) => ready.push(direction), (direction) => changes.push(direction), timers);
    updateEdgeDwell(state, "right", (direction) => ready.push(direction), (direction) => changes.push(direction), timers);
    expect(nextTimer).toBe(3);
    resetEdgeDwell(state, (direction) => changes.push(direction), timers);
    expect(callbacks.has(3)).toBe(false);
  });

  test("clipboard rejection resolves as visible-feedback input instead of rejecting", async () => {
    const clipboard = {
      writeText: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    };

    expect(await writeClipboardText(clipboard, "https://example.test/share")).toBe(false);
  });

  test("animation completion is immediate when CSS created no animations", () => {
    let completed = false;
    waitForAnimations([{ getAnimations: () => [] }], () => {
      completed = true;
    });

    expect(completed).toBe(true);
  });

  test("animation completion waits for every actual animation and can be generation-cancelled", async () => {
    const first = deferred();
    const second = deferred();
    let completions = 0;
    const host = {
      getAnimations: () => [
        { finished: first.promise },
        { finished: second.promise },
      ] as Animation[],
    };
    const stop = waitForAnimations([host], () => {
      completions += 1;
    });

    first.resolve();
    await Promise.resolve();
    expect(completions).toBe(0);
    stop();
    second.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(completions).toBe(0);
  });

  test("animation completion runs once after every actual animation finishes", async () => {
    const first = deferred();
    const second = deferred();
    const animations = [
      { finished: first.promise },
      { finished: second.promise },
    ] as Animation[];
    let completions = 0;
    waitForAnimations([{
      getAnimations: () => animations,
    }], () => {
      completions += 1;
    });

    first.resolve();
    await Promise.resolve();
    expect(completions).toBe(0);
    second.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(completions).toBe(1);
  });

  test("a cancelled animation waits for its replacement before completing", async () => {
    const interrupted = rejectable();
    const replacement = deferred();
    const first = { finished: interrupted.promise } as Animation;
    const second = { finished: replacement.promise } as Animation;
    let animations = [first];
    let completions = 0;
    waitForAnimations([{ getAnimations: () => animations }], () => {
      completions += 1;
    });

    animations = [second];
    interrupted.reject(new DOMException("Interrupted", "AbortError"));
    await Promise.resolve();
    await Promise.resolve();
    expect(completions).toBe(0);
    replacement.resolve();
    animations = [];
    await Promise.resolve();
    await Promise.resolve();
    expect(completions).toBe(1);
  });

  test("components guard async and direct-style cleanup by committed generations", async () => {
    const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    const fileIcon = await Bun.file(new URL("../src/components/FileIcon.tsx", import.meta.url)).text();
    const search = await Bun.file(new URL("../src/components/SearchCommandPalette.tsx", import.meta.url)).text();
    const sharing = await Bun.file(new URL("../src/components/SharingDialog.tsx", import.meta.url)).text();

    expect(app).toContain("waitForAnimations([...hosts]");
    expect(app).toContain("AREA_TRANSITION_WATCHDOG_MS");
    expect(app).not.toContain("500 * activeTheme.motion");
    expect(app).not.toContain("now - edgeDragRef.current.time < 520");
    expect(fileIcon).not.toContain("requestAnimationFrame(cleanUp)");
    expect(fileIcon).toContain("current.moveSucceeded");
    expect(search).toContain("searchGenerationRef.current === generation");
    expect(app).toContain("const pendingWallpaper = wallpaperPreviewRef.current");
    expect(app).toContain("layoutSaveQueue.run(pendingLayout)");
    expect(app).toContain("mergeDesktopLayout(draft.baseLayout, draft.layout, synced.layout)");
    expect(app).toContain("layoutDraftRef.current.layout === next");
    expect(sharing).toContain("copyGenerationRef.current !== generation");
    expect(sharing).toContain("copiedTimerRef.current === timer");
    expect(sharing).toContain('role={copyFeedback.error ? "alert" : "status"}');
  });
});

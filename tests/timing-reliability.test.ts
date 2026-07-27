import { describe, expect, test } from "bun:test";
import { waitForAnimations } from "../src/ui/animation-completion";
import { enteredEdge } from "../src/ui/edge-entry";
import { settleAreaSwitcherDrag, type AreaSwitcherDrag } from "../src/ui/area-switcher-drag";
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
  test("an edge latch fires once until the pointer leaves every edge zone", () => {
    const latch = { inside: false };

    expect(enteredEdge(latch, "left")).toBe("left");
    expect(enteredEdge(latch, "left")).toBeNull();
    expect(enteredEdge(latch, "up")).toBeNull();
    expect(enteredEdge(latch, null)).toBeNull();
    expect(enteredEdge(latch, "up")).toBe("up");
  });

  test("lost capture consumes and fully cleans any active drag without changing expanded state", () => {
    const drag: AreaSwitcherDrag = { expanded: true, moved: true, pointerId: 7, startX: 300, travel: 240 };
    const holder = { current: drag };

    expect(settleAreaSwitcherDrag(holder, { kind: "lost-capture" })).toEqual({
      clearTransform: true,
      nextExpanded: null,
      removeDraggingAttribute: true,
      suppressClick: false,
    });
    expect(holder.current).toBeNull();
    expect(settleAreaSwitcherDrag(holder, { kind: "lost-capture" })).toBeNull();
  });

  test("normal completion validates pointer ID and is idempotent when release causes lost capture", () => {
    const drag: AreaSwitcherDrag = { expanded: false, moved: true, pointerId: 7, startX: 300, travel: 240 };
    const holder = { current: drag };

    expect(settleAreaSwitcherDrag(holder, { kind: "pointer", cancelled: false, clientX: 100, pointerId: 6 })).toBeNull();
    expect(holder.current).toBe(drag);
    expect(settleAreaSwitcherDrag(holder, { kind: "pointer", cancelled: false, clientX: 100, pointerId: 7 })).toEqual({
      clearTransform: false,
      nextExpanded: true,
      removeDraggingAttribute: true,
      suppressClick: true,
    });
    expect(settleAreaSwitcherDrag(holder, { kind: "lost-capture" })).toBeNull();
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
    const settings = await Bun.file(new URL("../src/components/SettingsWindow.tsx", import.meta.url)).text();
    const sharing = await Bun.file(new URL("../src/components/SharingDialog.tsx", import.meta.url)).text();
    const areaSwitcher = await Bun.file(new URL("../src/features/areas/AreaSwitcher.tsx", import.meta.url)).text();

    expect(app).toContain("waitForAnimations([...hosts]");
    expect(app).toContain("AREA_TRANSITION_WATCHDOG_MS");
    expect(app).not.toContain("500 * activeTheme.motion");
    expect(app).not.toContain("now - edgeDragRef.current.time < 520");
    expect(app).toContain('addEventListener("lostpointercapture", cancelAreaSwitcherDrag, { once: true })');
    expect(app).toContain("areaSwitcherTransformTargetRef.current !== minimapExpanded");
    expect(fileIcon).not.toContain("requestAnimationFrame(cleanUp)");
    expect(fileIcon).toContain("current.moveSucceeded");
    expect(search).toContain("searchGenerationRef.current === generation");
    expect(settings).toContain("if (pending) void onLayoutChangeRef.current(pending.layout, pending.desktopId)");
    expect(sharing).toContain("copyGenerationRef.current !== generation");
    expect(sharing).toContain("copiedTimerRef.current === timer");
    expect(sharing).toContain('role={copyFeedback.error ? "alert" : "status"}');
    expect(areaSwitcher).toContain("onLostPointerCapture={onCancelDrag}");
  });
});

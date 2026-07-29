import { describe, expect, test } from "bun:test";
import { adjacentSwipeArea, areaDirectionalLabel, areaTransitionDepth, committedSwipeTarget, homeRelativeAreaLabel, isAreaSwitcherDoubleTap, minimapWindowCapacity, minimapWindows, swipeAxis, swipePreviewReady } from "../src/ui/shell";

describe("cohesive shell view models", () => {
  test("prioritizes the focused window, then windows in the current region, with explicit overflow", () => {
    const windows = [
      { id: "other-a", areaId: "1:0" },
      { id: "current-a", areaId: "0:0" },
      { id: "focused", areaId: "1:0", focused: true },
      { id: "current-b", areaId: "0:0" },
    ];
    const model = minimapWindows(windows, "0:0", 3);
    expect(model.visible.map((window) => window.id)).toEqual(["focused", "current-a", "current-b"]);
    expect(model.overflow.map((window) => window.id)).toEqual(["other-a"]);
  });

  test("adapts minimap window capacity while reserving the overflow model", () => {
    expect(minimapWindowCapacity(621, true)).toBe(2);
    expect(minimapWindowCapacity(768, true)).toBe(5);
    expect(minimapWindowCapacity(1024, false)).toBe(5);
    expect(minimapWindowCapacity(1920, false)).toBe(7);
  });

  test("uses directional identity before raw coordinates", () => {
    expect(areaDirectionalLabel({ column: 0, row: 0 }, { column: 0, row: 0 })).toBe("Home");
    expect(areaDirectionalLabel({ column: -1, row: 0 }, { column: 0, row: 0 })).toBe("Left");
    expect(areaDirectionalLabel({ column: 2, row: -1 }, { column: 0, row: 0 })).toBe("Above right");
  });

  test("keeps stable identities relative to Home", () => {
    expect(homeRelativeAreaLabel({ column: 0, row: 0 })).toBe("Home");
    expect(homeRelativeAreaLabel({ column: 2, row: -1 })).toBe("1 above, 2 right of Home");
  });

  test("requires a dominant deliberate swipe and advances one coordinate", () => {
    expect(swipeAxis(8, 2)).toBeNull();
    expect(swipeAxis(50, 45)).toBeNull();
    expect(swipeAxis(-60, 8)).toBe("x");
    expect(swipePreviewReady(50, 390)).toBeFalse();
    expect(swipePreviewReady(64, 390)).toBeTrue();
    expect(adjacentSwipeArea({ column: 0, row: 0 }, "x", -64)).toEqual({ column: 1, row: 0 });
    expect(adjacentSwipeArea({ column: 0, row: 0 }, "x", 64)).toEqual({ column: -1, row: 0 });
    expect(adjacentSwipeArea({ column: 0, row: 0 }, "y", -64)).toEqual({ column: 0, row: 1 });
    expect(adjacentSwipeArea({ column: 0, row: 0 }, "y", 64)).toEqual({ column: 0, row: -1 });
    expect(adjacentSwipeArea({ column: -1, row: 0 }, "x", -64)).toEqual({ column: 0, row: 0 });
    expect(adjacentSwipeArea({ column: -1, row: 0 }, "x", 64)).toEqual({ column: -2, row: 0 });
    expect(adjacentSwipeArea({ column: 0, row: -1 }, "y", -64)).toEqual({ column: 0, row: 0 });
    expect(adjacentSwipeArea({ column: 0, row: -1 }, "y", 64)).toEqual({ column: 0, row: -2 });
  });

  test("navigates only after a completed swipe", () => {
    const preview = { column: 1, row: 0 };
    expect(committedSwipeTarget(null, false)).toBeNull();
    expect(committedSwipeTarget(preview, true)).toBeNull();
    expect(committedSwipeTarget(preview, false)).toEqual(preview);
  });

  test("builds launcher depth progressively and clamps at the midpoint", () => {
    expect(areaTransitionDepth(0, 390)).toBe(0);
    expect(areaTransitionDepth(54.6, 390)).toBeCloseTo(0.5);
    expect(areaTransitionDepth(-109.2, 390)).toBeCloseTo(1);
    expect(areaTransitionDepth(300, 390)).toBe(1);
    expect(areaTransitionDepth(30, 0)).toBe(0);
  });

  test("recognizes only nearby, timely area switcher double taps", () => {
    const first = { x: 20, y: 30, at: 1_000 };
    expect(isAreaSwitcherDoubleTap(null, first)).toBeFalse();
    expect(isAreaSwitcherDoubleTap(first, { x: 30, y: 40, at: 1_400 })).toBeTrue();
    expect(isAreaSwitcherDoubleTap(first, { x: 30, y: 40, at: 1_401 })).toBeFalse();
    expect(isAreaSwitcherDoubleTap(first, { x: 45, y: 30, at: 1_200 })).toBeFalse();
    expect(isAreaSwitcherDoubleTap(first, { x: 20, y: 30, at: 999 })).toBeFalse();
  });
});

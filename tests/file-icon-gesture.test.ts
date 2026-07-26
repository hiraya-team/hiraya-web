import { describe, expect, test } from "bun:test";
import { allowsMouseDoubleClick, contextMenuPressAction, dismissesSheetDrag, recordTouchRelease, resolveTouchRelease, touchReleaseAction, type TouchTap } from "../src/ui/file-icon-gesture";

describe("file icon touch release", () => {
  const valid = { cancelled: false, moved: false, longPressed: false, releasedOnVisibleContent: true };
  const tap: TouchTap = { id: "file", x: 10, y: 10, at: 1_000 };

  test("selects on the first tap and opens on a nearby second tap", () => {
    expect(touchReleaseAction(null, tap, valid)).toBe("select");
    expect(touchReleaseAction(tap, { ...tap, x: 20, at: 1_350 }, valid)).toBe("open");
    expect(touchReleaseAction(tap, { ...tap, id: "other", at: 1_200 }, valid)).toBe("select");
    expect(touchReleaseAction(tap, { ...tap, at: 1_500 }, valid)).toBe("select");
  });

  test("ignores cancelled, moved, long-pressed, and off-content releases", () => {
    expect(touchReleaseAction(null, tap, { ...valid, releasedOnVisibleContent: false })).toBe("none");
    expect(touchReleaseAction(null, tap, { ...valid, longPressed: true })).toBe("none");
    expect(touchReleaseAction(null, tap, { ...valid, moved: true })).toBe("none");
    expect(touchReleaseAction(null, tap, { ...valid, cancelled: true })).toBe("none");
  });

  test("retains only a selecting tap and records touch compatibility timing", () => {
    const first = resolveTouchRelease(null, tap, valid);
    expect(first).toEqual({ action: "select", nextTap: tap });
    expect(allowsMouseDoubleClick(tap.at + 1)).toBeFalse();
    expect(resolveTouchRelease(tap, { ...tap, at: 1_200 }, valid)).toEqual({ action: "open", nextTap: null });
    expect(resolveTouchRelease(null, { ...tap, at: 1_300 }, { ...valid, moved: true })).toEqual({ action: "none", nextTap: null });
  });
});

describe("file icon context menu press", () => {
  test("turns an active touch hold into selection", () => {
    expect(contextMenuPressAction({ pointerType: "touch", moved: false, longPressed: false })).toBe("select");
  });

  test("suppresses touch context menus after movement or selection", () => {
    expect(contextMenuPressAction({ pointerType: "touch", moved: true, longPressed: false })).toBe("suppress");
    expect(contextMenuPressAction({ pointerType: "touch", moved: false, longPressed: true })).toBe("suppress");
  });

  test("preserves mouse and keyboard context menus", () => {
    expect(contextMenuPressAction({ pointerType: "mouse", moved: false, longPressed: false })).toBe("open");
    expect(contextMenuPressAction(null)).toBe("open");
  });
});

describe("touch compatibility double click", () => {
  test("suppresses a double click retargeted into newly rendered folder contents", () => {
    recordTouchRelease(1_000);
    expect(allowsMouseDoubleClick(1_001)).toBeFalse();
    expect(allowsMouseDoubleClick(1_700)).toBeFalse();
    expect(allowsMouseDoubleClick(1_701)).toBeTrue();
  });
});

describe("action sheet drag", () => {
  test("dismisses for a long drag or a shorter fast swipe", () => {
    expect(dismissesSheetDrag(80, 1_000)).toBeTrue();
    expect(dismissesSheetDrag(30, 50)).toBeTrue();
    expect(dismissesSheetDrag(30, 500)).toBeFalse();
    expect(dismissesSheetDrag(20, 20)).toBeFalse();
  });
});

import { describe, expect, test } from "bun:test";
import { dismissesSheetDrag, touchReleaseAction, type TouchTap } from "../src/ui/file-icon-gesture";

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
});

describe("action sheet drag", () => {
  test("dismisses for a long drag or a shorter fast swipe", () => {
    expect(dismissesSheetDrag(80, 1_000)).toBeTrue();
    expect(dismissesSheetDrag(30, 50)).toBeTrue();
    expect(dismissesSheetDrag(30, 500)).toBeFalse();
    expect(dismissesSheetDrag(20, 20)).toBeFalse();
  });
});

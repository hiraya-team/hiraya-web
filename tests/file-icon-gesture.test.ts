import { describe, expect, test } from "bun:test";
import { opensOnTouchRelease } from "../src/ui/file-icon-gesture";

describe("file icon touch release", () => {
  test("opens only a stationary short tap released on visible content", () => {
    expect(opensOnTouchRelease({ cancelled: false, moved: false, longPressed: false, releasedOnVisibleContent: true })).toBeTrue();
    expect(opensOnTouchRelease({ cancelled: false, moved: false, longPressed: false, releasedOnVisibleContent: false })).toBeFalse();
    expect(opensOnTouchRelease({ cancelled: false, moved: false, longPressed: true, releasedOnVisibleContent: true })).toBeFalse();
    expect(opensOnTouchRelease({ cancelled: false, moved: true, longPressed: false, releasedOnVisibleContent: true })).toBeFalse();
    expect(opensOnTouchRelease({ cancelled: true, moved: false, longPressed: false, releasedOnVisibleContent: true })).toBeFalse();
  });
});

import { describe, expect, test } from "bun:test";
import { formatBytes, LatestOperation } from "./index";

describe("system app helpers", () => {
  test("formats file sizes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
  });

  test("invalidates stale authored operations", () => {
    const operations = new LatestOperation();
    const first = operations.begin();
    const second = operations.begin();
    expect(operations.isLatest(first)).toBe(false);
    expect(operations.isLatest(second)).toBe(true);
    operations.invalidate();
    expect(operations.isLatest(second)).toBe(false);
  });
});

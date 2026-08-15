import { describe, expect, test } from "bun:test";
import { areaMapSegments } from "../src/ui/desktop-areas";

describe("desktop area navigation model", () => {
  test("adds each adjacent coordinate to an expanded map without duplicates", () => {
    const segments = areaMapSegments([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 4, row: -3 },
    ], { column: 0, row: 0 }, true);

    expect(segments).toEqual([
      { column: 4, row: -3 },
      { column: 0, row: -1 },
      { column: -1, row: 0 },
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 0, row: 1 },
    ]);
  });

  test("leaves compact map coordinates unchanged", () => {
    expect(areaMapSegments([{ column: 2, row: 1 }, { column: 0, row: 0 }], { column: 2, row: 1 }, false)).toEqual([
      { column: 0, row: 0 },
      { column: 2, row: 1 },
    ]);
  });
});

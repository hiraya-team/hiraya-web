import { describe, expect, test } from "bun:test";
import { areaMapSegments, desktopAreaItems } from "../src/ui/desktop-areas";

describe("desktop area navigation model", () => {
  test("keeps an empty Home and the current coordinate directly addressable", () => {
    const areas = desktopAreaItems([
      { segment: { column: 2, row: 0 }, rootItemCount: 1, windowCount: 0 },
    ], { column: 3, row: 0 });

    expect(areas.map((area) => area.key)).toEqual(["0:0", "0:2", "0:3"]);
    expect(areas[0]).toMatchObject({ label: "Home", occupied: false, current: false });
    expect(areas[2]).toMatchObject({ label: "3 right of Home", occupied: false, current: true });
  });

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

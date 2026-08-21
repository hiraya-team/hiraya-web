import { describe, expect, test } from "bun:test";
import { areaCameraDragPosition, areaCameraPosition, areaTransferDelta, areaWorldOrigin } from "../src/ui/area-camera";

/** Provides the viewport test fixture. */
const viewport = { width: 390, height: 600 };

describe("area camera", () => {
  test("uses one fixed world origin for signed areas", () => {
    expect(areaWorldOrigin({ column: -2, row: 1 }, viewport)).toEqual({ x: -780, y: 600 });
    expect(areaCameraPosition({ column: -2, row: 1 }, viewport)).toEqual({ x: 780, y: -600 });
    expect(areaCameraPosition({ column: 3, row: -2 }, viewport)).toEqual({ x: -1170, y: 1200 });
  });

  test("keeps edge transfers in world coordinates", () => {
    expect(areaTransferDelta({ column: -1, row: 2 }, { column: 1, row: 2 }, viewport)).toEqual({ x: 780, y: 0 });
    expect(areaTransferDelta({ column: 1, row: 2 }, { column: -1, row: -2 }, viewport)).toEqual({ x: -780, y: -2400 });
  });

  test("moves only the active gesture axis", () => {
    expect(areaCameraDragPosition({ column: -1, row: 2 }, viewport, { x: 45, y: 90 }, "x")).toEqual({ x: 435, y: -1200 });
    expect(areaCameraDragPosition({ column: -1, row: 2 }, viewport, { x: 45, y: 90 }, "y")).toEqual({ x: 390, y: -1110 });
  });
});

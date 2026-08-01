import { describe, expect, test } from "bun:test";
import type { DesktopEntry } from "../src/types";
import { desktopSlots, ICON_SUBGRID_STEP, iconAreaSize, nextAvailableDesktopSlot, projectLogicalAxis, projectLogicalPosition, responsiveDesktop, restoreLogicalPosition, snapAxis } from "../src/ui/desktop-geometry";
import { adjacentArea } from "../src/ui/desktop-areas";

function file(id: string, x = 22, y = 22): DesktopEntry {
  return { kind: "file", id, name: `${id}.txt`, parentId: null, modifiedAt: 1, position: { x, y }, mimeType: "text/plain", size: 0 };
}

describe("responsive desktop geometry", () => {
  test("derives adjacent coordinates", () => {
    expect(adjacentArea({ column: 2, row: -1 }, "left")).toEqual({ column: 1, row: -1 });
    expect(adjacentArea({ column: 2, row: -1 }, "down")).toEqual({ column: 2, row: 0 });
  });
  test("derives placement capacity without using it for area membership", () => {
    expect(desktopSlots({ width: 500, height: 500 })).toHaveLength(16);
    expect(desktopSlots({ width: 220, height: 260 })).toHaveLength(2);
    const entries = [file("one"), file("two"), file("three")];
    expect(responsiveDesktop(entries, { width: 220, height: 260 }).segments).toHaveLength(1);
  });

  test("preserves collisions in the same coordinate tile", () => {
    const desktop = responsiveDesktop([file("one", 160, 30), file("two", 160, 30)], { width: 500, height: 500 });
    expect(desktop.segments).toHaveLength(1);
    expect(desktop.positions.get("one")).toEqual({ x: 160, y: 30 });
    expect(desktop.positions.get("two")).toEqual({ x: 160, y: 30 });
  });

  test("places new icons into free slots without moving existing positions", () => {
    const size = { width: 500, height: 500 };
    const slots = desktopSlots(size);
    expect(nextAvailableDesktopSlot(size, [slots[0], slots[2]])).toEqual(slots[1]);
    expect(nextAvailableDesktopSlot(size, slots)).toEqual(slots[0]);
  });

  test("aligns icon areas to an 8px sub-grid with only trailing remainders", () => {
    expect(iconAreaSize({ width: 390, height: 600 })).toEqual({ width: 384, height: 600 });
    expect(iconAreaSize({ width: 80, height: 90 })).toEqual({ width: 80, height: 88 });
    expect(iconAreaSize({ width: 5, height: 7 })).toEqual({ width: 8, height: 8 });
  });

  test("snaps moved icons to the fine grid from the existing visual origin", () => {
    expect(snapAxis(25, 22, ICON_SUBGRID_STEP, 286)).toBe(22);
    expect(snapAxis(27, 22, ICON_SUBGRID_STEP, 286)).toBe(30);
    expect(snapAxis(290, 22, ICON_SUBGRID_STEP, 286)).toBe(286);
  });

  test("keeps signed icon-area origins congruent with home", () => {
    const size = iconAreaSize({ width: 390, height: 600 });
    for (const segment of [{ column: -3, row: 2 }, { column: 0, row: 0 }, { column: 4, row: -5 }]) {
      const origin = restoreLogicalPosition({ x: 0, y: 0 }, segment, size);
      expect(Math.abs(origin.x % ICON_SUBGRID_STEP)).toBe(0);
      expect(Math.abs(origin.y % ICON_SUBGRID_STEP)).toBe(0);
      expect(projectLogicalPosition(origin, size).segment).toEqual(segment);
    }
  });

  test("uses themed icon metrics without changing coordinate-based membership", () => {
    const size = { width: 390, height: 600 };
    const entries = [file("origin", 22, 22), file("next", 412, 22)];
    const large = { width: 110, height: 114, stepX: 116, stepY: 124 };
    expect(desktopSlots(size, false, large).length).toBeLessThan(desktopSlots(size).length);
    expect(responsiveDesktop(entries, size, large).segments.map((segment) => segment.key)).toEqual(["0:0", "0:1"]);
    expect(entries.map((entry) => entry.position)).toEqual([{ x: 22, y: 22 }, { x: 412, y: 22 }]);
  });

  test("projects signed viewport boundaries reversibly", () => {
    expect(projectLogicalAxis(0, 390)).toEqual({ segment: 0, local: 0 });
    expect(projectLogicalAxis(389, 390)).toEqual({ segment: 0, local: 389 });
    expect(projectLogicalAxis(390, 390)).toEqual({ segment: 1, local: 0 });
    expect(projectLogicalAxis(-1, 390)).toEqual({ segment: -1, local: 389 });
    expect(projectLogicalAxis(-390, 390)).toEqual({ segment: -1, local: 0 });
    expect(projectLogicalAxis(-391, 390)).toEqual({ segment: -2, local: 389 });

    const values = [{ x: -781, y: 602 }, { x: -1, y: -1 }, { x: 900, y: -1201 }];
    for (const logical of values) {
      const projected = projectLogicalPosition(logical, { width: 390, height: 600 });
      expect(restoreLogicalPosition(projected.local, projected.segment, { width: 390, height: 600 })).toEqual(logical);
    }
  });

  test("retains sparse surface segments without dense reassignment", () => {
    const entries = [file("origin", 22, 22), file("left", -368, 22), file("far", 1192, 1222)];
    const desktop = responsiveDesktop(entries, { width: 390, height: 600 });
    expect(desktop.segments.map((segment) => segment.segment)).toEqual([
      { column: -1, row: 0 },
      { column: 0, row: 0 },
      { column: 3, row: 2 },
    ]);
    expect(desktop.minColumn).toBe(-1);
    expect(desktop.maxColumn).toBe(3);
    expect(desktop.rows).toBe(3);
  });

  test("membership depends only on viewport and coordinates", () => {
    const entries = [file("b", 400, 20), file("a", 20, 20), file("c", 400, 20)];
    const first = responsiveDesktop(entries, { width: 390, height: 600 });
    const reordered = responsiveDesktop([...entries].reverse(), { width: 390, height: 600 });
    expect(first.segments.map((segment) => [segment.key, segment.entries.map((entry) => entry.id)])).toEqual(
      reordered.segments.map((segment) => [segment.key, segment.entries.map((entry) => entry.id)]),
    );
    expect(first.segments.map((segment) => segment.entries.map((entry) => entry.id))).toEqual([["a"], ["b", "c"]]);
  });

  test("reprojects from unchanged coordinates when the viewport changes", () => {
    const entries = [file("near", 22, 22), file("far", 900, 22)];
    expect(responsiveDesktop(entries, { width: 390, height: 600 }).segments).toHaveLength(2);
    expect(responsiveDesktop(entries, { width: 1200, height: 700 }).segments).toHaveLength(1);
    expect(entries[1].position).toEqual({ x: 900, y: 22 });
  });

  test("uses one implicit origin extent for an empty desktop", () => {
    const desktop = responsiveDesktop([], { width: 390, height: 600 });
    expect(desktop.segments).toEqual([]);
    expect(desktop.columns).toBe(1);
    expect(desktop.rows).toBe(1);
  });
});

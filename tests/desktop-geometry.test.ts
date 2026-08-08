import { describe, expect, test } from "bun:test";
import { DEFAULT_GRID_SIZE, type DesktopEntry } from "../src/types";
import { arrangeDesktopDrag, arrangeDesktopSegment, desktopSlots, iconAreaSize, nextAvailableDesktopSlot, projectLogicalAxis, projectLogicalPosition, responsiveDesktop, restoreLogicalPosition, snapAxis } from "../src/ui/desktop-geometry";
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

  test("packs the current area in visual order without moving neighboring areas", () => {
    const size = { width: 500, height: 500 };
    const entries = [file("bottom", 30, 300), file("right", 250, 30), file("top", 30, 40), file("neighbor", 530, 30)];
    expect(arrangeDesktopSegment(entries, { column: 0, row: 0 }, size)).toEqual([
      { entryId: "top", position: { x: 22, y: 22 } },
      { entryId: "bottom", position: { x: 22, y: 134 } },
      { entryId: "right", position: { x: 22, y: 246 } },
    ]);
  });

  test("does not produce colliding positions when an area is over capacity", () => {
    const size = { width: 220, height: 260 };
    expect(arrangeDesktopSegment([file("one"), file("two"), file("three")], { column: 0, row: 0 }, size)).toBeNull();
  });

  test("cascades occupied icons into the nearest available slots", () => {
    const entries = [file("moving", 230, 300), file("first", 22, 22), file("second", 126, 22)];
    expect(arrangeDesktopDrag(entries, new Set(["moving"]), "moving", { x: 22, y: 22 }, { column: 0, row: 0 }, { width: 500, height: 500 })).toEqual([
      { entryId: "first", position: { x: 126, y: 22 } },
      { entryId: "moving", position: { x: 22, y: 22 } },
      { entryId: "second", position: { x: 230, y: 22 } },
    ]);
  });

  test("preserves a dragged group and leaves neighboring areas untouched", () => {
    const entries = [file("a", 230, 300), file("b", 334, 300), file("occupied", 22, 22), file("neighbor", 522, 22)];
    const updates = arrangeDesktopDrag(entries, new Set(["a", "b"]), "a", { x: 22, y: 22 }, { column: 0, row: 0 }, { width: 500, height: 500 });
    const positions = new Map(updates?.map((update) => [update.entryId, update.position]));
    expect(positions.get("a")).toEqual({ x: 22, y: 22 });
    expect(positions.get("b")).toEqual({ x: 126, y: 22 });
    expect(positions.has("neighbor")).toBe(false);
  });

  test("rejects a colliding drag when the area has no free slot", () => {
    const size = { width: 220, height: 260 };
    const entries = [file("moving", 22, 134), file("first", 22, 22), file("second", 22, 134)];
    expect(arrangeDesktopDrag(entries, new Set(["moving"]), "moving", { x: 22, y: 22 }, { column: 0, row: 0 }, size)).toBeNull();
  });

  test("aligns icon areas to the selected sub-grid with only trailing remainders", () => {
    expect(iconAreaSize({ width: 390, height: 600 })).toEqual({ width: 384, height: 600 });
    expect(iconAreaSize({ width: 390, height: 600 }, 36)).toEqual({ width: 360, height: 576 });
    expect(iconAreaSize({ width: 80, height: 90 })).toEqual({ width: 72, height: 72 });
    expect(iconAreaSize({ width: 5, height: 7 })).toEqual({ width: DEFAULT_GRID_SIZE, height: DEFAULT_GRID_SIZE });
  });

  test("snaps moved icons to the fine grid from the existing visual origin", () => {
    expect(snapAxis(31, 22, DEFAULT_GRID_SIZE, 286)).toBe(22);
    expect(snapAxis(35, 22, DEFAULT_GRID_SIZE, 286)).toBe(46);
    expect(snapAxis(290, 22, DEFAULT_GRID_SIZE, 286)).toBe(286);
  });

  test("keeps signed icon-area origins congruent with home", () => {
    const size = iconAreaSize({ width: 390, height: 600 });
    for (const segment of [{ column: -3, row: 2 }, { column: 0, row: 0 }, { column: 4, row: -5 }]) {
      const origin = restoreLogicalPosition({ x: 0, y: 0 }, segment, size);
      expect(Math.abs(origin.x % DEFAULT_GRID_SIZE)).toBe(0);
      expect(Math.abs(origin.y % DEFAULT_GRID_SIZE)).toBe(0);
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

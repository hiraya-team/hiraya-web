import { describe, expect, test } from "bun:test";
import { DEFAULT_GRID_SIZE, type DesktopEntry } from "../src/types";
import { arrangeDesktopAroundObstacle, arrangeDesktopDrag, arrangeDesktopSegment, boundsIntersectSegment, clampShellItemBounds, desktopShellItemObstacles, desktopSlots, iconAreaSize, intersectingSegments, nextAvailableDesktopSlot, positionOverlapsObstacles, projectLogicalAxis, projectLogicalPosition, responsiveDesktop, restoreLogicalPosition, snapAxis, snapShellItemBounds } from "../src/ui/desktop-geometry";
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
    expect(nextAvailableDesktopSlot(size, slots)).toBeNull();
  });

  test("keeps default placement and auto-arrange clear of shell item rectangles", () => {
    const size = { width: 500, height: 500 };
    const obstacle = { x: 0, y: 0, width: 130, height: 250 };
    expect(nextAvailableDesktopSlot(size, [], false, undefined, [obstacle])).toEqual({ x: 22, y: 358 });
    expect(arrangeDesktopSegment([file("one"), file("two")], { column: 0, row: 0 }, size, undefined, [obstacle])).toEqual([
      { entryId: "one", position: { x: 22, y: 358 } },
      { entryId: "two", position: { x: 126, y: 358 } },
    ]);
    expect(arrangeDesktopDrag([file("moving", 230, 22)], new Set(["moving"]), "moving", { x: 22, y: 22 }, { column: 0, row: 0 }, size, undefined, undefined, undefined, [obstacle])).toBeNull();
  });

  test("returns no slot when shell obstacles consume the area", () => {
    const size = { width: 220, height: 260 };
    const obstacle = { x: 0, y: 0, width: 220, height: 260 };
    expect(desktopSlots(size, false, undefined, [obstacle])).toEqual([]);
    expect(nextAvailableDesktopSlot(size, [], false, undefined, [obstacle])).toBeNull();
    expect(arrangeDesktopSegment([file("one")], { column: 0, row: 0 }, size, undefined, [obstacle])).toBeNull();
  });

  test("detects single and grouped manual drops over shell obstacles", () => {
    const obstacles = [{ x: 80, y: 40, width: 180, height: 160 }];
    expect(positionOverlapsObstacles({ x: 22, y: 22 }, { width: 98, height: 102 }, obstacles)).toBe(true);
    expect([{ x: 280, y: 22 }, { x: 100, y: 220 }].some((position) => positionOverlapsObstacles(position, { width: 98, height: 102 }, obstacles))).toBe(false);
    expect([{ x: 280, y: 22 }, { x: 160, y: 100 }].some((position) => positionOverlapsObstacles(position, { width: 98, height: 102 }, obstacles))).toBe(true);
  });

  test("clamps shell items to the active area and server dimension limit", () => {
    expect(clampShellItemBounds({ x: 350, y: -20 }, 5000, 200, { width: 390, height: 600 })).toEqual({ x: 0, y: 0, width: 390, height: 200 });
    expect(clampShellItemBounds({ x: 480, y: 480 }, 100, 100, { width: 500, height: 500 })).toEqual({ x: 400, y: 400, width: 100, height: 100 });
    const folder: DesktopEntry = { kind: "folder", id: "group", name: "Group", parentId: null, modifiedAt: 1, position: { x: 20, y: 30 } };
    expect(desktopShellItemObstacles([{ id: "clock", kind: "clock", x: 450, y: 20, width: 200, height: 120 }], [{ folderId: folder.id, width: 320, height: 240 }], [folder], { column: 0, row: 0 }, { width: 500, height: 500 })).toEqual([{ x: 450, y: 20, width: 200, height: 120 }, { x: 20, y: 30, width: 320, height: 240 }]);
    expect(desktopShellItemObstacles([{ id: "clock", kind: "clock", x: 450, y: 20, width: 200, height: 120 }], [], [], { column: 1, row: 0 }, { width: 500, height: 500 })).toEqual([{ x: -50, y: 20, width: 200, height: 120 }]);
  });

  test("finds every area intersected by item bounds", () => {
    const size = { width: 500, height: 500 };
    expect(intersectingSegments({ x: 450, y: 450 }, { width: 100, height: 100 }, size)).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ]);
    expect(boundsIntersectSegment({ x: -50, y: 20 }, { width: 100, height: 100 }, { column: 0, row: 0 }, size)).toBe(true);
    expect(intersectingSegments({ x: 400, y: 20 }, { width: 100, height: 100 }, size)).toEqual([{ column: 0, row: 0 }]);
  });

  test("snaps shell item positions and dimensions to the selected grid", () => {
    expect(snapShellItemBounds({ x: 35, y: 35 }, 220, 150, { width: 500, height: 500 })).toEqual({ x: 46, y: 46, width: 216, height: 144 });
    expect(snapShellItemBounds({ x: 480, y: 480 }, 220, 150, { width: 500, height: 500 })).toEqual({ x: 262, y: 334, width: 216, height: 144 });
  });

  test("cascades icons around a fixed multi-cell obstacle", () => {
    const entries = [file("first", 22, 22), file("second", 22, 142), file("unrelated", 262, 22)];
    expect(arrangeDesktopAroundObstacle(entries, { x: 22, y: 22, width: 98, height: 102 }, { column: 0, row: 0 }, { width: 500, height: 500 })).toEqual([
      { entryId: "first", position: { x: 22, y: 142 } },
      { entryId: "second", position: { x: 22, y: 262 } },
    ]);
    expect(arrangeDesktopAroundObstacle(entries, { x: 150, y: 300, width: 80, height: 80 }, { column: 0, row: 0 }, { width: 500, height: 500 })).toEqual([]);
  });

  test("rejects a fixed obstacle when displaced icons have nowhere to go", () => {
    expect(arrangeDesktopAroundObstacle([file("blocked")], { x: 0, y: 0, width: 130, height: 250 }, { column: 0, row: 0 }, { width: 220, height: 260 })).toBeNull();
  });

  test("wraps displaced icons to free space earlier in the grid", () => {
    expect(arrangeDesktopAroundObstacle([file("last", 382, 382)], { x: 360, y: 360, width: 140, height: 140 }, { column: 0, row: 0 }, { width: 500, height: 500 })).toEqual([
      { entryId: "last", position: { x: 382, y: 22 } },
    ]);
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

  test("cascades overlapping icons down the selected grid", () => {
    const entries = [file("moving", 230, 300), file("first", 22, 22), file("second", 22, 142), file("unrelated", 262, 22)];
    expect(arrangeDesktopDrag(entries, new Set(["moving"]), "moving", { x: 22, y: 22 }, { column: 0, row: 0 }, { width: 500, height: 500 })).toEqual([
      { entryId: "first", position: { x: 22, y: 142 } },
      { entryId: "moving", position: { x: 22, y: 22 } },
      { entryId: "second", position: { x: 22, y: 262 } },
    ]);
  });

  test("wraps a bottom collision to the next grid column", () => {
    const entries = [file("moving", 230, 22), file("bottom", 22, 142)];
    expect(arrangeDesktopDrag(entries, new Set(["moving"]), "moving", { x: 22, y: 142 }, { column: 0, row: 0 }, { width: 500, height: 260 })).toEqual([
      { entryId: "bottom", position: { x: 142, y: 22 } },
      { entryId: "moving", position: { x: 22, y: 142 } },
    ]);
  });

  test("uses each icon footprint when shifting future multi-cell icons", () => {
    const entries = [file("tall", 230, 300), file("overlap", 22, 22)];
    expect(arrangeDesktopDrag(entries, new Set(["tall"]), "tall", { x: 22, y: 22 }, { column: 0, row: 0 }, { width: 500, height: 500 }, undefined, 24, (entry) => entry.id === "tall" ? { width: 98, height: 150 } : { width: 98, height: 102 })).toEqual([
      { entryId: "overlap", position: { x: 22, y: 190 } },
      { entryId: "tall", position: { x: 22, y: 22 } },
    ]);
  });

  test("preserves a dragged group and leaves neighboring areas untouched", () => {
    const entries = [file("a", 230, 300), file("b", 334, 300), file("occupied", 22, 22), file("neighbor", 522, 22)];
    const updates = arrangeDesktopDrag(entries, new Set(["a", "b"]), "a", { x: 22, y: 22 }, { column: 0, row: 0 }, { width: 500, height: 500 });
    const positions = new Map(updates?.map((update) => [update.entryId, update.position]));
    expect(positions.get("a")).toEqual({ x: 22, y: 22 });
    expect(positions.get("b")).toEqual({ x: 126, y: 22 });
    expect(positions.get("occupied")).toEqual({ x: 22, y: 142 });
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

import { segmentKey, type SurfaceSegment } from "./desktop-geometry";

/** Formats a desktop area coordinate for display. */
export function areaCoordinateLabel(segment: SurfaceSegment) {
  return `Column ${segment.column}, row ${segment.row}`;
}

/** Returns the desktop area adjacent in a requested direction. */
export function adjacentArea(segment: SurfaceSegment, direction: "left" | "right" | "up" | "down"): SurfaceSegment {
  return {
    column: segment.column + (direction === "left" ? -1 : direction === "right" ? 1 : 0),
    row: segment.row + (direction === "up" ? -1 : direction === "down" ? 1 : 0),
  };
}

/** Builds the rectangular segment range shown in the area map. */
export function areaMapSegments(segments: readonly SurfaceSegment[], current: SurfaceSegment, includeAdjacent: boolean): SurfaceSegment[] {
  const byKey = new Map(segments.map((segment) => [segmentKey(segment), segment]));
  if (includeAdjacent) {
    for (const direction of ["left", "right", "up", "down"] as const) {
      const segment = adjacentArea(current, direction);
      if (!byKey.has(segmentKey(segment))) byKey.set(segmentKey(segment), segment);
    }
  }
  return [...byKey.values()].sort((left, right) => left.row - right.row || left.column - right.column);
}

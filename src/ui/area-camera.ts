import type { EntryPosition } from "../types";
import type { SurfaceSegment } from "./desktop-geometry";

export type AreaViewport = { width: number; height: number };

/** Converts a segment coordinate to its logical world origin. */
export function areaWorldOrigin(segment: SurfaceSegment, viewport: AreaViewport): EntryPosition {
  return {
    x: segment.column * viewport.width,
    y: segment.row * viewport.height,
  };
}

/** Calculates the camera translation for an active desktop area. */
export function areaCameraPosition(segment: SurfaceSegment, viewport: AreaViewport): EntryPosition {
  const origin = areaWorldOrigin(segment, viewport);
  return { x: -origin.x, y: -origin.y };
}

/** Adds an in-progress drag offset to the area camera. */
export function areaCameraDragPosition(segment: SurfaceSegment, viewport: AreaViewport, delta: EntryPosition, axis: "x" | "y"): EntryPosition {
  const camera = areaCameraPosition(segment, viewport);
  return {
    x: camera.x + (axis === "x" ? delta.x : 0),
    y: camera.y + (axis === "y" ? delta.y : 0),
  };
}

/** Calculates the logical offset between desktop areas. */
export function areaTransferDelta(source: SurfaceSegment, target: SurfaceSegment, viewport: AreaViewport): EntryPosition {
  const sourceOrigin = areaWorldOrigin(source, viewport);
  const targetOrigin = areaWorldOrigin(target, viewport);
  return {
    x: targetOrigin.x - sourceOrigin.x,
    y: targetOrigin.y - sourceOrigin.y,
  };
}

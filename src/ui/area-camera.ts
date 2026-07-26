import type { EntryPosition } from "../types";
import type { SurfaceSegment } from "./desktop-geometry";

export type AreaViewport = { width: number; height: number };

export function areaWorldOrigin(segment: SurfaceSegment, viewport: AreaViewport): EntryPosition {
  return {
    x: segment.column * viewport.width,
    y: segment.row * viewport.height,
  };
}

export function areaCameraPosition(segment: SurfaceSegment, viewport: AreaViewport): EntryPosition {
  const origin = areaWorldOrigin(segment, viewport);
  return { x: -origin.x, y: -origin.y };
}

export function areaCameraDragPosition(segment: SurfaceSegment, viewport: AreaViewport, delta: EntryPosition, axis: "x" | "y"): EntryPosition {
  const camera = areaCameraPosition(segment, viewport);
  return {
    x: camera.x + (axis === "x" ? delta.x : 0),
    y: camera.y + (axis === "y" ? delta.y : 0),
  };
}

export function areaTransferDelta(source: SurfaceSegment, target: SurfaceSegment, viewport: AreaViewport): EntryPosition {
  const sourceOrigin = areaWorldOrigin(source, viewport);
  const targetOrigin = areaWorldOrigin(target, viewport);
  return {
    x: targetOrigin.x - sourceOrigin.x,
    y: targetOrigin.y - sourceOrigin.y,
  };
}

export function areaScreenPosition(world: EntryPosition, camera: EntryPosition): EntryPosition {
  return { x: world.x + camera.x, y: world.y + camera.y };
}

import type { EntryPosition } from "../types";
import { projectLogicalPosition, restoreLogicalPosition, segmentKey, type RootEntryPositionUpdate, type SurfaceSegment } from "./desktop-geometry";
import { homeRelativeAreaLabel } from "./shell";

export type AreaOccupancy = {
  segment: SurfaceSegment;
  rootItemCount: number;
  windowCount: number;
};

export type DesktopAreaItem = AreaOccupancy & {
  current: boolean;
  occupied: boolean;
  key: string;
  label: string;
  coordinateLabel: string;
};

export function areaCoordinateLabel(segment: SurfaceSegment) {
  return `Column ${segment.column}, row ${segment.row}`;
}

export function adjacentArea(segment: SurfaceSegment, direction: "left" | "right" | "up" | "down"): SurfaceSegment {
  return {
    column: segment.column + (direction === "left" ? -1 : direction === "right" ? 1 : 0),
    row: segment.row + (direction === "up" ? -1 : direction === "down" ? 1 : 0),
  };
}

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

export function desktopAreaItems(occupied: readonly AreaOccupancy[], current: SurfaceSegment): DesktopAreaItem[] {
  const byKey = new Map(occupied.map((area) => [segmentKey(area.segment), area]));
  const home = { column: 0, row: 0 };
  const homeKey = segmentKey(home);
  const currentKey = segmentKey(current);
  if (!byKey.has(homeKey)) byKey.set(homeKey, { segment: home, rootItemCount: 0, windowCount: 0 });
  if (!byKey.has(currentKey)) byKey.set(currentKey, { segment: current, rootItemCount: 0, windowCount: 0 });
  return [...byKey.values()]
    .sort((left, right) => left.segment.row - right.segment.row || left.segment.column - right.segment.column)
    .map((area) => ({
      ...area,
      current: segmentKey(area.segment) === currentKey,
      occupied: area.rootItemCount > 0 || area.windowCount > 0,
      key: segmentKey(area.segment),
      label: homeRelativeAreaLabel(area.segment),
      coordinateLabel: areaCoordinateLabel(area.segment),
    }));
}

export function arrangeableAreaItems(areas: readonly DesktopAreaItem[]) {
  return areas.filter((area) => area.occupied);
}

export function moveLogicalPositionToArea(position: EntryPosition, target: SurfaceSegment, viewport: { width: number; height: number }) {
  return restoreLogicalPosition(projectLogicalPosition(position, viewport).local, target, viewport);
}

export async function persistAreaPositionUpdates(updates: readonly RootEntryPositionUpdate[], persist: (updates: RootEntryPositionUpdate[]) => Promise<unknown>) {
  try {
    await persist([...updates]);
    return true;
  } catch {
    return false;
  }
}

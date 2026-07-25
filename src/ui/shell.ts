import type { SurfaceSegment } from "./desktop-geometry";

export type TaskbarWindow = {
  id: string;
  areaId: string;
  focused?: boolean;
};

export function taskbarWindows<T extends TaskbarWindow>(windows: readonly T[], currentAreaId: string, limit = 6) {
  const ordered = [...windows].sort((left, right) => {
    const leftRank = left.focused ? 0 : left.areaId === currentAreaId ? 1 : 2;
    const rightRank = right.focused ? 0 : right.areaId === currentAreaId ? 1 : 2;
    return leftRank - rightRank;
  });
  return { visible: ordered.slice(0, limit), overflow: ordered.slice(limit) };
}

export function taskbarCapacity(viewportWidth: number, compact: boolean) {
  if (viewportWidth <= 760) return 2;
  if (compact || viewportWidth <= 1024) return 5;
  return 7;
}

export function areaDirectionalLabel(segment: SurfaceSegment, current: SurfaceSegment) {
  const column = segment.column - current.column;
  const row = segment.row - current.row;
  if (column === 0 && row === 0) return segment.column === 0 && segment.row === 0 ? "Home" : "Current";
  if (segment.column === 0 && segment.row === 0) return "Home";
  if (row === 0) return column < 0 ? "Left" : "Right";
  if (column === 0) return row < 0 ? "Above" : "Below";
  const vertical = row < 0 ? "Above" : "Below";
  const horizontal = column < 0 ? "left" : "right";
  return `${vertical} ${horizontal}`;
}

export function homeRelativeAreaLabel(segment: SurfaceSegment) {
  if (segment.column === 0 && segment.row === 0) return "Home";
  const horizontal = segment.column === 0 ? "" : `${Math.abs(segment.column)} ${segment.column < 0 ? "left" : "right"}`;
  const vertical = segment.row === 0 ? "" : `${Math.abs(segment.row)} ${segment.row < 0 ? "above" : "below"}`;
  return [vertical, horizontal].filter(Boolean).join(", ") + " of Home";
}

export function swipeAxis(deltaX: number, deltaY: number): "x" | "y" | null {
  if (Math.hypot(deltaX, deltaY) < 12) return null;
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < Math.min(Math.abs(deltaX), Math.abs(deltaY)) * 1.2) return null;
  return Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
}

export function adjacentSwipeArea(current: SurfaceSegment, axis: "x" | "y", delta: number): SurfaceSegment {
  const direction = delta < 0 ? 1 : -1;
  return axis === "x"
    ? { column: current.column + direction, row: current.row }
    : { column: current.column, row: current.row + direction };
}

export function swipePreviewReady(delta: number, viewportDistance: number) {
  return Math.abs(delta) >= Math.min(88, Math.max(52, viewportDistance * 0.16));
}

export function occupiedAreaCount(areas: readonly { occupied: boolean }[]) {
  return areas.filter((area) => area.occupied).length;
}

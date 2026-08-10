import { DEFAULT_GRID_SIZE, MAX_LAYOUT_DIMENSION, type DesktopEntry, type DesktopIconGroup, type DesktopWidget, type EntryPosition, type RootEntryPositionUpdate } from "../types";
import type { DesktopIconMetrics } from "../lib/themes";

export const FILE_ICON_SIZE = { width: 98, height: 102 } as const;
export const GRID_ORIGIN = { x: 22, y: 22 } as const;
export const GRID_STEP = { x: 104, y: 112 } as const;
export const DEFAULT_ICON_METRICS: DesktopIconMetrics = { ...FILE_ICON_SIZE, stepX: GRID_STEP.x, stepY: GRID_STEP.y };
export const MIN_SHELL_ITEM_SIZE = { width: 180, height: 112 } as const;

const MINIMAP_RESERVED_SIZE = { width: 138, height: 111 } as const;

export type SurfaceSegment = { column: number; row: number };
export type DesktopIconFootprint = Pick<DesktopIconMetrics, "width" | "height">;
export type DesktopObstacle = EntryPosition & { width: number; height: number };

export type DesktopSegment = {
  entries: DesktopEntry[];
  itemCount?: number;
  key: string;
  segment: SurfaceSegment;
};

export type ResponsiveDesktop = {
  capacity: number;
  columns: number;
  rows: number;
  minColumn: number;
  minRow: number;
  maxColumn: number;
  maxRow: number;
  segments: DesktopSegment[];
  positions: ReadonlyMap<string, EntryPosition>;
};

export function segmentKey(segment: SurfaceSegment) {
  return `${segment.row}:${segment.column}`;
}

export function nextRootEntryPosition(index: number, viewportHeight: number, base?: EntryPosition, metrics = DEFAULT_ICON_METRICS) {
  if (base) return { x: base.x + (index % 4) * 18, y: base.y + (index % 4) * 18 };
  const rows = Math.max(1, Math.floor((viewportHeight - 130) / metrics.stepY));
  return { x: GRID_ORIGIN.x + Math.floor(index / rows) * metrics.stepX, y: GRID_ORIGIN.y + (index % rows) * metrics.stepY };
}

export function snapAxis(value: number, origin: number, step: number, max: number) {
  if (max <= origin) return Math.max(8, max);
  const index = Math.max(0, Math.min(Math.floor((max - origin) / step), Math.round((value - origin) / step)));
  return origin + index * step;
}

export function desktopSlots(size: { width: number; height: number }, reserveMinimap = false, metrics = DEFAULT_ICON_METRICS, obstacles: readonly DesktopObstacle[] = []) {
  const maxX = Math.max(8, size.width - metrics.width);
  const maxY = Math.max(8, size.height - metrics.height);
  const columns = Math.max(1, Math.floor((maxX - GRID_ORIGIN.x) / metrics.stepX) + 1);
  const rows = Math.max(1, Math.floor((maxY - GRID_ORIGIN.y) / metrics.stepY) + 1);
  const slots: EntryPosition[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const slot = {
        x: Math.min(maxX, GRID_ORIGIN.x + column * metrics.stepX),
        y: Math.min(maxY, GRID_ORIGIN.y + row * metrics.stepY),
      };
      const underMinimap = reserveMinimap
        && slot.x + metrics.width > size.width - MINIMAP_RESERVED_SIZE.width
        && slot.y + metrics.height > size.height - MINIMAP_RESERVED_SIZE.height;
      if (!underMinimap && obstacles.every((obstacle) => !positionsOverlap(slot, metrics, obstacle, obstacle))) slots.push(slot);
    }
  }
  return slots;
}

function positionsOverlap(a: EntryPosition, aFootprint: DesktopIconFootprint, b: EntryPosition, bFootprint: DesktopIconFootprint) {
  return a.x < b.x + bFootprint.width && a.x + aFootprint.width > b.x
    && a.y < b.y + bFootprint.height && a.y + aFootprint.height > b.y;
}

export function positionOverlapsObstacles(position: EntryPosition, footprint: DesktopIconFootprint, obstacles: readonly DesktopObstacle[]) {
  return obstacles.some((obstacle) => positionsOverlap(position, footprint, obstacle, obstacle));
}

export function nextAvailableDesktopSlot(size: { width: number; height: number }, occupied: readonly EntryPosition[], reserveMinimap = false, metrics = DEFAULT_ICON_METRICS, obstacles: readonly DesktopObstacle[] = []) {
  const slots = desktopSlots(size, reserveMinimap, metrics, obstacles);
  return slots.find((slot) => occupied.every((position) => !positionsOverlap(position, metrics, slot, metrics))) ?? null;
}

export function arrangeDesktopSegment(entries: readonly DesktopEntry[], segment: SurfaceSegment, size: { width: number; height: number }, metrics = DEFAULT_ICON_METRICS, obstacles: readonly DesktopObstacle[] = []): RootEntryPositionUpdate[] | null {
  const arranged = entries
    .filter((entry) => entry.parentId === null && segmentKey(projectLogicalPosition(entry.position, size).segment) === segmentKey(segment))
    .sort((left, right) => {
      const a = projectLogicalPosition(left.position, size).local;
      const b = projectLogicalPosition(right.position, size).local;
      return a.x - b.x || a.y - b.y || left.id.localeCompare(right.id);
    });
  const slots = desktopSlots(size, false, metrics, obstacles);
  if (arranged.length > slots.length) return null;
  return arranged.map((entry, index) => ({ entryId: entry.id, position: restoreLogicalPosition(slots[index], segment, size) }));
}

export function arrangeDesktopDrag(entries: readonly DesktopEntry[], movingEntryIds: ReadonlySet<string>, anchorEntryId: string, anchorPosition: EntryPosition, targetSegment: SurfaceSegment, size: { width: number; height: number }, metrics = DEFAULT_ICON_METRICS, gridSize = DEFAULT_GRID_SIZE, footprintFor: (entry: DesktopEntry) => DesktopIconFootprint = () => metrics, obstacles: readonly DesktopObstacle[] = []): RootEntryPositionUpdate[] | null {
  const roots = entries.filter((entry) => entry.parentId === null);
  const anchor = roots.find((entry) => entry.id === anchorEntryId && movingEntryIds.has(entry.id));
  if (!anchor) return null;
  const moving = roots.filter((entry) => movingEntryIds.has(entry.id)).sort((a, b) => a.id.localeCompare(b.id));
  const delta = { x: anchorPosition.x - anchor.position.x, y: anchorPosition.y - anchor.position.y };
  const positions = new Map<string, EntryPosition>();
  const settled = new Set<string>();
  const byId = new Map(roots.map((entry) => [entry.id, entry]));
  const overlaps = (entryId: string, position: EntryPosition, otherId: string, otherPosition: EntryPosition) => positionsOverlap(position, footprintFor(byId.get(entryId)!), otherPosition, footprintFor(byId.get(otherId)!));

  for (const entry of moving) {
    const position = { x: entry.position.x + delta.x, y: entry.position.y + delta.y };
    const projection = projectLogicalPosition(position, size);
    const footprint = footprintFor(entry);
    const maxX = Math.max(8, size.width - footprint.width);
    const maxY = Math.max(8, size.height - footprint.height);
    if (segmentKey(projection.segment) !== segmentKey(targetSegment) || projection.local.x < 8 || projection.local.x > maxX || projection.local.y < 8 || projection.local.y > maxY) return null;
    if (obstacles.some((obstacle) => positionsOverlap(projection.local, footprint, obstacle, obstacle))) return null;
    if ([...positions].some(([otherId, other]) => overlaps(entry.id, position, otherId, other))) return null;
    positions.set(entry.id, position);
    settled.add(entry.id);
  }

  const neighbors = roots
    .filter((entry) => !movingEntryIds.has(entry.id) && segmentKey(projectLogicalPosition(entry.position, size).segment) === segmentKey(targetSegment))
    .sort((a, b) => {
      const left = projectLogicalPosition(a.position, size).local;
      const right = projectLogicalPosition(b.position, size).local;
      return left.x - right.x || left.y - right.y || a.id.localeCompare(b.id);
    });
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueueCollisions = (entryId: string, position: EntryPosition) => {
    for (const entry of neighbors) {
      if (settled.has(entry.id) || queued.has(entry.id) || !overlaps(entryId, position, entry.id, entry.position)) continue;
      queued.add(entry.id);
      queue.push(entry.id);
    }
  };
  for (const [entryId, position] of positions) enqueueCollisions(entryId, position);

  while (queue.length) {
    const id = queue.shift()!;
    if (settled.has(id)) continue;
    const entry = byId.get(id)!;
    const footprint = footprintFor(entry);
    const origin = projectLogicalPosition(entry.position, size).local;
    const maxX = size.width - footprint.width;
    const maxY = size.height - footprint.height;
    const startX = snapAxis(origin.x, GRID_ORIGIN.x, gridSize, maxX);
    const startY = snapAxis(origin.y, GRID_ORIGIN.y, gridSize, maxY);
    const columnStep = Math.ceil(footprint.width / gridSize) * gridSize;
    let logical: EntryPosition | undefined;
    for (let x = startX; x <= maxX && !logical; x += columnStep) {
      for (let y = x === startX ? startY + gridSize : GRID_ORIGIN.y; y <= maxY; y += gridSize) {
        const candidate = restoreLogicalPosition({ x, y }, targetSegment, size);
        if (obstacles.every((obstacle) => !positionsOverlap({ x, y }, footprint, obstacle, obstacle)) && [...settled].every((settledId) => !overlaps(id, candidate, settledId, positions.get(settledId)!))) {
          logical = candidate;
          break;
        }
      }
    }
    if (!logical) return null;
    positions.set(id, logical);
    settled.add(id);
    enqueueCollisions(id, logical);
  }

  return [...positions]
    .map(([entryId, position]) => ({ entryId, position }))
    .filter(({ entryId, position }) => {
      const current = roots.find((entry) => entry.id === entryId)!.position;
      return current.x !== position.x || current.y !== position.y;
    })
    .sort((a, b) => a.entryId.localeCompare(b.entryId));
}

export function arrangeDesktopAroundObstacle(entries: readonly DesktopEntry[], obstacle: DesktopObstacle, targetSegment: SurfaceSegment, size: { width: number; height: number }, metrics = DEFAULT_ICON_METRICS, gridSize = DEFAULT_GRID_SIZE, obstacles: readonly DesktopObstacle[] = []): RootEntryPositionUpdate[] | null {
  const roots = entries
    .filter((entry) => entry.parentId === null && segmentKey(projectLogicalPosition(entry.position, size).segment) === segmentKey(targetSegment))
    .sort((a, b) => {
      const left = projectLogicalPosition(a.position, size).local;
      const right = projectLogicalPosition(b.position, size).local;
      return left.x - right.x || left.y - right.y || a.id.localeCompare(b.id);
    });
  const byId = new Map(roots.map((entry) => [entry.id, entry]));
  const positions = new Map<string, EntryPosition>();
  const settled = new Set<string>();
  const queue = roots.filter((entry) => positionOverlapsObstacles(projectLogicalPosition(entry.position, size).local, metrics, [obstacle])).map((entry) => entry.id);
  const queued = new Set(queue);
  const allObstacles = [obstacle, ...obstacles];
  const overlaps = (position: EntryPosition, otherPosition: EntryPosition) => positionsOverlap(position, metrics, otherPosition, metrics);

  while (queue.length) {
    const id = queue.shift()!;
    if (settled.has(id)) continue;
    const entry = byId.get(id)!;
    const origin = projectLogicalPosition(entry.position, size).local;
    const maxX = size.width - metrics.width;
    const maxY = size.height - metrics.height;
    const startX = snapAxis(origin.x, GRID_ORIGIN.x, gridSize, maxX);
    const startY = snapAxis(origin.y, GRID_ORIGIN.y, gridSize, maxY);
    const columnStep = Math.ceil(metrics.width / gridSize) * gridSize;
    let logical: EntryPosition | undefined;
    const forwardColumns = [...Array(Math.floor((maxX - startX) / columnStep) + 1)].map((_, index) => startX + index * columnStep);
    const wrappedColumns = [...Array(Math.max(0, Math.floor((startX - GRID_ORIGIN.x - 1) / columnStep) + 1))].map((_, index) => GRID_ORIGIN.x + index * columnStep);
    const orderedColumns = [...forwardColumns, ...wrappedColumns];
    for (const x of orderedColumns) {
      if (logical) break;
      const rows = [...Array(Math.floor((maxY - GRID_ORIGIN.y) / gridSize) + 1)].map((_, index) => GRID_ORIGIN.y + index * gridSize);
      const orderedRows = x === startX ? [...rows.filter((y) => y > startY), ...rows.filter((y) => y <= startY)] : rows;
      for (const y of orderedRows) {
        const local = { x, y };
        const candidate = restoreLogicalPosition(local, targetSegment, size);
        if (allObstacles.every((item) => !positionsOverlap(local, metrics, item, item)) && [...settled].every((settledId) => !overlaps(candidate, positions.get(settledId)!))) {
          logical = candidate;
          break;
        }
      }
    }
    if (!logical) return null;
    positions.set(id, logical);
    settled.add(id);
    for (const neighbor of roots) {
      if (settled.has(neighbor.id) || queued.has(neighbor.id) || !overlaps(logical, neighbor.position)) continue;
      queued.add(neighbor.id);
      queue.push(neighbor.id);
    }
  }

  return [...positions].map(([entryId, position]) => ({ entryId, position })).sort((a, b) => a.entryId.localeCompare(b.entryId));
}

export function clampShellItemBounds(position: EntryPosition, width: number, height: number, area: { width: number; height: number }): DesktopObstacle {
  const nextWidth = Math.max(1, Math.min(MAX_LAYOUT_DIMENSION, width, area.width));
  const nextHeight = Math.max(1, Math.min(MAX_LAYOUT_DIMENSION, height, area.height));
  return {
    x: Math.max(0, Math.min(position.x, area.width - nextWidth)),
    y: Math.max(0, Math.min(position.y, area.height - nextHeight)),
    width: nextWidth,
    height: nextHeight,
  };
}

export function snapShellItemBounds(position: EntryPosition, width: number, height: number, area: { width: number; height: number }, gridSize = DEFAULT_GRID_SIZE): DesktopObstacle {
  const snappedWidth = Math.max(Math.ceil(MIN_SHELL_ITEM_SIZE.width / gridSize), Math.round(width / gridSize)) * gridSize;
  const snappedHeight = Math.max(Math.ceil(MIN_SHELL_ITEM_SIZE.height / gridSize), Math.round(height / gridSize)) * gridSize;
  const bounds = clampShellItemBounds(position, snappedWidth, snappedHeight, area);
  return clampShellItemBounds({
    x: snapAxis(bounds.x, GRID_ORIGIN.x, gridSize, Math.max(0, area.width - bounds.width)),
    y: snapAxis(bounds.y, GRID_ORIGIN.y, gridSize, Math.max(0, area.height - bounds.height)),
  }, bounds.width, bounds.height, area);
}

export function desktopShellItemObstacles(widgets: readonly DesktopWidget[], groups: readonly DesktopIconGroup[], entries: readonly DesktopEntry[], segment: SurfaceSegment, area: { width: number; height: number }) {
  const index = new Map(entries.map((entry) => [entry.id, entry]));
  const obstacles = widgets.flatMap((widget) => {
    if (!boundsIntersectSegment(widget, widget, segment, area)) return [];
    return [{ x: widget.x - segment.column * area.width, y: widget.y - segment.row * area.height, width: widget.width, height: widget.height }];
  });
  for (const group of groups) {
    const folder = index.get(group.folderId);
    if (folder?.kind !== "folder" || folder.parentId !== null) continue;
    if (!boundsIntersectSegment(folder.position, group, segment, area)) continue;
    obstacles.push({ x: folder.position.x - segment.column * area.width, y: folder.position.y - segment.row * area.height, width: group.width, height: group.height });
  }
  return obstacles;
}

export function iconAreaSize(viewport: { width: number; height: number }, gridSize = DEFAULT_GRID_SIZE) {
  return {
    width: Math.max(gridSize, Math.floor(viewport.width / gridSize) * gridSize),
    height: Math.max(gridSize, Math.floor(viewport.height / gridSize) * gridSize),
  };
}

export function projectLogicalAxis(value: number, viewportExtent: number) {
  const extent = Math.max(1, viewportExtent);
  const segment = Math.floor(value / extent);
  return { segment, local: value - segment * extent };
}

export function projectLogicalPosition(position: EntryPosition, size: { width: number; height: number }) {
  const x = projectLogicalAxis(position.x, size.width);
  const y = projectLogicalAxis(position.y, size.height);
  return {
    segment: { column: x.segment, row: y.segment },
    local: { x: x.local, y: y.local },
  };
}

export function boundsIntersectSegment(position: EntryPosition, footprint: { width: number; height: number }, segment: SurfaceSegment, size: { width: number; height: number }) {
  const left = segment.column * size.width;
  const top = segment.row * size.height;
  return position.x < left + size.width
    && position.x + footprint.width > left
    && position.y < top + size.height
    && position.y + footprint.height > top;
}

export function intersectingSegments(position: EntryPosition, footprint: { width: number; height: number }, size: { width: number; height: number }) {
  const minColumn = Math.floor(position.x / size.width);
  const maxColumn = Math.ceil((position.x + footprint.width) / size.width) - 1;
  const minRow = Math.floor(position.y / size.height);
  const maxRow = Math.ceil((position.y + footprint.height) / size.height) - 1;
  const segments: SurfaceSegment[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) segments.push({ column, row });
  }
  return segments;
}

export function restoreLogicalPosition(position: EntryPosition, segment: SurfaceSegment, size: { width: number; height: number }) {
  return {
    x: segment.column * Math.max(1, size.width) + position.x,
    y: segment.row * Math.max(1, size.height) + position.y,
  };
}

export function responsiveDesktop(entries: readonly DesktopEntry[], size: { width: number; height: number }, metrics = DEFAULT_ICON_METRICS): ResponsiveDesktop {
  const buckets = new Map<string, DesktopSegment>();
  const positions = new Map<string, EntryPosition>();
  for (const entry of entries) {
    if (entry.parentId !== null) continue;
    const projection = projectLogicalPosition(entry.position, size);
    const key = segmentKey(projection.segment);
    const segment = buckets.get(key) ?? { entries: [], key, segment: projection.segment };
    segment.entries.push(entry);
    buckets.set(key, segment);
    positions.set(entry.id, projection.local);
  }
  const segments = [...buckets.values()]
    .map((segment) => ({ ...segment, entries: [...segment.entries].sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.segment.row - b.segment.row || a.segment.column - b.segment.column);
  const columns = segments.map((segment) => segment.segment.column);
  const rows = segments.map((segment) => segment.segment.row);
  const minColumn = Math.min(0, ...columns);
  const maxColumn = Math.max(0, ...columns);
  const minRow = Math.min(0, ...rows);
  const maxRow = Math.max(0, ...rows);
  return {
    capacity: desktopSlots(size, false, metrics).length,
    columns: maxColumn - minColumn + 1,
    rows: maxRow - minRow + 1,
    minColumn,
    minRow,
    maxColumn,
    maxRow,
    segments,
    positions,
  };
}

import { DEFAULT_GRID_SIZE, type DesktopEntry, type EntryPosition, type RootEntryPositionUpdate } from "../types";
import type { DesktopIconMetrics } from "../lib/themes";

export const FILE_ICON_SIZE = { width: 98, height: 102 } as const;
export const GRID_ORIGIN = { x: 22, y: 22 } as const;
export const GRID_STEP = { x: 104, y: 112 } as const;
export const DEFAULT_ICON_METRICS: DesktopIconMetrics = { ...FILE_ICON_SIZE, stepX: GRID_STEP.x, stepY: GRID_STEP.y };

const MINIMAP_RESERVED_SIZE = { width: 138, height: 111 } as const;

export type SurfaceSegment = { column: number; row: number };

export type DesktopSegment = {
  entries: DesktopEntry[];
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

export function desktopSlots(size: { width: number; height: number }, reserveMinimap = false, metrics = DEFAULT_ICON_METRICS) {
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
      if (!underMinimap) slots.push(slot);
    }
  }
  return slots.length ? slots : [{ x: Math.min(maxX, GRID_ORIGIN.x), y: Math.min(maxY, GRID_ORIGIN.y) }];
}

function positionsOverlap(a: EntryPosition, b: EntryPosition, metrics: DesktopIconMetrics) {
  return a.x < b.x + metrics.width && a.x + metrics.width > b.x
    && a.y < b.y + metrics.height && a.y + metrics.height > b.y;
}

export function nextAvailableDesktopSlot(size: { width: number; height: number }, occupied: readonly EntryPosition[], reserveMinimap = false, fallbackIndex = 0, metrics = DEFAULT_ICON_METRICS) {
  const slots = desktopSlots(size, reserveMinimap, metrics);
  return slots.find((slot) => occupied.every((position) => !positionsOverlap(position, slot, metrics))) ?? slots[fallbackIndex % slots.length];
}

export function arrangeDesktopSegment(entries: readonly DesktopEntry[], segment: SurfaceSegment, size: { width: number; height: number }, metrics = DEFAULT_ICON_METRICS): RootEntryPositionUpdate[] | null {
  const arranged = entries
    .filter((entry) => entry.parentId === null && segmentKey(projectLogicalPosition(entry.position, size).segment) === segmentKey(segment))
    .sort((left, right) => {
      const a = projectLogicalPosition(left.position, size).local;
      const b = projectLogicalPosition(right.position, size).local;
      return a.x - b.x || a.y - b.y || left.id.localeCompare(right.id);
    });
  const slots = desktopSlots(size, false, metrics);
  if (arranged.length > slots.length) return null;
  return arranged.map((entry, index) => ({ entryId: entry.id, position: restoreLogicalPosition(slots[index], segment, size) }));
}

export function arrangeDesktopDrag(entries: readonly DesktopEntry[], movingEntryIds: ReadonlySet<string>, anchorEntryId: string, anchorPosition: EntryPosition, targetSegment: SurfaceSegment, size: { width: number; height: number }, metrics = DEFAULT_ICON_METRICS): RootEntryPositionUpdate[] | null {
  const roots = entries.filter((entry) => entry.parentId === null);
  const anchor = roots.find((entry) => entry.id === anchorEntryId && movingEntryIds.has(entry.id));
  if (!anchor) return null;
  const moving = roots.filter((entry) => movingEntryIds.has(entry.id)).sort((a, b) => a.id.localeCompare(b.id));
  const delta = { x: anchorPosition.x - anchor.position.x, y: anchorPosition.y - anchor.position.y };
  const positions = new Map<string, EntryPosition>();
  const settled = new Set<string>();
  const maxX = Math.max(8, size.width - metrics.width);
  const maxY = Math.max(8, size.height - metrics.height);

  for (const entry of moving) {
    const position = { x: entry.position.x + delta.x, y: entry.position.y + delta.y };
    const projection = projectLogicalPosition(position, size);
    if (segmentKey(projection.segment) !== segmentKey(targetSegment) || projection.local.x < 8 || projection.local.x > maxX || projection.local.y < 8 || projection.local.y > maxY) return null;
    if ([...positions.values()].some((other) => positionsOverlap(position, other, metrics))) return null;
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
  const byId = new Map(neighbors.map((entry) => [entry.id, entry]));
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueueCollisions = (position: EntryPosition) => {
    for (const entry of neighbors) {
      if (settled.has(entry.id) || queued.has(entry.id) || !positionsOverlap(position, entry.position, metrics)) continue;
      queued.add(entry.id);
      queue.push(entry.id);
    }
  };
  for (const position of positions.values()) enqueueCollisions(position);

  const slots = desktopSlots(size, false, metrics);
  while (queue.length) {
    const id = queue.shift()!;
    if (settled.has(id)) continue;
    const entry = byId.get(id)!;
    const origin = projectLogicalPosition(entry.position, size).local;
    const candidates = slots
      .map((slot, index) => ({ slot, index, distance: (slot.x - origin.x) ** 2 + (slot.y - origin.y) ** 2 }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index);
    const candidate = candidates.find(({ slot }) => {
      const logical = restoreLogicalPosition(slot, targetSegment, size);
      return [...settled].every((settledId) => !positionsOverlap(logical, positions.get(settledId)!, metrics));
    });
    if (!candidate) return null;
    const logical = restoreLogicalPosition(candidate.slot, targetSegment, size);
    positions.set(id, logical);
    settled.add(id);
    enqueueCollisions(logical);
  }

  return [...positions]
    .map(([entryId, position]) => ({ entryId, position }))
    .filter(({ entryId, position }) => {
      const current = roots.find((entry) => entry.id === entryId)!.position;
      return current.x !== position.x || current.y !== position.y;
    })
    .sort((a, b) => a.entryId.localeCompare(b.entryId));
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

import type { DesktopEntry } from "../types";
import { areaMapSegments } from "./desktop-areas";
import { segmentKey, type DesktopSegment, type SurfaceSegment } from "./desktop-geometry";

export function publicFolderBackTarget(entries: readonly DesktopEntry[], folderId: string | null) {
  if (!folderId) return undefined;
  return entries.find((entry) => entry.id === folderId && entry.kind === "folder")?.parentId;
}

export function publicAreaMapSegments(occupiedSegments: readonly DesktopSegment[], current: SurfaceSegment): DesktopSegment[] {
  const occupied = new Map(occupiedSegments.map((segment) => [segment.key, segment]));
  return areaMapSegments([...occupiedSegments.map((segment) => segment.segment), { column: 0, row: 0 }, current], current, false)
    .map((segment) => occupied.get(segmentKey(segment)) ?? { entries: [], key: segmentKey(segment), segment });
}

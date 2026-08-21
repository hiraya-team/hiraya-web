import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { DesktopEntry, EntryPosition, GridSize } from "../types";
import { entryDropTargetAt, highlightEntryDropTarget, type EntryDropDestination } from "./entry-drop-target";
import { createPointerDragPreview, movePointerDragPreview, removePointerDragPreview, type PointerDragPreview } from "./pointer-drag-preview";

type DragState = {
  entry: DesktopEntry;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  preview?: PointerDragPreview | null;
  snapPreview?: HTMLElement | null;
};

/** Coordinates pointer dragging for selected desktop entries. */
export function useEntryPointerDrag({ disabled, onMove, getDesktopDropPreview, gridSize }: {
  disabled: (entry: DesktopEntry) => boolean;
  onMove: (entry: DesktopEntry, destination: EntryDropDestination, point: { clientX: number; clientY: number }) => void;
  getDesktopDropPreview?: (clientX: number, clientY: number) => EntryPosition;
  gridSize?: GridSize;
}) {
  const drag = useRef<DragState | null>(null);

  useEffect(() => () => {
    removePointerDragPreview(drag.current?.preview);
    drag.current?.snapPreview?.remove();
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, entry: DesktopEntry) {
    if (event.button !== 0 || disabled(entry)) return;
    drag.current = { entry, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 5) return;
    current.moved = true;
    event.currentTarget.dataset.dragging = "true";
    current.preview ??= createPointerDragPreview(event.currentTarget, event.clientX, event.clientY);
    if (current.preview) movePointerDragPreview(current.preview, event.clientX, event.clientY);
    const dropTarget = entryDropTargetAt(event.clientX, event.clientY, current.entry.id);
    highlightEntryDropTarget(dropTarget?.element ?? null);
    if (dropTarget?.desktop && getDesktopDropPreview) {
      current.snapPreview ??= document.createElement("span");
      current.snapPreview.className = "file-icon-snap-preview entry-drop-preview";
      current.snapPreview.ariaHidden = "true";
      current.snapPreview.dataset.visible = "true";
      if (gridSize) {
        current.snapPreview.dataset.grid = `${gridSize}`;
        current.snapPreview.style.setProperty("--snap-grid-size", `${gridSize}px`);
      }
      if (!current.snapPreview.isConnected) dropTarget.element.append(current.snapPreview);
      const position = getDesktopDropPreview(event.clientX, event.clientY);
      current.snapPreview.style.left = `${position.x}px`;
      current.snapPreview.style.top = `${position.y}px`;
    } else {
      current.snapPreview?.remove();
      current.snapPreview = null;
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may be released implicitly between the check and call.
    }
    delete event.currentTarget.dataset.dragging;
    removePointerDragPreview(current.preview);
    current.snapPreview?.remove();
    if (current.moved) {
      const target = cancelled ? null : entryDropTargetAt(event.clientX, event.clientY, current.entry.id);
      if (target) onMove(current.entry, target, { clientX: event.clientX, clientY: event.clientY });
    }
    highlightEntryDropTarget(null);
  }

  return { onPointerDown, onPointerMove, finishPointer };
}

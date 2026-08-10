import { useEffect, useLayoutEffect, useRef } from "react";
import { AvailabilityBadge, EntryArtwork, EntryIcon, type EntryPreviewSource } from "./VisualPrimitives";
import type { DesktopEntry, EntryPosition } from "../types";
import { offlineStatusLabel, type OfflineEntryAvailability } from "../lib/offline-availability";
import { allowsMouseDoubleClick, contextMenuPressAction, resolveTouchRelease, type TouchTap } from "../ui/file-icon-gesture";
import { entryDropTargetAt, highlightEntryDropTarget, type EntryDropDestination } from "../ui/entry-drop-target";
import { browserEdgeDwellTimers, resetEdgeDwell, updateEdgeDwell, type EdgeDirection, type EdgeDwellState } from "../ui/edge-entry";
import { createPointerDragPreview, movePointerDragPreview, removePointerDragPreview, type PointerDragPreview } from "../ui/pointer-drag-preview";

type Props = {
  entry: DesktopEntry;
  selected: boolean;
  onSelect: (event: React.MouseEvent | React.PointerEvent) => void;
  onTouchSelect: () => void;
  onOpen: () => void;
  onMove: (position: EntryPosition, destination: EntryDropDestination, delta: EntryPosition) => Promise<boolean>;
  onDragMove?: (position: EntryPosition, destination: EntryDropDestination | null) => readonly { entryId: string; delta: EntryPosition }[] | null;
  dragEdgeAt: (clientX: number, clientY: number) => EdgeDirection | null;
  onDragAtEdge: (direction: EdgeDirection) => {
    deltaX: number;
    deltaY: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null;
  onEdgeDwellChange: (direction: EdgeDirection | null) => void;
  onDragEnd: (cancelled: boolean) => void;
  getSnapPreview?: (position: EntryPosition) => EntryPosition;
  onContextMenu: (event: React.MouseEvent) => void;
  onContextMenuAt: (x: number, y: number, presentation: "menu" | "sheet") => void;
  onExternalDrop?: (dataTransfer: DataTransfer) => void;
  offlineAvailability?: OfflineEntryAvailability;
  allowBrowserPinchZoom?: boolean;
  interactive?: boolean;
  loadPreview?: (id: string) => Promise<EntryPreviewSource>;
  readOnly?: boolean;
};

type DragState = {
  pointerX: number;
  pointerY: number;
  clientX: number;
  clientY: number;
  pointerId: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  moved: boolean;
  groupOriginX: number;
  groupOriginY: number;
  originX: number;
  originY: number;
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  canvas: HTMLElement;
  finishing: boolean;
  pointerType: string;
  longPressed: boolean;
  longPressTimer?: number;
  expectedPosition?: EntryPosition;
  expectedParentId?: string | null;
  moveSucceeded?: boolean;
  edgeDwell: EdgeDwellState;
  preview?: PointerDragPreview | null;
  readOnly: boolean;
  canDrag: boolean;
};

export const EntryTypeIcon = EntryIcon;

export function FileIcon({ entry, selected, onSelect, onTouchSelect, onOpen, onMove, onDragMove, dragEdgeAt, onDragAtEdge, onEdgeDwellChange, onDragEnd, getSnapPreview, onContextMenu, onContextMenuAt, onExternalDrop, offlineAvailability, allowBrowserPinchZoom = false, interactive = true, loadPreview, readOnly = false }: Props) {
  const iconRef = useRef<HTMLButtonElement>(null);
  const snapPreviewRef = useRef<HTMLSpanElement>(null);
  const lastTap = useRef<TouchTap | null>(null);
  const drag = useRef<DragState | null>(null);
  const renderedEntryRef = useRef({ parentId: entry.parentId, position: entry.position });
  const onMoveRef = useRef(onMove);
  const onDragMoveRef = useRef(onDragMove);
  const onDragEndRef = useRef(onDragEnd);
  const onEdgeDwellChangeRef = useRef(onEdgeDwellChange);
  const getSnapPreviewRef = useRef(getSnapPreview);
  onMoveRef.current = onMove;
  onDragMoveRef.current = onDragMove;
  onDragEndRef.current = onDragEnd;
  onEdgeDwellChangeRef.current = onEdgeDwellChange;
  getSnapPreviewRef.current = getSnapPreview;

  function cleanUpDrag(completed: DragState) {
    if (drag.current !== completed) return;
    if (snapPreviewRef.current) delete snapPreviewRef.current.dataset.visible;
    resetEdgeDwell(completed.edgeDwell, onEdgeDwellChangeRef.current, browserEdgeDwellTimers);
    drag.current = null;
    removePointerDragPreview(completed.preview);
    delete completed.canvas.dataset.iconDragging;
    iconRef.current?.style.removeProperty("transform");
    if (iconRef.current) delete iconRef.current.dataset.dragging;
    completed.canvas.querySelectorAll<HTMLElement>(".file-icon[data-group-dragging], .file-icon[data-auto-arrange-dragging]").forEach((icon) => {
      icon.style.removeProperty("transform");
      delete icon.dataset.groupDragging;
      delete icon.dataset.autoArrangeDragging;
    });
  }

  useEffect(() => () => {
    const current = drag.current;
    if (current?.longPressTimer) window.clearTimeout(current.longPressTimer);
    if (current) cleanUpDrag(current);
  }, []);

  useLayoutEffect(() => {
    renderedEntryRef.current = { parentId: entry.parentId, position: entry.position };
    const current = drag.current;
    if (!current?.moved) return;
    const icon = iconRef.current;
    if (icon) {
      current.baseX = icon.offsetLeft;
      current.baseY = icon.offsetTop;
      icon.style.transform = `translate3d(${current.x - current.baseX}px, ${current.y - current.baseY}px, 0)`;
    }
    if (
      current.moveSucceeded
      && current.expectedParentId === entry.parentId
      && current.expectedPosition?.x === entry.position.x
      && current.expectedPosition.y === entry.position.y
    ) cleanUpDrag(current);
  }, [entry.parentId, entry.position]);

  function updateSnapPreview(position: EntryPosition | null) {
    const preview = snapPreviewRef.current;
    if (!preview) return;
    if (!position) {
      delete preview.dataset.visible;
      return;
    }
    preview.style.left = `${position.x}px`;
    preview.style.top = `${position.y}px`;
    preview.dataset.visible = "true";
  }

  function applyDragTransform(current: DragState) {
    iconRef.current?.style.setProperty("transform", `translate3d(${current.x - current.baseX}px, ${current.y - current.baseY}px, 0)`);
    if (!iconRef.current?.dataset.selected) return;
    const groupDelta = { x: current.x - current.groupOriginX, y: current.y - current.groupOriginY };
    document.querySelectorAll<HTMLElement>(".file-icon[data-selected]").forEach((icon) => {
      if (icon === iconRef.current) return;
      icon.style.transform = `translate3d(${groupDelta.x}px, ${groupDelta.y}px, 0)`;
      icon.dataset.groupDragging = "true";
    });
  }

  function applyAutoArrangeTransforms(current: DragState, transforms: readonly { entryId: string; delta: EntryPosition }[] | null) {
    current.canvas.querySelectorAll<HTMLElement>(".file-icon[data-auto-arrange-dragging]").forEach((icon) => {
      icon.style.removeProperty("transform");
      delete icon.dataset.autoArrangeDragging;
    });
    if (!transforms) return;
    const byId = new Map(transforms.map((transform) => [transform.entryId, transform.delta]));
    current.canvas.querySelectorAll<HTMLElement>(".file-icon[data-entry-id]").forEach((icon) => {
      const delta = byId.get(icon.dataset.entryId ?? "");
      if (!delta || icon === iconRef.current || icon.dataset.groupDragging) return;
      icon.style.transform = `translate3d(${delta.x}px, ${delta.y}px, 0)`;
      icon.dataset.autoArrangeDragging = "true";
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (drag.current) {
      const current = drag.current;
      void finishDrag({ pointerId: current.pointerId, clientX: current.pointerX, clientY: current.pointerY }, true);
      if (drag.current) return;
    }
    const surface = event.currentTarget.parentElement;
    if (!surface) return;
    const canvas = event.currentTarget.closest<HTMLElement>(".desktop-canvas") ?? surface;

    if (event.pointerType !== "touch" || !allowBrowserPinchZoom) event.preventDefault();
    const bounds = surface.getBoundingClientRect();
    const canDrag = !readOnly && (event.pointerType !== "touch" || selected);
    drag.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      minX: 8,
      minY: 8,
      maxX: Math.max(8, bounds.width - event.currentTarget.offsetWidth - 8),
      maxY: Math.max(8, bounds.height - event.currentTarget.offsetHeight - 8),
      moved: false,
      groupOriginX: event.currentTarget.offsetLeft,
      groupOriginY: event.currentTarget.offsetTop,
      originX: event.currentTarget.offsetLeft,
      originY: event.currentTarget.offsetTop,
      baseX: event.currentTarget.offsetLeft,
      baseY: event.currentTarget.offsetTop,
      x: event.currentTarget.offsetLeft,
      y: event.currentTarget.offsetTop,
      canvas,
      finishing: false,
      pointerType: event.pointerType,
      longPressed: false,
      readOnly,
      canDrag,
      edgeDwell: { direction: null, latched: false, timer: null },
    };
    if (event.pointerType === "touch" && !readOnly) {
      drag.current.longPressTimer = window.setTimeout(() => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId || current.moved) return;
        current.longPressTimer = undefined;
        current.longPressed = true;
        lastTap.current = null;
        onContextMenuAt(event.clientX, event.clientY, "sheet");
      }, 500);
    }
    if (!canDrag) {
      if (event.pointerType !== "touch") onSelect(event);
      return;
    }
    canvas.dataset.iconDragging = "true";
    if (event.pointerType !== "touch" || !allowBrowserPinchZoom) event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType !== "touch") onSelect(event);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !iconRef.current) return;
    if (!drag.current.canDrag) {
      const threshold = drag.current.pointerType === "touch" ? 12 : 4;
      if (Math.hypot(event.clientX - drag.current.pointerX, event.clientY - drag.current.pointerY) >= threshold) {
        if (drag.current.longPressTimer) window.clearTimeout(drag.current.longPressTimer);
        drag.current.longPressTimer = undefined;
        drag.current.moved = true;
      }
      return;
    }
    const deltaX = event.clientX - drag.current.pointerX;
    const deltaY = event.clientY - drag.current.pointerY;
    drag.current.clientX = event.clientX;
    drag.current.clientY = event.clientY;

    const moveThreshold = drag.current.pointerType === "touch" ? 12 : 4;
    if (!drag.current.moved && Math.hypot(deltaX, deltaY) < moveThreshold) return;
    event.preventDefault();
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    if (drag.current.longPressTimer) window.clearTimeout(drag.current.longPressTimer);
    drag.current.longPressTimer = undefined;
    drag.current.moved = true;
    const x = Math.min(drag.current.maxX, Math.max(drag.current.minX, drag.current.originX + deltaX));
    const y = Math.min(drag.current.maxY, Math.max(drag.current.minY, drag.current.originY + deltaY));
    drag.current.x = x;
    drag.current.y = y;
    updateEdgeDwell(drag.current.edgeDwell, dragEdgeAt(event.clientX, event.clientY), (direction) => {
      const current = drag.current;
      if (!current || current.finishing) return;
      const pageChange = onDragAtEdge(direction);
      if (!pageChange) return;
      current.x += pageChange.deltaX;
      current.y += pageChange.deltaY;
      current.pointerX = current.clientX;
      current.pointerY = current.clientY;
      current.originX = current.x;
      current.originY = current.y;
      current.minX = pageChange.minX;
      current.minY = pageChange.minY;
      current.maxX = pageChange.maxX;
      current.maxY = pageChange.maxY;
      applyDragTransform(current);
    }, onEdgeDwellChangeRef.current, browserEdgeDwellTimers);
    const dropTarget = entryDropTargetAt(event.clientX, event.clientY, entry.id);
    highlightEntryDropTarget(dropTarget?.element ?? null);
    const currentPosition = { x: drag.current.x, y: drag.current.y };
    updateSnapPreview(getSnapPreview && dropTarget?.desktop ? getSnapPreview(currentPosition) : null);
    applyDragTransform(drag.current);
    const previewPosition = getSnapPreviewRef.current && dropTarget?.desktop ? getSnapPreviewRef.current(currentPosition) : currentPosition;
    applyAutoArrangeTransforms(drag.current, onDragMoveRef.current?.(previewPosition, dropTarget) ?? null);
    iconRef.current.dataset.dragging = "true";
    if (dropTarget && !dropTarget.desktop) {
      drag.current.preview ??= createPointerDragPreview(iconRef.current, event.clientX, event.clientY);
      if (drag.current.preview) movePointerDragPreview(drag.current.preview, event.clientX, event.clientY);
    } else {
      removePointerDragPreview(drag.current.preview);
      drag.current.preview = null;
    }
  }

  async function finishDrag(event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">, cancelled = false) {
    const completed = drag.current;
    if (!completed || completed.pointerId !== event.pointerId || completed.finishing) return;
    completed.finishing = true;
    highlightEntryDropTarget(null);
    updateSnapPreview(null);
    removePointerDragPreview(completed.preview);
    completed.preview = null;
    resetEdgeDwell(completed.edgeDwell, onEdgeDwellChangeRef.current, browserEdgeDwellTimers);
    if (completed.longPressTimer) window.clearTimeout(completed.longPressTimer);
    try {
      if (iconRef.current?.hasPointerCapture(event.pointerId)) iconRef.current.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may be released implicitly between the check and call.
    }
    const dropTarget = completed.canDrag && completed.moved && !cancelled ? entryDropTargetAt(event.clientX, event.clientY, entry.id) : null;
    const position = { x: Math.round(completed.x), y: Math.round(completed.y) };
    const preview = getSnapPreviewRef.current;
    const committedPosition = preview && dropTarget?.desktop ? preview(position) : position;
    completed.expectedPosition = dropTarget?.desktop ? committedPosition : renderedEntryRef.current.position;
    completed.expectedParentId = dropTarget?.parentId ?? renderedEntryRef.current.parentId;
    const move = completed.moved && !cancelled && dropTarget
      ? Promise.resolve().then(() => {
        applyAutoArrangeTransforms(completed, null);
        return onMoveRef.current(committedPosition, dropTarget, { x: position.x - completed.originX, y: position.y - completed.originY });
      })
      : Promise.resolve(!completed.moved && !cancelled);
    if (!completed.moved || cancelled) cleanUpDrag(completed);

    let succeeded = !cancelled;
    if (completed.moved && !cancelled) {
      try {
        succeeded = await move;
      } catch {
        succeeded = false;
      }
    }
    if (succeeded && completed.moved) {
      completed.moveSucceeded = true;
      const rendered = renderedEntryRef.current;
      if (
        rendered.parentId === completed.expectedParentId
        && rendered.position.x === completed.expectedPosition?.x
        && rendered.position.y === completed.expectedPosition.y
      ) cleanUpDrag(completed);
    } else if (!succeeded) cleanUpDrag(completed);
    onDragEndRef.current(cancelled || !succeeded);
    if (completed.pointerType === "touch") {
      const releaseTarget = document.elementFromPoint(event.clientX, event.clientY);
      const tap = { id: entry.id, x: event.clientX, y: event.clientY, at: performance.now() };
      const { action, nextTap } = resolveTouchRelease(lastTap.current, tap, {
        cancelled,
        moved: completed.moved,
        longPressed: completed.longPressed,
        releasedOnIcon: Boolean(releaseTarget && iconRef.current?.contains(releaseTarget)),
      });
      lastTap.current = nextTap;
      if (action === "select") onTouchSelect();
      else if (action === "open") onOpen();
    }
  }

  return (
    <>
      <span ref={snapPreviewRef} className="file-icon-snap-preview" aria-hidden="true" />
      <button
        ref={iconRef}
        className="file-icon"
        style={{
          "--file-x": `${entry.position.x}px`,
          "--file-y": `${entry.position.y}px`,
        } as React.CSSProperties}
        data-selected={selected || undefined}
        data-entry-id={entry.id}
        data-folder-id={entry.kind === "folder" ? entry.id : undefined}
        data-entry-drop-parent={entry.kind === "folder" && !readOnly ? entry.id : undefined}
        type="button"
        tabIndex={interactive ? undefined : -1}
        aria-hidden={interactive ? undefined : true}
        inert={interactive ? undefined : true}
        aria-label={`${entry.name}, ${entry.kind === "folder" ? "folder" : entry.mimeType || "file"}${offlineAvailability ? `, ${offlineStatusLabel(offlineAvailability)}` : ""}`}
        aria-pressed={selected}
        onClick={(event) => { if (event.detail === 0) onSelect(event); }}
        onDoubleClick={() => { if (allowsMouseDoubleClick(performance.now())) onOpen(); }}
        onContextMenu={(event) => {
          if (readOnly) { event.preventDefault(); return; }
          const current = drag.current;
          const action = contextMenuPressAction(current);
          if (action !== "open") {
            event.preventDefault();
            if (current?.longPressTimer) window.clearTimeout(current.longPressTimer);
            if (current) current.longPressTimer = undefined;
            return;
          }
          if (current) {
            current.longPressTimer = undefined;
            current.longPressed = true;
          }
          onContextMenu(event);
        }}
        onDragOver={entry.kind === "folder" && !readOnly ? (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.dataset.dropTarget = "true";
        } : undefined}
        onDragLeave={entry.kind === "folder" && !readOnly ? (event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) delete event.currentTarget.dataset.dropTarget;
        } : undefined}
        onDrop={entry.kind === "folder" && !readOnly ? (event) => {
          event.preventDefault();
          event.stopPropagation();
          delete event.currentTarget.dataset.dropTarget;
          onExternalDrop?.(event.dataTransfer);
        } : undefined}
        onKeyDown={(event) => {
          if (event.key === "Enter") onOpen();
          else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            const desktopBounds = event.currentTarget.closest(".desktop")?.getBoundingClientRect();
            const icons = Array.from(document.querySelectorAll<HTMLButtonElement>(".file-icon")).filter((icon) => {
              if (!desktopBounds) return true;
              const bounds = icon.getBoundingClientRect();
              return bounds.right > desktopBounds.left && bounds.left < desktopBounds.right && bounds.bottom > desktopBounds.top && bounds.top < desktopBounds.bottom;
            });
            const currentIndex = icons.indexOf(event.currentTarget);
            let target: HTMLButtonElement | undefined;
            if (event.key === "Home") target = icons[0];
            else if (event.key === "End") target = icons.at(-1);
            else {
              const currentBounds = event.currentTarget.getBoundingClientRect();
              const currentCenter = { x: currentBounds.left + currentBounds.width / 2, y: currentBounds.top + currentBounds.height / 2 };
              target = icons
                .filter((_, index) => index !== currentIndex)
                .map((icon) => {
                  const bounds = icon.getBoundingClientRect();
                  const dx = bounds.left + bounds.width / 2 - currentCenter.x;
                  const dy = bounds.top + bounds.height / 2 - currentCenter.y;
                  return { icon, dx, dy, distance: Math.hypot(dx, dy) };
                })
                .filter(({ dx, dy }) => event.key === "ArrowLeft" ? dx < 0 : event.key === "ArrowRight" ? dx > 0 : event.key === "ArrowUp" ? dy < 0 : dy > 0)
                .sort((a, b) => a.distance - b.distance)[0]?.icon;
            }
            if (target) { event.preventDefault(); target.focus(); target.click(); }
          }
          else if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
            event.preventDefault();
            if (readOnly) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            onContextMenuAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, "menu");
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => { void finishDrag(event); }}
        onPointerCancel={(event) => { void finishDrag(event, true); }}
        onLostPointerCapture={(event) => { void finishDrag(event, true); }}
      >
        <span className="file-icon__art">
          <EntryArtwork entry={entry} size={43} loadPreview={loadPreview} />
          {offlineAvailability && <AvailabilityBadge availability={offlineAvailability} />}
        </span>
        <span className="file-icon__name">{entry.name}</span>
      </button>
    </>
  );
}

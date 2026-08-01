import { useEffect, useLayoutEffect, useRef } from "react";
import { AvailabilityBadge, EntryIcon } from "./VisualPrimitives";
import type { DesktopEntry, EntryPosition, GridSize } from "../types";
import { offlineStatusLabel, type OfflineEntryAvailability } from "../lib/offline-availability";
import { allowsMouseDoubleClick, contextMenuPressAction, resolveTouchRelease, type TouchTap } from "../ui/file-icon-gesture";
import { entryDropTargetAt, highlightEntryDropTarget, type EntryDropDestination } from "../ui/entry-drop-target";

type Props = {
  entry: DesktopEntry;
  selected: boolean;
  onSelect: (event: React.MouseEvent | React.PointerEvent) => void;
  onTouchSelect: () => void;
  onOpen: () => void;
  onMove: (position: EntryPosition, destination: EntryDropDestination, delta: EntryPosition) => Promise<boolean>;
  onDragAtEdge: (clientX: number, clientY: number) => {
    deltaX: number;
    deltaY: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null;
  onDragEnd: (cancelled: boolean) => void;
  getSnapPreview?: (position: EntryPosition) => EntryPosition;
  gridSize?: GridSize;
  onContextMenu: (event: React.MouseEvent) => void;
  onContextMenuAt: (x: number, y: number, presentation: "menu" | "sheet") => void;
  onExternalDrop?: (dataTransfer: DataTransfer) => void;
  offlineAvailability?: OfflineEntryAvailability;
  allowBrowserPinchZoom?: boolean;
  interactive?: boolean;
};

type DragState = {
  pointerX: number;
  pointerY: number;
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
};

export const EntryTypeIcon = EntryIcon;

export function FileIcon({ entry, selected, onSelect, onTouchSelect, onOpen, onMove, onDragAtEdge, onDragEnd, getSnapPreview, gridSize, onContextMenu, onContextMenuAt, onExternalDrop, offlineAvailability, allowBrowserPinchZoom = false, interactive = true }: Props) {
  const iconRef = useRef<HTMLButtonElement>(null);
  const snapPreviewRef = useRef<HTMLSpanElement>(null);
  const lastTap = useRef<TouchTap | null>(null);
  const drag = useRef<DragState | null>(null);
  const renderedEntryRef = useRef({ parentId: entry.parentId, position: entry.position });
  const onMoveRef = useRef(onMove);
  const onDragEndRef = useRef(onDragEnd);
  const getSnapPreviewRef = useRef(getSnapPreview);
  onMoveRef.current = onMove;
  onDragEndRef.current = onDragEnd;
  getSnapPreviewRef.current = getSnapPreview;

  function cleanUpDrag(completed: DragState) {
    if (drag.current !== completed) return;
    drag.current = null;
    delete completed.canvas.dataset.iconDragging;
    iconRef.current?.style.removeProperty("transform");
    if (iconRef.current) delete iconRef.current.dataset.dragging;
    document.querySelectorAll<HTMLElement>(".file-icon[data-group-dragging]").forEach((icon) => {
      icon.style.removeProperty("transform");
      delete icon.dataset.groupDragging;
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

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (drag.current && drag.current.pointerId !== event.pointerId) {
      void finishDrag({ pointerId: drag.current.pointerId, clientX: drag.current.pointerX, clientY: drag.current.pointerY }, true);
      return;
    }
    const surface = event.currentTarget.parentElement;
    if (!surface) return;
    const canvas = event.currentTarget.closest<HTMLElement>(".desktop-canvas") ?? surface;

    if (event.pointerType !== "touch" || !allowBrowserPinchZoom) event.preventDefault();
    const bounds = surface.getBoundingClientRect();
    drag.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
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
    };
    if (event.pointerType === "touch") {
      drag.current.longPressTimer = window.setTimeout(() => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId || current.moved) return;
        current.longPressTimer = undefined;
        current.longPressed = true;
        lastTap.current = null;
        onContextMenuAt(event.clientX, event.clientY, "sheet");
      }, 500);
    }
    canvas.dataset.iconDragging = "true";
    if (event.pointerType !== "touch" || !allowBrowserPinchZoom) event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType !== "touch") onSelect(event);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !iconRef.current) return;
    const deltaX = event.clientX - drag.current.pointerX;
    const deltaY = event.clientY - drag.current.pointerY;

    const moveThreshold = drag.current.pointerType === "touch" ? 12 : 4;
    if (!drag.current.moved && Math.hypot(deltaX, deltaY) < moveThreshold) return;
    event.preventDefault();
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    if (drag.current.longPressTimer) window.clearTimeout(drag.current.longPressTimer);
    drag.current.longPressTimer = undefined;
    drag.current.moved = true;
    let x = Math.min(drag.current.maxX, Math.max(drag.current.minX, drag.current.originX + deltaX));
    let y = Math.min(drag.current.maxY, Math.max(drag.current.minY, drag.current.originY + deltaY));
    const pageChange = onDragAtEdge(event.clientX, event.clientY);
    if (pageChange) {
      x += pageChange.deltaX;
      y += pageChange.deltaY;
      drag.current.pointerX = event.clientX;
      drag.current.pointerY = event.clientY;
      drag.current.originX = x;
      drag.current.originY = y;
      drag.current.minX = pageChange.minX;
      drag.current.minY = pageChange.minY;
      drag.current.maxX = pageChange.maxX;
      drag.current.maxY = pageChange.maxY;
    }
    drag.current.x = x;
    drag.current.y = y;
    const dropTarget = entryDropTargetAt(event.clientX, event.clientY, entry.id);
    highlightEntryDropTarget(dropTarget?.element ?? null);
    updateSnapPreview(getSnapPreview && dropTarget?.desktop ? getSnapPreview({ x, y }) : null);
    iconRef.current.style.transform = `translate3d(${x - drag.current.baseX}px, ${y - drag.current.baseY}px, 0)`;
    iconRef.current.dataset.dragging = "true";
    if (iconRef.current.dataset.selected) {
      const groupDelta = { x: x - drag.current.groupOriginX, y: y - drag.current.groupOriginY };
      document.querySelectorAll<HTMLElement>(".file-icon[data-selected]").forEach((icon) => {
        if (icon === iconRef.current) return;
        icon.style.transform = `translate3d(${groupDelta.x}px, ${groupDelta.y}px, 0)`;
        icon.dataset.groupDragging = "true";
      });
    }
  }

  async function finishDrag(event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">, cancelled = false) {
    const completed = drag.current;
    if (!completed || completed.pointerId !== event.pointerId || completed.finishing) return;
    completed.finishing = true;
    if (completed.longPressTimer) window.clearTimeout(completed.longPressTimer);
    if (iconRef.current?.hasPointerCapture(event.pointerId)) iconRef.current.releasePointerCapture(event.pointerId);
    const dropTarget = completed.moved && !cancelled ? entryDropTargetAt(event.clientX, event.clientY, entry.id) : null;
    const position = { x: Math.round(completed.x), y: Math.round(completed.y) };
    const preview = getSnapPreviewRef.current;
    const committedPosition = preview && dropTarget?.desktop ? preview(position) : position;
    completed.expectedPosition = dropTarget?.desktop ? committedPosition : renderedEntryRef.current.position;
    completed.expectedParentId = dropTarget?.parentId ?? renderedEntryRef.current.parentId;
    const move = completed.moved && !cancelled && dropTarget
      ? Promise.resolve().then(() => onMoveRef.current(committedPosition, dropTarget, { x: position.x - completed.originX, y: position.y - completed.originY }))
      : Promise.resolve(!completed.moved && !cancelled);
    highlightEntryDropTarget(null);
    updateSnapPreview(null);
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
      <span ref={snapPreviewRef} className="file-icon-snap-preview" aria-hidden="true" style={gridSize ? { "--snap-grid-size": `${gridSize}px` } as React.CSSProperties : undefined} />
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
        data-entry-drop-parent={entry.kind === "folder" ? entry.id : undefined}
        type="button"
        tabIndex={interactive ? undefined : -1}
        aria-hidden={interactive ? undefined : true}
        inert={interactive ? undefined : true}
        aria-label={`${entry.name}, ${entry.kind === "folder" ? "folder" : entry.mimeType || "file"}${offlineAvailability ? `, ${offlineStatusLabel(offlineAvailability)}` : ""}`}
        aria-pressed={selected}
        onClick={(event) => { if (event.detail === 0) onSelect(event); }}
        onDoubleClick={() => { if (allowsMouseDoubleClick(performance.now())) onOpen(); }}
        onContextMenu={(event) => {
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
        onDragOver={entry.kind === "folder" ? (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.dataset.dropTarget = "true";
        } : undefined}
        onDragLeave={entry.kind === "folder" ? (event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) delete event.currentTarget.dataset.dropTarget;
        } : undefined}
        onDrop={entry.kind === "folder" ? (event) => {
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
            const bounds = event.currentTarget.getBoundingClientRect();
            onContextMenuAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, "menu");
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => { void finishDrag(event); }}
        onPointerCancel={(event) => { void finishDrag(event, true); }}
      >
        <span className="file-icon__art">
          <EntryIcon entry={entry} size={43} />
          {offlineAvailability && <AvailabilityBadge availability={offlineAvailability} />}
        </span>
        <span className="file-icon__name">{entry.name}</span>
      </button>
    </>
  );
}

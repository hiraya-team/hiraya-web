import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowSquareOut, CalendarBlank, Clock, CloudCheck, FolderOpen, Gauge, X } from "@phosphor-icons/react";
import type { CatalogQuota } from "../lib/desktop-catalog";
import type { DesktopEntry, DesktopIconGroup, DesktopWidget, EntryPosition, FolderEntry, GridSize } from "../types";
import { MIN_SHELL_ITEM_SIZE, boundsIntersectSegment, clampShellItemBounds, projectLogicalPosition, segmentKey, snapShellItemBounds, type SurfaceSegment } from "../ui/desktop-geometry";
import type { EntryDropDestination } from "../ui/entry-drop-target";
import { useEntryPointerDrag } from "../ui/use-entry-pointer-drag";
import { useTickingDate } from "../ui/use-ticking-date";
import { ItemList } from "./ItemList";
import { EntryArtwork, type EntryPreviewSource } from "./VisualPrimitives";

type StatusModel = {
  syncStatus: "blocked" | "connecting" | "error" | "local" | "offline" | "online" | "upgrade-required";
  isSyncing: boolean;
  outboxCount: number;
  quota: CatalogQuota | null;
};

type Props = {
  widgets: readonly DesktopWidget[];
  groups: readonly DesktopIconGroup[];
  entries: readonly DesktopEntry[];
  activeSegment: SurfaceSegment;
  ownerSegment?: SurfaceSegment;
  areaSize: { width: number; height: number };
  readOnly?: boolean;
  status?: StatusModel;
  renderWidget?: (widget: DesktopWidget) => ReactNode;
  loadPreview?: (id: string) => Promise<EntryPreviewSource>;
  selectedIds?: ReadonlySet<string>;
  onOpen: (entry: DesktopEntry) => void;
  onSelectEntry?: (folderId: string, entry: DesktopEntry, options: { toggle: boolean; range: boolean; orderedIds: string[]; presentation: "menu" | "sheet" }) => void;
  onEntryContextMenu?: (folderId: string, entry: DesktopEntry, x: number, y: number, presentation: "menu" | "sheet") => void;
  onMoveEntry?: (folderId: string, entry: DesktopEntry, destination: EntryDropDestination, point: { clientX: number; clientY: number }) => void;
  getDesktopDropPreview?: (clientX: number, clientY: number) => EntryPosition;
  isEntryReadOnly?: (entry: DesktopEntry) => boolean;
  onDrop?: (dataTransfer: DataTransfer, folderId: string) => void;
  onMoveWidget?: (widget: DesktopWidget, position: EntryPosition) => void;
  onResizeWidget?: (widget: DesktopWidget, size: { width: number; height: number }) => void;
  onPreviewWidget?: (widget: DesktopWidget, change: Partial<Pick<DesktopWidget, "x" | "y" | "width" | "height">>) => readonly { entryId: string; delta: EntryPosition }[] | null;
  onRemoveWidget?: (widget: DesktopWidget) => void;
  onSelectWidget?: (widget: DesktopWidget) => void;
  selectedWidgetId?: string | null;
  widgetBusy?: boolean;
  gridSize?: GridSize;
  onMoveGroup?: (folder: FolderEntry, position: EntryPosition) => void;
  onResizeGroup?: (group: DesktopIconGroup, size: { width: number; height: number }) => void;
  onPreviewGroup?: (folder: FolderEntry, group: DesktopIconGroup, change: { x: number; y: number; width: number; height: number }) => readonly { entryId: string; delta: EntryPosition }[] | null;
  onUngroup?: (group: DesktopIconGroup) => void;
};

type Interaction = { pointerId: number; pointerType: string; startX: number; startY: number; width: number; height: number; moved: boolean };

function ShellItem({ label, position, width, height, areaSize, readOnly, areaInteractive = true, widget = false, interactive = false, selected = false, busy = false, gridSize, onSelect, onMove, onResize, onPreview, onRemove, removeLabel, dropParentId, children, onDrop }: {
  label: string;
  position: EntryPosition;
  width: number;
  height: number;
  areaSize: { width: number; height: number };
  readOnly: boolean;
  areaInteractive?: boolean;
  widget?: boolean;
  interactive?: boolean;
  selected?: boolean;
  busy?: boolean;
  gridSize?: GridSize;
  onSelect?: () => void;
  onMove?: (position: EntryPosition) => void;
  onResize?: (size: { width: number; height: number }) => void;
  onPreview?: (change: { x: number; y: number; width: number; height: number }) => readonly { entryId: string; delta: EntryPosition }[] | null;
  onRemove?: () => void;
  removeLabel?: string;
  dropParentId?: string;
  children: ReactNode;
  onDrop?: (dataTransfer: DataTransfer) => void;
}) {
  const bounds = { x: position.x, y: position.y, width, height };
  const ref = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLSpanElement>(null);
  const desktopRef = useRef<HTMLElement | null>(null);
  const drag = useRef<Interaction | null>(null);
  const resize = useRef<Interaction | null>(null);
  const pointerBounds = (target: typeof drag, current: Interaction, x: number, y: number) => target === drag
    ? clampShellItemBounds({ x: bounds.x + x, y: bounds.y + y }, bounds.width, bounds.height, areaSize)
    : clampShellItemBounds(bounds, Math.max(MIN_SHELL_ITEM_SIZE.width, current.width + x), Math.max(MIN_SHELL_ITEM_SIZE.height, current.height + y), areaSize);
  const adjustedBounds = (target: typeof drag, current: Interaction, x: number, y: number) => {
    const next = pointerBounds(target, current, x, y);
    return gridSize ? snapShellItemBounds(next, next.width, next.height, areaSize, gridSize) : next;
  };
  const updateSnapPreview = (next: ReturnType<typeof clampShellItemBounds> | null) => {
    const preview = previewRef.current;
    if (!preview) return;
    if (!next || !gridSize) {
      delete preview.dataset.visible;
      return;
    }
    preview.style.left = `${next.x}px`;
    preview.style.top = `${next.y}px`;
    preview.style.width = `${next.width}px`;
    preview.style.height = `${next.height}px`;
    preview.dataset.visible = "true";
  };
  const applyIconTransforms = (transforms: readonly { entryId: string; delta: EntryPosition }[] | null) => {
    const desktop = desktopRef.current ?? ref.current?.closest<HTMLElement>(".desktop");
    desktop?.querySelectorAll<HTMLElement>(".file-icon[data-widget-arrange-dragging]").forEach((icon) => {
      icon.style.removeProperty("transform");
      delete icon.dataset.widgetArrangeDragging;
    });
    if (!transforms) return;
    const byId = new Map(transforms.map((transform) => [transform.entryId, transform.delta]));
    desktop?.querySelectorAll<HTMLElement>(".file-icon[data-entry-id]").forEach((icon) => {
      const delta = byId.get(icon.dataset.entryId ?? "");
      if (!delta) return;
      icon.style.transform = `translate3d(${delta.x}px, ${delta.y}px, 0)`;
      icon.dataset.widgetArrangeDragging = "true";
    });
  };
  const resetVisuals = (target: typeof drag) => {
    if (target === drag) ref.current?.style.removeProperty("transform");
    else {
      ref.current?.style.setProperty("width", `${bounds.width}px`);
      ref.current?.style.setProperty("height", `${bounds.height}px`);
    }
    if (ref.current) delete ref.current.dataset.dragging;
    updateSnapPreview(null);
    applyIconTransforms(null);
  };
  useEffect(() => () => {
    drag.current = null;
    resize.current = null;
    desktopRef.current?.querySelectorAll<HTMLElement>(".file-icon[data-widget-arrange-dragging]").forEach((icon) => {
      icon.style.removeProperty("transform");
      delete icon.dataset.widgetArrangeDragging;
    });
  }, []);
  const begin = (event: ReactPointerEvent, target: typeof drag) => {
    if (readOnly || busy || drag.current || resize.current || event.button !== 0) return;
    event.preventDefault();
    onSelect?.();
    desktopRef.current = ref.current?.closest<HTMLElement>(".desktop") ?? null;
    target.current = { pointerId: event.pointerId, pointerType: event.pointerType, startX: event.clientX, startY: event.clientY, width: bounds.width, height: bounds.height, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent, target: typeof drag) => {
    const current = target.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const x = event.clientX - current.startX;
    const y = event.clientY - current.startY;
    if (!current.moved && Math.hypot(x, y) < (current.pointerType === "touch" ? 12 : 4)) return;
    current.moved = true;
    const raw = pointerBounds(target, current, x, y);
    const next = adjustedBounds(target, current, x, y);
    if (target === drag) {
      ref.current?.style.setProperty("transform", `translate3d(${raw.x - bounds.x}px, ${raw.y - bounds.y}px, 0)`);
    }
    else {
      ref.current?.style.setProperty("width", `${raw.width}px`);
      ref.current?.style.setProperty("height", `${raw.height}px`);
    }
    if (ref.current) ref.current.dataset.dragging = "true";
    updateSnapPreview(next);
    applyIconTransforms(onPreview?.(next) ?? null);
  };
  const finish = (event: ReactPointerEvent, target: typeof drag, cancelled = false) => {
    const current = target.current;
    if (!current || current.pointerId !== event.pointerId) return;
    target.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may be released implicitly between the check and call.
    }
    const x = event.clientX - current.startX;
    const y = event.clientY - current.startY;
    resetVisuals(target);
    desktopRef.current = null;
    if (cancelled || !current.moved) return;
    const next = adjustedBounds(target, current, x, y);
    if (target === drag) {
      onMove?.({ x: next.x, y: next.y });
    } else {
      onResize?.({ width: next.width, height: next.height });
    }
  };
  const keyboardAdjust = (event: React.KeyboardEvent, mode: "move" | "resize") => {
    if (event.key === "Escape") {
      const target = drag.current ? drag : resize.current ? resize : null;
      const current = target?.current;
      if (!target || !current) return;
      event.preventDefault();
      target.current = null;
      try {
        if (event.currentTarget.hasPointerCapture(current.pointerId)) event.currentTarget.releasePointerCapture(current.pointerId);
      } catch {
        // Pointer capture may already be gone.
      }
      resetVisuals(target);
      desktopRef.current = null;
      return;
    }
    if (readOnly || busy || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = gridSize ?? (event.shiftKey ? 24 : 8);
    const x = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const y = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (mode === "move") {
      const next = adjustedBounds(drag, { pointerId: 0, pointerType: "keyboard", startX: 0, startY: 0, width: bounds.width, height: bounds.height, moved: true }, x, y);
      onMove?.({ x: next.x, y: next.y });
    } else {
      const next = adjustedBounds(resize, { pointerId: 0, pointerType: "keyboard", startX: 0, startY: 0, width: bounds.width, height: bounds.height, moved: true }, x, y);
      onResize?.({ width: next.width, height: next.height });
    }
  };

  return <>
    {gridSize && <span ref={previewRef} className="shell-item-snap-preview" aria-hidden="true" />}
    <article
      ref={ref}
      className={`shell-item${widget ? " shell-item--widget" : ""}${interactive ? " shell-item--interactive" : ""}`}
      style={{ "--shell-x": `${bounds.x}px`, "--shell-y": `${bounds.y}px`, width: bounds.width, height: bounds.height } as CSSProperties}
      aria-label={label}
      aria-hidden={!areaInteractive || undefined}
      inert={!areaInteractive || undefined}
      data-selected={selected || undefined}
      data-entry-drop-parent={readOnly ? undefined : dropParentId}
      onDragOver={onDrop && !readOnly ? (event) => { event.preventDefault(); event.currentTarget.dataset.dropActive = "true"; } : undefined}
      onDragLeave={onDrop ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) delete event.currentTarget.dataset.dropActive; } : undefined}
      onDrop={onDrop && !readOnly ? (event) => { event.preventDefault(); delete event.currentTarget.dataset.dropActive; onDrop(event.dataTransfer); } : undefined}
    >
    {!widget && <header className="shell-item__header">
      <button className="shell-item__drag" type="button" disabled={readOnly || busy} aria-label={`Move ${label}`} title={readOnly ? undefined : "Drag to move; use arrow keys for precise movement"} onKeyDown={(event) => keyboardAdjust(event, "move")} onPointerDown={(event) => begin(event, drag)} onPointerMove={(event) => move(event, drag)} onPointerUp={(event) => finish(event, drag)} onPointerCancel={(event) => finish(event, drag, true)} onLostPointerCapture={(event) => finish(event, drag, true)}>{label}</button>
      {!readOnly && onRemove && <button className="shell-item__remove" type="button" disabled={busy} aria-label={removeLabel ?? `Remove ${label}`} title={removeLabel ?? `Remove ${label}`} onClick={onRemove}><X size={15} /></button>}
    </header>}
    {widget && !readOnly && <button className="shell-item__widget-drag" type="button" disabled={busy} aria-label={`Move ${label}`} aria-pressed={selected} title="Drag to move; use arrow keys for precise movement" onClick={onSelect} onFocus={onSelect} onKeyDown={(event) => keyboardAdjust(event, "move")} onPointerDown={(event) => begin(event, drag)} onPointerMove={(event) => move(event, drag)} onPointerUp={(event) => finish(event, drag)} onPointerCancel={(event) => finish(event, drag, true)} onLostPointerCapture={(event) => finish(event, drag, true)} />}
    <div className="shell-item__content">{children}</div>
    {!readOnly && onResize && (!widget || selected) && <button className="shell-item__resize" type="button" disabled={busy} aria-label={`Resize ${label}`} title="Drag to resize; use arrow keys for precise sizing" onKeyDown={(event) => keyboardAdjust(event, "resize")} onPointerDown={(event) => begin(event, resize)} onPointerMove={(event) => move(event, resize)} onPointerUp={(event) => finish(event, resize)} onPointerCancel={(event) => finish(event, resize, true)} onLostPointerCapture={(event) => finish(event, resize, true)} />}
    {widget && selected && onRemove && <button className="shell-item__remove shell-item__remove--widget" type="button" disabled={busy} aria-label={removeLabel ?? `Remove ${label}`} title={removeLabel ?? `Remove ${label}`} onClick={onRemove}><X size={15} /></button>}
    </article>
  </>;
}

function ClockWidget() {
  const now = useTickingDate();
  return <div className="shell-widget shell-widget--clock"><Clock weight="duotone" /><strong>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong><span>{now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span></div>;
}

function CalendarWidget() {
  const now = useTickingDate();
  return <div className="shell-widget shell-widget--calendar"><CalendarBlank weight="duotone" /><span>{now.toLocaleDateString([], { month: "long" })}</span><strong>{now.getDate()}</strong><small>{now.toLocaleDateString([], { weekday: "long" })}</small></div>;
}

function StatusWidget({ status }: { status?: StatusModel }) {
  if (!status) return <div className="shell-widget shell-widget--status"><CloudCheck weight="duotone" /><strong>Shared desktop</strong><span>Read only</span></div>;
  const syncLabel = status.syncStatus === "local" ? "Saved in this browser" : status.syncStatus === "offline" ? "Working offline" : ["blocked", "error", "upgrade-required"].includes(status.syncStatus) ? "Sync needs attention" : status.isSyncing ? "Synchronizing" : status.syncStatus === "connecting" ? "Connecting" : "Up to date";
  const entryQuota = status.quota?.entries;
  return <div className="shell-widget shell-widget--status"><Gauge weight="duotone" /><strong>{syncLabel}</strong><span>{status.outboxCount ? `${status.outboxCount} queued ${status.outboxCount === 1 ? "change" : "changes"}` : "No queued changes"}</span>{entryQuota && <small>{entryQuota.used.toLocaleString()} of {entryQuota.limit.toLocaleString()} items</small>}</div>;
}

function IconGroupContents({ folder, entries, readOnly, loadPreview, selectedIds, onOpen, onSelectEntry, onEntryContextMenu, onMoveEntry, getDesktopDropPreview, isEntryReadOnly, onDrop }: {
  folder: FolderEntry;
  entries: readonly DesktopEntry[];
  readOnly: boolean;
  loadPreview?: (id: string) => Promise<EntryPreviewSource>;
  selectedIds: ReadonlySet<string>;
  onOpen: (entry: DesktopEntry) => void;
  onSelectEntry?: Props["onSelectEntry"];
  onEntryContextMenu?: Props["onEntryContextMenu"];
  onMoveEntry?: Props["onMoveEntry"];
  getDesktopDropPreview?: Props["getDesktopDropPreview"];
  isEntryReadOnly: (entry: DesktopEntry) => boolean;
  onDrop?: Props["onDrop"];
}) {
  const orderedIds = entries.map((entry) => entry.id);
  const entryDrag = useEntryPointerDrag({
    disabled: (entry) => readOnly || !onMoveEntry || isEntryReadOnly(entry),
    onMove: (entry, destination, point) => onMoveEntry?.(folder.id, entry, destination, point),
    getDesktopDropPreview,
  });

  return <div className="icon-group__grid">
    <ItemList items={entries} getId={(entry) => entry.id} label={`Contents of ${folder.name}`} role="listbox" multiselectable={!readOnly} layout="grid" className="icon-group__list" onSelect={onSelectEntry ? (entry, detail) => onSelectEntry(folder.id, entry, { toggle: detail.toggle, range: detail.range, orderedIds, presentation: detail.presentation }) : undefined} onActivate={onOpen} onContextMenu={!readOnly && onEntryContextMenu ? (entry, detail) => {
      if (!isEntryReadOnly(entry)) onEntryContextMenu(folder.id, entry, detail.clientX, detail.clientY, detail.presentation);
    } : undefined} renderItem={(entry, { itemProps }) => {
      const entryReadOnly = isEntryReadOnly(entry);
      const folderTarget = entry.kind === "folder" && !readOnly && !entryReadOnly;
      return <button
        {...itemProps}
        className="icon-group__entry"
        key={entry.id}
        type="button"
        role="option"
        aria-selected={selectedIds.has(entry.id)}
        aria-label={`${entry.name}, ${entry.kind === "folder" ? "folder" : entry.mimeType || "file"}`}
        data-selected={selectedIds.has(entry.id) || undefined}
        data-entry-id={entry.id}
        data-folder-target={entry.kind === "folder" ? entry.id : undefined}
        data-entry-drop-parent={folderTarget ? entry.id : undefined}
        data-item-context={entryReadOnly ? undefined : itemProps["data-item-context"]}
        onDragOver={folderTarget ? (event) => { event.preventDefault(); event.currentTarget.dataset.dropTarget = "true"; } : undefined}
        onDragLeave={folderTarget ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) delete event.currentTarget.dataset.dropTarget; } : undefined}
        onDrop={folderTarget && onDrop ? (event) => { event.preventDefault(); event.stopPropagation(); delete event.currentTarget.dataset.dropTarget; onDrop(event.dataTransfer, entry.id); } : undefined}
        onPointerDown={(event) => entryDrag.onPointerDown(event, entry)}
        onPointerMove={entryDrag.onPointerMove}
        onPointerUp={(event) => entryDrag.finishPointer(event)}
        onPointerCancel={(event) => entryDrag.finishPointer(event, true)}
        onLostPointerCapture={(event) => entryDrag.finishPointer(event, true)}
      ><span className="icon-group__art"><EntryArtwork entry={entry} size={32} loadPreview={loadPreview} /></span><span>{entry.name}</span></button>;
    }} />
    <button className="icon-group__open" type="button" onClick={() => onOpen(folder)}><span><FolderOpen size={28} weight="duotone" /><ArrowSquareOut size={13} /></span><strong>Open in Explorer</strong></button>
  </div>;
}

export function ShellItemLayer({ widgets, groups, entries, activeSegment, ownerSegment = activeSegment, areaSize, readOnly = false, status, renderWidget, loadPreview, selectedIds = new Set(), onOpen, onSelectEntry, onEntryContextMenu, onMoveEntry, getDesktopDropPreview, isEntryReadOnly = () => false, onDrop, onMoveWidget, onResizeWidget, onPreviewWidget, onRemoveWidget, onSelectWidget, selectedWidgetId, widgetBusy, gridSize, onMoveGroup, onResizeGroup, onPreviewGroup, onUngroup }: Props) {
  const index = new Map(entries.map((entry) => [entry.id, entry]));
  const ownerKey = segmentKey(ownerSegment);
  const visibleWidgets = widgets.filter((widget) => segmentKey(projectLogicalPosition(widget, areaSize).segment) === ownerKey);
  const visibleGroups = groups.flatMap((group) => {
    const folder = index.get(group.folderId);
    return folder?.kind === "folder" && folder.parentId === null && segmentKey(projectLogicalPosition(folder.position, areaSize).segment) === ownerKey ? [{ group, folder }] : [];
  });
  if (!visibleWidgets.length && !visibleGroups.length) return null;

  return <div className="shell-item-layer">
    {visibleWidgets.map((widget) => {
      const position = projectLogicalPosition(widget, areaSize).local;
      const title = widget.kind === "clock" ? "Clock" : widget.kind === "calendar" ? "Calendar" : widget.kind === "status" ? "Status" : "Todo list";
      return <ShellItem key={widget.id} label={title} position={position} width={widget.width} height={widget.height} areaSize={areaSize} readOnly={readOnly} areaInteractive={boundsIntersectSegment(widget, widget, activeSegment, areaSize)} widget interactive={widget.kind === "todo"} selected={selectedWidgetId === widget.id} busy={widgetBusy} gridSize={gridSize} onSelect={() => onSelectWidget?.(widget)} onMove={(local) => onMoveWidget?.(widget, { x: ownerSegment.column * areaSize.width + local.x, y: ownerSegment.row * areaSize.height + local.y })} onResize={(size) => onResizeWidget?.(widget, size)} onPreview={(bounds) => onPreviewWidget?.(widget, { x: ownerSegment.column * areaSize.width + bounds.x, y: ownerSegment.row * areaSize.height + bounds.y, width: bounds.width, height: bounds.height }) ?? null} onRemove={() => onRemoveWidget?.(widget)}>
        {widget.kind === "clock" ? <ClockWidget /> : widget.kind === "calendar" ? <CalendarWidget /> : widget.kind === "status" ? <StatusWidget status={status} /> : renderWidget?.(widget)}
      </ShellItem>;
    })}
    {visibleGroups.map(({ group, folder }) => {
      const position = projectLogicalPosition(folder.position, areaSize).local;
      const children = entries.filter((entry) => entry.parentId === folder.id).sort((a, b) => a.name.localeCompare(b.name));
      return <ShellItem key={folder.id} label={folder.name} position={position} width={group.width} height={group.height} areaSize={areaSize} readOnly={readOnly} areaInteractive={boundsIntersectSegment(folder.position, group, activeSegment, areaSize)} busy={widgetBusy} gridSize={gridSize} onMove={(local) => onMoveGroup?.(folder, { x: ownerSegment.column * areaSize.width + local.x, y: ownerSegment.row * areaSize.height + local.y })} onResize={(size) => onResizeGroup?.(group, size)} onPreview={(bounds) => onPreviewGroup?.(folder, group, { x: ownerSegment.column * areaSize.width + bounds.x, y: ownerSegment.row * areaSize.height + bounds.y, width: bounds.width, height: bounds.height }) ?? null} onRemove={() => onUngroup?.(group)} removeLabel={`Ungroup ${folder.name}`} dropParentId={folder.id} onDrop={onDrop ? (dataTransfer) => onDrop(dataTransfer, folder.id) : undefined}>
        <IconGroupContents folder={folder} entries={children} readOnly={readOnly} loadPreview={loadPreview} selectedIds={selectedIds} onOpen={onOpen} onSelectEntry={onSelectEntry} onEntryContextMenu={onEntryContextMenu} onMoveEntry={onMoveEntry} getDesktopDropPreview={getDesktopDropPreview} isEntryReadOnly={isEntryReadOnly} onDrop={onDrop} />
      </ShellItem>;
    })}
  </div>;
}

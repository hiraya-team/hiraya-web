import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CaretRight, DotsThreeVertical, FilePlus, Folder, FolderOpen, FolderPlus, ListBullets, MagnifyingGlass, SortAscending, SortDescending, SquaresFour, UploadSimple, X } from "@phosphor-icons/react";
import type { DesktopEntry, EntryPosition, FolderEntry, GridSize } from "../types";
import type { ExplorerView } from "../domain/preferences";
import { filterAndSortEntries, formatEntrySize, sortActionLabel, sortSummary, type FolderSortKey, type SortDirection } from "../ui/folder-explorer";
import type { AppWindowHeaderElements } from "./AppWindow";
import { MobileHeaderMenu } from "./MobileHeaderMenu";
import { offlineStatusLabel, type OfflineEntryAvailability } from "../lib/offline-availability";
import { AvailabilityBadge, EntryArtwork, type EntryPreviewSource } from "./VisualPrimitives";
import { allowsMouseDoubleClick, contextMenuPressAction, resolveTouchRelease, type TouchTap } from "../ui/file-icon-gesture";
import { entryDropTargetAt, highlightEntryDropTarget, type EntryDropDestination } from "../ui/entry-drop-target";
import { createPointerDragPreview, movePointerDragPreview, removePointerDragPreview, type PointerDragPreview } from "../ui/pointer-drag-preview";

export interface FolderExplorerProps {
  folder: FolderEntry | null;
  rootLabel: string;
  /** Ordered ancestors of folder, starting immediately below the desktop root. */
  breadcrumbs: readonly FolderEntry[];
  children: readonly DesktopEntry[];
  onNavigate: (folder: FolderEntry | null) => void;
  onOpen: (entry: DesktopEntry) => void;
  onCreateFolder: (parentId: string | null) => void;
  onCreateFile: (parentId: string | null) => void;
  onUpload: (parentId: string | null) => void;
  onImportFolder: (parentId: string | null) => void;
  onExternalDrop: (dataTransfer: DataTransfer, parentId: string | null) => void;
  onContextMenu: (entry: DesktopEntry, x: number, y: number, presentation: "menu" | "sheet") => void;
  onBlankContextMenu: (parentId: string | null, x: number, y: number, presentation: "menu" | "sheet") => void;
  onClearSelection?: () => void;
  selectedIds: ReadonlySet<string>;
  onSelect: (entry: DesktopEntry, options: { toggle: boolean; range: boolean; orderedIds: string[] }) => void;
  mobileMultiSelect?: boolean;
  onMove: (entry: DesktopEntry, destination: EntryDropDestination, point: { clientX: number; clientY: number }) => void;
  getDesktopDropPreview?: (clientX: number, clientY: number) => EntryPosition;
  gridSize?: GridSize;
  readOnly?: boolean;
  headerElements?: AppWindowHeaderElements;
  offlineAvailability?: Readonly<Record<string, OfflineEntryAvailability>>;
  view: ExplorerView;
  onViewChange: (view: ExplorerView) => void;
  viewChangeDisabled?: boolean;
  loadPreview?: (id: string) => Promise<EntryPreviewSource>;
  isEntryReadOnly?: (entry: DesktopEntry) => boolean;
  protectedStatus?: { message: string; error?: boolean; onRetry?: () => void };
}

type DragState = {
  entry: DesktopEntry;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  pointerType: string;
  longPressed: boolean;
  longPressTimer?: number;
  preview?: PointerDragPreview | null;
  snapPreview?: HTMLElement | null;
  readOnly: boolean;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

export function FolderExplorer({ folder, rootLabel, breadcrumbs, children, onNavigate, onOpen, onCreateFolder, onCreateFile, onUpload, onImportFolder, onExternalDrop, onContextMenu, onBlankContextMenu, onClearSelection, selectedIds, onSelect, mobileMultiSelect = false, onMove, getDesktopDropPreview, gridSize, readOnly = false, headerElements, offlineAvailability = {}, view, onViewChange, viewChangeDisabled = false, loadPreview, isEntryReadOnly = () => false, protectedStatus }: FolderExplorerProps) {
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const lastTap = useRef<TouchTap | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<FolderSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const parentId = folder?.id ?? null;
  const orderedChildren = filterAndSortEntries(children, search, sortKey, sortDirection);
  const orderedIds = orderedChildren.map((item) => item.id);
  const trail = folder && breadcrumbs.at(-1)?.id !== folder.id ? [...breadcrumbs, folder] : breadcrumbs;

  useEffect(
    () => () => {
      if (drag.current?.longPressTimer) window.clearTimeout(drag.current.longPressTimer);
      removePointerDragPreview(drag.current?.preview);
      drag.current?.snapPreview?.remove();
    },
    [],
  );

  function open(entry: DesktopEntry) {
    if (entry.kind === "folder") onNavigate(entry);
    else onOpen(entry);
  }

  function chooseSort(key: FolderSortKey) {
    if (sortKey === key) setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>, entry: DesktopEntry) {
    if (event.button !== 0) return;
    drag.current = {
      entry,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pointerType: event.pointerType,
      longPressed: false,
      readOnly: readOnly || isEntryReadOnly(entry),
    };
    if (event.pointerType === "touch" && !isEntryReadOnly(entry)) {
      drag.current.longPressTimer = window.setTimeout(() => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId || current.moved) return;
        current.longPressTimer = undefined;
        current.longPressed = true;
        lastTap.current = null;
        onContextMenu(entry, event.clientX, event.clientY, "sheet");
      }, 500);
    }
    if (drag.current.readOnly) return;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.readOnly) {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 5) current.moved = true;
      return;
    }
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 5) return;
    if (current.longPressTimer) window.clearTimeout(current.longPressTimer);
    current.longPressTimer = undefined;
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

  function finishPointer(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.longPressTimer) window.clearTimeout(current.longPressTimer);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    delete event.currentTarget.dataset.dragging;
    removePointerDragPreview(current.preview);
    current.snapPreview?.remove();

    if (current.readOnly && current.pointerType !== "touch") return;
    if (current.moved && !current.readOnly) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const target = cancelled ? null : entryDropTargetAt(event.clientX, event.clientY, current.entry.id);
      if (target) onMove(current.entry, target, { clientX: event.clientX, clientY: event.clientY });
    } else if (current.pointerType === "touch") {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const releasedAt = performance.now();
      const tap = {
        id: current.entry.id,
        x: event.clientX,
        y: event.clientY,
        at: releasedAt,
      };
      const { action, nextTap } = resolveTouchRelease(lastTap.current, tap, {
        cancelled,
        moved: current.moved,
        longPressed: current.longPressed,
        releasedOnIcon: event.currentTarget.contains(document.elementFromPoint(event.clientX, event.clientY)),
      });
      lastTap.current = nextTap;
      if (action === "select")
        onSelect(current.entry, {
          toggle: mobileMultiSelect,
          range: false,
          orderedIds,
        });
      else if (action === "open") open(current.entry);
    }
    highlightEntryDropTarget(null);
  }

  const previousFolder = trail.length > 1 ? trail.at(-2)! : null;

  return (
    <div className="file-window file-window--embedded folder-explorer folder-explorer--embedded">
      {headerElements?.leading &&
        folder &&
        createPortal(
          <button className="app-window__control folder-header-back" type="button" aria-label="Back to parent folder" onClick={() => onNavigate(previousFolder)}>
            <ArrowLeft size={18} />
          </button>,
          headerElements.leading,
        )}
      {headerElements?.actions &&
        createPortal(
          <MobileHeaderMenu label="Folder actions" icon={<DotsThreeVertical size={19} weight="bold" />}>
            {(dismiss) => (
              <nav className="mobile-folder-path" aria-label="Folder path">
                <button
                  type="button"
                  data-folder-target=""
                  data-current={!folder || undefined}
                  onClick={() => {
                    dismiss();
                    onNavigate(null);
                  }}
                >
                  {rootLabel}
                </button>
                {trail.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    data-folder-target={item.id}
                    data-current={item.id === folder?.id || undefined}
                    onClick={() => {
                      dismiss();
                      onNavigate(item);
                    }}
                  >
                    {item.name}
                  </button>
                ))}
              </nav>
            )}
          </MobileHeaderMenu>,
          headerElements.actions,
        )}

      <nav className="folder-explorer__breadcrumbs" aria-label="Folder path">
        <button type="button" aria-current={!folder ? "page" : undefined} onClick={() => onNavigate(null)}>
          {rootLabel}
        </button>
        {trail.map((item) => (
          <span key={item.id}>
            <CaretRight size={13} aria-hidden="true" />
            <button type="button" aria-current={item.id === folder?.id ? "page" : undefined} onClick={() => onNavigate(item)}>
              {item.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="folder-explorer__toolbar" data-view={view}>
        <label className="folder-explorer__search">
          <MagnifyingGlass size={16} aria-hidden="true" />
          <span className="sr-only">Search this folder</span>
          <input type="search" value={search} placeholder="Search this folder" onChange={(event) => setSearch(event.target.value)} />
          {search && (
            <button type="button" aria-label="Clear folder search" onClick={() => setSearch("")}>
              <X size={14} />
            </button>
          )}
        </label>
        <label className="folder-explorer__sort">
          <span>Sort</span>
            <select value={sortKey} aria-label="Choose sort key" onChange={(event) => setSortKey(event.target.value as FolderSortKey)}>
            <option value="name">Name</option>
            <option value="date">Date modified</option>
            <option value="type">Type</option>
            <option value="size">Size</option>
          </select>
        </label>
        <button className="folder-explorer__tool-button" type="button" aria-label={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`} title={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`} onClick={() => setSortDirection((current) => (current === "asc" ? "desc" : "asc"))}>
          {sortDirection === "asc" ? <SortAscending size={18} /> : <SortDescending size={18} />}
        </button>
        <div className="folder-explorer__view-options" role="group" aria-label="Folder view">
          <button type="button" aria-label="List view" aria-pressed={view === "list"} disabled={viewChangeDisabled} onClick={() => onViewChange("list")}>
            <ListBullets size={18} />
          </button>
          <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} disabled={viewChangeDisabled} onClick={() => onViewChange("grid")}>
            <SquaresFour size={18} />
          </button>
        </div>
        <button className="folder-explorer__tool-button folder-explorer__import" type="button" disabled={readOnly} onClick={() => onUpload(parentId)}>
          <UploadSimple size={18} />
          <span>Upload files</span>
        </button>
        <button className="folder-explorer__tool-button folder-explorer__import" type="button" disabled={readOnly} onClick={() => onImportFolder(parentId)}>
          <FolderOpen size={18} />
          <span>Import folder</span>
        </button>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {sortSummary(sortKey, sortDirection)}
        </span>
      </div>

      {protectedStatus && <div className={protectedStatus.error ? "window-error folder-explorer__status" : "folder-explorer__status"} role={protectedStatus.error ? "alert" : "status"} aria-live="polite"><span>{protectedStatus.message}</span>{protectedStatus.onRetry && <button className="button button--quiet" type="button" onClick={protectedStatus.onRetry}>Retry</button>}</div>}

      <div
        className="folder-explorer__content"
        data-entry-drop-parent={readOnly ? undefined : parentId ?? ""}
        onClick={(event) => {
          if (!(event.target as Element).closest(".folder-explorer__row")) onClearSelection?.();
        }}
        onDragOver={(event) => {
          if (!readOnly) event.preventDefault();
        }}
        onDrop={(event) => {
          if (readOnly || (event.target as Element).closest(".folder-explorer__row[data-folder-target]")) return;
          event.preventDefault();
          onExternalDrop(event.dataTransfer, parentId);
        }}
        onContextMenu={(event) => {
          if (readOnly) return;
          if ((event.target as Element).closest(".folder-explorer__row")) return;
          event.preventDefault();
          onBlankContextMenu(parentId, event.clientX, event.clientY, (event.nativeEvent as PointerEvent).pointerType === "touch" ? "sheet" : "menu");
        }}
      >
        {children.length === 0 ? (
          <div className="folder-explorer__empty">
            <Folder size={38} weight="duotone" aria-hidden="true" />
            <p>This folder is empty.</p>
            {!readOnly && (
              <div className="folder-explorer__empty-actions">
                <button className="button button--primary" type="button" onClick={() => onCreateFile(parentId)}>
                  <FilePlus size={17} /> New text file
                </button>
                <button className="button button--quiet" type="button" onClick={() => onCreateFolder(parentId)}>
                  <FolderPlus size={17} /> New folder
                </button>
                <button className="button button--quiet" type="button" onClick={() => onUpload(parentId)}>
                  <UploadSimple size={17} /> Upload
                </button>
                <button className="button button--quiet" type="button" onClick={() => onImportFolder(parentId)}>
                  <FolderOpen size={17} /> Import folder
                </button>
              </div>
            )}
          </div>
        ) : orderedChildren.length === 0 ? (
          <div className="folder-explorer__empty folder-explorer__empty--search" role="status">
            <MagnifyingGlass size={38} weight="duotone" aria-hidden="true" />
            <p>No items match "{search.trim()}".</p>
            <button className="button button--quiet" type="button" onClick={() => setSearch("")}>
              Clear search
            </button>
          </div>
        ) : (
          <div className="folder-explorer__list" data-view={view} aria-label={`Contents of ${folder?.name ?? rootLabel}`}>
            {view === "list" && (
              <div className="folder-explorer__columns">
                <span aria-hidden="true" />
                <button type="button" aria-label={sortActionLabel("name", sortKey, sortDirection)} data-active={sortKey === "name" || undefined} data-direction={sortKey === "name" ? sortDirection : undefined} onClick={() => chooseSort("name")}>
                  Name
                </button>
                <button type="button" aria-label={sortActionLabel("type", sortKey, sortDirection)} data-active={sortKey === "type" || undefined} data-direction={sortKey === "type" ? sortDirection : undefined} onClick={() => chooseSort("type")}>
                  Type
                </button>
                <button type="button" aria-label={sortActionLabel("date", sortKey, sortDirection)} data-active={sortKey === "date" || undefined} data-direction={sortKey === "date" ? sortDirection : undefined} onClick={() => chooseSort("date")}>
                  Modified
                </button>
                <button type="button" aria-label={sortActionLabel("size", sortKey, sortDirection)} data-active={sortKey === "size" || undefined} data-direction={sortKey === "size" ? sortDirection : undefined} onClick={() => chooseSort("size")}>
                  Size
                </button>
              </div>
            )}
            {orderedChildren.map((entry) => (
              <button
                className="folder-explorer__row"
                data-entry-id={entry.id}
                key={entry.id}
                type="button"
                aria-pressed={selectedIds.has(entry.id)}
                aria-label={`${entry.name}, ${entry.kind === "folder" ? "folder" : entry.mimeType || "file"}${offlineAvailability[entry.id] ? `, ${offlineStatusLabel(offlineAvailability[entry.id])}` : ""}`}
                data-selected={selectedIds.has(entry.id) || undefined}
                data-folder-target={entry.kind === "folder" ? entry.id : undefined}
                data-entry-drop-parent={entry.kind === "folder" && !isEntryReadOnly(entry) ? entry.id : undefined}
                onClick={(event) => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelect(entry, {
                    toggle: event.metaKey || event.ctrlKey,
                    range: event.shiftKey,
                    orderedIds,
                  });
                }}
                onDoubleClick={() => {
                  if (allowsMouseDoubleClick(performance.now())) open(entry);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") open(entry);
                  else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                    const rows = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".folder-explorer__row") ?? []);
                    const index = rows.indexOf(event.currentTarget);
                    const target = event.key === "Home" ? rows[0] : event.key === "End" ? rows.at(-1) : rows[index + (event.key === "ArrowUp" ? -1 : 1)];
                    if (target) {
                      event.preventDefault();
                      target.focus();
                    }
                  } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    if (!selectedIds.has(entry.id))
                      onSelect(entry, {
                        toggle: false,
                        range: false,
                        orderedIds,
                      });
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (!isEntryReadOnly(entry)) onContextMenu(entry, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, "menu");
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (isEntryReadOnly(entry)) return;
                  const current = drag.current;
                  const action = contextMenuPressAction(current);
                  if (action !== "open") {
                    if (current?.longPressTimer) window.clearTimeout(current.longPressTimer);
                    if (current) current.longPressTimer = undefined;
                    return;
                  }
                  if (current?.longPressTimer) window.clearTimeout(current.longPressTimer);
                  if (current) {
                    current.longPressTimer = undefined;
                    current.longPressed = true;
                    lastTap.current = null;
                  }
                  if (!selectedIds.has(entry.id))
                    onSelect(entry, {
                      toggle: false,
                      range: false,
                      orderedIds,
                    });
                  onContextMenu(entry, event.clientX, event.clientY, (event.nativeEvent as PointerEvent).pointerType === "touch" ? "sheet" : "menu");
                }}
                onDragOver={
                  entry.kind === "folder" && !readOnly && !isEntryReadOnly(entry)
                    ? (event) => {
                        event.preventDefault();
                        event.currentTarget.dataset.dropTarget = "true";
                      }
                    : undefined
                }
                onDragLeave={
                  entry.kind === "folder" && !readOnly && !isEntryReadOnly(entry)
                    ? (event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node)) delete event.currentTarget.dataset.dropTarget;
                      }
                    : undefined
                }
                onDrop={
                  entry.kind === "folder" && !readOnly && !isEntryReadOnly(entry)
                    ? (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        delete event.currentTarget.dataset.dropTarget;
                        onExternalDrop(event.dataTransfer, entry.id);
                      }
                    : undefined
                }
                onPointerDown={(event) => handlePointerDown(event, entry)}
                onPointerMove={handlePointerMove}
                onPointerUp={(event) => finishPointer(event)}
                onPointerCancel={(event) => finishPointer(event, true)}
                onLostPointerCapture={(event) => finishPointer(event, true)}
              >
                <span className="folder-explorer__entry-icon">
                  <EntryArtwork entry={entry} size={24} loadPreview={loadPreview} />
                  {offlineAvailability[entry.id] && <AvailabilityBadge availability={offlineAvailability[entry.id]} />}
                </span>
                <span className="folder-explorer__name">{entry.name}</span>
                <span className="folder-explorer__kind">
                  {entry.kind === "folder" ? "Folder" : entry.mimeType || "File"}
                  {offlineAvailability[entry.id] && <small data-offline-status={offlineAvailability[entry.id].status}>{offlineStatusLabel(offlineAvailability[entry.id])}</small>}
                </span>
                {!isEntryReadOnly(entry) && <time className="folder-explorer__date" dateTime={new Date(entry.modifiedAt).toISOString()}>
                  {dateFormatter.format(entry.modifiedAt)}
                </time>}
                <span className="folder-explorer__size">{formatEntrySize(entry)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

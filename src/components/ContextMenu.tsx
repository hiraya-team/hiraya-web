import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ArrowsLeftRight, ArrowsOut, CalendarBlank, Check, CheckSquare, CloudArrowDown, CloudSlash, Copy, DownloadSimple, FilePlus, FolderOpen, FolderPlus, Gauge, GearSix, Globe, ImageSquare, Info, LinkSimple, Package, PencilSimple, Play, Trash, UploadSimple, ClipboardText, Clock } from "@phosphor-icons/react";
import type { ContextMenuState, DesktopEntry } from "../types";
import { isLinearNavigationKey, linearNavigationIndex, submenuKeyIntent, visibleMenuItems } from "../ui/keyboard-navigation";
import { useNativeDialog } from "../ui/modal-dialog";
import { dismissesSheetDrag } from "../ui/file-icon-gesture";
import { openWithMenuItems, type OpenWithItem } from "../ui/open-with-menu";

const VIEWPORT_MARGIN = 8;
const MENU_BAR_INSET = 48;

function useMenuPosition(x: number, y: number, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: Math.max(VIEWPORT_MARGIN, x), top: Math.max(MENU_BAR_INSET, y) });

  useLayoutEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    function positionMenu() {
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const minimumTop = viewportTop + MENU_BAR_INSET;
      const bounds = element!.getBoundingClientRect();
      const maxHeight = Math.max(0, viewportTop + viewportHeight - minimumTop - VIEWPORT_MARGIN);
      const renderedHeight = Math.min(bounds.height, maxHeight);
      setStyle({
        left: Math.min(Math.max(viewportLeft + VIEWPORT_MARGIN, x), Math.max(viewportLeft + VIEWPORT_MARGIN, viewportLeft + viewportWidth - VIEWPORT_MARGIN - bounds.width)),
        top: Math.min(Math.max(minimumTop, y), Math.max(minimumTop, viewportTop + viewportHeight - VIEWPORT_MARGIN - renderedHeight)),
        maxHeight,
        overflowY: "auto",
        overscrollBehavior: "contain",
      });
    }
    positionMenu();
    const observer = new ResizeObserver(positionMenu);
    observer.observe(element);
    window.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("resize", positionMenu);
    window.visualViewport?.addEventListener("scroll", positionMenu);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("resize", positionMenu);
      window.visualViewport?.removeEventListener("scroll", positionMenu);
    };
  }, [enabled, x, y]);

  return { ref, style };
}

function useRovingMenu(ref: RefObject<HTMLDivElement>) {
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const items = visibleMenuItems(menu);
    const current = items.find((item) => item === document.activeElement) ?? items[0];
    for (const item of items) item.tabIndex = item === current ? 0 : -1;
    if (current && !menu.contains(document.activeElement) && !menu.closest(".action-sheet")) requestAnimationFrame(() => current.focus());
  });
  return (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.getAttribute("role") !== "menuitem") return;
    const menu = ref.current;
    if (!menu) return;
    for (const item of visibleMenuItems(menu)) item.tabIndex = item === target ? 0 : -1;
  };
}

type SubmenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  meta?: string;
  disabled?: boolean;
  onSelect: () => void;
  secondaryAction?: { label: string; accessibleLabel: string; onSelect: () => void };
};

function MenuSubmenu({ icon, label, items }: { icon: ReactNode; label: string; items: readonly SubmenuItem[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  function close() { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); }
  function openAndFocus() {
    setOpen(true);
    requestAnimationFrame(() => { if (menuRef.current) visibleMenuItems(menuRef.current).at(0)?.focus(); });
  }
  return <div className="context-menu__submenu">
    <button ref={triggerRef} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? close() : openAndFocus()} onKeyDown={(event) => {
      if (submenuKeyIntent(event.key, "trigger") === "open") { event.preventDefault(); event.stopPropagation(); openAndFocus(); }
    }}>{icon}<span>{label}</span><span className="context-menu__submenu-caret" aria-hidden="true">›</span></button>
    <div ref={menuRef} id={id} role="menu" aria-label={label} hidden={!open} onKeyDown={(event) => {
      if (submenuKeyIntent(event.key, "submenu") === "close") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (!isLinearNavigationKey(event.key)) return;
      const menuItems = visibleMenuItems(event.currentTarget);
      const next = linearNavigationIndex(menuItems.indexOf(document.activeElement as HTMLButtonElement), menuItems.length, event.key, "vertical");
      if (next < 0) return;
      event.preventDefault(); event.stopPropagation(); menuItems[next]?.focus();
    }}>{items.map((item) => <div className="context-menu__submenu-item" role="none" key={item.id}>
      <button className="context-menu__submenu-item-primary" type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} onClick={item.onSelect}>
        <span className="context-menu__submenu-item-icon" aria-hidden="true">{item.icon}</span>
        <span className="context-menu__submenu-item-label">{item.label}</span>
        {item.meta && <span className="context-menu__submenu-item-meta">{item.meta}</span>}
      </button>
      {item.secondaryAction && <button className="context-menu__submenu-item-secondary" type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} aria-label={item.secondaryAction.accessibleLabel} onClick={item.secondaryAction.onSelect}>{item.secondaryAction.label}</button>}
    </div>)}</div>
  </div>;
}

type Props = {
  menu: Extract<Exclude<ContextMenuState, null>, { type: "entry" }>;
  entry: DesktopEntry;
  onOpen: () => void;
  onEditFile?: () => void;
  onRename: () => void;
  onDownload?: () => void;
  onSetAsWallpaper?: () => void;
  onCopy?: () => void;
  onPasteInto?: () => void;
  onUploadInto?: () => void;
  onImportFolderInto?: () => void;
  onGroup?: () => void;
  onMove?: () => void;
  onProperties: () => void;
  onDelete?: () => void;
  onCopyLink?: () => void;
  onPublish?: () => void;
  publishDisabled?: boolean;
  onMakeAvailableOffline?: () => void;
  onRemoveOfflineCopy?: () => void;
  onOpenOfflineStorage?: () => void;
  offlineBusy?: boolean;
  readOnly?: boolean;
  selectionCount?: number;
  trashSupported?: boolean;
  openWith?: readonly OpenWithItem[];
  onClose: () => void;
};

export function ContextMenu({ menu, entry, onOpen, onEditFile, onRename, onDownload, onSetAsWallpaper, onCopy, onPasteInto, onUploadInto, onImportFolderInto, onGroup, onMove, onProperties, onDelete, onCopyLink, onPublish, publishDisabled = false, onMakeAvailableOffline, onRemoveOfflineCopy, onOpenOfflineStorage, offlineBusy = false, readOnly = false, selectionCount = 1, trashSupported = true, openWith = [], onClose }: Props) {
  const position = useMenuPosition(menu.x, menu.y, menu.presentation === "menu");
  const onFocus = useRovingMenu(position.ref);
  const offlineItems: SubmenuItem[] = [
    ...(onMakeAvailableOffline ? [{ id: "make-available", label: `Make available${selectionCount > 1 ? ` (${selectionCount})` : ""}`, disabled: offlineBusy, onSelect: onMakeAvailableOffline }] : []),
    ...(onRemoveOfflineCopy ? [{ id: "remove-copy", label: "Remove downloaded copies", icon: <CloudSlash />, disabled: offlineBusy, onSelect: onRemoveOfflineCopy }] : []),
    ...(onOpenOfflineStorage ? [{ id: "offline-panel", label: "Connection & Offline", icon: <GearSix />, onSelect: onOpenOfflineStorage }] : []),
  ];

  return <ActionMenuFrame key={menu.presentation} menuRef={position.ref} style={position.style} presentation={menu.presentation} label={selectionCount > 1 ? `Actions for ${selectionCount} selected items` : `Actions for ${entry.name}`} onClose={onClose} onFocus={onFocus}>
      {selectionCount === 1 && <button type="button" role="menuitem" onClick={onOpen}>
        <FolderOpen size={17} /> Open
      </button>}
      {selectionCount === 1 && entry.kind === "file" && onEditFile && <button type="button" role="menuitem" disabled={readOnly} onClick={onEditFile}>
        <PencilSimple size={17} /> Edit file
      </button>}
      {selectionCount === 1 && entry.kind === "file" && openWith.length > 0 && <MenuSubmenu icon={<Package size={17} />} label="Open with" items={openWithMenuItems(openWith).map((item) => ({ ...item, icon: item.preferred ? <Check size={15} weight="bold" /> : undefined }))} />}
      {selectionCount === 1 && <button className="context-menu__separated" type="button" role="menuitem" disabled={readOnly} onClick={onRename}>
        <PencilSimple size={17} /> Rename
        <kbd>R</kbd>
      </button>}
      {selectionCount === 1 && entry.kind === "file" && onDownload && (
        <button type="button" role="menuitem" onClick={onDownload}>
          <DownloadSimple size={17} /> Download
        </button>
      )}
      {selectionCount === 1 && entry.kind === "file" && onSetAsWallpaper && <button type="button" role="menuitem" onClick={onSetAsWallpaper}><ImageSquare size={17} /> Set as desktop wallpaper</button>}
       {onCopy && <button type="button" role="menuitem" onClick={onCopy}><Copy size={17} /> Copy {selectionCount > 1 ? `${selectionCount} items` : ""}<kbd>Ctrl/⌘ C</kbd></button>}
      {selectionCount === 1 && onCopyLink && <button type="button" role="menuitem" onClick={onCopyLink}><LinkSimple size={17} /> Copy link</button>}
      {selectionCount === 1 && onPublish && <button type="button" role="menuitem" disabled={publishDisabled} onClick={onPublish}><Globe size={17} /> Publish...</button>}
      {offlineItems.length > 0 && <MenuSubmenu icon={<CloudArrowDown size={17} />} label="Offline" items={offlineItems} />}
      {onPasteInto && <button className="context-menu__separated" type="button" role="menuitem" disabled={readOnly} onClick={onPasteInto}><ClipboardText size={17} /> Paste into</button>}
      {selectionCount === 1 && entry.kind === "folder" && onUploadInto && <button type="button" role="menuitem" disabled={readOnly} onClick={onUploadInto}><UploadSimple size={17} /> Upload files into</button>}
      {selectionCount === 1 && entry.kind === "folder" && onImportFolderInto && <button type="button" role="menuitem" disabled={readOnly} onClick={onImportFolderInto}><FolderOpen size={17} /> Import folder into</button>}
      {selectionCount === 1 && entry.kind === "folder" && onGroup && <button type="button" role="menuitem" disabled={readOnly} onClick={onGroup}><FolderOpen size={17} /> Show as icon group</button>}
       {onMove && <button className={!onPasteInto ? "context-menu__separated" : undefined} type="button" role="menuitem" disabled={readOnly} onClick={onMove}>
         <ArrowsLeftRight size={17} /> Move to...
       </button>}
      {selectionCount === 1 && <button className="context-menu__separated" type="button" role="menuitem" onClick={onProperties}>
        <Info size={17} /> Properties
      </button>}
       {onDelete && <button className="context-menu__danger" type="button" role="menuitem" disabled={readOnly} onClick={onDelete}>
         <Trash size={17} /> {trashSupported ? "Move to Trash" : "Delete permanently"}
       </button>}
  </ActionMenuFrame>;
}

type DesktopProps = {
  menu: Extract<Exclude<ContextMenuState, null>, { type: "desktop" }>;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onUpload?: () => void;
  onImportFolder?: () => void;
  onSettings?: () => void;
  onPaste?: () => void;
  onAddWidget?: (kind: "clock" | "calendar" | "status" | "todo" | "scene") => void;
  onCreateIconGroup?: () => void;
  readOnly?: boolean;
  onClose: () => void;
};

export function DesktopContextMenu({ menu, onCreateFile, onCreateFolder, onUpload, onImportFolder, onSettings, onPaste, onAddWidget, onCreateIconGroup, readOnly = false, onClose }: DesktopProps) {
  const position = useMenuPosition(menu.x, menu.y, menu.presentation === "menu");
  const onFocus = useRovingMenu(position.ref);

  return <ActionMenuFrame key={menu.presentation} menuRef={position.ref} style={position.style} presentation={menu.presentation} label="Create and desktop actions" onClose={onClose} onFocus={onFocus}>
      <button type="button" role="menuitem" disabled={readOnly} onClick={onCreateFile}>
        <FilePlus size={17} /> New text file
      </button>
      <button type="button" role="menuitem" disabled={readOnly} onClick={onCreateFolder}>
        <FolderPlus size={17} /> New folder
      </button>
      {onCreateIconGroup && <button type="button" role="menuitem" disabled={readOnly} onClick={onCreateIconGroup}><FolderPlus size={17} /> New icon group</button>}
      {onAddWidget && <MenuSubmenu icon={<Gauge size={17} />} label="Add widget" items={[
        { id: "clock", label: "Clock", icon: <Clock size={16} />, onSelect: () => onAddWidget("clock") },
        { id: "calendar", label: "Calendar", icon: <CalendarBlank size={16} />, onSelect: () => onAddWidget("calendar") },
        { id: "status", label: "Status", icon: <Gauge size={16} />, onSelect: () => onAddWidget("status") },
        { id: "todo", label: "Todo list", icon: <CheckSquare size={16} />, onSelect: () => onAddWidget("todo") },
        { id: "scene", label: "Scene...", icon: <Play size={16} />, onSelect: () => onAddWidget("scene") },
      ]} />}
       {onUpload && <button className="context-menu__separated" type="button" role="menuitem" disabled={readOnly} onClick={onUpload}>
         <UploadSimple size={17} /> Upload files
       </button>}
       {onImportFolder && <button type="button" role="menuitem" disabled={readOnly} onClick={onImportFolder}>
         <FolderOpen size={17} /> Import folder
       </button>}
      {onPaste && <button type="button" role="menuitem" disabled={readOnly} onClick={onPaste}><ClipboardText size={17} /> Paste<kbd>Ctrl/⌘ V</kbd></button>}
      {onSettings && <button className="context-menu__separated" type="button" role="menuitem" onClick={onSettings}>
        <GearSix size={17} /> Settings
      </button>}
  </ActionMenuFrame>;
}

export function WidgetContextMenu({ menu, label, onOpen, onResize, onRemove, onClose }: {
  menu: Extract<Exclude<ContextMenuState, null>, { type: "widget" }>;
  label: string;
  onOpen?: () => void;
  onResize: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const position = useMenuPosition(menu.x, menu.y, menu.presentation === "menu");
  const onFocus = useRovingMenu(position.ref);
  return <ActionMenuFrame key={menu.presentation} menuRef={position.ref} style={position.style} presentation={menu.presentation} label={`Actions for ${label}`} onClose={onClose} onFocus={onFocus}>
    {onOpen && <button type="button" role="menuitem" onClick={onOpen}><FolderOpen size={17} /> Open</button>}
    <button className={!onOpen ? undefined : "context-menu__separated"} type="button" role="menuitem" onClick={onResize}><ArrowsOut size={17} /> Resize</button>
    <button className="context-menu__danger" type="button" role="menuitem" onClick={onRemove}><Trash size={17} /> Remove</button>
  </ActionMenuFrame>;
}

function ActionMenuFrame({ menuRef, style, presentation, label, onClose, onFocus, children }: {
  menuRef: RefObject<HTMLDivElement>;
  style: CSSProperties;
  presentation: "menu" | "sheet";
  label: string;
  onClose: () => void;
  onFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; startY: number; startedAt: number; moved: boolean } | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useNativeDialog(dialogRef, onClose, false, undefined, presentation === "sheet");

  useEffect(() => () => {
    if (presentation !== "menu") return;
    const previousFocus = previousFocusRef.current;
    requestAnimationFrame(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
  }, [presentation]);

  const menu = <div ref={menuRef} className="context-menu" data-positioned={presentation === "menu" || undefined} role="menu" aria-label={label} style={presentation === "menu" ? style : undefined} onFocusCapture={onFocus} onKeyDown={handleMenuKeyDown}>{children}</div>;
  if (presentation === "menu") return menu;
  return <dialog ref={dialogRef} className="action-sheet-backdrop" aria-label={label} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={sheetRef} className="action-sheet">
      <div className="action-sheet__handle" aria-hidden="true" onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { pointerId: event.pointerId, startY: event.clientY, startedAt: performance.now(), moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const delta = Math.max(0, event.clientY - current.startY);
        current.moved ||= delta > 4;
        sheetRef.current?.style.setProperty("transform", `translate3d(0, ${delta}px, 0)`);
      }} onPointerUp={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const delta = Math.max(0, event.clientY - current.startY);
        if (dismissesSheetDrag(delta, performance.now() - current.startedAt)) { drag.current = null; onClose(); return; }
        sheetRef.current?.style.removeProperty("transform");
        window.setTimeout(() => { if (drag.current === current) drag.current = null; }, 0);
      }} onPointerCancel={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        sheetRef.current?.style.removeProperty("transform");
      }}><span /></div>
      {menu}
    </section>
  </dialog>;
}

function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!isLinearNavigationKey(event.key)) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;
  const items = visibleMenuItems(event.currentTarget);
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const target = items[linearNavigationIndex(current, items.length, event.key, "vertical")];
  if (target) { event.preventDefault(); target.focus(); }
}

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import "./styles.css";
import { ArrowLeft, DownloadSimple, Folder, SignIn, SpinnerGap, SquaresFour, WarningCircle, X } from "@phosphor-icons/react";
import { AppWindow } from "./components/AppWindow";
import { FolderExplorer } from "./components/FolderExplorer";
import { AreaSwitcher } from "./features/areas/AreaSwitcher";
import { loginUrl } from "./lib/auth-route";
import { DEFAULT_THEME_STATE, isBuiltinThemeId, resolveTheme, themeIconMetrics, themeStyle } from "./lib/themes";
import type { DesktopEntry, FileEntry, FolderEntry } from "./types";
import { builtinAppWindow } from "./apps/registry";
import { createEntryIndex } from "./ui/entry-index";
import { useNativeDialog } from "./ui/modal-dialog";
import { publicAreaMapSegments, publicFolderBackTarget } from "./ui/public-desktop-layout";
import { EntryArtwork, StatusBadge, type EntryPreviewSource } from "./components/VisualPrimitives";
import { ShellItemLayer } from "./components/ShellItems";
import { resolveTouchRelease, type TouchTap } from "./ui/file-icon-gesture";
import type { ExplorerView } from "./domain/preferences";
import { usePublicDesktop } from "./features/public-desktop/controller";
import { fetchPublicFile, type PublicAuthority } from "./features/public-desktop/transport";
import { TodoWidget } from "./features/widgets/TodoWidget";
import { areaCameraPosition, areaWorldOrigin } from "./ui/area-camera";
import { boundsIntersectSegment, iconAreaSize, intersectingSegments, projectLogicalPosition, responsiveDesktop, segmentKey, type SurfaceSegment } from "./ui/desktop-geometry";
import { useMediaQuery, WINDOWED_DESKTOP_QUERY } from "./ui/input-capabilities";
import { homeRelativeAreaLabel } from "./ui/shell";
import { clampWindowBounds, initialWindowBounds, type WindowBounds } from "./ui/window-manager";
import { withoutDotEntries } from "./ui/hidden-entries";
import { reservedFileHandler } from "./apps/file-associations";
import { RuntimeAppActions } from "./features/windows/WindowLayer";
import { isSceneFile } from "./domain/scene";
import { postSandboxPointer, type SandboxPointerObservation } from "@hiraya/app-runtime/navigation";
import { desktopPointerObservation, projectSandboxPointer, type WallpaperSceneTarget } from "./ui/wallpaper-pointer";

/** Lazily loads the sandboxed app frame used by public file previews. */
const PublicAppFrame = lazy(() => import("./features/public-desktop/AppFrame"));
/** Lazily loads executable wallpaper and widget scenes. */
const SceneFrame = lazy(() => import("./features/scenes/SceneFrame").then((module) => ({ default: module.SceneFrame })));

/** Renders the large download gate interface. */
function LargeDownloadGate({ gate, onClose }: { gate: { loginUrl: string; fileName: string }; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeDialog(dialogRef, onClose);
  return (
    <dialog ref={dialogRef} className="modal-backdrop large-download-gate__backdrop" aria-labelledby="download-gate-title" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="file-window large-download-gate">
        <header className="window-header">
          <div><span className="window-kicker">Download</span><h2 id="download-gate-title">Sign in for this download</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close download dialog"><X size={18} /></button>
        </header>
        <div className="large-download-gate__content">
          <span className="large-download-gate__icon">
            <DownloadSimple size={25} />
          </span>
          <p>
            <strong>{gate.fileName}</strong> is large enough to require an authenticated download. The public desktop remains available.
          </p>
          <a className="button button--primary" href={new URL(gate.loginUrl, window.location.href).href}>
            <SignIn size={16} /> Sign in and return
          </a>
        </div>
      </section>
    </dialog>
  );
}

/** Renders the public icon interface. */
function PublicIcon({ entry, selected, interactive, loadThumbnail, onSelect, onOpen }: { entry: DesktopEntry; selected: boolean; interactive: boolean; loadThumbnail?: (id: string) => Promise<EntryPreviewSource>; onSelect: () => void; onOpen: () => void }) {
  const press = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<TouchTap | null>(null);
  const pointerOwner = useRef<HTMLButtonElement | null>(null);
  const doubleClickOwner = useRef<HTMLButtonElement | null>(null);
  return (
    <button
      className="file-icon public-icon"
      style={{ "--file-x": `${entry.position.x}px`, "--file-y": `${entry.position.y}px` } as React.CSSProperties}
      data-selected={selected || undefined}
      data-entry-id={entry.id}
      type="button"
      tabIndex={interactive ? undefined : -1}
      aria-hidden={interactive ? undefined : true}
      inert={interactive ? undefined : ""}
      aria-label={`${entry.name}, ${entry.kind === "folder" ? "folder" : entry.mimeType || "file"}`}
      aria-pressed={selected}
      onClick={(event) => {
        doubleClickOwner.current = event.detail === 2 && pointerOwner.current === event.currentTarget ? event.currentTarget : null;
        pointerOwner.current = null;
        onSelect();
      }}
      onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
      onDoubleClick={(event) => {
        if (doubleClickOwner.current === event.currentTarget) onOpen();
        doubleClickOwner.current = null;
      }}
      onPointerDown={(event) => {
        if (event.button === 0) {
          pointerOwner.current = event.pointerType === "touch" ? null : event.currentTarget;
          doubleClickOwner.current = null;
        }
        if (event.pointerType !== "touch" || event.button !== 0) return;
        press.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const current = press.current;
        if (!current || current.pointerId !== event.pointerId || current.moved) return;
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 10) return;
        current.moved = true;
      }}
      onPointerUp={(event) => {
        const current = press.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const releasedAt = performance.now();
        const tap = {
          id: entry.id,
          x: event.clientX,
          y: event.clientY,
          at: releasedAt,
        };
        const { action, nextTap } = resolveTouchRelease(lastTap.current, tap, {
          cancelled: false,
          moved: current.moved,
          longPressed: false,
          releasedOnIcon: event.currentTarget.contains(document.elementFromPoint(event.clientX, event.clientY)),
        });
        lastTap.current = nextTap;
        press.current = null;
        if (action === "select") onSelect();
        else if (action === "open") onOpen();
      }}
      onPointerCancel={(event) => {
        pointerOwner.current = null;
        doubleClickOwner.current = null;
        const current = press.current;
        if (!current || current.pointerId !== event.pointerId) return;
        press.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <span className="file-icon__art"><EntryArtwork entry={entry} size={43} loadPreview={loadThumbnail} /></span>
      <span className="file-icon__name">{entry.name}</span>
    </button>
  );
}

/** Renders the public desktop interface. */
export default function PublicDesktop({ authority }: { authority: PublicAuthority }) {
  const [explorerView, setExplorerView] = useState<ExplorerView>("list");
	const { desktop, error, open, setOpen, downloadGate, dismissDownloadGate, wallpaperUrl, wallpaperFailed, loadFile, loadThumbnail, openInternetShortcut } = usePublicDesktop(authority);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mobileHeaderActionsElement, setMobileHeaderActionsElement] = useState<HTMLDivElement | null>(null);
  const [activeSegment, setActiveSegment] = useState<SurfaceSegment>({ column: 0, row: 0 });
  const [areaMapOpen, setAreaMapOpen] = useState(false);
  const [desktopSize, setDesktopSize] = useState(() => ({ width: window.innerWidth, height: Math.max(1, window.innerHeight - 44) }));
  const [windowBounds, setWindowBounds] = useState<WindowBounds>(() => initialWindowBounds({ width: window.innerWidth, height: Math.max(1, window.innerHeight - 44) }));
  const desktopRef = useRef<HTMLElement>(null);
  const wallpaperSceneRef = useRef<WallpaperSceneTarget | null>(null);
  const registerWallpaperScene = useCallback((target: WallpaperSceneTarget | null) => { wallpaperSceneRef.current = target; }, []);
  const observePointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const target = wallpaperSceneRef.current;
    if (target && !(event.target as Element).closest(".app-window")) postSandboxPointer(target.frame, target.token, desktopPointerObservation(event.nativeEvent, event.currentTarget, event.type as SandboxPointerObservation["phase"]));
  }, []);
  const observeContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = wallpaperSceneRef.current;
    if (target && !(event.target as Element).closest(".app-window")) postSandboxPointer(target.frame, target.token, desktopPointerObservation(event.nativeEvent, event.currentTarget, "contextmenu"));
  }, []);
  const observeWidgetPointer = useCallback((observation: SandboxPointerObservation, frame: HTMLIFrameElement) => {
    const target = wallpaperSceneRef.current;
    const surface = desktopRef.current;
    if (target && surface) postSandboxPointer(target.frame, target.token, projectSandboxPointer(observation, frame, surface));
  }, []);
  const areaSwitcherRef = useRef<HTMLElement>(null);
  const areaSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(open);
  const backInFlightRef = useRef(false);
  openRef.current = open;
  const windowed = useMediaQuery(WINDOWED_DESKTOP_QUERY);
  const publicEntries = useMemo(() => withoutDotEntries(desktop?.entries ?? []), [desktop?.entries]);
  const index = useMemo(() => createEntryIndex(publicEntries), [publicEntries]);
  const appearance = desktop?.appearance ?? DEFAULT_THEME_STATE;
  const theme = resolveTheme(appearance);
  const iconMetrics = useMemo(() => themeIconMetrics(theme), [theme]);
  const iconArea = useMemo(() => iconAreaSize(desktopSize, desktop?.layout.gridSize), [desktop?.layout.gridSize, desktopSize]);
  const groupedFolderIds = useMemo(() => new Set(desktop?.layout.iconGroups.map((group) => group.folderId) ?? []), [desktop?.layout.iconGroups]);
  const desktopEntries = useMemo(() => publicEntries.filter((entry) => entry.parentId !== null || !groupedFolderIds.has(entry.id)), [groupedFolderIds, publicEntries]);
  const responsive = useMemo(() => responsiveDesktop(desktopEntries, iconArea, iconMetrics), [desktopEntries, iconArea, iconMetrics]);
  const activeSegmentKey = segmentKey(activeSegment);
  const occupiedSegments = useMemo(() => {
    const byKey = new Map(responsive.segments.map((segment) => [segment.key, { ...segment, itemCount: segment.entries.length }]));
    const occupy = (segment: SurfaceSegment) => {
      const key = segmentKey(segment);
      const current = byKey.get(key) ?? { entries: [], itemCount: 0, key, segment };
      byKey.set(key, { ...current, itemCount: (current.itemCount ?? current.entries.length) + 1 });
    };
    for (const entry of desktopEntries) {
      if (entry.parentId !== null) continue;
      const ownerKey = segmentKey(projectLogicalPosition(entry.position, iconArea).segment);
      for (const segment of intersectingSegments(entry.position, iconMetrics, iconArea)) {
        if (segmentKey(segment) !== ownerKey) occupy(segment);
      }
    }
    for (const widget of desktop?.layout.widgets ?? []) {
      for (const segment of intersectingSegments(widget, widget, iconArea)) occupy(segment);
    }
    for (const group of desktop?.layout.iconGroups ?? []) {
      const folder = publicEntries.find((entry) => entry.id === group.folderId && entry.kind === "folder" && entry.parentId === null);
      if (!folder) continue;
      for (const segment of intersectingSegments(folder.position, group, iconArea)) occupy(segment);
    }
    return [...byKey.values()];
  }, [desktop?.layout.iconGroups, desktop?.layout.widgets, desktopEntries, iconArea, iconMetrics, publicEntries, responsive.segments]);
  const minimapSegments = useMemo(() => publicAreaMapSegments(occupiedSegments, activeSegment), [activeSegment, occupiedSegments]);
  const wholeDesktop = !authority.itemAlias;
  const wallpaperCandidate = desktop?.layout.wallpaper.source.startsWith("file:") ? desktop.entries.find((entry) => entry.id === desktop.layout.wallpaper.source.slice(5)) : null;
  const wallpaperFile = wallpaperCandidate?.kind === "file" ? wallpaperCandidate : null;

  useEffect(() => {
    const surface = desktopRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      setDesktopSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const openTarget = open?.kind === "folder" ? `folder:${open.folderId ?? "root"}` : open ? `file:${open.file.id}:${open.runtime?.app.id ?? "loading"}` : "";
  useEffect(() => {
    if (!open) return;
    if (open.kind === "file" && open.runtime) setWindowBounds(open.runtime.app.bounds);
    else setWindowBounds(initialWindowBounds(desktopSize, builtinAppWindow(open.kind === "folder" ? "explorer" : "file")));
    // Opening a different target starts a fresh ephemeral public window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget]);

  useEffect(() => {
    if (!open || !windowed) return;
    const { minWidth, minHeight } = open.kind === "file" && open.runtime
      ? { minWidth: open.runtime.app.package.manifest.window?.minWidth ?? 360, minHeight: open.runtime.app.package.manifest.window?.minHeight ?? 260 }
      : builtinAppWindow(open.kind === "folder" ? "explorer" : "file");
    setWindowBounds((current) => clampWindowBounds(current, desktopSize, { minWidth, minHeight }));
  }, [desktopSize, open, windowed]);

  useEffect(() => {
    if (!areaMapOpen) return;
    const focusFrame = window.requestAnimationFrame(() => areaSwitcherRef.current?.querySelector<HTMLButtonElement>('.desktop-minimap__area[aria-current="true"]')?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAreaMapOpen(false);
      window.requestAnimationFrame(() => areaSwitcherTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [areaMapOpen]);

  function openEntry(entry: DesktopEntry) {
    setSelectedIds(new Set());
    if (entry.kind === "folder") setOpen({ kind: "folder", folderId: entry.id });
    else if (reservedFileHandler(entry) === "internet-shortcut") void openInternetShortcut(entry, window.open("about:blank", "_blank"));
    else void loadFile(entry);
  }
  function selectEntry(entry: DesktopEntry) {
    setSelectedIds(new Set([entry.id]));
  }
  const folder = open?.kind === "folder" && open.folderId ? (index.byId.get(open.folderId) as FolderEntry | undefined) : null;
  const owner = desktop?.owner;
  const wallpaper = desktop?.layout.wallpaper;
  const closePublicView = () => {
    setSelectedIds(new Set());
    setOpen(null);
  };
  const backPublicView = async () => {
    if (open?.kind === "folder" && open.folderId) {
      setSelectedIds(new Set());
      setOpen({
        kind: "folder",
        folderId: publicFolderBackTarget(desktop?.entries ?? [], open.folderId) ?? null,
      });
      return;
    }
    const runtime = open?.kind === "file" ? open.runtime : undefined;
    if (!runtime) {
      closePublicView();
      return;
    }
    if (backInFlightRef.current) return;
    backInFlightRef.current = true;
    try {
      const outcome = await runtime.lifecycle.requestBack(
        { appId: runtime.app.package.manifest.id, instanceId: runtime.app.id },
        (requestId) => runtime.app.dispatcher.emit("app.backRequested", { requestId }),
      );
      if ((outcome === "home" || outcome === "unsupported") && openRef.current?.kind === "file" && openRef.current.runtime === runtime) closePublicView();
    } finally {
      backInFlightRef.current = false;
    }
  };

  return (
    <main className="desktop-shell public-desktop" data-theme={isBuiltinThemeId(appearance.selectedThemeId) ? appearance.selectedThemeId : "custom"} style={themeStyle(theme)}>
      <header className="menu-bar public-menu">
        {open && !windowed ? (
          <>
            <button className="public-menu__back" type="button" onClick={() => void backPublicView()} aria-label={open.kind === "folder" && open.folderId ? "Back to parent folder" : "Back to public desktop"}>
              <ArrowLeft />
              <span>Back</span>
            </button>
            <strong className="public-menu__context">{open.kind === "folder" ? (folder?.name ?? desktop?.name ?? "Desktop") : open.file.name}</strong>
            <div ref={setMobileHeaderActionsElement} className="mobile-global-actions public-menu__window-actions" />
            <button className="public-menu__close" type="button" onClick={closePublicView} aria-label="Close public window">
              <X /> <span>Close</span>
            </button>
          </>
        ) : (
          <>
            <div className="brand-mark">
              <img className="brand-mark__shape" src={`${import.meta.env.BASE_URL}hiraya-icon.svg`} alt="" />
              <strong>Hiraya</strong>
              <span className="public-menu__desktop">{desktop?.name || "Public desktop"}</span>
            </div>
            <div className="public-menu__actions">
              {desktop && wholeDesktop && minimapSegments.length > 1 && <button ref={areaSwitcherTriggerRef} className="mobile-area-switcher-trigger" type="button" aria-label={`${areaMapOpen ? "Close" : "Open"} public desktop area navigator, current area ${homeRelativeAreaLabel(activeSegment)}`} aria-controls="area-switcher" aria-expanded={areaMapOpen} onClick={() => setAreaMapOpen((current) => !current)}><SquaresFour size={20} weight={areaMapOpen ? "fill" : "regular"} /></button>}
              <StatusBadge tone="readonly" surface="chrome">
                Read only
              </StatusBadge>
              <a className="button button--quiet" href={loginUrl()}>
                <SignIn size={16} /> Sign in
              </a>
            </div>
          </>
        )}
      </header>
      <section
        className="desktop public-desktop__surface"
        ref={desktopRef}
        data-loading={!desktop || undefined}
        data-wallpaper={wholeDesktop && wallpaperFile && isSceneFile(wallpaperFile) ? "scene" : wallpaper?.source.startsWith("file:") ? "file" : wallpaper?.source.startsWith("theme:") ? "theme" : (wallpaper?.source ?? "dusk")}
        data-custom-loaded={wallpaperUrl || undefined}
        data-custom-failed={wallpaperFailed || undefined}
        style={
          {
            "--wallpaper-image": wallpaperUrl ? `url(${wallpaperUrl})` : "none",
            "--wallpaper-fit": wallpaper?.fit ?? "cover",
            "--wallpaper-position": `${wallpaper?.positionX ?? 50}% ${wallpaper?.positionY ?? 50}%`,
            "--wallpaper-blur": `${wallpaper?.blur ?? 0}px`,
          } as React.CSSProperties
        }
        aria-label={desktop ? `${desktop.name} public desktop` : "Public desktop"}
        onPointerDownCapture={observePointer}
        onPointerMoveCapture={observePointer}
        onPointerUpCapture={observePointer}
        onPointerCancelCapture={observePointer}
        onContextMenuCapture={observeContextMenu}
      >
        <div className="wallpaper-image" aria-hidden="true" />
        {wholeDesktop && wallpaperFile && isSceneFile(wallpaperFile) && <Suspense fallback={null}><div className="scene-wallpaper-layer"><SceneFrame file={wallpaperFile} contentRevision={wallpaperFile.contentRevision} readContent={(file) => fetchPublicFile(authority, file, wallpaperFile.contentRevision)} mode="wallpaper" onWallpaperTarget={registerWallpaperScene} /></div></Suspense>}
        <div className="wallpaper-grain" aria-hidden="true" />
        <div className="wallpaper-dim" aria-hidden="true" style={{ backgroundColor: "#000000", opacity: wallpaper?.dim ?? 0 }} />
        <div
          className="wallpaper-color-overlay"
          aria-hidden="true"
          style={{
            backgroundColor: wallpaper?.overlayColor,
            opacity: wallpaper?.overlayOpacity,
          }}
        />
        {desktop && (
          <div className="public-owner">
            <span className="sharing-avatar">{owner?.avatar && !owner.avatar.startsWith("identicon:") ? <img src={owner.avatar} alt="" /> : owner?.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <span>Shared publicly by</span>
              <strong>{owner?.displayName}</strong>
            </div>
          </div>
        )}
        {!desktop && !error && (
          <div className="desktop-state desktop-state--loading" role="status">
            <SpinnerGap size={24} /> Opening public desktop...
          </div>
        )}
        {error && (
          <div className="desktop-state public-error" role="alert">
            <WarningCircle size={30} />
            <h1>Desktop unavailable</h1>
            <p>{error}</p>
          </div>
        )}
        {desktop && publicEntries.length === 0 && desktop.layout.widgets.length === 0 && desktop.layout.iconGroups.length === 0 && (
          <div className="desktop-state empty-state">
            <Folder size={30} weight="duotone" />
            <h1>This desktop is empty.</h1>
            <p>There are no public files to browse yet.</p>
          </div>
        )}
        {desktop && wholeDesktop && (
          <div className="desktop-area-stage desktop-area-stage--icons public-icon-stage">
            <div className="desktop-canvas desktop-area-track public-icon-grid" style={{ width: iconArea.width, height: iconArea.height, transform: `translate3d(${areaCameraPosition(activeSegment, iconArea).x}px, ${areaCameraPosition(activeSegment, iconArea).y}px, 0)` }}>
              {responsive.segments.map((desktopSegment) => {
                const origin = areaWorldOrigin(desktopSegment.segment, iconArea);
                const interactive = desktopSegment.entries.some((entry) => boundsIntersectSegment(entry.position, iconMetrics, activeSegment, iconArea));
                return <div className="desktop-area-segment" key={desktopSegment.key} data-active={interactive || undefined} aria-hidden={!interactive || undefined} inert={!interactive ? "" : undefined} style={{ left: origin.x, top: origin.y, width: iconArea.width, height: iconArea.height, visibility: interactive ? "visible" : "hidden" }}>
                  {desktopSegment.entries.map((entry) => {
                    const entryInteractive = boundsIntersectSegment(entry.position, iconMetrics, activeSegment, iconArea);
                    return <PublicIcon entry={{ ...entry, position: responsive.positions.get(entry.id) ?? entry.position }} key={entry.id} interactive={entryInteractive} loadThumbnail={entryInteractive && desktop.thumbnailProfile ? loadThumbnail : undefined} selected={selectedIds.has(entry.id)} onSelect={() => selectEntry(entry)} onOpen={() => openEntry(entry)} />;
                  })}
                </div>;
              })}
            </div>
          </div>
        )}
        {desktop && wholeDesktop && <div className="desktop-area-stage desktop-area-stage--shell-items public-shell-items">
          <div className="desktop-canvas desktop-area-track" style={{ width: iconArea.width, height: iconArea.height, transform: `translate3d(${areaCameraPosition(activeSegment, iconArea).x}px, ${areaCameraPosition(activeSegment, iconArea).y}px, 0)` }}>
            {occupiedSegments.map((owner) => {
              const origin = areaWorldOrigin(owner.segment, iconArea);
              return <div className="desktop-area-segment" key={owner.key} style={{ left: origin.x, top: origin.y, width: iconArea.width, height: iconArea.height }}>
                <ShellItemLayer widgets={desktop.layout.widgets} groups={desktop.layout.iconGroups} entries={publicEntries} activeSegment={activeSegment} ownerSegment={owner.segment} areaSize={iconArea} readOnly loadPreview={desktop.thumbnailProfile ? loadThumbnail : undefined} selectedIds={selectedIds} onSelectEntry={(_folderId, entry) => selectEntry(entry)} onOpen={openEntry} renderWidget={(widget) => {
                  if (widget.kind === "scene") {
                    const file = publicEntries.find((entry): entry is FileEntry => entry.id === widget.fileId && entry.kind === "file") ?? null;
                    const contentRevision = desktop.entries.find((entry) => entry.id === widget.fileId)?.contentRevision ?? 0;
                    return <Suspense fallback={<div className="scene-state" role="status">Loading Scene...</div>}><SceneFrame file={file} contentRevision={contentRevision} readContent={(entry) => fetchPublicFile(authority, entry, contentRevision)} mode="widget" onPointerObservation={observeWidgetPointer} /></Suspense>;
                  }
                  if (widget.kind !== "todo") return null;
                  const file = publicEntries.find((entry): entry is FileEntry => entry.id === widget.fileId && entry.kind === "file") ?? null;
                  const contentRevision = desktop.entries.find((entry) => entry.id === widget.fileId)?.contentRevision ?? 0;
                  return <TodoWidget file={file} contentRevision={contentRevision} readOnly readContent={(entry) => fetchPublicFile(authority, entry, contentRevision)} onOpen={openEntry} />;
                }} />
              </div>;
            })}
          </div>
        </div>}
        {open && (
          <div className="app-window-layer">
            <AppWindow
              id="public-view"
               title={open.kind === "folder" ? (folder?.name ?? desktop?.name ?? "Desktop") : (open.runtime?.app.title ?? open.file.name)}
              titleId="public-view-title"
              bounds={windowBounds}
               minWidth={open.kind === "file" && open.runtime ? (open.runtime.app.package.manifest.window?.minWidth ?? 360) : builtinAppWindow(open.kind === "folder" ? "explorer" : "file").minWidth}
               minHeight={open.kind === "file" && open.runtime ? (open.runtime.app.package.manifest.window?.minHeight ?? 260) : builtinAppWindow(open.kind === "folder" ? "explorer" : "file").minHeight}
              zIndex={1}
              focused
              minimized={false}
              segmentActive
              windowed={windowed}
              hideFocusedHeader={!windowed}
              externalHeaderElements={windowed ? undefined : { leading: null, actions: mobileHeaderActionsElement }}
              onFocus={() => undefined}
               onBoundsChange={(_id, bounds) => {
                 setWindowBounds(bounds);
                 if (open.kind === "file" && open.runtime) open.runtime.lifecycle.setHostState({ appId: open.runtime.app.package.manifest.id, instanceId: open.runtime.app.id }, { width: Math.round(bounds.width), height: Math.round(bounds.height) });
               }}
              onClose={closePublicView}
              onShowDesktop={() => void backPublicView()}
              backLabel={open.kind === "folder" && open.folderId ? "Back to parent" : "Back to desktop"}
              titleArea={
                <div>
                  <span className="window-kicker">Public · Read only</span>
                   <h2 id="public-view-title">{open.kind === "folder" ? (folder?.name ?? desktop?.name) : (open.runtime?.app.title ?? open.file.name)}</h2>
                </div>
              }
            >
              {(headerElements) =>
                open.kind === "folder" ? (
                  <FolderExplorer
                    folder={folder ?? null}
                    rootLabel={desktop?.name ?? "Desktop"}
                    breadcrumbs={folder ? index.ancestors(folder.id).filter((entry): entry is FolderEntry => entry.kind === "folder") : []}
                    children={index.children.get(open.folderId) ?? []}
                    selectedIds={selectedIds}
                    onSelect={(entry) => selectEntry(entry)}
                    onNavigate={(next) => {
                      setSelectedIds(new Set());
                      setOpen({ kind: "folder", folderId: next?.id ?? null });
                    }}
                    onOpen={openEntry}
                    onCreateFolder={() => undefined}
                    onCreateFile={() => undefined}
                    onUpload={() => undefined}
                    onImportFolder={() => undefined}
                    onExternalDrop={() => undefined}
                    onMove={() => undefined}
                    onContextMenu={() => undefined}
                    onBlankContextMenu={() => undefined}
                    readOnly
                    headerElements={headerElements}
                    view={explorerView}
                    onViewChange={setExplorerView}
                    loadPreview={desktop?.thumbnailProfile ? loadThumbnail : undefined}
                  />
                ) : open.runtime ? (
                  <>
                    <RuntimeAppActions app={open.runtime.app} target={headerElements.actions} onExecute={open.runtime.app.commands.execute} />
                    <Suspense fallback={<div className="app-window__loading" role="status"><SpinnerGap size={22} /> Opening {open.file.name}...</div>}>
                      <PublicAppFrame runtime={open.runtime} onNavigation={closePublicView} />
                    </Suspense>
                  </>
                ) : open.error ? (
                  <div className="app-window__loading" role="alert">
                    <span>{open.error}</span>
                    <button className="button button--primary" type="button" onClick={() => void loadFile(open.file)}>
                      Retry
                    </button>
                  </div>
                ) : open.reserved === "internet-shortcut" ? (
                  <div className="no-preview">
                    <p>This internet shortcut opens in a new browser tab.</p>
                    <button className="button button--primary" type="button" onClick={() => void openInternetShortcut(open.file, window.open("about:blank", "_blank"))}>Open link</button>
                  </div>
                ) : open.reserved === "app-shortcut" ? (
                  <div className="no-preview">
                    <p>Application shortcuts can only open for signed-in viewers who have the referenced app installed.</p>
                  </div>
                ) : open.reserved === "app-package" ? (
                  <div className="no-preview">
                    <p>Public app packages can be downloaded, but cannot be installed or run.</p>
                    <button className="button button--primary" type="button" onClick={() => void loadFile(open.file, true)}>
                      <DownloadSimple size={16} /> Download file
                    </button>
                  </div>
                ) : (
                  <div className="app-window__loading" role="status">
                    <SpinnerGap size={22} /> Opening {open.file.name}...
                  </div>
                )
              }
            </AppWindow>
          </div>
        )}
      </section>
      {desktop && wholeDesktop && areaMapOpen && <AreaSwitcher
        activeSegment={activeSegment}
        activeSegmentKey={activeSegmentKey}
        apps={[]}
        desktopName={desktop.name}
        navigationLabel={`${desktop.name} public desktop areas`}
        desktopSize={iconArea}
        detailed
        dirtyAppIds={new Set()}
        focusedApp={undefined}
        focusedAppId={null}
        obscured={false}
        occupiedSegmentKeys={new Set(occupiedSegments.map((segment) => segment.key))}
        positions={responsive.positions}
        rootRef={areaSwitcherRef}
        segments={minimapSegments}
        swipePreview={null}
        windowLimit={0}
        getAppEntry={() => null}
        getAppLabel={() => ""}
        getAppSegment={() => activeSegment}
        onBeginGridSwipe={() => undefined}
        onMoveGridSwipe={() => undefined}
        onFinishGridSwipe={() => undefined}
        onSelectArea={(segment) => { setActiveSegment(segment); setAreaMapOpen(false); setSelectedIds(new Set()); }}
        onFocusApp={() => undefined}
        onShowDesktop={() => undefined}
        onMinimizeApp={() => undefined}
        onCloseApp={() => undefined}
      />}
      {downloadGate && <LargeDownloadGate gate={downloadGate} onClose={dismissDownloadGate} />}
    </main>
  );
}

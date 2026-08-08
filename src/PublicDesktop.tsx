import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, DownloadSimple, Folder, SignIn, SpinnerGap, SquaresFour, WarningCircle, X } from "@phosphor-icons/react";
import { AppWindow } from "./components/AppWindow";
import { FolderExplorer } from "./components/FolderExplorer";
import { AreaSwitcher } from "./features/areas/AreaSwitcher";
import { loginUrl } from "./lib/auth";
import { DEFAULT_THEME_STATE, isBuiltinThemeId, resolveTheme, themeIconMetrics, themeStyle } from "./lib/themes";
import type { DesktopEntry, FolderEntry } from "./types";
import { builtinAppWindow } from "./apps/registry";
import { createEntryIndex } from "./ui/entry-index";
import { useModalDialog } from "./ui/modal-dialog";
import { publicAreaMapSegments, publicFolderBackTarget } from "./ui/public-desktop-layout";
import { EntryArtwork, StatusBadge, type EntryPreviewSource } from "./components/VisualPrimitives";
import { ShellItemLayer } from "./components/ShellItems";
import { allowsMouseDoubleClick, resolveTouchRelease, type TouchTap } from "./ui/file-icon-gesture";
import type { ExplorerView } from "./domain/preferences";
import { usePublicDesktop } from "./features/public-desktop/controller";
import { API_ROUTES } from "./lib/api-routes";
import type { PublicAuthority } from "./lib/public-desktop";
import { areaCameraPosition, areaWorldOrigin } from "./ui/area-camera";
import { iconAreaSize, projectLogicalPosition, responsiveDesktop, segmentKey, type SurfaceSegment } from "./ui/desktop-geometry";
import { useMediaQuery, WINDOWED_DESKTOP_QUERY } from "./ui/input-capabilities";
import { homeRelativeAreaLabel } from "./ui/shell";
import { clampWindowBounds, initialWindowBounds, type WindowBounds } from "./ui/window-manager";
import { withoutDotEntries } from "./ui/hidden-entries";
import { reservedFileHandler } from "./apps/file-associations";
import { RuntimeAppActions } from "./features/windows/WindowLayer";

const ThemeWallpaper = lazy(() => import("./components/ThemeWallpaper").then((module) => ({ default: module.ThemeWallpaper })));
const PublicAppFrame = lazy(() => import("./features/public-desktop/AppFrame"));

function LargeDownloadGate({ gate, onClose }: { gate: { loginUrl: string; fileName: string }; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(backdropRef, dialogRef, onClose);
  return (
    <div ref={backdropRef} className="modal-backdrop large-download-gate__backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="file-window large-download-gate" role="dialog" aria-modal="true" aria-labelledby="download-gate-title" tabIndex={-1}>
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
    </div>
  );
}

function PublicIcon({ entry, selected, interactive, loadThumbnail, onSelect, onOpen }: { entry: DesktopEntry; selected: boolean; interactive: boolean; loadThumbnail?: (id: string) => Promise<EntryPreviewSource>; onSelect: () => void; onOpen: () => void }) {
  const press = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<TouchTap | null>(null);
  return (
    <button
      className="file-icon public-icon"
      style={{ "--file-x": `${entry.position.x}px`, "--file-y": `${entry.position.y}px` } as React.CSSProperties}
      data-selected={selected || undefined}
      data-entry-id={entry.id}
      type="button"
      tabIndex={interactive ? undefined : -1}
      aria-hidden={interactive ? undefined : true}
      inert={interactive ? undefined : true}
      aria-label={`${entry.name}, ${entry.kind === "folder" ? "folder" : entry.mimeType || "file"}`}
      aria-pressed={selected}
      onClick={onSelect}
      onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
      onDoubleClick={() => {
        if (allowsMouseDoubleClick(performance.now())) onOpen();
      }}
      onPointerDown={(event) => {
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
  const areaSwitcherRef = useRef<HTMLElement>(null);
  const areaSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
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
    const byKey = new Map(responsive.segments.map((segment) => [segment.key, segment]));
    for (const widget of desktop?.layout.widgets ?? []) {
      const segment = projectLogicalPosition(widget, iconArea).segment;
      const key = segmentKey(segment);
      if (!byKey.has(key)) byKey.set(key, { entries: [], key, segment });
    }
    for (const group of desktop?.layout.iconGroups ?? []) {
      const folder = publicEntries.find((entry) => entry.id === group.folderId && entry.kind === "folder" && entry.parentId === null);
      if (!folder) continue;
      const segment = projectLogicalPosition(folder.position, iconArea).segment;
      const key = segmentKey(segment);
      if (!byKey.has(key)) byKey.set(key, { entries: [], key, segment });
    }
    return [...byKey.values()];
  }, [desktop?.layout.iconGroups, desktop?.layout.widgets, iconArea, publicEntries, responsive.segments]);
  const minimapSegments = useMemo(() => publicAreaMapSegments(occupiedSegments, activeSegment), [activeSegment, occupiedSegments]);
  const wholeDesktop = !authority.itemAlias;

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
  const backPublicView = () => {
    if (open?.kind !== "folder" || !open.folderId) {
      closePublicView();
      return;
    }
    setSelectedIds(new Set());
    setOpen({
      kind: "folder",
      folderId: publicFolderBackTarget(desktop?.entries ?? [], open.folderId) ?? null,
    });
  };

  return (
    <main className="desktop-shell public-desktop" data-theme={isBuiltinThemeId(appearance.selectedThemeId) ? appearance.selectedThemeId : "custom"} style={themeStyle(theme)}>
      <header className="menu-bar public-menu">
        {open && !windowed ? (
          <>
            <button className="public-menu__back" type="button" onClick={backPublicView} aria-label={open.kind === "folder" && open.folderId ? "Back to parent folder" : "Back to public desktop"}>
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
              <img className="brand-mark__shape" src={`${import.meta.env.BASE_URL}pwa-192x192.png`} alt="" />
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
        data-wallpaper={wallpaper?.source.startsWith("file:") ? "file" : wallpaper?.source.startsWith("theme:") ? "theme" : (wallpaper?.source ?? "dusk")}
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
      >
        {wallpaper?.source.startsWith("theme:") && (() => {
          const selected = appearance.customThemes.find((item) => item.id === wallpaper.source.slice(6) && item.wallpaper);
          return selected?.wallpaper ? <Suspense fallback={<div className="wallpaper-image" aria-hidden="true" />}><ThemeWallpaper theme={selected} accessUrl={API_ROUTES.publicDesktopContent(authority.desktopAlias, undefined, selected.wallpaper.assetId, selected.wallpaper.revision)} /></Suspense> : <div className="wallpaper-image" aria-hidden="true" />;
        })() || <div className="wallpaper-image" aria-hidden="true" />}
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
                const interactive = desktopSegment.key === activeSegmentKey;
                return <div className="desktop-area-segment" key={desktopSegment.key} data-active={interactive || undefined} aria-hidden={!interactive || undefined} inert={!interactive} style={{ left: origin.x, top: origin.y, width: iconArea.width, height: iconArea.height, visibility: interactive ? "visible" : "hidden" }}>
                  {desktopSegment.entries.map((entry) => <PublicIcon entry={{ ...entry, position: responsive.positions.get(entry.id) ?? entry.position }} key={entry.id} interactive={interactive} loadThumbnail={desktop.thumbnailProfile ? loadThumbnail : undefined} selected={selectedIds.has(entry.id)} onSelect={() => selectEntry(entry)} onOpen={() => openEntry(entry)} />)}
                </div>;
              })}
            </div>
          </div>
        )}
        {desktop && wholeDesktop && <div className="desktop-area-stage desktop-area-stage--shell-items public-shell-items"><ShellItemLayer widgets={desktop.layout.widgets} groups={desktop.layout.iconGroups} entries={publicEntries} activeSegment={activeSegment} areaSize={iconArea} readOnly loadPreview={desktop.thumbnailProfile ? loadThumbnail : undefined} onOpen={openEntry} /></div>}
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
              onShowDesktop={backPublicView}
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
        onShowAllWindows={() => undefined}
      />}
      {downloadGate && <LargeDownloadGate gate={downloadGate} onClose={dismissDownloadGate} />}
    </main>
  );
}

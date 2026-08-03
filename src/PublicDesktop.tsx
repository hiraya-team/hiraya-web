import { useMemo, useRef, useState } from "react";
import { ArrowLeft, DownloadSimple, Folder, SignIn, SpinnerGap, WarningCircle, X } from "@phosphor-icons/react";
import { AppWindow } from "./components/AppWindow";
import { EntryTypeIcon } from "./components/FileIcon";
import { FileWindow } from "./components/FileWindow";
import { FolderExplorer } from "./components/FolderExplorer";
import { loginUrl } from "./lib/auth";
import { DEFAULT_THEME_STATE, isBuiltinThemeId, resolveTheme, themeStyle } from "./lib/themes";
import { DEFAULT_EDITOR_SETTINGS } from "./lib/desktop-state";
import type { DesktopEntry, FolderEntry } from "./types";
import { createEntryIndex } from "./ui/entry-index";
import { fileCapabilities } from "./ui/file-capabilities";
import { useModalDialog } from "./ui/modal-dialog";
import { publicFolderBackTarget } from "./ui/public-desktop-layout";
import { StatusBadge } from "./components/VisualPrimitives";
import { allowsMouseDoubleClick, resolveTouchRelease, type TouchTap } from "./ui/file-icon-gesture";
import type { ExplorerView } from "./domain/preferences";
import { usePublicDesktop } from "./features/public-desktop/controller";
import { ThemeWallpaper } from "./components/ThemeWallpaper";
import { API_ROUTES } from "./lib/api-routes";
import type { PublicAuthority } from "./lib/public-desktop";

function LargeDownloadGate({ gate, onClose }: { gate: { loginUrl: string; fileName: string }; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(backdropRef, dialogRef, onClose);
  return (
    <div ref={backdropRef} className="sharing-dialog__backdrop large-download-gate__backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="large-download-gate" role="dialog" aria-modal="true" aria-labelledby="download-gate-title" tabIndex={-1}>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <span className="large-download-gate__icon">
          <DownloadSimple size={25} />
        </span>
        <h2 id="download-gate-title">Sign in for this download</h2>
        <p>
          <strong>{gate.fileName}</strong> is large enough to require an authenticated download. The public desktop remains available.
        </p>
        <a className="button button--primary" href={new URL(gate.loginUrl, window.location.href).href}>
          <SignIn size={16} /> Sign in and return
        </a>
      </section>
    </div>
  );
}

function PublicIcon({ entry, selected, onSelect, onOpen }: { entry: DesktopEntry; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const press = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<TouchTap | null>(null);
  return (
    <button
      className="public-icon"
      type="button"
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
      <EntryTypeIcon entry={entry} size={39} />
      <span>{entry.name}</span>
    </button>
  );
}

export default function PublicDesktop({ authority }: { authority: PublicAuthority }) {
  const [explorerView, setExplorerView] = useState<ExplorerView>("list");
	const { desktop, error, open, setOpen, downloadGate, dismissDownloadGate, wallpaperUrl, wallpaperFailed, loadFile, resolveLinkedFile } = usePublicDesktop(authority);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mobileHeaderActionsElement, setMobileHeaderActionsElement] = useState<HTMLDivElement | null>(null);
  const index = useMemo(() => createEntryIndex(desktop?.entries ?? []), [desktop?.entries]);
  const appearance = desktop?.appearance ?? DEFAULT_THEME_STATE;
  const theme = resolveTheme(appearance);
  function openEntry(entry: DesktopEntry) {
    setSelectedIds(new Set());
    if (entry.kind === "folder") setOpen({ kind: "folder", folderId: entry.id });
    else void loadFile(entry);
  }
  function selectEntry(entry: DesktopEntry) {
    setSelectedIds(new Set([entry.id]));
  }
  const folder = open?.kind === "folder" && open.folderId ? (index.byId.get(open.folderId) as FolderEntry | undefined) : null;
  const roots = index.children.get(null) ?? [];
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
        {open ? (
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
              <img className="brand-mark__shape" src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
              <strong>Hiraya</strong>
              <span className="public-menu__desktop">{desktop?.name || "Public desktop"}</span>
            </div>
            <div className="public-menu__actions">
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
			return selected?.wallpaper ? <ThemeWallpaper theme={selected} accessUrl={API_ROUTES.publicThemePackageAccess(authority.desktopAlias, selected.id, selected.wallpaper.revision)} /> : <div className="wallpaper-image" aria-hidden="true" />;
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
        {desktop && roots.length === 0 && (
          <div className="desktop-state empty-state">
            <Folder size={30} weight="duotone" />
            <h1>This desktop is empty.</h1>
            <p>There are no public files to browse yet.</p>
          </div>
        )}
        {desktop && (
          <div className="public-icon-grid">
            {roots.map((entry) => (
              <PublicIcon entry={entry} key={entry.id} selected={selectedIds.has(entry.id)} onSelect={() => selectEntry(entry)} onOpen={() => openEntry(entry)} />
            ))}
          </div>
        )}
        {open && (
          <div className="app-window-layer">
            <AppWindow
              id="public-view"
              title={open.kind === "folder" ? (folder?.name ?? desktop?.name ?? "Desktop") : open.file.name}
              titleId="public-view-title"
              bounds={{ x: 0, y: 0, width: 0, height: 0 }}
              zIndex={1}
              focused
              minimized={false}
              segmentActive
              windowed={false}
              hideFocusedHeader
              externalHeaderElements={{ leading: null, actions: mobileHeaderActionsElement }}
              onFocus={() => undefined}
              onBoundsChange={() => undefined}
              onClose={closePublicView}
              onShowDesktop={backPublicView}
              backLabel={open.kind === "folder" && open.folderId ? "Back to parent" : "Back to desktop"}
              titleArea={
                <div>
                  <span className="window-kicker">Public · Read only</span>
                  <h2 id="public-view-title">{open.kind === "folder" ? (folder?.name ?? desktop?.name) : open.file.name}</h2>
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
                  />
                ) : open.blob ? (
                  <FileWindow file={open.file} blob={open.blob} editable={fileCapabilities(open.file).editable} readOnly headerActionsTarget={headerElements.actions} editorSettings={desktop?.editorSettings ?? DEFAULT_EDITOR_SETTINGS} externalEmbeddedPreviews={false} theme={theme} onSave={async () => undefined} onDownload={() => void loadFile(open.file, true)} onEdit={() => undefined} onEditorSettingsChange={() => undefined} onResolveLink={(path) => resolveLinkedFile(open.file, path)} onOpenLinkedFile={(file) => void loadFile(file)} />
                ) : open.error ? (
                  <div className="app-window__loading" role="alert">
                    <span>{open.error}</span>
                    <button className="button button--primary" type="button" onClick={() => void loadFile(open.file)}>
                      Retry
                    </button>
                  </div>
                ) : fileCapabilities(open.file).preview === "none" ? (
                  <div className="no-preview">
                    <p>No preview is available for this file type.</p>
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
      {downloadGate && <LargeDownloadGate gate={downloadGate} onClose={dismissDownloadGate} />}
    </main>
  );
}

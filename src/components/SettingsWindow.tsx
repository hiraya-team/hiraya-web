import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, ArrowLeft, ArrowsOut, CaretRight, ClockCounterClockwise, CloudCheck, CornersIn, CornersOut, Desktop, DownloadSimple, ExportIcon, EyeSlash, FileCode, GlobeSimple, GridFour, Info, LinkSimple, MagnifyingGlass, PaintBrush, Package, ShareNetwork } from "@phosphor-icons/react";
import { ActivityLog } from "./ActivityLog";
import type { ActivityPage, ActivityQuery, ActivityRecord } from "../lib/activity";
import { GRID_SIZES, type DesktopEntry, type DesktopIdentity, type DesktopLayout, type GridSize } from "../types";
import type { AppWindowHeaderElements } from "./AppWindow";
import { installedAppAcceptsMatcher, installedAppIsAvailable, type FileAssociation, type InstalledApp } from "../apps/installed-apps";
import { SYSTEM_FILE_DEFAULTS } from "../apps/file-associations";
import type { PwaInstallState } from "../lib/pwa-install";
import { ShortLinksSettings } from "./ShortLinksSettings";
import type { ShortLink } from "../lib/short-links";
import { DesktopSettings } from "./DesktopSettings";
import type { CatalogQuota } from "../lib/desktop-catalog";
import type { DesktopPreference } from "../lib/desktop-preferences";
import { SETTINGS_PAGE_TITLES, SETTINGS_PARENTS, type SettingsPage } from "../lib/routes";
import { ItemList } from "./ItemList";
import { FileCreationTemplatesSettings } from "./FileCreationTemplatesSettings";
import type { FileCreationTemplate } from "../types";

const SETTINGS_CATEGORIES = [
  { id: "desktop", label: "Desktop" },
  { id: "files-apps", label: "Files & apps" },
  { id: "sharing", label: "Sharing" },
  { id: "sync-storage", label: "Sync & storage" },
  { id: "system", label: "System" },
] as const;

type Props = {
  page: SettingsPage;
  onPageChange: (page: SettingsPage) => void;
  onBack: (parent: SettingsPage) => void;
  mobileHeaderElements?: AppWindowHeaderElements;
  layout: DesktopLayout;
  activeDesktopId: string;
  desktops: readonly DesktopIdentity[];
  catalogQuota: CatalogQuota | null;
  quotaStale: boolean;
  desktopArrangementDisabled: boolean;
  entries: DesktopEntry[];
  canMutate: boolean;
  canViewActivity: boolean;
  activityScope: "catalog" | "desktop";
  restrictionReason: string;
  exportDisabled: boolean;
  exporting: boolean;
  fullscreenEnabled: boolean;
  isFullscreen: boolean;
  updateSupported: boolean;
  updateReady: boolean;
  updateChecking: boolean;
  autoUpdate: boolean;
  externalEmbeddedPreviews: boolean;
  allowBrowserPinchZoom: boolean;
  localPreferencesLoaded: boolean;
  searchAllDesktops: boolean;
  showHiddenFiles: boolean;
  desktopSearchAvailable: boolean;
  shortLinksAvailable: boolean;
  shortLinkBaseUrl: string;
  sharingAvailable: boolean;
  sharingDisabled: boolean;
  installState: PwaInstallState;
  serverBuildTimestamp: string | null;
  installedApps: InstalledApp[];
  connectionPanel: ReactNode;
  sharingPanel: ReactNode;
  fileAssociations: FileAssociation[];
  fileCreationTemplates: FileCreationTemplate[];
  onSetFileAssociation: (matcher: string, appId: string) => void;
  onRemoveFileAssociation: (matcher: string) => void;
  onResetFileAssociations: () => void;
  onFileCreationTemplatesChange: (templates: FileCreationTemplate[]) => Promise<void>;
  onListShortLinks: () => Promise<ShortLink[]>;
  onCreateShortLink: (input: { slug?: string; destinationUrl: string }) => Promise<ShortLink>;
  onUpdateShortLink: (slug: string, input: { destinationUrl?: string; enabled?: boolean }) => Promise<ShortLink>;
  onDeleteShortLink: (slug: string) => Promise<void>;
  onConfirmShortLinkDelete: (link: ShortLink) => Promise<boolean>;
  onListActivity: (query?: ActivityQuery) => Promise<ActivityPage>;
  onSubscribeToActivity: (listener: () => void) => () => void;
  onOpenAffectedEntries?: (activity: ActivityRecord, entryIds: readonly string[]) => void;
  canOpenAffectedEntries?: (activity: ActivityRecord, entryIds: readonly string[]) => boolean;
  onOpenThemeEditor: () => void;
  onLayoutChange: (layout: DesktopLayout, desktopId: string) => Promise<void>;
  onExport: () => void;
  onToggleFullscreen: () => void;
  onCheckForUpdate: () => void;
  onAutoUpdateChange: (enabled: boolean) => void;
  onExternalEmbeddedPreviewsChange: (enabled: boolean) => void;
  onAllowBrowserPinchZoomChange: (enabled: boolean) => void;
  onSearchAllDesktopsChange: (enabled: boolean) => void;
  onShowHiddenFilesChange: (enabled: boolean) => void;
  onInstall: () => void;
  onOpenHelp: (section: "installation-and-updates" | "apps-and-permissions" | "export-backup-and-recovery") => void;
  onCreateDesktop: (name: string) => Promise<void>;
  onRenameDesktop: (id: string, name: string) => Promise<void>;
  onDeleteDesktop: (id: string) => Promise<void>;
  onArrangeDesktops: (desktops: DesktopPreference[]) => Promise<void>;
  canManageDesktop: (desktop: DesktopIdentity) => boolean;
};

function NavigationRow({ id, icon, title, description, disabled, onClick }: { id: string; icon: ReactNode; title: string; description: string; disabled?: boolean; onClick: () => void }) {
  return <section className="settings-section" aria-labelledby={id}><button className="settings-row settings-row--navigation" type="button" disabled={disabled} data-settings-page={id.replace(/-link-heading$/, "")} onClick={onClick}><span className="settings-row__icon">{icon}</span><span className="settings-row__copy"><strong id={id}>{title}</strong><small>{description}</small></span><CaretRight className="settings-row__chevron" size={17} aria-hidden="true" /></button></section>;
}

export function SettingsWindow(props: Props) {
  const { page, onPageChange } = props;
  const contentRef = useRef<HTMLDivElement>(null);
  const mobileBackButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousPageRef = useRef(page);
  const [fileTemplateDrafts, setFileTemplateDrafts] = useState(props.fileCreationTemplates);
  const [fileTemplatesDirty, setFileTemplatesDirty] = useState(false);
  useEffect(() => { if (!fileTemplatesDirty) setFileTemplateDrafts(props.fileCreationTemplates); }, [fileTemplatesDirty, props.fileCreationTemplates]);
  const parent = SETTINGS_PARENTS[page];
  const category = page.split("/")[0];
  const isCategory = !parent;

  useEffect(() => {
    const previous = previousPageRef.current;
    previousPageRef.current = page;
    contentRef.current?.scrollTo({ top: 0 });
    requestAnimationFrame(() => {
      if (page === SETTINGS_PARENTS[previous]) {
        (contentRef.current?.querySelector<HTMLButtonElement>(`[data-settings-page="${previous}"]`) ?? contentRef.current?.querySelector<HTMLHeadingElement>(".settings-ia-header h2"))?.focus();
      }
      else if (SETTINGS_PARENTS[page]) {
        if (mobileBackButtonRef.current?.getClientRects().length) mobileBackButtonRef.current.focus();
        else headingRef.current?.focus();
      }
    });
  }, [page]);

  const formatBuildTimestamp = (timestamp: string | null) => {
    if (!timestamp) return "Unavailable";
    const date = new Date(timestamp);
    return Number.isNaN(date.valueOf()) ? "Unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date);
  };
  const navigate = (next: SettingsPage) => onPageChange(next);
  const pageHeader = parent && <header className="settings-page__header"><button className="settings-page__back" type="button" aria-label={`Back to ${SETTINGS_PAGE_TITLES[parent]}`} onClick={() => props.onBack(parent)}><ArrowLeft size={17} /></button><div><h3 ref={headingRef} tabIndex={-1}>{SETTINGS_PAGE_TITLES[page]}</h3></div></header>;

  const desktopControls = <section className="settings-section" aria-labelledby="desktop-heading"><div className="settings-section__heading"><ArrowsOut size={18} /><div><h3 id="desktop-heading">Layout</h3><p>Adjust icon placement and the viewing area.</p></div></div><div className="settings-list">
    <label className="settings-row"><span className="settings-row__icon"><ArrowsOut size={17} weight={props.layout.autoArrangeIcons ? "bold" : "regular"} /></span><span className="settings-row__copy"><strong>Auto-arrange while dragging</strong><small>Shift nearby icons when icons, widgets, or icon groups move.</small></span><input type="checkbox" checked={props.layout.autoArrangeIcons} disabled={!props.canMutate} onChange={(event) => void props.onLayoutChange({ ...props.layout, autoArrangeIcons: event.target.checked }, props.activeDesktopId)} /></label>
    <label className="settings-row"><span className="settings-row__icon"><GridFour size={17} weight={props.layout.snapToGrid ? "fill" : "regular"} /></span><span className="settings-row__copy"><strong>Snap to grid</strong><small>Align icons, widgets, and icon groups when they are moved or resized.</small></span><input type="checkbox" checked={props.layout.snapToGrid} disabled={!props.canMutate} onChange={(event) => void props.onLayoutChange({ ...props.layout, snapToGrid: event.target.checked }, props.activeDesktopId)} /></label>
    <label className="settings-row"><span className="settings-row__icon"><GridFour size={17} /></span><span className="settings-row__copy"><strong>Grid size</strong><small>Choose how finely desktop items align.</small></span><select className="settings-row__select" value={props.layout.gridSize} disabled={!props.canMutate || !props.layout.snapToGrid} onChange={(event) => void props.onLayoutChange({ ...props.layout, gridSize: Number(event.target.value) as GridSize }, props.activeDesktopId)}>{GRID_SIZES.map((size) => <option value={size} key={size}>{size}px</option>)}</select></label>
    {props.fullscreenEnabled && <div className="settings-row"><span className="settings-row__icon">{props.isFullscreen ? <CornersIn size={17} /> : <CornersOut size={17} />}</span><span className="settings-row__copy"><strong>{props.isFullscreen ? "Exit fullscreen" : "Fullscreen"}</strong><small>Use all available screen space.</small></span><button className="button button--quiet" type="button" onClick={props.onToggleFullscreen}>{props.isFullscreen ? "Exit" : "Enter"}</button></div>}
    <label className="settings-row"><span className="settings-row__icon"><ArrowsOut size={17} /></span><span className="settings-row__copy"><strong>Browser pinch zoom</strong><small>Allow two-finger browser magnification over the desktop.</small></span><input type="checkbox" checked={props.allowBrowserPinchZoom} disabled={!props.localPreferencesLoaded} onChange={(event) => props.onAllowBrowserPinchZoomChange(event.target.checked)} /></label>
  </div></section>;

  let content: ReactNode;
  if (page === "desktop") content = <><NavigationRow id="desktop/theme-editor-link-heading" icon={<PaintBrush size={17} />} title="Theme Editor" description="Create and apply themes, and customize this desktop's wallpaper." onClick={props.onOpenThemeEditor} /><NavigationRow id="desktop/desktops-link-heading" icon={<Desktop size={17} />} title="Desktops" description="Manage names, ownership, account limits, pins, and switcher order." onClick={() => navigate("desktop/desktops")} />{desktopControls}</>;
  else if (page === "files-apps") content = <>
    <NavigationRow id="files-apps/file-types-link-heading" icon={<Package size={17} />} title="File type defaults" description="Choose preferred apps for compatible files." onClick={() => navigate("files-apps/file-types")} />
    <NavigationRow id="files-apps/new-file-defaults-link-heading" icon={<FileCode size={17} />} title="New file defaults" description="Choose starting content by file extension for this desktop." onClick={() => navigate("files-apps/new-file-defaults")} />
    <section className="settings-section" aria-labelledby="file-options-heading"><div className="settings-section__heading"><EyeSlash size={18} /><div><h3 id="file-options-heading">Files and previews</h3><p>Choose what this browser shows and searches.</p></div></div><div className="settings-list">
      <label className="settings-row"><span className="settings-row__icon"><EyeSlash size={17} weight={props.showHiddenFiles ? "fill" : "regular"} /></span><span className="settings-row__copy"><strong>Show hidden files</strong><small>Show dot-prefixed files and the read-only `.hiraya` system tree.</small></span><input type="checkbox" checked={props.showHiddenFiles} disabled={!props.localPreferencesLoaded} onChange={(event) => props.onShowHiddenFilesChange(event.target.checked)} /></label>
      <label className="settings-row"><span className="settings-row__icon"><MagnifyingGlass size={17} /></span><span className="settings-row__copy"><strong>Search all accessible desktops</strong><small>{props.desktopSearchAvailable ? "Use server results online and cached results offline." : "This server does not advertise accessible-desktop search."}</small></span><input type="checkbox" checked={props.searchAllDesktops} disabled={!props.desktopSearchAvailable || !props.localPreferencesLoaded} onChange={(event) => props.onSearchAllDesktopsChange(event.target.checked)} /></label>
      <label className="settings-row"><span className="settings-row__icon"><GlobeSimple size={17} weight={props.externalEmbeddedPreviews ? "fill" : "regular"} /></span><span className="settings-row__copy"><strong>External embedded previews</strong><small>Opening a document may contact third-party sites.</small></span><input type="checkbox" checked={props.externalEmbeddedPreviews} disabled={!props.localPreferencesLoaded} onChange={(event) => props.onExternalEmbeddedPreviewsChange(event.target.checked)} /></label>
    </div></section>
  </>;
  else if (page === "sharing") content = <>{props.sharingAvailable && <NavigationRow id="sharing/desktop-link-heading" icon={<ShareNetwork size={17} />} title="Desktop sharing" description={props.sharingDisabled ? "Connect to review and manage sharing." : "Invite people, publish this desktop, and manage published items."} disabled={props.sharingDisabled} onClick={() => navigate("sharing/desktop")} />}{props.shortLinksAvailable && <NavigationRow id="sharing/short-links-link-heading" icon={<LinkSimple size={17} />} title="Short Links" description="Create and manage account-wide redirect URLs." onClick={() => navigate("sharing/short-links")} />}</>;
  else if (page === "sync-storage") content = <><NavigationRow id="sync-storage/connection-link-heading" icon={<CloudCheck size={17} />} title="Connection & Offline" description="Review synchronization, pending work, downloaded bytes, and browser storage." onClick={() => navigate("sync-storage/connection")} />{props.canViewActivity && <NavigationRow id="sync-storage/activity-link-heading" icon={<ClockCounterClockwise size={17} />} title="Activity" description={props.activityScope === "desktop" ? "Review accepted changes from this shared desktop." : "Review accepted changes across your desktops."} onClick={() => navigate("sync-storage/activity")} />}<NavigationRow id="sync-storage/export-link-heading" icon={<ExportIcon size={17} />} title="Export" description="Create a seeded ZIP for a fresh frontend-only deployment." onClick={() => navigate("sync-storage/export")} /></>;
  else if (page === "system") content = <><NavigationRow id="system/updates-link-heading" icon={<ArrowClockwise size={17} />} title="Updates" description="Install Hiraya and keep this app current." onClick={() => navigate("system/updates")} /><NavigationRow id="system/about-link-heading" icon={<Info size={17} />} title="About" description="Review app and server build information." onClick={() => navigate("system/about")} /></>;
  else if (page === "desktop/desktops") content = <DesktopSettings desktops={props.desktops} activeDesktopId={props.activeDesktopId} quota={props.catalogQuota} quotaStale={props.quotaStale} arrangementDisabled={props.desktopArrangementDisabled} onCreate={props.onCreateDesktop} onRename={props.onRenameDesktop} onDelete={props.onDeleteDesktop} onArrange={props.onArrangeDesktops} canManageDesktop={props.canManageDesktop} />;
  else if (page === "files-apps/file-types") content = <><section className="settings-section settings-page--apps" aria-labelledby="file-types-heading"><div className="settings-section__heading"><div><h4 id="file-types-heading">File type defaults</h4><p>Handler hints activate only after this device approves the exact compatible app package.</p></div><button className="button button--quiet" type="button" disabled={!props.fileAssociations.length} onClick={props.onResetFileAssociations}>Reset all</button></div><div className="settings-list">{props.fileAssociations.length > 0 && <ItemList items={props.fileAssociations} getId={(association) => association.matcher} label="Preferred file type handlers" renderItem={(association, { itemProps }) => { const compatible = props.installedApps.filter((app) => installedAppIsAvailable(app, props.entries) && installedAppAcceptsMatcher(app, association.matcher)); const selected = compatible.find((app) => app.appId === association.appId); return <div {...itemProps} className="settings-row" key={association.matcher}><span className="settings-row__copy"><strong>{association.matcher}</strong><small>{selected?.manifest.name ?? `${association.appId} (unavailable or incompatible)`}</small></span><select aria-label={`Preferred app for ${association.matcher}`} value={selected?.appId ?? association.appId} onChange={(event) => props.onSetFileAssociation(association.matcher, event.target.value)}>{!selected && <option value={association.appId}>{association.appId} (unavailable or incompatible)</option>}{compatible.map((app) => <option value={app.appId} key={app.appId}>{app.manifest.name}</option>)}</select><button className="button button--quiet" type="button" onClick={() => props.onRemoveFileAssociation(association.matcher)}>Remove</button></div>; }} />}{!props.fileAssociations.length && <p className="theme-custom__empty">No preferred handlers. Use Open With on a file to choose one.</p>}<ItemList items={SYSTEM_FILE_DEFAULTS} getId={(item) => item.matcher} label="Bundled file type handlers" renderItem={(item, { itemProps }) => <div {...itemProps} className="settings-row" key={item.label}><span className="settings-row__copy"><strong>{item.label}</strong><small>{item.matcher}</small></span><span>{props.installedApps.find((app) => app.appId === item.appId)?.manifest.name ?? "Bundled default"}</span></div>} /></div></section><button className="inline-help-link" type="button" onClick={() => props.onOpenHelp("apps-and-permissions")}>App packages, permissions, and updates</button></>;
  else if (page === "files-apps/new-file-defaults") content = <FileCreationTemplatesSettings drafts={fileTemplateDrafts} dirty={fileTemplatesDirty} disabled={!props.canMutate} onDraftsChange={(drafts) => { setFileTemplateDrafts(drafts); setFileTemplatesDirty(true); }} onChange={async (templates) => { await props.onFileCreationTemplatesChange(templates); setFileTemplateDrafts(templates); setFileTemplatesDirty(false); }} />;
  else if (page === "sharing/desktop") content = props.sharingPanel;
  else if (page === "sharing/short-links") content = <ShortLinksSettings embedded baseUrl={props.shortLinkBaseUrl} onBack={() => navigate("sharing")} onList={props.onListShortLinks} onCreate={props.onCreateShortLink} onUpdate={props.onUpdateShortLink} onDelete={props.onDeleteShortLink} onConfirmDelete={props.onConfirmShortLinkDelete} />;
  else if (page === "sync-storage/connection") content = props.connectionPanel;
  else if (page === "sync-storage/activity") content = <ActivityLog onListActivity={props.onListActivity} onSubscribe={props.onSubscribeToActivity} onOpenAffectedEntries={props.onOpenAffectedEntries} canOpenAffectedEntries={props.canOpenAffectedEntries} />;
  else if (page === "sync-storage/export") content = <><section className="settings-section"><div className="settings-section__heading"><ExportIcon size={18} /><div><h4>Export deployment seed</h4><p>Create a seeded ZIP for a fresh frontend-only deployment.</p></div></div><div className="settings-export"><span>No in-product restore. Unsaved editor changes are not included.</span><button className="button button--quiet" type="button" disabled={props.exportDisabled || props.exporting} onClick={props.onExport}><ExportIcon size={16} /> {props.exporting ? "Exporting..." : "Export deployment seed"}</button></div></section><button className="inline-help-link" type="button" onClick={() => props.onOpenHelp("export-backup-and-recovery")}>Export versus server backup and recovery</button></>;
  else if (page === "system/updates") content = <><section className="settings-section"><div className="settings-list"><div className="settings-row"><span className="settings-row__icon"><DownloadSimple size={17} /></span><span className="settings-row__copy"><strong>Install Hiraya</strong><small>{props.installState === "standalone" ? "Running as an installed app." : props.installState === "installed" ? "Installed on this device." : props.installState === "promptable" ? "Ready to install from Hiraya." : "Use your browser's Install app or Add to Home Screen menu."}</small></span>{props.installState === "promptable" && <button className="button button--quiet" type="button" onClick={props.onInstall}>Install</button>}</div><div className="settings-row"><span className="settings-row__icon"><ArrowClockwise size={17} weight={props.updateReady ? "bold" : "regular"} /></span><span className="settings-row__copy"><strong>Update to latest version</strong><small>{!props.updateSupported ? "Available in production PWA builds." : props.updateReady ? "A new version is ready to install." : "Check for a newer app release."}</small></span><button className="button button--quiet" type="button" disabled={!props.updateSupported || props.updateChecking} onClick={props.onCheckForUpdate}>{props.updateChecking ? "Checking" : props.updateReady ? "Review" : "Check now"}</button></div><label className="settings-row"><span className="settings-row__icon"><ArrowClockwise size={17} /></span><span className="settings-row__copy"><strong>Automatic updates</strong><small>Check automatically, then ask before reloading.</small></span><input type="checkbox" checked={props.autoUpdate} disabled={!props.updateSupported} onChange={(event) => props.onAutoUpdateChange(event.target.checked)} /></label></div></section><button className="inline-help-link" type="button" onClick={() => props.onOpenHelp("installation-and-updates")}>How Hiraya updates work</button></>;
  else content = <section className="settings-section"><div className="settings-list"><div className="settings-row"><span className="settings-row__icon"><ClockCounterClockwise size={17} /></span><span className="settings-row__copy"><strong>App build</strong><small><time dateTime={import.meta.env.HIRAYA_BUILD_TIMESTAMP}>{formatBuildTimestamp(import.meta.env.HIRAYA_BUILD_TIMESTAMP)}</time></small></span></div><div className="settings-row"><span className="settings-row__icon"><ClockCounterClockwise size={17} /></span><span className="settings-row__copy"><strong>Server build</strong><small>{props.serverBuildTimestamp ? <time dateTime={props.serverBuildTimestamp}>{formatBuildTimestamp(props.serverBuildTimestamp)}</time> : "Unavailable"}</small></span></div></div></section>;

  return <div className="settings-window settings-window--embedded">
    {parent && props.mobileHeaderElements?.actions && createPortal(<button ref={mobileBackButtonRef} className="app-window__control mobile-header-back" type="button" aria-label={`Back to ${SETTINGS_PAGE_TITLES[parent]}`} onClick={() => props.onBack(parent)}><ArrowLeft size={18} /></button>, props.mobileHeaderElements.actions)}
    <div className={`settings-window__content${isCategory ? " settings-window__content--main" : ""}`} ref={contentRef}>
      {isCategory && <><header className="settings-ia-header"><h2 tabIndex={-1}>{SETTINGS_PAGE_TITLES[page]}</h2><p>{page === "desktop" ? "Personalize this desktop and its layout." : page === "files-apps" ? "Control file visibility, search, previews, and app defaults." : page === "sharing" ? "Manage access and links for this desktop and account." : page === "sync-storage" ? "Review synchronization, storage, activity, and export." : "Install, update, and identify this Hiraya build."}</p>{!props.canMutate && <p className="settings-window__offline" role="status">Restricted: {props.restrictionReason}</p>}</header><nav className="settings-ia-categories" aria-label="Settings categories">{SETTINGS_CATEGORIES.filter((item) => item.id !== "sharing" || props.sharingAvailable || props.shortLinksAvailable).map((item) => <button type="button" aria-pressed={item.id === category} key={item.id} onClick={() => navigate(item.id)}>{item.label}</button>)}</nav></>}
      {!isCategory && pageHeader}
      <div className="settings-category-content">{content}</div>
    </div>
  </div>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpenText, CaretDown, ClipboardText, CloudCheck, CloudSlash, Copy, Desktop, DotsThree, File as FileGlyph, FolderOpen, FolderPlus, FolderSimplePlus, GearSix, HardDrive, IdentificationCard, Keyboard, MagnifyingGlass, Plus, ShareNetwork, SignOut, SpinnerGap, SquaresFour, Trash, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import seededDesktop from "virtual:hiraya-seeded";
import { ContextMenu, DesktopContextMenu } from "./components/ContextMenu";
import { FileDialog } from "./components/FileDialog";
import { FileIcon } from "./components/FileIcon";
import { FolderExplorer } from "./components/FolderExplorer";
import { MoveDialog } from "./components/MoveDialog";
import { DesktopSwitcher } from "./components/DesktopSwitcher";
import type { CatalogQuota } from "./lib/desktop-catalog";
import { PasteConflictDialog } from "./components/PasteConflictDialog";
import { PropertiesWindow } from "./components/PropertiesWindow";
import { SettingsWindow } from "./components/SettingsWindow";
import { GettingStartedDialog } from "./components/GettingStartedDialog";
import { AppPickerDialog } from "./components/AppPickerDialog";
import { UpdateToast } from "./components/UpdateToast";
import { NotificationCard } from "./components/NotificationCard";
import { MobileSelectionToolbar } from "./components/MobileSelectionToolbar";
import {
  createFolder,
  createEntries,
  createDesktop as createDesktopMutation,
  createTextFile,
  deleteCustomTheme,
  captureEntries,
  deleteEntries,
  deleteDesktop as deleteDesktopMutation,
  fetchServerBuildTimestamp,
  getOutboxStatus,
  importFiles,
  initializeDesktop,
  listActivity,
  listDesktops,
  moveEntries,
  transferEntries,
  pasteEntries,
  readFile,
  renameEntry,
  renameDesktop as renameDesktopMutation,
  saveCustomTheme,
  saveDesktopLayout,
  selectTheme,
  updateRootEntryPositions,
  updateEntryPosition,
  subscribeToSync,
  subscribeToActivityChanges,
  subscribeToDesktopCatalog,
  subscribeToOutbox,
  listOutboxRecords,
  retryBlockedOutboxRecord,
  discardBlockedOutboxRecord,
  loadOfflineInventory,
  subscribeToOfflineStorage,
  estimateOfflineOperation,
  setOfflinePinIntent,
  refreshPinnedContent,
  releaseOfflineCopies,
  listTrash,
  restoreTrash,
  permanentlyDeleteTrash,
  stopDesktopSync,
  type SyncStatus,
  type OfflineOperationProgress,
} from "./lib/sync";
import { pruneLocalDesktops, readDesktopEntries, readLocalPreferences, readWindowSession, saveLocalPreferences, saveWindowSession, switchDesktop as switchLocalDesktop } from "./lib/opfs";
import type { DesktopStateSnapshot } from "./domain/desktop-state";
import type { ExplorerView, LocalPreferences } from "./domain/preferences";
import { createPwaUpdater, type PwaUpdater } from "./lib/pwa-update";
import { exportSeededDesktop } from "./lib/seeded";
import { CLIPBOARD_ARCHIVE_WEB_MIME_TYPE, clipboardSnapshotIdentity, decodeClipboardArchiveItem, encodeClipboardArchive, isClipboardArchiveType, snapshotFromClipboardItems, type ClipboardEntrySnapshot } from "./lib/clipboard";
import { formatDesktopRoute, normalizeDesktopRoute, parseDesktopRoute, resolveOpenFilePath, routeTargetsAppEntry, type DesktopRoute } from "./lib/routes";
import { DEFAULT_THEME_STATE, isBuiltinThemeId, resolveTheme, themeIconMetrics, themeStyle } from "./lib/themes";
import type { CustomTheme, ThemeState } from "./domain/theme";
import { DEFAULT_WALLPAPER, type ContextMenuState, type DesktopEntry, type DesktopIdentity, type DesktopLayout, type DialogState, type EntryPosition, type FileEntry, type FolderEntry } from "./types";
import { GRID_ORIGIN, nextAvailableDesktopSlot, nextRootEntryPosition, projectLogicalPosition, responsiveDesktop, restoreLogicalPosition, segmentKey, snapAxis, type SurfaceSegment } from "./ui/desktop-geometry";
import { fileCapabilities } from "./ui/file-capabilities";
import { topOverlay } from "./ui/overlay";
import { createEntryIndex } from "./ui/entry-index";
import { clampWindowBounds, initialWindowBounds, type WindowBounds } from "./ui/window-manager";
import { namesMatch } from "./lib/entry-validation";
import { createWindowSession, restoreWindowSession, type WindowSession, type WindowTarget } from "./lib/window-session";
import { parseInternetShortcut } from "./lib/internet-shortcut";
import { createSerialTaskQueue } from "./lib/serial-task";
import { validateWallpaperImage } from "./lib/wallpaper-image";
import { MobileHeaderMenu } from "./components/MobileHeaderMenu";
import type { AuthSession } from "./lib/auth";
import { SearchCommandPalette } from "./components/SearchCommandPalette";
import { KeyboardShortcutsPanel } from "./components/KeyboardShortcutsPanel";
import { TrashWindow } from "./components/TrashWindow";
import { PanelDialog } from "./components/PanelDialog";
import { ConfirmationDialog, type ConfirmationRequest } from "./components/ConfirmationDialog";
import { SharingDialog } from "./components/SharingDialog";
import { canOpenActivity } from "./ui/activity-navigation";
import type { OutboxRecord } from "./lib/outbox";
import type { TrashItem } from "./lib/contracts";
import type { KeyboardShortcut, WindowListItem } from "./ui/panel-data";
import { canMutateDesktop, fileWriteCapability, settingsRestrictionReason, sharedOfflineMessage } from "./lib/permissions";
import { builtinAppEntryDependency, builtinAppMaximizeRestoreWindow, builtinAppTargetId, builtinAppTargetOpensFile, builtinAppWindow, extractBuiltinAppTarget } from "./apps/registry";
import { createAppCommandService, type AppCommandContext, type CommandId } from "./apps/commands";
import { isAppPackageName, TRUSTED_MARKDOWN_CSP, TRUSTED_MARKDOWN_FLAGS } from "@hiraya/app-runtime";
import { SandboxAppFrame } from "@hiraya/app-runtime/react";
import { HostServiceError, grantPickedFiles, grantPickedFolder, mapThemeTokens } from "./apps/host";
import { createFile as createAppFile, deleteEntry as deleteAppEntry, moveEntry as moveAppEntry, saveFile as saveAppFile } from "./lib/sync";
import { installedAppIsAvailable, installedAppMatchesSavedIdentity, packageMatchesInstall, type InstalledApp, type QuarantinedApp } from "./apps/installed-apps";
import { associationCandidates, matchingInstalledApps, resolveFileApp, resolveRestoredFileApp, systemDefaultAppId } from "./apps/file-associations";
import { SYSTEM_APP_CATALOG } from "./apps/system-apps";
import { SYSTEM_APP_IDS } from "./apps/system-app-ids";
import type { SystemAppTarget } from "./apps/types";
import { closeWithDirtyCheck, forceCloseRunningAppInstances } from "./apps/app-close";
import { COMPACT_CHROME_QUERY, MOBILE_WINDOW_QUERY, useMediaQuery } from "./ui/responsive";
import { localSearchResults, searchAccessibleDesktops, type DesktopSearchResult } from "./lib/search";
import { createTrashNotification, dismissTrashNotification, updateTrashNotification, type TrashNotification } from "./lib/trash-notifications";
import { isStandalone, pwaInstallState, type InstallPromptEvent } from "./lib/pwa-install";
import { areaCoordinateLabel, areaMapSegments } from "./ui/desktop-areas";
import { assertImportOperationCurrent, buildImportPlan, sourcesFromDirectoryHandle, sourcesFromDirectoryPicker, sourcesFromDrop, supportsDirectoryHandlePicker, supportsDirectoryPicker, type ImportOperationContext, type ImportSource } from "./lib/directory-import";
import { buildOfflineAvailability, type OfflineStorageInventory } from "./lib/offline-availability";
import { HelpPanel } from "./components/HelpPanel";
import type { HelpSectionId } from "./lib/help";
import { AppIcon, StatusBadge, type StatusTone } from "./components/VisualPrimitives";
import { boundedNotificationVisibility } from "./ui/notifications";
import { AllWindowsPanel } from "./components/AllWindowsPanel";
import { DesktopTaskbar } from "./components/DesktopTaskbar";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { lockAuthBootstrap } from "./lib/auth";
import { requestStoragePersistence, type StoragePersistenceStatus } from "./lib/storage-persistence";
import { SystemMenu } from "./components/SystemMenu";
import { adjacentSwipeArea, areaDirectionalLabel, areaSwitcherDragCommits, areaSwitcherDragPosition, areaTransitionDepth, committedSwipeTarget, homeRelativeAreaLabel, minimapWindowCapacity, swipeAxis, swipePreviewReady } from "./ui/shell";
import { SERVER_ROUTES } from "./lib/api-routes";
import { actionSheetHistoryState, actionSheetHistoryToken } from "./ui/action-sheet-history";
import { dismissClipboardOffer, observeClipboardOffer, persistClipboardOffer, restoreClipboardOffer, type ClipboardOfferState } from "./ui/clipboard-offer";
import { historyInstanceIds, historySettingsPage, removedHistoryInstanceIds, type AppHistorySettingsPage } from "./ui/app-history";
import { areaCameraDragPosition, areaCameraPosition, areaTransferDelta, areaWorldOrigin } from "./ui/area-camera";
import { runningAppIds as projectRunningAppIds, runningAppIsInSegment, runningAppSegment, runningAppTargets as projectRunningAppTargets, topRunningAppInSegment, type BaseRunningApp, type ExplorerApp, type FileApp, type PropertiesApp, type RunningApp, type SandboxApp, type SettingsApp } from "./features/windows/model";
import { createRouteHistoryState, parseRunningAppHistory, routeForRunningApp, type RouteHistoryState } from "./features/windows/history";
import { useRunningWindows } from "./features/windows/controller";
import { WindowLayer } from "./features/windows/WindowLayer";
import { AreaSwitcher } from "./features/areas/AreaSwitcher";
import { useAppPlatform } from "./features/app-management/controller";
import { launchSandboxApp, type AppLaunchSource, type AppLaunchTarget } from "./features/app-management/launch";
import { useDesktopSelection } from "./features/selection/controller";

type PendingPaste = { snapshot: ClipboardEntrySnapshot; parentId: string | null; position?: EntryPosition };
type AreaTransition = { id: number; source: SurfaceSegment; target: SurfaceSegment; phase: "preparing" | "interactive" | "settling"; kind: "gesture" | "programmatic" };
const DESKTOP_LONG_PRESS_MS = 500;
const DESKTOP_GESTURE_EXCLUSION_SELECTOR = ".file-icon, .empty-state__actions, .app-window, button, a[href], input, select, textarea, [contenteditable='true']";
const ONBOARDING_VERSION = 1;

function formatClock(date: Date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatImportBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function transientMenuOpen() {
  return Boolean(document.querySelector(".mobile-header-menu__panel, .desktop-switcher__panel, .app-window__menu"));
}

function App({ session }: { session: AuthSession | null }) {
  const commandService = useMemo(createAppCommandService, []);
  const [loading, setLoading] = useState(true);
  const {
    lifecycle: appLifecycle,
    theme: appTheme,
    hostServices: appHostServices,
    capabilities: appCapabilities,
    installedApps,
    fileAssociations,
    quarantinedApps,
    dialogRequests: appDialogRequests,
    notifications: appNotifications,
    approveInstall,
    removeInstall,
    discardQuarantine,
    saveAssociation,
    deleteAssociation,
    clearAssociations,
    clearAppData,
  } = useAppPlatform({
    enabled: !loading,
    initialTheme: resolveTheme(DEFAULT_THEME_STATE),
    onCloseRequest: ({ instanceId }) => closeAppRef.current(instanceId, false),
    onError: (loadError) => setError(loadError.message),
  });
  const [entries, setEntries] = useState<DesktopEntry[]>([]);
  const [desktops, setDesktops] = useState<DesktopIdentity[]>([]);
  const [catalogQuota, setCatalogQuota] = useState<CatalogQuota | null>(null);
  const [activeDesktopId, setActiveDesktopId] = useState("");
  const [error, setError] = useState("");
  const [folderImportError, setFolderImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [areaAnnouncement, setAreaAnnouncement] = useState("");
  const [swipePreview, setSwipePreview] = useState<SurfaceSegment | null>(null);
  const [areaTransition, setAreaTransition] = useState<AreaTransition | null>(null);
  const { selectedIds, selectedIdsRef, selectionScope, mobileMultiSelectScope, replaceSelection, selectEntry: selectEntryId, addEntryToSelection: addEntryIdToSelection, retainSelection, beginMobileMultiSelect } = useDesktopSelection();
  const [dirtyAppIds, setDirtyAppIds] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [moveDialogEntryIds, setMoveDialogEntryIds] = useState<string[]>([]);
  const [moveDialogSubmitting, setMoveDialogSubmitting] = useState(false);
  const [desktopMoveFolders, setDesktopMoveFolders] = useState<Record<string, DesktopEntry[]>>({});
  const [moveDestinationsLoading, setMoveDestinationsLoading] = useState(false);
  const { runningApps, runningAppsRef, focusedAppId, focusedAppIdRef, updateRunningApps, setFocusedApp, nextWindowZIndex, setNextWindowZIndex } = useRunningWindows();
  const [windowSessionRestored, setWindowSessionRestored] = useState(false);
  const [routeHistoryReady, setRouteHistoryReady] = useState(false);
  const [route, setRoute] = useState<DesktopRoute | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [desktopSize, setDesktopSize] = useState(() => ({ width: window.innerWidth, height: Math.max(1, window.innerHeight - 44) }));
  const [layout, setLayout] = useState<DesktopLayout>(() => ({ snapToGrid: false, wallpaper: DEFAULT_WALLPAPER }));
  const [wallpaperAsset, setWallpaperAsset] = useState<{ key: string; url: string } | null>(null);
  const [appearance, setAppearance] = useState<ThemeState>(DEFAULT_THEME_STATE);
  const [exporting, setExporting] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const isMobile = useMediaQuery(MOBILE_WINDOW_QUERY);
  const compactChrome = useMediaQuery(COMPACT_CHROME_QUERY);
  const [settingsPage, setSettingsPage] = useState<AppHistorySettingsPage>("main");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [externalEmbeddedPreviews, setExternalEmbeddedPreviews] = useState<boolean | null>(null);
  const [allowBrowserPinchZoom, setAllowBrowserPinchZoom] = useState(false);
  const [updateSupported, setUpdateSupported] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [updateBlocked, setUpdateBlocked] = useState(false);
  const [updateApplying, setUpdateApplying] = useState(false);
  const [serverBuildTimestamp, setServerBuildTimestamp] = useState<string | null>(null);
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const [clipboardOffer, setClipboardOffer] = useState<ClipboardOfferState | null>(() => restoreClipboardOffer(typeof sessionStorage === "undefined" ? null : sessionStorage));
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [activePanel, setActivePanel] = useState<"search" | "sync" | "offline" | "windows" | "help" | "shortcuts" | "trash" | null>(null);
  const [helpSection, setHelpSection] = useState<HelpSectionId>("start-here");
  const [outboxRecords, setOutboxRecords] = useState<OutboxRecord[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [storagePersistence, setStoragePersistence] = useState<StoragePersistenceStatus>("checking");
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [offlineInventory, setOfflineInventory] = useState<OfflineStorageInventory | null>(null);
  const [offlineProgress, setOfflineProgress] = useState<OfflineOperationProgress | null>(null);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<{ folderCount: number; fileCount: number; totalBytes: number; phase: "preparing" | "saving" | "syncing" } | null>(null);
  const [trashNotifications, setTrashNotifications] = useState<TrashNotification[]>([]);
  const [cachedSearchResults, setCachedSearchResults] = useState<DesktopSearchResult[]>([]);
  const [searchAllDesktops, setSearchAllDesktops] = useState(false);
  const [explorerView, setExplorerView] = useState<ExplorerView>("list");
  const [minimapExpanded, setMinimapExpanded] = useState(false);
  const [showGettingStarted, setShowGettingStarted] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [mobileHeaderActionsElement, setMobileHeaderActionsElement] = useState<HTMLDivElement | null>(null);
  const desktopRef = useRef<HTMLElement>(null);
  const desktopSizeRef = useRef(desktopSize);
  const canvasRef = useRef<HTMLDivElement>(null);
  const windowTrackRef = useRef<HTMLDivElement>(null);
  const frameTrackRef = useRef<HTMLDivElement>(null);
  const areaTransitionTimerRef = useRef<number | null>(null);
  const areaTransitionGenerationRef = useRef(0);
  const areaTransitionRef = useRef<AreaTransition | null>(null);
  const completeAreaTransitionRef = useRef<() => void>(() => undefined);
  const uploadRef = useRef<HTMLInputElement>(null);
  const directoryRef = useRef<HTMLInputElement>(null);
  const uploadParentRef = useRef<string | null>(null);
  const uploadPositionRef = useRef<EntryPosition | undefined>(undefined);
  const importOperationRef = useRef<ImportOperationContext | null>(null);
  const swipeRef = useRef<{ axis: "x" | "y" | null; pointerId: number; startSegment: SurfaceSegment; startX: number; startY: number; x: number; y: number; previewTarget: SurfaceSegment | null; transitionId?: number } | null>(null);
  const desktopPressRef = useRef<{
    activated: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    timer: number;
  } | null>(null);
  const desktopTouchPointersRef = useRef(new Set<number>());
  const areaSwitcherHandleRef = useRef<HTMLButtonElement>(null);
  const areaSwitcherRef = useRef<HTMLElement>(null);
  const areaSwitcherRestoreFocusRef = useRef(false);
  const areaSwitcherInternalActivationRef = useRef(false);
  const areaSwitcherDragRef = useRef<{ expanded: boolean; moved: boolean; pointerId: number; startX: number; travel: number } | null>(null);
  const suppressAreaSwitcherClickRef = useRef(false);
  const minimapSwipeRef = useRef<{
    axis: "x" | "y" | null;
    pointerId: number;
    startSegment: SurfaceSegment;
    startX: number;
    startY: number;
    previewTarget: SurfaceSegment | null;
  } | null>(null);
  const suppressMinimapClickRef = useRef(false);
  const suppressClickRef = useRef(false);
  const clipboardRef = useRef<ClipboardEntrySnapshot | null>(null);
  const marqueeRef = useRef<{ pointerId: number; startX: number; startY: number; additive: boolean; initial: string[] } | null>(null);
  const beginPasteRef = useRef<(parentId: string | null, position?: EntryPosition, snapshot?: ClipboardEntrySnapshot) => Promise<void>>(async () => undefined);
  const copySelectionRef = useRef<() => Promise<void>>(async () => undefined);
  const handleImportRef = useRef<(files: File[], parentId: string | null, base?: EntryPosition) => Promise<void>>(async () => undefined);
  const edgeDragRef = useRef({ direction: "", time: 0 });
  const windowEdgeDragRef = useRef({ direction: "", time: 0 });
  const edgeNavigationRef = useRef<{
    route: DesktopRoute;
    historyState: unknown;
    draftEntryId?: string;
    focusedAppId?: string | null;
    targetSegment?: { column: number; row: number };
  } | null>(null);
  const windowEdgeNavigationRef = useRef<{
    appId: string;
    bounds: WindowBounds;
    route: DesktopRoute;
    historyState: unknown;
    targetSegment?: SurfaceSegment;
  } | null>(null);
  const layoutRef = useRef(layout);
  const wallpaperAssetRef = useRef<{ key: string; url: string } | null>(null);
  const entriesRef = useRef(entries);
  const routeRef = useRef<DesktopRoute | null>(null);
  const navigationReadyRef = useRef(false);
  const applyLocationRouteRef = useRef<(entriesValue?: DesktopEntry[], layoutValue?: DesktopLayout) => void>(() => undefined);
  const navigateRouteRef = useRef<(next: DesktopRoute, mode?: "push" | "replace", previousApps?: WindowTarget[]) => void>(() => undefined);
  const openRouteAppsRef = useRef<(next: DesktopRoute) => void>(() => undefined);
  const restoreHistoryAppsRef = useRef<(apps: WindowTarget[]) => void>(() => undefined);
  const restoreRunningAppsRef = useRef<(session: WindowSession, entries: DesktopEntry[]) => void>(() => undefined);
  const applyOpenQueryRef = useRef<(entries: DesktopEntry[], layout: DesktopLayout) => void>(() => undefined);
  const closeAppRef = useRef<(id: string, consultLifecycle?: boolean, syncRoute?: boolean) => Promise<boolean>>(async () => false);
  const settingsPageRef = useRef<AppHistorySettingsPage>("main");
  const fileLoadGenerationsRef = useRef<Record<string, number>>({});
  const layoutSaveRef = useRef<Promise<void>>(Promise.resolve());
  const layoutDraftRef = useRef<{ desktopId: string; layout: DesktopLayout } | null>(null);
  const contentRevisionsRef = useRef<Record<string, number>>({});
  const activeDesktopIdRef = useRef("");
  const desktopsRef = useRef<DesktopIdentity[]>([]);
  const activateDesktopRef = useRef<(desktopId: string) => Promise<boolean>>(async () => false);
  const activationQueueRef = useRef(createSerialTaskQueue());
  const activationGenerationRef = useRef(0);
  const fileDirtyRef = useRef<Record<string, boolean>>({});
  const appSnapshotRef = useRef<DesktopStateSnapshot | null>(null);
  const sandboxFullscreenBoundsRef = useRef(new Map<string, WindowBounds>());
  const windowSessionReadyRef = useRef(false);
  const windowSessionSaveRef = useRef<Promise<void>>(Promise.resolve());
  const updaterRef = useRef<PwaUpdater | null>(null);
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const persistenceRequestedRef = useRef(false);
  const restoredWindowBoundsRef = useRef(new Map<string, WindowBounds>());
  const pendingSystemRestoreRef = useRef<Array<Extract<WindowSession["apps"][number], { kind: "system" }>>>([]);
  const launchInstalledAppRef = useRef<(install: InstalledApp, target?: FileEntry | FolderEntry | "root", launchSource?: "launcher" | "file" | "restore") => Promise<void>>(async () => undefined);
  const canMutateRef = useRef(false);
  const offlineModelRef = useRef<ReturnType<typeof buildOfflineAvailability> | null>(null);
  const handleOpenRef = useRef<(entry: DesktopEntry) => void>(() => undefined);
  const chooseUploadRef = useRef<(parentId: string | null) => void>(() => undefined);
  const chooseFolderImportRef = useRef<(parentId: string | null) => Promise<void>>(async () => undefined);
  const makeAvailableOfflineRef = useRef<(ids: string[]) => Promise<void>>(async () => undefined);
  const unpinOfflineRef = useRef<(ids: string[]) => Promise<void>>(async () => undefined);
  const windowCommandRef = useRef<{ maximize: (id: string) => void; move: (id: string, direction: "left" | "right" | "up" | "down") => void }>({ maximize: () => {}, move: () => {} });
  const autoUpdateRef = useRef(true);
  const localPreferencesRef = useRef<LocalPreferences>({ autoUpdate: true, externalEmbeddedPreviews: false, allowBrowserPinchZoom: false, searchAllDesktops: false, onboardingVersion: 0, showDesktopMinimap: true, explorerView: "list" });
  const updatePreferenceLoadedRef = useRef(false);
  const manualUpdateCheckRef = useRef(false);
  const actionSheetHistoryRef = useRef<string | null>(null);
  const restoringHistoryRef = useRef(false);
  const activeSegment = { column: route?.column ?? 0, row: route?.row ?? 0 };
  areaTransitionRef.current = areaTransition;
  desktopSizeRef.current = desktopSize;
  desktopsRef.current = desktops;
  const routeExplorerFolderId = route?.explorerFolderId;
  const routeFileId = route?.fileId;
  const routePropertiesEntryId = route?.propertiesEntryId;
  const routeSettings = route?.settings;
  const activeDesktop = desktops.find((desktop) => desktop.id === activeDesktopId);
  const canMutate = canMutateDesktop(activeDesktop, syncStatus);
  canMutateRef.current = canMutate;
  const canManage = Boolean(activeDesktop?.capabilities.manage && syncStatus === "online");
  const canSettings = Boolean(activeDesktop?.capabilities.settings && canMutate);
  const canViewActivity = Boolean(activeDesktop?.capabilities.activity && syncStatus === "online");
  const canOpenTrash = Boolean(activeDesktop?.capabilities.write && syncStatus !== "local");
  const desktopSearchAvailable = session === null || session.capabilities.desktopSearch === "accessible-desktops-v1";
  const installState = pwaInstallState(installPrompt, pwaInstalled, isStandalone());
  const offlineSharedNotice = sharedOfflineMessage(activeDesktop, syncStatus);
  const syncIndicatorStatus = syncStatus === "online" && isSyncing ? "syncing" : syncStatus;
  const activeDesktopName = desktops.find((desktop) => desktop.id === activeDesktopId)?.name ?? "Desktop";
  const actionSheetOpen = isMobile && Boolean(contextMenu);
  const entryIndex = useMemo(() => createEntryIndex(entries), [entries]);
  const offlineModel = useMemo(
    () =>
      buildOfflineAvailability(
        entries,
        offlineInventory ?? {
          desktopId: activeDesktopId,
          pinIds: [],
          files: {},
          cachedBytes: 0,
          protectedBytes: 0,
          releasableBytes: 0,
          browserStorage: null,
        },
        { updatingIds: offlineProgress?.updatingIds, errors: offlineProgress?.errors },
      ),
    [activeDesktopId, entries, offlineInventory, offlineProgress],
  );
  offlineModelRef.current = offlineModel;
  const activeTheme = useMemo(() => resolveTheme(appearance), [appearance]);
  const iconMetrics = useMemo(() => themeIconMetrics(activeTheme), [activeTheme]);
  const rootEntries = entryIndex.roots;
  const responsive = useMemo(() => responsiveDesktop(entries, desktopSize, iconMetrics), [desktopSize, entries, iconMetrics]);
  const activeSegmentKey = segmentKey(activeSegment);
  const actualActiveSegment = responsive.segments.find((candidate) => candidate.key === activeSegmentKey);
  const occupiedSegments = useMemo(() => {
    const byKey = new Map(responsive.segments.map((segment) => [segment.key, segment]));
    for (const app of runningApps) {
      const segment = projectLogicalPosition(app.bounds, desktopSize).segment;
      const key = segmentKey(segment);
      if (!byKey.has(key)) byKey.set(key, { entries: [], key, segment });
    }
    return [...byKey.values()].sort((a, b) => a.segment.row - b.segment.row || a.segment.column - b.segment.column);
  }, [desktopSize, responsive.segments, runningApps]);
  const visibleSegments = (() => {
    const byKey = new Map(occupiedSegments.map((candidate) => [candidate.key, candidate]));
    const home: SurfaceSegment = { column: 0, row: 0 };
    if (!byKey.has(segmentKey(home))) byKey.set(segmentKey(home), { entries: [], key: segmentKey(home), segment: home });
    if (!byKey.has(activeSegmentKey)) byKey.set(activeSegmentKey, { entries: [], key: activeSegmentKey, segment: activeSegment });
    return [...byKey.values()].sort((a, b) => a.segment.row - b.segment.row || a.segment.column - b.segment.column);
  })();
  const visibleSegmentsByKey = new Map(visibleSegments.map((segment) => [segment.key, segment]));
  const minimapSegments = areaMapSegments(visibleSegments.map((segment) => segment.segment), activeSegment, minimapExpanded).map((segment) => {
    const key = segmentKey(segment);
    return visibleSegmentsByKey.get(key) ?? { entries: [], key, segment };
  });
  const minimapColumns = minimapSegments.map((candidate) => candidate.segment.column);
  const minimapRows = minimapSegments.map((candidate) => candidate.segment.row);
  const minimapMinColumn = Math.min(...minimapColumns);
  const minimapMinRow = Math.min(...minimapRows);
  const minimapColumnCount = Math.max(...minimapColumns) - minimapMinColumn + 1;
  const minimapRowCount = Math.max(...minimapRows) - minimapMinRow + 1;
  const minimapWindowLimit = minimapWindowCapacity(desktopSize.width, compactChrome);
  const minimapDetailed = minimapExpanded;
  const restingCamera = areaCameraPosition(activeSegment, desktopSize);
  const transitionSegmentKeys = new Set(areaTransition ? [segmentKey(areaTransition.source), segmentKey(areaTransition.target)] : []);
  const activeDesktopSegment = actualActiveSegment ?? { entries: [], key: activeSegmentKey, segment: activeSegment };
  const minimapWidth = minimapDetailed ? Math.min(760, desktopSize.width - 16) : 52;
  const minimapHeight = minimapDetailed ? Math.min(420, desktopSize.height * 0.56) : 68;
  const minimapObscured =
    !minimapExpanded &&
    activeDesktopSegment.entries.some((entry) => {
      const position = responsive.positions.get(entry.id) ?? entry.position;
      return position.x + iconMetrics.width > desktopSize.width - minimapWidth && position.y + iconMetrics.height > desktopSize.height - minimapHeight;
    });
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEntries = selectedIds.map((id) => entryIndex.byId.get(id)).filter((entry): entry is DesktopEntry => Boolean(entry));
  const focusedExplorer = runningApps.find((app): app is ExplorerApp => app.id === focusedAppId && app.kind === "explorer");
  const mobileFileSurface = focusedExplorer?.id ?? "desktop";
  const mobileFileSelection = selectionScope === mobileFileSurface ? selectedEntries : [];
  const mobileSelectionMode = mobileMultiSelectScope === mobileFileSurface && selectionScope === mobileFileSurface;
  const showMobileSelectionToolbar = isMobile && (!focusedAppId || Boolean(focusedExplorer)) && !contextMenu && Boolean(activeDesktopId) && mobileFileSelection.length > 0;
  const showMobilePasteToolbar = isMobile && (!focusedAppId || Boolean(focusedExplorer)) && !contextMenu && Boolean(activeDesktopId) && canMutate && mobileFileSelection.length === 0 && Boolean(clipboardOffer && !clipboardOffer.dismissed);
  const dialogEntry = dialog?.type === "rename" ? (entryIndex.byId.get(dialog.entryId) ?? null) : dialog?.type === "delete" ? (entryIndex.byId.get(dialog.entryIds[0]) ?? null) : null;
  const contextMenuEntry = contextMenu?.type === "entry" ? (entryIndex.byId.get(contextMenu.entryId) ?? null) : null;
  const contextMenuEntries = contextMenuEntry && selectedIdSet.has(contextMenuEntry.id) ? selectedEntries : contextMenuEntry ? [contextMenuEntry] : [];
  const moveDialogEntries = moveDialogEntryIds.map((id) => entryIndex.byId.get(id)).filter((entry): entry is DesktopEntry => Boolean(entry));
  const shortcutsSuspended = Boolean(dialog || pendingPaste || moveDialogEntryIds.length || activePanel || sharingOpen || confirmation || contextMenu || appDialogRequests.length);

  useEffect(() => {
    if (!minimapExpanded) return;
    const frame = window.requestAnimationFrame(() => {
      areaSwitcherRef.current?.querySelector<HTMLButtonElement>('.desktop-minimap__area[aria-current="true"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [minimapExpanded]);

  useEffect(() => {
    if (minimapExpanded || !areaSwitcherRestoreFocusRef.current) return;
    areaSwitcherRestoreFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => areaSwitcherHandleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeSegmentKey, minimapExpanded]);

  useEffect(() => {
    if (!minimapExpanded) return;
    let timer: number | null = null;
    const dismissForFrameFocus = () => {
      timer = window.setTimeout(() => {
        if (!(document.activeElement instanceof HTMLIFrameElement) || areaSwitcherRef.current?.contains(document.activeElement)) return;
        areaSwitcherInternalActivationRef.current = false;
        setMinimapExpanded(false);
      }, 0);
    };
    window.addEventListener("blur", dismissForFrameFocus, true);
    return () => {
      window.removeEventListener("blur", dismissForFrameFocus, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [minimapExpanded]);

  useEffect(() => {
    appTheme.set(activeTheme);
    const tokens = mapThemeTokens(activeTheme);
    for (const app of runningAppsRef.current) if (app.kind === "sandbox") app.dispatcher.emit("theme.changed", tokens);
  }, [activeTheme, appTheme, runningAppsRef]);

  useEffect(() => {
    persistClipboardOffer(typeof sessionStorage === "undefined" ? null : sessionStorage, clipboardOffer);
  }, [clipboardOffer]);

  useEffect(() => {
    let cancelled = false;
    async function inspectClipboard() {
      if (!navigator.clipboard?.read || !navigator.permissions?.query) return;
      try {
        const permission = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
        if (permission.state !== "granted") return;
        const item = (await navigator.clipboard.read()).find((candidate) => candidate.types.some(isClipboardArchiveType));
        if (!item) return;
        const snapshot = await decodeClipboardArchiveItem(item);
        if (cancelled) return;
        clipboardRef.current = snapshot;
        setClipboardOffer((current) => observeClipboardOffer(current, clipboardSnapshotIdentity(snapshot)));
      } catch {
        /* Clipboard inspection is best-effort and must never request access. */
      }
    }
    function inspectWhenVisible() {
      if (document.visibilityState === "visible") void inspectClipboard();
    }
    void inspectClipboard();
    window.addEventListener("focus", inspectClipboard);
    document.addEventListener("visibilitychange", inspectWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", inspectClipboard);
      document.removeEventListener("visibilitychange", inspectWhenVisible);
    };
  }, []);

  useEffect(
    () =>
      appLifecycle.subscribe((owner, state) => {
        fileDirtyRef.current[owner.instanceId] = state.dirty;
        setDirtyAppIds((current) => {
          if (current.has(owner.instanceId) === state.dirty) return current;
          const next = new Set(current);
          if (state.dirty) next.add(owner.instanceId);
          else next.delete(owner.instanceId);
          return next;
        });
        updateRunningApps((current) =>
          current.map((app) => {
            if (app.id !== owner.instanceId || app.kind !== "sandbox") return app;
            app.dispatcher.emit("window.stateChanged", { focused: state.focused, maximized: state.maximized, fullscreen: state.fullscreen, width: state.width, height: state.height });
            let bounds = { ...app.bounds, width: state.width, height: state.height };
            if (state.fullscreen) {
              if (!sandboxFullscreenBoundsRef.current.has(app.id)) sandboxFullscreenBoundsRef.current.set(app.id, app.bounds);
              const segment = projectLogicalPosition(app.bounds, desktopSizeRef.current).segment;
              bounds = { ...restoreLogicalPosition({ x: 0, y: 0 }, segment, desktopSizeRef.current), ...desktopSizeRef.current };
            } else {
              bounds = sandboxFullscreenBoundsRef.current.get(app.id) ?? bounds;
              sandboxFullscreenBoundsRef.current.delete(app.id);
            }
            return { ...app, title: state.title, bounds };
          }),
        );
      }),
    [appLifecycle, updateRunningApps],
  );

  useEffect(() => {
    for (const app of runningAppsRef.current) {
      if (app.kind !== "sandbox") continue;
      appCapabilities.setInstanceMutationAllowed(app.id, canMutate);
      app.dispatcher.emit("capabilities.changed", { files: fileWriteCapability(activeDesktop, syncStatus), externalEmbeddedPreviews: externalEmbeddedPreviews === true });
    }
  }, [activeDesktop, appCapabilities, canMutate, externalEmbeddedPreviews, runningAppsRef, syncStatus]);
  useEffect(() => {
    if (!canViewActivity && settingsPage === "activity") {
      const current = window.history.state;
      if (historySettingsPage(current) === "activity") window.history.back();
      else {
        settingsPageRef.current = "main";
        setSettingsPage("main");
      }
    }
  }, [canViewActivity, settingsPage]);
  useEffect(() => {
    if (!loading && preferencesLoaded && localPreferencesRef.current.onboardingVersion < ONBOARDING_VERSION) setShowGettingStarted(true);
  }, [loading, preferencesLoaded]);
  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installed = () => {
      setPwaInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  function setCurrentRoute(next: DesktopRoute) {
    routeRef.current = next;
    setRoute(next);
  }

  function requestConfirmation(request: ConfirmationRequest) {
    confirmationResolverRef.current?.(false);
    setConfirmation(request);
    return new Promise<boolean>((resolve) => {
      confirmationResolverRef.current = resolve;
    });
  }

  function resolveConfirmation(confirmed: boolean) {
    const resolve = confirmationResolverRef.current;
    confirmationResolverRef.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  }

  function selectEntry(surface: string, entry: DesktopEntry, options: { toggle?: boolean; range?: boolean; orderedIds?: string[] } = {}) {
    selectEntryId(surface, entry.id, options);
  }

  function addEntryToSelection(surface: string, entry: DesktopEntry) {
    addEntryIdToSelection(surface, entry.id);
  }

  const runningAppTargets = useCallback((apps = runningAppsRef.current): WindowTarget[] => {
    return projectRunningAppTargets(apps);
  }, [runningAppsRef]);

  const runningAppIds = useCallback((apps = runningAppsRef.current) => {
    return projectRunningAppIds(apps);
  }, [runningAppsRef]);

  function historyApps(state: unknown) {
    return parseRunningAppHistory(state);
  }

  function routeHistoryState(apps: WindowTarget[], parentHash?: string, instances = runningAppIds(), page = settingsPageRef.current): RouteHistoryState {
    return createRouteHistoryState(apps, instances, page, parentHash);
  }

  function writeRoute(next: DesktopRoute, mode: "push" | "replace" = "push", previousApps?: WindowTarget[]) {
    const hash = formatDesktopRoute(next);
    if (mode === "push" && hash !== window.location.hash) {
      const current = window.history.state as Partial<RouteHistoryState> | null;
      const previousInstances = current?.hiraya ? historyInstanceIds(current, (previousApps ?? runningAppTargets()).map(builtinAppTargetId)) : (previousApps ?? runningAppTargets()).map(builtinAppTargetId);
      window.history.replaceState(routeHistoryState(previousApps ?? runningAppTargets(), current?.hiraya ? current.parentHash : undefined, previousInstances), "", window.location.href);
      window.history.pushState(routeHistoryState(runningAppTargets(), window.location.hash), "", hash);
    } else if (mode === "replace" || hash !== window.location.hash) {
      const current = window.history.state as Partial<RouteHistoryState> | null;
      window.history.replaceState(routeHistoryState(runningAppTargets(), current?.hiraya ? current.parentHash : undefined), "", hash);
    }
    setCurrentRoute(next);
  }

  function applyLocationRoute(entriesValue = entriesRef.current, layoutValue = layoutRef.current) {
    if (!navigationReadyRef.current) return;
    void layoutValue;
    const normalized = normalizeDesktopRoute(parseDesktopRoute(window.location.hash), entriesValue, activeDesktopIdRef.current);
    if (!normalized) return;
    const canonicalHash = formatDesktopRoute(normalized);
    if (canonicalHash !== window.location.hash) writeRoute(normalized, "replace");
    else setCurrentRoute(normalized);
  }

  function navigateRoute(next: DesktopRoute, mode: "push" | "replace" = "push", previousApps?: WindowTarget[]) {
    const normalized = normalizeDesktopRoute(next, entriesRef.current, activeDesktopIdRef.current);
    if (normalized) writeRoute(normalized, mode, previousApps);
  }

  function navigateSettingsPage(next: AppHistorySettingsPage) {
    const previous = settingsPageRef.current;
    if (next === previous) return;
    const current = window.history.state as Partial<RouteHistoryState> | null;
    if (next !== "main" && previous === "main" && current?.hiraya) {
      window.history.replaceState(routeHistoryState(runningAppTargets(), current.parentHash, runningAppIds(), "main"), "", window.location.href);
      window.history.pushState(routeHistoryState(runningAppTargets(), window.location.hash, runningAppIds(), next), "", window.location.href);
    } else if (next === "main" && current?.hiraya && historySettingsPage(current) !== "main") {
      window.history.back();
      return;
    }
    settingsPageRef.current = next;
    setSettingsPage(next);
  }

  function routeForApp(app: RunningApp | null, current: DesktopRoute): DesktopRoute {
    return routeForRunningApp(app, current, activeDesktopIdRef.current);
  }

  function segmentForApp(app: RunningApp, size = desktopSize) {
    return runningAppSegment(app, size);
  }

  function appIsInSegment(app: RunningApp, segment: SurfaceSegment, size = desktopSize) {
    return runningAppIsInSegment(app, segment, size);
  }

  function topAppInSegment(apps: RunningApp[], segment: SurfaceSegment, excludedId?: string) {
    return topRunningAppInSegment(apps, segment, desktopSize, excludedId);
  }

  function focusApp(id: string, syncRoute = true) {
    const target = runningAppsRef.current.find((app) => app.id === id);
    if (!target) return;
    const zIndex = nextWindowZIndex();
    updateRunningApps((current) => current.map((app) => (app.id === id ? { ...app, minimized: false, zIndex } : app)));
    for (const app of runningAppsRef.current) if (app.kind === "sandbox") appLifecycle.setHostState({ appId: app.package.manifest.id, instanceId: app.id }, { focused: app.id === id });
    setFocusedApp(id);
    const currentRoute = routeRef.current;
    if (syncRoute && currentRoute) goToSegment(segmentForApp(target), "replace", { ...target, minimized: false, zIndex });
  }

  function closeApp(id: string, syncRoute = true) {
    if (id === builtinAppTargetId({ kind: "settings" })) {
      settingsPageRef.current = "main";
      setSettingsPage("main");
    }
    delete fileDirtyRef.current[id];
    setDirtyAppIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    delete fileLoadGenerationsRef.current[id];
    sandboxFullscreenBoundsRef.current.delete(id);
    const closing = runningAppsRef.current.find((app) => app.id === id);
    if (closing?.kind === "sandbox") {
      closing.dispatcher.dispose();
      closing.files.close();
      appCapabilities.revokeInstance(id);
    }
    const remaining = runningAppsRef.current.filter((app) => app.id !== id);
    updateRunningApps(remaining);
    if (focusedAppIdRef.current === id) {
      const next = topAppInSegment(remaining, activeSegment);
      setFocusedApp(next?.id ?? null);
      const currentRoute = routeRef.current;
      if (syncRoute && !restoringHistoryRef.current && currentRoute) navigateRoute(routeForApp(next, currentRoute), "replace");
    }
  }

  async function requestCloseApp(id: string, consultLifecycle = true, syncRoute = true): Promise<boolean> {
    const target = runningAppsRef.current.find((app) => app.id === id);
    if (!target) return true;
    if (target.kind === "sandbox" && consultLifecycle) {
      return appLifecycle.requestClose({ appId: target.package.manifest.id, instanceId: target.id });
    }
    const dirty = target.kind === "sandbox" ? dirtyAppIds.has(id) || appLifecycle.snapshot({ appId: target.package.manifest.id, instanceId: target.id }).dirty : Boolean(fileDirtyRef.current[id]);
    return closeWithDirtyCheck({
      dirty,
      confirmDiscard: () => requestConfirmation({ title: "Discard unsaved changes?", message: target.kind === "sandbox" ? "Close this app and discard its unsaved changes?" : "Close this file and discard its unsaved editor changes?", confirmLabel: "Discard and close", danger: true }),
      close: () => closeApp(id, syncRoute),
    });
  }

  function minimizeApp(id: string) {
    const target = runningAppsRef.current.find((app) => app.id === id);
    if (target?.kind === "sandbox") appLifecycle.setHostState({ appId: target.package.manifest.id, instanceId: target.id }, { focused: false });
    updateRunningApps((current) => current.map((app) => (app.id === id ? { ...app, minimized: true } : app)));
    if (focusedAppIdRef.current === id) {
      const next = topAppInSegment(runningAppsRef.current, activeSegment, id);
      setFocusedApp(next?.id ?? null);
      const currentRoute = routeRef.current;
      if (currentRoute) navigateRoute(routeForApp(next, currentRoute), "replace");
    }
  }

  function updateAppBounds(id: string, bounds: WindowBounds) {
    const target = runningAppsRef.current.find((app) => app.id === id);
    if (target?.kind === "sandbox") appLifecycle.setHostState({ appId: target.package.manifest.id, instanceId: target.id }, { width: Math.round(bounds.width), height: Math.round(bounds.height) });
    updateRunningApps((current) =>
      current.map((app) =>
        app.id === id
          ? {
              ...app,
              bounds: { ...bounds, ...restoreLogicalPosition(bounds, segmentForApp(app), desktopSize) },
            }
          : app,
      ),
    );
  }

  function createAppBase(id: string, kind: RunningApp["kind"], index?: number, segment = activeSegment): BaseRunningApp {
    const staggerIndex = index ?? runningAppsRef.current.filter((app) => appIsInSegment(app, segment)).length;
    const { width, height, minWidth, minHeight } = kind === "sandbox" ? { width: 820, height: 620, minWidth: 360, minHeight: 260 } : builtinAppWindow(kind);
    const localBounds = initialWindowBounds(desktopSize, { width, height, minWidth, minHeight, index: staggerIndex });
    return {
      id,
      bounds: { ...localBounds, ...restoreLogicalPosition(localBounds, segment, desktopSize) },
      minimized: false,
      zIndex: nextWindowZIndex(),
    };
  }

  function loadFileApp(id: string, file: FileEntry, expectedRevision: number) {
    const generation = (fileLoadGenerationsRef.current[id] ?? 0) + 1;
    fileLoadGenerationsRef.current[id] = generation;
    updateRunningApps((current) => current.map((candidate) => (candidate.id === id && candidate.kind === "file" ? { ...candidate, blob: undefined, loadError: undefined } : candidate)));
    void readFile(file.id)
      .then((blob) => {
        if (fileLoadGenerationsRef.current[id] !== generation || !runningAppsRef.current.some((candidate) => candidate.id === id)) return;
        updateRunningApps((current) =>
          current.map((candidate) =>
            candidate.id === id && candidate.kind === "file"
              ? {
                  ...candidate,
                  blob,
                  loadError: undefined,
                  editable: fileCapabilities(file).editable,
                  contentRevision: expectedRevision,
                }
              : candidate,
          ),
        );
        void loadOfflineInventory().catch(() => undefined);
      })
      .catch((openError) => {
        if (fileLoadGenerationsRef.current[id] !== generation) return;
        updateRunningApps((current) =>
          current.map((candidate) =>
            candidate.id === id && candidate.kind === "file"
              ? {
                  ...candidate,
                  loadError: openError instanceof Error ? openError.message : "The file could not be opened.",
                }
              : candidate,
          ),
        );
      });
  }

  function restoreRunningApps(session: WindowSession, loadedEntries: DesktopEntry[]) {
    const byId = new Map(loadedEntries.map((entry) => [entry.id, entry]));
    const restoredRoute = routeRef.current ?? normalizeDesktopRoute(parseDesktopRoute(window.location.hash), loadedEntries, activeDesktopIdRef.current);
    const savedApps = restoreWindowSession(session, loadedEntries, restoredRoute, desktopSize);
    pendingSystemRestoreRef.current = savedApps.flatMap((saved): Array<Extract<WindowSession["apps"][number], { kind: "system" }>> => {
      if (saved.kind === "system") return [saved];
      if (saved.kind === "file") {
        const file = byId.get(saved.fileId);
        return file?.kind === "file" ? [{ ...saved, kind: "system", appId: systemDefaultAppId(file), targetKind: "file", entryId: file.id }] : [];
      }
      return [];
    });
    const restored = savedApps
      .filter((saved) => saved.kind !== "system" && saved.kind !== "file")
      .map((saved): RunningApp => {
        if (saved.kind === "settings") return { ...saved, id: builtinAppTargetId(saved) };
        return { ...saved, id: builtinAppTargetId(saved) };
      });
    setNextWindowZIndex(Math.max(1, ...restored.map((app) => app.zIndex)));
    updateRunningApps(restored);
    setFocusedApp(null);
  }

  useEffect(() => {
    if (!installedApps.length || !pendingSystemRestoreRef.current.length) return;
    const pending = pendingSystemRestoreRef.current;
    pendingSystemRestoreRef.current = [];
    for (const saved of pending) {
      const target = saved.targetKind === "root" ? "root" : entriesRef.current.find((entry) => entry.id === saved.entryId && entry.kind === saved.targetKind);
      if (!target) continue;
      const current = target !== "root" && target.kind === "file" ? resolveRestoredFileApp(target, installedApps, entriesRef.current, fileAssociations, saved) : null;
      const install = current?.app ?? installedApps.find((app) => app.appId === saved.appId);
      const identityMatches = target === "root" || target.kind !== "file" ? Boolean(install && installedAppMatchesSavedIdentity(install, saved)) : Boolean(current);
      if (!install || !installedAppIsAvailable(install, entriesRef.current) || !identityMatches) {
        setNotice(`The saved handler ${saved.appId} is unavailable or changed. Open the item again to choose an available app.`);
        continue;
      }
      if (current?.app.appId !== saved.appId) setNotice(`The saved handler ${saved.appId} is unavailable or no longer preferred. Restored with ${install.manifest.name}.`);
      else if (current?.preferredUnavailable) setNotice(`Your preferred app for ${current.preferredUnavailable.matcher} is unavailable. Restored with ${install.manifest.name}.`);
      const restoredTarget: SystemAppTarget = { ...saved, appId: install.appId, source: install.source, digest: install.digest, permissions: [...install.manifest.permissions] };
      void launchInstalledAppRef.current(install, target, "restore").then(() => updateRunningApps((apps) => apps.map((app) => (app.id === builtinAppTargetId(restoredTarget) ? { ...app, bounds: saved.bounds, minimized: saved.minimized, zIndex: saved.zIndex } : app))));
    }
  }, [fileAssociations, installedApps, updateRunningApps]);

  function restoreHistoryApps(targets: WindowTarget[]) {
    const historySegment = normalizeDesktopRoute(parseDesktopRoute(window.location.hash), entriesRef.current, activeDesktopIdRef.current);
    const existing = new Map(runningAppsRef.current.map((app) => [app.id, app]));
    const restored: RunningApp[] = [];
    const filesToLoad: FileApp[] = [];
    for (const target of targets) {
      const id = builtinAppTargetId(target);
      const current = existing.get(id);
      if (current) continue;
      if (target.kind === "settings") {
        restored.push({ ...createAppBase(id, target.kind, runningAppsRef.current.length + restored.length, historySegment), kind: "settings" });
        continue;
      }
      if (target.kind === "explorer") {
        openExplorerWindow(target.folderId, false, false);
        continue;
      }
      if (target.kind === "properties") {
        if (!entriesRef.current.some((entry) => entry.id === target.entryId)) continue;
        restored.push({ ...createAppBase(id, target.kind, runningAppsRef.current.length + restored.length, historySegment), kind: "properties", entryId: target.entryId });
        continue;
      }
      if (target.kind === "system") {
        const launchTarget = target.targetKind === "root" ? "root" : entriesRef.current.find((entry) => entry.id === target.entryId && entry.kind === target.targetKind);
        const current = launchTarget !== "root" && launchTarget?.kind === "file" ? resolveRestoredFileApp(launchTarget, installedApps, entriesRef.current, fileAssociations, target) : null;
        const install = current?.app ?? installedApps.find((app) => app.appId === target.appId);
        const identityMatches = launchTarget === "root" || launchTarget?.kind !== "file" ? Boolean(install && installedAppMatchesSavedIdentity(install, target)) : Boolean(current);
        if (install && launchTarget && identityMatches && installedAppIsAvailable(install, entriesRef.current)) {
          if (current?.app.appId !== target.appId) setNotice(`The saved handler ${target.appId} is unavailable or no longer preferred. Restored with ${install.manifest.name}.`);
          else if (current?.preferredUnavailable) setNotice(`Your preferred app for ${current.preferredUnavailable.matcher} is unavailable. Restored with ${install.manifest.name}.`);
          void launchInstalledApp(install, launchTarget, "restore");
        } else setNotice(`The saved handler ${target.appId} is unavailable or changed. Open the item again to choose an available app.`);
        continue;
      }
      const file = entriesRef.current.find((entry): entry is FileEntry => entry.id === target.fileId && entry.kind === "file");
      if (!file) continue;
      const resolution = resolveFileApp(file, installedApps, entriesRef.current, fileAssociations);
      if (resolution) void launchInstalledAppRef.current(resolution.app, file, "restore");
    }
    updateRunningApps([...runningAppsRef.current, ...restored]);
    for (const app of filesToLoad) loadFileApp(app.id, app.file!, app.contentRevision);
  }

  function applyOpenQuery(loadedEntries: DesktopEntry[], loadedLayout: DesktopLayout) {
    void loadedLayout;
    const url = new URL(window.location.href);
    const openPath = url.searchParams.get("open");
    if (openPath === null) {
      applyLocationRouteRef.current(loadedEntries, loadedLayout);
      return;
    }
    try {
      const file = resolveOpenFilePath(loadedEntries, openPath);
      const current = normalizeDesktopRoute(parseDesktopRoute(url.hash), loadedEntries, activeDesktopIdRef.current);
      const next: DesktopRoute = {
        desktopId: current.desktopId ?? activeDesktopIdRef.current,
        column: current.column,
        row: current.row,
        ...(current.explorerFolderId !== undefined ? { explorerFolderId: current.explorerFolderId } : {}),
        fileId: file.id,
      };
      url.searchParams.delete("open");
      url.hash = formatDesktopRoute(next);
      window.history.replaceState(window.history.state, "", url);
      setCurrentRoute(next);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : `No file exists at “${openPath}”.`);
      applyLocationRouteRef.current(loadedEntries, loadedLayout);
    }
  }

  restoreRunningAppsRef.current = restoreRunningApps;
  restoreHistoryAppsRef.current = restoreHistoryApps;
  applyOpenQueryRef.current = applyOpenQuery;

  applyLocationRouteRef.current = applyLocationRoute;
  navigateRouteRef.current = navigateRoute;
  openRouteAppsRef.current = (next) => {
    if (next.explorerFolderId !== undefined) openExplorerWindow(next.explorerFolderId, false, !next.fileId && !next.propertiesEntryId && !next.settings);
    if (next.fileId) {
      const fileId = next.fileId;
      const entry = entryIndex.byId.get(fileId);
      const openApp = runningAppsRef.current.find((app) => {
        const target = app.kind === "sandbox" && app.systemTarget ? app.systemTarget : extractBuiltinAppTarget(app);
        return target ? builtinAppTargetOpensFile(target, fileId) : false;
      });
      if (openApp) focusApp(openApp.id, false);
      const resolution = entry?.kind === "file" && !openApp ? resolveFileApp(entry, installedApps, entriesRef.current, fileAssociations) : null;
      if (entry?.kind === "file" && resolution) void launchInstalledApp(resolution.app, entry, "restore");
    }
    if (next.propertiesEntryId && entryIndex.byId.has(next.propertiesEntryId)) openPropertiesWindow(next.propertiesEntryId, false);
    if (next.settings) openSettingsWindow(false);
    if (next.explorerFolderId === undefined && !next.fileId && !next.propertiesEntryId && !next.settings) setFocusedApp(null);
  };
  closeAppRef.current = requestCloseApp;

  useEffect(() => {
    let active = true;
    let sessionRestoreStarted = false;
    let savedWindowSession: Promise<{ session: WindowSession; loaded: true } | { session: null; loaded: false }> | null = null;
    const restoreSavedWindowSession = () => {
      if (sessionRestoreStarted || !savedWindowSession) return;
      sessionRestoreStarted = true;
      void savedWindowSession.then((result) => {
        if (!active) return;
        if (result.loaded) {
          restoreRunningAppsRef.current(result.session, entriesRef.current);
          const routedApps = historyApps(window.history.state);
          if (routedApps) restoreHistoryAppsRef.current(routedApps);
          windowSessionReadyRef.current = true;
        } else {
          setError("The saved app session could not be loaded.");
        }
        setWindowSessionRestored(true);
        setLoading(false);
      });
    };
    const unsubscribe = subscribeToSync(
      (synced) => {
        if (!active) return;
        const previousSnapshot = appSnapshotRef.current;
        const changedEntryIds = previousSnapshot
          ? new Set([
              ...synced.entries
                .filter((entry) => {
                  const previous = previousSnapshot.entries.find((candidate) => candidate.id === entry.id);
                  return !previous || previous.modifiedAt !== entry.modifiedAt || previous.name !== entry.name || previous.parentId !== entry.parentId || previous.kind !== entry.kind || (entry.kind === "file" && previous.kind === "file" && (previous.size !== entry.size || previous.mimeType !== entry.mimeType || previousSnapshot.sync.contentRevisions[entry.id] !== synced.sync.contentRevisions[entry.id]));
                })
                .map((entry) => entry.id),
              ...previousSnapshot.entries.filter((entry) => !synced.entries.some((candidate) => candidate.id === entry.id)).map((entry) => entry.id),
            ])
          : new Set<string>();
        contentRevisionsRef.current = synced.sync.contentRevisions;
        layoutRef.current = synced.layout;
        entriesRef.current = synced.entries;
        setLayout(synced.layout);
        setEntries(synced.entries);
        setAppearance(synced.appearance);
        const syncedIds = new Set(synced.entries.map((entry) => entry.id));
        appSnapshotRef.current = synced;
        if (changedEntryIds.size) for (const app of runningAppsRef.current) if (app.kind === "sandbox") app.dispatcher.emit("files.changed", app.files.changedPayload(changedEntryIds));
        retainSelection(syncedIds);
        setContextMenu((current) => (current?.type === "entry" && !syncedIds.has(current.entryId) ? null : current));
        setMoveDialogEntryIds((current) => current.filter((id) => syncedIds.has(id)));
        setDialog((current) => {
          if (!current) return null;
          if (current.type === "create-file" || current.type === "create-folder") {
            return current.parentId && !synced.entries.some((entry) => entry.id === current.parentId && entry.kind === "folder") ? null : current;
          }
          return current.type === "rename" ? (syncedIds.has(current.entryId) ? current : null) : current.entryIds.some((id) => syncedIds.has(id)) ? { ...current, entryIds: current.entryIds.filter((id) => syncedIds.has(id)) } : null;
        });
        const availableApps = runningAppsRef.current.filter((app) => {
          if (app.kind === "sandbox") {
            if (app.systemTarget?.entryId) return syncedIds.has(app.systemTarget.entryId);
            return app.install.source === "system" || syncedIds.has(app.packageEntryId!);
          }
          const dependency = builtinAppEntryDependency(app);
          return !dependency || syncedIds.has(dependency.entryId);
        });
        for (const app of runningAppsRef.current) if (app.kind === "sandbox" && !availableApps.includes(app)) app.dispatcher.dispose();
        updateRunningApps(availableApps);
        if (focusedAppIdRef.current && !availableApps.some((app) => app.id === focusedAppIdRef.current)) {
          const currentRoute = routeRef.current;
          const next = topRunningAppInSegment(availableApps, currentRoute ?? { column: 0, row: 0 }, desktopSizeRef.current);
          setFocusedApp(next?.id ?? null);
        }
        navigationReadyRef.current = true;
        applyLocationRouteRef.current(synced.entries, synced.layout);
        void loadOfflineInventory().catch(() => undefined);
        setLoading(false);
        restoreSavedWindowSession();
      },
      (nextStatus) => {
        if (!active) return;
        setSyncStatus(nextStatus);
        if (nextStatus === "online") setLastSyncedAt(Date.now());
      },
      (syncing) => {
        if (active) setIsSyncing(syncing);
      },
    );
    const unsubscribeOutbox = subscribeToOutbox((records) => {
      if (active) setOutboxRecords([...records]);
    });
    const unsubscribeOffline = subscribeToOfflineStorage(
      (inventory) => {
        if (active && inventory.desktopId === activeDesktopIdRef.current) setOfflineInventory(inventory);
      },
      (progress) => {
        if (active && (!progress || progress.desktopId === activeDesktopIdRef.current)) setOfflineProgress(progress);
      },
    );
    const unsubscribeCatalog = subscribeToDesktopCatalog((registry) => {
      if (!active) return;
      desktopsRef.current = registry.desktops;
      setDesktops(registry.desktops);
      setCatalogQuota(registry.quota);
      const retainedIds = registry.desktops.map((desktop) => desktop.id);
      if (activeDesktopIdRef.current && !retainedIds.includes(activeDesktopIdRef.current)) {
        const fallback = registry.desktops[0];
        if (fallback)
          void activateDesktopRef.current(fallback.id).then((switched) => {
            if (switched) return pruneLocalDesktops(retainedIds);
          });
      } else {
        void pruneLocalDesktops(retainedIds);
      }
    });
    void listDesktops(seededDesktop)
      .then((registry) => {
        if (!active) throw new DOMException("Desktop loading was stopped.", "AbortError");
        const routeDesktopId = parseDesktopRoute(window.location.hash)?.desktopId;
        const desktopId = routeDesktopId && registry.desktops.some((desktop) => desktop.id === routeDesktopId) ? routeDesktopId : registry.activeDesktopId && registry.desktops.some((desktop) => desktop.id === registry.activeDesktopId) ? registry.activeDesktopId : registry.desktops[0].id;
        setDesktops(registry.desktops);
        setCatalogQuota(registry.quota);
        activeDesktopIdRef.current = desktopId;
        setActiveDesktopId(desktopId);
        return switchLocalDesktop(desktopId)
          .then(() => pruneLocalDesktops(registry.desktops.map((desktop) => desktop.id)))
          .then(() => {
            const initialization = initializeDesktop(desktopId, { x: window.innerWidth, y: Math.max(1, window.innerHeight - 44) }, seededDesktop);
            savedWindowSession = readWindowSession(desktopId).then(
              (session) => ({ session, loaded: true as const }),
              () => ({ session: null, loaded: false as const }),
            );
            return initialization;
          });
      })
      .then(({ desktop: loadedDesktop, status: loadedStatus }) => {
        if (!active) return;
        const { entries: loadedEntries, layout: loadedLayout, appearance: loadedAppearance, sync } = loadedDesktop;
        contentRevisionsRef.current = sync.contentRevisions;
        appSnapshotRef.current = loadedDesktop;
        layoutRef.current = loadedLayout;
        entriesRef.current = loadedEntries;
        setLayout(loadedLayout);
        setEntries(loadedEntries);
        setAppearance(loadedAppearance);
        setSyncStatus(loadedStatus);
        setLoading(false);
        void loadOfflineInventory().catch(() => undefined);
        restoreSavedWindowSession();
        const routedApps = historyApps(window.history.state);
        if (routedApps) restoreHistoryAppsRef.current(routedApps);
        setRouteHistoryReady(true);
        navigationReadyRef.current = true;
        applyOpenQueryRef.current(loadedEntries, loadedLayout);
      })
      .catch((loadError) => {
        if (active && !(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "Your files could not be loaded.");
        }
        if (active && !sessionRestoreStarted) {
          setWindowSessionRestored(true);
          setLoading(false);
        }
        if (active) setRouteHistoryReady(true);
      });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeOutbox();
      unsubscribeOffline();
      unsubscribeCatalog();
      void stopDesktopSync();
    };
  }, [focusedAppIdRef, retainSelection, runningAppsRef, setFocusedApp, updateRunningApps]);

  useEffect(() => () => confirmationResolverRef.current?.(false), []);

  useEffect(() => {
    if (activePanel !== "sync") return;
    if (!persistenceRequestedRef.current) {
      persistenceRequestedRef.current = true;
      void requestStoragePersistence().then(setStoragePersistence);
    }
    let active = true;
    void listOutboxRecords()
      .then((records) => {
        if (active) setOutboxRecords(records);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "The synchronization queue could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [activePanel]);

  useEffect(() => {
    if (activePanel !== "offline" || !activeDesktopId) return;
    void loadOfflineInventory().catch((reason) => setError(reason instanceof Error ? reason.message : "Offline storage could not be loaded."));
  }, [activeDesktopId, activePanel]);

  useEffect(() => {
    if (activePanel !== "search") return;
    let active = true;
    void Promise.all(desktops.map(async (desktop) => localSearchResults(desktop, desktop.id === activeDesktopId ? entriesRef.current : await readDesktopEntries(desktop.id), desktop.id !== activeDesktopId)))
      .then((results) => {
        if (active) setCachedSearchResults(results.flat());
      })
      .catch(() => {
        if (active) setCachedSearchResults(activeDesktop ? localSearchResults(activeDesktop, entriesRef.current, false) : []);
      });
    return () => {
      active = false;
    };
  }, [activeDesktop, activeDesktopId, activePanel, desktops]);

  useEffect(() => {
    if (!moveDialogEntryIds.length || !activeDesktopId) return;
    let active = true;
    setDesktopMoveFolders({});
    setMoveDestinationsLoading(true);
    void Promise.all(desktops.map(async (desktop) => [desktop.id, desktop.id === activeDesktopId ? entriesRef.current : await readDesktopEntries(desktop.id)] as const))
      .then((values) => {
        if (active) setDesktopMoveFolders(Object.fromEntries(values));
      })
      .catch(() => {
        if (active) setError("Desktop destinations could not be loaded. Close and reopen Move to retry.");
      })
      .finally(() => {
        if (active) setMoveDestinationsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeDesktopId, desktops, moveDialogEntryIds.length]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!Object.values(fileDirtyRef.current).some(Boolean)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  useEffect(() => {
    if (syncStatus !== "online" || serverBuildTimestamp) return;
    let active = true;
    void fetchServerBuildTimestamp()
      .then((timestamp) => {
        if (active) setServerBuildTimestamp(timestamp);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [serverBuildTimestamp, syncStatus]);

  useEffect(() => {
    if (windowSessionReadyRef.current) {
      const session = createWindowSession(runningApps);
      windowSessionSaveRef.current = windowSessionSaveRef.current
        .then(() => saveWindowSession(activeDesktopIdRef.current, session))
        .catch(() => {
          setError("The open app session could not be saved.");
        });
    }
    if (navigationReadyRef.current && windowSessionRestored && routeHistoryReady) {
      const current = window.history.state as Partial<RouteHistoryState> | null;
      window.history.replaceState({
        hiraya: true,
        schemaVersion: 1,
        ...(current?.hiraya && current.parentHash ? { parentHash: current.parentHash } : {}),
        apps: runningAppTargets(runningApps),
        instances: runningAppIds(runningApps),
        settingsPage: current?.hiraya ? historySettingsPage(current) : settingsPageRef.current,
      } satisfies RouteHistoryState, "", window.location.href);
    }
  }, [routeHistoryReady, runningAppIds, runningAppTargets, runningApps, windowSessionRestored]);

  useEffect(() => {
    if (syncStatus !== "blocked") return;
    let active = true;
    void getOutboxStatus()
      .then((status) => {
        if (!active) return;
        const blocked = status.records.find((record) => record.status === "blocked");
        setError(blocked?.error ? `A queued change could not sync: ${blocked.error}` : "A queued change could not sync and needs attention.");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [syncStatus]);

  useEffect(() => {
    let active = true;
    const updater = createPwaUpdater({
      onUpdateAvailable: () => {
        if (!active) return;
        setUpdateReady(true);
        if (manualUpdateCheckRef.current || (updatePreferenceLoadedRef.current && autoUpdateRef.current)) setShowUpdateToast(true);
      },
      onError: () => {
        if (active) setError("Hiraya could not check for app updates.");
      },
    });
    updaterRef.current = updater;
    setUpdateSupported(updater.supported);

    const checkAutomatically = () => {
      if (!active || !autoUpdateRef.current || !updater.supported) return;
      void updater.check().catch(() => {
        if (active) setError("Hiraya could not check for app updates.");
      });
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") checkAutomatically();
    };
    window.addEventListener("online", checkAutomatically);
    document.addEventListener("visibilitychange", checkWhenVisible);

    void readLocalPreferences()
      .then((preferences) => {
        if (!active) return;
        autoUpdateRef.current = preferences.autoUpdate;
        localPreferencesRef.current = preferences;
        updatePreferenceLoadedRef.current = true;
        setAutoUpdate(preferences.autoUpdate);
        setExternalEmbeddedPreviews(preferences.externalEmbeddedPreviews);
        setAllowBrowserPinchZoom(preferences.allowBrowserPinchZoom);
        setSearchAllDesktops(preferences.searchAllDesktops && desktopSearchAvailable);
        setExplorerView(preferences.explorerView);
        setPreferencesLoaded(true);
        checkAutomatically();
      })
      .catch(() => {
        if (!active) return;
        updatePreferenceLoadedRef.current = true;
        setPreferencesLoaded(true);
        setError("The local update preference could not be loaded.");
        checkAutomatically();
      });

    return () => {
      active = false;
      updater.dispose();
      if (updaterRef.current === updater) updaterRef.current = null;
      window.removeEventListener("online", checkAutomatically);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [desktopSearchAvailable]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!actionSheetOpen) return;
    const token = crypto.randomUUID();
    actionSheetHistoryRef.current = token;
    window.history.pushState(actionSheetHistoryState(window.history.state, token), "", window.location.href);
    return () => {
      if (actionSheetHistoryRef.current !== token) return;
      if (actionSheetHistoryToken(window.history.state) === token) window.history.back();
      else actionSheetHistoryRef.current = null;
    };
  }, [actionSheetOpen]);

  useEffect(() => {
    async function restoreRoute(state?: unknown) {
      if (!navigationReadyRef.current) return;
      completeAreaTransitionRef.current();
      setDialog(null);
      setContextMenu(null);
      setMoveDialogEntryIds([]);
      if (areaSwitcherRef.current?.hasAttribute("data-expanded")) areaSwitcherRestoreFocusRef.current = true;
      setMinimapExpanded(false);
      const requestedRoute = parseDesktopRoute(window.location.hash);
      const requestedDesktopId = requestedRoute?.desktopId;
      if (requestedDesktopId && requestedDesktopId !== activeDesktopIdRef.current && desktopsRef.current.some((desktop) => desktop.id === requestedDesktopId)) {
        void activateDesktopRef.current(requestedDesktopId).then((switched) => {
          if (switched && requestedRoute) navigateRouteRef.current(requestedRoute, "replace");
        });
        return;
      }
      const apps = historyApps(state);
      if (apps) {
        const destinationIds = historyInstanceIds(state, apps.map(builtinAppTargetId));
        const removedIds = removedHistoryInstanceIds(runningAppIds(), destinationIds);
        restoringHistoryRef.current = true;
        try {
          for (const id of removedIds) {
            if (!(await closeAppRef.current(id, true, false))) {
              window.history.forward();
              return;
            }
          }
        } finally {
          restoringHistoryRef.current = false;
        }
        restoreHistoryAppsRef.current(apps);
        const restoredSettingsPage = historySettingsPage(state);
        settingsPageRef.current = restoredSettingsPage;
        setSettingsPage(restoredSettingsPage);
      }
      applyLocationRouteRef.current();
    }
    let restoringPopState = false;
    const onPopState = (event: PopStateEvent) => {
      if (actionSheetHistoryRef.current) {
        actionSheetHistoryRef.current = null;
        setContextMenu(null);
        return;
      }
      restoringPopState = true;
      void restoreRoute(event.state).finally(() => {
        restoringPopState = false;
      });
    };
    const onHashChange = () => {
      if (!restoringPopState) void restoreRoute();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [runningAppIds]);

  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const desktop = desktopRef.current;
    if (!desktop) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      setDesktopSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(desktop);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (areaTransitionRef.current) completeAreaTransitionRef.current();
  }, [desktopSize.width, desktopSize.height]);

  useEffect(() => () => {
    areaTransitionGenerationRef.current += 1;
    if (areaTransitionTimerRef.current !== null) window.clearTimeout(areaTransitionTimerRef.current);
  }, []);

  const previousDesktopSizeRef = useRef(desktopSize);
  useEffect(() => {
    const previous = previousDesktopSizeRef.current;
    previousDesktopSizeRef.current = desktopSize;
    if (previous.width === desktopSize.width && previous.height === desktopSize.height) return;
    updateRunningApps((currentApps) =>
      currentApps.map((app) => {
        const projection = projectLogicalPosition(app.bounds, previous);
        const { minWidth, minHeight } = app.kind === "sandbox" ? (app.package.manifest.window ?? { minWidth: 360, minHeight: 260 }) : builtinAppWindow(app.kind);
        const localBounds = clampWindowBounds({ ...app.bounds, ...projection.local }, desktopSize, { minWidth, minHeight });
        return { ...app, bounds: { ...localBounds, ...restoreLogicalPosition(localBounds, projection.segment, desktopSize) } };
      }),
    );
  }, [desktopSize, updateRunningApps]);

  useEffect(() => {
    if (loading) return;
    const currentApps = runningAppsRef.current;
    const reconciledApps = currentApps.flatMap((app): RunningApp[] => {
      if (app.kind === "sandbox") {
        const dependencyId = app.systemTarget?.entryId ?? app.packageEntryId;
        return dependencyId === null || entryIndex.byId.has(dependencyId) ? [app] : [];
      }
      const dependency = builtinAppEntryDependency(app);
      if (!dependency) return [app];
      const entry = entryIndex.byId.get(dependency.entryId);
      if (!entry || (dependency.kind !== "entry" && entry.kind !== dependency.kind)) return [];
      if (app.kind !== "file") return [app];
      if (entry.kind !== "file") return [];
      const expectedRevision = contentRevisionsRef.current[app.fileId] ?? 0;
      if (expectedRevision !== app.contentRevision && fileDirtyRef.current[app.id]) {
        return [{ ...app, file: entry, contentRevision: expectedRevision, remoteChanged: true }];
      }
      return [{ ...app, file: entry, editable: fileCapabilities(entry).editable }];
    });
    updateRunningApps(reconciledApps);
    if (focusedAppIdRef.current && !reconciledApps.some((app) => app.id === focusedAppIdRef.current)) {
      const next = topRunningAppInSegment(reconciledApps, routeRef.current ?? { column: 0, row: 0 }, desktopSizeRef.current);
      setFocusedApp(next?.id ?? null);
    }

    for (const app of currentApps) {
      if (app.kind !== "file" || fileDirtyRef.current[app.id]) continue;
      const entry = entryIndex.byId.get(app.fileId);
      const expectedRevision = contentRevisionsRef.current[app.fileId] ?? 0;
      if (entry?.kind !== "file" || app.contentRevision === expectedRevision) continue;
      const generation = (fileLoadGenerationsRef.current[app.id] ?? 0) + 1;
      fileLoadGenerationsRef.current[app.id] = generation;
      void readFile(app.fileId)
        .then((blob) => {
          if (fileLoadGenerationsRef.current[app.id] !== generation) return;
          updateRunningApps((current) =>
            current.map((candidate) =>
              candidate.id === app.id && candidate.kind === "file"
                ? {
                    ...candidate,
                    file: entry,
                    blob,
                    editable: fileCapabilities(entry).editable,
                    contentRevision: expectedRevision,
                    remoteChanged: false,
                  }
                : candidate,
            ),
          );
        })
        .catch(() => setError("An open file changed on the server but could not be refreshed."));
    }
  }, [entryIndex, focusedAppIdRef, loading, runningAppsRef, setFocusedApp, updateRunningApps]);

  useEffect(() => {
    if (loading || !windowSessionRestored) return;
    openRouteAppsRef.current({
      column: 0,
      row: 0,
      ...(routeExplorerFolderId !== undefined ? { explorerFolderId: routeExplorerFolderId } : {}),
      ...(routeFileId ? { fileId: routeFileId } : {}),
      ...(routePropertiesEntryId ? { propertiesEntryId: routePropertiesEntryId } : {}),
      ...(routeSettings ? { settings: true as const } : {}),
    });
  }, [fileAssociations, installedApps, loading, routeExplorerFolderId, routeFileId, routePropertiesEntryId, routeSettings, windowSessionRestored]);

  useEffect(() => {
    applyLocationRouteRef.current();
  }, [responsive.segments.length]);

  useEffect(
    () => () => {
      if (desktopPressRef.current) window.clearTimeout(desktopPressRef.current.timer);
    },
    [],
  );

  useEffect(() => {
    function closeMenu(event: PointerEvent) {
      if (!(event.target as Element).closest?.(".context-menu, .action-sheet")) setContextMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "r" && contextMenuEntry && canMutate) {
        setDialog({ type: "rename", entryId: contextMenuEntry.id });
        setContextMenu(null);
      }
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canMutate, contextMenuEntry]);

  useEffect(() => {
    function editableTarget(target: EventTarget | null) {
      const element = target as Element | null;
      return Boolean(element?.closest?.("input, textarea, [contenteditable='true'], .cm-editor"));
    }
    function activeExplorer() {
      const app = runningAppsRef.current.find((candidate) => candidate.id === focusedAppIdRef.current);
      return app?.kind === "explorer" ? app : null;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (editableTarget(event.target) || shortcutsSuspended || transientMenuOpen()) return;
      const focused = runningAppsRef.current.find((candidate) => candidate.id === focusedAppIdRef.current);
      if (focused && focused.kind !== "explorer") return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "a") {
        const explorer = activeExplorer();
        const surface = explorer?.id ?? "desktop";
        const ids = explorer ? (entryIndex.children.get(explorer.folderId)?.map((entry) => entry.id) ?? []) : activeDesktopSegment.entries.map((entry) => entry.id);
        event.preventDefault();
        replaceSelection(surface, ids);
      } else if (modifier && key === "c" && selectedIdsRef.current.length) {
        event.preventDefault();
        void copySelectionRef.current();
      } else if (modifier && key === "v") {
        event.preventDefault();
        const explorer = activeExplorer();
        void beginPasteRef.current(explorer?.folderId ?? null);
      } else if (event.key === "Delete" && selectedIdsRef.current.length && canMutate) {
        event.preventDefault();
        setDialog({ type: "delete", entryIds: [...selectedIdsRef.current] });
      }
    }
    function onPaste(event: ClipboardEvent) {
      if (editableTarget(event.target) || !canMutate || shortcutsSuspended || transientMenuOpen()) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length || !event.clipboardData) return;
      event.preventDefault();
      const explorer = activeExplorer();
      void snapshotFromClipboardItems(event.clipboardData.items)
        .then((snapshot) => (snapshot ? beginPasteRef.current(explorer?.folderId ?? null, undefined, snapshot) : handleImportRef.current(files, explorer?.folderId ?? null)))
        .catch((pasteError) => setError(pasteError instanceof Error ? pasteError.message : "Clipboard files could not be pasted."));
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [activeDesktopSegment.entries, canMutate, entryIndex, focusedAppIdRef, replaceSelection, runningAppsRef, selectedIdsRef, selectionScope, shortcutsSuspended]);

  useEffect(() => {
    function onGlobalShortcut(event: KeyboardEvent) {
      if (shortcutsSuspended || transientMenuOpen()) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === "Space") {
        event.preventDefault();
        areaSwitcherInternalActivationRef.current = false;
        areaSwitcherRestoreFocusRef.current = minimapExpanded;
        setMinimapExpanded(!minimapExpanded);
        return;
      }
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setActivePanel("search");
        return;
      }
      if (((modifier && event.key.toLowerCase() === "w") || (event.altKey && event.key === "F4")) && focusedAppIdRef.current) {
        event.preventDefault();
        void closeAppRef.current(focusedAppIdRef.current);
        return;
      }
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !(event.target as Element | null)?.closest?.("input, textarea, [contenteditable='true'], .cm-editor")) {
        event.preventDefault();
        setActivePanel("shortcuts");
        return;
      }
      if (event.altKey && event.key === "Enter" && focusedAppIdRef.current) {
        event.preventDefault();
        windowCommandRef.current.maximize(focusedAppIdRef.current);
      } else if (event.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && focusedAppIdRef.current) {
        event.preventDefault();
        windowCommandRef.current.move(focusedAppIdRef.current, event.key.replace("Arrow", "").toLowerCase() as "left" | "right" | "up" | "down");
      }
    }
    window.addEventListener("keydown", onGlobalShortcut);
    return () => window.removeEventListener("keydown", onGlobalShortcut);
  }, [focusedAppIdRef, minimapExpanded, shortcutsSuspended]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if ((event.target as Element | null)?.closest?.("input, textarea, [contenteditable='true'], .cm-editor")) return;
      const owner = topOverlay({
        dialog: Boolean(dialog),
        moveDialog: moveDialogEntries.length > 0,
        settings: false,
        contextMenu: Boolean(contextMenu),
        file: false,
        explorer: false,
        areaEditor: minimapExpanded,
      });
      if (!owner) return;
      if (owner === "moveDialog" && moveDialogSubmitting) return;
      event.preventDefault();
      if (owner === "dialog") setDialog(null);
      else if (owner === "moveDialog") setMoveDialogEntryIds([]);
      else if (owner === "contextMenu") setContextMenu(null);
      else if (owner === "areaEditor") {
        if (isMobile) areaSwitcherRestoreFocusRef.current = true;
        setMinimapExpanded(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextMenu, dialog, isMobile, minimapExpanded, moveDialogEntries.length, moveDialogSubmitting]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const wallpaperFileId = layout.wallpaper.source.startsWith("file:") ? layout.wallpaper.source.slice(5) : null;
  const wallpaperFile = wallpaperFileId ? entries.find((entry): entry is FileEntry => entry.id === wallpaperFileId && entry.kind === "file") : null;
  const wallpaperFileExists = Boolean(wallpaperFile);
  const wallpaperContentRevision = wallpaperFileId ? (contentRevisionsRef.current[wallpaperFileId] ?? wallpaperFile?.modifiedAt ?? 0) : 0;
  const wallpaperKey = wallpaperFileId && activeDesktopId ? `${activeDesktopId}:${wallpaperFileId}:${wallpaperContentRevision}` : null;
  const wallpaperLoadReady = true;
  const wallpaperUrl = wallpaperAsset?.key === wallpaperKey ? wallpaperAsset.url : null;

  useEffect(() => {
    const previous = wallpaperAssetRef.current;
    wallpaperAssetRef.current = null;
    setWallpaperAsset(null);
    if (previous) URL.revokeObjectURL(previous.url);
  }, [wallpaperKey]);

  useEffect(() => {
    let active = true;
    if (!wallpaperKey || !wallpaperFileId || !wallpaperFileExists || !wallpaperLoadReady) return;
    void readFile(wallpaperFileId)
      .then((file) => {
        if (!active) return;
        const next = { key: wallpaperKey, url: URL.createObjectURL(file) };
        const previous = wallpaperAssetRef.current;
        wallpaperAssetRef.current = next;
        setWallpaperAsset(next);
        if (previous) URL.revokeObjectURL(previous.url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [wallpaperFileExists, wallpaperFileId, wallpaperKey, wallpaperLoadReady]);

  useEffect(
    () => () => {
      if (wallpaperAssetRef.current) URL.revokeObjectURL(wallpaperAssetRef.current.url);
    },
    [],
  );

  function childrenCount(parentId: string | null) {
    return parentId !== null ? (entryIndex.children.get(parentId)?.length ?? 0) : activeDesktopSegment.entries.length;
  }

  function positionFor(parentId: string | null) {
    if (parentId === null) {
      const segmentEntryCount = childrenCount(null);
      const occupied = activeDesktopSegment.entries.map((entry) => responsive.positions.get(entry.id) ?? projectLogicalPosition(entry.position, desktopSize).local);
      const localPosition = nextAvailableDesktopSlot(desktopSize, occupied, responsive.segments.length > 1, segmentEntryCount, iconMetrics);
      return restoreLogicalPosition(localPosition, activeSegment, desktopSize);
    }
    const position = nextRootEntryPosition(childrenCount(parentId), window.innerHeight, undefined, iconMetrics);
    return position;
  }

  function snapPositionInView(position: EntryPosition) {
    return {
      x: snapAxis(position.x, GRID_ORIGIN.x, iconMetrics.stepX, Math.max(8, desktopSize.width - iconMetrics.width)),
      y: snapAxis(position.y, GRID_ORIGIN.y, iconMetrics.stepY, Math.max(8, desktopSize.height - iconMetrics.height)),
    };
  }

  function snapRootEntryPosition(position: EntryPosition) {
    const projection = projectLogicalPosition(position, desktopSize);
    return restoreLogicalPosition(snapPositionInView(projection.local), projection.segment, desktopSize);
  }

  function positionAtDesktopPoint(clientX: number, clientY: number) {
    const bounds = desktopRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 8, y: 8 };
    const position = {
      x: Math.min(Math.max(8, desktopSize.width - iconMetrics.width), Math.max(8, clientX - bounds.left - iconMetrics.width / 2)),
      y: Math.min(Math.max(8, desktopSize.height - iconMetrics.height), Math.max(8, clientY - bounds.top - iconMetrics.height / 2)),
    };
    return layoutRef.current.snapToGrid ? snapPositionInView(position) : position;
  }

  function openDesktopContextMenu(clientX: number, clientY: number) {
    window.getSelection()?.removeAllRanges();
    replaceSelection("desktop", []);
    setContextMenu({ type: "desktop", parentId: null, x: clientX, y: clientY, position: positionAtDesktopPoint(clientX, clientY) });
  }

  function openEntryContextMenu(entryId: string, clientX: number, clientY: number) {
    window.getSelection()?.removeAllRanges();
    setContextMenu({ type: "entry", entryId, x: clientX, y: clientY });
  }

  function captureImportOperation(parentId: string | null, position?: EntryPosition): ImportOperationContext {
    return { operationId: crypto.randomUUID(), desktopId: activeDesktopIdRef.current, parentId, activationGeneration: activationGenerationRef.current, position };
  }

  function importOperationIsCurrent(context: ImportOperationContext) {
    assertImportOperationCurrent(context, { desktopId: activeDesktopIdRef.current, activationGeneration: activationGenerationRef.current, entries: entriesRef.current });
  }

  function chooseUpload(parentId: string | null, position?: EntryPosition) {
    if (!canMutate) return;
    importOperationRef.current = captureImportOperation(parentId, position);
    uploadParentRef.current = parentId;
    uploadPositionRef.current = position;
    uploadRef.current?.click();
  }

  async function chooseFolderImport(parentId: string | null, position?: EntryPosition) {
    if (!canMutate) return;
    if (!supportsDirectoryPicker()) {
      reportFolderImportError("Folder import is not supported by this browser. Use Upload files to add files without a folder hierarchy.");
      return;
    }
    const context = captureImportOperation(parentId, position);
    importOperationRef.current = context;
    if (supportsDirectoryHandlePicker()) {
      try {
        const picker = (window as typeof window & { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
        const directory = await picker.call(window);
        const sources = await sourcesFromDirectoryHandle(directory);
        importOperationIsCurrent(context);
        await handleImportSources(sources, context);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) reportFolderImportError(reason instanceof Error ? reason.message : "The selected folder could not be imported.");
      } finally {
        if (importOperationRef.current?.operationId === context.operationId) importOperationRef.current = null;
      }
      return;
    }
    const confirmed = await requestConfirmation({ title: "Import folder with browser fallback?", message: "This browser's folder selector preserves files and their hierarchy, but empty folders cannot be represented and will not be imported.", confirmLabel: "Choose folder" });
    if (!confirmed) return;
    try {
      importOperationIsCurrent(context);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      throw reason;
    }
    uploadParentRef.current = parentId;
    uploadPositionRef.current = position;
    directoryRef.current?.click();
  }
  chooseUploadRef.current = chooseUpload;
  chooseFolderImportRef.current = chooseFolderImport;

  function reportFolderImportError(message: string) {
    setFolderImportError(message);
    setError(message);
  }

  function previewLayout(next: DesktopLayout, desktopId: string) {
    if (!canMutate || desktopId !== activeDesktopIdRef.current) return;
    layoutDraftRef.current = { desktopId, layout: next };
    layoutRef.current = next;
    setLayout(next);
  }

  async function persistLayout(next: DesktopLayout, desktopId = activeDesktopIdRef.current) {
    if (!canMutate || desktopId !== activeDesktopIdRef.current) return;
    if (layoutDraftRef.current?.desktopId === desktopId) layoutDraftRef.current = null;
    layoutRef.current = next;
    setLayout(next);
    const save = saveDesktopLayout(next).catch(() => {
      setError("The desktop area layout could not be saved.");
    });
    layoutSaveRef.current = save;
    await save;
  }

  async function flushLayoutDraft(desktopId: string) {
    const pending = layoutDraftRef.current;
    if (!pending || pending.desktopId !== desktopId) return;
    await persistLayout(pending.layout, desktopId);
  }

  async function changeTheme(themeId: string) {
    if (!canSettings) return;
    try {
      setAppearance(await selectTheme(themeId));
    } catch (themeError) {
      setError(themeError instanceof Error ? themeError.message : "The selected theme could not be saved.");
      throw themeError;
    }
  }

  async function persistCustomTheme(theme: CustomTheme) {
    if (!canSettings) return;
    try {
      const saved = await saveCustomTheme(theme);
      setAppearance(await selectTheme(saved.id));
      setNotice(`${saved.name} saved`);
    } catch (themeError) {
      setError(themeError instanceof Error ? themeError.message : "The custom theme could not be saved.");
      throw themeError;
    }
  }

  async function removeCustomTheme(themeId: string) {
    if (!canSettings) return;
    try {
      setAppearance(await deleteCustomTheme(themeId));
      setNotice("Custom theme deleted");
    } catch (themeError) {
      setError(themeError instanceof Error ? themeError.message : "The custom theme could not be deleted.");
      throw themeError;
    }
  }

  async function checkForUpdate() {
    const updater = updaterRef.current;
    if (!updater?.supported || updateChecking) return;
    if (updateReady) {
      setUpdateBlocked(false);
      setShowUpdateToast(true);
      return;
    }
    manualUpdateCheckRef.current = true;
    setUpdateChecking(true);
    try {
      const result = await updater.check();
      if (result === "current") setNotice("Hiraya is already up to date.");
    } catch {
      setError("Hiraya could not check for app updates.");
    } finally {
      manualUpdateCheckRef.current = false;
      setUpdateChecking(false);
    }
  }

  async function changeAutoUpdate(enabled: boolean) {
    const previous = localPreferencesRef.current;
    const next = { ...previous, autoUpdate: enabled };
    autoUpdateRef.current = enabled;
    localPreferencesRef.current = next;
    setAutoUpdate(enabled);
    try {
      await saveLocalPreferences(next);
      if (enabled) void updaterRef.current?.check().catch(() => setError("Hiraya could not check for app updates."));
    } catch {
      autoUpdateRef.current = previous.autoUpdate;
      localPreferencesRef.current = previous;
      setAutoUpdate(previous.autoUpdate);
      setError("The local update preference could not be saved.");
    }
  }

  async function changeExternalEmbeddedPreviews(enabled: boolean) {
    const previous = localPreferencesRef.current;
    const next = { ...previous, externalEmbeddedPreviews: enabled };
    localPreferencesRef.current = next;
    setExternalEmbeddedPreviews(enabled);
    try {
      await saveLocalPreferences(next);
    } catch {
      localPreferencesRef.current = previous;
      setExternalEmbeddedPreviews(previous.externalEmbeddedPreviews);
      setError("The external preview preference could not be saved.");
    }
  }

  async function changeAllowBrowserPinchZoom(enabled: boolean) {
    const previous = localPreferencesRef.current;
    const next = { ...previous, allowBrowserPinchZoom: enabled };
    localPreferencesRef.current = next;
    setAllowBrowserPinchZoom(enabled);
    try {
      await saveLocalPreferences(next);
    } catch {
      localPreferencesRef.current = previous;
      setAllowBrowserPinchZoom(previous.allowBrowserPinchZoom);
      setError("The browser zoom preference could not be saved.");
    }
  }

  async function changeSearchAllDesktops(enabled: boolean) {
    const previous = localPreferencesRef.current;
    const next = { ...previous, searchAllDesktops: enabled };
    localPreferencesRef.current = next;
    setSearchAllDesktops(enabled);
    try {
      await saveLocalPreferences(next);
    } catch {
      localPreferencesRef.current = previous;
      setSearchAllDesktops(previous.searchAllDesktops);
      setError("The search preference could not be saved.");
    }
  }

  async function changeExplorerView(view: ExplorerView) {
    if (view === localPreferencesRef.current.explorerView) return;
    const previous = localPreferencesRef.current;
    const next = { ...previous, explorerView: view };
    localPreferencesRef.current = next;
    setExplorerView(view);
    try {
      await saveLocalPreferences(next);
    } catch {
      localPreferencesRef.current = previous;
      setExplorerView(previous.explorerView);
      setError("The folder view preference could not be saved.");
    }
  }

  async function closeGettingStarted() {
    setShowGettingStarted(false);
    if (localPreferencesRef.current.onboardingVersion >= ONBOARDING_VERSION) return;
    const next = { ...localPreferencesRef.current, onboardingVersion: ONBOARDING_VERSION };
    localPreferencesRef.current = next;
    try {
      await saveLocalPreferences(next);
    } catch {
      setError("Getting Started completion could not be saved. The guide may appear again.");
    }
  }

  async function installPwa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  async function applyActivatedDesktopState(desktopId: string, desktop: DesktopStateSnapshot) {
    activeDesktopIdRef.current = desktopId;
    setActiveDesktopId(desktopId);
    contentRevisionsRef.current = desktop.sync.contentRevisions;
    entriesRef.current = desktop.entries;
    layoutRef.current = desktop.layout;
    setEntries(desktop.entries);
    setLayout(desktop.layout);
    setAppearance(desktop.appearance);
    replaceSelection("desktop", []);
    for (const app of runningAppsRef.current) if (app.kind === "sandbox") app.dispatcher.dispose();
    updateRunningApps([]);
    appSnapshotRef.current = desktop;
    setFocusedApp(null);
    writeRoute(normalizeDesktopRoute({ desktopId, column: 0, row: 0 }, desktop.entries, desktopId), "replace");
    restoreRunningApps(await readWindowSession(desktopId), desktop.entries);
    windowSessionReadyRef.current = true;
    setWindowSessionRestored(true);
  }

  async function performDesktopActivation(desktopId: string, token: number) {
    activationGenerationRef.current = token;
    if (desktopId === activeDesktopIdRef.current) return true;
    if (Object.values(fileDirtyRef.current).some(Boolean) && !(await requestConfirmation({ title: "Switch desktops?", message: "Switching desktops will discard unsaved editor changes in open files.", confirmLabel: "Discard and switch", danger: true }))) return false;
    const previousDesktopId = activeDesktopIdRef.current;
    let syncStopped = false;
    setLoading(true);
    setError("");
    setDialog(null);
    setContextMenu(null);
    setImportProgress(null);
    setMoveDialogEntryIds([]);
    windowSessionReadyRef.current = false;
    try {
      await flushLayoutDraft(previousDesktopId);
      await layoutSaveRef.current;
      await stopDesktopSync();
      syncStopped = true;
      setOfflineInventory(null);
      setOfflineProgress(null);
      const desktop = await switchLocalDesktop(desktopId);
      await applyActivatedDesktopState(desktopId, desktop);
      await initializeDesktop(desktopId, { x: window.innerWidth, y: Math.max(1, window.innerHeight - 44) });
      await loadOfflineInventory();
      if (activationGenerationRef.current !== token || activeDesktopIdRef.current !== desktopId) throw new Error("Desktop activation lost ownership.");
      return true;
    } catch (switchError) {
      if (syncStopped && previousDesktopId && previousDesktopId !== desktopId) {
        try {
          await stopDesktopSync();
          const previous = await switchLocalDesktop(previousDesktopId);
          await applyActivatedDesktopState(previousDesktopId, previous);
          await initializeDesktop(previousDesktopId, { x: window.innerWidth, y: Math.max(1, window.innerHeight - 44) });
          await loadOfflineInventory();
        } catch (rollbackError) {
          setError(rollbackError instanceof Error ? `Desktop activation failed and rollback failed: ${rollbackError.message}` : "Desktop activation and rollback failed.");
          return false;
        }
      }
      setError(switchError instanceof Error ? switchError.message : "The desktop could not be opened.");
      return false;
    } finally {
      setLoading(false);
    }
  }
  function activateDesktop(desktopId: string) {
    return activationQueueRef.current.run((token) => performDesktopActivation(desktopId, token));
  }
  activateDesktopRef.current = activateDesktop;

  async function createDesktop(name: string) {
    const desktop = await createDesktopMutation(name);
    setDesktops((current) => [...current, desktop]);
    await activateDesktop(desktop.id);
  }

  async function renameDesktop(desktopId: string, name: string) {
    if (!desktopsRef.current.find((desktop) => desktop.id === desktopId)?.capabilities.manage) throw new Error("You do not have permission to rename this desktop.");
    const renamed = await renameDesktopMutation(desktopId, name);
    setDesktops((current) => current.map((desktop) => (desktop.id === desktopId ? renamed : desktop)));
  }

  async function deleteDesktop(desktopId: string) {
    const desktop = desktops.find((candidate) => candidate.id === desktopId);
    if (!desktop?.capabilities.delete || desktops.filter((candidate) => candidate.ownership === "owned").length === 1) return;
    if (!(await requestConfirmation({ title: `Delete ${desktop.name}?`, message: `Delete “${desktop.name}” and every file, folder, and Trash item in it? This cannot be undone.`, confirmLabel: "Delete desktop", danger: true }))) return;
    if (desktopId === activeDesktopIdRef.current) {
      const replacement = desktops.find((candidate) => candidate.id !== desktopId)!;
      if (!(await activateDesktop(replacement.id))) return;
    }
    await deleteDesktopMutation(desktopId);
    setDesktops((current) => current.filter((candidate) => candidate.id !== desktopId));
    setNotice(`${desktop.name} deleted`);
  }

  async function activateUpdate() {
    if (Object.values(fileDirtyRef.current).some(Boolean)) {
      setUpdateBlocked(true);
      return;
    }
    const updater = updaterRef.current;
    if (!updater) return;
    setUpdateBlocked(false);
    setUpdateApplying(true);
    try {
      await updater.activate();
    } catch {
      setUpdateApplying(false);
      setError("The app update could not be applied.");
    }
  }

  async function handleDialogSubmit(name: string) {
    if (!dialog || !canMutate) return;
    if (dialog.type === "create-file" || dialog.type === "create-folder") {
      const parentId = dialog.parentId;
      const created = dialog.type === "create-file" ? await createTextFile(name, parentId, dialog.position ?? positionFor(parentId)) : await createFolder(name, parentId, dialog.position ?? positionFor(parentId));
      setEntries((current) => (current.some((entry) => entry.id === created.id) ? current : [...current, created]));
      replaceSelection(parentId === null ? "desktop" : `explorer:${parentId}`, [created.id]);
      setNotice(`${created.name} created`);
    } else if (dialog.type === "rename") {
      if (!dialogEntry) {
        setDialog(null);
        return;
      }
      const renamed = await renameEntry(dialogEntry.id, name);
      setEntries((current) => current.map((entry) => (entry.id === renamed.id ? renamed : entry)));
      updateRunningApps((current) =>
        current.map((app) =>
          app.kind === "file" && app.fileId === renamed.id
            ? {
                ...app,
                file: renamed as FileEntry,
                editable: renamed.kind === "file" ? fileCapabilities(renamed).editable : app.editable,
              }
            : app,
        ),
      );
      setNotice(`${renamed.kind === "folder" ? "Folder" : "File"} renamed`);
    } else {
      if (!dialogEntry) {
        setDialog(null);
        return;
      }
      const ids = dialog.type === "delete" ? dialog.entryIds : [];
      const selected = new Set(ids);
      const rootIds = ids.filter((id) => !entryIndex.ancestors(id).some((ancestor) => selected.has(ancestor.id)));
      const deleted = await deleteEntries(ids);
      const deletedIds = new Set(deleted.map((entry) => entry.id));
      setEntries((current) => current.filter((entry) => !deletedIds.has(entry.id)));
      replaceSelection(
        selectionScope,
        selectedIdsRef.current.filter((id) => !deletedIds.has(id)),
      );
      const label = ids.length === 1 ? dialogEntry.name : `${ids.length} items`;
      setNotice(syncStatus === "local" ? `${label} deleted permanently` : `${label} moved to Trash`);
      if (syncStatus === "online") setTrashNotifications((current) => [...current, createTrashNotification(activeDesktopIdRef.current, label, rootIds)]);
    }
    setDialog(null);
  }

  async function handleImportSources(sources: readonly ImportSource[], context: ImportOperationContext) {
    if (!sources.length || !canMutate) return;
    importOperationIsCurrent(context);
    const { parentId, position: base } = context;
    setFolderImportError("");
    setError("");
    setImportProgress({ folderCount: 0, fileCount: sources.filter((source) => source.file).length, totalBytes: sources.reduce((total, source) => total + (source.file?.size ?? 0), 0), phase: "preparing" });
    try {
      const offset = childrenCount(parentId);
      const occupied = parentId === null ? activeDesktopSegment.entries.map((entry) => responsive.positions.get(entry.id) ?? projectLogicalPosition(entry.position, desktopSize).local) : [];
      const positionForRoot = (index: number) => {
        if (parentId !== null) return nextRootEntryPosition(offset + index, window.innerHeight, base, iconMetrics);
        const localPosition = base && index === 0 ? (layoutRef.current.snapToGrid ? snapPositionInView(base) : base) : nextAvailableDesktopSlot(desktopSize, occupied, responsive.segments.length > 1, offset + index, iconMetrics);
        occupied.push(localPosition);
        return restoreLogicalPosition(localPosition, activeSegment, desktopSize);
      };
      const plan = buildImportPlan(sources, { destinationParentId: parentId, existingEntries: entriesRef.current, positionForRoot });
      setImportProgress({ folderCount: plan.folderCount, fileCount: plan.fileCount, totalBytes: plan.totalBytes, phase: syncStatus === "online" ? "syncing" : "saving" });
      importOperationIsCurrent(context);
      const imported = await createEntries(plan.entries, plan.contents);
      setEntries((current) => {
        const existingIds = new Set(current.map((entry) => entry.id));
        return [...current, ...imported.filter((entry) => !existingIds.has(entry.id))];
      });
      replaceSelection(parentId === null ? "desktop" : `explorer:${parentId}`, plan.rootIds);
      setNotice(`${plan.folderCount} ${plan.folderCount === 1 ? "folder" : "folders"} and ${plan.fileCount} ${plan.fileCount === 1 ? "file" : "files"} added`);
    } catch (importError) {
      if (!(importError instanceof DOMException && importError.name === "AbortError")) reportFolderImportError(importError instanceof Error ? importError.message : "The import could not be completed.");
    } finally {
      if (importOperationRef.current?.operationId === context.operationId) {
        importOperationRef.current = null;
        setImportProgress(null);
      }
    }
  }

  async function handleImport(files: File[], parentId: string | null, base?: EntryPosition) {
    const context = captureImportOperation(parentId, base);
    importOperationRef.current = context;
    await handleImportSources(
      files.map((file) => ({ relativePath: file.name, file })),
      context,
    );
  }

  async function handleExternalDrop(dataTransfer: DataTransfer, parentId: string | null, base?: EntryPosition) {
    if (!canMutate) return;
    const context = captureImportOperation(parentId, base);
    importOperationRef.current = context;
    setFolderImportError("");
    setError("");
    setImportProgress({ folderCount: 0, fileCount: 0, totalBytes: 0, phase: "preparing" });
    try {
      const sources = await sourcesFromDrop(dataTransfer);
      if (!sources.length) return;
      importOperationIsCurrent(context);
      await handleImportSources(sources, context);
    } catch (dropError) {
      if (!(dropError instanceof DOMException && dropError.name === "AbortError")) reportFolderImportError(dropError instanceof Error ? dropError.message : "The dropped items could not be imported.");
    } finally {
      if (importOperationRef.current?.operationId === context.operationId) {
        importOperationRef.current = null;
        setImportProgress(null);
      }
    }
  }
  handleImportRef.current = handleImport;

  async function handleWallpaperUpload(file: File, nextLayout: DesktopLayout, desktopId: string) {
    if (!canMutate || desktopId !== activeDesktopIdRef.current) return;
    setError("");
    try {
      await validateWallpaperImage(file);
      const imported = await importFiles([file], null, [positionFor(null)]);
      const image = imported[0];
      setEntries((current) => (current.some((entry) => entry.id === image.id) ? current : [...current, image]));
      replaceSelection("desktop", [image.id]);
      await persistLayout({ ...nextLayout, wallpaper: { ...nextLayout.wallpaper, source: `file:${image.id}` } }, desktopId);
      setNotice(`${image.name} added as wallpaper`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The wallpaper image could not be added.");
    }
  }

  async function handleWallpaperSelect(fileId: string, nextLayout: DesktopLayout, desktopId: string) {
    if (!canMutate || desktopId !== activeDesktopIdRef.current) return;
    setError("");
    try {
      const file = await readFile(fileId);
      await validateWallpaperImage(file);
      if (desktopId !== activeDesktopIdRef.current || !entriesRef.current.some((entry) => entry.id === fileId && entry.kind === "file")) return;
      await persistLayout({ ...nextLayout, wallpaper: { ...nextLayout.wallpaper, source: `file:${fileId}` } }, desktopId);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "The wallpaper image could not be selected.");
    }
  }

  async function handleDesktopMove(entry: DesktopEntry, position: EntryPosition, targetParentId: string | null) {
    if (!canMutate) return false;
    if (targetParentId) {
      return handleMoveTo(selectedIdSet.has(entry.id) ? selectedEntries : [entry], targetParentId, true);
    }
    const sourceSegment = projectLogicalPosition(entry.position, desktopSize).segment;
    const sourceOrigin = areaWorldOrigin(sourceSegment, desktopSize);
    const worldPosition = { x: sourceOrigin.x + position.x, y: sourceOrigin.y + position.y };
    const logicalCanvasPosition = layoutRef.current.snapToGrid ? snapRootEntryPosition(worldPosition) : worldPosition;
    const projected = projectLogicalPosition(logicalCanvasPosition, desktopSize);
    const targetSegment = edgeNavigationRef.current?.targetSegment ?? projected.segment;
    const localPosition = {
      x: Math.min(Math.max(8, desktopSize.width - iconMetrics.width), Math.max(8, logicalCanvasPosition.x - targetSegment.column * desktopSize.width)),
      y: Math.min(Math.max(8, desktopSize.height - iconMetrics.height), Math.max(8, logicalCanvasPosition.y - targetSegment.row * desktopSize.height)),
    };
    const logicalPosition = restoreLogicalPosition(localPosition, targetSegment, desktopSize);
    const group = selectedIdSet.has(entry.id) ? selectedEntries.filter((item) => item.parentId === null) : [entry];
    if (group.length > 1) {
      const delta = { x: logicalPosition.x - entry.position.x, y: logicalPosition.y - entry.position.y };
      const updates = group.map((item) => ({ entryId: item.id, position: { x: item.position.x + delta.x, y: item.position.y + delta.y } }));
      const previous = new Map(group.map((item) => [item.id, item.position]));
      const nextPositions = new Map(updates.map((item) => [item.entryId, item.position]));
      setEntries((current) => current.map((item) => (nextPositions.has(item.id) ? { ...item, position: nextPositions.get(item.id)! } : item)));
      try {
        await updateRootEntryPositions(updates);
        return true;
      } catch {
        setEntries((current) => current.map((item) => (previous.has(item.id) ? { ...item, position: previous.get(item.id)! } : item)));
        setError("The selected icon positions could not be saved.");
        return false;
      }
    }
    setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, position: logicalPosition } : item)));
    try {
      await updateEntryPosition(entry.id, logicalPosition);
      return true;
    } catch {
      setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, position: entry.position } : item)));
      setError("The new icon position could not be saved.");
      return false;
    }
  }

  async function handleMoveTo(items: readonly DesktopEntry[], parentId: string | null, bubbleError = false) {
    if (!canMutate) return false;
    setError("");
    try {
      if (items.every((entry) => entry.parentId === parentId)) return true;
      const moved = await moveEntries(
        items.map((entry) => entry.id),
        parentId,
      );
      const movedById = new Map(moved.map((entry) => [entry.id, entry]));
      setEntries((current) => current.map((item) => movedById.get(item.id) ?? item));
      replaceSelection(selectionScope, []);
      setContextMenu(null);
      setNotice(items.length === 1 ? `${items[0].name} moved` : `${items.length} items moved`);
      return true;
    } catch (moveError) {
      const message = moveError instanceof Error ? moveError.message : "The item could not be moved.";
      setError(message);
      if (bubbleError) throw moveError;
      return false;
    }
  }

  function openExplorerWindow(folderId: string | null, syncRoute = true, focus = true) {
    const id = builtinAppTargetId({ kind: "explorer", folderId });
    if (runningAppsRef.current.some((app) => app.id === id)) {
      if (focus) focusApp(id, syncRoute);
      return false;
    }
    const app: ExplorerApp = { ...createAppBase(id, "explorer"), kind: "explorer", folderId };
    updateRunningApps([...runningAppsRef.current, app]);
    if (focus) setFocusedApp(id);
    return true;
  }

  function navigateExplorerWindow(appId: string, folderId: string | null) {
    const nextId = builtinAppTargetId({ kind: "explorer", folderId });
    if (nextId === appId) return;
    const previousApps = runningAppTargets();
    const zIndex = nextWindowZIndex();
    const existing = runningAppsRef.current.find((app) => app.id === nextId);
    if (existing) {
      updateRunningApps(runningAppsRef.current.filter((app) => app.id !== appId).map((app) => (app.id === nextId ? { ...app, minimized: false, zIndex } : app)));
    } else {
      updateRunningApps(runningAppsRef.current.map((app) => (app.id === appId && app.kind === "explorer" ? { ...app, id: nextId, folderId, zIndex } : app)));
    }
    setFocusedApp(nextId);
    const currentRoute = routeRef.current;
    if (currentRoute && existing) {
      const segment = segmentForApp(existing);
      navigateRoute({ ...segment, explorerFolderId: folderId }, "push", previousApps);
    } else if (currentRoute) navigateRoute({ column: currentRoute.column, row: currentRoute.row, explorerFolderId: folderId }, "push", previousApps);
  }

  function openSettingsWindow(syncRoute = true) {
    const id = builtinAppTargetId({ kind: "settings" });
    if (runningAppsRef.current.some((app) => app.id === id)) {
      focusApp(id, syncRoute);
      return false;
    }
    const previousApps = runningAppTargets();
    const app: SettingsApp = { ...createAppBase(id, "settings"), kind: "settings" };
    updateRunningApps([...runningAppsRef.current, app]);
    setFocusedApp(id);
    const currentRoute = routeRef.current;
    if (syncRoute && currentRoute) navigateRoute({ column: currentRoute.column, row: currentRoute.row, settings: true }, "push", previousApps);
    return true;
  }

  function openPropertiesWindow(entryId: string, syncRoute = true) {
    const entry = entriesRef.current.find((candidate) => candidate.id === entryId);
    if (!entry) return false;
    const id = builtinAppTargetId({ kind: "properties", entryId });
    if (runningAppsRef.current.some((app) => app.id === id)) {
      focusApp(id, syncRoute);
      return false;
    }
    const previousApps = runningAppTargets();
    const app: PropertiesApp = { ...createAppBase(id, "properties"), kind: "properties", entryId };
    updateRunningApps([...runningAppsRef.current, app]);
    setFocusedApp(id);
    const currentRoute = routeRef.current;
    if (syncRoute && currentRoute) navigateRoute({ column: currentRoute.column, row: currentRoute.row, propertiesEntryId: entryId }, "push", previousApps);
    return true;
  }

  async function launchInstalledApp(install: InstalledApp, target?: AppLaunchTarget, launchSource: AppLaunchSource = target ? "file" : "launcher") {
    setError("");
    try {
      const result = await launchSandboxApp({
        install,
        target,
        source: launchSource,
        activeSegment,
        desktopSize,
        runningApps: runningAppsRef.current,
        activeTheme,
        capabilities: appCapabilities,
        hostServices: appHostServices,
        commandService,
        fileSync: {
          readFile,
          saveFile: saveAppFile,
          createFile: createAppFile,
          createFolder,
          renameEntry,
          moveEntry: moveAppEntry,
          deleteEntry: deleteAppEntry,
          deleteEntries,
        },
        getEntries: () => entriesRef.current,
        getSnapshot: () => appSnapshotRef.current ?? (() => { throw new HostServiceError("The desktop is unavailable.", "UNAVAILABLE"); })(),
        getLaunchArguments: () => install.appId === SYSTEM_APP_IDS.textEditor && appSnapshotRef.current ? [JSON.stringify(appSnapshotRef.current.editorSettings)] : [],
        getAppCapabilities: () => ({ files: fileWriteCapability(desktopsRef.current.find((desktop) => desktop.id === activeDesktopIdRef.current), syncStatus), externalEmbeddedPreviews: localPreferencesRef.current.externalEmbeddedPreviews }),
        canMutate: () => canMutateRef.current,
        shouldFocusTarget: (systemTarget) => routeTargetsAppEntry(routeRef.current, systemTarget),
        createBase: (id) => createAppBase(id, "sandbox"),
        createPosition: () => positionFor(null),
        confirm: requestConfirmation,
        openEntry: (entry) => handleOpenRef.current(entry),
        importFiles: (parentId) => chooseUploadRef.current(parentId),
        importFolder: (parentId) => chooseFolderImportRef.current(parentId),
        showEntryActions: (instanceId, ids) => {
          replaceSelection(`app:${instanceId}`, ids);
          setContextMenu({ type: "entry", entryId: ids[0], x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) });
        },
        getEntryStatus: (id) => {
          const status = offlineModelRef.current?.entries[id];
          return { status: status?.status ?? "unavailable", pinned: status?.pinned ?? false, directlyPinned: status?.directlyPinned ?? false };
        },
        setOfflinePinned: async (ids, pinned) => {
          if (pinned) await makeAvailableOfflineRef.current(ids);
          else await unpinOfflineRef.current(ids);
        },
        setExternalEmbeddedPreviews: changeExternalEmbeddedPreviews,
      });
      if (result.kind === "existing") {
        if (result.shouldFocus) focusApp(result.id);
        return;
      }
      updateRunningApps([...runningAppsRef.current, result.app]);
      if (result.shouldFocus) setFocusedApp(result.app.id);
      if (!result.systemTarget && launchSource !== "restore") {
        const current = window.history.state as Partial<RouteHistoryState> | null;
        if (current?.hiraya) window.history.pushState(routeHistoryState(runningAppTargets(), window.location.hash), "", window.location.href);
      }
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "The app package could not be opened.");
    }
  }
  launchInstalledAppRef.current = launchInstalledApp;

  async function openAppPackage(file: FileEntry, launchFile?: FileEntry) {
    setError("");
    try {
      const blob = await readFile(file.id);
      const { inspectAppArchive } = await import("@hiraya/app-cli");
      const appPackage = await inspectAppArchive(new Uint8Array(await blob.arrayBuffer()));
      if (SYSTEM_APP_CATALOG.some((item) => item.manifest.id === appPackage.manifest.id)) throw new Error("That app ID is reserved for a bundled system app.");
      const approved = installedApps.find((item) => item.appId === appPackage.manifest.id);
      let install = approved;
      if (!packageMatchesInstall(approved, file.id, appPackage.digest, appPackage.manifest.version)) {
        const permissions = appPackage.manifest.permissions.length ? appPackage.manifest.permissions.join(", ") : "None";
        const confirmed = await requestConfirmation({ title: `${approved ? "Approve updated" : "Install"} ${appPackage.manifest.name}?`, message: `Requested permissions: ${permissions}. Direct network APIs and app links are blocked; apps can access Hiraya only through approved host services.`, confirmLabel: approved ? "Approve update" : "Install and run" });
        if (!confirmed || !entriesRef.current.some((entry) => entry.id === file.id)) return;
        install = { appId: appPackage.manifest.id, source: "desktop", packageEntryId: file.id, archivePath: null, digest: appPackage.digest, version: appPackage.manifest.version, manifest: appPackage.manifest, approvedAt: Date.now() };
        if (approved) forceCloseRunningAppInstances([...runningAppsRef.current], install.appId, closeApp);
        await approveInstall(install);
      }
      await launchInstalledApp(install!, launchFile);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "The app package could not be opened.");
    }
  }

  async function openFileWithApp(app: InstalledApp, file: FileEntry) {
    setContextMenu(null);
    const currentRoute = routeRef.current;
    if (!currentRoute) return;
    const previousApps = runningAppTargets();
    const target: SystemAppTarget = { kind: "system", appId: app.appId, targetKind: "file", entryId: file.id };
    if (app.source === "system") await launchInstalledApp(app, file);
    else {
      const packageEntry = entriesRef.current.find((entry): entry is FileEntry => entry.kind === "file" && entry.id === app.packageEntryId);
      if (packageEntry) await openAppPackage(packageEntry, file);
      else setError("That app package is unavailable.");
    }
    const id = builtinAppTargetId(target);
    if (!runningAppsRef.current.some((running) => running.id === id)) return;
    if (routeRef.current !== currentRoute) return;
    navigateRoute({ column: currentRoute.column, row: currentRoute.row, fileId: file.id }, "push", previousApps);
    focusApp(id, false);
  }

  async function removeInstalledApp(app: InstalledApp) {
    if (app.source === "system") return;
    if (!(await requestConfirmation({ title: `Uninstall ${app.manifest.name}?`, message: "This removes its approval and device-local app data. The package and your files are not deleted.", confirmLabel: "Uninstall", danger: true }))) return;
    forceCloseRunningAppInstances([...runningAppsRef.current], app.appId, closeApp);
    await removeInstall(app.appId);
    setNotice(`${app.manifest.name} uninstalled`);
  }

  function exportQuarantinedApp(app: QuarantinedApp) {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), app }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${app.appId}-quarantine.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function discardQuarantinedApp(app: QuarantinedApp) {
    if (!(await requestConfirmation({ title: `Remove recovered data for ${app.appId}?`, message: "Download the quarantine export first if you may need this app's original manifest and local storage. This removal cannot be undone.", confirmLabel: "Remove recovered data", danger: true }))) return;
    await discardQuarantine(app.appId);
  }

  async function openInternetShortcut(file: FileEntry, popup: Window | null) {
    if (!popup) {
      setError("The link was blocked by the browser. Allow pop-ups for Hiraya and try again.");
      return;
    }
    popup.opener = null;
    try {
      const shortcut = parseInternetShortcut(await (await readFile(file.id)).text());
      popup.location.replace(shortcut.url);
    } catch (openError) {
      popup.close();
      setError(openError instanceof Error ? openError.message : "The internet shortcut could not be opened.");
    }
  }

  function handleOpen(entry: DesktopEntry) {
    setContextMenu(null);
    if (entry.kind === "file" && isAppPackageName(entry.name)) {
      void openAppPackage(entry);
      return;
    }
    if (entry.kind === "file" && fileCapabilities(entry).preview === "url") {
      setError("");
      void openInternetShortcut(entry, window.open("about:blank", "_blank"));
      return;
    }
    const currentRoute = routeRef.current;
    if (!currentRoute) return;
    if (entry.kind === "folder") {
      const existingId = builtinAppTargetId({ kind: "explorer", folderId: entry.id });
      if (runningAppsRef.current.some((app) => app.id === existingId)) {
        focusApp(existingId);
        return;
      }
      const previousApps = runningAppTargets();
      const created = openExplorerWindow(entry.id, false);
      navigateRoute({ column: currentRoute.column, row: currentRoute.row, explorerFolderId: entry.id }, created ? "push" : "replace", previousApps);
      return;
    }
    const resolution = resolveFileApp(entry, installedApps, entriesRef.current, fileAssociations);
    const app = resolution?.app;
    if (!app) {
      setError("No available app can open this item.");
      return;
    }
    if (resolution?.preferredUnavailable) setNotice(`Your preferred app for ${resolution.preferredUnavailable.matcher} is unavailable. Opened with ${app.manifest.name}; change the preference in Settings > Apps > File types.`);
    void openFileWithApp(app, entry);
  }
  handleOpenRef.current = handleOpen;

  function handleEditFile(file: FileEntry) {
    setContextMenu(null);
    const currentRoute = routeRef.current;
    if (!currentRoute || !fileCapabilities(file).editable) return;
    const editor = installedApps.find((app) => app.appId === SYSTEM_APP_IDS.textEditor);
    if (!editor) {
      setError("Text Editor is unavailable.");
      return;
    }
    void openFileWithApp(editor, file);
  }

  async function download(file: FileEntry) {
    try {
      const blob = await readFile(file.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setContextMenu(null);
    } catch {
      setError("The file could not be downloaded.");
    }
  }

  async function copyDeepLink(entry: DesktopEntry) {
    const segment = entry.parentId === null ? projectLogicalPosition(entry.position, desktopSizeRef.current).segment : activeSegment;
    const target = entry.kind === "folder" ? { desktopId: activeDesktopIdRef.current, ...segment, explorerFolderId: entry.id } : { desktopId: activeDesktopIdRef.current, ...segment, fileId: entry.id };
    const url = new URL(window.location.href);
    url.hash = formatDesktopRoute(target);
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice(`Link to ${entry.name} copied`);
      setContextMenu(null);
    } catch {
      setError("The browser did not allow Hiraya to copy this link.");
    }
  }

  async function makeAvailableOffline(rootIds: string[]) {
    if (offlineBusy) return;
    setOfflineBusy(true);
    setError("");
    try {
      const estimate = await estimateOfflineOperation(rootIds);
      if (
        (estimate.fileCount >= 50 || estimate.downloadBytes >= 100 * 1024 * 1024) &&
        !(await requestConfirmation({
          title: "Make this selection available offline?",
          message: `${estimate.fileCount} files may download (${formatImportBytes(estimate.downloadBytes)}). Folder pins also include new descendants after synchronization.`,
          confirmLabel: "Make available",
        }))
      )
        return;
      await setOfflinePinIntent(estimate.roots, true);
      setNotice(syncStatus === "offline" ? "Offline pin saved. Download will occur after reconnect." : `${estimate.fileCount} ${estimate.fileCount === 1 ? "file is" : "files are"} available or updating for offline use`);
      setContextMenu(null);
    } catch (availabilityError) {
      setError(availabilityError instanceof Error ? availabilityError.message : "Offline availability could not be changed.");
    } finally {
      setOfflineBusy(false);
    }
  }

  async function unpinOffline(rootIds: string[]) {
    if (offlineBusy) return;
    setOfflineBusy(true);
    try {
      await setOfflinePinIntent(rootIds, false);
      setNotice("Offline pin removed. Existing downloaded copies remain until released.");
      setContextMenu(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The offline pin could not be removed.");
    } finally {
      setOfflineBusy(false);
    }
  }
  makeAvailableOfflineRef.current = makeAvailableOffline;
  unpinOfflineRef.current = unpinOffline;

  async function removeDownloadedCopies(rootIds?: string[]) {
    if (offlineBusy) return;
    setOfflineBusy(true);
    try {
      const released = await releaseOfflineCopies(rootIds);
      setNotice(released.releasedFiles ? `${released.releasedFiles} downloaded ${released.releasedFiles === 1 ? "copy" : "copies"} released (${formatImportBytes(released.releasedBytes)})` : released.skippedFiles ? "No copies released. Pinned or protected content was kept." : "No eligible downloaded copies found.");
      setContextMenu(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Downloaded copies could not be released.");
    } finally {
      setOfflineBusy(false);
    }
  }

  async function undoMoveToTrash(pending: TrashNotification) {
    if (pending.state === "running") return;
    setTrashNotifications((current) => updateTrashNotification(current, pending.id, "running"));
    try {
      if (!desktopsRef.current.some((desktop) => desktop.id === pending.desktopId)) throw new Error("That desktop is no longer accessible. Open Trash after access is restored.");
      if (activeDesktopIdRef.current !== pending.desktopId && !(await activateDesktop(pending.desktopId))) throw new Error("The desktop could not be opened.");
      for (const id of pending.rootIds) await restoreTrash(pending.desktopId, id, "original");
      setTrashNotifications((current) => dismissTrashNotification(current, pending.id));
      setNotice(`${pending.label} restored`);
    } catch (restoreError) {
      const message = restoreError instanceof Error ? restoreError.message : "The Trash move could not be undone.";
      setTrashNotifications((current) => updateTrashNotification(current, pending.id, "failed", message));
    }
  }

  async function openTrashNotification(pending: TrashNotification) {
    if (!desktopsRef.current.some((desktop) => desktop.id === pending.desktopId)) {
      setTrashNotifications((current) => updateTrashNotification(current, pending.id, "failed", "That desktop is no longer accessible."));
      return;
    }
    if (activeDesktopIdRef.current !== pending.desktopId && !(await activateDesktop(pending.desktopId))) return;
    setActivePanel("trash");
  }

  async function openSearchResult(result: DesktopSearchResult) {
    const destination = desktopsRef.current.find((desktop) => desktop.id === result.desktopId && desktop.capabilities.read && (result.authorityCatalogId === null || desktop.authorityCatalogId === result.authorityCatalogId));
    if (!destination) {
      setError("That search result is no longer accessible.");
      return;
    }
    if (result.desktopId !== activeDesktopIdRef.current && !(await activateDesktop(result.desktopId))) return;
    const current = entriesRef.current.find((entry) => entry.id === result.entry.id);
    if (!current) {
      setError("That search result is stale. Search again after reconnecting.");
      return;
    }
    if (current.parentId === null) goToSegment(projectLogicalPosition(current.position, desktopSizeRef.current).segment);
    handleOpen(current);
  }

  async function copySelection() {
    if (!selectedIdsRef.current.length) return;
    setError("");
    try {
      const snapshot = await captureEntries(selectedIdsRef.current);
      clipboardRef.current = snapshot;
      setClipboardOffer((current) => observeClipboardOffer(current, clipboardSnapshotIdentity(snapshot), true));
      if (navigator.clipboard?.write && "ClipboardItem" in window) {
        try {
          const archive = await encodeClipboardArchive(snapshot);
          const summary = snapshot.selectedRootIds
            .map((id) => snapshot.entries.find((entry) => entry.id === id)?.name)
            .filter(Boolean)
            .join("\n");
          await navigator.clipboard.write([new ClipboardItem({ [CLIPBOARD_ARCHIVE_WEB_MIME_TYPE]: archive, "text/plain": new Blob([summary], { type: "text/plain" }) })]);
        } catch {
          /* The durable in-app clipboard remains available. */
        }
      }
      setContextMenu(null);
      setNotice(`${snapshot.selectedRootIds.length} ${snapshot.selectedRootIds.length === 1 ? "item" : "items"} copied`);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "The selected items could not be copied.");
    }
  }
  copySelectionRef.current = copySelection;

  function pastePositions(snapshot: ClipboardEntrySnapshot, parentId: string | null, base?: EntryPosition) {
    const roots = snapshot.selectedRootIds.map((id) => snapshot.entries.find((entry) => entry.id === id)!);
    const positions = new Map<string, EntryPosition>();
    if (parentId !== null) {
      roots.forEach((entry, index) => positions.set(entry.id, nextRootEntryPosition(childrenCount(parentId) + index, window.innerHeight, undefined, iconMetrics)));
      return positions;
    }
    const first = roots[0];
    const origin = base ? restoreLogicalPosition(base, activeSegment, desktopSize) : positionFor(null);
    for (const entry of roots) positions.set(entry.id, { x: origin.x + entry.position.x - first.position.x, y: origin.y + entry.position.y - first.position.y });
    return positions;
  }

  async function commitPaste(snapshot: ClipboardEntrySnapshot, parentId: string | null, position: EntryPosition | undefined, names: Map<string, string>) {
    const pasted = await pasteEntries(snapshot, parentId, names, pastePositions(snapshot, parentId, position));
    const pastedIds = new Set(pasted.map((entry) => entry.id));
    const rootIds = pasted.filter((entry) => !pastedIds.has(entry.parentId ?? "")).map((entry) => entry.id);
    replaceSelection(parentId === null ? "desktop" : `explorer:${parentId}`, rootIds);
    setPendingPaste(null);
    setContextMenu(null);
    setClipboardOffer((current) => dismissClipboardOffer(current));
    setNotice(`${rootIds.length} ${rootIds.length === 1 ? "item" : "items"} pasted`);
  }

  async function beginPaste(parentId: string | null, position?: EntryPosition, supplied?: ClipboardEntrySnapshot) {
    if (!canMutate) return;
    setError("");
    let snapshot = supplied ?? clipboardRef.current;
    if (!supplied && navigator.clipboard?.read) {
      try {
        const item = (await navigator.clipboard.read()).find((candidate) => candidate.types.some((type) => type.includes("x-hiraya-entry-archive")));
        if (item) snapshot = await decodeClipboardArchiveItem(item);
      } catch {
        /* Permission denial falls back to the in-app clipboard. */
      }
    }
    if (!snapshot) {
      setError("Nothing has been copied in Hiraya yet.");
      return;
    }
    const roots = snapshot.selectedRootIds.map((id) => snapshot!.entries.find((entry) => entry.id === id)!);
    const existingNames = entriesRef.current.filter((entry) => entry.parentId === parentId).map((entry) => entry.name);
    const conflicts = roots.some((entry, index) => existingNames.some((name) => namesMatch(name, entry.name)) || roots.slice(0, index).some((previous) => namesMatch(previous.name, entry.name)));
    if (conflicts) {
      setPendingPaste({ snapshot, parentId, position });
      setContextMenu(null);
      return;
    }
    try {
      await commitPaste(snapshot, parentId, position, new Map(roots.map((entry) => [entry.id, entry.name])));
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : "The copied items could not be pasted.");
    }
  }
  beginPasteRef.current = beginPaste;

  async function handleExport() {
    setError("");
    setExporting(true);
    try {
      const archive = await exportSeededDesktop(readFile);
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "hiraya-seeded.zip";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Deployment seed exported");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "The desktop could not be exported.");
    } finally {
      setExporting(false);
    }
  }

  function setAreaTrackTransform(x: number, y: number) {
    desktopRef.current?.style.setProperty("--area-track-x", `${x}px`);
    desktopRef.current?.style.setProperty("--area-track-y", `${y}px`);
  }

  function resetAreaTrackTransform() {
    desktopRef.current?.style.removeProperty("--area-track-x");
    desktopRef.current?.style.removeProperty("--area-track-y");
  }

  function setAreaTransitionDepth(depth: number) {
    const clamped = Math.min(1, Math.max(0, depth));
    desktopRef.current?.style.setProperty("--area-stage-scale", String(1 - clamped * 0.055));
    desktopRef.current?.style.setProperty("--area-frame-opacity", String(clamped));
  }

  function completeAreaTransition() {
    areaTransitionGenerationRef.current += 1;
    if (areaTransitionTimerRef.current !== null) window.clearTimeout(areaTransitionTimerRef.current);
    areaTransitionTimerRef.current = null;
    setAreaTransition(null);
    resetAreaTrackTransform();
    desktopRef.current?.style.removeProperty("--area-stage-scale");
    desktopRef.current?.style.removeProperty("--area-frame-opacity");
  }
  completeAreaTransitionRef.current = completeAreaTransition;

  function scheduleAreaTransitionCompletion(generation: number) {
    if (areaTransitionTimerRef.current !== null) window.clearTimeout(areaTransitionTimerRef.current);
    areaTransitionTimerRef.current = window.setTimeout(() => {
      if (areaTransitionGenerationRef.current !== generation) return;
      completeAreaTransition();
    }, Math.max(80, 500 * activeTheme.motion));
  }

  function goToSegment(segment: SurfaceSegment, mode: "push" | "replace" = "push", preferredApp?: RunningApp | null, focusDestinationApp = true, animate = true) {
    const currentRoute = routeRef.current;
    if (!currentRoute) return;
    const nextApp = focusDestinationApp ? (preferredApp && appIsInSegment(preferredApp, segment) ? preferredApp : topAppInSegment(runningAppsRef.current, segment)) : null;
    setFocusedApp(nextApp?.id ?? null);
    const destinationRoute = routeForApp(nextApp, { ...currentRoute, ...segment });
    if (segmentKey(segment) === activeSegmentKey || activeTheme.motion === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      completeAreaTransition();
      navigateRoute(destinationRoute, mode);
      return;
    }
    if (!animate) {
      const generation = ++areaTransitionGenerationRef.current;
      const camera = areaCameraPosition(segment, desktopSizeRef.current);
      setAreaTransition({ id: generation, source: activeSegment, target: segment, phase: "interactive", kind: "gesture" });
      setAreaTrackTransform(camera.x, camera.y);
      navigateRoute(destinationRoute, mode);
      window.requestAnimationFrame(() => {
        if (areaTransitionGenerationRef.current !== generation) return;
        completeAreaTransition();
      });
      return;
    }
    setAreaAnnouncement(`Moved to ${homeRelativeAreaLabel(segment)}`);
    const generation = ++areaTransitionGenerationRef.current;
    setAreaTransition({ id: generation, source: activeSegment, target: segment, phase: "preparing", kind: "programmatic" });
    window.requestAnimationFrame(() => {
      if (areaTransitionGenerationRef.current !== generation) return;
      setAreaTransition({ id: generation, source: activeSegment, target: segment, phase: "settling", kind: "programmatic" });
      navigateRoute(destinationRoute, mode);
      scheduleAreaTransitionCompletion(generation);
    });
  }

  function appIsMaximized(app: RunningApp) {
    const local = projectLogicalPosition(app.bounds, desktopSizeRef.current).local;
    return local.x === 0 && local.y === 0 && app.bounds.width === desktopSizeRef.current.width && app.bounds.height === desktopSizeRef.current.height;
  }

  function toggleMaximizeApp(id: string) {
    const app = runningAppsRef.current.find((candidate) => candidate.id === id);
    if (!app) return;
    const size = desktopSizeRef.current;
    const segment = projectLogicalPosition(app.bounds, size).segment;
    const restored = restoredWindowBoundsRef.current.get(id);
    const maximized = appIsMaximized(app);
    const fallback = initialWindowBounds(size, app.kind === "sandbox" ? (app.package.manifest.window ?? { width: 820, height: 620, minWidth: 360, minHeight: 260 }) : builtinAppMaximizeRestoreWindow(app.kind));
    const bounds = maximized ? (restored ?? { ...fallback, ...restoreLogicalPosition(fallback, segment, size) }) : { ...restoreLogicalPosition({ x: 0, y: 0 }, segment, size), width: size.width, height: size.height };
    if (!maximized) restoredWindowBoundsRef.current.set(id, app.bounds);
    else restoredWindowBoundsRef.current.delete(id);
    updateRunningApps((current) => current.map((candidate) => (candidate.id === id ? { ...candidate, bounds } : candidate)));
    if (app.kind === "sandbox") appLifecycle.setHostState({ appId: app.package.manifest.id, instanceId: app.id }, { maximized: !maximized, width: Math.round(bounds.width), height: Math.round(bounds.height) });
    focusApp(id);
  }

  function moveAppToArea(id: string, direction: "left" | "right" | "up" | "down") {
    const app = runningAppsRef.current.find((candidate) => candidate.id === id);
    if (!app) return;
    const size = desktopSizeRef.current;
    const projection = projectLogicalPosition(app.bounds, size);
    const segment = {
      column: projection.segment.column + (direction === "left" ? -1 : direction === "right" ? 1 : 0),
      row: projection.segment.row + (direction === "up" ? -1 : direction === "down" ? 1 : 0),
    };
    const moved = { ...app, bounds: { ...app.bounds, ...restoreLogicalPosition(projection.local, segment, size) } };
    updateRunningApps((current) => current.map((candidate) => (candidate.id === id ? moved : candidate)));
    goToSegment(segment, "push", moved);
  }

  function showDesktop() {
    for (const app of runningAppsRef.current) if (app.kind === "sandbox") appLifecycle.setHostState({ appId: app.package.manifest.id, instanceId: app.id }, { focused: false });
    setFocusedApp(null);
    const currentRoute = routeRef.current;
    if (currentRoute) navigateRoute({ desktopId: activeDesktopIdRef.current, column: currentRoute.column, row: currentRoute.row }, "replace");
  }

  function minimizeCurrentAreaWindows() {
    const currentRoute = routeRef.current;
    if (!currentRoute) return;
    const segment = { column: currentRoute.column, row: currentRoute.row };
    for (const app of runningAppsRef.current) {
      if (app.kind === "sandbox" && appIsInSegment(app, segment)) appLifecycle.setHostState({ appId: app.package.manifest.id, instanceId: app.id }, { focused: false });
    }
    updateRunningApps((current) => current.map((app) => appIsInSegment(app, segment) ? { ...app, minimized: true } : app));
    setFocusedApp(null);
    navigateRoute({ desktopId: activeDesktopIdRef.current, ...segment }, "replace");
  }

  function navigateBack() {
    if (settingsPageRef.current !== "main" && focusedAppIdRef.current === builtinAppTargetId({ kind: "settings" })) {
      navigateSettingsPage("main");
      return;
    }
    const current = window.history.state as Partial<RouteHistoryState> | null;
    if (current?.hiraya && current.parentHash !== undefined) {
      window.history.back();
      return;
    }
    const focusedId = focusedAppIdRef.current;
    if (focusedId) void requestCloseApp(focusedId);
  }

  windowCommandRef.current = { maximize: toggleMaximizeApp, move: moveAppToArea };

  function edgeAt(clientX: number, clientY: number) {
    const desktop = desktopRef.current;
    if (!desktop) return null;
    const bounds = desktop.getBoundingClientRect();
    const threshold = Math.min(36, Math.max(24, Math.min(bounds.width, bounds.height) * 0.06));
    return (
      [
        { direction: "left" as const, distance: clientX - bounds.left },
        { direction: "right" as const, distance: bounds.right - clientX },
        { direction: "up" as const, distance: clientY - bounds.top },
        { direction: "down" as const, distance: bounds.bottom - clientY },
      ]
        .filter((candidate) => candidate.distance <= threshold)
        .sort((a, b) => a.distance - b.distance)[0] ?? null
    );
  }

  function handleDesktopPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest(DESKTOP_GESTURE_EXCLUSION_SELECTOR)) return;
    if (event.pointerType !== "touch") {
      event.preventDefault();
      const additive = event.metaKey || event.ctrlKey;
      const initial = additive && selectionScope === "desktop" ? [...selectedIdsRef.current] : [];
      if (!additive) replaceSelection("desktop", []);
      marqueeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, additive, initial };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    desktopTouchPointersRef.current.add(event.pointerId);
    if (desktopTouchPointersRef.current.size > 1) {
      if (desktopPressRef.current) window.clearTimeout(desktopPressRef.current.timer);
      desktopPressRef.current = null;
      swipeRef.current = null;
      setSwipePreview(null);
      completeAreaTransition();
      if (canvasRef.current) {
        delete canvasRef.current.dataset.swiping;
      }
      return;
    }
    if (!allowBrowserPinchZoom) event.preventDefault();
    swipeRef.current = { axis: null, pointerId: event.pointerId, startSegment: activeSegment, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, previewTarget: null };
    if (event.pointerType !== "touch") return;
    if (!allowBrowserPinchZoom) event.currentTarget.setPointerCapture(event.pointerId);
    const press = {
      activated: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: 0,
    };
    press.timer = window.setTimeout(() => {
      if (desktopPressRef.current !== press) return;
      press.activated = true;
      swipeRef.current = null;
      setSwipePreview(null);
      suppressClickRef.current = true;
      openDesktopContextMenu(press.startX, press.startY);
    }, DESKTOP_LONG_PRESS_MS);
    desktopPressRef.current = press;
  }

  function handleIconDragAtEdge(entry: DesktopEntry, clientX: number, clientY: number) {
    const edge = edgeAt(clientX, clientY);
    if (!edge) {
      edgeDragRef.current.direction = "";
      return null;
    }
    const now = performance.now();
    if (edgeDragRef.current.direction === edge.direction && now - edgeDragRef.current.time < 520) return null;
    const previousSegment = edgeNavigationRef.current?.targetSegment ?? activeSegment;
    const targetSegment = {
      column: previousSegment.column + (edge.direction === "left" ? -1 : edge.direction === "right" ? 1 : 0),
      row: previousSegment.row + (edge.direction === "up" ? -1 : edge.direction === "down" ? 1 : 0),
    };
    if (!edgeNavigationRef.current && routeRef.current) {
      edgeNavigationRef.current = { route: routeRef.current, historyState: window.history.state, draftEntryId: entry.id, focusedAppId: focusedAppIdRef.current };
    }
    const pending = edgeNavigationRef.current;
    if (!pending || pending.draftEntryId !== entry.id) return null;
    pending.targetSegment = targetSegment;
    const sourceSegment = projectLogicalPosition(entry.position, desktopSize).segment;
    const transfer = areaTransferDelta(previousSegment, targetSegment, desktopSize);
    const targetOffset = areaTransferDelta(sourceSegment, targetSegment, desktopSize);
    edgeDragRef.current = { direction: edge.direction, time: now };
    goToSegment(targetSegment, "replace", undefined, true, false);
    return {
      deltaX: transfer.x,
      deltaY: transfer.y,
      minX: targetOffset.x + 8,
      minY: targetOffset.y + 8,
      maxX: targetOffset.x + Math.max(8, desktopSize.width - iconMetrics.width),
      maxY: targetOffset.y + Math.max(8, desktopSize.height - iconMetrics.height),
    };
  }

  function handleWindowDragAtEdge(appId: string, clientX: number, clientY: number, localBounds: WindowBounds) {
    const edge = edgeAt(clientX, clientY);
    if (!edge) {
      windowEdgeDragRef.current.direction = "";
      return null;
    }
    const now = performance.now();
    if (windowEdgeDragRef.current.direction === edge.direction && now - windowEdgeDragRef.current.time < 520) return null;
    const app = runningAppsRef.current.find((candidate) => candidate.id === appId);
    if (!app) return null;
    const previousSegment = windowEdgeNavigationRef.current?.targetSegment ?? segmentForApp(app);
    const targetSegment = {
      column: previousSegment.column + (edge.direction === "left" ? -1 : edge.direction === "right" ? 1 : 0),
      row: previousSegment.row + (edge.direction === "up" ? -1 : edge.direction === "down" ? 1 : 0),
    };
    if (!windowEdgeNavigationRef.current && routeRef.current) {
      windowEdgeNavigationRef.current = { appId, bounds: { ...app.bounds }, route: routeRef.current, historyState: window.history.state };
    }
    const pending = windowEdgeNavigationRef.current;
    if (!pending || pending.appId !== appId) return null;
    const logicalBounds = { ...localBounds, ...restoreLogicalPosition(localBounds, targetSegment, desktopSize) };
    const movedApp = { ...app, bounds: logicalBounds };
    pending.targetSegment = targetSegment;
    windowEdgeDragRef.current = { direction: edge.direction, time: now };
    updateRunningApps((current) => current.map((candidate) => (candidate.id === appId ? movedApp : candidate)));
    goToSegment(targetSegment, "replace", movedApp, true, false);
    return localBounds;
  }

  function finishWindowEdgeNavigation(appId: string, cancelled: boolean) {
    const pending = windowEdgeNavigationRef.current;
    windowEdgeNavigationRef.current = null;
    windowEdgeDragRef.current.direction = "";
    if (!pending || pending.appId !== appId) return;
    const finalRoute = routeRef.current;
    window.history.replaceState(pending.historyState, "", formatDesktopRoute(pending.route));
    if (cancelled || !finalRoute) {
      updateRunningApps((current) => current.map((app) => (app.id === appId ? { ...app, bounds: pending.bounds } : app)));
      setCurrentRoute(pending.route);
      setFocusedApp(appId);
      return;
    }
    writeRoute(finalRoute, "push");
  }

  function finishEdgeNavigation(cancelled: boolean) {
    const pending = edgeNavigationRef.current;
    edgeNavigationRef.current = null;
    edgeDragRef.current.direction = "";
    if (!pending) return;
    const finalRoute = routeRef.current;
    window.history.replaceState(pending.historyState, "", formatDesktopRoute(pending.route));
    if (cancelled || !finalRoute) {
      setCurrentRoute(pending.route);
      setFocusedApp(pending.focusedAppId ?? null);
      return;
    }
    writeRoute(finalRoute, "push");
  }

  function handleDesktopPointerMove(event: React.PointerEvent<HTMLElement>) {
    const marqueePress = marqueeRef.current;
    if (marqueePress?.pointerId === event.pointerId) {
      const left = Math.min(marqueePress.startX, event.clientX);
      const top = Math.min(marqueePress.startY, event.clientY);
      const right = Math.max(marqueePress.startX, event.clientX);
      const bottom = Math.max(marqueePress.startY, event.clientY);
      if (Math.hypot(event.clientX - marqueePress.startX, event.clientY - marqueePress.startY) < 4) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      setMarquee({ left: left - bounds.left, top: top - bounds.top, width: right - left, height: bottom - top });
      const hits = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".file-icon[data-entry-id]"))
        .filter((icon) => {
          const rect = icon.getBoundingClientRect();
          return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
        })
        .map((icon) => icon.dataset.entryId!)
        .filter(Boolean);
      replaceSelection("desktop", [...marqueePress.initial, ...hits]);
      return;
    }
    const press = desktopPressRef.current;
    if (press?.pointerId === event.pointerId) {
      if (press.activated) {
        event.preventDefault();
        return;
      }
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) >= 7) {
        window.clearTimeout(press.timer);
        desktopPressRef.current = null;
      }
    }
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId || !canvasRef.current) return;
    swipe.x = event.clientX;
    swipe.y = event.clientY;
    const deltaX = swipe.x - swipe.startX;
    const deltaY = swipe.y - swipe.startY;
    if (!swipe.axis) {
      swipe.axis = swipeAxis(deltaX, deltaY);
      if (!swipe.axis) return;
      if (areaTransitionTimerRef.current !== null) window.clearTimeout(areaTransitionTimerRef.current);
      areaTransitionTimerRef.current = null;
      const transitionId = ++areaTransitionGenerationRef.current;
      swipe.transitionId = transitionId;
      const primaryDelta = swipe.axis === "x" ? deltaX : deltaY;
      const target = adjacentSwipeArea(swipe.startSegment, swipe.axis, primaryDelta);
      swipe.previewTarget = null;
      setAreaTransition({ id: transitionId, source: swipe.startSegment, target, phase: "interactive", kind: "gesture" });
      canvasRef.current.dataset.swiping = "true";
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const camera = areaCameraDragPosition(swipe.startSegment, desktopSize, { x: deltaX, y: deltaY }, swipe.axis);
    setAreaTrackTransform(camera.x, camera.y);
    const primaryDelta = swipe.axis === "x" ? deltaX : deltaY;
    const viewportDistance = swipe.axis === "x" ? desktopSize.width : desktopSize.height;
    const transitionTarget = adjacentSwipeArea(swipe.startSegment, swipe.axis, primaryDelta);
    if (!areaTransition || segmentKey(areaTransition.target) !== segmentKey(transitionTarget)) {
      setAreaTransition({ id: swipe.transitionId!, source: swipe.startSegment, target: transitionTarget, phase: "interactive", kind: "gesture" });
    }
    setAreaTransitionDepth(areaTransitionDepth(primaryDelta, viewportDistance));
    const previewTarget = swipePreviewReady(primaryDelta, viewportDistance) ? adjacentSwipeArea(swipe.startSegment, swipe.axis, primaryDelta) : null;
    if (segmentKey(previewTarget ?? swipe.startSegment) !== segmentKey(swipe.previewTarget ?? swipe.startSegment)) {
      swipe.previewTarget = previewTarget;
      setSwipePreview(previewTarget);
    }
  }

  function finishDesktopSwipe(event: React.PointerEvent<HTMLElement>, cancelled = false) {
    if (event.pointerType === "touch") desktopTouchPointersRef.current.delete(event.pointerId);
    if (marqueeRef.current?.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      marqueeRef.current = null;
      setMarquee(null);
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      return;
    }
    const press = desktopPressRef.current;
    if (press?.pointerId === event.pointerId) {
      window.clearTimeout(press.timer);
      desktopPressRef.current = null;
      if (press.activated) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        swipeRef.current = null;
        setSwipePreview(null);
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        return;
      }
    }
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const nextSegment = committedSwipeTarget(swipe.previewTarget, cancelled);
    suppressClickRef.current = swipe.axis !== null;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    swipeRef.current = null;
    setSwipePreview(null);
    const transitionTarget = swipe.axis ? adjacentSwipeArea(swipe.startSegment, swipe.axis, swipe.axis === "x" ? swipe.x - swipe.startX : swipe.y - swipe.startY) : swipe.startSegment;
    const generation = swipe.transitionId ?? ++areaTransitionGenerationRef.current;
    if (swipe.axis) {
      setAreaTransition({ id: generation, source: swipe.startSegment, target: transitionTarget, phase: "settling", kind: "gesture" });
      window.requestAnimationFrame(() => {
        if (areaTransitionGenerationRef.current !== generation) return;
        resetAreaTrackTransform();
        setAreaTransitionDepth(0);
      });
    }
    if (canvasRef.current) {
      delete canvasRef.current.dataset.swiping;
      if (!nextSegment) {
        const camera = areaCameraPosition(swipe.startSegment, desktopSize);
        setAreaTrackTransform(camera.x, camera.y);
      }
    }
    if (nextSegment && routeRef.current) {
      const nextApp = topAppInSegment(runningAppsRef.current, nextSegment);
      setFocusedApp(nextApp?.id ?? null);
      setAreaAnnouncement(`Moved to ${homeRelativeAreaLabel(nextSegment)}`);
      navigateRoute(routeForApp(nextApp, { ...routeRef.current, ...nextSegment }));
    }
    if (swipe.axis) {
      scheduleAreaTransitionCompletion(generation);
    }
  }

  function invalidMoveIds(items: readonly DesktopEntry[]) {
    return new Set(items.flatMap((entry) => [entry.id, ...entryIndex.descendants(entry.id).map((descendant) => descendant.id)]));
  }

  async function toggleFullscreen() {
    setError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("Fullscreen mode could not be changed.");
    }
  }

  function runningAppLabel(app: RunningApp) {
    const entry = app.kind === "file" ? entryIndex.byId.get(app.fileId) : app.kind === "properties" ? entryIndex.byId.get(app.entryId) : app.kind === "explorer" && app.folderId ? entryIndex.byId.get(app.folderId) : null;
    return app.kind === "sandbox" ? app.title : app.kind === "settings" ? "Settings" : app.kind === "properties" ? `${entry?.name ?? "Item"} properties` : app.kind === "explorer" ? (entry?.name ?? activeDesktopName) : (entry?.name ?? app.file?.name ?? "File");
  }

  const windowItems: WindowListItem[] = runningApps.map((app) => {
    const area = segmentForApp(app);
    return { id: app.id, title: runningAppLabel(app), areaId: segmentKey(area), areaLabel: `${areaDirectionalLabel(area, activeSegment)} · ${areaCoordinateLabel(area)}`, minimized: app.minimized };
  });
  const focusedApp = runningApps.find((app) => app.id === focusedAppId);
  const taskbarItems = runningApps.map((app) => {
    const entry = app.kind === "file" ? entryIndex.byId.get(app.fileId) : app.kind === "properties" ? entryIndex.byId.get(app.entryId) : app.kind === "explorer" && app.folderId ? entryIndex.byId.get(app.folderId) : null;
    const area = segmentForApp(app);
    return {
      id: app.id,
      title: runningAppLabel(app),
      areaLabel: areaDirectionalLabel(area, activeSegment),
      icon: <AppIcon kind={app.kind} entry={entry} size={16} />,
      active: focusedAppId === app.id && !app.minimized,
      minimized: app.minimized,
      dirty: dirtyAppIds.has(app.id),
      otherArea: segmentKey(area) !== activeSegmentKey,
    };
  });
  const commandContext: AppCommandContext = {
    canMutate,
    canOpenTrash,
    canOpenSettings: true,
    createFile: () => setDialog({ type: "create-file", parentId: null }),
    createFolder: () => setDialog({ type: "create-folder", parentId: null }),
    uploadFiles: () => chooseUpload(null),
    importFolder: () => chooseFolderImport(null),
    openSettings: openSettingsWindow,
    openAreaMap,
    openPanel: setActivePanel,
  };
  const searchCommands = commandService.list(commandContext);
  const keyboardShortcuts: KeyboardShortcut[] = [
    { id: "search", group: "Navigation", label: "Search files, windows, and commands", keys: ["Ctrl/⌘", "K"] },
    { id: "area-switcher", group: "Navigation", label: "Toggle area switcher", keys: ["Ctrl", "Space"] },
    { id: "shortcuts", group: "Navigation", label: "Show keyboard shortcuts", keys: ["?"] },
    { id: "select-all", group: "Files", label: "Select all in the current view", keys: ["Ctrl/⌘", "A"] },
    { id: "copy", group: "Files", label: "Copy selected items", keys: ["Ctrl/⌘", "C"] },
    { id: "paste", group: "Files", label: "Paste items", keys: ["Ctrl/⌘", "V"] },
    { id: "trash", group: "Files", label: "Move selected items to Trash", keys: ["Delete"] },
    { id: "save", group: "Editor", label: "Save the open file", keys: ["Ctrl/⌘", "S"] },
    { id: "maximize", group: "Windows", label: "Maximize or restore focused window", keys: ["Alt", "Enter"] },
    { id: "move-window", group: "Windows", label: "Move focused window between areas", keys: ["Alt", "Arrow key"] },
    { id: "close-window", group: "Windows", label: "Close the focused window", keys: ["Ctrl/⌘", "W"] },
    { id: "dismiss", group: "Windows", label: "Dismiss the current menu or dialog", keys: ["Escape"] },
  ];

  function runSearchCommand(commandId: CommandId) {
    void commandService.execute(commandId, commandContext);
  }

  function openHelp(section: HelpSectionId = "start-here") {
    setHelpSection(section);
    setActivePanel("help");
  }

  function openAreaMap() {
    areaSwitcherInternalActivationRef.current = false;
    areaSwitcherRestoreFocusRef.current = false;
    setMinimapExpanded(true);
  }

  function collapseAreaMap(restoreFocus = isMobile) {
    areaSwitcherInternalActivationRef.current = false;
    if (restoreFocus) areaSwitcherRestoreFocusRef.current = true;
    setMinimapExpanded(false);
  }

  function selectAreaFromSwitcher(segment: SurfaceSegment) {
    goToSegment(segment, "push", undefined, !isMobile);
  }

  function areaSwitcherContains(target: EventTarget | null) {
    return Boolean(target && areaSwitcherRef.current?.contains(target as Node));
  }

  function handleShellAreaSwitcherInteraction(event: React.PointerEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
    areaSwitcherInternalActivationRef.current = false;
    if (minimapExpanded && !areaSwitcherContains(event.target)) collapseAreaMap(false);
  }

  function captureAreaSwitcherActivation(event: React.MouseEvent<HTMLElement>) {
    if (minimapExpanded && areaSwitcherContains(event.target)) areaSwitcherInternalActivationRef.current = true;
  }

  function handleShellAreaSwitcherFocus(event: React.FocusEvent<HTMLElement>) {
    if (!minimapExpanded || areaSwitcherContains(event.target)) return;
    if (areaSwitcherInternalActivationRef.current) {
      areaSwitcherInternalActivationRef.current = false;
      return;
    }
    collapseAreaMap(false);
  }

  function beginAreaSwitcherDrag(event: React.PointerEvent<HTMLButtonElement>, expanded: boolean) {
    if (event.button !== 0) return;
    const switcher = areaSwitcherRef.current;
    const width = switcher?.getBoundingClientRect().width ?? 0;
    const edgeInset = switcher ? Number.parseFloat(window.getComputedStyle(switcher).right) || 0 : 0;
    const travel = Math.max(0, width - 44 + edgeInset);
    areaSwitcherDragRef.current = { expanded, moved: false, pointerId: event.pointerId, startX: event.clientX, travel };
    event.currentTarget.setPointerCapture(event.pointerId);
    areaSwitcherRef.current?.setAttribute("data-dragging", "");
    areaSwitcherRef.current?.style.setProperty("--area-switcher-x", `${expanded ? 0 : travel}px`);
  }

  function moveAreaSwitcherDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = areaSwitcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 6) drag.moved = true;
    const position = areaSwitcherDragPosition(deltaX, drag.expanded, drag.travel);
    areaSwitcherRef.current?.style.setProperty("--area-switcher-x", `${position}px`);
  }

  function finishAreaSwitcherDrag(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = areaSwitcherDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const deltaX = event.clientX - drag.startX;
    areaSwitcherDragRef.current = null;
    suppressAreaSwitcherClickRef.current = drag.moved;
    areaSwitcherRef.current?.removeAttribute("data-dragging");
    if (!cancelled && areaSwitcherDragCommits(deltaX, drag.expanded, drag.travel)) {
      if (drag.expanded) collapseAreaMap();
      else openAreaMap();
    }
    window.requestAnimationFrame(() => areaSwitcherRef.current?.style.removeProperty("--area-switcher-x"));
  }

  function toggleAreaSwitcher() {
    if (suppressAreaSwitcherClickRef.current) {
      suppressAreaSwitcherClickRef.current = false;
      return;
    }
    if (minimapDetailed) collapseAreaMap();
    else openAreaMap();
  }

  function beginExpandedMinimapSwipe(event: React.PointerEvent<HTMLDivElement>) {
    if (!minimapExpanded || event.pointerType !== "touch" || event.button !== 0) return;
    event.stopPropagation();
    minimapSwipeRef.current = {
      axis: null,
      pointerId: event.pointerId,
      startSegment: activeSegment,
      startX: event.clientX,
      startY: event.clientY,
      previewTarget: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveExpandedMinimapSwipe(event: React.PointerEvent<HTMLDivElement>) {
    const swipe = minimapSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const deltaX = event.clientX - swipe.startX;
    const deltaY = event.clientY - swipe.startY;
    if (!swipe.axis) swipe.axis = swipeAxis(deltaX, deltaY);
    if (!swipe.axis) return;
    event.preventDefault();
    const primaryDelta = swipe.axis === "x" ? deltaX : deltaY;
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewportDistance = swipe.axis === "x" ? bounds.width : bounds.height;
    const previewTarget = swipePreviewReady(primaryDelta, viewportDistance) ? adjacentSwipeArea(swipe.startSegment, swipe.axis, primaryDelta) : null;
    if (segmentKey(previewTarget ?? swipe.startSegment) !== segmentKey(swipe.previewTarget ?? swipe.startSegment)) {
      swipe.previewTarget = previewTarget;
      setSwipePreview(previewTarget);
    }
  }

  function finishExpandedMinimapSwipe(event: React.PointerEvent<HTMLDivElement>, cancelled = false) {
    const swipe = minimapSwipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const nextSegment = committedSwipeTarget(swipe.previewTarget, cancelled);
    minimapSwipeRef.current = null;
    setSwipePreview(null);
    if (!swipe.axis) return;
    suppressMinimapClickRef.current = true;
    window.setTimeout(() => {
      suppressMinimapClickRef.current = false;
    }, 0);
    if (nextSegment) selectAreaFromSwitcher(nextSegment);
  }

  function outboxAffectedLabels(record: OutboxRecord) {
    const operation = record.operation;
    const ids = operation.kind === "delete" ? [operation.entryId] : operation.kind === "delete-entries" || operation.kind === "move-entries" || operation.kind === "entry-transfer" ? operation.entryIds : operation.kind === "update-entry" || operation.kind === "save-content" ? [operation.entry.id] : operation.kind === "create" ? operation.entries.map((entry) => entry.id) : [];
    const desktopName = desktopsRef.current.find((desktop) => desktop.id === record.desktopId)?.name ?? record.desktopId;
    const entryNames = record.desktopId === activeDesktopIdRef.current ? ids.map((id) => entriesRef.current.find((entry) => entry.id === id)?.name).filter((name): name is string => Boolean(name)) : [];
    return [`Desktop: ${desktopName}`, ...entryNames];
  }

  const notificationVisibility = boundedNotificationVisibility({ error: Boolean(error), notice: Boolean(notice), trash: trashNotifications.length, apps: appNotifications.length });
  const notificationTotal = notificationVisibility.total;
  const showErrorNotification = notificationVisibility.showError;
  const visibleTrashNotifications = trashNotifications.slice(0, notificationVisibility.visibleTrash);
  const showNoticeNotification = notificationVisibility.showNotice;
  const visibleAppNotifications = appNotifications.slice(0, notificationVisibility.visibleApps);
  const hiddenNotificationCount = notificationVisibility.hidden;
  const hiddenTrashNotifications = trashNotifications.slice(visibleTrashNotifications.length);
  const hiddenAppNotifications = appNotifications.slice(visibleAppNotifications.length);
  const syncTone: StatusTone = syncIndicatorStatus === "online" || syncIndicatorStatus === "local" ? "success" : syncIndicatorStatus === "connecting" || syncIndicatorStatus === "syncing" ? "progress" : "danger";
  const shellAnnouncement = error ? "" : importProgress ? `Import in progress. ${importProgress.folderCount} folders and ${importProgress.fileCount} files.` : notice || (trashNotifications.at(-1) ? `${trashNotifications.at(-1)!.label} moved to Trash` : (appNotifications.at(-1)?.title ?? ""));

  return (
    <main className="desktop-shell" data-mobile-selection-toolbar={showMobileSelectionToolbar || undefined} data-theme={isBuiltinThemeId(appearance.selectedThemeId) ? appearance.selectedThemeId : "custom"} style={themeStyle(activeTheme)} onPointerDownCapture={handleShellAreaSwitcherInteraction} onKeyDownCapture={handleShellAreaSwitcherInteraction} onClickCapture={captureAreaSwitcherActivation} onFocusCapture={handleShellAreaSwitcherFocus}>
      <header className="menu-bar">
        {!isMobile && activeDesktopId && <DesktopSwitcher desktops={desktops} activeDesktopId={activeDesktopId} disabled={loading} quota={catalogQuota} quotaStale={syncStatus === "offline"} onSwitch={(id) => void activateDesktop(id)} onCreate={createDesktop} onRename={renameDesktop} onDelete={deleteDesktop} canManageDesktop={(desktop) => desktop.ownership === "owned" || syncStatus === "online"} />}
        {!isMobile && <DesktopTaskbar
          items={taskbarItems}
          onShowDesktop={minimizeCurrentAreaWindows}
          onActivate={(id) => focusedAppId === id && !runningApps.find((app) => app.id === id)?.minimized ? minimizeApp(id) : focusApp(id)}
        />}
        {isMobile && (
          <nav className="mobile-window-nav" aria-label="Desktop navigation">
            {focusedApp ? <>
              <div className="mobile-window-nav__leading">
                {focusedApp.kind === "settings" && settingsPage !== "main" ? (
                <button type="button" className="mobile-window-nav__desktop" aria-label="Back to Settings" onClick={navigateBack}>
                  <ArrowLeft size={18} />
                  <span>Settings</span>
                </button>
                ) : (
                <button type="button" className="mobile-window-nav__desktop" aria-label={`Back from ${runningAppLabel(focusedApp)}`} onClick={navigateBack}>
                  <ArrowLeft size={18} />
                  <span>Back</span>
                </button>
                )}
              </div>
              <span className="mobile-window-nav__title">{runningAppLabel(focusedApp)}</span>
            </> : activeDesktopId && <DesktopSwitcher desktops={desktops} activeDesktopId={activeDesktopId} mobileSummary={homeRelativeAreaLabel(activeSegment)} disabled={loading} quota={catalogQuota} quotaStale={syncStatus === "offline"} onSwitch={(id) => void activateDesktop(id)} onCreate={createDesktop} onRename={renameDesktop} onDelete={deleteDesktop} canManageDesktop={(desktop) => desktop.ownership === "owned" || syncStatus === "online"} />}
          </nav>
        )}
        <div className="menu-bar__actions">
          {isMobile && focusedApp && <div ref={setMobileHeaderActionsElement} className="mobile-global-actions" />}
          {(!isMobile || !focusedApp) && (
            <MobileHeaderMenu
              label="New"
              icon={
                <>
                  <Plus size={16} weight="bold" />
                  <span>New</span>
                  <CaretDown size={12} />
                </>
              }
            >
              {(dismiss) => (
                <>
                  <button
                    type="button"
                    disabled={!canMutate}
                    onClick={() => {
                      dismiss();
                      setDialog({ type: "create-file", parentId: null });
                    }}
                  >
                    <FileGlyph size={17} /> New text file
                  </button>
                  <button
                    type="button"
                    disabled={!canMutate}
                    onClick={() => {
                      dismiss();
                      setDialog({ type: "create-folder", parentId: null });
                    }}
                  >
                    <FolderPlus size={17} /> New folder
                  </button>
                  <button
                    type="button"
                    disabled={!canMutate}
                    onClick={() => {
                      dismiss();
                      chooseUpload(null);
                    }}
                  >
                    <UploadSimple size={17} /> Upload files
                  </button>
                  <button
                    type="button"
                    disabled={!canMutate}
                    onClick={() => {
                      dismiss();
                      chooseFolderImport(null);
                    }}
                  >
                    <FolderOpen size={17} /> Import folder
                  </button>
                </>
              )}
            </MobileHeaderMenu>
          )}
          <button type="button" aria-label="Search files, windows, and commands" title="Search (Ctrl/Command K)" onClick={() => setActivePanel("search")}>
            <MagnifyingGlass size={17} />
            <span className="desktop-action-label">Search</span>
          </button>
          {!isMobile && (
            <button className="menu-bar__sync" data-status={syncIndicatorStatus} type="button" aria-label="Open Connection and Offline" onClick={() => setActivePanel("sync")}>
              <StatusBadge tone={syncTone} surface="chrome">
                {syncIndicatorStatus === "local" ? <HardDrive size={15} /> : syncIndicatorStatus === "online" ? <CloudCheck size={15} /> : syncIndicatorStatus === "blocked" ? <WarningCircle size={15} weight="fill" /> : syncIndicatorStatus === "connecting" || syncIndicatorStatus === "syncing" ? <SpinnerGap size={15} /> : <CloudSlash size={15} />}
                <span>{syncIndicatorStatus === "local" ? "Saved locally" : syncIndicatorStatus === "syncing" ? "Syncing" : syncIndicatorStatus === "online" ? "Synced" : syncIndicatorStatus === "connecting" ? "Connecting" : syncIndicatorStatus === "blocked" ? "Sync blocked" : "Offline"}</span>
              </StatusBadge>
            </button>
          )}
          {isMobile && (
            <MobileHeaderMenu
              label={`Account, system, and windows; ${runningApps.length} open`}
              icon={
                <span className="mobile-window-nav__count">
                  <DotsThree size={20} />
                  <b>{runningApps.length}</b>
                </span>
              }
            >
              {(dismiss) => (
                <>
                  {session && (
                    <div className="account-menu__identity">
                      <strong>{session.user.displayName}</strong>
                      {session.user.email && <span>{session.user.email}</span>}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      dismiss();
                      showDesktop();
                    }}
                  >
                    <Desktop /> Back to Desktop
                  </button>
                  {focusedAppId && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          dismiss();
                          setActivePanel("windows");
                        }}
                      >
                        <SquaresFour /> Switch Window
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const id = focusedAppId;
                          dismiss();
                          requestCloseApp(id);
                        }}
                      >
                        <X /> Close Window
                      </button>
                    </>
                  )}
                  {windowItems.map((window) => (
                    <button
                      type="button"
                      key={window.id}
                      aria-current={window.id === focusedAppId ? "page" : undefined}
                      title={window.title}
                      onClick={() => {
                        dismiss();
                        focusApp(window.id);
                      }}
                    >
                      <SquaresFour />
                      <span>{window.title}</span>
                      <small>{window.areaLabel}</small>
                    </button>
                  ))}
                  <span className="mobile-header-menu__separator" />
                  <button
                    type="button"
                    onClick={() => {
                      dismiss();
                      setActivePanel("sync");
                    }}
                  >
                    <CloudCheck /> Connection &amp; Offline
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dismiss();
                      openSettingsWindow();
                    }}
                  >
                    <GearSix /> Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dismiss();
                      openHelp();
                    }}
                  >
                    <BookOpenText /> Help
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dismiss();
                      setActivePanel("shortcuts");
                    }}
                  >
                    <Keyboard /> Keyboard shortcuts
                  </button>
                  {canOpenTrash && (
                    <button
                      type="button"
                      onClick={() => {
                        dismiss();
                        setActivePanel("trash");
                      }}
                    >
                      <Trash /> Trash
                    </button>
                  )}
                  {session && activeDesktop?.capabilities.manage && (
                    <button
                      type="button"
                      disabled={!canManage}
                      title={!canManage ? "Connect to manage sharing." : undefined}
                      onClick={() => {
                        dismiss();
                        setSharingOpen(true);
                      }}
                    >
                      <ShareNetwork /> Share desktop
                    </button>
                  )}
                  {session && (
                    <>
                      <span className="mobile-header-menu__separator" />
                      <a className="account-menu__action" href={SERVER_ROUTES.profile} onClick={dismiss}>
                        <IdentificationCard /> Profile
                      </a>
                      <form action={SERVER_ROUTES.logout} method="post" onSubmit={() => lockAuthBootstrap()}>
                        <button className="account-menu__action" type="submit">
                          <SignOut /> Log out
                        </button>
                      </form>
                    </>
                  )}
                </>
              )}
            </MobileHeaderMenu>
          )}
          {!isMobile && <SystemMenu session={session} canOpenTrash={canOpenTrash} canShare={Boolean(session && activeDesktop?.capabilities.manage && canManage)} onSettings={() => openSettingsWindow()} onHelp={() => openHelp()} onShortcuts={() => setActivePanel("shortcuts")} onTrash={() => setActivePanel("trash")} onShare={() => setSharingOpen(true)} />}
          <span className="menu-bar__clock">{formatClock(clock)}</span>
        </div>
      </header>

      <section
        className="desktop"
        data-browser-pinch-zoom={allowBrowserPinchZoom || undefined}
        data-area-transitioning={areaTransition || undefined}
        data-area-transition-phase={areaTransition?.phase}
        data-area-transition-kind={areaTransition?.kind}
        data-wallpaper={layout.wallpaper.source.startsWith("file:") ? (wallpaperUrl ? "file" : "dusk") : layout.wallpaper.source}
        data-custom-loaded={wallpaperUrl ? true : undefined}
        style={
          {
            "--wallpaper-image": wallpaperUrl ? `url(${wallpaperUrl})` : "none",
            "--wallpaper-fit": layout.wallpaper.fit,
            "--wallpaper-position": `${layout.wallpaper.positionX}% ${layout.wallpaper.positionY}%`,
            "--wallpaper-blur": `${layout.wallpaper.blur}px`,
          } as React.CSSProperties
        }
        ref={desktopRef}
        aria-label={`${activeDesktopName} desktop`}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          if (!(event.target as Element).closest(".file-icon, .empty-state__actions, .app-window")) replaceSelection("desktop", []);
        }}
        onContextMenu={(event) => {
          if ((event.target as Element).closest(".file-icon, .empty-state__actions, .app-window")) return;
          event.preventDefault();
          const press = desktopPressRef.current;
          if (press) {
            window.clearTimeout(press.timer);
            press.activated = true;
          }
          swipeRef.current = null;
          openDesktopContextMenu(event.clientX, event.clientY);
        }}
        onDragOver={(event) => {
          if (!canMutate) return;
          event.preventDefault();
          event.currentTarget.dataset.dropActive = "true";
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) delete event.currentTarget.dataset.dropActive;
        }}
        onDrop={(event) => {
          if (!canMutate) return;
          event.preventDefault();
          delete event.currentTarget.dataset.dropActive;
          const bounds = event.currentTarget.getBoundingClientRect();
          void handleExternalDrop(event.dataTransfer, null, {
            x: event.clientX - bounds.left - iconMetrics.width / 2,
            y: event.clientY - bounds.top - iconMetrics.height / 2,
          });
        }}
        onPointerDown={handleDesktopPointerDown}
        onPointerMove={handleDesktopPointerMove}
        onPointerUp={(event) => finishDesktopSwipe(event)}
        onPointerCancel={(event) => finishDesktopSwipe(event, true)}
      >
        <div className="wallpaper-image" aria-hidden="true" />
        <div className="wallpaper-dim" aria-hidden="true" style={{ backgroundColor: "#000000", opacity: layout.wallpaper.dim }} />
        <div
          className="wallpaper-color-overlay"
          aria-hidden="true"
          style={{
            backgroundColor: layout.wallpaper.overlayColor,
            opacity: layout.wallpaper.overlayOpacity,
          }}
        />
        <div className="wallpaper-grain" aria-hidden="true" />
        <div className="desktop-area-stage desktop-area-stage--icons">
          <div
            className="desktop-canvas desktop-area-track"
            ref={canvasRef}
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget || event.propertyName !== "transform" || areaTransition?.phase !== "settling") return;
              completeAreaTransition();
            }}
            style={{
              width: desktopSize.width,
              height: desktopSize.height,
              transform: `translate3d(var(--area-track-x, ${restingCamera.x}px), var(--area-track-y, ${restingCamera.y}px), 0)`,
            }}
          >
          {responsive.segments.map((desktopSegment) => {
            const origin = areaWorldOrigin(desktopSegment.segment, desktopSize);
            const segmentActive = desktopSegment.key === activeSegmentKey;
            return <div className="desktop-area-segment" key={desktopSegment.key} data-active={segmentActive || undefined} aria-hidden={!segmentActive || undefined} inert={!segmentActive} style={{ left: origin.x, top: origin.y, width: desktopSize.width, height: desktopSize.height }}>
            {desktopSegment.entries.map((entry) => {
              const projectedPosition = responsive.positions.get(entry.id) ?? entry.position;
              const renderedEntry = { ...entry, position: projectedPosition };
              return (
                <FileIcon
                  allowBrowserPinchZoom={allowBrowserPinchZoom}
                  key={entry.id}
                  entry={renderedEntry}
                  offlineAvailability={offlineModel.entries[entry.id]}
                  selected={selectedIdSet.has(entry.id)}
                  onSelect={(event) =>
                    selectEntry("desktop", entry, {
                      toggle: event.metaKey || event.ctrlKey,
                    })
                  }
                  onTouchSelect={() =>
                    selectEntry("desktop", entry, {
                      toggle: mobileMultiSelectScope === "desktop",
                    })
                  }
                  onLongPressSelect={() => {
                    beginMobileMultiSelect("desktop");
                    addEntryToSelection("desktop", entry);
                  }}
                  onOpen={() => {
                    replaceSelection("desktop", []);
                    handleOpen(entry);
                  }}
                  onMove={(position, targetParentId) => handleDesktopMove(entry, position, targetParentId)}
                  onDragAtEdge={(clientX, clientY) => handleIconDragAtEdge(entry, clientX, clientY)}
                  onDragEnd={finishEdgeNavigation}
                  getSnapPreview={layout.snapToGrid ? (position) => {
                    const world = { x: origin.x + position.x, y: origin.y + position.y };
                    const snapped = snapRootEntryPosition(world);
                    return { x: snapped.x - origin.x, y: snapped.y - origin.y };
                  } : undefined}
                  onExternalDrop={(dataTransfer) => void handleExternalDrop(dataTransfer, entry.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!selectedIdSet.has(entry.id)) replaceSelection("desktop", [entry.id]);
                    openEntryContextMenu(entry.id, event.clientX, event.clientY);
                  }}
                  onContextMenuAt={(x, y) => {
                    if (!selectedIdSet.has(entry.id)) replaceSelection("desktop", [entry.id]);
                    openEntryContextMenu(entry.id, x, y);
                  }}
                />
              );
            })}
            </div>;
          })}
          </div>
        </div>
        {marquee && (
          <div
            className="desktop-marquee"
            aria-hidden="true"
            style={{
              left: marquee.left,
              top: marquee.top,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}

        {loading && (
          <div className="desktop-state desktop-state--loading" role="status">
            <span className="loading-line" />
            <span className="loading-line loading-line--short" />
            <span className="visually-hidden">Loading desktop...</span>
          </div>
        )}
        {!loading && rootEntries.length === 0 && activeSegment.column === 0 && activeSegment.row === 0 && (
          <div className="desktop-state empty-state">
            <span className="empty-state__icon">
              <HardDrive size={28} weight="duotone" />
            </span>
            <h1>Your space is ready.</h1>
            <p>{offlineSharedNotice || (syncStatus === "local" ? "Create an item, import a folder, or drop files anywhere. Items are saved only in this browser." : canMutate ? "Create an item, import a folder, or drop files anywhere. Items are saved to this shared desktop and synchronized by the Hiraya server." : "This desktop is read only for your account.")}</p>
            <div className="empty-state__actions">
              <button className="button button--primary" type="button" disabled={!canMutate} onClick={() => setDialog({ type: "create-file", parentId: null })}>
                <Plus size={17} /> New text file
              </button>
              <button className="button button--quiet" type="button" disabled={!canMutate} onClick={() => setDialog({ type: "create-folder", parentId: null })}>
                <FolderPlus size={17} /> New folder
              </button>
              <button className="button button--quiet" type="button" disabled={!canMutate} onClick={() => chooseUpload(null)}>
                <UploadSimple size={17} /> Upload files
              </button>
              <button className="button button--quiet" type="button" disabled={!canMutate} onClick={() => chooseFolderImport(null)}>
                <FolderOpen size={17} /> Import folder
              </button>
            </div>
          </div>
        )}
        {!loading && (rootEntries.length > 0 || activeSegment.column !== 0 || activeSegment.row !== 0) && activeDesktopSegment.entries.length === 0 && !runningApps.some((app) => appIsInSegment(app, activeSegment)) && (
          <div className="desktop-state empty-state area-empty-state">
            <span className="empty-state__icon">
              <Desktop size={28} weight="duotone" />
            </span>
            <h1>This area is empty.</h1>
            <p>Place a root item or window here to keep this coordinate region available.</p>
          </div>
        )}
        <div className="drop-message" aria-hidden="true">
          <UploadSimple size={25} /> Drop files or folders to add them
        </div>

        <WindowLayer
          apps={runningApps}
          activeSegment={activeSegment}
          desktopSize={desktopSize}
          focusedAppId={focusedAppId}
          isMobile={isMobile}
          mobileHeaderActionsElement={mobileHeaderActionsElement}
          restingCamera={restingCamera}
          trackRef={windowTrackRef}
          transitionSegmentKeys={transitionSegmentKeys}
          titleForApp={(app) => {
            const folderEntry = app.kind === "explorer" && app.folderId ? entryIndex.byId.get(app.folderId) : null;
            const folder = folderEntry?.kind === "folder" ? folderEntry : null;
            const fileEntry = app.kind === "file" ? (app.file ?? entryIndex.byId.get(app.fileId)) : null;
            const file = fileEntry?.kind === "file" ? fileEntry : null;
            const propertiesEntry = app.kind === "properties" ? entryIndex.byId.get(app.entryId) : null;
            return app.kind === "sandbox" ? app.title : app.kind === "settings" ? (isMobile && settingsPage !== "main" ? (settingsPage === "themes" ? "Themes" : settingsPage === "activity" ? "Activity" : "Apps") : "Settings") : app.kind === "properties" ? `${propertiesEntry?.name ?? "Item"} properties` : app.kind === "explorer" ? (folder?.name ?? activeDesktopName) : (file?.name ?? "Opening file");
          }}
          isMaximized={appIsMaximized}
          onFocus={focusApp}
          onBoundsChange={updateAppBounds}
          onDragAtEdge={handleWindowDragAtEdge}
          onDragEnd={finishWindowEdgeNavigation}
          onMinimize={minimizeApp}
          onClose={requestCloseApp}
          onToggleMaximize={toggleMaximizeApp}
          onMoveArea={moveAppToArea}
          onShowDesktop={navigateBack}
          onSwitchWindow={() => setActivePanel("windows")}
        >
          {(app, headerElements) => {
            const folderEntry = app.kind === "explorer" && app.folderId ? entryIndex.byId.get(app.folderId) : null;
            const folder = folderEntry?.kind === "folder" ? folderEntry : null;
            const propertiesEntry = app.kind === "properties" ? entryIndex.byId.get(app.entryId) : null;
            return (
              <>
                    {app.kind === "sandbox" && <SandboxAppFrame package={app.package} dispatcher={app.dispatcher} title={app.title} csp={app.install.source === "system" && app.install.appId === SYSTEM_APP_IDS.markdownPreview ? TRUSTED_MARKDOWN_CSP : undefined} sandbox={app.install.source === "system" && app.install.appId === SYSTEM_APP_IDS.markdownPreview ? TRUSTED_MARKDOWN_FLAGS : undefined} onNavigation={() => closeApp(app.id)} />}
                    {app.kind === "explorer" && (
                      <FolderExplorer
                        folder={folder}
                        rootLabel={activeDesktopName}
                        breadcrumbs={folder ? entryIndex.ancestors(folder.id).filter((entry): entry is FolderEntry => entry.kind === "folder") : []}
                        children={entryIndex.children.get(folder?.id ?? null) ?? []}
                        selectedIds={selectionScope === app.id ? selectedIdSet : new Set()}
                        mobileMultiSelect={mobileMultiSelectScope === app.id}
                        onSelect={(entry, options) => selectEntry(app.id, entry, options)}
                        onLongPressSelect={(entry) => {
                          beginMobileMultiSelect(app.id);
                          addEntryToSelection(app.id, entry);
                        }}
                        onNavigate={(nextFolder) => {
                          replaceSelection(app.id, []);
                          navigateExplorerWindow(app.id, nextFolder?.id ?? null);
                        }}
                        onOpen={(entry) => {
                          replaceSelection(app.id, []);
                          handleOpen(entry);
                        }}
                        onCreateFolder={(parentId) => setDialog({ type: "create-folder", parentId })}
                        onCreateFile={(parentId) => setDialog({ type: "create-file", parentId })}
                        onUpload={chooseUpload}
                        onImportFolder={chooseFolderImport}
                        onExternalDrop={(dataTransfer, parentId) => void handleExternalDrop(dataTransfer, parentId)}
                        offlineAvailability={offlineModel.entries}
                        onMove={(entry, parentId) => void handleMoveTo(selectionScope === app.id && selectedIdSet.has(entry.id) ? selectedEntries : [entry], parentId)}
                        onContextMenu={(entry, x, y) => {
                          if (selectionScope !== app.id || !selectedIdSet.has(entry.id)) replaceSelection(app.id, [entry.id]);
                          openEntryContextMenu(entry.id, x, y);
                        }}
                        onBlankContextMenu={(parentId, x, y) => {
                          window.getSelection()?.removeAllRanges();
                          replaceSelection(app.id, []);
                          setContextMenu({
                            type: "desktop",
                            parentId,
                            x,
                            y,
                            position: positionFor(parentId),
                          });
                        }}
                        onClearSelection={() => replaceSelection(app.id, [])}
                        readOnly={!canMutate}
                        headerElements={headerElements}
                        view={explorerView}
                        onViewChange={(view) => void changeExplorerView(view)}
                        viewChangeDisabled={!preferencesLoaded}
                      />
                    )}
                    {app.kind === "properties" && propertiesEntry && <PropertiesWindow entry={propertiesEntry} rootLabel={activeDesktopName} ancestors={entryIndex.ancestors(propertiesEntry.id)} descendants={propertiesEntry.kind === "folder" ? entryIndex.descendants(propertiesEntry.id) : []} offlineAvailability={offlineModel.entries[propertiesEntry.id]} offlineBusy={offlineBusy || offlineProgress?.phase === "downloading"} onMakeAvailableOffline={syncStatus !== "local" ? () => void makeAvailableOffline([propertiesEntry.id]) : undefined} onUnpin={offlineModel.entries[propertiesEntry.id]?.directlyPinned ? () => void unpinOffline([propertiesEntry.id]) : undefined} onRemoveOfflineCopy={syncStatus !== "local" ? () => void removeDownloadedCopies([propertiesEntry.id]) : undefined} />}
                    {app.kind === "settings" && (
                      <SettingsWindow
                        page={settingsPage}
                        onPageChange={navigateSettingsPage}
                        mobileHeaderElements={isMobile ? headerElements : undefined}
                        layout={layout}
                        activeDesktopId={activeDesktopId}
                        entries={entries}
                        wallpaperUrl={wallpaperUrl}
                        appearance={appearance}
                        canMutate={canSettings}
                        canViewActivity={canViewActivity}
                        restrictionReason={settingsRestrictionReason(activeDesktop, syncStatus)}
                        exportDisabled={loading}
                        exporting={exporting}
                        fullscreenEnabled={document.fullscreenEnabled}
                        isFullscreen={isFullscreen}
                        updateSupported={updateSupported}
                        updateReady={updateReady}
                        updateChecking={updateChecking}
                        autoUpdate={autoUpdate}
                        externalEmbeddedPreviews={externalEmbeddedPreviews === true}
                        allowBrowserPinchZoom={allowBrowserPinchZoom}
                        localPreferencesLoaded={externalEmbeddedPreviews !== null}
                        searchAllDesktops={searchAllDesktops}
                        desktopSearchAvailable={desktopSearchAvailable}
                        installState={installState}
                        serverBuildTimestamp={serverBuildTimestamp}
                        installedApps={installedApps}
                        quarantinedApps={quarantinedApps}
                        onLaunchApp={(installed) => {
                          if (installed.source === "system") void launchInstalledApp(installed);
                          else {
                            const entry = entriesRef.current.find((candidate): candidate is FileEntry => candidate.id === installed.packageEntryId && candidate.kind === "file");
                            if (entry) void openAppPackage(entry);
                            else setError("That app package is unavailable.");
                          }
                        }}
                        onUninstallApp={(installed) => void removeInstalledApp(installed)}
                        onExportQuarantinedApp={exportQuarantinedApp}
                        onRemoveQuarantinedApp={(app) => void discardQuarantinedApp(app)}
                        fileAssociations={fileAssociations}
                        onResetApp={(installed) =>
                          void requestConfirmation({
                            title: `Reset ${installed.manifest.name}?`,
                            message: "This clears only the app's local data for this browser and account. Your files and file-type preferences remain.",
                            confirmLabel: "Reset data",
                            danger: true,
                          }).then(async (confirmed) => {
                            if (confirmed) {
                              await clearAppData(installed.appId);
                              setNotice(`${installed.manifest.name} data reset`);
                            }
                          })
                        }
                        onSetFileAssociation={(matcher, appId) => void saveAssociation(matcher, appId)}
                        onRemoveFileAssociation={(matcher) => void deleteAssociation(matcher)}
                        onResetFileAssociations={() => void clearAssociations()}
                        onListActivity={
                          canViewActivity
                            ? listActivity
                            : async () => {
                                throw new Error("Activity is unavailable for your role.");
                              }
                        }
                        onSubscribeToActivity={canViewActivity ? subscribeToActivityChanges : () => () => undefined}
                        canOpenAffectedEntries={(activity) =>
                          canOpenActivity(
                            activity,
                            activeDesktopIdRef.current,
                            entriesRef.current,
                            desktops.map((desktop) => desktop.id),
                          )
                        }
                        onOpenAffectedEntries={async (activity, ids) => {
                          if (!activity.desktopId) return;
                          if (activity.desktopId !== activeDesktopIdRef.current && !(await activateDesktop(activity.desktopId))) return;
                          const affected = ids.map((id) => entriesRef.current.find((entry) => entry.id === id)).filter((entry): entry is DesktopEntry => Boolean(entry));
                          if (affected.length === 1) handleOpen(affected[0]);
                          else if (affected.length > 1) {
                            replaceSelection(
                              "desktop",
                              affected.map((entry) => entry.id),
                            );
                            const root = affected.find((entry) => entry.parentId === null);
                            if (root) goToSegment(projectLogicalPosition(root.position, desktopSizeRef.current).segment);
                          } else setError("The entries affected by this activity no longer exist.");
                        }}
                        onConfirmThemeDelete={(theme) =>
                          requestConfirmation({
                            title: `Delete ${theme.name}?`,
                            message: `Delete the custom theme “${theme.name}”?`,
                            confirmLabel: "Delete theme",
                            danger: true,
                          })
                        }
                        onLayoutPreview={previewLayout}
                        onLayoutChange={persistLayout}
                        onWallpaperUpload={handleWallpaperUpload}
                        onWallpaperSelect={handleWallpaperSelect}
                        onThemeSelect={changeTheme}
                        onThemeSave={persistCustomTheme}
                        onThemeDelete={removeCustomTheme}
                        onExport={() => void handleExport()}
                        onToggleFullscreen={() => void toggleFullscreen()}
                        onCheckForUpdate={() => void checkForUpdate()}
                        onAutoUpdateChange={(enabled) => void changeAutoUpdate(enabled)}
                        onExternalEmbeddedPreviewsChange={(enabled) => void changeExternalEmbeddedPreviews(enabled)}
                        onAllowBrowserPinchZoomChange={(enabled) => void changeAllowBrowserPinchZoom(enabled)}
                        onSearchAllDesktopsChange={(enabled) => void changeSearchAllDesktops(enabled)}
                        onOpenGettingStarted={() => setShowGettingStarted(true)}
                        onInstall={() => void installPwa()}
                        onOpenOfflineStorage={() => setActivePanel("offline")}
                        onOpenHelp={openHelp}
                      />
                    )}
              </>
            );
          }}
        </WindowLayer>
        {areaTransition && (
          <div className="desktop-area-stage desktop-area-stage--frames" aria-hidden="true">
            <div
              className="desktop-area-frame-track desktop-area-track"
              ref={frameTrackRef}
              style={{
                width: desktopSize.width,
                height: desktopSize.height,
                transform: `translate3d(var(--area-track-x, ${restingCamera.x}px), var(--area-track-y, ${restingCamera.y}px), 0)`,
              }}
            >
              {[areaTransition.source, areaTransition.target].filter((segment, index, segments) => segments.findIndex((candidate) => segmentKey(candidate) === segmentKey(segment)) === index).map((segment) => (
                <div
                  className="desktop-area-frame"
                  key={segmentKey(segment)}
                  style={{
                    left: segment.column * desktopSize.width,
                    top: segment.row * desktopSize.height,
                    width: desktopSize.width,
                    height: desktopSize.height,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {swipePreview && (
          <div className="desktop-swipe-preview" role="status">
            <SquaresFour size={20} weight="duotone" />
            <span>
              Release for <strong>{homeRelativeAreaLabel(swipePreview)}</strong>
            </span>
          </div>
        )}
      </section>

      {(isMobile || activeDesktopId) && <AreaSwitcher
        activeSegment={activeSegment}
        activeSegmentKey={activeSegmentKey}
        apps={runningApps}
        desktopName={activeDesktopName}
        desktopSize={desktopSize}
        detailed={minimapDetailed}
        dirtyAppIds={dirtyAppIds}
        focusedApp={focusedApp}
        focusedAppId={focusedAppId}
        handleRef={areaSwitcherHandleRef}
        isMobile={isMobile}
        obscured={minimapObscured}
        occupiedSegmentKeys={new Set(occupiedSegments.map((segment) => segment.key))}
        positions={responsive.positions}
        rootRef={areaSwitcherRef}
        segments={minimapSegments}
        minColumn={minimapMinColumn}
        minRow={minimapMinRow}
        columnCount={minimapColumnCount}
        rowCount={minimapRowCount}
        swipePreview={swipePreview}
        windowLimit={minimapWindowLimit}
        getAppEntry={(app) => app.kind === "file" ? (entryIndex.byId.get(app.fileId) ?? null) : app.kind === "properties" ? (entryIndex.byId.get(app.entryId) ?? null) : app.kind === "explorer" && app.folderId ? (entryIndex.byId.get(app.folderId) ?? null) : null}
        getAppLabel={runningAppLabel}
        getAppSegment={segmentForApp}
        isAppMaximized={appIsMaximized}
        onBeginDrag={beginAreaSwitcherDrag}
        onMoveDrag={moveAreaSwitcherDrag}
        onFinishDrag={finishAreaSwitcherDrag}
        onToggle={toggleAreaSwitcher}
        onBeginGridSwipe={beginExpandedMinimapSwipe}
        onMoveGridSwipe={moveExpandedMinimapSwipe}
        onFinishGridSwipe={finishExpandedMinimapSwipe}
        onSelectArea={(segment, event) => {
          if (suppressMinimapClickRef.current) {
            suppressMinimapClickRef.current = false;
            event.preventDefault();
            return;
          }
          selectAreaFromSwitcher(segment);
        }}
        onFocusApp={focusApp}
        onMinimizeApp={minimizeApp}
        onToggleMaximizeApp={toggleMaximizeApp}
        onCloseApp={requestCloseApp}
        onShowAllWindows={() => setActivePanel("windows")}
      />}
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {areaAnnouncement}
      </span>

      <input
        ref={uploadRef}
        className="visually-hidden"
        type="file"
        multiple
        aria-label="Upload files"
        onChange={(event) => {
          const context = importOperationRef.current ?? captureImportOperation(uploadParentRef.current, uploadPositionRef.current);
          uploadPositionRef.current = undefined;
          const files = Array.from(event.target.files ?? []);
          if (files.length)
            void handleImportSources(
              files.map((file) => ({ relativePath: file.name, file })),
              context,
            );
          event.target.value = "";
        }}
      />
      <input
        ref={(element) => {
          directoryRef.current = element;
          element?.setAttribute("webkitdirectory", "");
        }}
        className="visually-hidden"
        type="file"
        multiple
        aria-label="Import folder"
        onChange={(event) => {
          const context = importOperationRef.current ?? captureImportOperation(uploadParentRef.current, uploadPositionRef.current);
          uploadPositionRef.current = undefined;
          const files = Array.from(event.target.files ?? []);
          if (files.length) void handleImportSources(sourcesFromDirectoryPicker(files), context);
          else reportFolderImportError("No files were selected. This browser fallback cannot represent empty folders; use a browser with the File System Access folder picker or drag the folder onto Hiraya.");
          event.target.value = "";
        }}
      />

      {showMobileSelectionToolbar && (
        <MobileSelectionToolbar count={mobileFileSelection.length} selectionMode={mobileSelectionMode}>
          <button type="button" title="Copy" aria-label={`Copy ${mobileFileSelection.length} selected ${mobileFileSelection.length === 1 ? "item" : "items"}`} onClick={() => void copySelection()}>
            <Copy size={20} />
          </button>
          <button
            type="button"
            title="Move"
            aria-label={`Move ${mobileFileSelection.length} selected ${mobileFileSelection.length === 1 ? "item" : "items"}`}
            disabled={!canMutate}
            onClick={() => {
              setMoveDialogSubmitting(false);
              setMoveDialogEntryIds(mobileFileSelection.map((entry) => entry.id));
            }}
          >
            <FolderSimplePlus size={20} />
          </button>
          <button
            className="mobile-selection-toolbar__danger"
            type="button"
            title={syncStatus !== "local" ? "Move to Trash" : "Delete permanently"}
            aria-label={`${syncStatus !== "local" ? "Move to Trash" : "Delete permanently"}: ${mobileFileSelection.length} selected ${mobileFileSelection.length === 1 ? "item" : "items"}`}
            disabled={!canMutate}
            onClick={() =>
              setDialog({
                type: "delete",
                entryIds: mobileFileSelection.map((entry) => entry.id),
              })
            }
          >
            <Trash size={20} />
          </button>
          <button type="button" title="More actions" aria-label="More actions" aria-haspopup="dialog" onClick={() => openEntryContextMenu(mobileFileSelection[0].id, window.innerWidth / 2, window.innerHeight - 20)}>
            <DotsThree size={22} weight="bold" />
          </button>
        </MobileSelectionToolbar>
      )}
      {showMobilePasteToolbar && (
        <div className="mobile-selection-toolbar mobile-selection-toolbar--paste" role="toolbar" aria-label="Clipboard actions">
          <button className="mobile-selection-toolbar__primary" type="button" onClick={() => void beginPaste(focusedExplorer?.folderId ?? null)}>
            <ClipboardText size={20} />
            <span>Paste</span>
          </button>
          <button type="button" title="Dismiss paste action" aria-label="Dismiss paste action" onClick={() => setClipboardOffer((current) => dismissClipboardOffer(current))}>
            <X size={19} />
          </button>
        </div>
      )}

      {(notificationTotal > 0 || importProgress || showUpdateToast) && (
        <aside className="shell-status-region" aria-label="Notifications and progress">
          {notificationTotal > 0 && (
            <div className="notification-stack">
              {showErrorNotification && (
                <NotificationCard
                  badge="Error"
                  tone="danger"
                  icon={<WarningCircle size={18} weight="fill" />}
                  role="alert"
                  dismissLabel="Dismiss error"
                  onDismiss={() => {
                    setError("");
                    setFolderImportError("");
                  }}
                  actions={
                    error === folderImportError ? (
                      <button className="notification-action" type="button" onClick={() => openHelp("files-and-folders")}>
                        Folder import help
                      </button>
                    ) : undefined
                  }
                >
                  <span>{error}</span>
                </NotificationCard>
              )}
              {visibleTrashNotifications.map((notification) => (
                <NotificationCard
                  badge={notification.state === "failed" ? "Restore failed" : notification.state === "running" ? "Restoring" : "Undo available"}
                  tone={notification.state === "failed" ? "danger" : notification.state === "running" ? "progress" : "neutral"}
                  key={notification.id}
                  dismissLabel={`Dismiss Trash notification for ${notification.label}`}
                  dismissDisabled={notification.state === "running"}
                  onDismiss={() => setTrashNotifications((current) => dismissTrashNotification(current, notification.id))}
                  actions={
                    <>
                      <button className="notification-action notification-action--primary" type="button" disabled={notification.state === "running"} onClick={() => void undoMoveToTrash(notification)}>
                        {notification.state === "failed" ? "Retry Undo" : "Undo"}
                      </button>
                      <button className="notification-action" type="button" disabled={notification.state === "running"} onClick={() => void openTrashNotification(notification)}>
                        View Trash
                      </button>
                    </>
                  }
                >
                  <strong>{notification.label} moved to Trash</strong>
                  <span>{notification.state === "running" ? "Restoring..." : notification.error || "Undo remains available until dismissed."}</span>
                </NotificationCard>
              ))}
              {showNoticeNotification && (
                <NotificationCard badge="Saved" role="status" dismissLabel="Dismiss notice" onDismiss={() => setNotice("")}>
                  <span>{notice}</span>
                </NotificationCard>
              )}
              {visibleAppNotifications.map((notification) => (
                <NotificationCard badge="App" key={notification.id} dismissLabel="Dismiss app notification" onDismiss={() => appHostServices.notifications.dismiss(notification.owner, notification.id)}>
                  <strong>{notification.title}</strong>
                  {notification.body && <span>{notification.body}</span>}
                </NotificationCard>
              ))}
              {hiddenNotificationCount > 0 && (
                <details className="notification-card notification-drawer">
                  <summary>
                    {hiddenNotificationCount} more {hiddenNotificationCount === 1 ? "notification" : "notifications"}
                  </summary>
                  <div className="notification-drawer__list" aria-label="Notification history">
                    {!showNoticeNotification && notice && (
                      <div>
                        <StatusBadge>Saved</StatusBadge>
                        <span>{notice}</span>
                      </div>
                    )}
                    {hiddenTrashNotifications.map((notification) => (
                      <div key={notification.id}>
                        <StatusBadge tone={notification.state === "failed" ? "danger" : "neutral"}>Trash</StatusBadge>
                        <span>{notification.label}</span>
                        <button type="button" disabled={notification.state === "running"} onClick={() => void undoMoveToTrash(notification)}>
                          {notification.state === "failed" ? "Retry Undo" : "Undo"}
                        </button>
                        <button type="button" onClick={() => void openTrashNotification(notification)}>
                          View
                        </button>
                        <button className="notification-dismiss" type="button" disabled={notification.state === "running"} aria-label={`Dismiss notification for ${notification.label}`} onClick={() => setTrashNotifications((current) => dismissTrashNotification(current, notification.id))}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    {hiddenAppNotifications.map((notification) => (
                      <div key={notification.id}>
                        <StatusBadge>App</StatusBadge>
                        <span>{[notification.title, notification.body].filter(Boolean).join(": ")}</span>
                        <button className="notification-dismiss" type="button" aria-label="Dismiss app notification" onClick={() => appHostServices.notifications.dismiss(notification.owner, notification.id)}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          {importProgress && (
            <NotificationCard badge="Importing" tone="progress" icon={<SpinnerGap className="notification-card__spinner" size={18} />} role="status">
              <strong>{importProgress.phase === "preparing" ? "Preparing import" : importProgress.phase === "saving" ? "Staging and saving import" : "Staging and synchronizing import"}</strong>
              <span>
                {importProgress.folderCount} {importProgress.folderCount === 1 ? "folder" : "folders"}, {importProgress.fileCount} {importProgress.fileCount === 1 ? "file" : "files"}, {formatImportBytes(importProgress.totalBytes)}
              </span>
            </NotificationCard>
          )}
          {showUpdateToast && (
            <UpdateToast
              applying={updateApplying}
              blocked={updateBlocked}
              onConfirm={() => void activateUpdate()}
              onDismiss={() => {
                setShowUpdateToast(false);
                setUpdateBlocked(false);
              }}
            />
          )}
          <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            {shellAnnouncement}
          </span>
        </aside>
      )}

      {contextMenu?.type === "entry" && contextMenuEntry && (
        <ContextMenu
          menu={contextMenu}
          entry={contextMenuEntry}
          onOpen={() => {
            replaceSelection(selectionScope, []);
            handleOpen(contextMenuEntry);
          }}
          onEditFile={contextMenuEntry.kind === "file" && fileCapabilities(contextMenuEntry).editable ? () => {
            replaceSelection(selectionScope, []);
            handleEditFile(contextMenuEntry);
          } : undefined}
          openWith={
            contextMenuEntry.kind === "file"
              ? matchingInstalledApps(installedApps, entries, contextMenuEntry).map((app) => ({
                  id: app.appId,
                  label: app.manifest.name,
                  preferred: resolveFileApp(contextMenuEntry, installedApps, entries, fileAssociations)?.app.appId === app.appId,
                  onOpen: () => {
                    replaceSelection(selectionScope, []);
                    void openFileWithApp(app, contextMenuEntry);
                  },
                  onSetPreferred: () => {
                    const matcher = associationCandidates(contextMenuEntry)[0];
                    setContextMenu(null);
                    if (!matcher) return;
                    void saveAssociation(matcher, app.appId).then(() => {
                      setNotice(`${app.manifest.name} will open ${matcher} files`);
                    });
                  },
                }))
              : undefined
          }
          onRename={() => {
            setDialog({ type: "rename", entryId: contextMenuEntry.id });
            setContextMenu(null);
          }}
          onDownload={contextMenuEntry.kind === "file" ? () => void download(contextMenuEntry) : undefined}
          onCopy={() => void copySelection()}
          onCopyLink={contextMenuEntries.length === 1 ? () => void copyDeepLink(contextMenuEntry) : undefined}
          onMakeAvailableOffline={syncStatus !== "local" && contextMenuEntries.some((entry) => !offlineModel.entries[entry.id]?.pinned) ? () => void makeAvailableOffline(contextMenuEntries.map((entry) => entry.id)) : undefined}
          onUnpinOffline={contextMenuEntries.some((entry) => offlineModel.entries[entry.id]?.directlyPinned) ? () => void unpinOffline(contextMenuEntries.map((entry) => entry.id)) : undefined}
          onRemoveOfflineCopy={
            syncStatus !== "local" &&
            contextMenuEntries.some((entry) => {
              const availability = offlineModel.entries[entry.id];
              return availability?.cached && !availability.pinned && !availability.protected;
            })
              ? () => void removeDownloadedCopies(contextMenuEntries.map((entry) => entry.id))
              : undefined
          }
          onOpenOfflineStorage={() => {
            setActivePanel("offline");
            setContextMenu(null);
          }}
          offlineBusy={offlineBusy || offlineProgress?.phase === "downloading"}
          onPasteInto={contextMenuEntry.kind === "folder" && clipboardRef.current ? () => void beginPaste(contextMenuEntry.id) : undefined}
          onUploadInto={
            contextMenuEntry.kind === "folder"
              ? () => {
                  chooseUpload(contextMenuEntry.id);
                  setContextMenu(null);
                }
              : undefined
          }
          onImportFolderInto={
            contextMenuEntry.kind === "folder"
              ? () => {
                  chooseFolderImport(contextMenuEntry.id);
                  setContextMenu(null);
                }
              : undefined
          }
          onMove={() => {
            setMoveDialogSubmitting(false);
            setMoveDialogEntryIds(contextMenuEntries.map((entry) => entry.id));
            setContextMenu(null);
          }}
          onProperties={() => {
            openPropertiesWindow(contextMenuEntry.id);
            setContextMenu(null);
          }}
          onDelete={() => {
            setDialog({
              type: "delete",
              entryIds: contextMenuEntries.map((entry) => entry.id),
            });
            setContextMenu(null);
          }}
          selectionCount={contextMenuEntries.length}
          trashSupported={syncStatus !== "local"}
          readOnly={!canMutate}
          onClose={() => setContextMenu(null)}
        />
      )}
      {contextMenu?.type === "desktop" && (
        <DesktopContextMenu
          menu={contextMenu}
          onCreateFile={() => {
            setDialog({
              type: "create-file",
              parentId: contextMenu.parentId,
              position: contextMenu.parentId === null ? restoreLogicalPosition(contextMenu.position, activeSegment, desktopSize) : contextMenu.position,
            });
            setContextMenu(null);
          }}
          onCreateFolder={() => {
            setDialog({
              type: "create-folder",
              parentId: contextMenu.parentId,
              position: contextMenu.parentId === null ? restoreLogicalPosition(contextMenu.position, activeSegment, desktopSize) : contextMenu.position,
            });
            setContextMenu(null);
          }}
          onUpload={() => {
            chooseUpload(contextMenu.parentId, contextMenu.position);
            setContextMenu(null);
          }}
          onImportFolder={() => {
            chooseFolderImport(contextMenu.parentId, contextMenu.position);
            setContextMenu(null);
          }}
          onSettings={() => {
            openSettingsWindow();
            setContextMenu(null);
          }}
          onPaste={clipboardRef.current ? () => void beginPaste(contextMenu.parentId, contextMenu.parentId === null ? contextMenu.position : undefined) : undefined}
          readOnly={!canMutate}
          onClose={() => setContextMenu(null)}
        />
      )}
      {dialog && (!(dialog.type === "rename" || dialog.type === "delete") || dialogEntry) && <FileDialog dialog={dialog} entry={dialogEntry} entryCount={dialog.type === "delete" ? dialog.entryIds.length : 1} trashSupported={syncStatus !== "local"} onClose={() => setDialog(null)} onSubmit={handleDialogSubmit} />}
      {appDialogRequests[0] && appDialogRequests[0].kind !== "confirm" && (
        <AppPickerDialog
          request={appDialogRequests[0]}
          entries={entries}
          onCancel={() => appHostServices.dialogs.reject(appDialogRequests[0].id)}
          onOpenFiles={(files) => {
            const request = appDialogRequests[0];
            const running = runningAppsRef.current.find((app): app is SandboxApp => app.kind === "sandbox" && app.id === request.owner.instanceId);
            if (!running) {
              appHostServices.dialogs.reject(request.id);
              return;
            }
            appCapabilities.setInstanceMutationAllowed(request.owner.instanceId, canMutateRef.current);
            appHostServices.dialogs.respond(request.id, grantPickedFiles(appCapabilities, request.owner.instanceId, running.package.manifest.permissions, files));
          }}
          onOpenFolder={(folder) => {
            const request = appDialogRequests[0];
            const running = runningAppsRef.current.find((app): app is SandboxApp => app.kind === "sandbox" && app.id === request.owner.instanceId);
            if (!running) {
              appHostServices.dialogs.reject(request.id);
              return;
            }
            appCapabilities.setInstanceMutationAllowed(request.owner.instanceId, canMutateRef.current);
            appHostServices.dialogs.respond(request.id, grantPickedFolder(appCapabilities, request.owner.instanceId, running.package.manifest.permissions, folder));
          }}
          onSave={async (name, folder) => {
            const request = appDialogRequests[0];
            if (request.kind !== "saveFile") return;
            const running = runningAppsRef.current.find((app): app is SandboxApp => app.kind === "sandbox" && app.id === request.owner.instanceId);
            if (!running) {
              appHostServices.dialogs.reject(request.id);
              return;
            }
            if (!running.package.manifest.permissions.includes("files:write") || !canMutateRef.current) throw new HostServiceError("The app cannot create files on this desktop right now.", "PERMISSION_DENIED");
            const file = await createAppFile(
              name,
              folder?.id ?? null,
              positionFor(folder?.id ?? null),
              new Blob([], {
                type: request.params.mimeType ?? "application/octet-stream",
              }),
              request.params.mimeType,
            );
            appHostServices.dialogs.respond(request.id, grantPickedFiles(appCapabilities, request.owner.instanceId, running.package.manifest.permissions, [file])[0]);
          }}
        />
      )}
      {moveDialogEntries.length > 0 && (
        <MoveDialog
          desktops={desktops
            .filter((desktop) => desktop.capabilities.write && (desktop.ownership === "owned" || syncStatus === "online"))
            .map((desktop) => ({
              ...desktop,
              folders: (desktopMoveFolders[desktop.id] ?? []).filter((entry): entry is Extract<DesktopEntry, { kind: "folder" }> => entry.kind === "folder"),
            }))}
          activeDesktopId={activeDesktopId}
          entries={moveDialogEntries}
          invalidIds={invalidMoveIds(moveDialogEntries)}
          loading={moveDestinationsLoading}
          onClose={() => {
            setMoveDialogSubmitting(false);
            setMoveDialogEntryIds([]);
          }}
          onMove={async (desktopId, parentId) => {
            const destination = desktops.find((desktop) => desktop.id === desktopId);
            if (!destination?.capabilities.write || (destination.ownership === "shared" && syncStatus !== "online")) throw new Error("You cannot write to that destination desktop right now.");
            if (desktopId === activeDesktopId) await handleMoveTo(moveDialogEntries, parentId, true);
            else {
              const next = await transferEntries(
                desktopId,
                moveDialogEntries.map((entry) => entry.id),
                parentId,
              );
              entriesRef.current = next.entries;
              layoutRef.current = next.layout;
              setEntries(next.entries);
              setLayout(next.layout);
              replaceSelection(selectionScope, []);
              setNotice(`${moveDialogEntries.length === 1 ? moveDialogEntries[0].name : `${moveDialogEntries.length} items`} moved to ${desktops.find((desktop) => desktop.id === desktopId)?.name ?? "desktop"}`);
            }
            setMoveDialogSubmitting(false);
            setMoveDialogEntryIds([]);
          }}
          onSubmittingChange={setMoveDialogSubmitting}
        />
      )}
      {pendingPaste && <PasteConflictDialog roots={pendingPaste.snapshot.selectedRootIds.map((id) => pendingPaste.snapshot.entries.find((entry) => entry.id === id)!)} existingNames={entries.filter((entry) => entry.parentId === pendingPaste.parentId).map((entry) => entry.name)} onClose={() => setPendingPaste(null)} onPaste={(names) => commitPaste(pendingPaste.snapshot, pendingPaste.parentId, pendingPaste.position, names)} />}
      {activePanel === "search" && (
        <SearchCommandPalette
          entries={entries}
          activeDesktopId={activeDesktopId}
          activeDesktopName={activeDesktopName}
          activeAuthorityCatalogId={activeDesktop?.authorityCatalogId ?? null}
          cachedDesktopResults={cachedSearchResults}
          searchAllDesktops={searchAllDesktops}
          allDesktopsAvailable={desktopSearchAvailable}
          online={syncStatus === "online"}
          onSearchAllDesktops={searchAccessibleDesktops}
          onSearchAllDesktopsChange={(enabled) => void changeSearchAllDesktops(enabled)}
          windows={windowItems.map((window) => ({
            id: window.id,
            title: window.title,
            detail: window.areaLabel,
          }))}
          commands={searchCommands}
          onOpenEntry={(result) => void openSearchResult(result)}
          onFocusWindow={focusApp}
          onRunCommand={runSearchCommand}
          onClose={() => setActivePanel(null)}
        />
      )}
      {(activePanel === "sync" || activePanel === "offline") && (
        <PanelDialog title="Connection and Offline" onClose={() => setActivePanel(null)}>
          <ConnectionPanel
            status={syncStatus}
            records={outboxRecords}
            lastSyncedAt={lastSyncedAt}
            affectedLabels={outboxAffectedLabels}
            entries={entries}
            inventory={offlineInventory}
            model={offlineModel}
            progress={offlineProgress}
            online={syncStatus === "online"}
            persistence={storagePersistence}
            onRetryRecord={(record) => void retryBlockedOutboxRecord(record.operationId).catch((reason) => setError(reason instanceof Error ? reason.message : "The queued change could not be retried."))}
            onDiscardRecord={(record) => {
              const removesDesktop = record.error?.startsWith("Access to this desktop was revoked.") || record.operation.kind === "create-desktop";
              void requestConfirmation({
                title: removesDesktop ? "Remove local desktop?" : "Discard queued change?",
                message: removesDesktop ? "This removes this desktop's local projection and every queued change that depends on it. These changes have not reached the server and cannot be recovered." : "Discard this blocked local change and restore the server version? This cannot be undone.",
                confirmLabel: removesDesktop ? "Remove local desktop" : "Discard change",
                danger: true,
              }).then(async (confirmed) => {
                if (!confirmed) return;
                try {
                  setOutboxRecords(await discardBlockedOutboxRecord(record.operationId));
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "The queued change could not be discarded.");
                }
              });
            }}
            onRetryDownloads={() => void refreshPinnedContent()}
            onUnpin={(ids) => void unpinOffline(ids)}
            onReleaseAll={() => void removeDownloadedCopies()}
            onOpenHelp={() => openHelp("offline")}
          />
        </PanelDialog>
      )}
      {activePanel === "windows" && (
        <PanelDialog title="All windows" onClose={() => setActivePanel(null)}>
          <AllWindowsPanel
            windows={windowItems}
            activeAreaId={activeSegmentKey}
            focusedWindowId={focusedAppId ?? undefined}
            onFocusWindow={(id) => {
              focusApp(id);
              setActivePanel(null);
            }}
            onNavigateArea={(areaId) => {
              const target = occupiedSegments.find((area) => area.key === areaId);
              if (target) goToSegment(target.segment);
            }}
          />
        </PanelDialog>
      )}
      {activePanel === "help" && (
        <PanelDialog title="User Guide" onClose={() => setActivePanel(null)}>
          <HelpPanel section={helpSection} onSectionChange={setHelpSection} />
        </PanelDialog>
      )}
      {activePanel === "shortcuts" && (
        <PanelDialog title="Keyboard shortcuts" onClose={() => setActivePanel(null)}>
          <KeyboardShortcutsPanel shortcuts={keyboardShortcuts} />
        </PanelDialog>
      )}
      {activePanel === "trash" && activeDesktop?.capabilities.read && syncStatus !== "local" && (
        <PanelDialog title="Trash" onClose={() => setActivePanel(null)}>
          <TrashWindow
            readOnly={!canMutate}
            onListTrash={() => listTrash(activeDesktopId)}
            onRestore={async (item, destination) => {
              await restoreTrash(activeDesktopId, item.entry.id, destination);
              setNotice(`${item.entry.name} restored`);
            }}
            onPermanentlyDelete={async (item) => {
              await permanentlyDeleteTrash(activeDesktopId, item.entry.id);
              setNotice(`${item.entry.name} permanently deleted`);
            }}
            onRequestPermanentDelete={(item: TrashItem, confirmedDelete) => {
              void requestConfirmation({
                title: `Delete ${item.entry.name} permanently?`,
                message: "This item and everything inside it will be permanently deleted. This cannot be undone.",
                confirmLabel: "Delete permanently",
                danger: true,
              }).then((confirmed) => {
                if (confirmed) void confirmedDelete().catch(() => undefined);
              });
            }}
          />
        </PanelDialog>
      )}
      {sharingOpen && activeDesktop?.capabilities.manage && (
        <SharingDialog
          desktop={activeDesktop}
          onClose={() => setSharingOpen(false)}
          onOpenHelp={() => {
            setSharingOpen(false);
            openHelp("sharing");
          }}
        />
      )}
      {confirmation && <ConfirmationDialog {...confirmation} onClose={resolveConfirmation} />}
      {showGettingStarted && <GettingStartedDialog local={syncStatus === "local"} installState={installState} onInstall={() => void installPwa()} onClose={() => void closeGettingStarted()} />}
    </main>
  );
}

export default App;

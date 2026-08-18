import type { FileVersion } from "../../filesystem/database";
import type { ProjectedDesktopRuntime } from "./local-desktop-runtime";

export type FileHistory = {
  versions: FileVersion[];
  canUndo: boolean;
  canRedo: boolean;
};

export type DesktopRuntime = ProjectedDesktopRuntime;

export type { ContentConflictBundle, DesktopRegistry, FileTransferState, OfflineOperationProgress, SyncStatus } from "./runtime-types";

let runtime: DesktopRuntime | undefined;
let preparation: Promise<void> | undefined;

export function prepareDesktopRuntime() {
  preparation ??= import.meta.env.HIRAYA_FRONTEND_ONLY === "true" ? import("./local-desktop-runtime")
    .then((module) => { runtime = module.default; }) : import("./synchronized-desktop-runtime")
    .then((module) => { runtime = module.default; });
  return preparation;
}

function current() {
  if (!runtime) throw new Error("The desktop storage runtime has not been prepared.");
  return runtime;
}

type FunctionKey = {
  [Key in keyof DesktopRuntime]: DesktopRuntime[Key] extends (...values: never[]) => unknown ? Key : never
}[keyof DesktopRuntime];

function bind<Key extends FunctionKey>(key: Key): DesktopRuntime[Key] {
  return ((...values: unknown[]) => (current()[key] as (...args: unknown[]) => unknown)(...values)) as DesktopRuntime[Key];
}

export const fetchServerBuildTimestamp = bind("fetchServerBuildTimestamp");
export const initializeDesktop = bind("initializeDesktop");
export const stopDesktopSync = bind("stopDesktopSync");
export const subscribeToSync = bind("subscribeToSync");
export const createTextFile = bind("createTextFile");
export const createFile = bind("createFile");
export const createFolder = bind("createFolder");
export const importFiles = bind("importFiles");
export const createEntries = bind("createEntries");
export const renameEntry = bind("renameEntry");
export const deleteEntry = bind("deleteEntry");
export const deleteEntries = bind("deleteEntries");
export const moveEntry = bind("moveEntry");
export const moveEntries = bind("moveEntries");
export const transferEntries = bind("transferEntries");
export const createDesktop = bind("createDesktop");
export const listDesktops = bind("listDesktops");
export const refreshDesktopCatalog = bind("refreshDesktopCatalog");
export const subscribeToDesktopCatalog = bind("subscribeToDesktopCatalog");
export const updateDesktopPreferences = bind("updateDesktopPreferences");
export const renameDesktop = bind("renameDesktop");
export const deleteDesktop = bind("deleteDesktop");
export const captureEntries = bind("captureEntries");
export const pasteEntries = bind("pasteEntries");
export const updateRootEntryPositions = bind("updateRootEntryPositions");
export const updateEntryPosition = bind("updateEntryPosition");
export const saveFile = bind("saveFile");
export const saveDesktopLayout = bind("saveDesktopLayout");
export const saveEditorSettings = bind("saveEditorSettings");
export const selectTheme = bind("selectTheme");
export const saveCustomTheme = bind("saveCustomTheme");
export const installThemePackage = bind("installThemePackage");
export const deleteCustomTheme = bind("deleteCustomTheme");
export const readFile = bind("readFile");
export const hydrateFolder = bind("hydrateFolder");
export const hydrateNode = bind("hydrateNode");
export const previewFile = bind("previewFile");
export const thumbnailFile = bind("thumbnailFile");
export const loadOfflineInventory = bind("loadOfflineInventory");
export const subscribeToOfflineStorage = bind("subscribeToOfflineStorage");
export const subscribeToEntryDownloads = bind("subscribeToEntryDownloads");
export const subscribeToTransfers = bind("subscribeToTransfers");
export const dismissFileTransfer = bind("dismissFileTransfer");
export const dismissCompletedFileTransfer = bind("dismissCompletedFileTransfer");
export const estimateOfflineOperation = bind("estimateOfflineOperation");
export const downloadOfflineCopies = bind("downloadOfflineCopies");
export const releaseOfflineCopies = bind("releaseOfflineCopies");
export const listOutboxRecords = bind("listOutboxRecords");
export const retryBlockedOutboxRecord = bind("retryBlockedOutboxRecord");
export const discardBlockedOutboxRecord = bind("discardBlockedOutboxRecord");
export const loadContentConflict = bind("loadContentConflict");
export const resolveContentConflictKeepLocal = bind("resolveContentConflictKeepLocal");
export const resolveContentConflictKeepServer = bind("resolveContentConflictKeepServer");
export const resolveContentConflictMerged = bind("resolveContentConflictMerged");
export const resolveContentConflictKeepBoth = bind("resolveContentConflictKeepBoth");
export const subscribeToOutbox = bind("subscribeToOutbox");
export const listActivity = bind("listActivity");
export const subscribeToActivityChanges = bind("subscribeToActivityChanges");
export const listSystemEntries = bind("listSystemEntries");
export const readSystemFile = bind("readSystemFile");
export const readTrashFile = bind("readTrashFile");
export const listTrash = bind("listTrash");
export const restoreTrash = bind("restoreTrash");
export const permanentlyDeleteTrash = bind("permanentlyDeleteTrash");
export const cacheThemePackage = bind("cacheThemePackage");
export const pruneLocalDesktops = bind("pruneLocalDesktops");
export const readCachedThemePackage = bind("readCachedThemePackage");
export const readDesktopEntries = bind("readDesktopEntries");
export const readLocalPreferences = bind("readLocalPreferences");
export const readWindowSession = bind("readWindowSession");
export const saveLocalPreferences = bind("saveLocalPreferences");
export const saveWindowSession = bind("saveWindowSession");
export const switchDesktop = bind("switchDesktop");
export const listFileHistory = bind("listFileHistory");
export const undoLatestFileChange = bind("undoLatestFileChange");
export const redoLatestFileChange = bind("redoLatestFileChange");
export const restoreFileVersion = bind("restoreFileVersion");
export const readFileVersion = bind("readFileVersion");
export const keepBothFileVersion = bind("keepBothFileVersion");

export function serializeRuntimeStorage<T>(operation: () => Promise<T>) {
  return current().serializeRuntimeStorage(operation);
}

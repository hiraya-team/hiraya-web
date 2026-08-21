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

/** Prepares desktop runtime. */
export function prepareDesktopRuntime() {
  preparation ??= import.meta.env.HIRAYA_FRONTEND_ONLY === "true" ? import("./local-desktop-runtime")
    .then((module) => { runtime = module.default; }) : import("./synchronized-desktop-runtime")
    .then((module) => { runtime = module.default; });
  return preparation;
}

/** Returns the current runtime state. */
function current() {
  if (!runtime) throw new Error("The desktop storage runtime has not been prepared.");
  return runtime;
}

type FunctionKey = {
  [Key in keyof DesktopRuntime]: DesktopRuntime[Key] extends (...values: never[]) => unknown ? Key : never
}[keyof DesktopRuntime];

/** Binds a desktop runtime method to the active implementation. */
function bind<Key extends FunctionKey>(key: Key): DesktopRuntime[Key] {
  return ((...values: unknown[]) => (current()[key] as (...args: unknown[]) => unknown)(...values)) as DesktopRuntime[Key];
}

/** Fetches server build timestamp. */
export const fetchServerBuildTimestamp = bind("fetchServerBuildTimestamp");
/** Initializes desktop. */
export const initializeDesktop = bind("initializeDesktop");
/** Stops desktop sync. */
export const stopDesktopSync = bind("stopDesktopSync");
/** Subscribes to sync. */
export const subscribeToSync = bind("subscribeToSync");
/** Creates text file. */
export const createTextFile = bind("createTextFile");
/** Creates file. */
export const createFile = bind("createFile");
/** Creates folder. */
export const createFolder = bind("createFolder");
/** Imports files into the selected destination. */
export const importFiles = bind("importFiles");
/** Creates entries. */
export const createEntries = bind("createEntries");
/** Renames entry. */
export const renameEntry = bind("renameEntry");
/** Removes entry. */
export const deleteEntry = bind("deleteEntry");
/** Removes entries. */
export const deleteEntries = bind("deleteEntries");
/** Moves entry. */
export const moveEntry = bind("moveEntry");
/** Moves entries. */
export const moveEntries = bind("moveEntries");
/** Transfers entries. */
export const transferEntries = bind("transferEntries");
/** Creates desktop. */
export const createDesktop = bind("createDesktop");
/** Lists desktops. */
export const listDesktops = bind("listDesktops");
/** Refreshes desktop catalog. */
export const refreshDesktopCatalog = bind("refreshDesktopCatalog");
/** Subscribes to desktop catalog. */
export const subscribeToDesktopCatalog = bind("subscribeToDesktopCatalog");
/** Updates desktop preferences. */
export const updateDesktopPreferences = bind("updateDesktopPreferences");
/** Renames desktop. */
export const renameDesktop = bind("renameDesktop");
/** Removes desktop. */
export const deleteDesktop = bind("deleteDesktop");
/** Captures entries. */
export const captureEntries = bind("captureEntries");
/** Pastes entries. */
export const pasteEntries = bind("pasteEntries");
/** Updates root entry positions. */
export const updateRootEntryPositions = bind("updateRootEntryPositions");
/** Updates entry position. */
export const updateEntryPosition = bind("updateEntryPosition");
/** Saves file. */
export const saveFile = bind("saveFile");
/** Saves desktop layout. */
export const saveDesktopLayout = bind("saveDesktopLayout");
/** Saves editor settings. */
export const saveEditorSettings = bind("saveEditorSettings");
/** Selects theme. */
export const selectTheme = bind("selectTheme");
/** Saves custom theme. */
export const saveCustomTheme = bind("saveCustomTheme");
/** Installs theme package. */
export const installThemePackage = bind("installThemePackage");
/** Removes custom theme. */
export const deleteCustomTheme = bind("deleteCustomTheme");
/** Reads file. */
export const readFile = bind("readFile");
/** Hydrates folder. */
export const hydrateFolder = bind("hydrateFolder");
/** Hydrates node. */
export const hydrateNode = bind("hydrateNode");
/** Previews file. */
export const previewFile = bind("previewFile");
/** Generates a thumbnail for a file. */
export const thumbnailFile = bind("thumbnailFile");
/** Loads offline inventory. */
export const loadOfflineInventory = bind("loadOfflineInventory");
/** Subscribes to offline storage. */
export const subscribeToOfflineStorage = bind("subscribeToOfflineStorage");
/** Subscribes to entry downloads. */
export const subscribeToEntryDownloads = bind("subscribeToEntryDownloads");
/** Subscribes to transfers. */
export const subscribeToTransfers = bind("subscribeToTransfers");
/** Dismisses file transfer. */
export const dismissFileTransfer = bind("dismissFileTransfer");
/** Dismisses completed file transfer. */
export const dismissCompletedFileTransfer = bind("dismissCompletedFileTransfer");
/** Estimates offline operation. */
export const estimateOfflineOperation = bind("estimateOfflineOperation");
/** Downloads offline copies. */
export const downloadOfflineCopies = bind("downloadOfflineCopies");
/** Removes offline copies. */
export const releaseOfflineCopies = bind("releaseOfflineCopies");
/** Lists outbox records. */
export const listOutboxRecords = bind("listOutboxRecords");
/** Retries blocked outbox record. */
export const retryBlockedOutboxRecord = bind("retryBlockedOutboxRecord");
/** Removes blocked outbox record. */
export const discardBlockedOutboxRecord = bind("discardBlockedOutboxRecord");
/** Loads content conflict. */
export const loadContentConflict = bind("loadContentConflict");
/** Resolves content conflict keep local. */
export const resolveContentConflictKeepLocal = bind("resolveContentConflictKeepLocal");
/** Resolves content conflict keep server. */
export const resolveContentConflictKeepServer = bind("resolveContentConflictKeepServer");
/** Resolves content conflict merged. */
export const resolveContentConflictMerged = bind("resolveContentConflictMerged");
/** Resolves content conflict keep both. */
export const resolveContentConflictKeepBoth = bind("resolveContentConflictKeepBoth");
/** Subscribes to outbox. */
export const subscribeToOutbox = bind("subscribeToOutbox");
/** Lists activity. */
export const listActivity = bind("listActivity");
/** Subscribes to activity changes. */
export const subscribeToActivityChanges = bind("subscribeToActivityChanges");
/** Lists system entries. */
export const listSystemEntries = bind("listSystemEntries");
/** Reads system file. */
export const readSystemFile = bind("readSystemFile");
/** Reads trash file. */
export const readTrashFile = bind("readTrashFile");
/** Lists trash. */
export const listTrash = bind("listTrash");
/** Restores trash. */
export const restoreTrash = bind("restoreTrash");
/** Permanently deletes trash. */
export const permanentlyDeleteTrash = bind("permanentlyDeleteTrash");
/** Caches theme package. */
export const cacheThemePackage = bind("cacheThemePackage");
/** Removes local desktops. */
export const pruneLocalDesktops = bind("pruneLocalDesktops");
/** Reads cached theme package. */
export const readCachedThemePackage = bind("readCachedThemePackage");
/** Reads desktop entries. */
export const readDesktopEntries = bind("readDesktopEntries");
/** Reads local preferences. */
export const readLocalPreferences = bind("readLocalPreferences");
/** Reads window session. */
export const readWindowSession = bind("readWindowSession");
/** Saves local preferences. */
export const saveLocalPreferences = bind("saveLocalPreferences");
/** Saves window session. */
export const saveWindowSession = bind("saveWindowSession");
/** Switches desktop. */
export const switchDesktop = bind("switchDesktop");
/** Lists file history. */
export const listFileHistory = bind("listFileHistory");
/** Undoes latest file change. */
export const undoLatestFileChange = bind("undoLatestFileChange");
/** Redoes latest file change. */
export const redoLatestFileChange = bind("redoLatestFileChange");
/** Restores file version. */
export const restoreFileVersion = bind("restoreFileVersion");
/** Reads file version. */
export const readFileVersion = bind("readFileVersion");
/** Keeps both file version. */
export const keepBothFileVersion = bind("keepBothFileVersion");

/** Serializes runtime storage. */
export function serializeRuntimeStorage<T>(operation: () => Promise<T>) {
  return current().serializeRuntimeStorage(operation);
}

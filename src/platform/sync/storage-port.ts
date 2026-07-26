import * as browserStorage from "../../lib/opfs";

export type SyncStorage = Pick<typeof browserStorage,
  "applyRemoteDesktop" | "createEntries" | "createFile" | "createFolder" | "createTextFile" | "deleteEntries" | "deleteEntry" | "importFiles" | "loadDesktop" |
  "moveEntries" | "moveEntry" | "readCurrentDesktop" | "captureDesktopState" | "readFile" | "readCachedFile" | "cacheRemoteFile" | "removeCachedFile" | "resolveFileByRelativePath" |
  "readDesktopState" |
  "renameEntry" | "saveDesktopLayout" | "saveEditorSettings" | "saveFile" | "saveTextFile" | "updateEntryPosition" |
  "updateRootEntryPositions" | "enqueueMutation" | "readOutbox" | "bindOutboxCatalog" |
  "acknowledgeMutation" | "blockMutation" | "discardDesktopProjection" | "readPendingContent" |
  "selectTheme" | "saveCustomTheme" | "deleteCustomTheme" |
  "listActivity" |
  "transferEntries" | "enqueueTransfer" |
  "createDesktop" | "renameDesktop" | "deleteDesktop" |
  "createOfflineDesktop" |
  "listDesktops" | "ensureDesktop" |
  "pruneLocalDesktops" |
  "loadOfflineInventory" | "setOfflinePins" | "releaseOfflineCopies"
>;

export const browserSyncStorage: SyncStorage = browserStorage;

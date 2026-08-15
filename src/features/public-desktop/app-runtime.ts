import type { JsonValue } from "@hiraya-team/apps-contracts";
import { createAppCommandService } from "../../apps/commands";
import { systemDefaultAppId } from "../../apps/file-associations";
import {
  AppHostServices,
  AppLifecycleService,
  AppPersistentStorageService,
  AppThemeService,
  CapabilityStore,
  HostServiceError,
  type FileSyncFunctions,
} from "../../apps/host";
import { SYSTEM_APP_CATALOG, systemAppArchiveUrl, systemInstallFromCatalog } from "../../apps/system-apps";
import type { ThemeDefinition } from "../../domain/theme";
import { launchSandboxApp } from "../app-management/launch";
import type { SandboxApp } from "../windows/model";
import { remoteDesktopSnapshot } from "../../lib/desktop-state";
import { fetchPublicFile, LargeDownloadAuthRequiredError, type PublicAuthority, type PublicDesktopState } from "../../lib/public-desktop";
import type { DesktopEntry, FileEntry } from "../../types";
import { resolveTheme } from "../../lib/themes";
import { initialWindowBounds } from "../../ui/window-manager";
import { textEditorLaunchArgument } from "../../lib/file-creation-templates";

export type PublicAppRuntime = {
  app: SandboxApp;
  lifecycle: AppLifecycleService;
  close(): void;
};

type LaunchPublicFileAppOptions = {
  authority: PublicAuthority;
  desktop: PublicDesktopState;
  entries: readonly DesktopEntry[];
  file: FileEntry;
  onClose: () => void;
  onOpenEntry: (entry: DesktopEntry) => void;
  onLargeDownload: (error: LargeDownloadAuthRequiredError, file: FileEntry) => void;
};

export async function launchPublicFileApp(options: LaunchPublicFileAppOptions): Promise<PublicAppRuntime> {
  const catalog = SYSTEM_APP_CATALOG.find((item) => item.manifest.id === systemDefaultAppId(options.file));
  if (!catalog) throw new Error("The default system app is unavailable.");
  const install = systemInstallFromCatalog(catalog);
  const snapshot = remoteDesktopSnapshot(options.desktop, new Set(options.entries.map((entry) => entry.id)));
  const activeTheme: ThemeDefinition = resolveTheme(snapshot.appearance);
  const desktopSize = { width: window.innerWidth, height: Math.max(1, window.innerHeight - 44) };
  const capabilities = new CapabilityStore();
  const lifecycle = new AppLifecycleService(2_000, () => options.onClose());
  const storage = memoryStorage();
  const hostServices = new AppHostServices(lifecycle, new AppThemeService(activeTheme), new AppPersistentStorageService(storage));
  const unsubscribeDialogs = hostServices.dialogs.subscribe((requests) => {
    for (const request of requests) hostServices.dialogs.reject(request.id, new HostServiceError("File dialogs are unavailable on public desktops.", "PERMISSION_DENIED"));
  });
  const deny = () => Promise.reject(new HostServiceError("Public desktops are read only.", "PERMISSION_DENIED"));
  const read = async (id: string, purpose?: "preview") => {
    const file = snapshot.entries.find((entry): entry is FileEntry => entry.id === id && entry.kind === "file");
    if (!file) throw new HostServiceError("The public file is unavailable.", "NOT_FOUND");
    try {
      return await fetchPublicFile(options.authority, file, snapshot.sync.contentRevisions[id] ?? 0, undefined, purpose);
    } catch (error) {
      if (error instanceof LargeDownloadAuthRequiredError) options.onLargeDownload(error, file);
      throw error;
    }
  };
  const fileSync: FileSyncFunctions = {
    readFile: (id) => read(id),
    previewFile: async (id) => ({ kind: "blob", blob: await read(id, "preview") }),
    saveFile: deny,
    createFile: deny,
    createFolder: deny,
    renameEntry: deny,
    moveEntry: deny,
    deleteEntry: deny,
    deleteEntries: deny,
  };
  const result = await launchSandboxApp({
    install,
    target: options.file,
    source: "file",
    activeSegment: { column: 0, row: 0 },
    desktopSize,
    runningApps: [],
    activeTheme,
    capabilities,
    hostServices,
    commandService: createAppCommandService(),
    fileSync,
    getEntries: () => snapshot.entries,
    getSnapshot: () => snapshot,
    getLaunchArguments: () => install.manifest.id === "app.hiraya.text-editor" ? [textEditorLaunchArgument(snapshot.editorSettings)] : [],
    getAppCapabilities: () => ({ files: { write: false, writeReason: "read-only" }, externalEmbeddedPreviews: false }),
    canMutate: () => false,
    loadArchive: async () => {
      const response = await fetch(systemAppArchiveUrl(catalog), { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`${catalog.manifest.name} is unavailable. Reconnect and retry.`);
      return response.blob();
    },
    shouldFocusTarget: () => true,
    createBase: (id) => ({ id, bounds: initialWindowBounds(desktopSize), minimized: false, zIndex: 1 }),
    createPosition: () => ({ x: 0, y: 0 }),
    confirm: async () => false,
    openEntry: options.onOpenEntry,
    importFiles: () => undefined,
    importFolder: () => undefined,
    showEntryActions: () => undefined,
    getEntryStatus: () => ({ status: "cached", pinned: false, directlyPinned: false }),
    setExternalEmbeddedPreviews: deny,
    getThemeEditorState: () => { throw new HostServiceError("Theme management is unavailable on public desktops.", "PERMISSION_DENIED"); },
    selectTheme: deny,
    saveTheme: deny,
    deleteTheme: deny,
    getWallpaperEditorState: () => { throw new HostServiceError("Wallpaper management is unavailable on public desktops.", "PERMISSION_DENIED"); },
    previewWallpaper: () => undefined,
    saveWallpaper: deny,
    uploadWallpaper: deny,
    selectWallpaper: deny,
  });
  if (result.kind !== "created") throw new Error("The public app could not be opened.");
  let closed = false;
  return {
    app: result.app,
    lifecycle,
    close: () => {
      if (closed) return;
      closed = true;
      unsubscribeDialogs();
      result.app.dispatcher.dispose();
      capabilities.revokeInstance(result.app.id);
      storage.clearAll();
    },
  };
}

function memoryStorage() {
  const values = new Map<string, Map<string, JsonValue>>();
  return {
    get: async (appId: string, key: string) => values.get(appId)?.get(key),
    set: async (appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number) => {
      const current = new Map(values.get(appId));
      current.set(key, structuredClone(value));
      if (current.size > maxEntries || new Blob([...current].map(([entryKey, entryValue]) => `${entryKey}${JSON.stringify(entryValue)}`)).size > maxBytes) throw new Error("App storage quota exceeded.");
      values.set(appId, current);
    },
    remove: async (appId: string, key: string) => { values.get(appId)?.delete(key); },
    clear: async (appId: string) => { values.delete(appId); },
    clearAll: () => values.clear(),
  };
}

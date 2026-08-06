import type { AppCapabilities, FileHandle, FolderHandle, OfflineEntryStatus } from "@hiraya-team/apps-contracts";
import { RpcDispatcher } from "@hiraya/app-runtime";
import type { DesktopStateSnapshot } from "../../domain/desktop-state";
import type { ThemeDefinition } from "../../domain/theme";
import type { DesktopEntry, EntryPosition, FileEntry, FolderEntry } from "../../types";
import { projectLogicalPosition, restoreLogicalPosition, type SurfaceSegment } from "../../ui/desktop-geometry";
import { initialWindowBounds } from "../../ui/window-manager";
import { sandboxWindowOptions } from "../../ui/app-window-sizing";
import { builtinAppTargetId } from "../../apps/registry";
import { RuntimeCommandContributions, type createAppCommandService } from "../../apps/commands";
import type { InstalledApp } from "../../apps/installed-apps";
import { systemAppArchiveUrl } from "../../apps/system-apps";
import { SYSTEM_APP_IDS } from "../../apps/system-app-ids";
import type { SystemAppTarget } from "../../apps/types";
import {
  type AppHostServices,
  type CapabilityStore,
  FileService,
  HostServiceError,
  grantLaunchCapabilities,
  mapThemeTokens,
  type FileSyncFunctions,
} from "../../apps/host";
import type { BaseRunningApp, RunningApp, SandboxApp } from "../windows/model";
import { readApprovedPackageArchive } from "../../platform/storage/blobs";

export type AppLaunchSource = "launcher" | "file" | "restore";
export type AppLaunchTarget = FileEntry | FolderEntry | "root";

type LaunchSandboxAppOptions = {
  install: InstalledApp;
  target?: AppLaunchTarget;
  source: AppLaunchSource;
  activeSegment: SurfaceSegment;
  desktopSize: { width: number; height: number };
  runningApps: readonly RunningApp[];
  activeTheme: ThemeDefinition;
  capabilities: CapabilityStore;
  hostServices: AppHostServices;
  commandService: ReturnType<typeof createAppCommandService>;
  fileSync: FileSyncFunctions;
  getEntries: () => readonly DesktopEntry[];
  getSnapshot: () => DesktopStateSnapshot;
  getLaunchArguments: () => string[];
  getAppCapabilities: () => AppCapabilities;
  canMutate: () => boolean;
  shouldFocusTarget: (target: SystemAppTarget) => boolean;
  createBase: (id: string) => BaseRunningApp;
  createPosition: () => EntryPosition;
  confirm: (request: { title: string; message: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;
  openEntry: (entry: DesktopEntry) => void;
  importFiles: (parentId: string | null) => void;
  importFolder: (parentId: string | null) => void;
  showEntryActions: (instanceId: string, ids: string[]) => void;
  getEntryStatus: (id: string) => { status: OfflineEntryStatus; pinned: boolean; directlyPinned: boolean };
  setExternalEmbeddedPreviews: (enabled: boolean) => Promise<void>;
};

export type SandboxLaunchResult =
  | { kind: "existing"; id: string; shouldFocus: boolean }
  | { kind: "created"; app: SandboxApp; shouldFocus: boolean; systemTarget?: SystemAppTarget };

export async function launchSandboxApp(options: LaunchSandboxAppOptions): Promise<SandboxLaunchResult> {
  const { install, target } = options;
  let pendingInstanceId: string | null = null;
  let pendingHost: { close(): void } | null = null;
  try {
    const blob = install.source === "system"
      ? await readApprovedPackageArchive(install.digest).catch(() => fetch(systemAppArchiveUrl({ archivePath: install.archivePath })).then((response) => {
          if (!response.ok) throw new Error(`${install.manifest.name} is unavailable. Reconnect and retry.`);
          return response.blob();
        }))
      : install.source === "store" || install.source === "account"
        ? await readApprovedPackageArchive(install.digest)
      : await options.fileSync.readFile(install.packageEntryId);
    const { inspectAppArchive } = await import("@hiraya-team/app-cli");
    const appPackage = await inspectAppArchive(new Uint8Array(await blob.arrayBuffer()));
    if (appPackage.digest !== install.digest || appPackage.manifest.id !== install.appId) throw new Error(`${install.manifest.name} failed package verification.`);

    const systemTarget: SystemAppTarget | undefined = target
      ? {
          kind: "system",
          appId: install.appId,
          targetKind: target === "root" ? "root" : target.kind,
          entryId: target === "root" ? null : target.id,
          source: install.source,
          digest: install.digest,
          permissions: [...install.manifest.permissions],
        }
      : undefined;
    const id = systemTarget ? builtinAppTargetId(systemTarget) : `sandbox:${install.packageEntryId}:${crypto.randomUUID()}`;
    const shouldFocus = !systemTarget || options.shouldFocusTarget(systemTarget);
    if (options.runningApps.some((app) => app.kind === "sandbox" && app.id === id)) return { kind: "existing", id, shouldFocus };

    pendingInstanceId = id;
    let base = options.createBase(id);
    if (appPackage.manifest.window) {
      const window = appPackage.manifest.window;
      const index = options.runningApps.filter((app) => {
        const segment = projectLogicalPosition(app.bounds, options.desktopSize).segment;
        return segment.column === options.activeSegment.column && segment.row === options.activeSegment.row;
      }).length;
      const local = initialWindowBounds(options.desktopSize, { ...sandboxWindowOptions(window, options.activeTheme), index });
      base = { ...base, bounds: { ...local, ...restoreLogicalPosition(local, options.activeSegment, options.desktopSize) } };
    }

    const effectivePermissions = () => appPackage.manifest.permissions.filter((permission) => permission !== "files:write" || options.canMutate());
    options.capabilities.setInstanceMutationAllowed(id, options.canMutate());
    const entries = options.getEntries();
    const relativeFolder = target && target !== "root" && target.kind === "file" && install.appId === SYSTEM_APP_IDS.markdownPreview && target.parentId
      ? entries.find((entry): entry is FolderEntry => entry.id === target.parentId && entry.kind === "folder")
      : undefined;
    const markdownAtRoot = install.appId === SYSTEM_APP_IDS.markdownPreview && target && target !== "root" && target.kind === "file" && target.parentId === null;
    const launchCapabilities = grantLaunchCapabilities(options.capabilities, id, appPackage.manifest.permissions, {
      files: target && target !== "root" && target.kind === "file" ? [target] : [],
      folders: target && target !== "root" && target.kind === "folder" ? [target] : relativeFolder ? [relativeFolder] : [],
      root: target === "root" || (install.source === "system" && !target) || Boolean(markdownAtRoot) || install.source === "system" && install.appId === SYSTEM_APP_IDS.terminal,
    });
    const host = options.hostServices.openInstance({
      instanceId: id,
      launch: {
        protocolVersion: 1,
        appId: appPackage.manifest.id,
        launchId: crypto.randomUUID(),
        source: options.source,
        files: launchCapabilities.files,
        folders: launchCapabilities.folders,
        arguments: options.getLaunchArguments(),
        theme: mapThemeTokens(options.activeTheme),
      },
      window: { focused: shouldFocus, maximized: false, fullscreen: false, width: Math.round(base.bounds.width), height: Math.round(base.bounds.height) },
      title: appPackage.manifest.name,
      getCapabilities: options.getAppCapabilities,
    });
    pendingHost = host;
    const files = new FileService({
      appInstanceId: id,
      permissions: effectivePermissions,
      capabilities: options.capabilities,
      getSnapshot: options.getSnapshot,
      sync: options.fileSync,
      createPosition: options.createPosition,
    });
    const entryIds = (handles: (FileHandle | FolderHandle)[], operation: "stat" | "write" = "stat") => handles.map((handle) => files.entryForHost(handle, operation).id);
    const runtimeHost = {
      ...host,
      dialogs: {
        openFile: host.dialogs.openFile,
        openFolder: host.dialogs.openFolder,
        saveFile: host.dialogs.saveFile,
        confirm: async (params: { title: string; message: string; confirmLabel?: string; destructive?: boolean }) => options.confirm({ title: params.title, message: params.message, confirmLabel: params.confirmLabel ?? "Confirm", danger: params.destructive }),
      },
      host: {
        openEntry: ({ handle }: { handle: FileHandle | FolderHandle }) => options.openEntry(files.entryForHost(handle)),
        importFiles: ({ parent }: { parent: FolderHandle | null }) => options.importFiles(files.folderIdForHost(parent, "create")),
        importFolder: ({ parent }: { parent: FolderHandle | null }) => options.importFolder(files.folderIdForHost(parent, "create")),
        showEntryActions: ({ handles }: { handles: (FileHandle | FolderHandle)[] }) => options.showEntryActions(id, entryIds(handles)),
        getEntryStatus: ({ handles }: { handles: (FileHandle | FolderHandle)[] }) => handles.map((handle) => {
          const status = options.getEntryStatus(files.entryForHost(handle).id);
          return { handle, ...status };
        }),
        getFilePreviewSource: ({ handle }: { handle: FileHandle }) => {
          if (install.source !== "system" || install.appId !== SYSTEM_APP_IDS.mediaViewer) throw new HostServiceError("Only the bundled Media Viewer can request preview sources.", "PERMISSION_DENIED");
          return options.fileSync.previewFile(files.entryForHost(handle, "read").id);
        },
        // Keep protocol v1 apps operational while making the retired behavior explicit.
        setOfflinePinned: async () => { throw new HostServiceError("Offline pinning is no longer supported.", "UNAVAILABLE"); },
        setExternalEmbeddedPreviews: async ({ enabled }: { enabled: boolean }) => {
          if (install.source !== "system" || install.appId !== SYSTEM_APP_IDS.markdownPreview) throw new HostServiceError("Only the bundled Markdown app can change this preference.", "PERMISSION_DENIED");
          await options.setExternalEmbeddedPreviews(enabled);
        },
      },
    };
    const dispatcher = new RpcDispatcher({
      permissions: effectivePermissions,
      host: runtimeHost,
      files,
      commands: new RuntimeCommandContributions(options.commandService, appPackage.manifest.id, (commandId) => dispatcher.emit("commands.invoked", { id: commandId })),
    });
    const app: SandboxApp = { ...base, kind: "sandbox", packageEntryId: install.packageEntryId, title: appPackage.manifest.name, dirty: false, install, package: appPackage, dispatcher, files, ...(systemTarget ? { systemTarget } : {}) };
    pendingInstanceId = null;
    pendingHost = null;
    return { kind: "created", app, shouldFocus, systemTarget };
  } catch (error) {
    pendingHost?.close();
    if (pendingInstanceId) options.capabilities.revokeInstance(pendingInstanceId);
    throw error;
  }
}

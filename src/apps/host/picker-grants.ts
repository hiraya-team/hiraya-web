import type { AppPermission, FileHandle, FolderHandle } from "@hiraya-team/apps-contracts";
import { APP_PERMISSIONS } from "../permissions";
import type { DesktopEntry } from "../../types";
import { CapabilityStore, type FileCapabilityOperation } from "./capability-store";

/** Grants selected files to an app with operations derived from permissions. */
export function grantPickedFiles(capabilities: CapabilityStore, instanceId: string, permissions: Iterable<AppPermission>, entries: readonly DesktopEntry[]): FileHandle[] {
  const operations = pickedFileOperations(permissions);
  return entries.map((entry) => {
    if (entry.kind !== "file") throw new TypeError("The file picker can only grant files.");
    return capabilities.grantFile(instanceId, entry.id, operations);
  });
}

/** Grants selected files while retaining access to their parent scope. */
export function grantPickedFilesWithParentScope(capabilities: CapabilityStore, instanceId: string, permissions: Iterable<AppPermission>, files: readonly DesktopEntry[], entries: readonly DesktopEntry[]): FileHandle[] {
  const operations = pickedFileOperations(permissions);
  return files.map((file) => {
    if (file.kind !== "file") throw new TypeError("The file picker can only grant files.");
    const parent = file.parentId === null ? null : entries.find((entry) => entry.id === file.parentId && entry.kind === "folder");
    if (parent === undefined) throw new TypeError("The selected file parent is unavailable.");
    return capabilities.grantScopedFile(instanceId, file.id, parent?.id ?? null, operations);
  });
}

/** Derives picked-file operations from the app's declared permissions. */
function pickedFileOperations(permissions: Iterable<AppPermission>): FileCapabilityOperation[] {
  return new Set(permissions).has(APP_PERMISSIONS.filesWrite) ? ["stat", "read", "write"] : ["stat", "read"];
}

/** Grants a selected folder or desktop root to an app instance. */
export function grantPickedFolder(capabilities: CapabilityStore, instanceId: string, permissions: Iterable<AppPermission>, entry: DesktopEntry | null): FolderHandle {
  if (entry && entry.kind !== "folder") throw new TypeError("The folder picker can only grant folders.");
  const writable = new Set(permissions).has(APP_PERMISSIONS.filesWrite);
  const operations: FileCapabilityOperation[] = writable
    ? ["stat", "read", "write", "list", "create", "rename", "move", "delete"]
    : ["stat", "read", "list"];
  return capabilities.grantFolder(instanceId, entry?.id ?? null, operations);
}

export type LaunchCapabilityInput = {
  files?: readonly DesktopEntry[];
  folders?: readonly DesktopEntry[];
  root?: boolean;
};

/** Grants the files, folders, and root supplied in an app launch context. */
export function grantLaunchCapabilities(capabilities: CapabilityStore, instanceId: string, permissions: Iterable<AppPermission>, input: LaunchCapabilityInput): { files: FileHandle[]; folders: FolderHandle[] } {
  const permissionList = [...permissions];
  if (!permissionList.includes(APP_PERMISSIONS.filesRead)) return { files: [], folders: [] };
  const root = input.root ? grantPickedFolder(capabilities, instanceId, permissionList, null) : null;
  const files = root
    ? (input.files ?? []).map((entry) => capabilities.derive(instanceId, root, "file", entry.id) as FileHandle)
    : grantPickedFiles(capabilities, instanceId, permissionList, input.files ?? []);
  const folders = (input.folders ?? []).map((entry) => grantPickedFolder(capabilities, instanceId, permissionList, entry));
  if (root) folders.push(root);
  return { files, folders };
}

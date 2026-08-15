import type { AppPermission, FileHandle, FolderHandle } from "@hiraya-team/apps-contracts";
import type { DesktopEntry } from "../../types";
import { CapabilityStore, type FileCapabilityOperation } from "./capability-store";

export function grantPickedFiles(capabilities: CapabilityStore, instanceId: string, permissions: Iterable<AppPermission>, entries: readonly DesktopEntry[]): FileHandle[] {
  const operations = pickedFileOperations(permissions);
  return entries.map((entry) => {
    if (entry.kind !== "file") throw new TypeError("The file picker can only grant files.");
    return capabilities.grantFile(instanceId, entry.id, operations);
  });
}

export function grantPickedFilesWithParentScope(capabilities: CapabilityStore, instanceId: string, permissions: Iterable<AppPermission>, files: readonly DesktopEntry[], entries: readonly DesktopEntry[]): FileHandle[] {
  const operations = pickedFileOperations(permissions);
  return files.map((file) => {
    if (file.kind !== "file") throw new TypeError("The file picker can only grant files.");
    const parent = file.parentId === null ? null : entries.find((entry) => entry.id === file.parentId && entry.kind === "folder");
    if (parent === undefined) throw new TypeError("The selected file parent is unavailable.");
    return capabilities.grantScopedFile(instanceId, file.id, parent?.id ?? null, operations);
  });
}

function pickedFileOperations(permissions: Iterable<AppPermission>): FileCapabilityOperation[] {
  return new Set(permissions).has("files:write") ? ["stat", "read", "write"] : ["stat", "read"];
}

export function grantPickedFolder(capabilities: CapabilityStore, instanceId: string, permissions: Iterable<AppPermission>, entry: DesktopEntry | null): FolderHandle {
  if (entry && entry.kind !== "folder") throw new TypeError("The folder picker can only grant folders.");
  const writable = new Set(permissions).has("files:write");
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

export function grantLaunchCapabilities(capabilities: CapabilityStore, instanceId: string, permissions: Iterable<AppPermission>, input: LaunchCapabilityInput): { files: FileHandle[]; folders: FolderHandle[] } {
  const permissionList = [...permissions];
  if (!permissionList.includes("files:read")) return { files: [], folders: [] };
  const root = input.root ? grantPickedFolder(capabilities, instanceId, permissionList, null) : null;
  const files = root
    ? (input.files ?? []).map((entry) => capabilities.derive(instanceId, root, "file", entry.id) as FileHandle)
    : grantPickedFiles(capabilities, instanceId, permissionList, input.files ?? []);
  const folders = (input.folders ?? []).map((entry) => grantPickedFolder(capabilities, instanceId, permissionList, entry));
  if (root) folders.push(root);
  return { files, folders };
}

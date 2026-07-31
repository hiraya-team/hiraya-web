import { isValidId } from "../lib/contracts";
import type {
  BuiltinAppEntryDependency,
  BuiltinAppKind,
  BuiltinAppTarget,
  BuiltinAppWindow,
  SystemAppTarget,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const LEGACY_FOLDER_EXPLORER_APP_ID = "app.hiraya.folder-explorer";

const BUILTIN_APP_WINDOWS: Record<BuiltinAppKind, BuiltinAppWindow> = {
  file: { width: 920, height: 680, minWidth: 420, minHeight: 320 },
  explorer: { width: 760, height: 590, minWidth: 360, minHeight: 280 },
  properties: { width: 520, height: 570, minWidth: 360, minHeight: 320 },
  settings: { width: 720, height: 700, minWidth: 360, minHeight: 280 },
};

export function builtinAppWindow(kind: BuiltinAppKind): BuiltinAppWindow {
  return BUILTIN_APP_WINDOWS[kind];
}

export function extractBuiltinAppTarget(value: unknown): BuiltinAppTarget | null {
  if (!isRecord(value)) return null;
  if (value.kind === "file") return isValidId(value.fileId) && (value.editMode === undefined || typeof value.editMode === "boolean")
    ? { kind: "file", fileId: value.fileId, ...(value.editMode ? { editMode: true } : {}) }
    : null;
  if (value.kind === "explorer") return value.folderId === null || isValidId(value.folderId)
    ? { kind: "explorer", folderId: value.folderId as string | null }
    : null;
  if (value.kind === "properties") return isValidId(value.entryId) ? { kind: "properties", entryId: value.entryId } : null;
  if (value.kind === "settings") return { kind: "settings" };
  if (value.kind === "system" && typeof value.appId === "string" && value.appId.length <= 160 && ["file", "folder", "root"].includes(String(value.targetKind)) && (value.entryId === null || isValidId(value.entryId))) {
    if (value.targetKind === "root" && value.entryId !== null || value.targetKind !== "root" && value.entryId === null) return null;
    if (value.appId === LEGACY_FOLDER_EXPLORER_APP_ID && (value.targetKind === "root" || value.targetKind === "folder")) {
      return { kind: "explorer", folderId: value.targetKind === "root" ? null : value.entryId as string };
    }
    const identityFields = [value.source, value.digest, value.permissions];
    const hasIdentity = identityFields.some((part) => part !== undefined);
    if (hasIdentity && (value.source !== "system" && value.source !== "desktop" || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest) || !Array.isArray(value.permissions) || value.permissions.some((permission) => typeof permission !== "string") || new Set(value.permissions).size !== value.permissions.length)) return null;
    return {
      kind: "system", appId: value.appId, targetKind: value.targetKind, entryId: value.entryId,
      ...(hasIdentity ? { source: value.source, digest: value.digest, permissions: [...value.permissions as string[]] } : {}),
    } as SystemAppTarget;
  }
  return null;
}

export function builtinAppTargetId(target: BuiltinAppTarget): string {
  if (target.kind === "file") return `file:${target.fileId}`;
  if (target.kind === "explorer") return `explorer:${target.folderId ?? "root"}`;
  if (target.kind === "properties") return `properties:${target.entryId}`;
  if (target.kind === "settings") return "settings";
  return `system:${target.appId}:${target.targetKind}:${target.entryId ?? "root"}`;
}

export function builtinAppTargetOpensFile(target: BuiltinAppTarget, fileId: string): boolean {
  if (target.kind === "file") return target.fileId === fileId;
  return target.kind === "system" && target.targetKind === "file" && target.entryId === fileId;
}

export function builtinAppEntryDependency(target: BuiltinAppTarget): BuiltinAppEntryDependency | null {
  if (target.kind === "file") return { entryId: target.fileId, kind: "file" };
  if (target.kind === "explorer") return target.folderId === null ? null : { entryId: target.folderId, kind: "folder" };
  if (target.kind === "properties") return { entryId: target.entryId, kind: "entry" };
  if (target.kind === "settings") return null;
  return target.entryId === null ? null : { entryId: target.entryId, kind: target.targetKind === "file" ? "file" : "folder" };
}

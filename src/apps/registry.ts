import { isValidId } from "../lib/contracts";
import type {
  BuiltinAppDefinition,
  BuiltinAppEntryDependency,
  BuiltinAppKind,
  BuiltinAppTarget,
  BuiltinAppWindow,
  ExplorerAppTarget,
  FileAppTarget,
  PropertiesAppTarget,
  SettingsAppTarget,
  SystemAppTarget,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const LEGACY_FOLDER_EXPLORER_APP_ID = "app.hiraya.folder-explorer";

export const BUILTIN_APP_REGISTRY = {
  file: {
    window: { width: 920, height: 680, minWidth: 420, minHeight: 320 },
    extractTarget: (value) => value.kind === "file" && isValidId(value.fileId) && (value.editMode === undefined || typeof value.editMode === "boolean")
      ? { kind: "file", fileId: value.fileId, ...(value.editMode ? { editMode: true } : {}) }
      : null,
    targetId: (target) => `file:${target.fileId}`,
    entryDependency: (target) => ({ entryId: target.fileId, kind: "file" }),
  } satisfies BuiltinAppDefinition<FileAppTarget>,
  explorer: {
    window: { width: 760, height: 590, minWidth: 360, minHeight: 280 },
    extractTarget: (value) => value.kind === "explorer" && (value.folderId === null || isValidId(value.folderId))
      ? { kind: "explorer", folderId: value.folderId as string | null }
      : null,
    targetId: (target) => `explorer:${target.folderId ?? "root"}`,
    entryDependency: (target) => target.folderId === null ? null : { entryId: target.folderId, kind: "folder" },
  } satisfies BuiltinAppDefinition<ExplorerAppTarget>,
  properties: {
    window: { width: 520, height: 570, minWidth: 360, minHeight: 320 },
    extractTarget: (value) => value.kind === "properties" && isValidId(value.entryId)
      ? { kind: "properties", entryId: value.entryId }
      : null,
    targetId: (target) => `properties:${target.entryId}`,
    entryDependency: (target) => ({ entryId: target.entryId, kind: "entry" }),
  } satisfies BuiltinAppDefinition<PropertiesAppTarget>,
  settings: {
    window: { width: 720, height: 700, minWidth: 360, minHeight: 280 },
    extractTarget: (value) => value.kind === "settings" ? { kind: "settings" } : null,
    targetId: () => "settings",
    entryDependency: () => null,
  } satisfies BuiltinAppDefinition<SettingsAppTarget>,
} as const;

export function builtinAppWindow(kind: BuiltinAppKind): BuiltinAppWindow {
  return BUILTIN_APP_REGISTRY[kind].window;
}

export function extractBuiltinAppTarget(value: unknown): BuiltinAppTarget | null {
  if (!isRecord(value)) return null;
  if (value.kind === "file") return BUILTIN_APP_REGISTRY.file.extractTarget(value);
  if (value.kind === "explorer") return BUILTIN_APP_REGISTRY.explorer.extractTarget(value);
  if (value.kind === "properties") return BUILTIN_APP_REGISTRY.properties.extractTarget(value);
  if (value.kind === "settings") return BUILTIN_APP_REGISTRY.settings.extractTarget(value);
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
  if (target.kind === "file") return BUILTIN_APP_REGISTRY.file.targetId(target);
  if (target.kind === "explorer") return BUILTIN_APP_REGISTRY.explorer.targetId(target);
  if (target.kind === "properties") return BUILTIN_APP_REGISTRY.properties.targetId(target);
  if (target.kind === "settings") return BUILTIN_APP_REGISTRY.settings.targetId();
  return `system:${target.appId}:${target.targetKind}:${target.entryId ?? "root"}`;
}

export function builtinAppTargetOpensFile(target: BuiltinAppTarget, fileId: string): boolean {
  if (target.kind === "file") return target.fileId === fileId;
  return target.kind === "system" && target.targetKind === "file" && target.entryId === fileId;
}

export function builtinAppEntryDependency(target: BuiltinAppTarget): BuiltinAppEntryDependency | null {
  if (target.kind === "file") return BUILTIN_APP_REGISTRY.file.entryDependency(target);
  if (target.kind === "explorer") return BUILTIN_APP_REGISTRY.explorer.entryDependency(target);
  if (target.kind === "properties") return BUILTIN_APP_REGISTRY.properties.entryDependency(target);
  if (target.kind === "settings") return BUILTIN_APP_REGISTRY.settings.entryDependency();
  return target.entryId === null ? null : { entryId: target.entryId, kind: target.targetKind === "file" ? "file" : "folder" };
}

import type { AppPackageInspection } from "@hiraya/apps-contracts";
import type { RpcDispatcher } from "@hiraya/app-runtime";
import type { FileService } from "../../apps/host";
import type { InstalledApp } from "../../apps/installed-apps";
import { extractBuiltinAppTarget } from "../../apps/registry";
import type { SystemAppTarget } from "../../apps/types";
import type { FileEntry } from "../../types";
import { projectLogicalPosition, type SurfaceSegment } from "../../ui/desktop-geometry";
import type { WindowBounds } from "../../ui/window-manager";
import type { WindowTarget } from "../../lib/window-session";

export type BaseRunningApp = { id: string; bounds: WindowBounds; minimized: boolean; zIndex: number };
export type FileApp = BaseRunningApp & { kind: "file"; fileId: string; file?: FileEntry; blob?: File; editable?: boolean; loadError?: string; editMode: boolean; contentRevision: number; remoteChanged: boolean };
export type ExplorerApp = BaseRunningApp & { kind: "explorer"; folderId: string | null };
export type SettingsApp = BaseRunningApp & { kind: "settings" };
export type PropertiesApp = BaseRunningApp & { kind: "properties"; entryId: string };
export type SandboxApp = BaseRunningApp & { kind: "sandbox"; packageEntryId: string | null; title: string; dirty: boolean; install: InstalledApp; package: AppPackageInspection; dispatcher: RpcDispatcher; files: FileService; systemTarget?: SystemAppTarget };
export type RunningApp = FileApp | ExplorerApp | PropertiesApp | SettingsApp | SandboxApp;

export function runningAppTargets(apps: readonly RunningApp[]): WindowTarget[] {
  return apps.flatMap((app): WindowTarget[] => {
    if (app.kind === "sandbox" && app.systemTarget) return [app.systemTarget];
    const target = extractBuiltinAppTarget(app);
    return target ? [target] : [];
  });
}

export function runningAppIds(apps: readonly RunningApp[]) {
  return apps.map((app) => app.id);
}

export function runningAppSegment(app: RunningApp, size: { width: number; height: number }) {
  return projectLogicalPosition(app.bounds, size).segment;
}

export function runningAppIsInSegment(app: RunningApp, segment: SurfaceSegment, size: { width: number; height: number }) {
  const projected = runningAppSegment(app, size);
  return projected.column === segment.column && projected.row === segment.row;
}

export function topRunningAppInSegment(apps: readonly RunningApp[], segment: SurfaceSegment, size: { width: number; height: number }, excludedId?: string) {
  return [...apps]
    .filter((app) => app.id !== excludedId && !app.minimized && runningAppIsInSegment(app, segment, size))
    .sort((left, right) => right.zIndex - left.zIndex)[0] ?? null;
}

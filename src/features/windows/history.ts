import type { DesktopRoute } from "../../lib/routes";
import { parseWindowTargets, type WindowTarget } from "../../lib/window-session";
import type { AppHistorySettingsPage } from "../../ui/app-history";
import type { RunningApp } from "./model";

export type RouteHistoryState = { hiraya: true; schemaVersion: 1; parentPath?: string; apps: WindowTarget[]; instances: string[]; settingsPage: AppHistorySettingsPage };

export function parseRunningAppHistory(state: unknown) {
  if (!state || typeof state !== "object" || !(state as Partial<RouteHistoryState>).hiraya || !("apps" in state)) return null;
  try {
    return parseWindowTargets(state);
  } catch {
    return null;
  }
}

export function createRouteHistoryState(apps: WindowTarget[], instances: string[], settingsPage: AppHistorySettingsPage, parentPath?: string): RouteHistoryState {
  return { hiraya: true, schemaVersion: 1, ...(parentPath ? { parentPath } : {}), apps, instances, settingsPage };
}

export function routeForRunningApp(app: RunningApp | null, current: DesktopRoute, activeDesktopId: string): DesktopRoute {
  const base = { desktopId: activeDesktopId, column: current.column, row: current.row };
  if (!app) return base;
  if (app.kind === "file") return { ...base, fileId: app.fileId };
  if (app.kind === "explorer") return { ...base, explorerFolderId: app.folderId };
  if (app.kind === "properties") return { ...base, propertiesEntryId: app.entryId };
  if (app.kind === "merge") return base;
  if (app.kind === "store") return base;
  if (app.kind === "sandbox") {
    if (app.systemTarget?.targetKind === "file") return { ...base, fileId: app.systemTarget.entryId! };
    if (app.systemTarget?.targetKind === "folder") return { ...base, explorerFolderId: app.systemTarget.entryId };
    return base;
  }
  return { ...base, settings: true };
}

import type { JsonValue } from "@hiraya-team/apps-contracts";
import type { FileAssociation, InstalledApp } from "../../apps/installed-apps";
import type { LocalPreferences } from "../../domain/preferences";
import { openFilesystemDatabase } from "../../filesystem/database";
import type { WindowSession } from "../../lib/window-session";
import type { AccountAppsSnapshot } from "../../lib/account-apps";
import type { AccountAppDataRestoration, AccountAppOperation } from "../../lib/account-app-outbox";
import { accountStorage } from "./account-storage";

let opened: ReturnType<typeof openFilesystemDatabase> | undefined;

function database() {
  const { accountId, storageId } = accountStorage();
  return opened ??= openFilesystemDatabase(accountId, { storageId });
}

export async function readPreferences(): Promise<LocalPreferences> {
  const db = await database();
  const [preferences, workspaces] = await Promise.all([db.readDevicePreferences(), db.listWorkspaces()]);
  return { ...preferences, showDesktopMinimap: true, desktops: workspaces.map(({ id, pinned }) => ({ id, pinned })) };
}

export async function savePreferences(preferences: LocalPreferences) {
  const db = await database();
  const { showDesktopMinimap: _showDesktopMinimap, desktops, ...devicePreferences } = preferences;
  await db.writeDevicePreferences(devicePreferences);
  const workspaces = await db.listWorkspaces();
  if (desktops.length === workspaces.length && desktops.every(({ id }) => workspaces.some((workspace) => workspace.id === id))) {
    await db.setWorkspacePreferences(desktops);
  }
  void _showDesktopMinimap;
}

export async function readWindowSession(workspaceId: string) {
  return (await database()).readWindowSession(workspaceId);
}

export async function saveWindowSession(workspaceId: string, session: WindowSession) {
  await (await database()).writeWindowSession(workspaceId, session);
}

export async function listInstalledApps() {
  return (await database()).listInstalledApps();
}

export async function installApp(install: InstalledApp) {
  return (await database()).installApp(install);
}

export async function uninstallApp(appId: string) {
  await (await database()).uninstallApp(appId);
}

export async function listFileAssociations() {
  return (await database()).listFileAssociations();
}

export async function setFileAssociation(association: FileAssociation) {
  return (await database()).setFileAssociation(association);
}

export async function removeFileAssociation(matcher: string) {
  await (await database()).removeFileAssociation(matcher);
}

export async function resetFileAssociations() {
  await (await database()).resetFileAssociations();
}

export async function readAppStorage(appId: string, key: string) {
  return (await database()).readAppStorage(appId, key);
}

export async function writeAppStorage(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number) {
  await (await database()).writeAppStorage(appId, key, value, maxBytes, maxEntries);
}

export async function removeAppStorage(appId: string, key: string) {
  await (await database()).removeAppStorage(appId, key);
}

export async function clearAppStorage(appId: string) {
  await (await database()).clearAppStorage(appId);
}

export async function readAccountApps() {
  return (await database()).readAccountApps();
}

export async function enqueueAccountAppOperation(operation: AccountAppOperation, _localData?: unknown) {
  void _localData;
  return (await database()).enqueueAccountAppOperation(operation);
}

export async function reconcileAccountApps(snapshot: AccountAppsSnapshot, acknowledgedOperationId?: string) {
  return (await database()).reconcileAccountApps(snapshot, acknowledgedOperationId);
}

export async function blockAccountAppOperation(operationId: string, error: string, errorCode: string) {
  await (await database()).blockAccountAppOperation(operationId, error, errorCode);
}

export async function retryAccountAppOperation(operationId: string) {
  return (await database()).retryAccountAppOperation(operationId);
}

export async function discardAccountAppOperation(operationId: string, restoration?: AccountAppDataRestoration) {
  await (await database()).discardAccountAppOperation(operationId, restoration);
}

export async function recordAccountAppAttempt(operationId: string) {
  await (await database()).recordAccountAppAttempt(operationId, Date.now());
}

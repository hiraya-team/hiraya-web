import type { JsonValue } from "@hiraya-team/apps-contracts";
import type { FileAssociation, InstalledApp } from "../../apps/installed-apps";
import type { LocalPreferences } from "../../domain/preferences";
import { openFilesystemDatabase } from "../../filesystem/database";
import type { WindowSession } from "../../lib/window-session";
import type { AccountAppsSnapshot } from "../../lib/account-apps";
import type { AccountAppDataRestoration, AccountAppOperation } from "../../lib/account-app-outbox";
import { accountStorage } from "./account-storage";

let opened: ReturnType<typeof openFilesystemDatabase> | undefined;

/** Returns the active storage database. */
function database() {
  const { accountId, storageId } = accountStorage();
  return opened ??= openFilesystemDatabase(accountId, { storageId });
}

/** Reads preferences. */
export async function readPreferences(): Promise<LocalPreferences> {
  const db = await database();
  const [preferences, workspaces] = await Promise.all([db.readDevicePreferences(), db.listWorkspaces()]);
  return { ...preferences, showDesktopMinimap: true, desktops: workspaces.map(({ id, pinned }) => ({ id, pinned })) };
}

/** Saves preferences. */
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

/** Reads window session. */
export async function readWindowSession(workspaceId: string) {
  return (await database()).readWindowSession(workspaceId);
}

/** Saves window session. */
export async function saveWindowSession(workspaceId: string, session: WindowSession) {
  await (await database()).writeWindowSession(workspaceId, session);
}

/** Lists installed apps. */
export async function listInstalledApps() {
  const db = await database();
  const legacy = await db.listLegacyStoreApps();
  if (legacy.length > 0) {
    const { releaseApprovedPackageArchive } = await import("./package-archives");
    await Promise.all(legacy.map(async ({ appId, digest }) => {
      try {
        await releaseApprovedPackageArchive(digest);
        await db.removeLegacyStoreApp(appId);
      } catch { /* Keep the hidden record as a durable cleanup retry. */ }
    }));
  }
  return db.listInstalledApps();
}

/** Installs app. */
export async function installApp(install: InstalledApp) {
  return (await database()).installApp(install);
}

/** Uninstalls app. */
export async function uninstallApp(appId: string) {
  await (await database()).uninstallApp(appId);
}

/** Lists file associations. */
export async function listFileAssociations() {
  return (await database()).listFileAssociations();
}

/** Sets file association. */
export async function setFileAssociation(association: FileAssociation) {
  return (await database()).setFileAssociation(association);
}

/** Removes file association. */
export async function removeFileAssociation(matcher: string) {
  await (await database()).removeFileAssociation(matcher);
}

/** Resets file associations. */
export async function resetFileAssociations() {
  await (await database()).resetFileAssociations();
}

/** Reads app storage. */
export async function readAppStorage(appId: string, key: string) {
  return (await database()).readAppStorage(appId, key);
}

/** Writes app storage. */
export async function writeAppStorage(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number) {
  await (await database()).writeAppStorage(appId, key, value, maxBytes, maxEntries);
}

/** Removes app storage. */
export async function removeAppStorage(appId: string, key: string) {
  await (await database()).removeAppStorage(appId, key);
}

/** Removes app storage. */
export async function clearAppStorage(appId: string) {
  await (await database()).clearAppStorage(appId);
}

/** Reads account apps. */
export async function readAccountApps() {
  return (await database()).readAccountApps();
}

/** Queues account app operation. */
export async function enqueueAccountAppOperation(operation: AccountAppOperation, _localData?: unknown) {
  void _localData;
  return (await database()).enqueueAccountAppOperation(operation);
}

/** Reconciles account apps. */
export async function reconcileAccountApps(snapshot: AccountAppsSnapshot, acknowledgedOperationId?: string) {
  return (await database()).reconcileAccountApps(snapshot, acknowledgedOperationId);
}

/** Blocks account app operation. */
export async function blockAccountAppOperation(operationId: string, error: string, errorCode: string) {
  await (await database()).blockAccountAppOperation(operationId, error, errorCode);
}

/** Retries account app operation. */
export async function retryAccountAppOperation(operationId: string) {
  return (await database()).retryAccountAppOperation(operationId);
}

/** Removes account app operation. */
export async function discardAccountAppOperation(operationId: string, restoration?: AccountAppDataRestoration) {
  await (await database()).discardAccountAppOperation(operationId, restoration);
}

/** Records account app attempt. */
export async function recordAccountAppAttempt(operationId: string) {
  await (await database()).recordAccountAppAttempt(operationId, Date.now());
}

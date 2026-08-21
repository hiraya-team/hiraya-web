import { parseJsonValue, type JsonValue } from "@hiraya-team/apps-contracts";
import type { LocalPreferences } from "../../domain/preferences";
import { normalizeAssociationMatcher, parseFileAssociation, parseInstalledApp, type FileAssociation, type InstalledApp } from "../../apps/installed-apps";
import { parseWindowSession, type WindowSession } from "../../lib/window-session";
import { callDatabase, initializeDatabase } from "./database-client";
import { parseAccountAppsSnapshot, type AccountAppsSnapshot } from "../../lib/account-apps";
import { parseAccountAppOperation, type AccountAppDataRestoration, type AccountAppOperation } from "../../lib/account-app-outbox";

/** Reads preferences. */
export async function readPreferences(): Promise<LocalPreferences> {
  return callDatabase("readPreferences", undefined);
}

/** Saves preferences. */
export async function savePreferences(preferences: LocalPreferences) {
  await callDatabase("writePreferences", { preferences });
}

/** Reads window session. */
export async function readWindowSession(desktopId: string) {
  return parseWindowSession(await callDatabase("readWindowSession", { desktopId }));
}

/** Saves window session. */
export async function saveWindowSession(desktopId: string, session: WindowSession) {
  await callDatabase("writeWindowSession", { desktopId, session: parseWindowSession(session) });
}

/** Lists installed apps. */
export async function listInstalledApps() {
  await initializeDatabase();
  const apps = await callDatabase("listInstalledApps", undefined, null);
  if (!Array.isArray(apps)) throw new Error("The local app database has an unsupported format.");
  return apps.map(parseInstalledApp);
}

/** Installs app. */
export async function installApp(install: InstalledApp) {
  await initializeDatabase();
  return callDatabase("installApp", { install: parseInstalledApp(install) }, null);
}

/** Uninstalls app. */
export async function uninstallApp(appId: string) {
  await initializeDatabase();
  return callDatabase("uninstallApp", { appId }, null);
}

/** Lists file associations. */
export async function listFileAssociations() {
  await initializeDatabase();
  return (await callDatabase("listFileAssociations", undefined, null)).map(parseFileAssociation);
}

/** Sets file association. */
export async function setFileAssociation(association: FileAssociation) {
  await initializeDatabase();
  return callDatabase("setFileAssociation", { association: parseFileAssociation(association) }, null);
}

/** Removes file association. */
export async function removeFileAssociation(matcher: string) {
  await initializeDatabase();
  return callDatabase("removeFileAssociation", { matcher: normalizeAssociationMatcher(matcher) }, null);
}

/** Resets file associations. */
export async function resetFileAssociations() {
  await initializeDatabase();
  return callDatabase("resetFileAssociations", undefined, null);
}

/** Reads app storage. */
export async function readAppStorage(appId: string, key: string) {
  await initializeDatabase();
  return callDatabase("readAppStorage", { appId, key }, null);
}

/** Writes app storage. */
export async function writeAppStorage(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number) {
  await initializeDatabase();
  return callDatabase("writeAppStorage", { appId, key, value: parseJsonValue(value), maxBytes, maxEntries }, null);
}

/** Removes app storage. */
export async function removeAppStorage(appId: string, key: string) {
  await initializeDatabase();
  return callDatabase("removeAppStorage", { appId, key }, null);
}

/** Removes app storage. */
export async function clearAppStorage(appId: string) {
  await initializeDatabase();
  return callDatabase("clearAppStorage", { appId }, null);
}

/** Reads account apps. */
export async function readAccountApps() {
  await initializeDatabase();
  return callDatabase("readAccountApps", undefined, null);
}

/** Queues account app operation. */
export async function enqueueAccountAppOperation(operation: AccountAppOperation, localData?: { kind: "put"; appId: string; key: string; value: JsonValue } | { kind: "delete"; appId: string; key: string } | { kind: "clear"; appId: string }) {
  await initializeDatabase();
  return callDatabase("enqueueAccountAppOperation", { operation: parseAccountAppOperation(operation), ...(localData ? { localData } : {}) }, null);
}

/** Reconciles account apps. */
export async function reconcileAccountApps(snapshot: AccountAppsSnapshot, acknowledgedOperationId?: string) {
  await initializeDatabase();
  return callDatabase("reconcileAccountApps", { snapshot: parseAccountAppsSnapshot(snapshot), ...(acknowledgedOperationId ? { acknowledgedOperationId } : {}) }, null);
}

/** Blocks account app operation. */
export async function blockAccountAppOperation(operationId: string, error: string, errorCode: string) {
  await initializeDatabase();
  return callDatabase("blockAccountAppOperation", { operationId, error, errorCode }, null);
}

/** Retries account app operation. */
export async function retryAccountAppOperation(operationId: string) {
  await initializeDatabase();
  return callDatabase("retryAccountAppOperation", { operationId }, null);
}

/** Removes account app operation. */
export async function discardAccountAppOperation(operationId: string, restoration?: AccountAppDataRestoration) {
  await initializeDatabase();
  return callDatabase("discardAccountAppOperation", { operationId, ...(restoration ? { restoration } : {}) }, null);
}

/** Records account app attempt. */
export async function recordAccountAppAttempt(operationId: string) {
  await initializeDatabase();
  return callDatabase("recordAccountAppAttempt", { operationId, attemptedAt: Date.now() }, null);
}

import { parseJsonValue, type JsonValue } from "@hiraya-team/apps-contracts";
import type { LocalPreferences } from "../../domain/preferences";
import { normalizeAssociationMatcher, parseFileAssociation, parseInstalledApp, parseQuarantinedApp, type FileAssociation, type InstalledApp } from "../../apps/installed-apps";
import { parseWindowSession, type WindowSession } from "../../lib/window-session";
import { callDatabase, initializeDatabase } from "./database-client";
import { parseAccountAppsSnapshot, type AccountAppsSnapshot } from "../../lib/account-apps";
import { parseAccountAppOperation, type AccountAppDataRestoration, type AccountAppOperation } from "../../lib/account-app-outbox";

export async function readPreferences(): Promise<LocalPreferences> {
  return callDatabase("readPreferences", undefined);
}

export async function savePreferences(preferences: LocalPreferences) {
  await callDatabase("writePreferences", { preferences });
}

export async function readWindowSession(desktopId: string) {
  return parseWindowSession(await callDatabase("readWindowSession", { desktopId }));
}

export async function saveWindowSession(desktopId: string, session: WindowSession) {
  await callDatabase("writeWindowSession", { desktopId, session: parseWindowSession(session) });
}

export async function listInstalledApps() {
  await initializeDatabase();
  const apps = await callDatabase("listInstalledApps", undefined, null);
  if (!Array.isArray(apps)) throw new Error("The local app database has an unsupported format.");
  return apps.map(parseInstalledApp);
}

export async function installApp(install: InstalledApp) {
  await initializeDatabase();
  return callDatabase("installApp", { install: parseInstalledApp(install) }, null);
}

export async function retireMarkdownPreview() {
  await initializeDatabase();
  return callDatabase("retireMarkdownPreview", undefined, null);
}

export async function retireSceneEditor() {
  await initializeDatabase();
  return callDatabase("retireSceneEditor", undefined, null);
}

export async function uninstallApp(appId: string) {
  await initializeDatabase();
  return callDatabase("uninstallApp", { appId }, null);
}

export async function listQuarantinedApps() {
  await initializeDatabase();
  return (await callDatabase("listQuarantinedApps", undefined, null)).map(parseQuarantinedApp);
}

export async function removeQuarantinedApp(appId: string) {
  await initializeDatabase();
  return callDatabase("removeQuarantinedApp", { appId }, null);
}

export async function listFileAssociations() {
  await initializeDatabase();
  return (await callDatabase("listFileAssociations", undefined, null)).map(parseFileAssociation);
}

export async function setFileAssociation(association: FileAssociation) {
  await initializeDatabase();
  return callDatabase("setFileAssociation", { association: parseFileAssociation(association) }, null);
}

export async function removeFileAssociation(matcher: string) {
  await initializeDatabase();
  return callDatabase("removeFileAssociation", { matcher: normalizeAssociationMatcher(matcher) }, null);
}

export async function resetFileAssociations() {
  await initializeDatabase();
  return callDatabase("resetFileAssociations", undefined, null);
}

export async function readAppStorage(appId: string, key: string) {
  await initializeDatabase();
  return callDatabase("readAppStorage", { appId, key }, null);
}

export async function writeAppStorage(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number) {
  await initializeDatabase();
  return callDatabase("writeAppStorage", { appId, key, value: parseJsonValue(value), maxBytes, maxEntries }, null);
}

export async function removeAppStorage(appId: string, key: string) {
  await initializeDatabase();
  return callDatabase("removeAppStorage", { appId, key }, null);
}

export async function clearAppStorage(appId: string) {
  await initializeDatabase();
  return callDatabase("clearAppStorage", { appId }, null);
}

export async function readAccountApps() {
  await initializeDatabase();
  return callDatabase("readAccountApps", undefined, null);
}

export async function enqueueAccountAppOperation(operation: AccountAppOperation, localData?: { kind: "put"; appId: string; key: string; value: JsonValue } | { kind: "delete"; appId: string; key: string } | { kind: "clear"; appId: string }) {
  await initializeDatabase();
  return callDatabase("enqueueAccountAppOperation", { operation: parseAccountAppOperation(operation), ...(localData ? { localData } : {}) }, null);
}

export async function reconcileAccountApps(snapshot: AccountAppsSnapshot, acknowledgedOperationId?: string) {
  await initializeDatabase();
  return callDatabase("reconcileAccountApps", { snapshot: parseAccountAppsSnapshot(snapshot), ...(acknowledgedOperationId ? { acknowledgedOperationId } : {}) }, null);
}

export async function blockAccountAppOperation(operationId: string, error: string, errorCode: string) {
  await initializeDatabase();
  return callDatabase("blockAccountAppOperation", { operationId, error, errorCode }, null);
}

export async function retryAccountAppOperation(operationId: string) {
  await initializeDatabase();
  return callDatabase("retryAccountAppOperation", { operationId }, null);
}

export async function discardAccountAppOperation(operationId: string, restoration?: AccountAppDataRestoration) {
  await initializeDatabase();
  return callDatabase("discardAccountAppOperation", { operationId, ...(restoration ? { restoration } : {}) }, null);
}

export async function recordAccountAppAttempt(operationId: string) {
  await initializeDatabase();
  return callDatabase("recordAccountAppAttempt", { operationId, attemptedAt: Date.now() }, null);
}

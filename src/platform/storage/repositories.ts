import { parseJsonValue, type JsonValue } from "@hiraya-team/apps-contracts";
import type { LocalPreferences } from "../../domain/preferences";
import { normalizeAssociationMatcher, parseFileAssociation, parseInstalledApp, parseQuarantinedApp, type FileAssociation, type InstalledApp } from "../../apps/installed-apps";
import { parseWindowSession, type WindowSession } from "../../lib/window-session";
import { callDatabase, initializeDatabase } from "./database-client";

export async function readPreferences(): Promise<LocalPreferences> {
  await callDatabase("status", undefined);
  return callDatabase("readPreferences", undefined);
}

export async function savePreferences(preferences: LocalPreferences) {
  await callDatabase("status", undefined);
  await callDatabase("writePreferences", { preferences });
}

export async function readWindowSession(desktopId: string) {
  await callDatabase("status", undefined);
  return parseWindowSession(await callDatabase("readWindowSession", { desktopId }));
}

export async function saveWindowSession(desktopId: string, session: WindowSession) {
  await callDatabase("status", undefined);
  await callDatabase("writeWindowSession", { desktopId, session: parseWindowSession(session) });
}

export async function listInstalledApps() {
  await initializeDatabase();
  const apps = await callDatabase("listInstalledApps", undefined, null);
  if (!Array.isArray(apps)) throw new Error("The local storage worker uses an outdated app protocol. Reload Hiraya and close any older Hiraya tabs.");
  return apps.map(parseInstalledApp);
}

export async function installApp(install: InstalledApp) {
  await initializeDatabase();
  return callDatabase("installApp", { install: parseInstalledApp(install) }, null);
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

import type { JsonValue } from "@hiraya-team/apps-contracts";
import type { FileAssociation, InstalledApp } from "../../apps/installed-apps";
import type { AccountAppsSnapshot } from "../../lib/account-apps";
import type { AccountAppDataRestoration, AccountAppOperation } from "../../lib/account-app-outbox";

const backend = import("./fresh-repositories");

export async function listInstalledApps() {
  return (await backend).listInstalledApps();
}

export async function installApp(install: InstalledApp) {
  return (await backend).installApp(install);
}

export async function uninstallApp(appId: string) {
  await (await backend).uninstallApp(appId);
}

export async function listFileAssociations() {
  return (await backend).listFileAssociations();
}

export async function setFileAssociation(association: FileAssociation) {
  return (await backend).setFileAssociation(association);
}

export async function removeFileAssociation(matcher: string) {
  await (await backend).removeFileAssociation(matcher);
}

export async function resetFileAssociations() {
  await (await backend).resetFileAssociations();
}

export async function readAppStorage(appId: string, key: string) {
  return (await backend).readAppStorage(appId, key);
}

export async function writeAppStorage(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number) {
  await (await backend).writeAppStorage(appId, key, value, maxBytes, maxEntries);
}

export async function removeAppStorage(appId: string, key: string) {
  await (await backend).removeAppStorage(appId, key);
}

export async function clearAppStorage(appId: string) {
  await (await backend).clearAppStorage(appId);
}

export async function readAccountApps() {
  return (await backend).readAccountApps();
}

export async function enqueueAccountAppOperation(operation: AccountAppOperation, localData?: { kind: "put"; appId: string; key: string; value: JsonValue } | { kind: "delete"; appId: string; key: string } | { kind: "clear"; appId: string }) {
  return (await backend).enqueueAccountAppOperation(operation, localData);
}

export async function reconcileAccountApps(snapshot: AccountAppsSnapshot, acknowledgedOperationId?: string) {
  return (await backend).reconcileAccountApps(snapshot, acknowledgedOperationId);
}

export async function blockAccountAppOperation(operationId: string, error: string, errorCode: string) {
  await (await backend).blockAccountAppOperation(operationId, error, errorCode);
}

export async function retryAccountAppOperation(operationId: string) {
  return (await backend).retryAccountAppOperation(operationId);
}

export async function discardAccountAppOperation(operationId: string, restoration?: AccountAppDataRestoration) {
  await (await backend).discardAccountAppOperation(operationId, restoration);
}

export async function recordAccountAppAttempt(operationId: string) {
  await (await backend).recordAccountAppAttempt(operationId);
}

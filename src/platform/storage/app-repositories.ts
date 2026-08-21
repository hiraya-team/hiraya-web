import type { JsonValue } from "@hiraya-team/apps-contracts";
import type { FileAssociation, InstalledApp } from "../../apps/installed-apps";
import type { AccountAppsSnapshot } from "../../lib/account-apps";
import type { AccountAppDataRestoration, AccountAppOperation } from "../../lib/account-app-outbox";

/** Provides the active app repository backend. */
const backend = import("./fresh-repositories");

/** Lists installed apps. */
export async function listInstalledApps() {
  return (await backend).listInstalledApps();
}

/** Installs app. */
export async function installApp(install: InstalledApp) {
  return (await backend).installApp(install);
}

/** Uninstalls app. */
export async function uninstallApp(appId: string) {
  await (await backend).uninstallApp(appId);
}

/** Lists file associations. */
export async function listFileAssociations() {
  return (await backend).listFileAssociations();
}

/** Sets file association. */
export async function setFileAssociation(association: FileAssociation) {
  return (await backend).setFileAssociation(association);
}

/** Removes file association. */
export async function removeFileAssociation(matcher: string) {
  await (await backend).removeFileAssociation(matcher);
}

/** Resets file associations. */
export async function resetFileAssociations() {
  await (await backend).resetFileAssociations();
}

/** Reads app storage. */
export async function readAppStorage(appId: string, key: string) {
  return (await backend).readAppStorage(appId, key);
}

/** Writes app storage. */
export async function writeAppStorage(appId: string, key: string, value: JsonValue, maxBytes: number, maxEntries: number) {
  await (await backend).writeAppStorage(appId, key, value, maxBytes, maxEntries);
}

/** Removes app storage. */
export async function removeAppStorage(appId: string, key: string) {
  await (await backend).removeAppStorage(appId, key);
}

/** Removes app storage. */
export async function clearAppStorage(appId: string) {
  await (await backend).clearAppStorage(appId);
}

/** Reads account apps. */
export async function readAccountApps() {
  return (await backend).readAccountApps();
}

/** Queues account app operation. */
export async function enqueueAccountAppOperation(operation: AccountAppOperation, localData?: { kind: "put"; appId: string; key: string; value: JsonValue } | { kind: "delete"; appId: string; key: string } | { kind: "clear"; appId: string }) {
  return (await backend).enqueueAccountAppOperation(operation, localData);
}

/** Reconciles account apps. */
export async function reconcileAccountApps(snapshot: AccountAppsSnapshot, acknowledgedOperationId?: string) {
  return (await backend).reconcileAccountApps(snapshot, acknowledgedOperationId);
}

/** Blocks account app operation. */
export async function blockAccountAppOperation(operationId: string, error: string, errorCode: string) {
  await (await backend).blockAccountAppOperation(operationId, error, errorCode);
}

/** Retries account app operation. */
export async function retryAccountAppOperation(operationId: string) {
  return (await backend).retryAccountAppOperation(operationId);
}

/** Removes account app operation. */
export async function discardAccountAppOperation(operationId: string, restoration?: AccountAppDataRestoration) {
  await (await backend).discardAccountAppOperation(operationId, restoration);
}

/** Records account app attempt. */
export async function recordAccountAppAttempt(operationId: string) {
  await (await backend).recordAccountAppAttempt(operationId);
}

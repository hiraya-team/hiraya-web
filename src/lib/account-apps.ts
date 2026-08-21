import { parseManifestV2, type HirayaAppManifestV2 } from "@hiraya-team/apps-contracts";
import type { InstalledApp } from "../apps/installed-apps";
import { RESERVED_SYSTEM_APP_IDS } from "../apps/system-app-ids";
import { isRecord, readRevision } from "./contracts";
import { parseAccountAppDataKey, parseAccountAppId } from "./account-app-contract";

export { AccountAppsRequestError, parseAccountAppDataKey, parseAccountAppId } from "./account-app-contract";

/** Matches a lowercase SHA-256 digest. */
const SHA256 = /^[a-f0-9]{64}$/;

export type AccountAppGenerations = Readonly<{ installationGeneration: number; dataGeneration: number; itemRevision: number }>;
export type AccountAppBlob = Readonly<{ blobId: string; revision: number; size: number; sha256: string }>;
export type AccountAppResourceBlob = AccountAppBlob & Readonly<{ resourceId: string; path: string; name: string; mimeType: "application/json" }>;
export type AccountAppDataItem = Readonly<{ key: string; dataGeneration: number; revision: number; size: number; sha256: string }>;
export type AccountApp = Readonly<{
  appId: string;
  manifest: HirayaAppManifestV2;
  generations: AccountAppGenerations;
  manifestResource: AccountAppResourceBlob;
  package: AccountAppBlob;
  data: AccountAppDataItem[];
}>;
export type AccountAppsSnapshot = Readonly<{
  appsRevision: number;
  apps: AccountApp[];
  handlerHints: Readonly<Record<string, string>>;
  resources: Readonly<{ installation: AccountAppResourceBlob; handlers: AccountAppResourceBlob }>;
  installation: Readonly<{ apps: ReadonlyArray<Omit<AccountApp, "data">> }>;
}>;

export type AccountResource = Readonly<{
  id: string;
  kind: "installation" | "handlers" | "manifest";
  path: string;
  name: string;
  mimeType: "application/json";
  revision: number;
  size: number;
  sha256: string;
  appId?: string;
}>;

/** Validates that a record contains exactly the expected keys. */
function exactKeys(value: Record<string, unknown>, keys: readonly string[], message: string) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(message);
}

/** Validates and returns a non-negative integer. */
function nonNegative(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(message);
  return Number(value);
}

/** Validates and returns a positive integer. */
function positive(value: unknown, message: string) {
  const result = nonNegative(value, message);
  if (result < 1) throw new Error(message);
  return result;
}

/** Validates and returns a SHA-256 digest. */
function digest(value: unknown) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error("An account app resource has an invalid SHA-256 digest.");
  return value;
}

/** Parses and validates account app blob. */
export function parseAccountAppBlob(value: unknown): AccountAppBlob {
  if (!isRecord(value)) throw new Error("An account app resource has an unsupported format.");
  exactKeys(value, ["blobId", "revision", "size", "sha256"], "An account app resource has an unsupported shape.");
  if (typeof value.blobId !== "string" || !value.blobId || value.blobId.length > 256) throw new Error("An account app resource has an invalid blob ID.");
  return { blobId: value.blobId, revision: readRevision(value.revision), size: nonNegative(value.size, "An account app resource has an invalid size."), sha256: digest(value.sha256) };
}

/** Parses and validates account resource blob. */
function parseAccountResourceBlob(value: unknown, kind: AccountResource["kind"], expectedAppId = ""): AccountAppResourceBlob {
  if (!isRecord(value)) throw new Error("An account app resource has an unsupported format.");
  exactKeys(value, ["blobId", "revision", "size", "sha256", "resourceId", "path", "name", "mimeType"], "An account app resource has an unsupported shape.");
  const base = parseAccountAppBlob(Object.fromEntries(["blobId", "revision", "size", "sha256"].map((key) => [key, value[key]])));
  const expectedPath = kind === "manifest" ? `.hiraya/account/apps/${expectedAppId}/manifest.json` : `.hiraya/account/${kind}.json`;
  const expectedName = `${kind}.json`;
  if (value.resourceId !== base.blobId || value.path !== expectedPath || value.name !== expectedName || value.mimeType !== "application/json") throw new Error("An account app resource has inconsistent physical metadata.");
  return { ...base, resourceId: value.resourceId, path: value.path, name: value.name, mimeType: value.mimeType } as AccountAppResourceBlob;
}

/** Parses and validates generations. */
function parseGenerations(value: unknown): AccountAppGenerations {
  if (!isRecord(value)) throw new Error("An account app has invalid generations.");
  exactKeys(value, ["installationGeneration", "dataGeneration", "itemRevision"], "An account app has invalid generations.");
  return {
    installationGeneration: positive(value.installationGeneration, "An account app has an invalid installation generation."),
    dataGeneration: nonNegative(value.dataGeneration, "An account app has an invalid data generation."),
    itemRevision: positive(value.itemRevision, "An account app has an invalid item revision."),
  };
}

/** Parses and validates data item. */
function parseDataItem(value: unknown): AccountAppDataItem {
  if (!isRecord(value)) throw new Error("An account app data item has an unsupported format.");
  exactKeys(value, ["key", "dataGeneration", "revision", "size", "sha256"], "An account app data item has an unsupported shape.");
  return { key: parseAccountAppDataKey(value.key), dataGeneration: nonNegative(value.dataGeneration, "An account app data item has an invalid generation."), revision: readRevision(value.revision), size: nonNegative(value.size, "An account app data item has an invalid size."), sha256: digest(value.sha256) };
}

/** Parses and validates app. */
function parseApp(value: unknown, withData: boolean): AccountApp | Omit<AccountApp, "data"> {
  if (!isRecord(value)) throw new Error("An account app has an unsupported format.");
  exactKeys(value, withData ? ["appId", "manifest", "generations", "manifestResource", "package", "data"] : ["appId", "manifest", "generations", "manifestResource", "package"], "An account app has an unsupported shape.");
  const id = parseAccountAppId(value.appId);
  if (RESERVED_SYSTEM_APP_IDS.has(id)) throw new Error("Trusted system apps cannot appear in synchronized account apps.");
  const manifest = parseManifestV2(value.manifest);
  if (manifest.id !== id) throw new Error("An account app manifest has a different app ID.");
  const base = { appId: id, manifest, generations: parseGenerations(value.generations), manifestResource: parseAccountResourceBlob(value.manifestResource, "manifest", id), package: parseAccountAppBlob(value.package) };
  if (!withData) return base;
  if (!Array.isArray(value.data)) throw new Error("An account app has invalid data metadata.");
  const data = value.data.map(parseDataItem);
  if (new Set(data.map((item) => item.key)).size !== data.length) throw new Error("Account app data metadata contains duplicate keys.");
  if (data.some((item, index) => index > 0 && data[index - 1].key >= item.key)) throw new Error("Account app data metadata is not uniquely ordered.");
  if (data.some((item) => item.dataGeneration !== base.generations.dataGeneration)) throw new Error("Account app data metadata has an inconsistent generation.");
  return { ...base, data };
}

/** Parses and validates hints. */
function parseHints(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > 128) throw new Error("Account app handler hints have an unsupported format.");
  return Object.fromEntries(Object.entries(value).map(([key, value]) => {
    if (!key || new TextEncoder().encode(key).byteLength > 255 || [...key].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127)) throw new Error("An account app handler key is invalid.");
    return [key, parseAccountAppId(value)];
  }));
}

/** Parses and validates account apps snapshot. */
export function parseAccountAppsSnapshot(value: unknown): AccountAppsSnapshot {
  if (!isRecord(value)) throw new Error("The account apps response has an unsupported format.");
  exactKeys(value, ["appsRevision", "apps", "handlerHints", "resources", "installation"], "The account apps response has an unsupported shape.");
  if (!Array.isArray(value.apps) || !isRecord(value.resources) || !isRecord(value.installation) || !Array.isArray(value.installation.apps)) throw new Error("The account apps response has invalid inventory metadata.");
  exactKeys(value.resources, ["installation", "handlers"], "The account apps resource list has an unsupported shape.");
  exactKeys(value.installation, ["apps"], "The physical installation resource has an unsupported shape.");
  const apps = value.apps.map((item) => parseApp(item, true) as AccountApp);
  const installation = value.installation.apps.map((item) => parseApp(item, false) as Omit<AccountApp, "data">);
  if (new Set(apps.map((item) => item.appId)).size !== apps.length || apps.some((item, index) => index > 0 && apps[index - 1].appId >= item.appId)) throw new Error("The account app inventory is not uniquely ordered.");
  const installed = apps.map((app) => ({ appId: app.appId, manifest: app.manifest, generations: app.generations, manifestResource: app.manifestResource, package: app.package }));
  if (JSON.stringify(installed) !== JSON.stringify(installation)) throw new Error("The physical installation resource does not match the account app inventory.");
  const snapshot = {
    appsRevision: readRevision(value.appsRevision),
    apps,
    handlerHints: parseHints(value.handlerHints),
    resources: { installation: parseAccountResourceBlob(value.resources.installation, "installation"), handlers: parseAccountResourceBlob(value.resources.handlers, "handlers") },
    installation: { apps: installation },
  };
  const installedIds = new Set(apps.map((app) => app.appId));
  if (Object.values(snapshot.handlerHints).some((target) => !installedIds.has(target))) throw new Error("Account app handler hints reference an app outside the inventory.");
  if ([...apps.flatMap((item) => [item.package.revision, item.manifestResource.revision, ...item.data.map((data) => data.revision)]), snapshot.resources.installation.revision, snapshot.resources.handlers.revision].some((revision) => revision > snapshot.appsRevision)) throw new Error("An account app resource is newer than the inventory revision.");
  return snapshot;
}

/** Parses and validates apps revision event. */
export function parseAppsRevisionEvent(value: unknown) {
  if (!isRecord(value)) throw new Error("The account apps event has an unsupported format.");
  exactKeys(value, ["appsRevision"], "The account apps event has an unsupported shape.");
  return readRevision(value.appsRevision);
}

/** Determines whether an approval matches an account app. */
export function accountApprovalMatches(approval: InstalledApp | undefined, app: AccountApp) {
  return approval?.source === "account"
    && approval.appId === app.appId
    && approval.installationGeneration === app.generations.installationGeneration
    && approval.digest === app.package.sha256
    && approval.manifest.permissions.length === app.manifest.permissions.length
    && approval.manifest.permissions.every((permission, index) => permission === app.manifest.permissions[index]);
}

/** Collects resources referenced by an account-app snapshot. */
export function accountResources(snapshot: AccountAppsSnapshot): AccountResource[] {
  return [
    { id: snapshot.resources.installation.resourceId, kind: "installation", ...snapshot.resources.installation },
    { id: snapshot.resources.handlers.resourceId, kind: "handlers", ...snapshot.resources.handlers },
    ...snapshot.apps.map((app): AccountResource => ({ id: app.manifestResource.resourceId, kind: "manifest", ...app.manifestResource, appId: app.appId })),
  ];
}

/** Reports whether an account-app request failure is transient. */
export function accountAppsRequestIsTransient(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Reports whether an account-app request failure is permanent. */
export function accountAppsRequestIsPermanent(status: number) {
  return status >= 400 && status < 500 && !accountAppsRequestIsTransient(status);
}

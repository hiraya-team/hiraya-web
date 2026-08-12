import { parseJsonValue, parseManifestV2, type HirayaAppManifestV2, type JsonValue } from "@hiraya-team/apps-contracts";
import type { InstalledApp } from "../apps/installed-apps";
import { RESERVED_SYSTEM_APP_IDS } from "../apps/system-app-ids";
import { API_ROUTES, authenticatedHeaders } from "./api-routes";
import { requireAuthenticatedResponse } from "./auth";
import { responseBlobWithProgress, sha256Blob, uploadBlobDigests } from "./blob-transfer";
import { isRecord, parseDirectBlobAccess, readRevision, type DirectBlobAccess } from "./contracts";

const SHA256 = /^[a-f0-9]{64}$/;
const APP_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const MAX_DATA_BYTES = 64 * 1024;

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

function exactKeys(value: Record<string, unknown>, keys: readonly string[], message: string) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) throw new Error(message);
}

export function parseAccountAppId(value: unknown) {
  if (typeof value !== "string" || value.length > 256 || !APP_ID.test(value)) throw new Error("An account app has an invalid app ID.");
  return value;
}

function nonNegative(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(message);
  return Number(value);
}

function positive(value: unknown, message: string) {
  const result = nonNegative(value, message);
  if (result < 1) throw new Error(message);
  return result;
}

function digest(value: unknown) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error("An account app resource has an invalid SHA-256 digest.");
  return value;
}

export function parseAccountAppBlob(value: unknown): AccountAppBlob {
  if (!isRecord(value)) throw new Error("An account app resource has an unsupported format.");
  exactKeys(value, ["blobId", "revision", "size", "sha256"], "An account app resource has an unsupported shape.");
  if (typeof value.blobId !== "string" || !value.blobId || value.blobId.length > 256) throw new Error("An account app resource has an invalid blob ID.");
  return { blobId: value.blobId, revision: readRevision(value.revision), size: nonNegative(value.size, "An account app resource has an invalid size."), sha256: digest(value.sha256) };
}

function parseAccountResourceBlob(value: unknown, kind: AccountResource["kind"], expectedAppId = ""): AccountAppResourceBlob {
  if (!isRecord(value)) throw new Error("An account app resource has an unsupported format.");
  exactKeys(value, ["blobId", "revision", "size", "sha256", "resourceId", "path", "name", "mimeType"], "An account app resource has an unsupported shape.");
  const base = parseAccountAppBlob(Object.fromEntries(["blobId", "revision", "size", "sha256"].map((key) => [key, value[key]])));
  const expectedPath = kind === "manifest" ? `.hiraya/account/apps/${expectedAppId}/manifest.json` : `.hiraya/account/${kind}.json`;
  const expectedName = `${kind}.json`;
  if (value.resourceId !== base.blobId || value.path !== expectedPath || value.name !== expectedName || value.mimeType !== "application/json") throw new Error("An account app resource has inconsistent physical metadata.");
  return { ...base, resourceId: value.resourceId, path: value.path, name: value.name, mimeType: value.mimeType } as AccountAppResourceBlob;
}

function parseGenerations(value: unknown): AccountAppGenerations {
  if (!isRecord(value)) throw new Error("An account app has invalid generations.");
  exactKeys(value, ["installationGeneration", "dataGeneration", "itemRevision"], "An account app has invalid generations.");
  return {
    installationGeneration: positive(value.installationGeneration, "An account app has an invalid installation generation."),
    dataGeneration: nonNegative(value.dataGeneration, "An account app has an invalid data generation."),
    itemRevision: positive(value.itemRevision, "An account app has an invalid item revision."),
  };
}

export function parseAccountAppDataKey(value: unknown) {
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).byteLength > 128 || [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  })) throw new Error("An account app data key is invalid.");
  return value;
}

function parseDataItem(value: unknown): AccountAppDataItem {
  if (!isRecord(value)) throw new Error("An account app data item has an unsupported format.");
  exactKeys(value, ["key", "dataGeneration", "revision", "size", "sha256"], "An account app data item has an unsupported shape.");
  return { key: parseAccountAppDataKey(value.key), dataGeneration: nonNegative(value.dataGeneration, "An account app data item has an invalid generation."), revision: readRevision(value.revision), size: nonNegative(value.size, "An account app data item has an invalid size."), sha256: digest(value.sha256) };
}

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

function parseHints(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > 128) throw new Error("Account app handler hints have an unsupported format.");
  return Object.fromEntries(Object.entries(value).map(([key, value]) => {
    if (!key || new TextEncoder().encode(key).byteLength > 255 || [...key].some((character) => (character.codePointAt(0) ?? 0) < 32 || character.codePointAt(0) === 127)) throw new Error("An account app handler key is invalid.");
    return [key, parseAccountAppId(value)];
  }));
}

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

export function parseAppsRevisionEvent(value: unknown) {
  if (!isRecord(value)) throw new Error("The account apps event has an unsupported format.");
  exactKeys(value, ["appsRevision"], "The account apps event has an unsupported shape.");
  return readRevision(value.appsRevision);
}

export function accountApprovalMatches(approval: InstalledApp | undefined, app: AccountApp) {
  return approval?.source === "account"
    && approval.appId === app.appId
    && approval.installationGeneration === app.generations.installationGeneration
    && approval.digest === app.package.sha256
    && approval.manifest.permissions.length === app.manifest.permissions.length
    && approval.manifest.permissions.every((permission, index) => permission === app.manifest.permissions[index]);
}

export function accountResources(snapshot: AccountAppsSnapshot): AccountResource[] {
  return [
    { id: snapshot.resources.installation.resourceId, kind: "installation", ...snapshot.resources.installation },
    { id: snapshot.resources.handlers.resourceId, kind: "handlers", ...snapshot.resources.handlers },
    ...snapshot.apps.map((app): AccountResource => ({ id: app.manifestResource.resourceId, kind: "manifest", ...app.manifestResource, appId: app.appId })),
  ];
}

export class AccountAppsRequestError extends Error {
  constructor(readonly status: number, message = `Account apps could not be synchronized (${status}).`, readonly code: string | null = null) { super(message); this.name = "AccountAppsRequestError"; }
}

export function accountAppsRequestIsTransient(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function accountAppsRequestIsPermanent(status: number) {
  return status >= 400 && status < 500 && !accountAppsRequestIsTransient(status);
}

async function accountAppsResponseError(response: Response, fallback: string) {
  const value = await response.json().catch(() => null) as unknown;
  const message = isRecord(value) && typeof value.error === "string" && value.error ? value.error : fallback;
  const code = isRecord(value) && typeof value.code === "string" && value.code ? value.code : null;
  return new AccountAppsRequestError(response.status, message, code);
}

async function authenticatedJson(input: RequestInfo | URL, init?: RequestInit) {
  const response = requireAuthenticatedResponse(await fetch(input, { cache: "no-store", credentials: "same-origin", ...init, headers: authenticatedHeaders(init?.headers) }));
  if (!response.ok) throw await accountAppsResponseError(response, `Account apps could not be synchronized (${response.status}).`);
  return response.json() as Promise<unknown>;
}

export async function fetchAccountApps() {
  return parseAccountAppsSnapshot(await authenticatedJson(API_ROUTES.apps));
}

function parseDownload(value: unknown, app: AccountApp, directBlobOrigin: string) {
  if (!isRecord(value)) throw new Error("The app package download has an unsupported format.");
  exactKeys(value, ["appId", "blobId", "revision", "size", "sha256", "access"], "The app package download has an unsupported shape.");
  if (value.appId !== app.appId || value.blobId !== app.package.blobId || value.revision !== app.package.revision || value.size !== app.package.size || value.sha256 !== app.package.sha256) throw new Error("The app package download does not match the account inventory.");
  return parseDirectBlobAccess(value.access, "GET", directBlobOrigin);
}

async function directDownload(access: DirectBlobAccess, expected: Pick<AccountAppBlob, "size" | "sha256">, type: string) {
  const response = await fetch(access.url, { method: access.method, headers: access.headers, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new AccountAppsRequestError(response.status, `The synchronized app resource could not be downloaded (${response.status}).`);
  const downloaded = await responseBlobWithProgress(response, expected.size, () => undefined);
  if (downloaded.blob.size !== expected.size || downloaded.sha256 !== expected.sha256) throw new Error("The synchronized app resource failed integrity verification.");
  return new Blob([downloaded.blob], { type });
}

function accountResourceRoute(resource: AccountResource, content: boolean) {
  const kind = resource.kind === "manifest" ? "manifests" : resource.kind;
  return content ? API_ROUTES.appResourceContent(kind, resource.appId) : API_ROUTES.appResource(kind, resource.appId);
}

function parseAccountResourceResponse(value: unknown, expected: AccountResource, directBlobOrigin?: string) {
  if (!isRecord(value)) throw new Error("The account resource response has an unsupported format.");
  exactKeys(value, directBlobOrigin ? ["resource", "access"] : ["resource"], "The account resource response has an unsupported shape.");
  const resource = parseAccountResourceBlob(value.resource, expected.kind, expected.appId);
  if (resource.resourceId !== expected.id || resource.revision !== expected.revision || resource.size !== expected.size || resource.sha256 !== expected.sha256) throw new Error("The account resource changed while it was being opened.");
  return directBlobOrigin ? parseDirectBlobAccess(value.access, "GET", directBlobOrigin) : null;
}

export async function downloadAccountResource(resource: AccountResource, directBlobOrigin: string) {
  const value = await authenticatedJson(accountResourceRoute(resource, true));
  const access = parseAccountResourceResponse(value, resource, directBlobOrigin)!;
  const blob = await directDownload(access, resource, resource.mimeType);
  JSON.parse(await blob.text());
  return new File([blob], resource.name, { type: resource.mimeType });
}

export async function downloadAccountAppPackage(app: AccountApp, directBlobOrigin: string) {
  const access = parseDownload(await authenticatedJson(API_ROUTES.appPackageDownload(app.appId)), app, directBlobOrigin);
  const archive = await directDownload(access, app.package, "application/vnd.hiraya.app+zip");
  const { inspectAppArchive } = await import("@hiraya-team/app-cli");
  const inspection = await inspectAppArchive(new Uint8Array(await archive.arrayBuffer()));
  if (inspection.digest !== app.package.sha256 || JSON.stringify(inspection.manifest) !== JSON.stringify(app.manifest)) throw new Error("The synchronized app package does not match its manifest.");
  return { archive, inspection };
}

export async function downloadAccountAppData(app: AccountApp, key: string, directBlobOrigin: string): Promise<JsonValue | undefined> {
  const item = app.data.find((candidate) => candidate.key === key);
  if (!item) return undefined;
  const value = await authenticatedJson(API_ROUTES.appData(app.appId, key));
  if (!isRecord(value)) throw new Error("The app data download has an unsupported format.");
  exactKeys(value, ["appId", "key", "dataGeneration", "revision", "size", "sha256", "access"], "The app data download has an unsupported shape.");
  if (value.appId !== app.appId || value.key !== key || value.dataGeneration !== item.dataGeneration || value.revision !== item.revision || value.size !== item.size || value.sha256 !== item.sha256) throw new Error("The app data download does not match the account inventory.");
  const blob = await directDownload(parseDirectBlobAccess(value.access, "GET", directBlobOrigin), item, "application/json");
  if (blob.size > MAX_DATA_BYTES) throw new Error("The synchronized app data is too large.");
  return parseJsonValue(JSON.parse(await blob.text()));
}

export type PreparedAccountPackage = Readonly<{ uploadId: string; access: DirectBlobAccess; expectedInstallationGeneration: number; expectedItemRevision: number }>;

export async function prepareAccountPackage(archive: Blob, manifest: HirayaAppManifestV2, clientId: string, operationId: string, directBlobOrigin: string): Promise<PreparedAccountPackage | null> {
  if (archive.size < 1 || archive.size > MAX_PACKAGE_BYTES) throw new Error("The app package has an unsupported size.");
  const hashes = await uploadBlobDigests(archive);
  const value = await authenticatedJson(API_ROUTES.appPackages, { method: "POST", headers: { "Content-Type": "application/json", "X-Hiraya-Client-ID": clientId, "X-Hiraya-Operation-ID": operationId }, body: JSON.stringify({ appId: manifest.id, manifest, size: archive.size, ...hashes }) });
  if (!isRecord(value)) throw new Error("The app package preparation has an unsupported format.");
  if (value.state === "committed") {
    exactKeys(value, ["state", "appsRevision"], "The app package preparation has an unsupported replay shape.");
    readRevision(value.appsRevision);
    return null;
  }
  exactKeys(value, ["state", "uploadId", "expiresAt", "expectedInstallationGeneration", "expectedItemRevision", "package"], "The app package preparation has an unsupported shape.");
  if (value.state !== "prepared" || typeof value.uploadId !== "string" || !value.uploadId || !isRecord(value.package)) throw new Error("The app package preparation has invalid metadata.");
  exactKeys(value.package, ["blobId", "size", "sha256", "access"], "The app package preparation has an unsupported package shape.");
  if (value.package.size !== archive.size || value.package.sha256 !== hashes.sha256) throw new Error("The app package preparation changed the package identity.");
  nonNegative(value.expiresAt, "The app package preparation has an invalid expiration.");
  nonNegative(value.expectedInstallationGeneration, "The app package preparation has an invalid generation.");
  nonNegative(value.expectedItemRevision, "The app package preparation has an invalid revision.");
  return { uploadId: value.uploadId, access: parseDirectBlobAccess(value.package.access, "PUT", directBlobOrigin), expectedInstallationGeneration: Number(value.expectedInstallationGeneration), expectedItemRevision: Number(value.expectedItemRevision) };
}

export async function uploadPreparedAccountPackage(prepared: PreparedAccountPackage, archive: Blob, manifest: HirayaAppManifestV2, digestValue: string, clientId: string, operationId: string) {
  const upload = await fetch(prepared.access.url, { method: prepared.access.method, headers: prepared.access.headers, body: archive, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!upload.ok) throw new AccountAppsRequestError(upload.status, `The app package could not be uploaded (${upload.status}).`);
  const commit = requireAuthenticatedResponse(await fetch(API_ROUTES.appPackageCommit(prepared.uploadId), { method: "POST", cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders({ "X-Hiraya-Client-ID": clientId, "X-Hiraya-Operation-ID": operationId }) }));
  if (commit.status === 409) {
    const value = await commit.json().catch(() => null) as unknown;
    if (isRecord(value) && value.code === "generation_conflict") throw new AccountAppsRequestError(409, "The app changed on another device before this operation was replayed.", "generation_conflict");
    const message = isRecord(value) && typeof value.error === "string" && value.error ? value.error : `The app package could not be committed (${commit.status}).`;
    const code = isRecord(value) && typeof value.code === "string" && value.code ? value.code : null;
    throw new AccountAppsRequestError(commit.status, message, code);
  }
  if (!commit.ok) throw await accountAppsResponseError(commit, `The app package could not be committed (${commit.status}).`);
  const value = await commit.json() as unknown;
  if (!isRecord(value)) throw new Error("The app package commit has an unsupported format.");
  exactKeys(value, ["state", "appsRevision", "appId", "generations", "package", "manifestResource"], "The app package commit has an unsupported shape.");
  if (value.state !== "committed" || value.appId !== manifest.id || !isRecord(value.generations) || !isRecord(value.package) || !isRecord(value.manifestResource)) throw new Error("The app package commit has invalid metadata.");
  readRevision(value.appsRevision);
  const generations = parseGenerations(value.generations);
  const packageRef = parseAccountAppBlob(value.package);
  parseAccountResourceBlob(value.manifestResource, "manifest", manifest.id);
  if (packageRef.sha256 !== digestValue || packageRef.size !== archive.size) throw new Error("The app package commit changed the package identity.");
  return generations;
}

export async function cancelPreparedAccountPackage(prepared: PreparedAccountPackage, clientId: string, operationId: string) {
  const response = requireAuthenticatedResponse(await fetch(API_ROUTES.appPackage(prepared.uploadId), { method: "DELETE", cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders({ "X-Hiraya-Client-ID": clientId, "X-Hiraya-Operation-ID": operationId }) }));
  if (!response.ok && response.status !== 404) throw new Error(`The app package reservation could not be cancelled (${response.status}).`);
}

export async function accountMutation(path: string, method: "PUT" | "DELETE", body: unknown, clientId: string, operationId: string) {
  const response = requireAuthenticatedResponse(await fetch(path, { method, cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders({ "Content-Type": "application/json", "X-Hiraya-Client-ID": clientId, "X-Hiraya-Operation-ID": operationId }), body: JSON.stringify(body) }));
  if (!response.ok) {
    const error = await accountAppsResponseError(response, `The account app change could not be synchronized (${response.status}).`);
    if (error.code === "generation_conflict") throw new AccountAppsRequestError(409, "The app changed on another device before this operation was replayed.", error.code);
    throw error;
  }
  return response.status === 204 ? null : response.json() as Promise<unknown>;
}

export async function verifyLocalAccountPackage(archive: Blob, expectedDigest: string, manifest: HirayaAppManifestV2) {
  if (archive.size < 1 || archive.size > MAX_PACKAGE_BYTES || await sha256Blob(archive) !== expectedDigest) throw new Error("The queued app package failed integrity verification.");
  const { inspectAppArchive } = await import("@hiraya-team/app-cli");
  const inspection = await inspectAppArchive(new Uint8Array(await archive.arrayBuffer()));
  if (inspection.digest !== expectedDigest || JSON.stringify(inspection.manifest) !== JSON.stringify(manifest)) throw new Error("The queued app package failed archive inspection.");
}

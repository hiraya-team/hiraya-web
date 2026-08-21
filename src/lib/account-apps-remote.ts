import type { HirayaAppManifestV2, JsonValue } from "@hiraya-team/apps-contracts";
import { accountStorage } from "../platform/storage/account-storage";
import { sha256Blob } from "./blob-transfer";
import type { AccountApp, AccountAppResourceBlob, AccountAppsSnapshot, AccountResource } from "./account-apps";

/** Limits synchronized account-app package archives. */
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;

/** Fetches the synchronized account-app projection. */
export async function fetchAccountApps(): Promise<AccountAppsSnapshot> {
  const { fetchWeb2AccountApps } = await import("../sync/transport");
  const remote = await fetchWeb2AccountApps(accountStorage().accountId);
  const resource = async (id: string, revision: number, value: unknown, kind: AccountResource["kind"], appId = ""): Promise<AccountAppResourceBlob> => {
    const content = new Blob([JSON.stringify(value)], { type: "application/json" });
    return { blobId: id, resourceId: id, revision, size: content.size, sha256: await sha256Blob(content), path: kind === "manifest" ? `.hiraya/account/apps/${appId}/manifest.json` : `.hiraya/account/${kind}.json`, name: `${kind}.json`, mimeType: "application/json" };
  };
  const apps = await Promise.all(remote.apps.map(async (app): Promise<AccountApp> => ({
    ...app,
    manifestResource: await resource(app.package.manifestHash, app.generations.itemRevision, app.manifest, "manifest", app.appId),
    package: { blobId: app.package.manifestHash, revision: app.generations.itemRevision, size: app.package.size, sha256: app.package.sha256 },
  })));
  const installation = { apps: apps.map((app) => { const { data, ...installed } = app; void data; return installed; }) };
  const [installationResource, handlersResource] = await Promise.all([
    resource(`${accountStorage().accountId}:installation`, remote.appsRevision, installation, "installation"),
    resource(`${accountStorage().accountId}:handlers`, remote.appsRevision, remote.handlerHints, "handlers"),
  ]);
  return { appsRevision: remote.appsRevision, apps, handlerHints: remote.handlerHints, resources: { installation: installationResource, handlers: handlersResource }, installation };
}

/** Downloads a synchronized account resource. */
export async function downloadAccountResource(resource: AccountResource, directBlobOrigin: string) {
  void directBlobOrigin;
  const snapshot = await fetchAccountApps();
  const value = resource.kind === "handlers" ? snapshot.handlerHints
    : resource.kind === "installation" ? snapshot.installation
      : snapshot.apps.find(({ appId }) => appId === resource.appId)?.manifest;
  if (value === undefined) throw new Error("That account app resource no longer exists.");
  return new File([JSON.stringify(value)], resource.name, { type: resource.mimeType });
}

/** Downloads a synchronized account-app package. */
export async function downloadAccountAppPackage(app: AccountApp, directBlobOrigin: string) {
  const { downloadWeb2AccountAppPackage } = await import("../sync/transport");
  return downloadWeb2AccountAppPackage(accountStorage().accountId, { appId: app.appId, manifest: app.manifest, generations: app.generations, package: { manifestHash: app.package.blobId, size: app.package.size, sha256: app.package.sha256 }, data: app.data }, directBlobOrigin);
}

/** Downloads synchronized account-app data. */
export async function downloadAccountAppData(app: AccountApp, key: string, directBlobOrigin: string): Promise<JsonValue | undefined> {
  void directBlobOrigin;
  const item = app.data.find((candidate) => candidate.key === key);
  if (!item) return undefined;
  const { fetchWeb2AccountAppData } = await import("../sync/transport");
  return fetchWeb2AccountAppData(accountStorage().accountId, { appId: app.appId, manifest: app.manifest, generations: app.generations, package: { manifestHash: app.package.blobId, size: app.package.size, sha256: app.package.sha256 }, data: app.data }, key);
}

/** Verifies a local account-app package before synchronization. */
export async function verifyLocalAccountPackage(archive: Blob, expectedDigest: string, manifest: HirayaAppManifestV2) {
  if (archive.size < 1 || archive.size > MAX_PACKAGE_BYTES || await sha256Blob(archive) !== expectedDigest) throw new Error("The queued app package failed integrity verification.");
  const { inspectAppArchive } = await import("@hiraya-team/app-cli");
  const inspection = await inspectAppArchive(new Uint8Array(await archive.arrayBuffer()));
  if (inspection.digest !== expectedDigest || JSON.stringify(inspection.manifest) !== JSON.stringify(manifest)) throw new Error("The queued app package failed archive inspection.");
}

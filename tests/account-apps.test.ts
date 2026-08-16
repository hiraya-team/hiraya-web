import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { installedAppAcceptsMatcher, type InstalledApp } from "../src/apps/installed-apps";
import { AccountAppsRequestError, accountApprovalMatches, accountAppsRequestIsPermanent, accountAppsRequestIsTransient, accountMutation, accountResources, parseAccountAppsSnapshot, verifyLocalAccountPackage } from "../src/lib/account-apps";
import { parseAccountAppOutboxRecord, projectAccountAppData, projectAccountApps, rebaseAccountAppOperation, type AccountAppOutboxRecord } from "../src/lib/account-app-outbox";
import { API_ROUTES } from "../src/lib/api-routes";
import { uploadBlobDigests } from "../src/lib/blob-transfer";
import { ACCOUNT_APP_ATOMIC_STORES } from "../src/platform/storage/database-client";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppStoreWindow } from "../src/components/AppStoreWindow";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { openFilesystemDatabase } from "../src/filesystem/database";

const manifest = { schemaVersion: 2 as const, uiRuntime: 1 as const, id: "dev.hiraya.notes", name: "Notes", version: "1.0.0", entrypoint: "index.html", permissions: ["storage" as const, "files:read" as const], fileTypes: [".txt"] };
const blob = (id: string, revision = 4, size = 100, sha256 = "a".repeat(64)) => ({ blobId: id, revision, size, sha256 });
const resource = (kind: "installation" | "handlers" | "manifest", id: string, revision: number, size: number, sha256: string, appId = "") => ({ ...blob(id, revision, size, sha256), resourceId: id, path: kind === "manifest" ? `.hiraya/account/apps/${appId}/manifest.json` : `.hiraya/account/${kind}.json`, name: `${kind}.json`, mimeType: "application/json" });

function snapshot() {
  const app = { appId: manifest.id, manifest, generations: { installationGeneration: 2, dataGeneration: 3, itemRevision: 5 }, manifestResource: resource("manifest", "manifest", 4, 50, "b".repeat(64), manifest.id), package: blob("package"), data: [{ key: "state", dataGeneration: 3, revision: 5, size: 12, sha256: "c".repeat(64) }] };
  return { appsRevision: 5, apps: [app], handlerHints: { ".txt": manifest.id }, resources: { installation: resource("installation", "installation", 5, 200, "d".repeat(64)), handlers: resource("handlers", "handlers", 5, 30, "e".repeat(64)) }, installation: { apps: [{ appId: app.appId, manifest: app.manifest, generations: app.generations, manifestResource: app.manifestResource, package: app.package }] } };
}

function record(sequence: number, operation: AccountAppOutboxRecord["operation"], status: AccountAppOutboxRecord["status"] = "pending") {
  return parseAccountAppOutboxRecord({ operationId: String(sequence).padStart(16, "0"), clientId: "device", sequence, operation, status, error: status === "blocked" ? "stale" : null, errorCode: status === "blocked" ? "generation_conflict" : null, attemptCount: 0, lastAttemptAt: null });
}

describe("account app wire contract", () => {
  test("strictly parses the server inventory and physical metadata", () => {
    const parsed = parseAccountAppsSnapshot(snapshot());
    expect(parsed.apps[0]?.data[0]?.key).toBe("state");
    expect(accountResources(parsed).map((item) => item.path)).toEqual([
      ".hiraya/account/installation.json",
      ".hiraya/account/handlers.json",
      ".hiraya/account/apps/dev.hiraya.notes/manifest.json",
    ]);
    expect(() => parseAccountAppsSnapshot({ ...snapshot(), inventedAuthority: true })).toThrow("unsupported shape");
    expect(() => parseAccountAppsSnapshot({ ...snapshot(), installation: { apps: [] } })).toThrow("does not match");
    expect(() => parseAccountAppsSnapshot({ ...snapshot(), handlerHints: { ".txt": "dev.hiraya.missing" } })).toThrow("outside the inventory");
  });

  test("constructs only contract routes with escaped path segments", () => {
    expect(API_ROUTES.apps).toBe("/api/apps");
    expect(API_ROUTES.appPackageCommit("upload/value")).toBe("/api/apps/packages/upload%2Fvalue/commit");
    expect(API_ROUTES.appData(manifest.id, "folder/name draft")).toBe("/api/apps/dev.hiraya.notes/data/folder%2Fname%20draft");
    expect(API_ROUTES.appResourceContent("manifests", manifest.id)).toBe("/api/apps/resources/manifests/dev.hiraya.notes/content");
  });

  test("classifies permanent client failures separately from retryable responses", () => {
    for (const status of [400, 403, 404, 409, 413, 422]) expect(accountAppsRequestIsPermanent(status)).toBe(true);
    for (const status of [408, 425, 429, 500, 503]) {
      expect(accountAppsRequestIsTransient(status)).toBe(true);
      expect(accountAppsRequestIsPermanent(status)).toBe(false);
    }
  });

  test("preserves actionable server error codes and messages", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ error: "Account app storage quota exceeded.", code: "quota_exceeded" }, { status: 409 })) as typeof fetch;
    try {
      await expect(accountMutation("/api/apps/dev.hiraya.notes/data/state", "PUT", {}, "client", "operation")).rejects.toEqual(expect.objectContaining({ name: "AccountAppsRequestError", status: 409, code: "quota_exceeded", message: "Account app storage quota exceeded." } satisfies Partial<AccountAppsRequestError>));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("account app projection and ordered outbox", () => {
  test("uses a dedicated atomic state, outbox, identity, and data transaction", () => {
    expect(ACCOUNT_APP_ATOMIC_STORES).toEqual(["account-apps", "account-app-outbox", "account-app-client-state", "app-storage"]);
  });

  test("replays server-order LWW operations and restores blocked stale operations", () => {
    const baseline = parseAccountAppsSnapshot(snapshot());
    const uninstall = record(1, { schemaVersion: 1, kind: "uninstall", appId: manifest.id, installationGeneration: 2 });
    const install = record(2, { schemaVersion: 1, kind: "install", appId: manifest.id, manifest: { ...manifest, version: "2.0.0" }, digest: "f".repeat(64), md5: "a".repeat(32), size: 200 });
    expect(projectAccountApps(baseline, [uninstall, install]).apps[0]?.manifest.version).toBe("2.0.0");
    expect(projectAccountApps(baseline, [install, uninstall]).apps).toEqual([]);
    expect(projectAccountApps(baseline, [{ ...uninstall, status: "blocked" }]).apps[0]?.appId).toBe(manifest.id);
  });

  test("keeps data generation separate and blocks a stale clear projection", () => {
    const baseline = parseAccountAppsSnapshot(snapshot());
    const clear = record(1, { schemaVersion: 1, kind: "clear-data", appId: manifest.id, dataGeneration: 3 });
    expect(projectAccountApps(baseline, [clear]).apps[0]).toMatchObject({ installationGeneration: 2, dataGeneration: 4 });
    const stale = record(2, { schemaVersion: 1, kind: "clear-data", appId: manifest.id, dataGeneration: 2 });
    expect(projectAccountApps(baseline, [stale]).apps[0]).toMatchObject({ installationGeneration: 2, dataGeneration: 3 });
  });

  test("does not guess a new install generation and projects pending data before remote state", () => {
    const install = record(1, { schemaVersion: 1, kind: "install", appId: "dev.hiraya.other", manifest: { ...manifest, id: "dev.hiraya.other" }, digest: "f".repeat(64), md5: "a".repeat(32), size: 200 });
    expect(projectAccountApps(parseAccountAppsSnapshot(snapshot()), [install]).apps.find((app) => app.appId === "dev.hiraya.other")?.installationGeneration).toBeNull();
    const clear = record(2, { schemaVersion: 1, kind: "clear-data", appId: manifest.id, dataGeneration: 3 });
    const put = record(3, { schemaVersion: 1, kind: "put-data", appId: manifest.id, key: "state", dataGeneration: 4, value: { draft: true } });
    expect(projectAccountAppData([clear, put], manifest.id, "state")).toEqual({ resolved: true, value: { draft: true } });
    expect(projectAccountAppData([put, { ...clear, status: "blocked" }], manifest.id, "state")).toEqual({ resolved: true, value: { draft: true } });
  });

  test("rebases a blocked generation only from an authoritative snapshot", () => {
    const baseline = parseAccountAppsSnapshot(snapshot());
    const stale = { schemaVersion: 1 as const, kind: "delete-data" as const, appId: manifest.id, key: "state", dataGeneration: 1 };
    expect(rebaseAccountAppOperation(stale, baseline)).toEqual({ ...stale, dataGeneration: 3 });
  });

  test("persists and atomically replays the fresh account app outbox", async () => {
    const factory = new IDBFactory();
    const accountId = "00000000-0000-4000-8000-000000000001";
    const clientId = "00000000-0000-4000-8000-000000000002";
    const database = await openFilesystemDatabase(accountId, { indexedDB: factory, IDBKeyRange, randomUUID: () => clientId });
    expect(await database.readAccountApps()).toEqual({ state: { id: "singleton", baseline: null, projection: { appsRevision: 0, apps: [], handlerHints: {} } }, outbox: [] });
    const baseline = parseAccountAppsSnapshot(snapshot());
    await database.reconcileAccountApps(baseline);
    const app = baseline.apps[0]!;
    await database.installApp({ appId: app.appId, source: "account", packageEntryId: null, archivePath: null, installationGeneration: app.generations.installationGeneration, digest: app.package.sha256, version: app.manifest.version, manifest: app.manifest, approvedAt: 1 });
    await database.writeAppStorage(app.appId, "state", { draft: false }, 64 * 1024, 128);

    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "account-app-outbox") throw new DOMException("Injected account app enqueue failure", "AbortError");
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    try {
      await expect(database.enqueueAccountAppOperation({ schemaVersion: 1, kind: "put-data", appId: app.appId, key: "state", dataGeneration: 0, value: { draft: true } })).rejects.toThrow("Injected account app enqueue failure");
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    expect(await database.readAppStorage(app.appId, "state")).toEqual({ draft: false });
    expect((await database.readAccountApps()).outbox).toEqual([]);

    const queued = await database.enqueueAccountAppOperation({ schemaVersion: 1, kind: "put-data", appId: app.appId, key: "state", dataGeneration: 0, value: { draft: true } });
    expect(queued.record).toMatchObject({ operationId: "0000000000000001", clientId, sequence: 1, operation: { kind: "put-data", dataGeneration: 3 } });
    expect(await database.readAppStorage(app.appId, "state")).toEqual({ draft: true });
    await database.blockAccountAppOperation(queued.record.operationId, "stale", "generation_conflict");
    expect((await database.readAccountApps()).outbox[0]).toMatchObject({ status: "blocked", errorCode: "generation_conflict" });
    await expect(database.discardAccountAppOperation(queued.record.operationId, { kind: "put", appId: app.appId, key: "state", value: "x".repeat(70_000) })).rejects.toThrow("quota");
    expect((await database.readAccountApps()).outbox[0]?.status).toBe("blocked");
    await database.discardAccountAppOperation(queued.record.operationId, { kind: "replace", appId: app.appId, values: [["state", { draft: false }]] });
    expect(await database.readAppStorage(app.appId, "state")).toEqual({ draft: false });
    expect((await database.readAccountApps()).outbox).toEqual([]);

    const deletion = await database.enqueueAccountAppOperation({ schemaVersion: 1, kind: "delete-data", appId: app.appId, key: "state", dataGeneration: 0 });
    await database.blockAccountAppOperation(deletion.record.operationId, "stale", "generation_conflict");
    const retried = await database.retryAccountAppOperation(deletion.record.operationId);
    expect(retried).toMatchObject({ status: "pending", operation: { kind: "delete-data", dataGeneration: 3 } });
    await database.recordAccountAppAttempt(retried.operationId, 77);
    expect((await database.readAccountApps()).outbox[0]).toMatchObject({ attemptCount: 1, lastAttemptAt: 77 });
    await database.reconcileAccountApps(baseline, retried.operationId);
    expect((await database.readAccountApps()).outbox).toEqual([]);

    await database.writeAppStorage(app.appId, "first", 1, 64 * 1024, 128);
    await database.writeAppStorage(app.appId, "second", 2, 64 * 1024, 128);
    const cleared = await database.enqueueAccountAppOperation({ schemaVersion: 1, kind: "clear-data", appId: app.appId, dataGeneration: 0 });
    expect(await database.readAppStorage(app.appId, "first")).toBeUndefined();
    await database.blockAccountAppOperation(cleared.record.operationId, "stale", "generation_conflict");
    await database.discardAccountAppOperation(cleared.record.operationId, { kind: "replace", appId: app.appId, values: [["first", 1], ["second", 2]] });
    expect(await database.readAppStorage(app.appId, "first")).toBe(1);
    expect(await database.readAppStorage(app.appId, "second")).toBe(2);
    const pending = await database.enqueueAccountAppOperation({ schemaVersion: 1, kind: "handlers", hints: { ".md": app.appId } });
    expect(pending.record).toMatchObject({ operationId: "0000000000000004", clientId, sequence: 4 });
    database.close();

    const reopened = await openFilesystemDatabase(accountId, { indexedDB: factory, IDBKeyRange, randomUUID: () => clientId });
    expect(await reopened.readAccountApps()).toEqual({ state: { id: "singleton", baseline, projection: projectAccountApps(baseline, [pending.record]) }, outbox: [pending.record] });
    const next = await reopened.enqueueAccountAppOperation({ schemaVersion: 1, kind: "handlers", hints: baseline.handlerHints });
    expect(next.record).toMatchObject({ operationId: "0000000000000005", clientId, sequence: 5 });
    reopened.close();
  });
});

describe("account app approval and package integrity", () => {
  test("shows an account-approved package as synchronizing until its verified archive is local", () => {
    const app = parseAccountAppsSnapshot(snapshot()).apps[0];
    const html = renderToString(createElement(AppStoreWindow, { packages: [], installedApps: [], entries: [], loading: false, error: "", offline: false, onRetry() {}, onInstall() {}, onLaunch() {}, onReset() {}, onUninstall() {}, accountApps: [app], accountError: "", accountPending: 0, onSyncAccount() {}, onUninstallAccount() {} }));
    expect(html).toContain("Syncing to this device");
    expect(html).toContain("Retry sync");
    expect(html).toContain("Approved for this account");
    expect(html).not.toContain(">Open</button>");
  });

  test("requires generation, digest, and exact ordered permissions before launch or handler activation", () => {
    const app = parseAccountAppsSnapshot(snapshot()).apps[0];
    const approval: InstalledApp = { appId: app.appId, source: "account", packageEntryId: null, archivePath: null, installationGeneration: 2, digest: app.package.sha256, version: app.manifest.version, manifest: app.manifest, approvedAt: 1 };
    expect(accountApprovalMatches(approval, app)).toBe(true);
    expect(installedAppAcceptsMatcher(approval, ".txt")).toBe(true);
    expect(accountApprovalMatches({ ...approval, installationGeneration: 1 }, app)).toBe(false);
    expect(accountApprovalMatches({ ...approval, digest: "0".repeat(64) }, app)).toBe(false);
    expect(accountApprovalMatches({ ...approval, manifest: { ...approval.manifest, permissions: [...approval.manifest.permissions].reverse() } }, app)).toBe(false);
  });

  test("checks size, SHA-256, manifest identity, and safe archive structure", async () => {
    const bytes = zipSync({ "hiraya.app.json": strToU8(JSON.stringify(manifest)), "index.html": strToU8("<main>Notes</main>") });
    const archive = new Blob([bytes]);
    const { sha256 } = await uploadBlobDigests(archive);
    await expect(verifyLocalAccountPackage(archive, sha256, manifest)).resolves.toBeUndefined();
    await expect(verifyLocalAccountPackage(archive, "0".repeat(64), manifest)).rejects.toThrow("integrity");
    await expect(verifyLocalAccountPackage(archive, sha256, { ...manifest, id: "dev.hiraya.other" })).rejects.toThrow("archive inspection");
    const unsafe = new Blob([zipSync({ "hiraya.app.json": strToU8(JSON.stringify(manifest)), "index.html": strToU8("ok"), "../escape": strToU8("bad") })]);
    const unsafeDigest = (await uploadBlobDigests(unsafe)).sha256;
    await expect(verifyLocalAccountPackage(unsafe, unsafeDigest, manifest)).rejects.toThrow();
  });
});

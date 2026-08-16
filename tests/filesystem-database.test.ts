import { describe, expect, test } from "bun:test";
import { IDBDatabase, IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import {
  filesystemDatabaseName,
  openFilesystemDatabase,
  type FilesystemDatabase,
  type WorkspaceOperationDraft,
} from "../src/filesystem/database";
import {
  WEB2_CHUNK_SIZE,
  WEB2_MAX_BATCH_ITEMS,
  canonicalManifestSha256,
  type Manifest,
  type NodeRecord,
  type Setting,
} from "../src/filesystem/model";
import { hydrationTargetId, type HydrationTarget } from "../src/filesystem/hydration";
import { DEFAULT_DEVICE_PREFERENCES } from "../src/domain/preferences";
import type { InstalledApp } from "../src/apps/installed-apps";
import { SYSTEM_APP_IDS } from "../src/apps/system-app-ids";

const ACCOUNT = stableId(1);
const WORKSPACE = stableId(2);
const DEVICE = stableId(3);
const DESTINATION = stableId(4);
const ACCOUNT_HASH = "11e594f481958c10e3015d0bf0447a22f068a8a647f475df15ce2c7ab4b8f3f1";

function stableId(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function environment(factory: IDBFactory, now?: () => number) {
  return { indexedDB: factory, IDBKeyRange, now };
}

function idbRequest<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function openRaw(factory: IDBFactory, name: string, version?: number, upgrade?: (database: IDBDatabase) => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = version === undefined ? factory.open(name) : factory.open(name, version);
    open.onupgradeneeded = () => upgrade?.(open.result);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function readStored(factory: IDBFactory, name: string, storeName: string, key?: IDBValidKey) {
  const database = await openRaw(factory, name);
  try {
    const store = database.transaction(storeName).objectStore(storeName);
    return key === undefined ? idbRequest(store.getAll()) : idbRequest(store.get(key));
  } finally {
    database.close();
  }
}

async function verifiedManifest(size: number, digit: number) {
  const manifest: Manifest = {
    schemaVersion: 1,
    size,
    chunkSize: WEB2_CHUNK_SIZE,
    chunks: size === 0 ? [] : [{ hash: digit.toString(16).repeat(64), size }],
  };
  return { hash: await canonicalManifestSha256(manifest), manifest };
}

function folder(id: string, name: string, parentId: string | null = null) {
  return { id, kind: "folder" as const, name, parentId, position: { x: 1, y: 2 }, createdAt: 10, modifiedAt: 10 };
}

function file(id: string, name: string, manifest: Awaited<ReturnType<typeof verifiedManifest>>, parentId: string | null = null, modifiedAt = 10) {
  return { id, kind: "file" as const, name, parentId, position: { x: 3, y: 4 }, createdAt: 10, modifiedAt, mimeType: "text/plain", size: manifest.manifest.size, manifestHash: manifest.hash };
}

function createDraft(operationId: string, nodes: ReturnType<typeof folder | typeof file>[], workspaceId = WORKSPACE): WorkspaceOperationDraft {
  return { schemaVersion: 1, kind: "create", operationId, workspaceId, deviceId: DEVICE, nodes };
}

function copyDraft(operationId: string, sourceNodeIds: string[], nodes: ReturnType<typeof folder | typeof file>[]): Extract<WorkspaceOperationDraft, { kind: "copy" }> {
  return { schemaVersion: 1, kind: "copy", operationId, workspaceId: WORKSPACE, deviceId: DEVICE, sourceNodeIds, nodes };
}

function writeDraft(operationId: string, nodeId: string, manifest: Awaited<ReturnType<typeof verifiedManifest>>, modifiedAt: number): Extract<WorkspaceOperationDraft, { kind: "write" }> {
  return { schemaVersion: 1, kind: "write", operationId, workspaceId: WORKSPACE, deviceId: DEVICE, nodeId, mimeType: "text/markdown", size: manifest.manifest.size, manifestHash: manifest.hash, modifiedAt };
}

function versionDraft(operationId: string, nodeId: string, version: { mimeType: string; size: number; manifestHash: string; modifiedAt: number }): WorkspaceOperationDraft {
  return { schemaVersion: 1, kind: "write", operationId, workspaceId: WORKSPACE, deviceId: DEVICE, nodeId, ...version };
}

function operationBase(operationId: string) {
  return { schemaVersion: 1 as const, operationId, workspaceId: WORKSPACE, deviceId: DEVICE };
}

function installedApp(appId = "test.editor"): InstalledApp {
  return { appId, source: "desktop", packageEntryId: "package-one", archivePath: null, digest: "a".repeat(64), version: "1.0.0", approvedAt: 10, manifest: { schemaVersion: 2, uiRuntime: 1, id: appId, name: "Editor", version: "1.0.0", entrypoint: "index.html", permissions: ["files:read"], fileTypes: [".txt"] } };
}

function transferDraft(operationId: string, nodeIds: string[], destinationWorkspaceId = DESTINATION, parentId: string | null = null, deviceId = DEVICE): Extract<WorkspaceOperationDraft, { kind: "transfer" }> {
  return { schemaVersion: 1, kind: "transfer", operationId, workspaceId: WORKSPACE, deviceId, nodeIds, destinationWorkspaceId, parentId, modifiedAt: 77 };
}

async function workspaceDatabase(factory: IDBFactory, now?: () => number, id = WORKSPACE) {
  const database = await openFilesystemDatabase(ACCOUNT, environment(factory, now));
  await database.createWorkspace({ id, name: "Workspace", pinned: true, deviceId: DEVICE });
  return database;
}

async function commitWrite(database: FilesystemDatabase, operation: Extract<WorkspaceOperationDraft, { kind: "write" }>, manifests: Array<Awaited<ReturnType<typeof verifiedManifest>>>) {
  const node = await database.getNode(operation.nodeId);
  if (!node || node.kind !== "file") throw new Error("The test file does not exist.");
  return database.commitOperation({ operation, manifests, expectedContentTuple: node.fieldTuples.content! });
}

async function expectEmptyCommit(database: FilesystemDatabase, factory: IDBFactory, expectedRevision = 0) {
  expect(await database.listOperations(WORKSPACE)).toEqual([]);
  expect((await database.listWorkspaces())[0]!.localRevision).toBe(expectedRevision);
  expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "changes")).toEqual([]);
}

describe("web2 filesystem database", () => {
  test("uses only the fresh account namespace and leaves an old sentinel untouched", async () => {
    const factory = new IDBFactory();
    const oldName = "hiraya-indexeddb-v1-sentinel";
    const old = await openRaw(factory, oldName, 1, (database) => database.createObjectStore("sentinel"));
    await idbRequest(old.transaction("sentinel", "readwrite").objectStore("sentinel").put("untouched", "value"));
    old.close();

    expect(await filesystemDatabaseName(ACCOUNT)).toBe(`hiraya-web2-v1-${ACCOUNT_HASH}`);
    const database = await openFilesystemDatabase(ACCOUNT, environment(factory));
    database.close();

    expect(await readStored(factory, oldName, "sentinel", "value")).toBe("untouched");
    expect((await factory.databases()).map(({ name }) => name).sort()).toEqual([oldName, `hiraya-web2-v1-${ACCOUNT_HASH}`].sort());
  });

  test("creates the exact version 1 schema and requests strict write durability", async () => {
    const factory = new IDBFactory();
    const durabilities: Array<IDBTransactionOptions["durability"] | undefined> = [];
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (storeNames, mode, options) {
      if (mode === "readwrite") durabilities.push(options?.durability);
      return originalTransaction.call(this, storeNames, mode, options);
    };
    let database: FilesystemDatabase | undefined;
    try {
      database = await workspaceDatabase(factory);
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction;
    }

    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    try {
      expect(raw.version).toBe(1);
      expect([...raw.objectStoreNames]).toEqual(["account-app-client-state", "account-app-outbox", "account-apps", "app-storage", "changes", "device-preferences", "file-associations", "hydration-coverage", "hydration-pages", "installed-apps", "manifests", "nodes", "operations", "settings", "sync", "window-sessions", "workspaces"]);
      const transaction = raw.transaction([...raw.objectStoreNames]);
      const expected = {
        workspaces: { keyPath: "id", indexes: [] },
        nodes: { keyPath: "id", indexes: ["by-workspace-lifecycle", "by-workspace-parent-lifecycle"] },
        manifests: { keyPath: "hash", indexes: [] },
        operations: { keyPath: "operationId", indexes: ["by-workspace-revision", "by-workspace-state-revision"] },
        changes: { keyPath: ["workspaceId", "revision"], indexes: ["by-operation-id"] },
        sync: { keyPath: "workspaceId", indexes: [] },
        settings: { keyPath: ["workspaceId", "namespace", "key"], indexes: [] },
        "hydration-pages": { keyPath: ["workspaceId", "targetId", "pageIndex"], indexes: ["by-workspace-kind"] },
        "hydration-coverage": { keyPath: ["workspaceId", "targetId"], indexes: ["by-ancestry-node", "by-exact-node", "by-member", "by-workspace-as-of", "by-workspace-kind-namespace"] },
        "window-sessions": { keyPath: "workspaceId", indexes: [] },
        "device-preferences": { keyPath: "id", indexes: [] },
        "installed-apps": { keyPath: "appId", indexes: [] },
        "app-storage": { keyPath: ["appId", "key"], indexes: ["appId"] },
        "file-associations": { keyPath: "matcher", indexes: ["appId"] },
        "account-apps": { keyPath: "id", indexes: [] },
        "account-app-outbox": { keyPath: "sequence", indexes: ["operationId"] },
        "account-app-client-state": { keyPath: "id", indexes: [] },
      };
      for (const [name, schema] of Object.entries(expected)) {
        const store = transaction.objectStore(name);
        expect(store.keyPath).toEqual(schema.keyPath);
        expect(store.autoIncrement).toBe(false);
        expect([...store.indexNames]).toEqual(schema.indexes);
      }
      expect(transaction.objectStore("nodes").index("by-workspace-parent-lifecycle")).toMatchObject({ keyPath: ["workspaceId", "parentKey", "lifecycleKey"], unique: false, multiEntry: false });
      expect(transaction.objectStore("nodes").index("by-workspace-lifecycle")).toMatchObject({ keyPath: ["workspaceId", "lifecycleKey"], unique: false, multiEntry: false });
      expect(transaction.objectStore("operations").index("by-workspace-revision")).toMatchObject({ keyPath: ["workspaceId", "localRevision"], unique: true, multiEntry: false });
      expect(transaction.objectStore("operations").index("by-workspace-state-revision")).toMatchObject({ keyPath: ["workspaceId", "stateKind", "localRevision"], unique: false, multiEntry: false });
      expect(transaction.objectStore("app-storage").index("appId")).toMatchObject({ keyPath: "appId", unique: false, multiEntry: false });
      expect(transaction.objectStore("file-associations").index("appId")).toMatchObject({ keyPath: "appId", unique: false, multiEntry: false });
      expect(transaction.objectStore("account-app-outbox").index("operationId")).toMatchObject({ keyPath: "operationId", unique: true, multiEntry: false });
      expect(transaction.objectStore("hydration-coverage").index("by-workspace-as-of")).toMatchObject({ keyPath: ["workspaceId", "target.asOf", "targetId"], unique: true, multiEntry: false });
      expect(transaction.objectStore("hydration-coverage").index("by-member")).toMatchObject({ keyPath: "memberIds", unique: false, multiEntry: true });
      expect(transaction.objectStore("hydration-coverage").index("by-exact-node")).toMatchObject({ keyPath: "target.nodeIds", unique: false, multiEntry: true });
    } finally {
      raw.close();
      database?.close();
    }
    expect(durabilities.length).toBeGreaterThan(0);
    expect(durabilities.every((durability) => durability === "strict")).toBe(true);
  });

  test("persists exact device preferences and workspace window sessions", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    expect(await database.readDevicePreferences()).toEqual(DEFAULT_DEVICE_PREFERENCES);
    const emptySession = await database.readWindowSession(WORKSPACE);
    expect(emptySession).toEqual({ schemaVersion: 1, apps: [] });

    const preferences = { ...DEFAULT_DEVICE_PREFERENCES, autoUpdate: false, explorerView: "grid" as const, showHiddenFiles: true, onboardingVersion: 2 };
    const session = { schemaVersion: 1 as const, apps: [{ kind: "settings" as const, bounds: { x: 10, y: 20, width: 500, height: 400 }, minimized: false, zIndex: 1 }] };
    emptySession.apps.push(session.apps[0]!);
    expect(await database.readWindowSession(DESTINATION)).toEqual({ schemaVersion: 1, apps: [] });
    await database.writeDevicePreferences(preferences);
    await database.writeWindowSession(WORKSPACE, session);
    await expect(database.writeWindowSession(stableId(99), session)).rejects.toThrow("does not exist");
    database.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect(await reopened.readDevicePreferences()).toEqual(preferences);
    expect(await reopened.readWindowSession(WORKSPACE)).toEqual(session);
    await reopened.deleteWorkspace(WORKSPACE);
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "window-sessions", WORKSPACE)).toBeUndefined();
    reopened.close();
  });

  test("rejects malformed fresh local-only records", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    database.close();
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(raw.transaction("device-preferences", "readwrite").objectStore("device-preferences").put({ id: "singleton", schemaVersion: 1, preferences: { ...DEFAULT_DEVICE_PREFERENCES, extra: true } }));
    await idbRequest(raw.transaction("device-preferences", "readwrite").objectStore("device-preferences").put({ id: "device", schemaVersion: 1, deviceId: "invalid" }));
    await idbRequest(raw.transaction("window-sessions", "readwrite").objectStore("window-sessions").put({ workspaceId: WORKSPACE, session: { schemaVersion: 1, apps: "invalid" } }));
    raw.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    await expect(reopened.readDevicePreferences()).rejects.toThrow("unsupported format");
    await expect(reopened.getOrCreateDeviceId()).rejects.toThrow("invalid");
    await expect(reopened.readWindowSession(WORKSPACE)).rejects.toThrow("unsupported format");
    reopened.close();
  });

  test("persists local app approvals, data, and associations with atomic uninstall cleanup", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const install = installedApp();
    const association = { matcher: ".txt", appId: install.appId, createdAt: 20 };
    expect(await database.listInstalledApps()).toEqual([]);
    await expect(database.setFileAssociation(association)).rejects.toThrow("not installed");
    expect(await database.installApp(install)).toEqual(install);
    const key = "theme-🌙";
    const value = { mode: "düsk" };
    const bytes = new TextEncoder().encode(JSON.stringify(key)).byteLength + new TextEncoder().encode(JSON.stringify(value)).byteLength;
    await database.writeAppStorage(install.appId, key, value, bytes, 1);
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "app-storage", [install.appId, key])).toEqual({ appId: install.appId, key, value, bytes });
    const replacementBytes = new TextEncoder().encode(JSON.stringify(key)).byteLength + new TextEncoder().encode(JSON.stringify(false)).byteLength;
    await database.writeAppStorage(install.appId, key, false, replacementBytes, 1);
    await expect(database.writeAppStorage(install.appId, key, "too large", replacementBytes, 1)).rejects.toThrow("quota");
    expect(await database.readAppStorage(install.appId, key)).toBe(false);
    await database.writeAppStorage(install.appId, "wrap", true, 64 * 1024, 2);
    await expect(database.writeAppStorage(install.appId, "third", null, 64 * 1024, 2)).rejects.toThrow("entry quota");
    await database.setFileAssociation(association);
    database.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect(await reopened.listInstalledApps()).toEqual([install]);
    expect(await reopened.readAppStorage(install.appId, key)).toBe(false);
    expect(await reopened.listFileAssociations()).toEqual([association]);
    await reopened.removeAppStorage(install.appId, "wrap");
    expect(await reopened.readAppStorage(install.appId, "wrap")).toBeUndefined();
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (candidate) {
      if (this.name === "file-associations" && candidate === association.matcher) throw new DOMException("Injected app cleanup failure", "AbortError");
      return originalDelete.call(this, candidate);
    };
    try {
      await expect(reopened.uninstallApp(install.appId)).rejects.toThrow("Injected app cleanup failure");
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }
    expect(await reopened.listInstalledApps()).toEqual([install]);
    expect(await reopened.readAppStorage(install.appId, key)).toBe(false);
    expect(await reopened.listFileAssociations()).toEqual([association]);
    await reopened.uninstallApp(install.appId);
    expect(await reopened.listInstalledApps()).toEqual([]);
    expect(await reopened.readAppStorage(install.appId, key)).toBeUndefined();
    expect(await reopened.listFileAssociations()).toEqual([]);
    reopened.close();

    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(raw.transaction("app-storage", "readwrite").objectStore("app-storage").put({ appId: install.appId, key: "corrupt", value: true, bytes: 1 }));
    raw.close();
    const malformed = await openFilesystemDatabase(ACCOUNT, environment(factory));
    await expect(malformed.readAppStorage(install.appId, "corrupt")).rejects.toThrow("inconsistent");
    malformed.close();
  });

  test("protects bundled system app identities", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const reserved = installedApp(SYSTEM_APP_IDS.textEditor);
    await expect(database.installApp(reserved)).rejects.toThrow("reserved");
    const system = { ...reserved, source: "system" as const, packageEntryId: null, archivePath: "system-apps/text-editor.hiraya.app" };
    await database.installApp(system);
    await database.uninstallApp(system.appId);
    expect(await database.listInstalledApps()).toEqual([system]);

    const extensionSystemBase = installedApp("test.system");
    const extensionSystem = { ...extensionSystemBase, source: "system" as const, packageEntryId: null, archivePath: "system-apps/terminal.hiraya.app" };
    await database.installApp(extensionSystem);
    await expect(database.installApp(extensionSystemBase)).rejects.toThrow("cannot be replaced");
    expect(await database.listInstalledApps()).toEqual([system, extensionSystem]);
    database.close();
  });

  test("initializes workspace and sync state atomically and reloads them unchanged", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const expected = { id: WORKSPACE, name: "Workspace", pinned: true, ordinal: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 0 };
    expect(await database.listWorkspaces()).toEqual([expected]);
    const name = await filesystemDatabaseName(ACCOUNT);
    expect(await readStored(factory, name, "sync", WORKSPACE)).toEqual({ workspaceId: WORKSPACE, deviceId: DEVICE, cursor: 0, lastHydrationAsOf: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 });
    database.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect(await reopened.listWorkspaces()).toEqual([expected]);
    reopened.close();
  });

  test("recovers validated device state and one operation by identity", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 90);
    const operationId = stableId(9);
    expect(await database.getSyncState(WORKSPACE)).toEqual({ workspaceId: WORKSPACE, deviceId: DEVICE, cursor: 0, lastHydrationAsOf: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 0 });
    expect(await database.getOperation(operationId)).toBeUndefined();
    const committed = await database.commitOperation({ operation: createDraft(operationId, [folder(stableId(8), "Lookup")]) });
    expect(await database.getOperation(operationId)).toEqual(committed);
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ workspaceId: WORKSPACE, deviceId: DEVICE, lastLocalLogicalTime: 90 });
    database.close();
  });

  test("publishes bootstrap directory, root, settings, and pending overlays atomically", async () => {
    const factory = new IDBFactory();
    const database = await openFilesystemDatabase(ACCOUNT, { ...environment(factory, () => 100), randomUUID: () => DEVICE });
    expect(await database.getOrCreateDeviceId()).toBe(DEVICE);
    await database.createWorkspace({ id: WORKSPACE, name: "Local main", pinned: true, deviceId: DEVICE });
    await database.createWorkspace({ id: DESTINATION, name: "Local only", pinned: true, deviceId: DEVICE });
    const localId = stableId(2_290);
    await database.commitOperation({ operation: createDraft(stableId(2_291), [folder(localId, "Local pending")]) });
    await database.commitOperation({ operation: { ...operationBase(stableId(2_292)), kind: "set", namespace: "editor", key: "font-size", value: 18 } });

    const remoteId = stableId(2_293);
    const remoteTuple = { logicalTime: 10, operationId: stableId(2_294) };
    const remote = { workspaceId: WORKSPACE, id: remoteId, kind: "folder" as const, name: "Remote", parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: remoteTuple, parent: remoteTuple, lifecycle: remoteTuple, position: remoteTuple, content: null } };
    const generationId = stableId(2_295);
    const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
    const targetId = hydrationTargetId(target);
    const bootstrap = {
      accountId: ACCOUNT,
      deviceId: DEVICE,
      cursor: 9,
      workspaces: [
        { id: WORKSPACE, name: "Main", pinned: true },
        { id: stableId(2_296), name: "Archive", pinned: false },
      ],
      workspace: { id: WORKSPACE, name: "Main", pinned: true, headSequence: 10, snapshotBarrier: 8, logFloor: 2 },
      rootPage: { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [remote], settings: [], nextPageToken: null },
      workspaceSettings: [{ workspaceId: WORKSPACE, namespace: "editor" as const, key: "font-size", deleted: false as const, value: 16, logicalTime: 10, operationId: stableId(2_297) }],
    };
    const changes = await database.publishHydration(WORKSPACE, targetId, generationId, bootstrap);

    expect((await database.listWorkspaces()).map(({ id, name, ordinal, headSequence }) => ({ id, name, ordinal, headSequence }))).toEqual([
      { id: WORKSPACE, name: "Main", ordinal: 0, headSequence: 10 },
      { id: DESTINATION, name: "Local only", ordinal: 1, headSequence: 0 },
      { id: stableId(2_296), name: "Archive", ordinal: 2, headSequence: 0 },
    ]);
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 9, lastHydrationAsOf: 10, lastObservedLogicalTime: 10 });
    expect((await database.listChildren(WORKSPACE, null)).map(({ id }) => id).sort()).toEqual([localId, remoteId].sort());
    expect(await database.getSetting(WORKSPACE, "editor", "font-size")).toMatchObject({ value: 18 });
    expect((await database.listOperations(WORKSPACE)).map(({ operationId }) => operationId).sort()).toEqual([stableId(2_291), stableId(2_292)].sort());
    expect(changes).toMatchObject([{ kind: "hydration", workspaceId: WORKSPACE, revision: 3, operationId: generationId, targetId }]);
    expect(changes[0]!.affectedIdentities).toContain(`setting:${WORKSPACE}:editor:font-size`);
    expect(await database.publishHydration(WORKSPACE, targetId, generationId, bootstrap)).toEqual(changes);
    database.close();
  });

  test("rolls back the complete bootstrap transaction when projection publication fails", async () => {
    const factory = new IDBFactory();
    const database = await openFilesystemDatabase(ACCOUNT, { ...environment(factory), randomUUID: () => DEVICE });
    await database.getOrCreateDeviceId();
    const generationId = stableId(2_280);
    const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
    const targetId = hydrationTargetId(target);
    const bootstrap = {
      accountId: ACCOUNT,
      deviceId: DEVICE,
      cursor: 9,
      workspaces: [{ id: WORKSPACE, name: "Main", pinned: true }],
      workspace: { id: WORKSPACE, name: "Main", pinned: true, headSequence: 10, snapshotBarrier: 8, logFloor: 2 },
      rootPage: { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [], settings: [], nextPageToken: null },
      workspaceSettings: [{ workspaceId: WORKSPACE, namespace: "editor" as const, key: "font-size", deleted: false as const, value: 16, logicalTime: 1, operationId: stableId(2_281) }],
    };
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "hydration-coverage") throw new DOMException("Injected bootstrap failure", "AbortError");
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    try {
      await expect(database.publishHydration(WORKSPACE, targetId, generationId, bootstrap)).rejects.toThrow("Injected bootstrap failure");
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    const name = await filesystemDatabaseName(ACCOUNT);
    expect(await database.listWorkspaces()).toEqual([]);
    for (const store of ["sync", "nodes", "settings", "changes", "hydration-pages", "hydration-coverage"]) expect(await readStored(factory, name, store)).toEqual([]);
    database.close();
  });

  test("applies authoritative operation pulls and settles matching pending overlays", async () => {
    const factory = new IDBFactory();
    const database = await openFilesystemDatabase(ACCOUNT, { ...environment(factory, () => 100), randomUUID: () => DEVICE });
    await database.getOrCreateDeviceId();
    const nodeId = stableId(2_270);
    const baseTuple = { logicalTime: 10, operationId: stableId(2_271) };
    const base = { workspaceId: WORKSPACE, id: nodeId, kind: "folder" as const, name: "Base", parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: baseTuple, parent: baseTuple, lifecycle: baseTuple, position: baseTuple, content: null } };
    const generationId = stableId(2_272);
    const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
    await database.publishHydration(WORKSPACE, hydrationTargetId(target), generationId, {
      accountId: ACCOUNT,
      deviceId: DEVICE,
      cursor: 10,
      workspaces: [{ id: WORKSPACE, name: "Main", pinned: true }],
      workspace: { id: WORKSPACE, name: "Main", pinned: true, headSequence: 10, snapshotBarrier: 8, logFloor: 2 },
      rootPage: { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [base], settings: [], nextPageToken: null },
      workspaceSettings: [],
    });
    const operationId = stableId(2_273);
    const rename = await database.commitOperation({ operation: { ...operationBase(operationId), kind: "rename", nodeId, name: "Client input", modifiedAt: 999 } });
    const transformed = { ...base, name: "Server transformed", modifiedAt: 2, fieldTuples: { ...base.fieldTuples, name: { logicalTime: rename.operation.logicalTime, operationId } } };
    const pull = { workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 10, cursor: 11, headSequence: 11, snapshotBarrier: 8, logFloor: 2, observedLogicalTime: rename.operation.logicalTime, operations: [{ sequence: 11, operationId, companion: null, nodes: [transformed], settings: [] }] };
    const changes = await database.applyPullOperations(pull);

    expect(await database.getNode(nodeId)).toMatchObject({ name: "Server transformed", modifiedAt: 2, fieldTuples: { name: { operationId } } });
    expect(await database.getOperation(operationId)).toMatchObject({ stateKind: "accepted" });
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 11, lastObservedLogicalTime: rename.operation.logicalTime });
    expect(await database.queryFolderChildren(WORKSPACE, null)).toEqual({ availability: "unavailable" });
    expect(changes).toMatchObject([{ kind: "pull", workspaceId: WORKSPACE, revision: 3, operationId, fromCursor: 10, cursor: 11 }]);
    expect(await database.listChanges(WORKSPACE, 2)).toEqual(changes);
    expect(await database.applyPullOperations(pull)).toEqual(changes);
    database.close();
  });

  test("advances consecutive cross-workspace pull companions atomically", async () => {
    const factory = new IDBFactory();
    const database = await openFilesystemDatabase(ACCOUNT, { ...environment(factory), randomUUID: () => DEVICE });
    await database.getOrCreateDeviceId();
    const generationId = stableId(2_260);
    const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
    await database.publishHydration(WORKSPACE, hydrationTargetId(target), generationId, {
      accountId: ACCOUNT,
      deviceId: DEVICE,
      cursor: 10,
      workspaces: [{ id: WORKSPACE, name: "Source", pinned: true }, { id: DESTINATION, name: "Destination", pinned: false }],
      workspace: { id: WORKSPACE, name: "Source", pinned: true, headSequence: 10, snapshotBarrier: 8, logFloor: 2 },
      rootPage: { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [], settings: [], nextPageToken: null },
      workspaceSettings: [],
    });
    const transferred = (id: string, operationId: string, logicalTime: number) => {
      const tuple = { logicalTime, operationId };
      return { workspaceId: DESTINATION, id, kind: "folder" as const, name: id, parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    };
    const firstOperationId = stableId(2_261);
    const secondOperationId = stableId(2_262);
    const changes = await database.applyPullOperations({
      workspaceId: WORKSPACE,
      deviceId: DEVICE,
      fromCursor: 10,
      cursor: 12,
      headSequence: 12,
      snapshotBarrier: 8,
      logFloor: 2,
      observedLogicalTime: 12,
      operations: [
        { sequence: 11, operationId: firstOperationId, companion: { workspaceId: DESTINATION, sequence: 1 }, nodes: [transferred(stableId(2_263), firstOperationId, 11)], settings: [] },
        { sequence: 12, operationId: secondOperationId, companion: { workspaceId: DESTINATION, sequence: 2 }, nodes: [transferred(stableId(2_264), secondOperationId, 12)], settings: [] },
      ],
    });
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 12 });
    expect(await database.getSyncState(DESTINATION)).toMatchObject({ cursor: 2 });
    expect((await database.listChildren(DESTINATION, null)).map(({ id }) => id).sort()).toEqual([stableId(2_263), stableId(2_264)].sort());
    expect(changes.map(({ workspaceId }) => workspaceId).sort()).toEqual([WORKSPACE, DESTINATION].sort());
    database.close();
  });

  test("rolls back authoritative records, settlement, coverage, cursor, and revision when pull publication fails", async () => {
    const factory = new IDBFactory();
    const database = await openFilesystemDatabase(ACCOUNT, { ...environment(factory, () => 100), randomUUID: () => DEVICE });
    await database.getOrCreateDeviceId();
    const generationId = stableId(2_250);
    const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
    const targetId = hydrationTargetId(target);
    await database.publishHydration(WORKSPACE, targetId, generationId, {
      accountId: ACCOUNT,
      deviceId: DEVICE,
      cursor: 10,
      workspaces: [{ id: WORKSPACE, name: "Main", pinned: true }],
      workspace: { id: WORKSPACE, name: "Main", pinned: true, headSequence: 10, snapshotBarrier: 8, logFloor: 2 },
      rootPage: { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [], settings: [], nextPageToken: null },
      workspaceSettings: [],
    });
    const operationId = stableId(2_251);
    const pending = await database.commitOperation({ operation: { ...operationBase(operationId), kind: "set", namespace: "editor", key: "font-size", value: 18 } });
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "workspaces" && (value as { headSequence?: number }).headSequence === 11) throw new DOMException("Injected pull failure", "AbortError");
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    try {
      await expect(database.applyPullOperations({ workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 10, cursor: 11, headSequence: 11, snapshotBarrier: 8, logFloor: 2, observedLogicalTime: pending.operation.logicalTime, operations: [{ sequence: 11, operationId, companion: null, nodes: [], settings: [{ workspaceId: WORKSPACE, namespace: "editor", key: "font-size", deleted: false, value: 20, logicalTime: pending.operation.logicalTime, operationId }] }] })).rejects.toThrow();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    expect(await database.getSetting(WORKSPACE, "editor", "font-size")).toMatchObject({ value: 18 });
    expect(await database.getOperation(operationId)).toMatchObject({ stateKind: "pending" });
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 10 });
    expect((await database.listWorkspaces())[0]).toMatchObject({ localRevision: 2 });
    expect(await database.getHydrationCoverage(WORKSPACE, targetId)).toBeDefined();
    database.close();
  });

  test("publishes a durable multi-selector reset with pending overlays in one transaction", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    const nodeId = stableId(2_520);
    const baseTuple = { logicalTime: 0, operationId: stableId(2_521) };
    const base = { workspaceId: WORKSPACE, id: nodeId, kind: "folder" as const, name: "Base", parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: baseTuple, parent: baseTuple, lifecycle: baseTuple, position: baseTuple, content: null } };
    const staleTarget = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 0, parentId: null, limit: 1 };
    const staleTargetId = hydrationTargetId(staleTarget);
    const staleGeneration = stableId(2_522);
    await database.beginHydration(staleTargetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: staleGeneration, target: staleTarget });
    await database.stageHydrationPage(staleTargetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: staleGeneration, pageIndex: 0, observedLogicalTime: 0, target: staleTarget, nodes: [base], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, staleTargetId, staleGeneration);
    const renameId = stableId(2_523);
    await database.commitOperation({ operation: { ...operationBase(renameId), kind: "rename", nodeId, name: "Local rename", modifiedAt: 2 } });
    const settingId = stableId(2_524);
    await database.commitOperation({ operation: { ...operationBase(settingId), kind: "set", namespace: "editor", key: "font-size", value: 18 } });
    const reset = { workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 0, cursor: 8, headSequence: 10, snapshotBarrier: 8, logFloor: 1, observedLogicalTime: 50, resetBarrier: 8 };
    let nextId = 2_525;
    const prepared = await database.prepareReset(reset, () => stableId(nextId++));
    expect(prepared.kind).toBe("plan");
    if (prepared.kind !== "plan") throw new Error("Reset plan was not staged.");
    expect(prepared.plan.generations.map(({ target }) => target.kind).sort()).toEqual(["exact-nodes", "exact-settings", "folder-page"]);
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 101 });
    for (const generation of prepared.plan.generations) {
      const targetId = hydrationTargetId(generation.target);
      await database.stageHydrationPage(targetId, null, { ...generation, pageIndex: 0, observedLogicalTime: 50, nodes: generation.target.kind === "exact-settings" ? [] : [base], settings: [], nextPageToken: null });
    }

    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "workspaces" && (value as { headSequence?: number }).headSequence === 10) throw new DOMException("Injected reset failure", "AbortError");
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    try {
      await expect(database.publishReset(prepared.plan.resetId, () => stableId(nextId++))).rejects.toThrow("Injected reset failure");
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 0 });
    expect(await database.getNode(nodeId)).toMatchObject({ name: "Local rename" });
    expect(await database.getOperation(renameId)).toMatchObject({ stateKind: "pending", overlayKind: "active" });
    expect(await database.getHydrationCoverage(WORKSPACE, staleTargetId)).toMatchObject({ generationId: staleGeneration, target: staleTarget });
    expect((await database.listWorkspaces())[0]).toMatchObject({ headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 3 });
    expect((await readStored(factory, await filesystemDatabaseName(ACCOUNT), "hydration-pages") as Array<{ kind: string }>).some(({ kind }) => kind === "reset")).toBe(true);

    const published = await database.publishReset(prepared.plan.resetId, () => stableId(nextId++));
    expect(published.kind).toBe("published");
    if (published.kind !== "published") throw new Error("Reset did not publish.");
    expect(published.changes).toMatchObject([{ kind: "reset", workspaceId: WORKSPACE, revision: 4, fromCursor: 0, cursor: 8, headSequence: 10, snapshotBarrier: 8, logFloor: 1 }]);
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 8, lastHydrationAsOf: 8, lastObservedLogicalTime: 50, lastLocalLogicalTime: 101 });
    expect((await database.listWorkspaces())[0]).toMatchObject({ headSequence: 10, snapshotBarrier: 8, logFloor: 1, localRevision: 4 });
    expect(await database.getNode(nodeId)).toMatchObject({ name: "Local rename" });
    expect(await database.getOperation(renameId)).toMatchObject({ stateKind: "pending", overlayKind: "active" });
    expect(await database.getOperation(settingId)).toMatchObject({ stateKind: "pending", overlayKind: "active" });
    expect(await database.getSetting(WORKSPACE, "editor", "font-size")).toMatchObject({ value: 18 });
    expect(await database.listChanges(WORKSPACE, 3)).toEqual(published.changes);
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "hydration-pages")).toEqual([]);
    expect(await database.publishReset(prepared.plan.resetId, () => stableId(nextId++))).toEqual(published);
    expect(await database.prepareReset(reset, () => stableId(nextId++))).toEqual(published);
    await expect(database.prepareReset({ ...reset, observedLogicalTime: 51 }, () => stableId(nextId++))).rejects.toThrow("different input");
    await expect(database.prepareReset({ ...reset, cursor: 7, snapshotBarrier: 7, resetBarrier: 7 }, () => stableId(nextId++))).rejects.toThrow("local cursor");
    await expect(database.prepareReset({ ...reset, fromCursor: 7, cursor: 9, snapshotBarrier: 9, logFloor: 8, resetBarrier: 9 }, () => stableId(nextId++))).rejects.toThrow("local cursor");
    database.close();
  });

  test("retains incoming transfer overlays and workspace-qualified settings through reset", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const destinationSettingId = stableId(2_559);
    const destinationSetting = await database.commitOperation({ operation: { ...operationBase(destinationSettingId), workspaceId: DESTINATION, kind: "set", namespace: "editor", key: "font-size", value: 20 } });
    await database.applyPullOperations({ workspaceId: DESTINATION, deviceId: DEVICE, fromCursor: 0, cursor: 1, headSequence: 1, snapshotBarrier: 0, logFloor: 0, observedLogicalTime: destinationSetting.operation.logicalTime, operations: [{ sequence: 1, operationId: destinationSettingId, companion: null, nodes: [], settings: [{ workspaceId: DESTINATION, namespace: "editor", key: "font-size", deleted: false, value: 20, logicalTime: destinationSetting.operation.logicalTime, operationId: destinationSettingId }] }] });
    const destinationParentId = stableId(2_560);
    await database.commitOperation({ operation: createDraft(stableId(2_561), [folder(destinationParentId, "Inbox")], DESTINATION) });
    const staleTarget = { kind: "folder-page" as const, workspaceId: DESTINATION, asOf: 1, parentId: destinationParentId, limit: 100 };
    const staleGenerationId = stableId(2_562);
    await database.beginHydration(hydrationTargetId(staleTarget), { workspaceId: DESTINATION, deviceId: DEVICE, generationId: staleGenerationId, target: staleTarget });
    await database.stageHydrationPage(hydrationTargetId(staleTarget), null, { workspaceId: DESTINATION, deviceId: DEVICE, generationId: staleGenerationId, pageIndex: 0, observedLogicalTime: 1, target: staleTarget, nodes: [], settings: [], nextPageToken: null });
    await database.publishHydration(DESTINATION, hydrationTargetId(staleTarget), staleGenerationId);

    const transferredNodeId = stableId(2_563);
    await database.commitOperation({ operation: createDraft(stableId(2_564), [folder(transferredNodeId, "Transfer")]) });
    const transferId = stableId(2_565);
    await database.commitOperation({ operation: transferDraft(transferId, [transferredNodeId], DESTINATION, destinationParentId) });
    await database.commitOperation({ operation: { ...operationBase(stableId(2_566)), kind: "set", namespace: "editor", key: "font-size", value: 18 } });

    const reset = { workspaceId: DESTINATION, deviceId: DEVICE, fromCursor: 1, cursor: 200, headSequence: 200, snapshotBarrier: 200, logFloor: 2, observedLogicalTime: 200, resetBarrier: 200 };
    let nextId = 2_568;
    const prepared = await database.prepareReset(reset, () => stableId(nextId++));
    expect(prepared.kind).toBe("plan");
    if (prepared.kind !== "plan") throw new Error("Reset plan was not staged.");
    expect(prepared.plan.generations.some(({ target }) => target.kind === "exact-settings" && target.namespace === "editor" && target.keys.includes("font-size"))).toBe(true);
    expect(prepared.plan.generations.some(({ target }) => target.kind === "exact-nodes" && target.nodeIds.includes(transferredNodeId))).toBe(false);
    for (const generation of prepared.plan.generations) {
      const settings = generation.target.kind === "exact-settings" ? [{ workspaceId: DESTINATION, namespace: "editor" as const, key: "font-size", deleted: false as const, value: 20, logicalTime: destinationSetting.operation.logicalTime, operationId: destinationSettingId }] : [];
      await database.stageHydrationPage(hydrationTargetId(generation.target), null, { ...generation, pageIndex: 0, observedLogicalTime: 200, nodes: [], settings, nextPageToken: null });
    }
    const published = await database.publishReset(prepared.plan.resetId, () => stableId(nextId++));
    expect(published.kind).toBe("published");
    expect(await database.getNode(transferredNodeId)).toMatchObject({ workspaceId: DESTINATION, parentId: destinationParentId });
    expect(await database.getOperation(transferId)).toMatchObject({ stateKind: "pending", overlayKind: "active" });
    expect(await database.getSetting(DESTINATION, "editor", "font-size")).toMatchObject({ value: 20 });
    database.close();
  });

  test("rejects reset publication when an incoming transfer destination was deleted", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 10);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const destinationParentId = stableId(2_580);
    const destinationCreateId = stableId(2_581);
    const destinationCreate = await database.commitOperation({ operation: createDraft(destinationCreateId, [folder(destinationParentId, "Inbox")], DESTINATION) });
    const destinationParent = await database.getNode(destinationParentId);
    await database.applyPullOperations({ workspaceId: DESTINATION, deviceId: DEVICE, fromCursor: 0, cursor: 1, headSequence: 1, snapshotBarrier: 0, logFloor: 0, observedLogicalTime: destinationCreate.operation.logicalTime, operations: [{ sequence: 1, operationId: destinationCreateId, companion: null, nodes: [destinationParent!], settings: [] }] });
    const sourceNodeId = stableId(2_582);
    const sourceCreateId = stableId(2_583);
    const sourceCreate = await database.commitOperation({ operation: createDraft(sourceCreateId, [folder(sourceNodeId, "Transfer")]) });
    const sourceNode = await database.getNode(sourceNodeId);
    await database.applyPullOperations({ workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 0, cursor: 1, headSequence: 1, snapshotBarrier: 0, logFloor: 0, observedLogicalTime: sourceCreate.operation.logicalTime, operations: [{ sequence: 1, operationId: sourceCreateId, companion: null, nodes: [sourceNode!], settings: [] }] });
    const staleTarget = { kind: "folder-page" as const, workspaceId: DESTINATION, asOf: 1, parentId: destinationParentId, limit: 100 };
    const staleGenerationId = stableId(2_584);
    await database.beginHydration(hydrationTargetId(staleTarget), { workspaceId: DESTINATION, deviceId: DEVICE, generationId: staleGenerationId, target: staleTarget });
    await database.stageHydrationPage(hydrationTargetId(staleTarget), null, { workspaceId: DESTINATION, deviceId: DEVICE, generationId: staleGenerationId, pageIndex: 0, observedLogicalTime: 20, target: staleTarget, nodes: [], settings: [], nextPageToken: null });
    await database.publishHydration(DESTINATION, hydrationTargetId(staleTarget), staleGenerationId);
    const transferId = stableId(2_585);
    await database.commitOperation({ operation: transferDraft(transferId, [sourceNodeId], DESTINATION, destinationParentId) });

    const reset = { workspaceId: DESTINATION, deviceId: DEVICE, fromCursor: 1, cursor: 30, headSequence: 30, snapshotBarrier: 30, logFloor: 2, observedLogicalTime: 30, resetBarrier: 30 };
    let nextId = 2_586;
    const prepared = await database.prepareReset(reset, () => stableId(nextId++));
    expect(prepared.kind).toBe("plan");
    if (prepared.kind !== "plan") throw new Error("Reset plan was not staged.");
    for (const generation of prepared.plan.generations) await database.stageHydrationPage(hydrationTargetId(generation.target), null, { ...generation, pageIndex: 0, observedLogicalTime: 30, nodes: [], settings: [], nextPageToken: null });
    await expect(database.publishReset(prepared.plan.resetId, () => stableId(nextId++))).rejects.toThrow("pending transfer destination");
    expect(await database.getSyncState(DESTINATION)).toMatchObject({ cursor: 1 });
    expect(await database.getNode(sourceNodeId)).toMatchObject({ workspaceId: DESTINATION, parentId: destinationParentId });
    expect(await database.getOperation(transferId)).toMatchObject({ stateKind: "pending", overlayKind: "active" });
    database.close();
  });

  test("rejects reset publication when a pending move destination was deleted", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 10);
    const oldParentId = stableId(2_600);
    const newParentId = stableId(2_601);
    const childId = stableId(2_602);
    const createId = stableId(2_603);
    const created = await database.commitOperation({ operation: createDraft(createId, [folder(oldParentId, "Old"), folder(newParentId, "New"), folder(childId, "Child", oldParentId)]) });
    const baseNodes = (await Promise.all([oldParentId, newParentId, childId].map((id) => database.getNode(id)))) as NodeRecord[];
    await database.applyPullOperations({ workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 0, cursor: 1, headSequence: 1, snapshotBarrier: 0, logFloor: 0, observedLogicalTime: created.operation.logicalTime, operations: [{ sequence: 1, operationId: createId, companion: null, nodes: baseNodes, settings: [] }] });
    const moveId = stableId(2_604);
    await database.commitOperation({ operation: { ...operationBase(moveId), kind: "move", nodeIds: [childId], parentId: newParentId, modifiedAt: 20 } });

    const reset = { workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 1, cursor: 30, headSequence: 30, snapshotBarrier: 30, logFloor: 2, observedLogicalTime: 30, resetBarrier: 30 };
    let nextId = 2_605;
    const prepared = await database.prepareReset(reset, () => stableId(nextId++));
    expect(prepared.kind).toBe("plan");
    if (prepared.kind !== "plan") throw new Error("Reset plan was not staged.");
    for (const generation of prepared.plan.generations) {
      const nodes = generation.target.kind === "exact-nodes" ? baseNodes.filter(({ id }) => id !== newParentId && generation.target.nodeIds.includes(id)) : [];
      await database.stageHydrationPage(hydrationTargetId(generation.target), null, { ...generation, pageIndex: 0, observedLogicalTime: 30, nodes, settings: [], nextPageToken: null });
    }
    await expect(database.publishReset(prepared.plan.resetId, () => stableId(nextId++))).rejects.toThrow("invalid hierarchy");
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 1 });
    expect(await database.getNode(childId)).toMatchObject({ parentId: newParentId });
    expect(await database.getOperation(moveId)).toMatchObject({ stateKind: "pending", overlayKind: "active" });
    database.close();
  });

  test("rejects pending overlays beneath purge tombstones during ancestry reset", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 10);
    const oldParentId = stableId(2_620);
    const newParentId = stableId(2_621);
    const childId = stableId(2_622);
    const createId = stableId(2_623);
    const created = await database.commitOperation({ operation: createDraft(createId, [folder(oldParentId, "Old"), folder(newParentId, "New"), folder(childId, "Child", oldParentId)]) });
    const baseNodes = (await Promise.all([oldParentId, newParentId, childId].map((id) => database.getNode(id)))) as NodeRecord[];
    await database.applyPullOperations({ workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 0, cursor: 1, headSequence: 1, snapshotBarrier: 0, logFloor: 0, observedLogicalTime: created.operation.logicalTime, operations: [{ sequence: 1, operationId: createId, companion: null, nodes: baseNodes, settings: [] }] });
    const ancestryTarget = { kind: "ancestry" as const, workspaceId: WORKSPACE, asOf: 1, nodeId: oldParentId, maxDepth: 2 };
    const ancestryGenerationId = stableId(2_624);
    await database.beginHydration(hydrationTargetId(ancestryTarget), { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: ancestryGenerationId, target: ancestryTarget });
    await database.stageHydrationPage(hydrationTargetId(ancestryTarget), null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: ancestryGenerationId, pageIndex: 0, observedLogicalTime: 20, target: ancestryTarget, nodes: [baseNodes[0]!], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, hydrationTargetId(ancestryTarget), ancestryGenerationId);
    const moveId = stableId(2_625);
    await database.commitOperation({ operation: { ...operationBase(moveId), kind: "move", nodeIds: [childId], parentId: newParentId, modifiedAt: 20 } });

    const reset = { workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 1, cursor: 30, headSequence: 30, snapshotBarrier: 30, logFloor: 2, observedLogicalTime: 30, resetBarrier: 30 };
    let nextId = 2_626;
    const prepared = await database.prepareReset(reset, () => stableId(nextId++));
    expect(prepared.kind).toBe("plan");
    if (prepared.kind !== "plan") throw new Error("Reset plan was not staged.");
    const tombstone = { workspaceId: WORKSPACE, id: newParentId, purged: true as const, logicalTime: 30, operationId: stableId(2_630) };
    for (const generation of prepared.plan.generations) {
      const nodes = generation.target.kind === "exact-nodes" ? [...baseNodes.filter(({ id }) => id !== newParentId && generation.target.nodeIds.includes(id)), ...(generation.target.nodeIds.includes(newParentId) ? [tombstone] : [])].sort((left, right) => left.id.localeCompare(right.id)) : generation.target.kind === "ancestry" ? [baseNodes[0]!] : [];
      await database.stageHydrationPage(hydrationTargetId(generation.target), null, { ...generation, pageIndex: 0, observedLogicalTime: 30, nodes, settings: [], nextPageToken: null });
    }
    await expect(database.publishReset(prepared.plan.resetId, () => stableId(nextId++))).rejects.toThrow("invalid hierarchy");
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ cursor: 1 });
    expect(await database.getNode(childId)).toMatchObject({ parentId: newParentId });
    database.close();
  });

  test("fences ordinary publication and rejects stale or gapped reset responses", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const ordinaryTarget = { kind: "exact-nodes" as const, workspaceId: DESTINATION, asOf: 8, nodeIds: [stableId(2_540)] };
    const ordinaryTargetId = hydrationTargetId(ordinaryTarget);
    const ordinaryGeneration = stableId(2_541);
    await database.beginHydration(ordinaryTargetId, { workspaceId: DESTINATION, deviceId: DEVICE, generationId: ordinaryGeneration, target: ordinaryTarget });
    await database.stageHydrationPage(ordinaryTargetId, null, { workspaceId: DESTINATION, deviceId: DEVICE, generationId: ordinaryGeneration, pageIndex: 0, observedLogicalTime: 8, target: ordinaryTarget, nodes: [], settings: [], nextPageToken: null });
    const reset = { workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 0, cursor: 8, headSequence: 10, snapshotBarrier: 8, logFloor: 1, observedLogicalTime: 8, resetBarrier: 8 };
    let nextId = 2_542;
    const prepared = await database.prepareReset(reset, () => stableId(nextId++));
    expect(prepared.kind).toBe("plan");
    await expect(database.beginHydration(hydrationTargetId({ ...ordinaryTarget, workspaceId: WORKSPACE }), { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: stableId(2_550), target: { ...ordinaryTarget, workspaceId: WORKSPACE } })).rejects.toThrow("fenced");
    await expect(database.publishHydration(DESTINATION, ordinaryTargetId, ordinaryGeneration)).rejects.toThrow("fenced");
    await expect(database.applyPullOperations({ workspaceId: WORKSPACE, deviceId: DEVICE, fromCursor: 0, cursor: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, observedLogicalTime: 0, operations: [] })).rejects.toThrow("fenced");
    await expect(database.prepareReset({ ...reset, fromCursor: 1, logFloor: 2 }, () => stableId(nextId++))).rejects.toThrow("local cursor");
    await expect(database.prepareReset({ ...reset, cursor: 9, snapshotBarrier: 9, resetBarrier: 9 }, () => stableId(nextId++))).rejects.toThrow("different cursor reset");
    expect(await database.getHydrationProgress(DESTINATION, ordinaryTargetId, ordinaryGeneration)).toMatchObject({ complete: true });
    database.close();
  });

  test("stages only the active hydration generation and advances observed clocks", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
    const targetId = await hydrationTargetId(target);
    const firstGeneration = stableId(2_300);
    const secondGeneration = stableId(2_301);
    const remoteNodeId = stableId(2_302);
    const remoteOperationId = stableId(2_303);
    const tuple = { logicalTime: 500, operationId: remoteOperationId };
    const remoteNode = { workspaceId: WORKSPACE, id: remoteNodeId, kind: "folder" as const, name: "Remote", parentId: null, lifecycle: { kind: "active" as const }, position: { x: 1, y: 2 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, target });
    expect(await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, pageIndex: 0, observedLogicalTime: 500, target, nodes: [], settings: [], nextPageToken: "next" })).toBe(false);
    expect(await database.getHydrationProgress(WORKSPACE, targetId, firstGeneration)).toEqual({ nextPageIndex: 1, pageToken: "next", complete: false });
    const local = await database.commitOperation({ operation: createDraft(stableId(2_304), [folder(stableId(2_305), "Local")]) });
    expect(local.operation.logicalTime).toBe(501);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, target });
    expect(await database.stageHydrationPage(targetId, "next", { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, pageIndex: 1, observedLogicalTime: 700, target, nodes: [remoteNode], settings: [], nextPageToken: null })).toBe(false);
    expect((await database.getSyncState(WORKSPACE)).lastObservedLogicalTime).toBe(500);
    await expect(database.stageHydrationPage(targetId, "unexpected", { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, pageIndex: 1, observedLogicalTime: 600, target, nodes: [], settings: [], nextPageToken: null })).rejects.toThrow("out of sequence");
    const finalPage = { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, pageIndex: 0, observedLogicalTime: 600, target, nodes: [remoteNode], settings: [], nextPageToken: null };
    expect(await database.stageHydrationPage(targetId, null, finalPage)).toBe(true);
    expect(await database.stageHydrationPage(targetId, null, finalPage)).toBe(true);
    expect(await database.getNode(remoteNodeId)).toBeUndefined();
    const staged = await readStored(factory, await filesystemDatabaseName(ACCOUNT), "hydration-pages") as Array<{ generationId?: string; page?: { generationId: string } }>;
    expect(staged).toHaveLength(2);
    expect(staged.every((record) => (record.generationId ?? record.page?.generationId) === secondGeneration)).toBe(true);
    database.close();
    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    await reopened.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, target });
    expect(await reopened.getHydrationProgress(WORKSPACE, targetId, secondGeneration)).toEqual({ nextPageIndex: 1, pageToken: null, complete: true });
    expect(await reopened.stageHydrationPage(targetId, null, finalPage)).toBe(true);
    reopened.close();
  });

  test("rejects forged hydration target IDs and cross-page disorder", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
    const targetId = await hydrationTargetId(target);
    const generationId = stableId(2_320);
    await expect(database.beginHydration("f".repeat(64), { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, target })).rejects.toThrow("does not match");
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, target });
    const tuple = { logicalTime: 10, operationId: stableId(2_321) };
    const node = (id: string) => ({ workspaceId: WORKSPACE, id, kind: "folder" as const, name: id, parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [node(stableId(2_323))], settings: [], nextPageToken: "next" });
    await expect(database.stageHydrationPage(targetId, "next", { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 1, observedLogicalTime: 10, target, nodes: [node(stableId(2_322))], settings: [], nextPageToken: null })).rejects.toThrow("not ordered");
    database.close();
  });

  test("rejects hydration token cycles and corrupted predecessor pages at completion", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const target = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 10, parentId: null, limit: 100 };
    const targetId = hydrationTargetId(target);
    const cycleGeneration = stableId(2_330);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: cycleGeneration, target });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: cycleGeneration, pageIndex: 0, observedLogicalTime: 0, target, nodes: [], settings: [], nextPageToken: "a" });
    await database.stageHydrationPage(targetId, "a", { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: cycleGeneration, pageIndex: 1, observedLogicalTime: 0, target, nodes: [], settings: [], nextPageToken: "b" });
    await database.stageHydrationPage(targetId, "b", { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: cycleGeneration, pageIndex: 2, observedLogicalTime: 0, target, nodes: [], settings: [], nextPageToken: "a" });
    await expect(database.stageHydrationPage(targetId, "a", { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: cycleGeneration, pageIndex: 3, observedLogicalTime: 0, target, nodes: [], settings: [], nextPageToken: null })).rejects.toThrow("token cycle");

    const corruptGeneration = stableId(2_331);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: corruptGeneration, target });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: corruptGeneration, pageIndex: 0, observedLogicalTime: 0, target, nodes: [], settings: [], nextPageToken: "next" });
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    const store = raw.transaction("hydration-pages", "readwrite").objectStore("hydration-pages");
    const stored = await idbRequest(store.get([WORKSPACE, targetId, 0])) as { page: { generationId: string } };
    await idbRequest(store.put({ ...stored, page: { ...stored.page, generationId: cycleGeneration } }));
    raw.close();
    await expect(database.stageHydrationPage(targetId, "next", { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: corruptGeneration, pageIndex: 1, observedLogicalTime: 0, target, nodes: [], settings: [], nextPageToken: null })).rejects.toThrow("metadata is inconsistent");

    const completedGeneration = stableId(2_332);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: completedGeneration, target });
    const completedPage = { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: completedGeneration, pageIndex: 0, observedLogicalTime: 0, target, nodes: [], settings: [], nextPageToken: null };
    await database.stageHydrationPage(targetId, null, completedPage);
    const completedRaw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(completedRaw.transaction("hydration-pages", "readwrite").objectStore("hydration-pages").delete([WORKSPACE, targetId, 0]));
    completedRaw.close();
    await expect(database.getHydrationProgress(WORKSPACE, targetId, completedGeneration)).rejects.toThrow("count is inconsistent");
    await expect(database.stageHydrationPage(targetId, null, completedPage)).rejects.toThrow();
    database.close();
  });

  test("publishes selector replacement while replaying pending local edits", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    const target = (asOf: number) => ({ kind: "folder-page" as const, workspaceId: WORKSPACE, asOf, parentId: null, limit: 100 });
    const targetId = hydrationTargetId(target(10));
    const remoteId = stableId(2_340);
    const omittedId = stableId(2_341);
    const localId = stableId(2_342);
    const pendingOmittedId = stableId(2_347);
    const remoteNode = (id: string, name: string, logicalTime: number) => {
      const tuple = { logicalTime, operationId: stableId(2_350 + logicalTime) };
      return { workspaceId: WORKSPACE, id, kind: "folder" as const, name, parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    };
    expect(await database.queryNode(WORKSPACE, remoteId)).toEqual({ availability: "unavailable" });
    expect(await database.queryFolderChildren(WORKSPACE, null)).toEqual({ availability: "unavailable" });
    const firstGeneration = stableId(2_343);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, target: target(10) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, pageIndex: 0, observedLogicalTime: 10, target: target(10), nodes: [remoteNode(remoteId, "Remote", 10), remoteNode(omittedId, "Omitted", 10), remoteNode(pendingOmittedId, "Pending", 10)], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, targetId, firstGeneration);
    await expect(database.commitOperation({ operation: createDraft(firstGeneration, [folder(stableId(2_398), "Collision")]) })).rejects.toThrow("hydration generation ID");

    await database.commitOperation({ operation: { ...operationBase(stableId(2_344)), kind: "rename", nodeId: remoteId, name: "Local rename", modifiedAt: 2 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(2_348)), kind: "rename", nodeId: pendingOmittedId, name: "Pending rename", modifiedAt: 2 } });
    await database.commitOperation({ operation: createDraft(stableId(2_345), [folder(localId, "Local")]) });
    const secondGeneration = stableId(2_346);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, target: target(20) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, pageIndex: 0, observedLogicalTime: 20, target: target(20), nodes: [remoteNode(remoteId, "Server base", 20)], settings: [], nextPageToken: null });
    const [change] = await database.publishHydration(WORKSPACE, targetId, secondGeneration);
    if (!change) throw new Error("Hydration did not publish a change.");

    expect(change).toMatchObject({ kind: "hydration", workspaceId: WORKSPACE, revision: 5, operationId: secondGeneration, targetId });
    expect(await database.getNode(remoteId)).toMatchObject({ name: "Local rename", lifecycle: { kind: "active" } });
    expect(await database.getNode(localId)).toMatchObject({ name: "Local" });
    expect(await database.getNode(pendingOmittedId)).toBeUndefined();
    expect(await database.getNode(omittedId)).toBeUndefined();
    expect(await database.getHydrationProgress(WORKSPACE, targetId, secondGeneration)).toBeUndefined();
    expect(await database.getHydrationCoverage(WORKSPACE, targetId)).toEqual({ workspaceId: WORKSPACE, targetId, generationId: secondGeneration, target: target(20), memberIds: [remoteId] });
    expect(await database.queryNode(WORKSPACE, remoteId)).toMatchObject({ availability: "available", value: { name: "Local rename" } });
    expect(await database.queryNode(WORKSPACE, localId)).toMatchObject({ availability: "available", value: { name: "Local" } });
    expect(await database.queryNode(WORKSPACE, omittedId)).toEqual({ availability: "unavailable" });
    expect(await database.queryNode(WORKSPACE, pendingOmittedId)).toEqual({ availability: "unavailable" });
    expect(await database.queryFolderChildren(WORKSPACE, null)).toMatchObject({ availability: "available", value: [{ id: remoteId }, { id: localId }] });
    expect(await database.listChanges(WORKSPACE, 4)).toEqual([change]);
    const staleGeneration = stableId(2_349);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: staleGeneration, target: target(15) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: staleGeneration, pageIndex: 0, observedLogicalTime: 20, target: target(15), nodes: [remoteNode(omittedId, "Stale", 10)], settings: [], nextPageToken: null });
    await expect(database.publishHydration(WORKSPACE, targetId, staleGeneration)).rejects.toThrow("older than");
    expect(await database.getNode(omittedId)).toBeUndefined();
    database.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect(await reopened.getHydrationCoverage(WORKSPACE, targetId)).toMatchObject({ generationId: secondGeneration, memberIds: [remoteId] });
    expect(await reopened.getNode(remoteId)).toMatchObject({ name: "Local rename" });
    reopened.close();
  });

  test("replays a pending subtree transfer over a remote source projection", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const rootId = stableId(2_360);
    const childId = stableId(2_361);
    const remote = (id: string, name: string, parentId: string | null, logicalTime = 10) => {
      const tuple = { logicalTime, operationId: stableId(2_352 + logicalTime) };
      return { workspaceId: WORKSPACE, id, kind: "folder" as const, name, parentId, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    };
    const exactTarget = { kind: "exact-nodes" as const, workspaceId: WORKSPACE, asOf: 10, nodeIds: [rootId, childId].sort() };
    const exactTargetId = hydrationTargetId(exactTarget);
    const initialGeneration = stableId(2_363);
    await database.beginHydration(exactTargetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: initialGeneration, target: exactTarget });
    await database.stageHydrationPage(exactTargetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: initialGeneration, pageIndex: 0, observedLogicalTime: 10, target: exactTarget, nodes: [remote(rootId, "Root", null), remote(childId, "Child", rootId)].sort((left, right) => left.id.localeCompare(right.id)), settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, exactTargetId, initialGeneration);
    await database.commitOperation({ operation: transferDraft(stableId(2_364), [rootId]) });
    await database.commitOperation({ operation: { schemaVersion: 1, kind: "rename", operationId: stableId(2_398), workspaceId: DESTINATION, deviceId: DEVICE, nodeId: rootId, name: "Destination rename", modifiedAt: 2 } });

    const folderTarget = { kind: "folder-page" as const, workspaceId: WORKSPACE, asOf: 20, parentId: null, limit: 100 };
    const folderTargetId = hydrationTargetId(folderTarget);
    const refreshGeneration = stableId(2_365);
    const refreshedRoot = remote(rootId, "Server renamed", null, 20);
    refreshedRoot.position = { x: 9, y: 9 };
    refreshedRoot.fieldTuples.position = { logicalTime: 200, operationId: stableId(2_399) };
    await database.beginHydration(folderTargetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: refreshGeneration, target: folderTarget });
    await database.stageHydrationPage(folderTargetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: refreshGeneration, pageIndex: 0, observedLogicalTime: 200, target: folderTarget, nodes: [refreshedRoot], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, folderTargetId, refreshGeneration);

    expect(await database.getNode(rootId)).toMatchObject({ workspaceId: DESTINATION, name: "Destination rename", parentId: null, position: { x: 9, y: 9 }, lifecycle: { kind: "active" } });
    expect(await database.getNode(childId)).toMatchObject({ workspaceId: DESTINATION, parentId: rootId, lifecycle: { kind: "active" } });
    expect(await database.listChildren(WORKSPACE, null)).toEqual([]);
    expect((await database.listChildren(DESTINATION, null)).map(({ id }) => id)).toEqual([rootId]);
    expect(await database.queryNode(WORKSPACE, rootId)).toEqual({ availability: "available", value: undefined });
    expect(await database.queryNode(DESTINATION, rootId)).toMatchObject({ availability: "available", value: { workspaceId: DESTINATION } });
    expect(await database.queryFolderChildren(WORKSPACE, null)).toEqual({ availability: "available", value: [] });
    expect(await database.queryFolderChildren(DESTINATION, null)).toEqual({ availability: "unavailable" });
    expect((await database.listWorkspaces()).find(({ id }) => id === DESTINATION)?.localRevision).toBe(3);
    expect(await database.listChanges(DESTINATION, 2)).toMatchObject([{ kind: "hydration", operationId: refreshGeneration, targetId: folderTargetId }]);
    expect(await database.getSyncState(DESTINATION)).toMatchObject({ lastHydrationAsOf: 0, lastObservedLogicalTime: 200 });
    const destinationEdit = await database.commitOperation({ operation: { schemaVersion: 1, kind: "rename", operationId: stableId(2_400), workspaceId: DESTINATION, deviceId: DEVICE, nodeId: childId, name: "Child renamed", modifiedAt: 2 } });
    expect(destinationEdit.operation.logicalTime).toBe(201);
    database.close();
  });

  test("preserves an authoritative same-tuple server transformation", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    const nodeId = stableId(2_401);
    const target = (asOf: number) => ({ kind: "exact-nodes" as const, workspaceId: WORKSPACE, asOf, nodeIds: [nodeId] });
    const targetId = hydrationTargetId(target(10));
    const baseTuple = { logicalTime: 10, operationId: stableId(2_402) };
    const base = { workspaceId: WORKSPACE, id: nodeId, kind: "folder" as const, name: "Base", parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: baseTuple, parent: baseTuple, lifecycle: baseTuple, position: baseTuple, content: null } };
    const firstGeneration = stableId(2_403);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, target: target(10) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, pageIndex: 0, observedLogicalTime: 10, target: target(10), nodes: [base], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, targetId, firstGeneration);
    const operationId = stableId(2_404);
    const rename = await database.commitOperation({ operation: { ...operationBase(operationId), kind: "rename", nodeId, name: "Client input", modifiedAt: 2 } });

    const transformed = { ...base, name: "Server transformed", fieldTuples: { ...base.fieldTuples, name: { logicalTime: rename.operation.logicalTime, operationId } } };
    const secondGeneration = stableId(2_405);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, target: target(20) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, pageIndex: 0, observedLogicalTime: rename.operation.logicalTime, target: target(20), nodes: [transformed], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, targetId, secondGeneration);
    expect(await database.getNode(nodeId)).toMatchObject({ name: "Server transformed", fieldTuples: { name: { logicalTime: rename.operation.logicalTime, operationId } } });
    database.close();
  });

  test("defers a pending Trash forest without resurrecting exact-negative nodes", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    const rootId = stableId(2_373);
    const childId = stableId(2_374);
    const target = (asOf: number) => ({ kind: "exact-nodes" as const, workspaceId: WORKSPACE, asOf, nodeIds: [rootId, childId].sort() });
    const targetId = hydrationTargetId(target(10));
    const tuple = { logicalTime: 10, operationId: stableId(2_375) };
    const remote = (id: string, name: string, parentId: string | null) => ({ workspaceId: WORKSPACE, id, kind: "folder" as const, name, parentId, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } });
    const firstGeneration = stableId(2_376);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, target: target(10) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, pageIndex: 0, observedLogicalTime: 10, target: target(10), nodes: [remote(rootId, "Root", null), remote(childId, "Child", rootId)].sort((left, right) => left.id.localeCompare(right.id)), settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, targetId, firstGeneration);
    const trashOperationId = stableId(2_377);
    await database.commitOperation({ operation: { ...operationBase(trashOperationId), kind: "trash", nodeIds: [rootId], trashedAt: 20 } });

    const secondGeneration = stableId(2_378);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, target: target(20) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, pageIndex: 0, observedLogicalTime: 20, target: target(20), nodes: [], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, targetId, secondGeneration);
    expect(await database.getNode(rootId)).toBeUndefined();
    expect(await database.getNode(childId)).toBeUndefined();
    expect(await database.listTrash(WORKSPACE)).toEqual([]);
    expect(await database.getOperation(trashOperationId)).toMatchObject({ overlayKind: "deferred" });
    const conflictTarget = { kind: "exact-nodes" as const, workspaceId: WORKSPACE, asOf: 30, nodeIds: [rootId] };
    const conflictTargetId = hydrationTargetId(conflictTarget);
    const conflictGeneration = stableId(2_379);
    const conflictRoot = remote(rootId, "Root", null);
    conflictRoot.fieldTuples.lifecycle = { logicalTime: 200, operationId: stableId(2_380) };
    await database.beginHydration(conflictTargetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: conflictGeneration, target: conflictTarget });
    await database.stageHydrationPage(conflictTargetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: conflictGeneration, pageIndex: 0, observedLogicalTime: 200, target: conflictTarget, nodes: [conflictRoot], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, conflictTargetId, conflictGeneration);
    expect(await database.getNode(rootId)).toMatchObject({ lifecycle: { kind: "active" }, fieldTuples: { lifecycle: { logicalTime: 200 } } });
    expect(await database.getNode(childId)).toBeUndefined();
    database.close();
  });

  test("records exact-setting negative coverage and removes the stale projection", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const key = "font-size";
    const target = (asOf: number) => ({ kind: "exact-settings" as const, workspaceId: WORKSPACE, asOf, namespace: "editor" as const, keys: [key] });
    const targetId = hydrationTargetId(target(10));
    expect(await database.querySetting(WORKSPACE, "editor", key)).toEqual({ availability: "unavailable" });
    expect(await database.querySettingNamespace(WORKSPACE, "editor")).toEqual({ availability: "unavailable" });
    const firstGeneration = stableId(2_366);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, target: target(10) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: firstGeneration, pageIndex: 0, observedLogicalTime: 10, target: target(10), nodes: [], settings: [{ workspaceId: WORKSPACE, namespace: "editor", key, deleted: false, value: 16, logicalTime: 10, operationId: stableId(2_367) }], nextPageToken: null });
    await database.publishHydration(WORKSPACE, targetId, firstGeneration);
    expect(await database.getSetting(WORKSPACE, "editor", key)).toMatchObject({ value: 16 });
    expect(await database.querySetting(WORKSPACE, "editor", key)).toMatchObject({ availability: "available", value: { value: 16 } });
    expect(await database.querySettingNamespace(WORKSPACE, "editor")).toEqual({ availability: "unavailable" });

    const secondGeneration = stableId(2_368);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, target: target(20) });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: secondGeneration, pageIndex: 0, observedLogicalTime: 20, target: target(20), nodes: [], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, targetId, secondGeneration);
    expect(await database.getSettingRecord(WORKSPACE, "editor", key)).toBeUndefined();
    expect(await database.getHydrationCoverage(WORKSPACE, targetId)).toMatchObject({ generationId: secondGeneration, memberIds: [] });
    expect(await database.querySetting(WORKSPACE, "editor", key)).toEqual({ availability: "available", value: undefined });
    const namespaceTarget = { kind: "setting-namespace" as const, workspaceId: WORKSPACE, asOf: 30, namespace: "editor" as const, limit: 100 };
    const namespaceTargetId = hydrationTargetId(namespaceTarget);
    const namespaceGeneration = stableId(2_369);
    await database.beginHydration(namespaceTargetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: namespaceGeneration, target: namespaceTarget });
    await database.stageHydrationPage(namespaceTargetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId: namespaceGeneration, pageIndex: 0, observedLogicalTime: 30, target: namespaceTarget, nodes: [], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, namespaceTargetId, namespaceGeneration);
    expect(await database.querySettingNamespace(WORKSPACE, "editor")).toEqual({ availability: "available", value: [] });
    expect(await database.querySetting(WORKSPACE, "editor", "line-height")).toEqual({ availability: "available", value: undefined });
    const set = await database.commitOperation({ operation: { ...operationBase(stableId(2_370)), kind: "set", namespace: "editor", key, value: 18 } });
    expect(set.affectedIdentities).toContain(`setting-namespace:${WORKSPACE}:editor`);
    expect(await database.querySettingNamespace(WORKSPACE, "editor")).toMatchObject({ availability: "available", value: [{ key, value: 18 }] });
    await database.commitOperation({ operation: { ...operationBase(stableId(2_371)), kind: "unset", namespace: "editor", key } });
    expect(await database.querySetting(WORKSPACE, "editor", key)).toEqual({ availability: "available", value: undefined });
    expect(await database.querySettingNamespace(WORKSPACE, "editor")).toEqual({ availability: "available", value: [] });
    database.close();
  });

  test("scopes contradicted coverage pruning to the hydrated workspace", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const key = "font-size";
    const publish = async (target: HydrationTarget, generationId: string, settings: Setting[]) => {
      const targetId = hydrationTargetId(target);
      await database.beginHydration(targetId, { workspaceId: target.workspaceId, deviceId: DEVICE, generationId, target });
      await database.stageHydrationPage(targetId, null, { workspaceId: target.workspaceId, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: target.asOf, target, nodes: [], settings, nextPageToken: null });
      await database.publishHydration(target.workspaceId, targetId, generationId);
      return targetId;
    };
    const sourceNamespace = { kind: "setting-namespace" as const, workspaceId: WORKSPACE, asOf: 10, namespace: "editor" as const, limit: 100 };
    const sourceSetting = { workspaceId: WORKSPACE, namespace: "editor" as const, key, deleted: false as const, value: 16, logicalTime: 10, operationId: stableId(2_430) };
    const sourceTargetId = await publish(sourceNamespace, stableId(2_431), [sourceSetting]);
    await publish({ ...sourceNamespace, workspaceId: DESTINATION, asOf: 5 }, stableId(2_432), []);
    const refreshed = { ...sourceSetting, value: 18, logicalTime: 20, operationId: stableId(2_433) };
    await publish({ kind: "exact-settings", workspaceId: WORKSPACE, asOf: 20, namespace: "editor", keys: [key] }, stableId(2_434), [refreshed]);

    expect(await database.getHydrationCoverage(WORKSPACE, sourceTargetId)).toMatchObject({ memberIds: [key] });
    expect(await database.querySettingNamespace(WORKSPACE, "editor")).toMatchObject({ availability: "available", value: [{ key, value: 18 }] });
    database.close();
  });

  test("forgets contradicted exact negatives before folder coverage is replaced", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const firstId = stableId(2_420);
    const exact = (asOf: number, nodeIds: string[]) => ({ kind: "exact-nodes" as const, workspaceId: WORKSPACE, asOf, nodeIds: [...nodeIds].sort() });
    const publish = async (target: HydrationTarget, generationId: string, nodes: NodeRecord[] = []) => {
      const targetId = hydrationTargetId(target);
      await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, target });
      await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: target.asOf, target, nodes, settings: [], nextPageToken: null });
      await database.publishHydration(WORKSPACE, targetId, generationId);
    };
    const exactTarget = exact(10, [firstId]);
    const exactTargetId = hydrationTargetId(exactTarget);
    await publish(exactTarget, stableId(2_422));
    expect(await database.queryNode(WORKSPACE, firstId)).toEqual({ availability: "available", value: undefined });

    const tuple = { logicalTime: 20, operationId: stableId(2_423) };
    const first = { workspaceId: WORKSPACE, ...folder(firstId, "First"), lifecycle: { kind: "active" as const }, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    await publish({ kind: "folder-page", workspaceId: WORKSPACE, asOf: 20, parentId: null, limit: 100 }, stableId(2_424), [first]);
    expect(await database.queryNode(WORKSPACE, firstId)).toMatchObject({ availability: "available", value: { id: firstId } });
    expect(await database.getHydrationCoverage(WORKSPACE, exactTargetId)).toBeUndefined();

    await publish({ kind: "folder-page", workspaceId: WORKSPACE, asOf: 30, parentId: null, limit: 100 }, stableId(2_425));
    expect(await database.queryNode(WORKSPACE, firstId)).toEqual({ availability: "unavailable" });
    database.close();
  });

  test("makes evicted negative coverage unavailable and invalidates its selector", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const firstNodeId = stableId(10_000);
    let finalChanges = [] as Awaited<ReturnType<FilesystemDatabase["publishHydration"]>>;
    for (let index = 0; index <= WEB2_MAX_BATCH_ITEMS; index += 1) {
      const nodeId = stableId(10_000 + index);
      const target = { kind: "exact-nodes" as const, workspaceId: WORKSPACE, asOf: index + 1, nodeIds: [nodeId] };
      const targetId = hydrationTargetId(target);
      const generationId = stableId(20_000 + index);
      await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, target });
      await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: index + 1, target, nodes: [], settings: [], nextPageToken: null });
      finalChanges = await database.publishHydration(WORKSPACE, targetId, generationId);
      if (index === WEB2_MAX_BATCH_ITEMS - 1) expect(await database.queryNode(WORKSPACE, firstNodeId)).toEqual({ availability: "available", value: undefined });
    }
    expect(await database.queryNode(WORKSPACE, firstNodeId)).toEqual({ availability: "unavailable" });
    expect(await database.queryNode(WORKSPACE, stableId(10_001))).toEqual({ availability: "available", value: undefined });
    expect(finalChanges[0]!.affectedIdentities).toContain(`node:${WORKSPACE}:${firstNodeId}`);
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "hydration-coverage")).toHaveLength(WEB2_MAX_BATCH_ITEMS);
    database.close();
  });

  test("publishes ancestry ending at an explicit purge tombstone", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const childId = stableId(2_410);
    const tombstoneId = stableId(2_411);
    const tuple = { logicalTime: 10, operationId: stableId(2_412) };
    const child = { workspaceId: WORKSPACE, id: childId, kind: "folder" as const, name: "Child", parentId: tombstoneId, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    const tombstone = { workspaceId: WORKSPACE, id: tombstoneId, purged: true as const, logicalTime: 10, operationId: stableId(2_413) };
    const target = { kind: "ancestry" as const, workspaceId: WORKSPACE, asOf: 10, nodeId: childId, maxDepth: 2 };
    const targetId = hydrationTargetId(target);
    const generationId = stableId(2_414);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, target });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [child, tombstone], settings: [], nextPageToken: null });
    await database.publishHydration(WORKSPACE, targetId, generationId);
    expect(await database.getNode(childId)).toMatchObject({ parentId: tombstoneId });
    expect(await database.getNodeRecord(tombstoneId)).toEqual(tombstone);
    expect(await database.queryNode(WORKSPACE, tombstoneId)).toEqual({ availability: "available", value: undefined });
    database.close();
  });

  test("rolls back projection, coverage, revision, and staged deletion when publication fails", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const nodeId = stableId(2_370);
    const target = { kind: "exact-nodes" as const, workspaceId: WORKSPACE, asOf: 10, nodeIds: [nodeId] };
    const targetId = hydrationTargetId(target);
    const generationId = stableId(2_371);
    const tuple = { logicalTime: 10, operationId: stableId(2_372) };
    const node = { workspaceId: WORKSPACE, id: nodeId, kind: "folder" as const, name: "Remote", parentId: null, lifecycle: { kind: "active" as const }, position: { x: 0, y: 0 }, createdAt: 1, modifiedAt: 1, fieldTuples: { name: tuple, parent: tuple, lifecycle: tuple, position: tuple, content: null } };
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, target });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 10, target, nodes: [node], settings: [], nextPageToken: null });
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "hydration-coverage") throw new DOMException("Injected publication failure", "AbortError");
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    try {
      await expect(database.publishHydration(WORKSPACE, targetId, generationId)).rejects.toThrow("Injected publication failure");
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    expect(await database.getNode(nodeId)).toBeUndefined();
    expect(await database.getHydrationCoverage(WORKSPACE, targetId)).toBeUndefined();
    expect(await database.getHydrationProgress(WORKSPACE, targetId, generationId)).toEqual({ nextPageIndex: 1, pageToken: null, complete: true });
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(0);
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "changes")).toEqual([]);
    database.close();
  });

  test("rejects a staged hydration older than the applied pull cursor", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const target = { kind: "exact-settings" as const, workspaceId: WORKSPACE, asOf: 5, namespace: "editor" as const, keys: ["font-size"] };
    const targetId = hydrationTargetId(target);
    const generationId = stableId(2_381);
    await database.beginHydration(targetId, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, target });
    await database.stageHydrationPage(targetId, null, { workspaceId: WORKSPACE, deviceId: DEVICE, generationId, pageIndex: 0, observedLogicalTime: 5, target, nodes: [], settings: [], nextPageToken: null });
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    const syncStore = raw.transaction("sync", "readwrite").objectStore("sync");
    const sync = await idbRequest(syncStore.get(WORKSPACE)) as Record<string, unknown>;
    await idbRequest(syncStore.put({ ...sync, cursor: 6 }));
    raw.close();

    await expect(database.publishHydration(WORKSPACE, targetId, generationId)).rejects.toThrow("older than");
    expect(await database.getHydrationCoverage(WORKSPACE, targetId)).toBeUndefined();
    expect(await database.getHydrationProgress(WORKSPACE, targetId, generationId)).toMatchObject({ complete: true });
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(0);
    database.close();
  });

  test("commits a folder and file forest with exact records, inverse, change, and clocks", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 100);
    const manifest = await verifiedManifest(3, 1);
    const rootId = stableId(10);
    const fileId = stableId(11);
    const looseFileId = stableId(12);
    const operationId = stableId(20);
    const stored = await database.commitOperation({
      operation: createDraft(operationId, [folder(rootId, "Folder"), file(fileId, "Nested.txt", manifest, rootId), file(looseFileId, "Loose.txt", manifest)]),
      manifests: [manifest],
    });

    expect(stored).toMatchObject({ operationId, localRevision: 1, destinationLocalRevision: null, stateKind: "pending", intent: "forward", compensatesOperationId: null, inverse: { kind: "create", rootNodeIds: [rootId, looseFileId] }, versionNodeIds: [fileId, looseFileId] });
    expect(stored.operation.logicalTime).toBe(100);
    expect(await database.listChildren(WORKSPACE, null)).toHaveLength(2);
    expect((await database.listChildren(WORKSPACE, rootId)).map(({ id }) => id)).toEqual([fileId]);
    const createdFile = await database.getNode(fileId);
    expect(createdFile).toMatchObject({ workspaceId: WORKSPACE, id: fileId, lifecycle: { kind: "active" }, size: 3, manifestHash: manifest.hash });
    expect(createdFile).not.toHaveProperty("parentKey");
    expect(createdFile).not.toHaveProperty("lifecycleKey");
    expect(createdFile!.fieldTuples).toEqual({
      name: { logicalTime: 100, operationId },
      parent: { logicalTime: 100, operationId },
      lifecycle: { logicalTime: 100, operationId },
      position: { logicalTime: 100, operationId },
      content: { logicalTime: 100, operationId },
    });
    expect((await database.getNode(rootId))!.fieldTuples.content).toBeNull();
    expect(await database.getManifest(manifest.hash)).toEqual(manifest.manifest);

    const name = await filesystemDatabaseName(ACCOUNT);
    expect(await readStored(factory, name, "changes", [WORKSPACE, 1])).toEqual({ kind: "operation", workspaceId: WORKSPACE, revision: 1, operationId, affectedIdentities: stored.affectedIdentities });
    expect(await readStored(factory, name, "sync", WORKSPACE)).toEqual({ workspaceId: WORKSPACE, deviceId: DEVICE, cursor: 0, lastHydrationAsOf: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 100 });
    expect(await database.listWorkspaces()).toEqual([{ id: WORKSPACE, name: "Workspace", pinned: true, ordinal: 0, headSequence: 0, snapshotBarrier: 0, logFloor: 0, localRevision: 1 }]);
    database.close();
  });

  test("atomically rejects missing, wrongly hashed, and size-mismatched manifests", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const manifest = await verifiedManifest(3, 2);
    const draft = createDraft(stableId(30), [file(stableId(31), "File.txt", manifest)]);
    await expect(database.commitOperation({ operation: draft })).rejects.toThrow("missing manifest");
    await expect(database.commitOperation({ operation: draft, manifests: [{ hash: "f".repeat(64), manifest: manifest.manifest }] })).rejects.toThrow("canonical bytes");
    await expect(database.commitOperation({ operation: createDraft(stableId(34), [folder(stableId(35), "Folder")]), manifests: [manifest] })).rejects.toThrow("unreferenced manifest");
    await expect(database.commitOperation({ operation: createDraft(stableId(32), [{ ...file(stableId(33), "Wrong.txt", manifest), size: 4 }]), manifests: [manifest] })).rejects.toThrow("size does not match");
    await expectEmptyCommit(database, factory);
    expect(await database.getNode(stableId(31))).toBeUndefined();
    expect(await database.getManifest(manifest.hash)).toBeUndefined();
    database.close();
  });

  test("atomically rejects missing and file parents", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    await expect(database.commitOperation({ operation: createDraft(stableId(40), [folder(stableId(41), "Child", stableId(42))]) })).rejects.toThrow("parent does not exist");
    await expectEmptyCommit(database, factory);

    const manifest = await verifiedManifest(1, 3);
    const parentFileId = stableId(43);
    await database.commitOperation({ operation: createDraft(stableId(44), [file(parentFileId, "Parent.txt", manifest)]), manifests: [manifest] });
    await expect(database.commitOperation({ operation: createDraft(stableId(45), [folder(stableId(46), "Child", parentFileId)]) })).rejects.toThrow("active folder");
    expect(await database.listOperations(WORKSPACE)).toHaveLength(1);
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(1);
    expect(await database.getNode(stableId(46))).toBeUndefined();
    database.close();
  });

  test("atomically rejects global node ID reuse and case-insensitive sibling collisions", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const reusedId = stableId(50);
    await database.commitOperation({ operation: createDraft(stableId(51), [folder(reusedId, "Existing")]) });
    const otherWorkspace = stableId(52);
    await database.createWorkspace({ id: otherWorkspace, name: "Other", pinned: false, deviceId: DEVICE });
    await expect(database.commitOperation({ operation: createDraft(stableId(53), [folder(reusedId, "Elsewhere")], otherWorkspace) })).rejects.toThrow("already exists");
    await expect(database.commitOperation({ operation: createDraft(stableId(54), [folder(stableId(55), "existing")]) })).rejects.toThrow("sibling");
    await expect(database.commitOperation({ operation: createDraft(stableId(56), [folder(stableId(57), "Same"), folder(stableId(58), "same")]) })).rejects.toThrow("duplicate sibling names");
    expect(await database.listOperations(WORKSPACE)).toHaveLength(1);
    expect(await database.listOperations(otherWorkspace)).toEqual([]);
    expect(await database.getNode(stableId(55))).toBeUndefined();
    database.close();
  });

  test("write changes only file content fields and captures the exact previous version", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 200);
    const originalManifest = await verifiedManifest(1, 4);
    const nextManifest = await verifiedManifest(2, 5);
    const nodeId = stableId(60);
    const createId = stableId(61);
    const writeId = stableId(62);
    await database.commitOperation({ operation: createDraft(createId, [file(nodeId, "Notes.txt", originalManifest)]), manifests: [originalManifest] });
    const before = await database.getNode(nodeId);
    const stored = await database.commitOperation({ operation: writeDraft(writeId, nodeId, nextManifest, 99), manifests: [nextManifest], expectedContentTuple: before!.fieldTuples.content });
    const after = await database.getNode(nodeId);

    expect(stored.inverse).toEqual({ kind: "write", nodeId, mimeType: "text/plain", size: 1, manifestHash: originalManifest.hash, modifiedAt: 10 });
    expect(stored).toMatchObject({ localRevision: 2, intent: "forward", compensatesOperationId: null, versionNodeIds: [nodeId] });
    expect(after).toEqual({
      ...before,
      mimeType: "text/markdown",
      size: 2,
      manifestHash: nextManifest.hash,
      modifiedAt: 99,
      fieldTuples: { ...before!.fieldTuples, content: { logicalTime: 201, operationId: writeId } },
    });
    database.close();
  });

  test("atomically enforces an exact expected content tuple", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 300);
    const nodeId = stableId(63);
    const initial = await verifiedManifest(1, 4);
    const next = await verifiedManifest(2, 5);
    const stale = await verifiedManifest(3, 6);
    await database.commitOperation({ operation: createDraft(stableId(64), [file(nodeId, "Expected.txt", initial)]), manifests: [initial] });
    const expectedContentTuple = (await database.getNode(nodeId))!.fieldTuples.content!;
    const accepted = await database.commitOperation({ operation: writeDraft(stableId(65), nodeId, next, 20), manifests: [next], expectedContentTuple });
    const after = await database.getNode(nodeId);

    expect(accepted.expectedContentTuple).toEqual(expectedContentTuple);
    await expect(database.commitOperation({ operation: writeDraft(stableId(149), nodeId, stale, 21), manifests: [stale] } as never)).rejects.toThrow("exact expected content tuple");
    await expect(database.commitOperation({ operation: writeDraft(stableId(66), nodeId, stale, 21), manifests: [stale], expectedContentTuple })).rejects.toThrow("content changed");
    expect(await database.getNode(nodeId)).toEqual(after);
    expect(await database.getOperation(stableId(66))).toBeUndefined();
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(2);
    database.close();
  });

  test("accepts durable write compensation chains and rejects invalid metadata atomically", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 400);
    const nodeId = stableId(67);
    const initial = await verifiedManifest(1, 7);
    const next = await verifiedManifest(2, 8);
    const createId = stableId(68);
    const writeId = stableId(69);
    await database.commitOperation({ operation: createDraft(createId, [file(nodeId, "Compensation.txt", initial)]), manifests: [initial] });
    const createTuple = (await database.getNode(nodeId))!.fieldTuples.content!;
    const write = await database.commitOperation({ operation: writeDraft(writeId, nodeId, next, 20), manifests: [next], expectedContentTuple: createTuple });
    const writeTuple = { logicalTime: write.operation.logicalTime, operationId: write.operationId };
    const inverse = write.inverse.kind === "write" ? write.inverse : undefined;
    expect(inverse).toBeDefined();

    await expect(database.commitOperation({ operation: versionDraft(stableId(150), nodeId, inverse!), intent: "forward", compensatesOperationId: writeId, expectedContentTuple: writeTuple })).rejects.toThrow("forward operation");
    await expect(database.commitOperation({ operation: versionDraft(stableId(151), nodeId, inverse!), intent: "undo", compensatesOperationId: stableId(999), expectedContentTuple: writeTuple })).rejects.toThrow("existing operation");
    await expect(database.commitOperation({ operation: versionDraft(stableId(152), nodeId, inverse!), intent: "undo", compensatesOperationId: createId, expectedContentTuple: writeTuple })).rejects.toThrow("write inverse");
    await expect(database.commitOperation({ operation: versionDraft(stableId(153), nodeId, inverse!), intent: "redo", compensatesOperationId: writeId, expectedContentTuple: writeTuple })).rejects.toThrow("undo inverse");

    const otherWorkspace = stableId(154);
    const otherOperationId = stableId(155);
    await database.createWorkspace({ id: otherWorkspace, name: "Other", pinned: false, deviceId: DEVICE });
    await database.commitOperation({ operation: createDraft(otherOperationId, [folder(stableId(156), "Elsewhere")], otherWorkspace) });
    await expect(database.commitOperation({ operation: versionDraft(stableId(157), nodeId, inverse!), intent: "undo", compensatesOperationId: otherOperationId, expectedContentTuple: writeTuple })).rejects.toThrow("same workspace");

    await database.commitOperation({ operation: { ...operationBase(stableId(160)), kind: "rename", nodeId, name: "Renamed.txt", modifiedAt: 99 } });
    const undoId = stableId(158);
    const undo = await database.commitOperation({ operation: versionDraft(undoId, nodeId, inverse!), intent: "undo", compensatesOperationId: writeId, expectedContentTuple: writeTuple });
    expect(undo).toMatchObject({ intent: "undo", compensatesOperationId: writeId });
    expect(await database.getNode(nodeId)).toMatchObject({ name: "Renamed.txt", manifestHash: initial.hash });
    const redoId = stableId(159);
    const redoInverse = undo.inverse.kind === "write" ? undo.inverse : undefined;
    const redoInput = { operation: versionDraft(redoId, nodeId, redoInverse!), intent: "redo" as const, compensatesOperationId: undoId, expectedContentTuple: { logicalTime: undo.operation.logicalTime, operationId: undoId } };
    const redo = await database.commitOperation(redoInput);
    expect(redo).toMatchObject({ intent: "redo", compensatesOperationId: undoId });
    expect(await database.commitOperation(redoInput)).toEqual(redo);
    await expect(database.commitOperation({ ...redoInput, intent: "restore", compensatesOperationId: createId })).rejects.toThrow("cannot be reused");
    await expect(database.commitOperation({ ...redoInput, compensatesOperationId: createId })).rejects.toThrow("cannot be reused");
    expect((await database.getNode(nodeId))?.manifestHash).toBe(next.hash);
    const restore = await database.commitOperation({ operation: versionDraft(stableId(163), nodeId, inverse!), intent: "restore", compensatesOperationId: createId, expectedContentTuple: { logicalTime: redo.operation.logicalTime, operationId: redoId } });
    expect(restore).toMatchObject({ intent: "restore", compensatesOperationId: createId });
    expect((await database.getNode(nodeId))?.manifestHash).toBe(initial.hash);
    database.close();
  });

  test("compensates only the exact created forest and durably redoes its lifecycle", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 450);
    const rootId = stableId(164);
    const nestedId = stableId(165);
    const laterId = stableId(166);
    const createId = stableId(167);
    const laterCreateId = stableId(168);
    const laterTrashId = stableId(169);
    const undoId = stableId(170);
    const redoId = stableId(171);
    const created = await database.commitOperation({ operation: createDraft(createId, [folder(rootId, "Created"), folder(nestedId, "Nested", rootId)]) });
    await database.commitOperation({ operation: createDraft(laterCreateId, [folder(laterId, "Later", rootId)]) });
    const undoInput = { operation: { ...operationBase(undoId), kind: "trash" as const, nodeIds: [rootId], trashedAt: 20 }, intent: "undo" as const, compensatesOperationId: createId };

    await expect(database.commitOperation({ ...undoInput, operation: { ...undoInput.operation, nodeIds: [nestedId] } })).rejects.toThrow("exact created forest");
    await expect(database.commitOperation(undoInput)).rejects.toThrow("no longer current");
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(2);
    expect((await database.getNode(rootId))?.lifecycle.kind).toBe("active");

    await database.commitOperation({ operation: { ...operationBase(laterTrashId), kind: "trash", nodeIds: [laterId], trashedAt: 21 } });
    const undo = await database.commitOperation(undoInput);
    expect(undo).toMatchObject({ intent: "undo", compensatesOperationId: createId, inverse: { kind: "trash", nodeIds: [rootId, nestedId].sort() } });
    expect(await database.commitOperation(undoInput)).toEqual(undo);
    expect((await database.getNode(rootId))?.lifecycle.kind).toBe("trashed");
    expect((await database.getNode(nestedId))?.lifecycle.kind).toBe("trashed");

    const redoInput = { operation: { ...operationBase(redoId), kind: "restore" as const, nodeIds: [rootId], destination: "original" as const, modifiedAt: 30 }, intent: "redo" as const, compensatesOperationId: undoId };
    await expect(database.commitOperation({ ...redoInput, operation: { ...redoInput.operation, destination: "root" } })).rejects.toThrow("exact forest");
    const redo = await database.commitOperation(redoInput);
    expect(redo).toMatchObject({ intent: "redo", compensatesOperationId: undoId, inverse: { kind: "restore" } });
    expect(await database.getNode(rootId)).toMatchObject({ lifecycle: { kind: "active" }, parentId: null });
    expect(await database.getNode(nestedId)).toMatchObject({ lifecycle: { kind: "active" }, parentId: rootId });
    expect(created.inverse).toEqual({ kind: "create", rootNodeIds: [rootId] });
    database.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, { indexedDB: factory, IDBKeyRange });
    expect((await reopened.listOperations(WORKSPACE)).slice(0, 2)).toEqual([redo, undo]);
    expect((await reopened.getNode(nestedId))?.lifecycle.kind).toBe("active");
    expect((await reopened.getNode(laterId))?.lifecycle.kind).toBe("trashed");
    expect((await reopened.listWorkspaces())[0]!.localRevision).toBe(5);
    reopened.close();

    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    const operationStore = raw.transaction("operations", "readwrite").objectStore("operations");
    const storedRedo = await idbRequest(operationStore.get(redoId));
    await idbRequest(operationStore.put({ ...storedRedo, compensatesOperationId: laterTrashId }));
    raw.close();
    const corrupted = await openFilesystemDatabase(ACCOUNT, { indexedDB: factory, IDBKeyRange });
    await expect(corrupted.commitOperation({ operation: { ...operationBase(stableId(172)), kind: "trash", nodeIds: [rootId], trashedAt: 40 }, intent: "undo", compensatesOperationId: redoId })).rejects.toThrow("exact created forest");
    expect((await corrupted.getNode(rootId))?.lifecycle.kind).toBe("active");
    corrupted.close();
  });

  test("advances the logical clock monotonically when wall time does not move", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 500);
    const first = await verifiedManifest(1, 6);
    const second = await verifiedManifest(2, 7);
    const third = await verifiedManifest(3, 8);
    const nodeId = stableId(70);
    const one = await database.commitOperation({ operation: createDraft(stableId(71), [file(nodeId, "Clock.txt", first)]), manifests: [first] });
    const two = await commitWrite(database, writeDraft(stableId(72), nodeId, second, 11), [second]);
    const three = await commitWrite(database, writeDraft(stableId(73), nodeId, third, 12), [third]);
    expect([one.operation.logicalTime, two.operation.logicalTime, three.operation.logicalTime]).toEqual([500, 501, 502]);
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "sync", WORKSPACE)).toMatchObject({ cursor: 0, lastObservedLogicalTime: 0, lastLocalLogicalTime: 502 });
    database.close();
  });

  test("replays identical operation IDs without a revision and rejects changed reuse", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 600);
    const operation = createDraft(stableId(80), [folder(stableId(81), "Replay")]);
    const first = await database.commitOperation({ operation });
    const replay = await database.commitOperation({ operation });
    expect(replay).toEqual(first);
    expect(await database.listOperations(WORKSPACE)).toEqual([first]);
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(1);
    await expect(database.commitOperation({ operation: { ...operation, nodes: [folder(stableId(81), "Changed")] } })).rejects.toThrow("cannot be reused");
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(1);
    database.close();
  });

  test("replays bounded contiguous workspace changes after an exclusive revision", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 625);
    const operations = [stableId(82), stableId(83), stableId(84)];
    for (let index = 0; index < operations.length; index += 1) {
      await database.commitOperation({ operation: createDraft(operations[index]!, [folder(stableId(85 + index), `Change ${index}`)]) });
    }

    const firstPage = await database.listChanges(WORKSPACE, 0, 2);
    expect(firstPage.map(({ revision, operationId }) => ({ revision, operationId }))).toEqual([
      { revision: 1, operationId: operations[0] },
      { revision: 2, operationId: operations[1] },
    ]);
    const finalPage = await database.listChanges(WORKSPACE, 2);
    expect(finalPage.map(({ revision, operationId }) => ({ revision, operationId }))).toEqual([{ revision: 3, operationId: operations[2] }]);
    expect(await database.listChanges(WORKSPACE, 3)).toEqual([]);
    await expect(database.listChanges(WORKSPACE, 4)).rejects.toThrow("ahead");
    await expect(database.listChanges(WORKSPACE, 0, WEB2_MAX_BATCH_ITEMS + 1)).rejects.toThrow("too large");

    const databaseName = await filesystemDatabaseName(ACCOUNT);
    const originalChange = await readStored(factory, databaseName, "changes", [WORKSPACE, 2]) as { workspaceId: string; revision: number; operationId: string; affectedIdentities: string[] };
    const raw = await openRaw(factory, databaseName);
    await idbRequest(raw.transaction("changes", "readwrite").objectStore("changes").put({ ...originalChange, affectedIdentities: originalChange.affectedIdentities.slice(1) }));
    raw.close();
    await expect(database.listChanges(WORKSPACE, 0)).rejects.toThrow("does not match its operation");
    const missing = await openRaw(factory, databaseName);
    const changes = missing.transaction("changes", "readwrite").objectStore("changes");
    await Promise.all([idbRequest(changes.put(originalChange)), idbRequest(changes.delete([WORKSPACE, 2]))]);
    missing.close();
    await expect(database.listChanges(WORKSPACE, 0)).rejects.toThrow("not contiguous");
    database.close();
  });

  test("copies complete source forests with strict history, dynamic identities, replay, and reopen", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 650);
    const manifest = await verifiedManifest(3, 12);
    const sourceRootId = stableId(170);
    const sourceFolderId = stableId(171);
    const sourceFileId = stableId(172);
    const emptyRootId = stableId(173);
    const destinationId = stableId(174);
    const sourceRoot = folder(sourceRootId, "Source");
    const sourceFolder = folder(sourceFolderId, "Nested", sourceRootId);
    const sourceFile = file(sourceFileId, "Notes.txt", manifest, sourceFolderId);
    const emptyRoot = folder(emptyRootId, "Empty");
    await database.commitOperation({ operation: createDraft(stableId(175), [sourceRoot, sourceFolder, sourceFile, emptyRoot, folder(destinationId, "Destination")]), manifests: [manifest] });

    const copiedRootId = stableId(176);
    const copiedFolderId = stableId(177);
    const copiedFileId = stableId(178);
    const copiedEmptyId = stableId(179);
    const copyId = stableId(180);
    const nodes = [
      { ...sourceRoot, id: copiedRootId, name: "Source copy", parentId: destinationId, position: { x: 90, y: 91 }, createdAt: 77, modifiedAt: 77 },
      { ...sourceFolder, id: copiedFolderId, parentId: copiedRootId, createdAt: 77, modifiedAt: 77 },
      { ...sourceFile, id: copiedFileId, parentId: copiedFolderId, createdAt: 77, modifiedAt: 77 },
      { ...emptyRoot, id: copiedEmptyId, name: "Empty copy", parentId: destinationId, position: { x: 92, y: 93 }, createdAt: 77, modifiedAt: 77 },
    ];
    const operation = copyDraft(copyId, [sourceRootId, emptyRootId], nodes);
    const copied = await database.commitOperation({ operation });

    expect(copied).toMatchObject({ inverse: { kind: "copy", rootNodeIds: [copiedRootId, copiedEmptyId], sourceNodeIds: [sourceRootId, sourceFolderId, sourceFileId, emptyRootId].sort(), sourceFileNodeIds: [sourceFileId] }, versionNodeIds: [copiedFileId], localRevision: 2 });
    expect(copied.affectedIdentities).toEqual([...copied.affectedIdentities].sort());
    for (const id of [sourceRootId, sourceFolderId, sourceFileId, emptyRootId]) expect(copied.affectedIdentities).toContain(`node:${WORKSPACE}:${id}`);
    expect(copied.affectedIdentities).toContain(`content:${WORKSPACE}:${sourceFileId}`);
    expect(await database.getNode(sourceFileId)).toMatchObject(sourceFile);
    expect(await database.getNode(copiedRootId)).toMatchObject({ name: "Source copy", parentId: destinationId, position: { x: 90, y: 91 }, createdAt: 77, modifiedAt: 77 });
    expect(await database.getNode(copiedFolderId)).toMatchObject({ name: sourceFolder.name, parentId: copiedRootId, position: sourceFolder.position, createdAt: 77, modifiedAt: 77 });
    expect(await database.getNode(copiedFileId)).toMatchObject({ name: sourceFile.name, parentId: copiedFolderId, mimeType: sourceFile.mimeType, size: sourceFile.size, manifestHash: sourceFile.manifestHash, createdAt: 77, modifiedAt: 77 });
    expect((await database.listFileVersions(WORKSPACE, copiedFileId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([{ operationId: copyId, current: true }]);
    const nextManifest = await verifiedManifest(4, 13);
    const writeId = stableId(184);
    await commitWrite(database, writeDraft(writeId, copiedFileId, nextManifest, 78), [nextManifest]);
    expect((await database.listFileVersions(WORKSPACE, copiedFileId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([
      { operationId: writeId, current: true },
      { operationId: copyId, current: false },
    ]);
    expect(await database.commitOperation({ operation })).toEqual(copied);
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(3);

    const beforeReopen = {
      nodes: await Promise.all(nodes.map(({ id }) => database.getNode(id))),
      operations: await database.listOperations(WORKSPACE),
      versions: await database.listFileVersions(WORKSPACE, copiedFileId),
    };
    database.close();
    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect({
      nodes: await Promise.all(nodes.map(({ id }) => reopened.getNode(id))),
      operations: await reopened.listOperations(WORKSPACE),
      versions: await reopened.listFileVersions(WORKSPACE, copiedFileId),
    }).toEqual(beforeReopen);
    await reopened.commitOperation({ operation: { ...operationBase(stableId(181)), kind: "trash", nodeIds: [copiedRootId], trashedAt: 80 } });
    await reopened.commitOperation({ operation: { ...operationBase(stableId(182)), kind: "purge", nodeIds: [copiedRootId] } });
    await expect(reopened.commitOperation({ operation: createDraft(stableId(183), [folder(copiedFileId, "Reused")]) })).rejects.toThrow("already exists");
    reopened.close();
  });

  test("atomically transfers complete forests with exact projection, inverse, clocks, changes, replay, and reopen", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 2_000);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const manifest = await verifiedManifest(3, 15);
    const sourceParentId = stableId(1_500);
    const rootId = stableId(1_501);
    const nestedId = stableId(1_502);
    const fileId = stableId(1_503);
    const emptyId = stableId(1_504);
    const looseFileId = stableId(1_505);
    const destinationParentId = stableId(1_506);
    const sourceNodes = [
      folder(sourceParentId, "Source parent"),
      { ...folder(rootId, "Tree", sourceParentId), modifiedAt: 11 },
      { ...folder(nestedId, "Nested", rootId), modifiedAt: 12 },
      file(fileId, "Nested.txt", manifest, nestedId, 13),
      { ...folder(emptyId, "Empty"), modifiedAt: 14 },
      file(looseFileId, "Loose.txt", manifest, null, 15),
    ];
    await database.commitOperation({ operation: createDraft(stableId(1_507), sourceNodes), manifests: [manifest] });
    await database.commitOperation({ operation: createDraft(stableId(1_508), [folder(destinationParentId, "Inbox")], DESTINATION) });
    const before = new Map((await Promise.all([rootId, nestedId, fileId, emptyId, looseFileId].map((id) => database.getNode(id)))).map((node) => [node!.id, node!]));
    const databaseName = await filesystemDatabaseName(ACCOUNT);
    const raw = await openRaw(factory, databaseName);
    const clockTransaction = raw.transaction("sync", "readwrite");
    await Promise.all([
      idbRequest(clockTransaction.objectStore("sync").put({ workspaceId: WORKSPACE, deviceId: DEVICE, cursor: 0, lastHydrationAsOf: 0, lastObservedLogicalTime: 3_500, lastLocalLogicalTime: 100 })),
      idbRequest(clockTransaction.objectStore("sync").put({ workspaceId: DESTINATION, deviceId: DEVICE, cursor: 0, lastHydrationAsOf: 0, lastObservedLogicalTime: 300, lastLocalLogicalTime: 4_000 })),
    ]);
    raw.close();

    const operationId = stableId(1_509);
    const operation = transferDraft(operationId, [looseFileId, rootId, emptyId], DESTINATION, destinationParentId);
    const transferred = await database.commitOperation({ operation });
    const tuple = { logicalTime: 4_001, operationId };
    const movedIds = [rootId, nestedId, fileId, emptyId, looseFileId];
    expect(transferred).toMatchObject({ localRevision: 2, destinationLocalRevision: 2, stateKind: "pending", intent: "forward", compensatesOperationId: null });
    expect(transferred.operation.logicalTime).toBe(4_001);
    expect(transferred.versionNodeIds).toEqual([]);
    expect(transferred.inverse).toEqual({
      kind: "transfer",
      nodes: [
        { nodeId: rootId, parentId: sourceParentId, modifiedAt: 11 },
        { nodeId: nestedId, parentId: rootId, modifiedAt: 12 },
        { nodeId: fileId, parentId: nestedId, modifiedAt: 13 },
        { nodeId: emptyId, parentId: null, modifiedAt: 14 },
        { nodeId: looseFileId, parentId: null, modifiedAt: 15 },
      ],
      fileNodeIds: [fileId, looseFileId],
    });
    for (const id of movedIds) {
      const previous = before.get(id)!;
      const node = (await database.getNode(id))!;
      expect(node).toEqual({
        ...previous,
        workspaceId: DESTINATION,
        parentId: [rootId, emptyId, looseFileId].includes(id) ? destinationParentId : previous.parentId,
        modifiedAt: 77,
        fieldTuples: { ...previous.fieldTuples, parent: tuple },
      });
    }
    expect(await database.listChildren(WORKSPACE, sourceParentId)).toEqual([]);
    expect((await database.listChildren(DESTINATION, destinationParentId)).map(({ id }) => id).sort()).toEqual([emptyId, looseFileId, rootId].sort());
    expect((await database.getNode(fileId) as Extract<Awaited<ReturnType<FilesystemDatabase["getNode"]>>, { kind: "file" }>)).toMatchObject({ mimeType: "text/plain", size: 3, manifestHash: manifest.hash });

    const sourceIdentities = [
      ...movedIds.map((id) => `node:${WORKSPACE}:${id}`),
      `content:${WORKSPACE}:${fileId}`,
      `content:${WORKSPACE}:${looseFileId}`,
      `folder:${WORKSPACE}:${rootId}`,
      `folder:${WORKSPACE}:${nestedId}`,
      `folder:${WORKSPACE}:${emptyId}`,
      `folder:${WORKSPACE}:${sourceParentId}`,
      `folder:${WORKSPACE}:root`,
    ].sort();
    const destinationIdentities = [
      ...movedIds.map((id) => `node:${DESTINATION}:${id}`),
      `content:${DESTINATION}:${fileId}`,
      `content:${DESTINATION}:${looseFileId}`,
      `folder:${DESTINATION}:${rootId}`,
      `folder:${DESTINATION}:${nestedId}`,
      `folder:${DESTINATION}:${emptyId}`,
      `folder:${DESTINATION}:${destinationParentId}`,
    ].sort();
    expect(transferred.affectedIdentities).toEqual([...sourceIdentities, ...destinationIdentities].sort());
    expect(await readStored(factory, databaseName, "changes", [WORKSPACE, 2])).toEqual({ kind: "operation", workspaceId: WORKSPACE, revision: 2, operationId, affectedIdentities: sourceIdentities });
    expect(await readStored(factory, databaseName, "changes", [DESTINATION, 2])).toEqual({ kind: "operation", workspaceId: DESTINATION, revision: 2, operationId, affectedIdentities: destinationIdentities });
    expect(await database.getSyncState(WORKSPACE)).toMatchObject({ lastObservedLogicalTime: 3_500, lastLocalLogicalTime: 4_001 });
    expect(await database.getSyncState(DESTINATION)).toMatchObject({ lastObservedLogicalTime: 300, lastLocalLogicalTime: 4_001 });
    expect(new Map((await database.listWorkspaces()).map((workspace) => [workspace.id, workspace.localRevision]))).toEqual(new Map([[WORKSPACE, 2], [DESTINATION, 2]]));
    expect((await database.listOperations(WORKSPACE))[0]).toEqual(transferred);
    expect((await database.listOperations(DESTINATION)).some(({ operationId: id }) => id === operationId)).toBe(false);
    expect(await database.commitOperation({ operation })).toEqual(transferred);
    expect(new Map((await database.listWorkspaces()).map((workspace) => [workspace.id, workspace.localRevision]))).toEqual(new Map([[WORKSPACE, 2], [DESTINATION, 2]]));

    const beforeReopen = await Promise.all(movedIds.map((id) => database.getNode(id)));
    database.close();
    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect(await Promise.all(movedIds.map((id) => reopened.getNode(id)))).toEqual(beforeReopen);
    expect(await reopened.getOperation(operationId)).toEqual(transferred);
    reopened.close();

    const malformed = await openRaw(factory, databaseName);
    await idbRequest(malformed.transaction("operations", "readwrite").objectStore("operations").put({ ...transferred, affectedIdentities: transferred.affectedIdentities.slice(1) }));
    malformed.close();
    const strict = await openFilesystemDatabase(ACCOUNT, environment(factory));
    await expect(strict.getOperation(operationId)).rejects.toThrow("derived metadata");
    strict.close();
  });

  test("preserves pre-transfer file versions through a bounded global operation scan", async () => {
    const factory = new IDBFactory();
    let time = 4_100;
    const database = await workspaceDatabase(factory, () => time++);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const original = await verifiedManifest(1, 1);
    const second = await verifiedManifest(2, 2);
    const third = await verifiedManifest(3, 3);
    const nodeId = stableId(1_520);
    const createId = stableId(1_521);
    const writeId = stableId(1_522);
    const transferId = stableId(1_523);
    const destinationWriteId = stableId(1_524);
    await database.commitOperation({ operation: createDraft(createId, [file(nodeId, "History.txt", original)]), manifests: [original] });
    await commitWrite(database, writeDraft(writeId, nodeId, second, 20), [second]);
    await database.commitOperation({ operation: transferDraft(transferId, [nodeId]) });
    expect((await database.listFileVersions(DESTINATION, nodeId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([
      { operationId: writeId, current: true },
      { operationId: createId, current: false },
    ]);
    const transferred = await database.getNode(nodeId);
    await database.commitOperation({
      operation: { schemaVersion: 1, kind: "write", operationId: destinationWriteId, workspaceId: DESTINATION, deviceId: DEVICE, nodeId, mimeType: "text/plain", size: third.manifest.size, manifestHash: third.hash, modifiedAt: 21 },
      manifests: [third],
      expectedContentTuple: transferred!.fieldTuples.content!,
    });
    expect((await database.listFileVersions(DESTINATION, nodeId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([
      { operationId: destinationWriteId, current: true },
      { operationId: writeId, current: false },
      { operationId: createId, current: false },
    ]);
    database.close();
  });

  test("lists the current version first and caps older local versions at twenty", async () => {
    const factory = new IDBFactory();
    let time = 700;
    const database = await workspaceDatabase(factory, () => time++);
    const nodeId = stableId(90);
    const initial = await verifiedManifest(1, 9);
    const createId = stableId(91);
    await database.commitOperation({ operation: createDraft(createId, [file(nodeId, "History.txt", initial)]), manifests: [initial] });
    const second = await verifiedManifest(2, 10);
    const secondId = stableId(92);
    await commitWrite(database, writeDraft(secondId, nodeId, second, 20), [second]);
    expect((await database.listFileVersions(WORKSPACE, nodeId)).map(({ operationId, current }) => ({ operationId, current }))).toEqual([
      { operationId: secondId, current: true },
      { operationId: createId, current: false },
    ]);

    const writeIds = [secondId];
    for (let index = 0; index < 20; index += 1) {
      const manifest = await verifiedManifest(index + 3, index % 5 + 10);
      const operationId = stableId(100 + index);
      writeIds.push(operationId);
      await commitWrite(database, writeDraft(operationId, nodeId, manifest, 21 + index), [manifest]);
    }
    const versions = await database.listFileVersions(WORKSPACE, nodeId);
    expect(versions).toHaveLength(21);
    expect(versions[0]).toMatchObject({ operationId: writeIds.at(-1), current: true, modifiedAt: 40 });
    expect(versions.slice(1).map(({ operationId }) => operationId)).toEqual(writeIds.slice(0, -1).reverse());
    expect(versions.some(({ operationId }) => operationId === createId)).toBe(false);
    database.close();
  });

  test("sweeps manifests without a live projection or pending workspace owner", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 900);
    await database.createWorkspace({ id: DESTINATION, name: "Disposable", pinned: false, deviceId: DEVICE });
    const initial = await verifiedManifest(3, 10);
    const current = await verifiedManifest(4, 11);
    const deleted = await verifiedManifest(5, 12);
    const fileId = stableId(190);
    const createId = stableId(191);
    await database.commitOperation({ operation: createDraft(createId, [file(fileId, "History.txt", initial)]), manifests: [initial] });
    await commitWrite(database, writeDraft(stableId(192), fileId, current, 20), [current]);
    const deletedOperationId = stableId(193);
    await database.commitOperation({ operation: createDraft(deletedOperationId, [file(stableId(194), "Deleted.txt", deleted)], DESTINATION), manifests: [deleted] });
    await database.deleteWorkspace(DESTINATION);
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(raw.transaction("operations", "readwrite").objectStore("operations").delete(createId));
    raw.close();

    expect(await database.getOperation(deletedOperationId)).toBeDefined();
    const retainedChunks = [initial.manifest.chunks[0]!.hash, current.manifest.chunks[0]!.hash].sort();
    expect(await database.sweepManifests()).toEqual(retainedChunks);
    expect(await database.getManifest(initial.hash)).toEqual(initial.manifest);
    expect(await database.getManifest(current.hash)).toEqual(current.manifest);
    expect(await database.getManifest(deleted.hash)).toBeUndefined();
    expect(await database.sweepManifests()).toEqual(retainedChunks);
    database.close();
  });

  test("retains transferred file history after deleting its source workspace", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 950);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const original = await verifiedManifest(3, 13);
    const current = await verifiedManifest(4, 14);
    const fileId = stableId(195);
    const createId = stableId(196);
    const writeId = stableId(197);
    await database.commitOperation({ operation: createDraft(createId, [file(fileId, "Transferred.txt", original)]), manifests: [original] });
    await commitWrite(database, writeDraft(writeId, fileId, current, 20), [current]);
    await database.commitOperation({ operation: transferDraft(stableId(198), [fileId]) });
    await database.deleteWorkspace(WORKSPACE);

    expect(await database.sweepManifests()).toEqual([original.manifest.chunks[0]!.hash, current.manifest.chunks[0]!.hash].sort());
    expect((await database.listFileVersions(DESTINATION, fileId)).map(({ operationId }) => operationId)).toEqual([writeId, createId]);
    database.close();
  });

  test("commits exact metadata, lifecycle, and setting projections through purge and reopen", async () => {
    const factory = new IDBFactory();
    let time = 900;
    const database = await workspaceDatabase(factory, () => time++);
    const manifest = await verifiedManifest(3, 15);
    const sourceId = stableId(200);
    const destinationId = stableId(201);
    const treeId = stableId(202);
    const fileId = stableId(203);
    const retainedTrashId = stableId(204);
    const createId = stableId(210);
    await database.commitOperation({ operation: createDraft(createId, [
      folder(sourceId, "Source"),
      folder(destinationId, "Destination"),
      folder(treeId, "Tree", sourceId),
      file(fileId, "Notes.txt", manifest, treeId),
      folder(retainedTrashId, "Later"),
    ]), manifests: [manifest] });
    const createdFile = (await database.getNode(fileId))!;

    const renameId = stableId(211);
    const rename = await database.commitOperation({ operation: { ...operationBase(renameId), kind: "rename", nodeId: fileId, name: "Renamed.txt", modifiedAt: 20 } });
    const renamedFile = (await database.getNode(fileId))!;
    expect(rename.inverse).toEqual({ kind: "rename", nodeId: fileId, name: "Notes.txt", modifiedAt: 10 });
    expect(renamedFile).toEqual({ ...createdFile, name: "Renamed.txt", modifiedAt: 20, fieldTuples: { ...createdFile.fieldTuples, name: { logicalTime: 901, operationId: renameId } } });

    const positionId = stableId(212);
    const position = await database.commitOperation({ operation: { ...operationBase(positionId), kind: "position", positions: [{ nodeId: fileId, position: { x: 9, y: 8 } }] } });
    const positionedFile = (await database.getNode(fileId))!;
    expect(position.inverse).toEqual({ kind: "position", positions: [{ nodeId: fileId, position: { x: 3, y: 4 } }] });
    expect(positionedFile).toEqual({ ...renamedFile, position: { x: 9, y: 8 }, fieldTuples: { ...renamedFile.fieldTuples, position: { logicalTime: 902, operationId: positionId } } });

    const treeBeforeMove = (await database.getNode(treeId))!;
    const moveId = stableId(213);
    const move = await database.commitOperation({ operation: { ...operationBase(moveId), kind: "move", nodeIds: [treeId], parentId: destinationId, modifiedAt: 30 } });
    expect(move.inverse).toEqual({ kind: "move", roots: [{ nodeId: treeId, parentId: sourceId, modifiedAt: 10 }] });
    expect(move.affectedIdentities).toEqual([
      `folder:${WORKSPACE}:${destinationId}`,
      `folder:${WORKSPACE}:${sourceId}`,
      `node:${WORKSPACE}:${treeId}`,
    ].sort());
    expect((await readStored(factory, await filesystemDatabaseName(ACCOUNT), "changes", [WORKSPACE, 4]) as { affectedIdentities: string[] }).affectedIdentities).toEqual(move.affectedIdentities);
    expect(await database.getNode(treeId)).toEqual({ ...treeBeforeMove, parentId: destinationId, modifiedAt: 30, fieldTuples: { ...treeBeforeMove.fieldTuples, parent: { logicalTime: 903, operationId: moveId } } });
    expect(await database.getNode(fileId)).toEqual(positionedFile);

    const trashId = stableId(214);
    const trash = await database.commitOperation({ operation: { ...operationBase(trashId), kind: "trash", nodeIds: [fileId, treeId], trashedAt: 40 } });
    expect(trash.inverse).toEqual({ kind: "trash", roots: [{ nodeId: treeId, parentId: destinationId }], nodeIds: [treeId, fileId].sort() });
    expect(trash.affectedIdentities).toEqual([
      `folder:${WORKSPACE}:${destinationId}`,
      `folder:${WORKSPACE}:root`,
      `node:${WORKSPACE}:${fileId}`,
      `node:${WORKSPACE}:${treeId}`,
      `trash:${WORKSPACE}`,
    ].sort());
    expect((await database.listTrash(WORKSPACE)).map(({ id }) => id)).toEqual([treeId]);
    expect((await database.getNode(treeId))?.parentId).toBeNull();
    expect((await database.getNode(fileId))?.parentId).toBe(treeId);
    expect((await database.getNode(fileId))?.fieldTuples).toEqual({ ...positionedFile.fieldTuples, lifecycle: { logicalTime: 904, operationId: trashId } });
    expect((await database.getNode(fileId) as Extract<Awaited<ReturnType<FilesystemDatabase["getNode"]>>, { kind: "file" }>).manifestHash).toBe(manifest.hash);

    const restoreId = stableId(215);
    const restore = await database.commitOperation({ operation: { ...operationBase(restoreId), kind: "restore", nodeIds: [treeId], destination: "original", modifiedAt: 50 } });
    expect(restore.inverse).toMatchObject({ kind: "restore", roots: [{ nodeId: treeId, parentId: null }] });
    expect(restore.inverse.kind === "restore" && restore.inverse.nodes.every(({ lifecycle }) => lifecycle.trashedAt === 40)).toBe(true);
    expect(restore.affectedIdentities).toEqual(trash.affectedIdentities);
    expect((await database.getNode(treeId))?.parentId).toBe(destinationId);
    expect((await database.getNode(fileId))?.lifecycle).toEqual({ kind: "active" });
    expect((await database.listFileVersions(WORKSPACE, fileId)).map(({ operationId, modifiedAt }) => ({ operationId, modifiedAt }))).toEqual([{ operationId: createId, modifiedAt: 10 }]);

    await database.commitOperation({ operation: { ...operationBase(stableId(216)), kind: "trash", nodeIds: [treeId], trashedAt: 60 } });
    const purgeId = stableId(217);
    const purge = await database.commitOperation({ operation: { ...operationBase(purgeId), kind: "purge", nodeIds: [treeId] } });
    expect(purge.inverse).toEqual({ kind: "purge", nodeIds: [treeId, fileId].sort(), reason: "Permanent purge cannot be undone." });
    expect(purge.affectedIdentities).toEqual([
      `folder:${WORKSPACE}:root`,
      `node:${WORKSPACE}:${fileId}`,
      `node:${WORKSPACE}:${treeId}`,
      `trash:${WORKSPACE}`,
    ].sort());
    expect(await database.getNode(treeId)).toBeUndefined();
    const treeTombstone = { workspaceId: WORKSPACE, id: treeId, purged: true as const, logicalTime: purge.operation.logicalTime, operationId: purgeId };
    const fileTombstone = { ...treeTombstone, id: fileId };
    expect(await database.getNodeRecord(treeId)).toEqual(treeTombstone);
    expect(await database.getNodeRecord(fileId)).toEqual(fileTombstone);
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "nodes", treeId)).toEqual(treeTombstone);
    await expect(database.listFileVersions(WORKSPACE, fileId)).rejects.toThrow("does not exist");
    const rawAfterPurge = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(rawAfterPurge.transaction("operations", "readwrite").objectStore("operations").delete(createId));
    const nodeStore = rawAfterPurge.transaction("nodes").objectStore("nodes");
    expect(await idbRequest(nodeStore.index("by-workspace-lifecycle").getAllKeys(IDBKeyRange.bound([WORKSPACE, "purged"], [WORKSPACE, "purged"])))).toEqual([]);
    rawAfterPurge.close();
    await expect(database.commitOperation({ operation: createDraft(stableId(218), [folder(treeId, "Reused")]) })).rejects.toThrow("already exists");

    const setNullId = stableId(219);
    const setNull = await database.commitOperation({ operation: { ...operationBase(setNullId), kind: "set", namespace: "editor", key: "theme", value: null } });
    expect(setNull.inverse).toEqual({ kind: "set", namespace: "editor", key: "theme", previous: { exists: false } });
    const setManyDraft = { ...operationBase(stableId(220)), kind: "set-many" as const, namespace: "editor" as const, settings: [{ key: "theme", value: { dark: true } }, { key: "font", value: null }] };
    const setMany = await database.commitOperation({ operation: setManyDraft });
    expect(setMany.inverse).toEqual({ kind: "set-many", namespace: "editor", settings: [{ key: "theme", previous: { exists: true, value: null } }, { key: "font", previous: { exists: false } }] });
    const revisionAfterSettings = (await database.listWorkspaces())[0]!.localRevision;
    expect(await database.commitOperation({ operation: setManyDraft })).toEqual(setMany);
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revisionAfterSettings);
    expect((await database.listSettings(WORKSPACE, "editor")).map(({ key, value, logicalTime, operationId }) => ({ key, value, logicalTime, operationId }))).toEqual([
      { key: "font", value: null, logicalTime: setMany.operation.logicalTime, operationId: setMany.operationId },
      { key: "theme", value: { dark: true }, logicalTime: setMany.operation.logicalTime, operationId: setMany.operationId },
    ]);
    expect((await database.getSetting(WORKSPACE, "editor", "font"))?.value).toBeNull();
    expect(await database.getSetting(WORKSPACE, "editor", "absent")).toBeUndefined();
    const unset = await database.commitOperation({ operation: { ...operationBase(stableId(2_220)), kind: "unset", namespace: "editor", key: "theme" } });
    expect(unset.inverse).toEqual({ kind: "unset", namespace: "editor", key: "theme", previous: { exists: true, value: { dark: true } } });
    expect(await database.getSetting(WORKSPACE, "editor", "theme")).toBeUndefined();
    expect(await readStored(factory, await filesystemDatabaseName(ACCOUNT), "settings", [WORKSPACE, "editor", "theme"])).toEqual({ workspaceId: WORKSPACE, namespace: "editor", key: "theme", deleted: true, logicalTime: unset.operation.logicalTime, operationId: unset.operationId });
    const reset = await database.commitOperation({ operation: { ...operationBase(stableId(2_221)), kind: "set", namespace: "editor", key: "theme", value: { dark: false } } });
    expect(reset.inverse).toEqual({ kind: "set", namespace: "editor", key: "theme", previous: { exists: false } });
    const unsetMany = await database.commitOperation({ operation: { ...operationBase(stableId(2_222)), kind: "unset-many", namespace: "editor", keys: ["font", "theme"] } });
    expect(unsetMany.inverse).toEqual({ kind: "unset-many", namespace: "editor", settings: [{ key: "font", previous: { exists: true, value: null } }, { key: "theme", previous: { exists: true, value: { dark: false } } }] });
    expect(await database.listSettings(WORKSPACE, "editor")).toEqual([]);
    expect((await database.listSettingRecords(WORKSPACE, "editor")).map(({ key, deleted }) => ({ key, deleted }))).toEqual([{ key: "font", deleted: true }, { key: "theme", deleted: true }]);
    expect(await database.sweepManifests()).toEqual([]);

    await database.commitOperation({ operation: { ...operationBase(stableId(221)), kind: "trash", nodeIds: [retainedTrashId], trashedAt: 70 } });
    const beforeReopen = { active: await database.listChildren(WORKSPACE, null), trash: await database.listTrash(WORKSPACE), settings: await database.listSettings(WORKSPACE, "editor"), operations: await database.listOperations(WORKSPACE) };
    database.close();
    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect({ active: await reopened.listChildren(WORKSPACE, null), trash: await reopened.listTrash(WORKSPACE), settings: await reopened.listSettings(WORKSPACE, "editor"), operations: await reopened.listOperations(WORKSPACE) }).toEqual(beforeReopen);
    expect(await reopened.getNode(treeId)).toBeUndefined();
    expect(await reopened.getNodeRecord(treeId)).toEqual(treeTombstone);
    reopened.close();
  });

  test("rejects metadata collisions, invalid destinations, depth overflow, and partial batches atomically", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_000);
    const manifest = await verifiedManifest(1, 1);
    const firstId = stableId(230);
    const secondId = stableId(231);
    const destinationId = stableId(232);
    const childId = stableId(233);
    const destinationFileId = stableId(234);
    await database.commitOperation({ operation: createDraft(stableId(235), [
      folder(firstId, "First"), folder(secondId, "Second"), folder(destinationId, "Destination"), folder(childId, "Child", firstId), file(destinationFileId, "File.txt", manifest), folder(stableId(236), "FIRST", destinationId),
    ]), manifests: [manifest] });
    const beforeFirst = await database.getNode(firstId);
    const beforeSecond = await database.getNode(secondId);

    await expect(database.commitOperation({ operation: { ...operationBase(stableId(237)), kind: "rename", nodeId: secondId, name: "first", modifiedAt: 20 } })).rejects.toThrow("sibling");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(238)), kind: "move", nodeIds: [firstId, secondId], parentId: destinationId, modifiedAt: 21 } })).rejects.toThrow("sibling");
    expect(await database.getNode(firstId)).toEqual(beforeFirst);
    expect(await database.getNode(secondId)).toEqual(beforeSecond);
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(239)), kind: "move", nodeIds: [firstId], parentId: stableId(999), modifiedAt: 22 } })).rejects.toThrow("does not exist");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(240)), kind: "move", nodeIds: [firstId], parentId: destinationFileId, modifiedAt: 22 } })).rejects.toThrow("active folder");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(241)), kind: "move", nodeIds: [firstId], parentId: childId, modifiedAt: 22 } })).rejects.toThrow("descendant");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(242)), kind: "move", nodeIds: [firstId, childId], parentId: null, modifiedAt: 22 } })).rejects.toThrow("overlap");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(246)), kind: "rename", nodeId: secondId, name: "Changed", modifiedAt: 22 }, intent: "undo", compensatesOperationId: stableId(235) } as never)).rejects.toThrow("unsupported");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(247)), kind: "copy", sourceNodeIds: [firstId], nodes: [folder(stableId(248), "Copy")] } })).rejects.toThrow("complete source forest");
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(243)), kind: "position", positions: [{ nodeId: firstId, position: { x: 100, y: 100 } }, { nodeId: stableId(998), position: { x: 0, y: 0 } }] } })).rejects.toThrow("active nodes");
    expect(await database.getNode(firstId)).toEqual(beforeFirst);
    await database.commitOperation({ operation: { ...operationBase(stableId(244)), kind: "set", namespace: "editor", key: "safe", value: true } });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(245)), kind: "set-many", namespace: "editor", settings: [{ key: "safe", value: false }, { key: "safe", value: null }] } } as never)).rejects.toThrow("duplicate keys");
    expect((await database.getSetting(WORKSPACE, "editor", "safe"))?.value).toBe(true);

    const tooDeep = Array.from({ length: 66 }, (_, index) => folder(stableId(400 + index), `Too deep ${index}`, index === 0 ? null : stableId(399 + index)));
    await expect(database.commitOperation({ operation: createDraft(stableId(466), tooDeep) })).rejects.toThrow("too deep");
    expect(await database.getNode(stableId(400))).toBeUndefined();
    const overflowParentId = stableId(367);
    const overflowChildId = stableId(368);
    await database.commitOperation({ operation: createDraft(stableId(369), [folder(overflowParentId, "Overflow parent"), folder(overflowChildId, "Overflow child", overflowParentId)]) });
    await database.commitOperation({ operation: { ...operationBase(stableId(500)), kind: "trash", nodeIds: [overflowChildId], trashedAt: 1 } });
    const chain = Array.from({ length: 65 }, (_, index) => folder(stableId(300 + index), `Depth ${index}`, index === 0 ? null : stableId(299 + index)));
    await database.commitOperation({ operation: createDraft(stableId(365), chain) });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(366)), kind: "move", nodeIds: [secondId], parentId: stableId(364), modifiedAt: 23 } })).rejects.toThrow("too deep");
    await database.commitOperation({ operation: { ...operationBase(stableId(501)), kind: "move", nodeIds: [overflowParentId], parentId: stableId(363), modifiedAt: 24 } });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(502)), kind: "restore", nodeIds: [overflowChildId], destination: "original", modifiedAt: 25 } })).rejects.toThrow("too deep");
    expect(await database.getNode(secondId)).toEqual(beforeSecond);
    database.close();
  });

  test("rejects malformed, unavailable, overlapping, colliding, and too-deep copy snapshots atomically", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_025);
    const manifest = await verifiedManifest(2, 13);
    const sourceRootId = stableId(520);
    const sourceFileId = stableId(521);
    const destinationId = stableId(522);
    const collisionId = stableId(523);
    const trashedId = stableId(524);
    const sourceRoot = folder(sourceRootId, "Source");
    const sourceFile = file(sourceFileId, "File.txt", manifest, sourceRootId);
    await database.commitOperation({ operation: createDraft(stableId(525), [sourceRoot, sourceFile, folder(destinationId, "Destination"), folder(collisionId, "Taken", destinationId), folder(trashedId, "Trashed")]), manifests: [manifest] });
    await database.commitOperation({ operation: { ...operationBase(stableId(526)), kind: "trash", nodeIds: [trashedId], trashedAt: 1 } });
    const otherWorkspace = stableId(527);
    const otherRoot = stableId(528);
    await database.createWorkspace({ id: otherWorkspace, name: "Other", pinned: false, deviceId: DEVICE });
    await database.commitOperation({ operation: createDraft(stableId(529), [folder(otherRoot, "Other source")], otherWorkspace) });
    const chain = Array.from({ length: 65 }, (_, index) => folder(stableId(600 + index), `Copy depth ${index}`, index === 0 ? null : stableId(599 + index)));
    await database.commitOperation({ operation: createDraft(stableId(665), chain) });
    const revision = (await database.listWorkspaces())[0]!.localRevision;
    const snapshot = (rootId: string, fileId: string, name = "Source copy") => [
      { ...sourceRoot, id: rootId, name, parentId: destinationId, createdAt: 88, modifiedAt: 88 },
      { ...sourceFile, id: fileId, parentId: rootId, createdAt: 88, modifiedAt: 88 },
    ];

    await expect(database.commitOperation({ operation: copyDraft(stableId(530), [sourceRootId], snapshot(stableId(531), stableId(532)).slice(0, 1)) })).rejects.toThrow("complete source forest");
    await expect(database.commitOperation({ operation: copyDraft(stableId(533), [sourceRootId], [
      snapshot(stableId(534), stableId(535))[0]!,
      { ...folder(stableId(535), "Invented", stableId(534)), createdAt: 88, modifiedAt: 88 },
    ]) })).rejects.toThrow("source snapshot");
    const changed = snapshot(stableId(536), stableId(537));
    changed[1] = { ...changed[1]!, position: { x: 999, y: 4 } };
    await expect(database.commitOperation({ operation: copyDraft(stableId(538), [sourceRootId], changed) })).rejects.toThrow("source snapshot");
    await expect(database.commitOperation({ operation: copyDraft(stableId(539), [stableId(999)], [{ ...folder(stableId(540), "Missing"), createdAt: 88, modifiedAt: 88 }]) })).rejects.toThrow("active source roots");
    await expect(database.commitOperation({ operation: copyDraft(stableId(541), [trashedId], [{ ...folder(stableId(542), "Trashed copy"), parentId: destinationId, createdAt: 88, modifiedAt: 88 }]) })).rejects.toThrow("active source roots");
    await expect(database.commitOperation({ operation: copyDraft(stableId(543), [otherRoot], [{ ...folder(stableId(544), "Cross-workspace"), parentId: destinationId, createdAt: 88, modifiedAt: 88 }]) })).rejects.toThrow("active source roots");
    await expect(database.commitOperation({ operation: copyDraft(stableId(545), [sourceRootId, sourceFileId], [
      ...snapshot(stableId(546), stableId(547)),
      { ...sourceFile, id: stableId(548), name: "File root copy.txt", parentId: destinationId, createdAt: 88, modifiedAt: 88 },
    ]) })).rejects.toThrow("overlap");
    await expect(database.commitOperation({ operation: copyDraft(stableId(549), [sourceRootId], snapshot(stableId(550), stableId(551), "taken")) })).rejects.toThrow("sibling");
    const tooDeep = snapshot(stableId(552), stableId(553));
    tooDeep[0] = { ...tooDeep[0]!, parentId: stableId(664) };
    await expect(database.commitOperation({ operation: copyDraft(stableId(554), [sourceRootId], tooDeep) })).rejects.toThrow("too deep");

    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revision);
    expect(await database.getNode(stableId(531))).toBeUndefined();
    expect(await database.getOperation(stableId(554))).toBeUndefined();
    database.close();
  });

  test("rejects invalid transfer roots, destinations, devices, depth, and 257-node subtrees atomically", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 5_000);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const mismatchedDestination = stableId(1_600);
    const otherDevice = stableId(1_601);
    await database.createWorkspace({ id: mismatchedDestination, name: "Other device", pinned: false, deviceId: otherDevice });
    const manifest = await verifiedManifest(1, 4);
    const rootId = stableId(1_602);
    const childId = stableId(1_603);
    const trashedSourceId = stableId(1_604);
    await database.commitOperation({ operation: createDraft(stableId(1_605), [folder(rootId, "Root"), folder(childId, "Child", rootId), folder(trashedSourceId, "Trashed source")]) });
    await database.commitOperation({ operation: { ...operationBase(stableId(1_606)), kind: "trash", nodeIds: [trashedSourceId], trashedAt: 1 } });

    const destinationParentId = stableId(1_607);
    const destinationFileId = stableId(1_608);
    const trashedDestinationId = stableId(1_609);
    const foreignRootId = stableId(1_610);
    await database.commitOperation({ operation: createDraft(stableId(1_611), [
      folder(destinationParentId, "Destination parent"),
      file(destinationFileId, "Destination file.txt", manifest),
      folder(trashedDestinationId, "Trashed destination"),
      folder(foreignRootId, "Foreign root"),
      folder(stableId(1_612), "ROOT", destinationParentId),
    ], DESTINATION), manifests: [manifest] });
    await database.commitOperation({ operation: { schemaVersion: 1, kind: "trash", operationId: stableId(1_613), workspaceId: DESTINATION, deviceId: DEVICE, nodeIds: [trashedDestinationId], trashedAt: 1 } });

    const depthChain = Array.from({ length: 65 }, (_, index) => folder(stableId(1_620 + index), `Destination depth ${index}`, index === 0 ? null : stableId(1_619 + index)));
    await database.commitOperation({ operation: createDraft(stableId(1_685), depthChain, DESTINATION) });
    const largeRootId = stableId(1_700);
    await database.commitOperation({ operation: createDraft(stableId(1_957), [folder(largeRootId, "Large"), ...Array.from({ length: 255 }, (_, index) => folder(stableId(1_701 + index), `Large child ${index}`, largeRootId))]) });
    await database.commitOperation({ operation: createDraft(stableId(1_958), [folder(stableId(1_959), "Overflow", largeRootId)]) });
    const before = {
      workspaces: await database.listWorkspaces(),
      source: await database.getNode(rootId),
      destination: await database.getNode(destinationParentId),
      operations: await readStored(factory, await filesystemDatabaseName(ACCOUNT), "operations"),
      changes: await readStored(factory, await filesystemDatabaseName(ACCOUNT), "changes"),
    };
    let operationId = 2_000;
    const rejects = (operation: Extract<WorkspaceOperationDraft, { kind: "transfer" }>, message: string) => expect(database.commitOperation({ operation })).rejects.toThrow(message);

    await rejects(transferDraft(stableId(operationId++), [stableId(9_999)]), "active source roots");
    await rejects(transferDraft(stableId(operationId++), [trashedSourceId]), "active source roots");
    await rejects(transferDraft(stableId(operationId++), [foreignRootId]), "active source roots");
    await rejects(transferDraft(stableId(operationId++), [rootId, childId]), "overlap");
    await rejects(transferDraft(stableId(operationId++), [rootId], DESTINATION, stableId(9_998)), "active folder");
    await rejects(transferDraft(stableId(operationId++), [rootId], DESTINATION, destinationFileId), "active folder");
    await rejects(transferDraft(stableId(operationId++), [rootId], DESTINATION, trashedDestinationId), "active folder");
    await rejects(transferDraft(stableId(operationId++), [rootId], DESTINATION, childId), "active folder");
    await rejects(transferDraft(stableId(operationId++), [rootId], DESTINATION, destinationParentId), "sibling");
    await rejects(transferDraft(stableId(operationId++), [rootId], DESTINATION, depthChain.at(-1)!.id), "too deep");
    await rejects(transferDraft(stableId(operationId++), [rootId], DESTINATION, null, otherDevice), "does not own this local workspace");
    await rejects(transferDraft(stableId(operationId++), [rootId], mismatchedDestination), "does not own the transfer destination");
    await rejects(transferDraft(stableId(operationId++), [largeRootId]), "too large");

    expect({
      workspaces: await database.listWorkspaces(),
      source: await database.getNode(rootId),
      destination: await database.getNode(destinationParentId),
      operations: await readStored(factory, await filesystemDatabaseName(ACCOUNT), "operations"),
      changes: await readStored(factory, await filesystemDatabaseName(ACCOUNT), "changes"),
    }).toEqual(before);
    database.close();
  });

  test("rolls back transfer nodes, both workspace clocks and revisions, changes, and history when operation storage fails", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 5_500);
    await database.createWorkspace({ id: DESTINATION, name: "Destination", pinned: false, deviceId: DEVICE });
    const manifest = await verifiedManifest(2, 5);
    const rootId = stableId(2_100);
    const fileId = stableId(2_101);
    await database.commitOperation({ operation: createDraft(stableId(2_102), [folder(rootId, "Tree"), file(fileId, "File.txt", manifest, rootId)]), manifests: [manifest] });
    const databaseName = await filesystemDatabaseName(ACCOUNT);
    const before = {
      root: await database.getNode(rootId),
      file: await database.getNode(fileId),
      workspaces: await database.listWorkspaces(),
      sourceSync: await database.getSyncState(WORKSPACE),
      destinationSync: await database.getSyncState(DESTINATION),
      changes: await readStored(factory, databaseName, "changes"),
      operations: await readStored(factory, databaseName, "operations"),
      versions: await database.listFileVersions(WORKSPACE, fileId),
      chunks: await database.sweepManifests(),
    };
    const operationId = stableId(2_103);
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "operations" && (value as { operationId?: unknown }).operationId === operationId) throw new DOMException("Injected transfer failure", "AbortError");
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    try {
      await expect(database.commitOperation({ operation: transferDraft(operationId, [rootId]) })).rejects.toThrow("Injected transfer failure");
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    expect({
      root: await database.getNode(rootId),
      file: await database.getNode(fileId),
      workspaces: await database.listWorkspaces(),
      sourceSync: await database.getSyncState(WORKSPACE),
      destinationSync: await database.getSyncState(DESTINATION),
      changes: await readStored(factory, databaseName, "changes"),
      operations: await readStored(factory, databaseName, "operations"),
      versions: await database.listFileVersions(WORKSPACE, fileId),
      chunks: await database.sweepManifests(),
    }).toEqual(before);
    expect(await database.getOperation(operationId)).toBeUndefined();
    expect(await database.listChildren(DESTINATION, null)).toEqual([]);
    database.close();
  });

  test("bounds authoritative copy expansion at 256 nodes before projection", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const rootId = stableId(700);
    const firstBatch = [folder(rootId, "Large source"), ...Array.from({ length: 255 }, (_, index) => folder(stableId(701 + index), `Child ${index}`, rootId))];
    await database.commitOperation({ operation: createDraft(stableId(956), firstBatch) });
    await database.commitOperation({ operation: createDraft(stableId(957), [folder(stableId(958), "Overflow child", rootId)]) });
    const revision = (await database.listWorkspaces())[0]!.localRevision;
    await expect(database.commitOperation({ operation: copyDraft(stableId(959), [rootId], [{ ...folder(stableId(960), "Large copy"), createdAt: 20, modifiedAt: 20 }]) })).rejects.toThrow("too large");
    const oversized = Array.from({ length: 257 }, (_, index) => ({ ...folder(stableId(1_000 + index), `Copy ${index}`), createdAt: 20, modifiedAt: 20 }));
    await expect(database.commitOperation({ operation: copyDraft(stableId(1_300), [rootId], oversized) })).rejects.toThrow("batch");
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revision);
    expect(await database.getNode(stableId(960))).toBeUndefined();
    database.close();
  });

  test("rolls back copy projection and rejects malformed retained copy identities", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_040);
    const manifest = await verifiedManifest(1, 14);
    const sourceId = stableId(1_400);
    const sourceFileId = stableId(1_401);
    const source = folder(sourceId, "Source");
    const sourceFile = file(sourceFileId, "File.txt", manifest, sourceId);
    await database.commitOperation({ operation: createDraft(stableId(1_402), [source, sourceFile]), manifests: [manifest] });
    const copiedId = stableId(1_403);
    const copiedFileId = stableId(1_404);
    const operationId = stableId(1_405);
    const operation = copyDraft(operationId, [sourceId], [
      { ...source, id: copiedId, name: "Copy", createdAt: 30, modifiedAt: 30 },
      { ...sourceFile, id: copiedFileId, parentId: copiedId, createdAt: 30, modifiedAt: 30 },
    ]);
    const revision = (await database.listWorkspaces())[0]!.localRevision;
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "operations" && (value as { operationId?: unknown }).operationId === operationId) throw new DOMException("Injected copy failure", "AbortError");
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    try {
      await expect(database.commitOperation({ operation })).rejects.toThrow("Injected copy failure");
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    expect(await database.getNode(copiedId)).toBeUndefined();
    expect(await database.getNode(copiedFileId)).toBeUndefined();
    expect(await database.getOperation(operationId)).toBeUndefined();
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revision);

    const committed = await database.commitOperation({ operation: { ...operation, operationId: stableId(1_406) } });
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(raw.transaction("operations", "readwrite").objectStore("operations").put({ ...committed, affectedIdentities: committed.affectedIdentities.map((identity) => identity === `content:${WORKSPACE}:${sourceFileId}` ? `content:${WORKSPACE}:${stableId(9_999)}` : identity).sort() }));
    raw.close();
    await expect(database.getOperation(committed.operationId)).rejects.toThrow("derived metadata");
    database.close();
  });

  test("rolls back projected metadata when a later transaction write fails", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_050);
    const nodeId = stableId(367);
    const operationId = stableId(368);
    await database.commitOperation({ operation: createDraft(stableId(369), [folder(nodeId, "Original")]) });
    const before = await database.getNode(nodeId);
    const revision = (await database.listWorkspaces())[0]!.localRevision;
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === "operations" && (value as { operationId?: unknown }).operationId === operationId) throw new DOMException("Injected failure", "AbortError");
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    };
    try {
      await expect(database.commitOperation({ operation: { ...operationBase(operationId), kind: "rename", nodeId, name: "Changed", modifiedAt: 20 } })).rejects.toThrow("Injected failure");
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    expect(await database.getNode(nodeId)).toEqual(before);
    expect(await database.getOperation(operationId)).toBeUndefined();
    expect((await database.listWorkspaces())[0]!.localRevision).toBe(revision);
    database.close();
  });

  test("requires valid restore destinations and supports an atomic root fallback after collisions clear", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 1_100);
    const parentId = stableId(370);
    const childId = stableId(371);
    const conflictId = stableId(372);
    const nestedConflictId = stableId(385);
    await database.commitOperation({ operation: createDraft(stableId(373), [folder(parentId, "Parent"), folder(childId, "Child", parentId)]) });
    await database.commitOperation({ operation: { ...operationBase(stableId(374)), kind: "trash", nodeIds: [childId], trashedAt: 1 } });
    await database.commitOperation({ operation: createDraft(stableId(386), [folder(nestedConflictId, "child", parentId)]) });
    await database.commitOperation({ operation: { ...operationBase(stableId(375)), kind: "trash", nodeIds: [parentId], trashedAt: 2 } });
    expect((await database.listTrash(WORKSPACE)).map(({ id }) => id)).toEqual([parentId, childId]);
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(376)), kind: "restore", nodeIds: [parentId, childId], destination: "original", modifiedAt: 3 } })).rejects.toThrow("sibling");
    await database.commitOperation({ operation: { ...operationBase(stableId(390)), kind: "restore", nodeIds: [parentId], destination: "original", modifiedAt: 4 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(391)), kind: "rename", nodeId: nestedConflictId, name: "Other", modifiedAt: 5 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(392)), kind: "trash", nodeIds: [parentId], trashedAt: 6 } });
    const coRestore = await database.commitOperation({ operation: { ...operationBase(stableId(393)), kind: "restore", nodeIds: [parentId, childId], destination: "original", modifiedAt: 7 } });
    expect(coRestore.inverse).toMatchObject({ kind: "restore", roots: [{ nodeId: parentId, parentId: null, modifiedAt: 4 }, { nodeId: childId, parentId: null, modifiedAt: 10 }] });
    expect(await database.getNode(parentId)).toMatchObject({ parentId: null, modifiedAt: 7, lifecycle: { kind: "active" } });
    expect(await database.getNode(childId)).toMatchObject({ parentId, modifiedAt: 7, lifecycle: { kind: "active" } });
    await database.commitOperation({ operation: { ...operationBase(stableId(377)), kind: "trash", nodeIds: [childId], trashedAt: 8 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(378)), kind: "trash", nodeIds: [parentId], trashedAt: 9 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(379)), kind: "purge", nodeIds: [parentId] } });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(380)), kind: "restore", nodeIds: [childId], destination: "original", modifiedAt: 10 } })).rejects.toThrow("original parent");

    await database.commitOperation({ operation: createDraft(stableId(381), [folder(conflictId, "child")]) });
    await expect(database.commitOperation({ operation: { ...operationBase(stableId(382)), kind: "restore", nodeIds: [childId], destination: "root", modifiedAt: 11 } })).rejects.toThrow("sibling");
    expect((await database.listTrash(WORKSPACE)).map(({ id }) => id)).toEqual([childId]);
    await database.commitOperation({ operation: { ...operationBase(stableId(383)), kind: "trash", nodeIds: [conflictId], trashedAt: 12 } });
    await database.commitOperation({ operation: { ...operationBase(stableId(384)), kind: "restore", nodeIds: [childId], destination: "root", modifiedAt: 13 } });
    expect(await database.getNode(childId)).toMatchObject({ parentId: null, lifecycle: { kind: "active" } });
    expect((await database.listTrash(WORKSPACE)).map(({ id }) => id)).toEqual([conflictId]);
    database.close();
  });

  test("closes and reopens an identical projection and history", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory, () => 800);
    const manifest = await verifiedManifest(2, 14);
    const nodeId = stableId(130);
    await database.commitOperation({ operation: createDraft(stableId(131), [file(nodeId, "Reload.txt", manifest)]), manifests: [manifest] });
    const before = {
      workspaces: await database.listWorkspaces(),
      node: await database.getNode(nodeId),
      operations: await database.listOperations(WORKSPACE),
      versions: await database.listFileVersions(WORKSPACE, nodeId),
    };
    database.close();

    const reopened = await openFilesystemDatabase(ACCOUNT, environment(factory));
    expect({
      workspaces: await reopened.listWorkspaces(),
      node: await reopened.getNode(nodeId),
      operations: await reopened.listOperations(WORKSPACE),
      versions: await reopened.listFileVersions(WORKSPACE, nodeId),
    }).toEqual(before);
    reopened.close();
  });

  test("rejects malformed stored nodes and inverse metadata instead of projecting them", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const malformedId = stableId(140);
    const operationId = stableId(141);
    const stored = await database.commitOperation({ operation: createDraft(operationId, [folder(stableId(142), "Valid")]) });
    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    const transaction = raw.transaction(["nodes", "operations"], "readwrite");
    await Promise.all([
      idbRequest(transaction.objectStore("nodes").put({ id: malformedId, parentKey: "", lifecycleKey: "active" })),
      idbRequest(transaction.objectStore("operations").put({ ...stored, inverse: { ...stored.inverse, unexpected: true } })),
    ]);
    raw.close();
    await expect(database.getNode(malformedId)).rejects.toThrow("unsupported shape");
    await expect(database.getOperation(operationId)).rejects.toThrow("unsupported shape");
    database.close();
  });

  test("sweeps manifests and rejects noncanonical retained records", async () => {
    const factory = new IDBFactory();
    const database = await workspaceDatabase(factory);
    const first = await verifiedManifest(1, 1);
    const second = await verifiedManifest(2, 2);
    const firstNodeId = stableId(161);
    const operation = createDraft(stableId(160), [file(firstNodeId, "First.txt", first), file(stableId(162), "Second.txt", second)]);
    const committed = await database.commitOperation({ operation, manifests: [first, second] });
    expect(await database.sweepManifests()).toEqual(["1".repeat(64), "2".repeat(64)]);

    const raw = await openRaw(factory, await filesystemDatabaseName(ACCOUNT));
    await idbRequest(raw.transaction("manifests", "readwrite").objectStore("manifests").put({ hash: first.hash, manifest: { ...first.manifest, chunks: [{ hash: "3".repeat(64), size: 1 }] } }));
    raw.close();
    expect(await database.commitOperation({ operation })).toEqual(committed);
    await expect(database.getManifest(first.hash)).rejects.toThrow("canonical bytes");
    await expect(database.listFileVersions(WORKSPACE, firstNodeId)).rejects.toThrow("canonical bytes");
    await expect(database.commitOperation({ operation: writeDraft(stableId(164), firstNodeId, first, 20), expectedContentTuple: (await database.getNode(firstNodeId))!.fieldTuples.content })).rejects.toThrow("canonical bytes");
    await expect(database.sweepManifests()).rejects.toThrow("canonical bytes");
    database.close();
  });

  test("rejects a malformed same-name database without resetting it", async () => {
    const factory = new IDBFactory();
    const name = await filesystemDatabaseName(ACCOUNT);
    const malformed = await openRaw(factory, name, 1, (database) => database.createObjectStore("sentinel"));
    await idbRequest(malformed.transaction("sentinel", "readwrite").objectStore("sentinel").put("preserved", "value"));
    malformed.close();

    await expect(openFilesystemDatabase(ACCOUNT, environment(factory))).rejects.toThrow("schema is malformed");
    const preserved = await openRaw(factory, name);
    try {
      expect(preserved.version).toBe(1);
      expect([...preserved.objectStoreNames]).toEqual(["sentinel"]);
      expect(await idbRequest(preserved.transaction("sentinel").objectStore("sentinel").get("value"))).toBe("preserved");
    } finally {
      preserved.close();
    }
  });
});

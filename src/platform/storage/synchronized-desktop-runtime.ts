import { getAccountOpfsRoot, readChunk, writeChunk } from "../../filesystem/chunks";
import { openFilesystemDatabase, type FilesystemDatabase, type Workspace } from "../../filesystem/database";
import { WEB2_MAX_BATCH_ITEMS, sha256Hex } from "../../filesystem/model";
import { createHydrationCoordinator } from "../../sync/hydration";
import { openAccountSyncClient, type AccountSyncClient } from "../../sync/engine";
import { createWeb2SyncRuntime, type Web2SyncRuntime } from "../../sync/runtime";
import {
  Web2HTTPError,
  Web2NetworkError,
  createWeb2Workspace,
  deleteWeb2Workspace,
  downloadWeb2Chunk,
  fetchWeb2Activity,
  fetchWeb2Session,
  fetchWeb2Thumbnail,
  negotiateWeb2ChunkDownload,
  renameWeb2Workspace,
  setWeb2WorkspacePreferences,
} from "../../sync/transport";
import type { DesktopCapabilities, DesktopIdentity } from "../../types";
import { lockAuthBootstrap, redirectToLogin } from "../../lib/auth";
import { configureAccountStorage } from "./account-storage";
import { openHydrationStorage, type HydrationStorage } from "./hydration-storage";
import { ProjectedDesktopRuntime } from "./local-desktop-runtime";
import type { LocalWeb2Startup } from "./local-startup";
import type { DesktopRegistry, SyncStatus } from "./runtime-types";
import { synchronizedSession } from "./synchronized-session";
import { openWorkspaceCatalog } from "./workspace-catalog";

const roleCapabilities: Record<DesktopIdentity["role"], DesktopCapabilities> = {
  owner: { read: true, write: true, manage: true, delete: true, settings: true, activity: true },
  manager: { read: true, write: true, manage: true, delete: false, settings: true, activity: true },
  writer: { read: true, write: true, manage: false, delete: false, settings: false, activity: true },
  reader: { read: true, write: false, manage: false, delete: false, settings: false, activity: false },
};

let status: SyncStatus = navigator.onLine ? "connecting" : "offline";
const statusListeners = new Set<(next: SyncStatus) => void>();
const workspaceRoles = new Map<string, DesktopIdentity["role"]>();
let syncRuntime: Web2SyncRuntime | undefined;
let syncClient: AccountSyncClient | undefined;
let hydrationStorage: HydrationStorage | undefined;
let syncDatabase: FilesystemDatabase | undefined;
let opfsRoot: FileSystemDirectoryHandle | undefined;
let startupPromise: Promise<LocalWeb2Startup> | undefined;
let startupValue: LocalWeb2Startup | undefined;

function setStatus(next: SyncStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((listener) => listener(next));
}

function authenticationFailure(error: unknown) {
  if (!(error instanceof Web2HTTPError) || error.status !== 401) return false;
  lockAuthBootstrap();
  redirectToLogin();
  return true;
}

function identity(workspace: Workspace, accountId: string, user: { id: string; displayName: string }): DesktopIdentity {
  const role = workspaceRoles.get(workspace.id) ?? "owner";
  return {
    id: workspace.id,
    name: workspace.name,
    pinned: workspace.pinned,
    ownership: role === "owner" ? "owned" : "shared",
    role,
    owner: role === "owner" ? { ...user, avatar: null } : { id: workspace.id, displayName: "Workspace owner", avatar: null },
    capabilities: { ...roleCapabilities[role] },
    authorityCatalogId: accountId,
  };
}

async function reconcileDirectory() {
  if (!startupValue || !syncRuntime) return;
  const selected = synchronizedSession();
  const fresh = await fetchWeb2Session();
  const account = fresh.accounts.find(({ id }) => id === selected.accountId);
  if (!account) { window.location.reload(); return; }
  account.workspaces.forEach(({ id, role }) => workspaceRoles.set(id, role));
  const remoteIds = new Set(account.workspaces.map(({ id }) => id));
  const current = await startupValue.catalog.listWorkspaces();
  for (const workspace of account.workspaces) {
    const local = current.find(({ id }) => id === workspace.id);
    if (!local) await syncRuntime.bootstrap(workspace.id);
    else if (local.name !== workspace.name) await startupValue.catalog.renameWorkspace(workspace.id, workspace.name);
  }
  for (const workspace of current) if (!remoteIds.has(workspace.id)) {
    workspaceRoles.delete(workspace.id);
    await startupValue.catalog.deleteWorkspace(workspace.id);
  }
  const refreshed = await startupValue.catalog.listWorkspaces();
  if (refreshed.length === account.workspaces.length) await startupValue.catalog.setWorkspacePreferences(account.workspaces.map(({ id, pinned }) => ({ id, pinned })));
}

async function prepareManifest(workspaceId: string, manifestHash: string) {
  const session = synchronizedSession();
  const storedManifest = await syncDatabase!.getManifest(manifestHash);
  const haveChunks: string[] = [];
  if (storedManifest) {
    for (const chunk of storedManifest.chunks) {
      try { await readChunk(opfsRoot!, chunk); haveChunks.push(chunk.hash); } catch { /* The server returns descriptors for missing chunks. */ }
    }
    if (haveChunks.length === storedManifest.chunks.length) return;
  }
  const sync = await syncDatabase!.getSyncState(workspaceId);
  const result = await negotiateWeb2ChunkDownload({ schemaVersion: 1, protocol: "web2-sync-v1", kind: "chunk-download-request", workspaceId, deviceId: sync.deviceId, manifestHash, haveChunks }, session.directBlobOrigin);
  await syncDatabase!.storeManifest(result.manifestHash, result.manifest);
  for (const descriptor of result.chunks) await writeChunk(opfsRoot!, { hash: descriptor.hash, size: descriptor.size }, new Blob([await downloadWeb2Chunk(descriptor)]));
}

async function initialize(): Promise<LocalWeb2Startup> {
  const session = synchronizedSession();
  const { accountId, storageId } = configureAccountStorage(session.accountId, session.storageId);
  session.account.workspaces.forEach(({ id, role }) => workspaceRoles.set(id, role));
  const environment = { storageId };
  const database = syncDatabase = await openFilesystemDatabase(accountId, environment);
  opfsRoot = await getAccountOpfsRoot(storageId);
  hydrationStorage = await openHydrationStorage(accountId, environment);
  const hydration = createHydrationCoordinator(hydrationStorage);
  syncRuntime = createWeb2SyncRuntime({
    accountId,
    directBlobOrigin: session.directBlobOrigin,
    database,
    hydration,
    opfsRoot,
    directoryRevision: session.directoryRevision,
    onDirectoryChange: () => { void reconcileDirectory().catch((error) => { if (!authenticationFailure(error)) setStatus("error"); }); },
  });
  const existing = await database.listWorkspaces();
  const initialWorkspaceId = existing[0]?.id ?? session.account.workspaces[0]!.id;
  try {
    await syncRuntime.bootstrap(initialWorkspaceId);
    setStatus("online");
  } catch (error) {
    if (authenticationFailure(error)) throw error;
    if (existing.length === 0 || !(error instanceof Web2NetworkError)) throw error;
    setStatus("offline");
  }
  const deviceId = await database.getOrCreateDeviceId();
  const catalog = await openWorkspaceCatalog(accountId, deviceId, environment);
  const active = await catalog.resolveActiveWorkspace();
  syncClient = await openAccountSyncClient(storageId, {
    synchronize: async (signal) => {
      if (!navigator.onLine) { setStatus("offline"); return; }
      try {
        await syncRuntime!.callbacks.synchronize(signal);
        setStatus("online");
      } catch (error) {
        if (!authenticationFailure(error)) setStatus(error instanceof Web2NetworkError ? "offline" : "error");
        throw error;
      }
    },
    listen: syncRuntime.callbacks.listen,
    onError: (error) => {
      if (!authenticationFailure(error)) setStatus(error instanceof Web2NetworkError ? "offline" : "error");
    },
  });
  window.addEventListener("offline", () => setStatus("offline"));
  window.addEventListener("online", () => { setStatus("connecting"); syncClient?.wake(); });
  return startupValue = { accountId, storageId, deviceId, activeWorkspaceId: active.id, catalog };
}

function startup() {
  return startupPromise ??= initialize();
}

const session = synchronizedSession();
const registry = (workspaces: Workspace[], active: Workspace): DesktopRegistry => ({
  schemaVersion: 2,
  catalogId: session.accountId,
  catalogRevision: session.directoryRevision,
  desktops: workspaces.map((workspace) => identity(workspace, session.accountId, session.user)),
  activeDesktopId: active.id,
  quota: null,
});

const runtime = new ProjectedDesktopRuntime({
  initialize: startup,
  status: () => status,
  subscribeStatus: (listener) => { statusListeners.add(listener); return () => statusListeners.delete(listener); },
  registry,
  cleanupOrphans: false,
  prepareWorkspace: async (workspaceId) => {
    try { await syncRuntime!.bootstrap(workspaceId); setStatus("online"); }
    catch (error) { if (!authenticationFailure(error) && error instanceof Web2NetworkError) { setStatus("offline"); return; } throw error; }
  },
  hydrateFolder: async (workspaceId, folderId) => {
    const workspace = (await syncDatabase!.listWorkspaces()).find(({ id }) => id === workspaceId);
    if (!workspace) throw new Error("That workspace no longer exists.");
    await syncRuntime!.hydrate({ kind: "folder-page", workspaceId, parentId: folderId, asOf: workspace.headSequence, limit: WEB2_MAX_BATCH_ITEMS });
  },
  hydrateNode: async (workspaceId, nodeId) => {
    const workspace = (await syncDatabase!.listWorkspaces()).find(({ id }) => id === workspaceId);
    if (!workspace) throw new Error("That workspace no longer exists.");
    await syncRuntime!.hydrate({ kind: "ancestry", workspaceId, nodeId, asOf: workspace.headSequence, maxDepth: 64 });
  },
  prepareFile: async (workspaceId, fileId) => {
    const node = await syncDatabase!.getNode(fileId);
    if (!node || node.workspaceId !== workspaceId || node.kind !== "file") throw new Error("That file no longer exists.");
    await prepareManifest(workspaceId, node.manifestHash);
  },
  prepareVersion: prepareManifest,
  thumbnail: async (workspaceId, fileId) => {
    const node = await syncDatabase!.getNode(fileId);
    if (!node || node.workspaceId !== workspaceId || node.kind !== "file" || !node.fieldTuples.content) throw new Error("That image no longer exists.");
    let result = await fetchWeb2Thumbnail(workspaceId, fileId, node.fieldTuples.content.operationId, node.manifestHash, session.directBlobOrigin);
    for (let attempt = 0; result.state === "pending" && attempt < 4; attempt += 1) {
      const retryAfterMs = result.retryAfterMs;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      result = await fetchWeb2Thumbnail(workspaceId, fileId, node.fieldTuples.content!.operationId, node.manifestHash, session.directBlobOrigin);
    }
    if (result.state !== "ready") throw new Error("The thumbnail is still being generated.");
    const response = await fetch(result.value.access.url, { method: "GET", headers: result.value.access.headers, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`The thumbnail could not be downloaded (${response.status}).`);
    const blob = await response.blob();
    if (blob.size !== result.value.size || await sha256Hex(await blob.arrayBuffer()) !== result.value.sha256) throw new Error("The thumbnail failed integrity verification.");
    return { kind: "blob", blob };
  },
  createWorkspace: async (current, name) => {
    const id = crypto.randomUUID();
    await createWeb2Workspace(session.accountId, crypto.randomUUID(), { schemaVersion: 1, protocol: "web2-sync-v1", id, name });
    workspaceRoles.set(id, "owner");
    const workspace = await current.catalog.createWorkspace({ id, name });
    await syncRuntime!.bootstrap(id);
    syncClient?.wake();
    return workspace;
  },
  updateWorkspacePreferences: async (current, preferences) => {
    await setWeb2WorkspacePreferences(session.accountId, crypto.randomUUID(), { schemaVersion: 1, protocol: "web2-sync-v1", workspaces: preferences });
    await current.catalog.setWorkspacePreferences(preferences);
  },
  renameWorkspace: async (current, workspaceId, name) => {
    await renameWeb2Workspace(workspaceId, crypto.randomUUID(), { schemaVersion: 1, protocol: "web2-sync-v1", name });
    return current.catalog.renameWorkspace(workspaceId, name);
  },
  deleteWorkspace: async (current, workspaceId) => {
    await deleteWeb2Workspace(workspaceId, crypto.randomUUID());
    workspaceRoles.delete(workspaceId);
    await current.catalog.deleteWorkspace(workspaceId);
  },
  listActivity: async (query) => {
    const result = await fetchWeb2Activity({ before: query.before, limit: query.limit, workspaceId: query.desktopId, q: query.q });
    return {
      activities: result.activities.map((item) => ({ catalogRevision: item.id, desktopId: item.workspaceId, entryIds: item.nodeIds, action: item.kind, source: item.actor.displayName, timestamp: item.timestamp, summary: `${item.actor.displayName} ${item.kind.replaceAll("-", " ")}`, details: [`Workspace: ${item.workspaceName}`, `Operation: ${item.operationId}`] })),
      nextBefore: result.nextBefore,
    };
  },
  wake: () => syncClient?.wake(),
  serverBuildTimestamp: async () => (await fetchWeb2Session()).buildTimestamp,
});

export default runtime;

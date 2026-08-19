import {
  filesystemDatabaseName,
  openFilesystemDatabase,
  type FilesystemDatabaseEnvironment,
  type Workspace,
} from "../../filesystem/database";
import { WEB2_SCHEMA_VERSION, isRecord, parseStableId } from "../../filesystem/model";
import { moveDesktopPreference, pinDesktopPreference } from "../../lib/desktop-preferences";
import {
  filesystemRevisionChannelName,
  type FilesystemBroadcastChannel,
} from "./workspace-filesystem";

export type WorkspaceCatalogEnvironment = FilesystemDatabaseEnvironment & {
  locks?: Pick<LockManager, "request">;
  createBroadcastChannel?: (name: string) => FilesystemBroadcastChannel;
  sessionStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  randomUUID?: () => string;
};

export type WorkspaceCatalog = {
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(value: { id?: string; name: string; pinned?: boolean }): Promise<Workspace>;
  ensureInitialWorkspace(name?: string, pinned?: boolean): Promise<Workspace>;
  renameWorkspace(workspaceId: string, name: string): Promise<Workspace>;
  setWorkspacePreferences(preferences: Array<{ id: string; pinned: boolean }>): Promise<Workspace[]>;
  moveWorkspace(workspaceId: string, direction: -1 | 1): Promise<Workspace[]>;
  pinWorkspace(workspaceId: string, pinned: boolean): Promise<Workspace[]>;
  deleteWorkspace(workspaceId: string): Promise<Workspace[]>;
  resolveActiveWorkspace(): Promise<Workspace>;
  setActiveWorkspace(workspaceId: string): Promise<Workspace>;
  onChangesAvailable(listener: () => void): () => void;
  close(): void;
};

function isCatalogNotification(value: unknown) {
  return isRecord(value) && value.schemaVersion === WEB2_SCHEMA_VERSION && value.kind === "catalog-change" && (Object.keys(value).length === 2 || Object.keys(value).length === 3 && value.source === "remote");
}

export async function openWorkspaceCatalog(accountId: string, deviceId: string, environment: WorkspaceCatalogEnvironment): Promise<WorkspaceCatalog> {
  const canonicalDeviceId = parseStableId(deviceId, "A workspace device ID is invalid.");
  const database = await openFilesystemDatabase(accountId, environment);
  try {
    const databaseName = await filesystemDatabaseName(environment.storageId);
    const locks = environment.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
    const createBroadcastChannel = environment.createBroadcastChannel ?? (typeof BroadcastChannel === "undefined" ? undefined : (name: string) => new BroadcastChannel(name));
    const storage = environment.sessionStorage ?? (typeof sessionStorage === "undefined" ? undefined : sessionStorage);
    if (!locks || typeof locks.request !== "function" || typeof createBroadcastChannel !== "function" || !storage) throw new Error("Web Locks, BroadcastChannel, and sessionStorage are required for the workspace catalog.");
    const channel = createBroadcastChannel(filesystemRevisionChannelName(databaseName));
    const activeKey = `${databaseName}-active-workspace`;
    const randomUUID = environment.randomUUID ?? (() => crypto.randomUUID());
    const locked = <T>(operation: () => Promise<T>) => locks.request(`${databaseName}-storage`, { mode: "exclusive" }, () => locks.request(`${databaseName}-catalog`, { mode: "exclusive" }, operation));
    const notify = () => {
      try { channel.postMessage({ schemaVersion: WEB2_SCHEMA_VERSION, kind: "catalog-change" }); } catch { /* A later catalog read recovers a missed advisory wake-up. */ }
    };
    const readActiveId = () => {
      try {
        const value = storage.getItem(activeKey);
        return value === null ? undefined : parseStableId(value);
      } catch {
        return undefined;
      }
    };
    const writeActiveId = (id: string) => {
      try { storage.setItem(activeKey, id); return true; } catch { return false; }
    };
    const updatePreferences = (preferences: Array<{ id: string; pinned: boolean }>) => locked(async () => {
      const updated = await database.setWorkspacePreferences(preferences);
      notify();
      return updated;
    });
    const transformPreferences = (workspaceId: string, transform: (preferences: Array<{ id: string; pinned: boolean }>, id: string) => Array<{ id: string; pinned: boolean }>) => locked(async () => {
      const id = parseStableId(workspaceId, "A workspace ID is invalid.");
      const current = await database.listWorkspaces();
      if (!current.some((workspace) => workspace.id === id)) throw new Error("That workspace does not exist.");
      const preferences = transform(current.map(({ id: currentId, pinned }) => ({ id: currentId, pinned })), id);
      const updated = await database.setWorkspacePreferences(preferences);
      notify();
      return updated;
    });

    return {
      listWorkspaces: () => database.listWorkspaces(),
      createWorkspace: (value) => locked(async () => {
        if (!isRecord(value) || Object.keys(value).some((key) => key !== "id" && key !== "name" && key !== "pinned") || value.id !== undefined && typeof value.id !== "string" || typeof value.name !== "string" || value.pinned !== undefined && typeof value.pinned !== "boolean") throw new Error("A workspace creation request has an unsupported shape.");
        const wasEmpty = (await database.listWorkspaces()).length === 0;
        const workspace = await database.createWorkspace({ id: value.id === undefined ? randomUUID() : parseStableId(value.id), name: value.name, pinned: value.pinned ?? false, deviceId: canonicalDeviceId });
        if (wasEmpty) writeActiveId(workspace.id);
        notify();
        return workspace;
      }),
      ensureInitialWorkspace: (name = "Home", pinned = true) => locked(async () => {
        const current = await database.listWorkspaces();
        if (current[0]) {
          if (!readActiveId()) writeActiveId(current[0].id);
          return current[0];
        }
        const workspace = await database.createWorkspace({ id: randomUUID(), name, pinned, deviceId: canonicalDeviceId });
        writeActiveId(workspace.id);
        notify();
        return workspace;
      }),
      renameWorkspace: (workspaceId, name) => locked(async () => {
        const workspace = await database.renameWorkspace(workspaceId, name);
        notify();
        return workspace;
      }),
      setWorkspacePreferences: updatePreferences,
      moveWorkspace: (workspaceId, direction) => {
        if (direction !== -1 && direction !== 1) throw new Error("A workspace move direction is invalid.");
        return transformPreferences(workspaceId, (preferences, id) => moveDesktopPreference(preferences, id, direction));
      },
      pinWorkspace: (workspaceId, pinned) => {
        if (typeof pinned !== "boolean") throw new Error("Workspace pinning metadata is invalid.");
        return transformPreferences(workspaceId, (preferences, id) => pinDesktopPreference(preferences, id, pinned));
      },
      deleteWorkspace: (workspaceId) => locked(async () => {
        const id = parseStableId(workspaceId, "A workspace ID is invalid.");
        const remaining = await database.deleteWorkspace(id);
        if (readActiveId() === id) writeActiveId(remaining[0]!.id);
        notify();
        return remaining;
      }),
      resolveActiveWorkspace: async () => {
        const workspaces = await database.listWorkspaces();
        const active = workspaces.find(({ id }) => id === readActiveId()) ?? workspaces[0];
        if (!active) throw new Error("The workspace catalog is empty.");
        writeActiveId(active.id);
        return active;
      },
      setActiveWorkspace: async (workspaceId) => {
        const id = parseStableId(workspaceId, "A workspace ID is invalid.");
        const workspace = (await database.listWorkspaces()).find((candidate) => candidate.id === id);
        if (!workspace) throw new Error("That workspace does not exist.");
        if (!writeActiveId(id)) throw new Error("The active workspace could not be saved in this tab.");
        return workspace;
      },
      onChangesAvailable: (listener) => {
        if (typeof listener !== "function") throw new TypeError("A catalog change listener is required.");
        const handler = (event: MessageEvent<unknown>) => { if (isCatalogNotification(event.data)) listener(); };
        channel.addEventListener("message", handler);
        return () => channel.removeEventListener("message", handler);
      },
      close: () => {
        channel.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

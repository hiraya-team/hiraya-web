import type { AuthSession } from "../lib/auth";
import { publicAuthorityFromPath, type PublicAuthority } from "../lib/publication-alias";
import type { DesktopEntry } from "../types";
import { parseStableId as id, storageNamespaceHash as namespaceHash } from "../filesystem/ids";
import { configureAccountStorage } from "../platform/storage/account-storage";

const frontendOnly = import.meta.env.HIRAYA_FRONTEND_ONLY === "true";
const databasePrefix = "hiraya-web2-v1-";

export type DesktopStart = { session: AuthSession | null; warmStart?: boolean };
export type CoreWorkspace = { id: string | null; name: string; entries: DesktopEntry[] };
export type ShellStartup =
  | { kind: "desktop"; start: DesktopStart; workspace: CoreWorkspace }
  | { kind: "public"; authority: PublicAuthority };

function request<T>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("The core desktop cache could not be read."));
  });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The core desktop cache is invalid.");
  return value as Record<string, unknown>;
}

function name(value: unknown) {
  if (typeof value !== "string" || !value || value !== value.trim() || value === "." || value === ".." || value.includes("/") || value.includes("\\") || [...value].length > 180) throw new Error("The core desktop cache is invalid.");
  return value;
}

function number(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("The core desktop cache is invalid.");
  return value;
}

function openExistingDatabase(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(name);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("The core desktop cache could not be opened."));
    opening.onupgradeneeded = () => opening.transaction?.abort();
  });
}

async function readCoreWorkspace(storageId: string, fallback?: { id: string; name: string }): Promise<CoreWorkspace> {
  const databaseName = `${databasePrefix}${await namespaceHash(storageId)}`;
  if (!(await indexedDB.databases()).some(({ name }) => name === databaseName)) return { id: fallback?.id ?? null, name: fallback?.name ?? "Desktop", entries: [] };
  const database = await openExistingDatabase(databaseName);
  try {
    if (database.version !== 1 || !database.objectStoreNames.contains("workspaces") || !database.objectStoreNames.contains("nodes")) throw new Error("The core desktop cache has an unsupported schema.");
    const transaction = database.transaction(["workspaces", "nodes"], "readonly");
    const workspaceValues = await request<unknown[]>(transaction.objectStore("workspaces").getAll());
    const workspaces = workspaceValues.map((value) => {
      const workspace = record(value);
      const ordinal = number(workspace.ordinal);
      if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new Error("The core desktop cache is invalid.");
      return { id: id(workspace.id), name: name(workspace.name), ordinal };
    }).sort((left, right) => left.ordinal - right.ordinal);
    const selectedId = (() => {
      try { return id(sessionStorage.getItem(`${databaseName}-active-workspace`)); } catch { return fallback?.id; }
    })();
    const workspace = workspaces.find(({ id }) => id === selectedId) ?? workspaces.find(({ id }) => id === fallback?.id) ?? workspaces[0];
    if (!workspace) return { id: fallback?.id ?? null, name: fallback?.name ?? "Desktop", entries: [] };
    const values = await request<unknown[]>(transaction.objectStore("nodes").index("by-workspace-lifecycle").getAll(IDBKeyRange.only([workspace.id, "active"])));
    const entries = values.map((value): DesktopEntry => {
      const node = record(value);
      const position = record(node.position);
      const lifecycle = record(node.lifecycle);
      const parentId = node.parentId === null ? null : id(node.parentId);
      const createdAt = number(node.createdAt);
      const modifiedAt = number(node.modifiedAt);
      if (node.workspaceId !== workspace.id || node.lifecycleKey !== "active" || lifecycle.kind !== "active" || createdAt < 0 || modifiedAt < 0) throw new Error("The core desktop cache is invalid.");
      const base = { id: id(node.id), name: name(node.name), parentId, position: { x: number(position.x), y: number(position.y) }, createdAt, modifiedAt };
      if (node.kind === "folder") return { ...base, kind: "folder" };
      if (node.kind !== "file" || typeof node.mimeType !== "string") throw new Error("The core desktop cache is invalid.");
      const size = number(node.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("The core desktop cache is invalid.");
      return { ...base, kind: "file", mimeType: node.mimeType, size };
    });
    return { id: workspace.id, name: workspace.name, entries };
  } finally {
    database.close();
  }
}

export async function startShell(): Promise<ShellStartup> {
  const authority = publicAuthorityFromPath(window.location.pathname);
  if (authority) return { kind: "public", authority };

  if (frontendOnly) {
    const { LOCAL_WEB2_ACCOUNT_ID } = await import("../platform/storage/local-identity");
    configureAccountStorage(LOCAL_WEB2_ACCOUNT_ID, LOCAL_WEB2_ACCOUNT_ID);
    return { kind: "desktop", start: { session: null, warmStart: false }, workspace: await readCoreWorkspace(LOCAL_WEB2_ACCOUNT_ID) };
  }

  const { bootstrapSession, readCachedSession } = await import("../lib/auth");
  const cachedSession = readCachedSession();
  const sessionRequest = bootstrapSession(false);
  const session = cachedSession ?? await sessionRequest;
  if (!session) throw new Error("Authentication did not return a Web2 session.");
  const { configureSynchronizedSession } = await import("../platform/storage/synchronized-session");
  configureAccountStorage(session.accountId, session.storageId);
  configureSynchronizedSession(session);
  if (cachedSession) void sessionRequest.then((fresh) => {
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(cachedSession)) window.location.reload();
  }).catch(() => undefined);
  const selected = session.account.workspaces[0]!;
  return { kind: "desktop", start: { session, warmStart: cachedSession !== null }, workspace: await readCoreWorkspace(session.storageId, selected) };
}

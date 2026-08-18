import { parseWeb2Session, type Web2Session } from "../sync/session";
import { loginUrl } from "./auth-route";

export { loginUrl, safeReturnPath } from "./auth-route";

export type SessionUser = {
  id: string;
  displayName: string;
  email: string;
  deploymentAdmin: boolean;
};

export type AuthSession = {
  schemaVersion: 1;
  apiProtocol: "web2-sync-v1";
  accountId: string;
  catalogId: string;
  storageId: string;
  directBlobOrigin: string;
  directoryRevision: number;
  buildTimestamp: string;
  user: SessionUser;
  account: Web2Session["accounts"][number];
  capabilities: {
    desktopSearch: "web2-search-v1";
    shortLinks: "web2-short-links-v1";
    publications: "web2-publications-v1";
    thumbnails: "thumbnail-v1";
  };
  shortLinkBaseUrl: "/r";
  publicationBaseUrl: "/published";
};

const AUTH_BOOTSTRAP_CACHE_KEY = "hiraya-auth-bootstrap-web2-v1";
const SELECTED_ACCOUNT_KEY = "hiraya-selected-account-web2-v1";
type BootstrapStorage = Pick<Storage, "getItem" | "setItem">;

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Your Hiraya session has expired.");
    this.name = "AuthenticationRequiredError";
  }
}

export function isSafeRootRelativePath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const url = new URL(value, "https://hiraya.invalid");
    return url.origin === "https://hiraya.invalid" && `${url.pathname}${url.search}${url.hash}` === value;
  } catch {
    return false;
  }
}

function selectedAccount(session: Web2Session, storage?: BootstrapStorage, preferredAccountId?: string) {
  const preferred = preferredAccountId ?? storage?.getItem(SELECTED_ACCOUNT_KEY) ?? null;
  const account = session.accounts.find(({ id }) => id === preferred) ?? session.accounts[0];
  if (!account || account.workspaces.length === 0) throw new Error("Your Hiraya session has no accessible account workspace.");
  try { storage?.setItem(SELECTED_ACCOUNT_KEY, account.id); } catch { /* Account selection remains valid for this page. */ }
  return account;
}

export function parseAuthSession(value: unknown, storage?: BootstrapStorage, preferredAccountId?: string): AuthSession {
  const session = parseWeb2Session(value);
  const account = selectedAccount(session, storage, preferredAccountId);
  if (!session.directBlobOrigin) throw new Error("The Web2 session does not provide direct chunk storage.");
  return {
    schemaVersion: 1,
    apiProtocol: "web2-sync-v1",
    accountId: account.id,
    catalogId: account.id,
    storageId: account.storageId,
    directBlobOrigin: session.directBlobOrigin,
    directoryRevision: session.directoryRevision,
    buildTimestamp: session.buildTimestamp,
    user: session.user,
    account,
    capabilities: { desktopSearch: "web2-search-v1", shortLinks: "web2-short-links-v1", publications: "web2-publications-v1", thumbnails: "thumbnail-v1" },
    shortLinkBaseUrl: "/r",
    publicationBaseUrl: "/published",
  };
}

export function redirectToLogin() {
  window.location.replace(loginUrl());
}

export function requireAuthenticatedResponse(response: Response, onUnauthorized: () => void = redirectToLogin, storage?: BootstrapStorage) {
  if (response.status !== 401) return response;
  const bootstrapStorage = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  if (bootstrapStorage) lockAuthBootstrap(bootstrapStorage);
  onUnauthorized();
  throw new AuthenticationRequiredError();
}

export function readCachedSession(storage?: BootstrapStorage): AuthSession | null {
  const bootstrapStorage = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  if (!bootstrapStorage) return null;
  try {
    const cache = JSON.parse(bootstrapStorage.getItem(AUTH_BOOTSTRAP_CACHE_KEY) ?? "null") as { version?: unknown; locked?: unknown; session?: unknown; accountId?: unknown } | null;
    if (!cache || cache.version !== 1 || cache.locked !== false || typeof cache.accountId !== "string") return null;
    return parseAuthSession(cache.session, bootstrapStorage, cache.accountId);
  } catch {
    return null;
  }
}

export function lockAuthBootstrap(storage: BootstrapStorage = localStorage) {
  try { storage.setItem(AUTH_BOOTSTRAP_CACHE_KEY, JSON.stringify({ version: 1, locked: true })); } catch { /* Logout must continue when browser storage is unavailable. */ }
}

export async function bootstrapSession(
  frontendOnly: boolean,
  _fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  onUnauthorized: () => void = redirectToLogin,
  storage?: BootstrapStorage,
): Promise<AuthSession | null> {
  if (frontendOnly) return null;
  const bootstrapStorage = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  let session: Web2Session;
  try {
    const response = await _fetchImpl("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) {
      if (bootstrapStorage) lockAuthBootstrap(bootstrapStorage);
      onUnauthorized();
      throw new AuthenticationRequiredError();
    }
    if (response.status !== 200) throw new Error(`Synchronization request failed with status ${response.status}.`);
    if (response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new Error("A synchronization response is not JSON.");
    session = parseWeb2Session(await response.json());
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) throw error;
    if (error instanceof TypeError) {
      const cached = readCachedSession(bootstrapStorage);
      if (cached) return cached;
      throw new Error("The synchronization network is unavailable.");
    }
    throw error;
  }
  const parsed = parseAuthSession(session, bootstrapStorage);
  try { bootstrapStorage?.setItem(AUTH_BOOTSTRAP_CACHE_KEY, JSON.stringify({ version: 1, locked: false, accountId: parsed.accountId, session })); } catch { /* An authenticated startup does not depend on cache persistence. */ }
  return parsed;
}

import { API_ROUTES, SERVER_ROUTES } from "./api-routes";
import { parseAuthorityIdentity } from "./wire-authority";

export type SessionUser = {
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthSession = {
  schemaVersion: 1;
  catalogId: string;
  storageId: string;
  directBlobOrigin: string;
  user: SessionUser;
  capabilities: {
    blobTransfer: "direct-b2-v1";
    desktopSearch?: "accessible-desktops-v1";
		shortLinks?: "account-short-links-v1";
		publications?: "alias-publications-v1";
	};
	shortLinkBaseUrl?: string;
	publicationBaseUrl?: string;
};

const AUTH_BOOTSTRAP_CACHE_KEY = "hiraya-auth-bootstrap-v1";
type BootstrapStorage = Pick<Storage, "getItem" | "setItem">;

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Your Hiraya session has expired.");
    this.name = "AuthenticationRequiredError";
  }
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`The session bootstrap contains an invalid ${label}.`);
  return value;
}

export function isSafeRootRelativePath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const url = new URL(value, "https://hiraya.invalid");
    return url.origin === "https://hiraya.invalid" && url.pathname === value && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isSafeAbsoluteHttpUrl(value: string) {
  if (value.trim() !== value || value.includes("\\") || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function normalizedHttpOrigin(value: string) {
  if (!isSafeAbsoluteHttpUrl(value)) return null;
  const url = new URL(value);
  return url.pathname === "/" ? url.origin : null;
}

export function parseAuthSession(value: unknown): AuthSession {
  if (!value || typeof value !== "object") throw new Error("The session bootstrap is invalid.");
  const authority = parseAuthorityIdentity(value, "The session bootstrap");
	const session = value as { storageId?: unknown; directBlobOrigin?: unknown; user?: unknown; capabilities?: unknown; shortLinkBaseUrl?: unknown; publicationBaseUrl?: unknown };
  if (!session.user || typeof session.user !== "object") throw new Error("The session bootstrap contains invalid user metadata.");
  if (!session.capabilities || typeof session.capabilities !== "object" || (session.capabilities as { blobTransfer?: unknown }).blobTransfer !== "direct-b2-v1") {
    throw new Error("The session bootstrap requires direct-b2-v1 blob transfer support.");
  }
  const directBlobOrigin = normalizedHttpOrigin(requiredString(session.directBlobOrigin, "direct blob origin"));
  if (!directBlobOrigin) throw new Error("The session bootstrap contains an invalid direct blob origin.");
  const user = session.user as { displayName?: unknown; email?: unknown; avatarUrl?: unknown };
  const optionalString = (candidate: unknown, label: string) => candidate === undefined ? undefined : requiredString(candidate, label);
  const desktopSearch = (session.capabilities as { desktopSearch?: unknown }).desktopSearch;
  if (desktopSearch !== undefined && desktopSearch !== "accessible-desktops-v1") throw new Error("The session bootstrap contains unsupported desktop search capability metadata.");
  const shortLinks = (session.capabilities as { shortLinks?: unknown }).shortLinks;
  if (shortLinks !== undefined && shortLinks !== "account-short-links-v1") throw new Error("The session bootstrap contains unsupported short-link capability metadata.");
	const shortLinkBaseUrl = session.shortLinkBaseUrl === undefined ? undefined : requiredString(session.shortLinkBaseUrl, "short-link base URL");
  if ((shortLinks === undefined) !== (shortLinkBaseUrl === undefined)) throw new Error("The session bootstrap contains incomplete short-link capability metadata.");
	if (shortLinkBaseUrl && !isSafeRootRelativePath(shortLinkBaseUrl) && !isSafeAbsoluteHttpUrl(shortLinkBaseUrl)) throw new Error("The session bootstrap contains an invalid short-link base URL.");
	const publications = (session.capabilities as { publications?: unknown }).publications;
	if (publications !== undefined && publications !== "alias-publications-v1") throw new Error("The session bootstrap contains unsupported publication capability metadata.");
	const publicationBaseUrl = session.publicationBaseUrl === undefined ? undefined : requiredString(session.publicationBaseUrl, "publication base URL");
	if ((publications === undefined) !== (publicationBaseUrl === undefined)) throw new Error("The session bootstrap contains incomplete publication capability metadata.");
	if (publicationBaseUrl && !isSafeRootRelativePath(publicationBaseUrl) && !isSafeAbsoluteHttpUrl(publicationBaseUrl)) throw new Error("The session bootstrap contains an invalid publication base URL.");
  return {
    ...authority,
    storageId: requiredString(session.storageId, "storage ID"),
    directBlobOrigin,
    user: {
      displayName: requiredString(user.displayName, "display name"),
      ...(user.email === undefined ? {} : { email: optionalString(user.email, "email address") }),
      ...(user.avatarUrl === undefined ? {} : { avatarUrl: optionalString(user.avatarUrl, "avatar URL") }),
    },
		capabilities: { blobTransfer: "direct-b2-v1", ...(desktopSearch ? { desktopSearch } : {}), ...(shortLinks ? { shortLinks } : {}), ...(publications ? { publications } : {}) },
		...(shortLinkBaseUrl ? { shortLinkBaseUrl } : {}),
		...(publicationBaseUrl ? { publicationBaseUrl } : {}),
  };
}

export function safeReturnPath(location: Pick<Location, "pathname" | "search" | "hash"> = window.location) {
  const path = `${location.pathname}${location.search}${location.hash}`;
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export function loginUrl(location?: Pick<Location, "pathname" | "search" | "hash">) {
  const query = new URLSearchParams({ returnTo: safeReturnPath(location) });
  return `${SERVER_ROUTES.login}?${query}`;
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

function cachedSession(storage: BootstrapStorage): AuthSession | null {
  try {
    const value = JSON.parse(storage.getItem(AUTH_BOOTSTRAP_CACHE_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object") return null;
    const cache = value as { version?: unknown; locked?: unknown; session?: unknown };
    if (cache.version !== 1 || cache.locked !== false) return null;
    return parseAuthSession(cache.session);
  } catch {
    return null;
  }
}

export function lockAuthBootstrap(storage: BootstrapStorage = localStorage) {
  try {
    storage.setItem(AUTH_BOOTSTRAP_CACHE_KEY, JSON.stringify({ version: 1, locked: true }));
  } catch { /* Logout must continue when browser storage is unavailable. */ }
}

export async function bootstrapSession(
  frontendOnly: boolean,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  onUnauthorized: () => void = redirectToLogin,
  storage?: BootstrapStorage,
): Promise<AuthSession | null> {
  if (frontendOnly) return null;
  let response: Response;
  try {
    response = await fetchImpl(API_ROUTES.authSession, { cache: "no-store", credentials: "same-origin" });
  } catch (error) {
    const bootstrapStorage = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    const cached = bootstrapStorage ? cachedSession(bootstrapStorage) : null;
    if (cached) return cached;
    throw error;
  }
  requireAuthenticatedResponse(response, onUnauthorized, storage);
  if (!response.ok) throw new Error(`Hiraya could not load your session (${response.status}).`);
  const session = parseAuthSession(await response.json());
  try {
    (storage ?? localStorage).setItem(AUTH_BOOTSTRAP_CACHE_KEY, JSON.stringify({ version: 1, locked: false, session }));
  } catch { /* A cache write failure must not block an authenticated startup. */ }
  return session;
}

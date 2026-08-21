/** Computes desktop base. */
const desktopBase = (desktopId: string) => `/api/desktops/${encodeURIComponent(desktopId)}`;
/** Computes public desktop base. */
const publicDesktopBase = (desktopAlias: string, itemAlias?: string) => `/api/public/desktops/${encodeURIComponent(desktopAlias)}${itemAlias ? `/${encodeURIComponent(itemAlias)}` : ""}`;
/** Returns app base. */
const appBase = (appId: string) => `/api/apps/${encodeURIComponent(appId)}`;
/** Returns app resource base. */
const appResourceBase = (kind: "installation" | "handlers" | "manifests", appId?: string) => `/api/apps/resources/${kind}${appId ? `/${encodeURIComponent(appId)}` : ""}`;

/** Defines the Hiraya API protocol. */
export const HIRAYA_API_PROTOCOL = "entry-transactions-v2";

/** Returns authenticated headers. */
export function authenticatedHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("X-Hiraya-Protocol", HIRAYA_API_PROTOCOL);
  return result;
}

/** Defines the API routes. */
export const API_ROUTES = {
  authSession: "/api/auth/session",
  desktops: "/api/desktops",
  desktopPreferences: "/api/account/desktop-preferences",
  desktopProjection: (desktopId: string) => `${desktopBase(desktopId)}?projection=web`,
  desktop: (desktopId: string) => desktopBase(desktopId),
  desktopTrash: (desktopId: string) => `${desktopBase(desktopId)}/trash`,
  desktopSystemEntries: (desktopId: string) => `${desktopBase(desktopId)}/system/entries`,
  desktopSystemEntry: (desktopId: string, entryId: string) => `${desktopBase(desktopId)}/system/entries/${encodeURIComponent(entryId)}`,
  desktopContent: (desktopId: string, id: string, revision?: number, purpose?: "preview") => {
    const params = new URLSearchParams();
    if (revision !== undefined) params.set("revision", String(revision));
    if (purpose) params.set("purpose", purpose);
    return `${desktopBase(desktopId)}/entries/${encodeURIComponent(id)}/content${params.size ? `?${params}` : ""}`;
  },
  desktopTrashContent: (desktopId: string, id: string, revision: number, trashRootId: string) => `${desktopBase(desktopId)}/entries/${encodeURIComponent(id)}/content?${new URLSearchParams({ revision: String(revision), trashRootId })}`,
  desktopThumbnail: (desktopId: string, id: string, revision: number, profile: "thumbnail-v1") => `${desktopBase(desktopId)}/entries/${encodeURIComponent(id)}/thumbnail?${new URLSearchParams({ revision: String(revision), profile })}`,
  desktopEntryTransactions: (desktopId: string) => `${desktopBase(desktopId)}/entries/transactions`,
  desktopEntryTransaction: (desktopId: string, transactionId: string) => `${desktopBase(desktopId)}/entries/transactions/${encodeURIComponent(transactionId)}`,
  desktopEntryTransactionCommit: (desktopId: string, transactionId: string) => `${desktopBase(desktopId)}/entries/transactions/${encodeURIComponent(transactionId)}/commit`,
  desktopSharing: (desktopId: string) => `${desktopBase(desktopId)}/sharing`,
  desktopMembers: (desktopId: string) => `${desktopBase(desktopId)}/members`,
  desktopMember: (desktopId: string, userId: string) => `${desktopBase(desktopId)}/members/${encodeURIComponent(userId)}`,
  desktopInvitation: (desktopId: string, email: string) => `${desktopBase(desktopId)}/invitations/${encodeURIComponent(email)}`,
  desktopPublication: (desktopId: string) => `${desktopBase(desktopId)}/publication`,
  desktopItemPublication: (desktopId: string, entryId: string) => `${desktopBase(desktopId)}/publication/items/${encodeURIComponent(entryId)}`,
  publicDesktop: (desktopAlias: string, itemAlias?: string) => publicDesktopBase(desktopAlias, itemAlias),
  publicDesktopContent: (desktopAlias: string, itemAlias: string | undefined, id: string, revision?: number, purpose?: "preview") => {
    const params = new URLSearchParams();
    if (revision !== undefined) params.set("revision", String(revision));
    if (purpose) params.set("purpose", purpose);
    return `${publicDesktopBase(desktopAlias, itemAlias)}/entries/${encodeURIComponent(id)}/content${params.size ? `?${params}` : ""}`;
  },
  publicDesktopThumbnail: (desktopAlias: string, itemAlias: string | undefined, id: string, revision: number, profile: "thumbnail-v1") => `${publicDesktopBase(desktopAlias, itemAlias)}/entries/${encodeURIComponent(id)}/thumbnail?${new URLSearchParams({ revision: String(revision), profile })}`,
  events: `/api/events?protocol=${HIRAYA_API_PROTOCOL}`,
  health: "/api/health",
  syncHealth: "/api/sync/health",
  shortLinks: "/api/short-links",
  shortLink: (slug: string) => `/api/short-links/${encodeURIComponent(slug)}`,
  search: (query: string) => `/api/search?q=${encodeURIComponent(query)}`,
  activity: (query: { q?: string; before?: number; limit: number; desktopId?: string }) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.before !== undefined) params.set("before", String(query.before));
    params.set("limit", String(query.limit));
    if (query.desktopId) params.set("desktopId", query.desktopId);
    return `/api/activity?${params}`;
  },
  apps: "/api/apps",
  appHandlers: "/api/apps/handlers",
  appPackages: "/api/apps/packages",
  appPackage: (uploadId: string) => `/api/apps/packages/${encodeURIComponent(uploadId)}`,
  appPackageCommit: (uploadId: string) => `/api/apps/packages/${encodeURIComponent(uploadId)}/commit`,
  appPackageDownload: (appId: string) => `${appBase(appId)}/package`,
  app: (appId: string) => appBase(appId),
  appData: (appId: string, key?: string) => `${appBase(appId)}/data${key === undefined ? "" : `/${encodeURIComponent(key)}`}`,
  appResource: (kind: "installation" | "handlers" | "manifests", appId?: string) => appResourceBase(kind, appId),
  appResourceContent: (kind: "installation" | "handlers" | "manifests", appId?: string) => `${appResourceBase(kind, appId)}/content`,
} as const;

/** Defines the server routes. */
export const SERVER_ROUTES = {
  login: "/login",
  profile: "/profile",
  logout: "/logout",
} as const;

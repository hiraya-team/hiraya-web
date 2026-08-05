const desktopBase = (desktopId: string) => `/api/desktops/${encodeURIComponent(desktopId)}`;
const publicDesktopBase = (desktopAlias: string, itemAlias?: string) => `/api/public/desktops/${encodeURIComponent(desktopAlias)}${itemAlias ? `/${encodeURIComponent(itemAlias)}` : ""}`;

export const HIRAYA_API_PROTOCOL = "entry-transactions-v1";

export function authenticatedHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("X-Hiraya-Protocol", HIRAYA_API_PROTOCOL);
  return result;
}

export const API_ROUTES = {
  authSession: "/api/auth/session",
  desktops: "/api/desktops",
  desktopProjection: (desktopId: string) => `${desktopBase(desktopId)}?projection=web`,
  desktop: (desktopId: string) => desktopBase(desktopId),
  desktopTrash: (desktopId: string) => `${desktopBase(desktopId)}/trash`,
  desktopContent: (desktopId: string, id: string, revision?: number, purpose?: "preview") => {
    const params = new URLSearchParams();
    if (revision !== undefined) params.set("revision", String(revision));
    if (purpose) params.set("purpose", purpose);
    return `${desktopBase(desktopId)}/entries/${encodeURIComponent(id)}/content${params.size ? `?${params}` : ""}`;
  },
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
} as const;

export const SERVER_ROUTES = {
  login: "/login",
  profile: "/profile",
  logout: "/logout",
} as const;

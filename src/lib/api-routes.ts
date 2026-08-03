const desktopBase = (desktopId: string) => `/api/desktops/${encodeURIComponent(desktopId)}`;
const publicDesktopBase = (desktopAlias: string, itemAlias?: string) => `/api/public/desktops/${encodeURIComponent(desktopAlias)}${itemAlias ? `/${encodeURIComponent(itemAlias)}` : ""}`;

export const API_ROUTES = {
  authSession: "/api/auth/session",
  catalog: "/api/catalog",
  desktops: "/api/desktops",
  desktop: (desktopId: string) => desktopBase(desktopId),
  desktopImports: (desktopId: string) => `${desktopBase(desktopId)}/imports`,
  desktopEntries: (desktopId: string) => `${desktopBase(desktopId)}/entries`,
  desktopMoveEntries: (desktopId: string) => `${desktopBase(desktopId)}/entries/move`,
  desktopDeleteEntries: (desktopId: string) => `${desktopBase(desktopId)}/entries/delete`,
  desktopTrash: (desktopId: string) => `${desktopBase(desktopId)}/trash`,
  desktopTrashEntry: (desktopId: string, id: string) => `${desktopBase(desktopId)}/trash/${encodeURIComponent(id)}`,
  desktopTrashRestore: (desktopId: string, id: string) => `${desktopBase(desktopId)}/trash/${encodeURIComponent(id)}/restore`,
  desktopLayout: (desktopId: string) => `${desktopBase(desktopId)}/layout`,
  desktopRootEntryPositions: (desktopId: string) => `${desktopBase(desktopId)}/root-entry-positions`,
  desktopEditorSettings: (desktopId: string) => `${desktopBase(desktopId)}/editor-settings`,
  desktopThemeSelection: (desktopId: string) => `${desktopBase(desktopId)}/theme-selection`,
  desktopEntry: (desktopId: string, id: string) => `${desktopBase(desktopId)}/entries/${encodeURIComponent(id)}`,
  desktopContent: (desktopId: string, id: string) => `${desktopBase(desktopId)}/entries/${encodeURIComponent(id)}/content`,
  desktopBlobMutations: (desktopId: string) => `${desktopBase(desktopId)}/blob-mutations`,
  desktopBlobMutation: (desktopId: string, uploadId: string) => `${desktopBase(desktopId)}/blob-mutations/${encodeURIComponent(uploadId)}`,
  desktopBlobMutationCommit: (desktopId: string, uploadId: string) => `${desktopBase(desktopId)}/blob-mutations/${encodeURIComponent(uploadId)}/commit`,
  desktopContentAccess: (desktopId: string, id: string, revision: number) => `${desktopBase(desktopId)}/entries/${encodeURIComponent(id)}/content-access?revision=${encodeURIComponent(String(revision))}`,
  desktopContentPreviewAccess: (desktopId: string, id: string, revision: number) => `${desktopBase(desktopId)}/entries/${encodeURIComponent(id)}/content-preview-access?revision=${encodeURIComponent(String(revision))}`,
  desktopTheme: (desktopId: string, id: string) => `${desktopBase(desktopId)}/themes/${encodeURIComponent(id)}`,
  desktopThemePackageAccess: (desktopId: string, id: string, revision: number) => `${desktopBase(desktopId)}/themes/${encodeURIComponent(id)}/package-access?revision=${encodeURIComponent(String(revision))}`,
  desktopSharing: (desktopId: string) => `${desktopBase(desktopId)}/sharing`,
  desktopMembers: (desktopId: string) => `${desktopBase(desktopId)}/members`,
  desktopMember: (desktopId: string, userId: string) => `${desktopBase(desktopId)}/members/${encodeURIComponent(userId)}`,
  desktopInvitation: (desktopId: string, email: string) => `${desktopBase(desktopId)}/invitations/${encodeURIComponent(email)}`,
  desktopPublication: (desktopId: string) => `${desktopBase(desktopId)}/publication`,
  desktopItemPublication: (desktopId: string, entryId: string) => `${desktopBase(desktopId)}/publication/items/${encodeURIComponent(entryId)}`,
  publicDesktop: (desktopAlias: string, itemAlias?: string) => publicDesktopBase(desktopAlias, itemAlias),
  publicDesktopContent: (desktopAlias: string, itemAlias: string | undefined, id: string) => `${publicDesktopBase(desktopAlias, itemAlias)}/entries/${encodeURIComponent(id)}/content`,
  publicDesktopContentAccess: (desktopAlias: string, itemAlias: string | undefined, id: string, revision: number) => `${publicDesktopBase(desktopAlias, itemAlias)}/entries/${encodeURIComponent(id)}/content-access?revision=${encodeURIComponent(String(revision))}`,
  publicThemePackageAccess: (desktopAlias: string, id: string, revision: number) => `${publicDesktopBase(desktopAlias)}/themes/${encodeURIComponent(id)}/package-access?revision=${encodeURIComponent(String(revision))}`,
  entryTransfers: "/api/entry-transfers",
  events: "/api/events",
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

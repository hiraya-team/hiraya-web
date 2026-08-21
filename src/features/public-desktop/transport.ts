import type { FileEntry } from "../../types";
import { DEFAULT_WALLPAPER } from "../../types";
import { DEFAULT_DESKTOP_GRID_SETTINGS, type ActiveSetting, type SettingNamespace } from "../../filesystem/model";
import { DEFAULT_EDITOR_SETTINGS } from "../../lib/desktop-state";
import { DEFAULT_THEME_STATE, parseCustomTheme, parseThemeState } from "../../lib/themes";
import { sha256Blob } from "../../lib/blob-transfer";
import type { PublicAuthority } from "../../lib/publication-alias";
import { supportsThumbnailMime, THUMBNAIL_MAX_SOURCE_SIZE, THUMBNAIL_PROFILE } from "../../lib/thumbnails";
import { downloadWeb2Chunk, fetchPublicNodeContent, fetchPublicWeb2Thumbnail, fetchPublicWorkspacePage, Web2HTTPError } from "../../sync/transport";
import { assertIconGroupFolders, assertSceneFiles, assertWallpaperSource, parseLayout, type RemoteDesktopState } from "../../lib/contracts";

/** Signals that a public large-file download requires authentication. */
export class LargeDownloadAuthRequiredError extends Error {
  /** Creates the error with the server login destination. */
  constructor(readonly loginUrl: string) {
    super("Sign in to download this large file.");
    this.name = "LargeDownloadAuthRequiredError";
  }
}

export { publicAuthorityFromPath } from "../../lib/publication-alias";
export type { PublicAuthority } from "../../lib/publication-alias";
export type PublicDesktopState = RemoteDesktopState & { publishedRootId?: string; thumbnailProfile?: typeof THUMBNAIL_PROFILE };

type PublicContentIdentity = { manifestHash: string; contentOperationId: string; asOf: number };
/** Caches immutable content identities from fetched public snapshots. */
const contentIdentities = new Map<string, PublicContentIdentity>();

/** Builds a snapshot-scoped cache key for public file content. */
function contentKey(authority: PublicAuthority, fileId: string) {
  return `${authority.desktopAlias}\0${authority.itemAlias ?? ""}\0${fileId}`;
}

/** Derives the latest logical revision represented by a public node. */
function nodeRevision(node: Exclude<Awaited<ReturnType<typeof fetchPublicWorkspacePage>>["nodes"][number], { purged: true }>) {
  return Math.max(node.fieldTuples.lifecycle.logicalTime, node.fieldTuples.name.logicalTime, node.fieldTuples.parent.logicalTime, node.fieldTuples.position.logicalTime, node.fieldTuples.content?.logicalTime ?? 0);
}

/** Reads an active public setting or returns its domain default. */
function publicSettingValue(settings: ActiveSetting[], namespace: SettingNamespace, key: string, fallback: unknown) {
  return settings.find((setting) => setting.namespace === namespace && setting.key === key)?.value ?? fallback;
}

/** Fetches and validates a complete read-only public desktop snapshot. */
export async function fetchPublicDesktop(authority: PublicAuthority, _fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<PublicDesktopState> {
  void _fetchImpl;
  let page = await fetchPublicWorkspacePage(authority.desktopAlias, { itemAlias: authority.itemAlias, limit: 256 });
  const first = page;
  const nodes = [...page.nodes];
  while (page.nextAfter) {
    page = await fetchPublicWorkspacePage(authority.desktopAlias, { itemAlias: authority.itemAlias, asOf: first.asOf, after: page.nextAfter, limit: 256 });
    if (page.settings.length > 0) throw new Error("A public workspace continuation repeated its focused settings.");
    nodes.push(...page.nodes);
  }
  const entries = nodes.map((node) => {
    if ("purged" in node) throw new Error("A public page references a purged item.");
    const revision = nodeRevision(node);
    if (node.kind === "folder") return { id: node.id, kind: "folder" as const, name: node.name, parentId: node.parentId, createdAt: node.createdAt, modifiedAt: node.modifiedAt, position: node.position, revision, contentRevision: 0 };
    contentIdentities.set(contentKey(authority, node.id), { manifestHash: node.manifestHash, contentOperationId: node.fieldTuples.content!.operationId, asOf: first.asOf });
    return { id: node.id, kind: "file" as const, name: node.name, parentId: node.parentId, createdAt: node.createdAt, modifiedAt: node.modifiedAt, position: node.position, mimeType: node.mimeType, size: node.size, revision, contentRevision: node.fieldTuples.content!.logicalTime };
  });
  const settings = first.settings;
  const layoutSettings = settings.filter((setting) => setting.namespace === "desktop-grid" || setting.namespace === "wallpaper" || setting.namespace === "widgets" || setting.namespace === "icon-groups");
  const layout = parseLayout({
    autoArrangeIcons: publicSettingValue(settings, "desktop-grid", "auto-arrange-icons", DEFAULT_DESKTOP_GRID_SETTINGS.autoArrangeIcons),
    snapToGrid: publicSettingValue(settings, "desktop-grid", "snap-to-grid", DEFAULT_DESKTOP_GRID_SETTINGS.snapToGrid),
    gridSize: publicSettingValue(settings, "desktop-grid", "grid-size", DEFAULT_DESKTOP_GRID_SETTINGS.gridSize),
    wallpaper: publicSettingValue(settings, "wallpaper", "layout", DEFAULT_WALLPAPER),
    widgets: publicSettingValue(settings, "widgets", "layout", []),
    iconGroups: publicSettingValue(settings, "icon-groups", "layout", []),
  });
  const themeSettings = settings.filter((setting) => setting.namespace === "custom-themes");
  const selection = settings.find((setting) => setting.namespace === "theme-selection" && setting.key === "selected");
  const parsedAppearance = parseThemeState({ selectedThemeId: selection?.value ?? DEFAULT_THEME_STATE.selectedThemeId, customThemes: themeSettings.map((setting) => parseCustomTheme(setting.value)) });
  const appearance = {
    selectedThemeId: parsedAppearance.selectedThemeId,
    selectionRevision: selection?.logicalTime ?? 0,
    customThemes: parsedAppearance.customThemes.map((theme, index) => ({ ...theme, revision: themeSettings[index]!.logicalTime })),
  };
  assertWallpaperSource(entries, layout.wallpaper, appearance);
  assertIconGroupFolders(entries, layout);
  assertSceneFiles(entries, layout);
  return {
    schemaVersion: 2,
    catalogId: first.workspaceId,
    catalogRevision: first.asOf,
    id: first.workspaceId,
    name: first.workspaceName,
    pinned: false,
    ownership: "shared",
    role: "reader",
    owner: first.owner,
    capabilities: { read: true, write: false, manage: false, delete: false, settings: false, activity: false },
    authorityCatalogId: first.workspaceId,
    entries,
    layout,
    layoutRevision: Math.max(0, ...layoutSettings.map((setting) => setting.logicalTime)),
    editorSettings: DEFAULT_EDITOR_SETTINGS,
    settingsRevision: 0,
    appearance,
    ...(first.publishedRootId ? { publishedRootId: first.publishedRootId } : {}),
    thumbnailProfile: THUMBNAIL_PROFILE,
  };
}

/** Returns the content identity captured for a public file snapshot. */
async function publicIdentity(authority: PublicAuthority, file: FileEntry) {
  const identity = contentIdentities.get(contentKey(authority, file.id));
  if (!identity) throw new Error("That file is not part of this public snapshot.");
  return identity;
}

/** Downloads and reconstructs a public file from verified chunks. */
export async function fetchPublicFile(authority: PublicAuthority, file: FileEntry, _contentRevision: number, _fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), _purpose?: "preview") {
  void _contentRevision; void _fetchImpl; void _purpose;
  const identity = await publicIdentity(authority, file);
  let content: Awaited<ReturnType<typeof fetchPublicNodeContent>>;
  try {
    content = await fetchPublicNodeContent(authority.desktopAlias, file.id, identity.manifestHash, identity.asOf, authority.itemAlias);
  } catch (error) {
    if (error instanceof Web2HTTPError && error.status === 401) throw new LargeDownloadAuthRequiredError(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`);
    throw error;
  }
  const chunks = new Map<string, Uint8Array>();
  for (const descriptor of content.chunks) chunks.set(descriptor.hash, await downloadWeb2Chunk(descriptor));
  const blob = new Blob(content.manifest.chunks.map(({ hash }) => chunks.get(hash)!), { type: file.mimeType });
  if (blob.size !== file.size) throw new Error("The downloaded file has an unexpected size.");
  return new File([blob], file.name, { type: file.mimeType, lastModified: file.modifiedAt });
}

/** Downloads and verifies a generated public thumbnail. */
export async function fetchPublicThumbnail(authority: PublicAuthority, file: FileEntry, contentRevision: number, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
  if (!supportsThumbnailMime(file.mimeType) || file.size > THUMBNAIL_MAX_SOURCE_SIZE || !Number.isSafeInteger(contentRevision) || contentRevision <= 0) throw new Error("Generated thumbnails are unavailable for this file.");
  const identity = await publicIdentity(authority, file);
  const result = await fetchPublicWeb2Thumbnail(authority.desktopAlias, file.id, identity.contentOperationId, identity.manifestHash, identity.asOf, authority.itemAlias);
  if (result.state !== "ready") throw new Error("The thumbnail is still being generated.");
  const response = await fetchImpl(result.value.access.url, { method: "GET", headers: result.value.access.headers, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error(`The thumbnail could not be downloaded (${response.status}).`);
  const blob = await response.blob();
  if (blob.size !== result.value.size || await sha256Blob(blob) !== result.value.sha256) throw new Error("The thumbnail failed integrity validation.");
  return blob;
}

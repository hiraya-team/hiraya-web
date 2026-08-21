import {
  DEFAULT_GRID_SIZE,
  GRID_SIZES,
  MAX_LAYOUT_DIMENSION,
  WALLPAPERS,
  type DesktopEntry,
  type DesktopIdentity,
  type DesktopIconGroup,
  type DesktopLayout,
  type DesktopWidget,
  type RootEntryPositionUpdate,
  type EditorLanguage,
  type EditorSettings,
  type EntryPosition,
  type GridSize,
  type Wallpaper,
} from "../types";
import { localDesktopIdentity, READ_ONLY_CAPABILITIES } from "./permissions";
import { isBuiltinThemeId, parseCustomTheme, parseThemeState } from "./themes";
import type { CustomTheme, ThemeState } from "../domain/theme";
import { HIRAYA_SCENE_MIME_TYPE, isSceneFile, MAX_SCENE_BYTES } from "../domain/scene";
import { parseAuthorityIdentity } from "./wire-authority";
import { DEFAULT_FILE_CREATION_TEMPLATES, parseFileCreationTemplates } from "./file-creation-templates";

/** Defines the editor languages. */
const EDITOR_LANGUAGES = new Set<EditorLanguage>(["auto", "plain", "markdown", "json", "javascript", "typescript", "jsx", "tsx", "css", "html", "xml", "yaml"]);
/** Lists the supported wallpaper IDs. */
const WALLPAPER_IDS = new Set<string>(WALLPAPERS);
/** Defines the wallpaper color. */
const WALLPAPER_COLOR = /^#[0-9A-F]{6}$/;
/** Lists the supported wallpaper image types. */
const WALLPAPER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Defines the maximum wallpaper file size. */
const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;
/** Lists the supported wallpaper keys. */
const WALLPAPER_KEYS = new Set(["source", "fit", "positionX", "positionY", "blur", "dim", "overlayColor", "overlayOpacity"]);

/** Reports whether a file is a supported wallpaper image. */
export function isWallpaperFile(entry: DesktopEntry) {
  return entry.kind === "file" && (isSceneFile(entry) || WALLPAPER_IMAGE_TYPES.has(entry.mimeType.split(";", 1)[0].trim().toLowerCase()) && entry.size <= MAX_WALLPAPER_BYTES);
}
/** Matches the expected MIME token. */
const MIME_TOKEN = "[!#$%&'*+.^_`|~\\w-]+";
/** Matches the expected MIME type. */
const MIME_TYPE = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}(?:\\s*;\\s*${MIME_TOKEN}\\s*=\\s*(?:${MIME_TOKEN}|"(?:[^"\\\\]|\\\\.)*"))*\\s*$`);
/** Defines the MIME parameter name. */
const MIME_PARAMETER_NAME = new RegExp(`;\\s*(${MIME_TOKEN})\\s*=`, "g");

export type RemoteEntry = DesktopEntry & { revision: number; contentRevision: number };
export type RemoteCustomTheme = CustomTheme & { revision: number };
export type RemoteAppearance = Omit<ThemeState, "customThemes"> & { selectionRevision: number; customThemes: RemoteCustomTheme[] };
type RemoteDesktopIdentity = DesktopIdentity & {
  schemaVersion: 2;
  catalogId: string;
  catalogRevision: number;
};

export type RemoteDesktopState = RemoteDesktopIdentity & {
  entries: RemoteEntry[];
  layout: DesktopLayout;
  layoutRevision: number;
  editorSettings: EditorSettings;
  settingsRevision: number;
  appearance: RemoteAppearance;
};

export type TrashItem = {
  entry: TrashEntry;
  entries: TrashEntry[];
  deletedAt: number;
  descendantCount: number;
};

export type TrashDocument = {
  schemaVersion: 2;
  catalogId: string;
  catalogRevision: number;
  desktopId: string;
  items: TrashItem[];
};

export type TrashRestoreResult = { catalogRevision: number; entries: RemoteEntry[] };
export type TrashDeleteResult = { catalogRevision: number; deletedIds: string[] };
export type TrashEntry = RemoteEntry & { sha256?: string };

/** Defines the system roles. */
export const SYSTEM_ROLES = ["layout", "editor-settings", "theme-selection", "theme-definition", "theme-package"] as const;
export type SystemRole = typeof SYSTEM_ROLES[number];
export type SystemEntry = {
  kind: "file";
  id: string;
  name: string;
  systemRole: SystemRole;
  systemKey?: string;
  path: string;
  mimeType: string;
  size: number;
  revision: number;
  contentRevision: number;
  sha256: string;
};
export type SystemEntriesDocument = { schemaVersion: 2; catalogId: string; catalogRevision: number; desktopId: string; entries: SystemEntry[] };

export type DirectBlobAccess = { url: string; method: "GET" | "PUT"; headers: Record<string, string>; expiresAt: number };
export type ContentAccessDescriptor = { entryId: string; contentRevision: number; size: number; sha256: string; access: DirectBlobAccess };
export type ContentAccessExpectations = {
  desktopId?: string;
  trashRootId?: string;
  sha256?: string;
  systemRole?: SystemRole;
  systemKey?: string;
  catalogId?: string;
};

/** Matches a lowercase SHA-256 digest. */
const SHA256_HEX = /^[a-f0-9]{64}$/;
/** Defines the header name. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~\w-]+$/;
/** Defines the forbidden direct headers. */
const FORBIDDEN_DIRECT_HEADERS = new Set(["authorization", "connection", "content-length", "cookie", "cookie2", "host", "origin", "referer", "transfer-encoding", "upgrade"]);

/** Parses and validates direct URL. */
function parseDirectUrl(value: unknown, expectedOrigin?: string) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("A direct blob target has an invalid URL.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("A direct blob target has an invalid URL."); }
  const loopback = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const browserLocation = (globalThis as typeof globalThis & { location?: { hostname: string } }).location;
  const localDevelopment = browserLocation !== undefined && loopback(browserLocation.hostname) && loopback(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localDevelopment) || url.username || url.password || url.hash) {
    throw new Error("A direct blob target must use a safe HTTPS URL.");
  }
  if (expectedOrigin && url.origin !== expectedOrigin) throw new Error("A direct blob target has an unexpected origin.");
  return url.href;
}

/** Parses and validates direct headers. */
function parseDirectHeaders(value: unknown) {
  if (!isRecord(value)) throw new Error("A direct blob target has invalid headers.");
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [name, headerValue] of Object.entries(value)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(name) || seen.has(lower) || FORBIDDEN_DIRECT_HEADERS.has(lower) || lower.startsWith("proxy-") || lower.startsWith("sec-") || typeof headerValue !== "string" || /[\r\n]/.test(headerValue)) {
      throw new Error("A direct blob target contains an unsafe header.");
    }
    seen.add(lower);
    headers[name] = headerValue;
  }
  return headers;
}

/** Parses and validates a SHA-256 digest. */
function parseSha256(value: unknown) {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) throw new Error("A blob has an invalid SHA-256 digest.");
  return value;
}

/** Parses and validates direct blob access. */
export function parseDirectBlobAccess(value: unknown, method: "GET" | "PUT", expectedOrigin?: string): DirectBlobAccess {
  if (!isRecord(value) || value.method !== method) throw new Error(`A direct blob target must use ${method}.`);
  const expiresAt = readNonNegativeInteger(value.expiresAt, "A direct blob target has an invalid expiration.");
  return { url: parseDirectUrl(value.url, expectedOrigin), method, headers: parseDirectHeaders(value.headers), expiresAt };
}

/** Parses and validates content access descriptor. */
export function parseContentAccessDescriptor(value: unknown, expectedEntryId: string, expectedRevision: number, expectedSize: number, expectedOrigin?: string, expected: ContentAccessExpectations = {}): ContentAccessDescriptor {
  if (!isRecord(value) || value.entryId !== expectedEntryId) throw new Error("The content access response is for a different entry.");
  if (expected.desktopId !== undefined && value.desktopId !== expected.desktopId) throw new Error("The content access response is for a different desktop.");
  if (expected.trashRootId !== undefined && value.trashRootId !== expected.trashRootId) throw new Error("The content access response is for a different Trash root.");
  if (expected.systemRole !== undefined && (value.systemRole !== expected.systemRole || (value.systemKey ?? "") !== (expected.systemKey ?? ""))) throw new Error("The content access response is for a different system resource.");
  if (expected.catalogId !== undefined && (value.catalogId !== undefined || value.schemaVersion !== undefined)) parseAuthorityIdentity(value, "The content access response", expected.catalogId);
  const contentRevision = readRevision(value.contentRevision, "The content access response has an invalid revision.");
  const size = readNonNegativeInteger(value.size, "The content access response has an invalid size.");
  if (contentRevision !== expectedRevision) throw new Error("The content access response is for a different revision.");
  if (size !== expectedSize) throw new Error("The content access response has an unexpected size.");
  const sha256 = parseSha256(value.sha256);
  if (expected.sha256 !== undefined && sha256 !== expected.sha256) throw new Error("The content access response has an unexpected SHA-256 digest.");
  return { entryId: expectedEntryId, contentRevision, size, sha256, access: parseDirectBlobAccess(value.access, "GET", expectedOrigin) };
}

/** Reports whether a value is a plain record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads string. */
function readString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

/** Reports whether a value is a valid ID. */
export function isValidId(value: unknown): value is string {
  if (typeof value !== "string" || !value || value === "." || value === ".." || value.includes("/") || value.includes("\\")) return false;
  if (new TextEncoder().encode(value).byteLength > 180) return false;
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

/** Parses and validates an ID. */
export function assertValidId(value: unknown, message = "An entry has an invalid ID."): asserts value is string {
  if (!isValidId(value)) throw new Error(message);
}

/** Normalizes entry name. */
export function normalizeEntryName(value: string) {
  const name = value.trim();
  assertCanonicalEntryName(name);
  return name;
}

/** Normalizes desktop name. */
export function normalizeDesktopName(value: string) {
  const name = value.trim();
  if (!name || name === "." || name === ".." || [...name].length > 180 || name.includes("/") || name.includes("\\") || [...name].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  })) throw new Error("A desktop has an invalid name.");
  return name;
}

/** Parses and validates desktop identity. */
export function parseDesktopIdentity(value: unknown, localDefaults = false): DesktopIdentity {
  if (!isRecord(value)) throw new Error("A desktop has an unsupported format.");
  assertValidId(value.id, "A desktop has an invalid ID.");
  const name = normalizeDesktopName(typeof value.name === "string" ? value.name : "");
  if (value.ownership === undefined && localDefaults) return localDesktopIdentity(value.id, name);
  if (value.ownership !== "owned" && value.ownership !== "shared") throw new Error("A desktop has invalid ownership.");
  if (value.role !== "owner" && value.role !== "manager" && value.role !== "writer" && value.role !== "reader") throw new Error("A desktop has an invalid role.");
  if (!isRecord(value.owner) || !isValidId(value.owner.id) || typeof value.owner.displayName !== "string" || !value.owner.displayName.trim() || value.owner.avatar !== null && typeof value.owner.avatar !== "string") {
    throw new Error("A desktop has invalid owner metadata.");
  }
  const capabilities = value.capabilities;
  if (!isRecord(capabilities) || ["read", "write", "manage", "delete", "settings", "activity"].some((key) => typeof capabilities[key] !== "boolean")) {
    throw new Error("A desktop has invalid capabilities.");
  }
  if (value.authorityCatalogId !== null && !isValidId(value.authorityCatalogId)) throw new Error("A desktop has an invalid authority catalog.");
  if (value.purpose !== undefined && value.purpose !== "app-store") throw new Error("A desktop has an invalid purpose.");
  return {
    id: value.id,
    name,
    pinned: typeof value.pinned === "boolean" ? value.pinned : false,
    ownership: value.ownership,
    role: value.role,
    owner: { id: value.owner.id, displayName: value.owner.displayName.trim(), avatar: value.owner.avatar },
    capabilities: {
      read: capabilities.read as boolean,
      write: capabilities.write as boolean,
      manage: capabilities.manage as boolean,
      delete: capabilities.delete as boolean,
      settings: capabilities.settings as boolean,
      activity: capabilities.activity as boolean,
    },
    authorityCatalogId: value.authorityCatalogId,
    ...(value.purpose === "app-store" ? { purpose: value.purpose } : {}),
  };
}

/** Asserts that a value is a canonical entry name. */
export function assertCanonicalEntryName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || value.trim() !== value || value === "." || value === "..") {
    throw new Error("An entry has an invalid name.");
  }
  if ([...value].length > 180 || value.includes("/") || value.includes("\\") || [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  })) {
    throw new Error("An entry has an invalid name.");
  }
}

/** Computes fold entry name. */
export function foldEntryName(value: string) {
  return value.toLowerCase();
}

/** Reads finite number. */
function readFiniteNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

/** Reads a non-negative integer. */
function readNonNegativeInteger(value: unknown, message: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(message);
  return value as number;
}

/** Reads a required nullable non-negative integer. */
function readRequiredNullableNonNegativeInteger(value: unknown, message: string): number | null {
  if (value === undefined) throw new Error(message);
  return value === null ? null : readNonNegativeInteger(value, message);
}

/** Reads revision. */
export function readRevision(value: unknown, message = "A revision has an unsupported format.") {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(message);
  return value as number;
}

/** Reports whether a value is a valid MIME type. */
export function isValidMimeType(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 255 || value.trim() !== value || [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  }) || !MIME_TYPE.test(value)) return false;
  const names = new Set<string>();
  MIME_PARAMETER_NAME.lastIndex = 0;
  for (let match = MIME_PARAMETER_NAME.exec(value); match; match = MIME_PARAMETER_NAME.exec(value)) {
    const name = match[1].toLowerCase();
    if (names.has(name)) return false;
    names.add(name);
  }
  return true;
}

/** Parses and validates position. */
export function parsePosition(value: unknown): EntryPosition {
  if (!isRecord(value)) throw new Error("An entry has an invalid position.");
  return {
    x: readFiniteNumber(value.x, "An entry has an invalid position."),
    y: readFiniteNumber(value.y, "An entry has an invalid position."),
  };
}

/** Parses and validates wallpaper. */
export function parseWallpaper(value: unknown, allowLegacyPreset = false): Wallpaper {
  if (allowLegacyPreset && typeof value === "string" && WALLPAPER_IDS.has(value)) {
    return { source: value as Wallpaper["source"], fit: "cover", positionX: 50, positionY: 50, blur: 0, dim: 0, overlayColor: "#000000", overlayOpacity: 0 };
  }
  if (!isRecord(value)
    || Object.keys(value).length !== WALLPAPER_KEYS.size
    || Object.keys(value).some((key) => !WALLPAPER_KEYS.has(key))
    || typeof value.source !== "string"
    || !(WALLPAPER_IDS.has(value.source) || value.source.startsWith("file:") && isValidId(value.source.slice(5)) || value.source.startsWith("theme:") && isValidId(value.source.slice(6)))
    || value.fit !== "cover" && value.fit !== "contain"
    || !Number.isInteger(value.positionX) || (value.positionX as number) < 0 || (value.positionX as number) > 100
    || !Number.isInteger(value.positionY) || (value.positionY as number) < 0 || (value.positionY as number) > 100
    || !Number.isInteger(value.blur) || (value.blur as number) < 0 || (value.blur as number) > 24
    || typeof value.dim !== "number" || !Number.isFinite(value.dim) || value.dim < 0 || value.dim > 0.8
    || typeof value.overlayColor !== "string" || !WALLPAPER_COLOR.test(value.overlayColor)
    || typeof value.overlayOpacity !== "number" || !Number.isFinite(value.overlayOpacity) || value.overlayOpacity < 0 || value.overlayOpacity > 0.8) {
    throw new Error("The desktop wallpaper has an unsupported format.");
  }
  return value as Wallpaper;
}

/** Validates wallpaper source. */
export function assertWallpaperSource(entries: readonly DesktopEntry[], wallpaper: Wallpaper, appearance?: ThemeState) {
  if (wallpaper.source.startsWith("theme:")) {
    if (appearance && !appearance.customThemes.some((theme) => theme.id === wallpaper.source.slice(6) && theme.wallpaper)) {
      throw new Error("The packaged wallpaper must reference a custom theme on this desktop.");
    }
    return;
  }
  if (!wallpaper.source.startsWith("file:")) return;
  const file = entries.find((entry) => entry.id === wallpaper.source.slice(5));
  if (!file || !isWallpaperFile(file)) {
    throw new Error("The custom wallpaper must reference a JPEG, PNG, WebP, or Scene file on this desktop within its size limit.");
  }
}

/** Parses and validates layout. */
export function parseLayout(value: unknown, allowLegacyWallpaper = false): DesktopLayout {
  if (!isRecord(value) || typeof value.snapToGrid !== "boolean") {
    throw new Error("The desktop layout has an unsupported format.");
  }
  const gridSize = value.gridSize === undefined ? DEFAULT_GRID_SIZE : value.gridSize;
  if (!GRID_SIZES.includes(gridSize as GridSize)) throw new Error("The desktop layout has an unsupported grid size.");
  const autoArrangeIcons = value.autoArrangeIcons === undefined ? true : value.autoArrangeIcons;
  if (typeof autoArrangeIcons !== "boolean") throw new Error("The desktop layout has an unsupported auto-arrange setting.");
  const widgets = value.widgets === undefined ? [] : parseWidgets(value.widgets);
  const iconGroups = value.iconGroups === undefined ? [] : parseIconGroups(value.iconGroups);
  return { autoArrangeIcons, snapToGrid: value.snapToGrid, gridSize: gridSize as GridSize, wallpaper: parseWallpaper(value.wallpaper, allowLegacyWallpaper), widgets, iconGroups };
}

/** Parses and validates widgets. */
function parseWidgets(value: unknown): DesktopWidget[] {
  if (!Array.isArray(value)) throw new Error("The desktop widgets have an unsupported format.");
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!isRecord(candidate) || Object.keys(candidate).some((key) => !["id", "kind", "fileId", "x", "y", "width", "height"].includes(key))) throw new Error("A desktop widget has an unsupported format.");
    assertValidId(candidate.id, "A desktop widget has an invalid ID.");
    if (ids.has(candidate.id)) throw new Error("The desktop widgets contain duplicate IDs.");
    ids.add(candidate.id);
    if (!(["clock", "calendar", "status", "todo", "scene"] as unknown[]).includes(candidate.kind)) throw new Error("A desktop widget has an unsupported kind.");
    if (candidate.kind === "todo" || candidate.kind === "scene") assertValidId(candidate.fileId, `A ${candidate.kind === "scene" ? "Scene" : "Todo"} widget has an invalid file ID.`);
    else if (candidate.fileId !== undefined) throw new Error("A desktop widget has an unsupported format.");
    const x = readFiniteNumber(candidate.x, "A desktop widget has invalid bounds.");
    const y = readFiniteNumber(candidate.y, "A desktop widget has invalid bounds.");
    const width = readFiniteNumber(candidate.width, "A desktop widget has invalid bounds.");
    const height = readFiniteNumber(candidate.height, "A desktop widget has invalid bounds.");
    if (width <= 0 || width > MAX_LAYOUT_DIMENSION || height <= 0 || height > MAX_LAYOUT_DIMENSION) throw new Error("A desktop widget has invalid bounds.");
    return candidate.kind === "todo" || candidate.kind === "scene"
      ? { id: candidate.id, kind: candidate.kind, fileId: candidate.fileId as string, x, y, width, height }
      : { id: candidate.id, kind: candidate.kind as "clock" | "calendar" | "status", x, y, width, height };
  });
}

/** Parses and validates icon groups. */
function parseIconGroups(value: unknown): DesktopIconGroup[] {
  if (!Array.isArray(value)) throw new Error("The desktop icon groups have an unsupported format.");
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!isRecord(candidate) || Object.keys(candidate).length !== 3 || Object.keys(candidate).some((key) => !["folderId", "width", "height"].includes(key))) throw new Error("A desktop icon group has an unsupported format.");
    assertValidId(candidate.folderId, "A desktop icon group has an invalid folder ID.");
    if (ids.has(candidate.folderId)) throw new Error("The desktop icon groups contain duplicate folder IDs.");
    ids.add(candidate.folderId);
    const width = readFiniteNumber(candidate.width, "A desktop icon group has invalid bounds.");
    const height = readFiniteNumber(candidate.height, "A desktop icon group has invalid bounds.");
    if (width <= 0 || width > MAX_LAYOUT_DIMENSION || height <= 0 || height > MAX_LAYOUT_DIMENSION) throw new Error("A desktop icon group has invalid bounds.");
    return { folderId: candidate.folderId, width, height };
  });
}

/** Validates icon group folders. */
export function assertIconGroupFolders(entries: readonly DesktopEntry[], layout: DesktopLayout) {
  if (layout.iconGroups.some((group) => !entries.some((entry) => entry.id === group.folderId && entry.kind === "folder" && entry.parentId === null))) {
    throw new Error("A desktop icon group must reference a root folder on the same desktop.");
  }
}

/** Validates scene files. */
export function assertSceneFiles(entries: readonly DesktopEntry[], layout: DesktopLayout) {
  for (const widget of layout.widgets) {
    if (widget.kind !== "scene") continue;
    const file = entries.find((entry) => entry.id === widget.fileId);
    if (file && (file.kind !== "file" || !isSceneFile(file))) throw new Error(`A Scene widget must reference a ${HIRAYA_SCENE_MIME_TYPE} file on the same desktop no larger than ${MAX_SCENE_BYTES / 1024 / 1024} MiB.`);
  }
}

/** Parses and validates root entry positions. */
export function parseRootEntryPositions(value: unknown): RootEntryPositionUpdate[] {
  if (!Array.isArray(value)) throw new Error("Root entry positions have an unsupported format.");
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("A root entry position has an unsupported format.");
    assertValidId(candidate.entryId, "A root entry position has an invalid entry ID.");
    if (ids.has(candidate.entryId)) throw new Error("Root entry positions contain duplicate entry IDs.");
    ids.add(candidate.entryId);
    return { entryId: candidate.entryId, position: parsePosition(candidate.position) };
  });
}

/** Parses and validates root entry position updates. */
export function parseRootEntryPositionUpdates(value: unknown, entries: DesktopEntry[]): RootEntryPositionUpdate[] {
  const positions = parseRootEntryPositions(value);
  if (positions.length === 0) throw new Error("At least one root entry position is required.");
  const roots = new Set(entries.filter((entry) => entry.parentId === null).map((entry) => entry.id));
  if (positions.some(({ entryId }) => !roots.has(entryId))) throw new Error("Root entry positions require root entries.");
  return positions;
}

/** Parses and validates editor settings. */
export function parseEditorSettings(value: unknown): EditorSettings {
  if (!isRecord(value) || typeof value.autoSave !== "boolean" || !Number.isInteger(value.fontSize) || (value.fontSize as number) < 11 || (value.fontSize as number) > 22 || typeof value.language !== "string" || !EDITOR_LANGUAGES.has(value.language as EditorLanguage)) {
    throw new Error("The editor settings have an unsupported format.");
  }
  if (value.lineWrap !== undefined && typeof value.lineWrap !== "boolean" || value.autoFormat !== undefined && typeof value.autoFormat !== "boolean") {
    throw new Error("The editor settings have an unsupported format.");
  }
  return {
    autoSave: value.autoSave,
    autoFormat: value.autoFormat as boolean | undefined ?? false,
    fontSize: value.fontSize as number,
    language: value.language as EditorLanguage,
    lineWrap: value.lineWrap as boolean | undefined ?? true,
    fileCreationTemplates: parseFileCreationTemplates(value.fileCreationTemplates ?? DEFAULT_FILE_CREATION_TEMPLATES),
  };
}

type ParsedEntry = DesktopEntry & { revision?: number; contentRevision?: number };

/** Parses and validates entry. */
function parseEntry(value: unknown, remote: boolean): ParsedEntry {
  if (!isRecord(value) || (value.kind !== "file" && value.kind !== "folder")) throw new Error("An entry has an unsupported format.");
  if (remote && (value.systemRole !== undefined || value.systemKey !== undefined)) throw new Error("A visible entry contains protected system metadata.");
  assertValidId(value.id);
  assertCanonicalEntryName(value.name);
  if (value.parentId !== null && !isValidId(value.parentId)) throw new Error("An entry has an invalid parent ID.");
  const base = {
    kind: value.kind,
    id: value.id,
    name: value.name,
    parentId: value.parentId,
    createdAt: readRequiredNullableNonNegativeInteger(value.createdAt, "An entry has an invalid creation date."),
    modifiedAt: readNonNegativeInteger(value.modifiedAt, "An entry has an invalid modification date."),
    position: parsePosition(value.position),
  } as const;
  const revisions = remote ? {
    revision: readRevision(value.revision, "An entry has an invalid revision."),
    contentRevision: readRevision(value.contentRevision, "An entry has an invalid content revision."),
  } : {};
  if (value.kind === "folder") {
    if (value.mimeType !== undefined || value.size !== undefined) throw new Error("Folders cannot have file metadata.");
    return { ...base, kind: "folder", ...revisions };
  }
  const mimeType = readString(value.mimeType, "A file has invalid metadata.");
  if (!isValidMimeType(mimeType) || !Number.isSafeInteger(value.size) || (value.size as number) < 0) {
    throw new Error("A file has invalid metadata.");
  }
  return { ...base, kind: "file", mimeType, size: value.size as number, ...revisions };
}

/** Parses and validates remote entry. */
export function parseRemoteEntry(value: unknown): RemoteEntry {
  return parseEntry(value, true) as RemoteEntry;
}

/** Parses and validates local entry. */
export function parseLocalEntry(value: unknown): DesktopEntry {
  return parseEntry(value, false);
}

/** Parses and validates entries. */
export function parseEntries(value: unknown, remote = false): ParsedEntry[] {
  if (!Array.isArray(value)) throw new Error("The desktop entries have an unsupported format.");
  const entries = value.map((candidate) => parseEntry(candidate, remote));
  const byId = new Map<string, ParsedEntry>();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new Error("The desktop contains duplicate entry IDs.");
    byId.set(entry.id, entry);
  }
  const siblingNames = new Map<string, Set<string>>();
  for (const entry of entries) {
    const parentKey = entry.parentId ?? "\0";
    if (entry.parentId !== null) {
      const parent = byId.get(entry.parentId);
      if (!parent || parent.kind !== "folder") throw new Error("An entry refers to a missing parent folder.");
    }
    const names = siblingNames.get(parentKey) ?? new Set<string>();
    const folded = foldEntryName(entry.name);
    if (names.has(folded)) throw new Error(`The desktop contains duplicate entries named “${entry.name}”.`);
    names.add(folded);
    siblingNames.set(parentKey, names);

    const seen = new Set([entry.id]);
    let parentId = entry.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) throw new Error("The desktop contains a folder cycle.");
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  return entries;
}

/** Parses and validates trash entry. */
function parseTrashEntry(value: unknown): TrashEntry {
  const entry = parseRemoteEntry(value) as TrashEntry;
  if (isRecord(value) && value.sha256 !== undefined) {
    if (entry.kind !== "file") throw new Error("A Trash folder contains a content digest.");
    entry.sha256 = parseSha256(value.sha256);
  }
  return entry;
}

/** Parses and validates trash document. */
export function parseTrashDocument(value: unknown, expectedDesktopId?: string, expectedCatalogId?: string | null): TrashDocument {
  if (!isRecord(value)) throw new Error("The server Trash response has an unsupported format.");
  const authority = parseAuthorityIdentity(value, "The server Trash response", expectedCatalogId);
  assertValidId(value.desktopId, "The server Trash response has an invalid desktop identity.");
  if (expectedDesktopId !== undefined && value.desktopId !== expectedDesktopId) throw new Error("The server Trash response is for a different desktop.");
  if (!Array.isArray(value.items)) throw new Error("The server Trash response has invalid items.");
  const catalogRevision = readRevision(value.catalogRevision);
  const ids = new Set<string>();
  const items = value.items.map((candidate): TrashItem => {
    if (!isRecord(candidate)) throw new Error("A Trash item has an unsupported format.");
    const entry = parseTrashEntry(candidate.entry);
    if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) throw new Error("A Trash item is missing its entry subtree.");
    const entries = candidate.entries.map(parseTrashEntry);
    const root = entries.find((item) => item.id === entry.id);
    if (!root || JSON.stringify(root) !== JSON.stringify(entry)) throw new Error("A Trash item subtree does not match its root entry.");
    if (entry.parentId !== null && entries.some((item) => item.id === entry.parentId)) throw new Error("A Trash root parent must be outside its subtree.");
    const descendantCount = readNonNegativeInteger(candidate.descendantCount, "A Trash item has an invalid descendant count.");
    if (descendantCount !== entries.length - 1) throw new Error("A Trash item has an inconsistent descendant count.");
    parseEntries(entries.map((item) => item.id === entry.id ? { ...item, parentId: null } : item), true);
    for (const item of entries) {
      if (ids.has(item.id)) throw new Error("The server Trash response contains duplicate entry IDs.");
      if (item.revision > catalogRevision || item.contentRevision > catalogRevision) throw new Error("A Trash item has a revision newer than its catalog.");
      ids.add(item.id);
    }
    return {
      entry,
      entries,
      deletedAt: readNonNegativeInteger(candidate.deletedAt, "A Trash item has an invalid deletion date."),
      descendantCount,
    };
  });
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (current.deletedAt > previous.deletedAt || current.deletedAt === previous.deletedAt && current.entry.id < previous.entry.id) {
      throw new Error("The server Trash response is not newest-first.");
    }
  }
  return {
    schemaVersion: 2,
    catalogId: authority.catalogId,
    catalogRevision,
    desktopId: value.desktopId,
    items,
  };
}

/** Computes system entry path. */
export function systemEntryPath(role: SystemRole, key?: string) {
  if (role === "layout") return ".hiraya/desktop/settings/layout.json";
  if (role === "editor-settings") return ".hiraya/desktop/settings/editor.json";
  if (role === "theme-selection") return ".hiraya/desktop/appearance/applied-theme.json";
  if (!key) throw new Error("A keyed system entry is missing its key.");
  return role === "theme-definition" ? `.hiraya/desktop/appearance/themes/${key}.theme.json` : `.hiraya/desktop/appearance/packages/${key}.hiraya.app`;
}

/** Parses and validates system entry. */
export function parseSystemEntry(value: unknown): SystemEntry {
  if (!isRecord(value) || value.kind !== "file") throw new Error("A system entry has an unsupported format.");
  assertValidId(value.id, "A system entry has an invalid ID.");
  assertCanonicalEntryName(value.name);
  if (!SYSTEM_ROLES.includes(value.systemRole as SystemRole)) throw new Error("A system entry has an invalid role.");
  const role = value.systemRole as SystemRole;
  const keyed = role === "theme-definition" || role === "theme-package";
  if (keyed ? !isValidId(value.systemKey) : value.systemKey !== undefined) throw new Error("A system entry has an invalid key.");
  const key = keyed ? value.systemKey as string : undefined;
  const expectedName = role === "theme-definition" ? `${key}.theme.json` : role === "theme-package" ? `${key}.hiraya.app` : `${role}.json`;
  const expectedMimeType = role === "theme-package" ? "application/vnd.hiraya.theme+zip" : "application/json";
  const path = systemEntryPath(role, key);
  if (value.name !== expectedName) throw new Error("A system entry has an invalid name for its role.");
  if (value.mimeType !== expectedMimeType) throw new Error("A system entry has an invalid MIME type for its role.");
  if (value.path !== undefined && value.path !== path) throw new Error("A system entry has an invalid metadata path for its role.");
  const size = readNonNegativeInteger(value.size, "A system entry has an invalid size.");
  if (size === 0) throw new Error("A system entry cannot be empty.");
  const revision = readRevision(value.revision, "A system entry has an invalid revision.");
  const contentRevision = readRevision(value.contentRevision, "A system entry has an invalid content revision.");
  if (role !== "theme-package" && contentRevision !== revision) throw new Error("A system JSON entry has inconsistent revisions.");
  return {
    kind: "file",
    id: value.id,
    name: value.name,
    systemRole: role,
    ...(key ? { systemKey: key } : {}),
    path,
    mimeType: expectedMimeType,
    size,
    revision,
    contentRevision,
    sha256: parseSha256(value.sha256),
  };
}

/** Parses and validates system entries document. */
export function parseSystemEntriesDocument(value: unknown, expectedDesktopId?: string, expectedCatalogId?: string | null): SystemEntriesDocument {
  if (!isRecord(value) || !Array.isArray(value.entries)) throw new Error("The server system entries response has an unsupported format.");
  const authority = parseAuthorityIdentity(value, "The server system entries response", expectedCatalogId);
  assertValidId(value.desktopId, "The server system entries response has an invalid desktop identity.");
  if (expectedDesktopId !== undefined && value.desktopId !== expectedDesktopId) throw new Error("The server system entries response is for a different desktop.");
  const catalogRevision = readRevision(value.catalogRevision);
  const entries = value.entries.map(parseSystemEntry);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error("The server system entries response contains duplicate entry IDs.");
  const roleKeys = entries.map((entry) => `${entry.systemRole}\0${entry.systemKey ?? ""}`);
  if (new Set(roleKeys).size !== roleKeys.length) throw new Error("The server system entries response contains duplicate role keys.");
  for (const role of ["layout", "editor-settings", "theme-selection"] as const) if (entries.filter((entry) => entry.systemRole === role).length !== 1) throw new Error(`The server system entries response must contain exactly one ${role} entry.`);
  const definitions = new Set(entries.filter((entry) => entry.systemRole === "theme-definition").map((entry) => entry.systemKey));
  if (entries.some((entry) => entry.systemRole === "theme-package" && !definitions.has(entry.systemKey))) throw new Error("A system theme package is missing its theme definition.");
  if (entries.some((entry) => entry.revision > catalogRevision || entry.contentRevision > catalogRevision)) throw new Error("A system entry has a revision newer than its catalog.");
  return { schemaVersion: 2, catalogId: authority.catalogId, catalogRevision, desktopId: value.desktopId, entries };
}

/** Parses and validates system entry document. */
export function parseSystemEntryDocument(value: unknown, expectedDesktopId: string, expectedEntryId: string, expectedCatalogId?: string | null) {
  if (!isRecord(value) || value.schemaVersion !== 2 || value.desktopId !== expectedDesktopId || !isRecord(value.entry)) throw new Error("The server system entry response has an unsupported identity.");
  parseAuthorityIdentity(value, "The server system entry response", expectedCatalogId);
  const entry = parseSystemEntry(value.entry);
  if (entry.id !== expectedEntryId) throw new Error("The server system entry response is for a different entry.");
  if (entry.revision > readRevision(value.catalogRevision) || entry.contentRevision > readRevision(value.catalogRevision)) throw new Error("A system entry has a revision newer than its catalog.");
  return entry;
}

/** Parses and validates trash restore result. */
export function parseTrashRestoreResult(value: unknown, rootEntryId: string, destination?: "original" | "root"): TrashRestoreResult {
  if (!isRecord(value) || !Array.isArray(value.entries) || value.entries.length === 0) throw new Error("The Trash restore response has an unsupported format.");
  const catalogRevision = readRevision(value.catalogRevision);
  const entries = value.entries.map(parseRemoteEntry);
  const root = entries.find((entry) => entry.id === rootEntryId);
  if (!root) throw new Error("The Trash restore response is missing its root entry.");
  if (entries.some((entry) => entry.revision !== catalogRevision)) throw new Error("The Trash restore response has inconsistent entry revisions.");
  if (destination === "root" && root.parentId !== null) throw new Error("The Trash restore response did not restore its root to the desktop.");
  const normalized = entries.map((entry) => entry.id === rootEntryId ? { ...entry, parentId: null } : entry);
  parseEntries(normalized, true);
  return { catalogRevision, entries };
}

/** Parses and validates trash delete result. */
export function parseTrashDeleteResult(value: unknown): TrashDeleteResult {
  if (!isRecord(value) || !Array.isArray(value.deletedIds) || value.deletedIds.length === 0) throw new Error("The permanent-delete response has an unsupported format.");
  const deletedIds = value.deletedIds.map((id) => {
    assertValidId(id, "The permanent-delete response has an invalid entry ID.");
    return id;
  });
  if (new Set(deletedIds).size !== deletedIds.length) throw new Error("The permanent-delete response contains duplicate entry IDs.");
  return { catalogRevision: readRevision(value.catalogRevision), deletedIds };
}

/** Parses and validates remote desktop state. */
export function parseRemoteDesktopState(value: unknown): RemoteDesktopState {
  if (!isRecord(value)) throw new Error("The server desktop has an unsupported format.");
  const authority = parseAuthorityIdentity(value, "The server desktop");
  const identity = {
    ...authority,
    catalogRevision: readRevision(value.catalogRevision),
  };
  const entries = parseEntries(value.entries, true) as RemoteEntry[];
  const layout = parseLayout(value.layout);
  assertIconGroupFolders(entries, layout);
  assertSceneFiles(entries, layout);
  if (!isRecord(value.appearance) || !Array.isArray(value.appearance.customThemes)) throw new Error("The server appearance has an unsupported format.");
  const customThemes = value.appearance.customThemes.map((candidate) => {
    const theme = parseCustomTheme(candidate);
    if (!isRecord(candidate)) throw new Error("The server appearance has an unsupported format.");
    return { ...theme, revision: readRevision(candidate.revision, "A theme has an invalid revision.") };
  });
  const appearance = parseThemeState({ selectedThemeId: value.appearance.selectedThemeId, customThemes });
  assertWallpaperSource(entries, layout.wallpaper, appearance);
  if (!isBuiltinThemeId(appearance.selectedThemeId) && !customThemes.some((theme) => theme.id === appearance.selectedThemeId)) {
    throw new Error("The selected custom theme does not exist.");
  }
  const desktop = parseDesktopIdentity(value);
  return {
    ...identity,
    ...desktop,
    entries,
    layout,
    layoutRevision: readRevision(value.layoutRevision),
    editorSettings: parseEditorSettings(value.editorSettings),
    settingsRevision: readRevision(value.settingsRevision),
    appearance: { ...appearance, customThemes, selectionRevision: readRevision(value.appearance.selectionRevision, "The theme selection has an invalid revision.") },
  };
}

/** Parses and validates public desktop state. */
export function parsePublicDesktopState(value: unknown): RemoteDesktopState {
  if (!isRecord(value)) throw new Error("The public desktop has an unsupported format.");
  const owner = isRecord(value.owner) ? value.owner : null;
  assertValidId(value.id, "The public desktop has an invalid identity.");
  const normalized = {
    ...value,
    catalogId: value.id,
    catalogRevision: 0,
    ownership: "shared",
    role: "reader",
    owner,
    capabilities: { ...READ_ONLY_CAPABILITIES },
    authorityCatalogId: value.id,
  };
  return parseRemoteDesktopState(normalized);
}

import type { FileEntry } from "../types";
import { API_ROUTES } from "./api-routes";
import { sha256Blob } from "./blob-transfer";
import { isRecord, parseContentAccessDescriptor, parsePublicDesktopState, type RemoteDesktopState } from "./contracts";
import { isValidPublicationAlias } from "./sharing";
import { loadThumbnail, supportsThumbnailMime, THUMBNAIL_MAX_SOURCE_SIZE, THUMBNAIL_PROFILE } from "./thumbnails";

export class LargeDownloadAuthRequiredError extends Error {
  constructor(readonly loginUrl: string) {
    super("Sign in to download this large file.");
    this.name = "LargeDownloadAuthRequiredError";
  }
}

export type PublicAuthority = { desktopAlias: string; itemAlias?: string };

export function publicAuthorityFromPath(pathname: string): PublicAuthority | null {
  const match = /^\/published\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  return match && isValidPublicationAlias(match[1]) && (!match[2] || isValidPublicationAlias(match[2])) ? { desktopAlias: match[1], ...(match[2] ? { itemAlias: match[2] } : {}) } : null;
}

async function largeDownloadError(response: Response) {
  if (response.status !== 401) return null;
  const body = await response.clone().json().catch(() => null) as unknown;
  if (isRecord(body) && body.code === "large_download_auth_required" && typeof body.loginUrl === "string") return new LargeDownloadAuthRequiredError(body.loginUrl);
  return new Error("This public link is no longer available.");
}

export type PublicDesktopState = RemoteDesktopState & { publishedRootId?: string; thumbnailProfile?: typeof THUMBNAIL_PROFILE };

export async function fetchPublicDesktop(authority: PublicAuthority, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<PublicDesktopState> {
  const response = await fetchImpl(API_ROUTES.publicDesktop(authority.desktopAlias, authority.itemAlias), { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(response.status === 404 ? "This public desktop link is unavailable." : `The public desktop could not be loaded (${response.status}).`);
  const value = await response.json() as unknown;
  const parsed = parsePublicDesktopState(value);
  if (!isRecord(value)) return parsed;
  const capabilities = value.capabilities;
  if (capabilities !== undefined && (!isRecord(capabilities) || capabilities.thumbnails !== undefined && capabilities.thumbnails !== THUMBNAIL_PROFILE)) throw new Error("The public desktop contains unsupported thumbnail capability metadata.");
  return { ...parsed, ...(typeof value.publishedRootId === "string" ? { publishedRootId: value.publishedRootId } : {}), ...(isRecord(capabilities) && capabilities.thumbnails === THUMBNAIL_PROFILE ? { thumbnailProfile: THUMBNAIL_PROFILE } : {}) };
}

export function fetchPublicThumbnail(authority: PublicAuthority, file: FileEntry, contentRevision: number, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
  if (!supportsThumbnailMime(file.mimeType) || file.size > THUMBNAIL_MAX_SOURCE_SIZE || !Number.isSafeInteger(contentRevision) || contentRevision <= 0) throw new Error("Generated thumbnails are unavailable for this file.");
  return loadThumbnail({
    authority: `public/${authority.desktopAlias}/${authority.itemAlias ?? ""}`,
    entryId: file.id,
    contentRevision,
    endpoint: API_ROUTES.publicDesktopThumbnail(authority.desktopAlias, authority.itemAlias, file.id, contentRevision, THUMBNAIL_PROFILE),
    descriptorInit: { cache: "no-store", credentials: "omit" },
    fetchImpl,
  });
}

export async function fetchPublicFile(authority: PublicAuthority, file: FileEntry, contentRevision: number, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), purpose?: "preview") {
  const response = await fetchImpl(API_ROUTES.publicDesktopContent(authority.desktopAlias, authority.itemAlias, file.id, contentRevision, purpose), { cache: "no-store", credentials: "omit" });
  const gate = await largeDownloadError(response);
  if (gate) throw gate;
  if (!response.ok) throw new Error(`The file could not be downloaded (${response.status}).`);
  const descriptor = parseContentAccessDescriptor(await response.json(), file.id, contentRevision, file.size);
  const contentResponse = await fetchImpl(descriptor.access.url, { method: "GET", headers: descriptor.access.headers, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
  if (!contentResponse.ok) throw new Error(`The file could not be downloaded (${contentResponse.status}).`);
  const blob = await contentResponse.blob();
  if (blob.size !== descriptor.size) throw new Error("The downloaded file has an unexpected size.");
  if (await sha256Blob(blob) !== descriptor.sha256) throw new Error("The downloaded file failed integrity verification.");
  return new File([blob], file.name, { type: file.mimeType, lastModified: file.modifiedAt });
}

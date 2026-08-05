import type { FileEntry } from "../types";
import { API_ROUTES } from "./api-routes";
import { sha256Blob } from "./blob-transfer";
import { isRecord, parseContentAccessDescriptor, parsePublicDesktopState, type RemoteDesktopState } from "./contracts";
import { isValidPublicationAlias } from "./sharing";

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

export async function fetchPublicDesktop(authority: PublicAuthority, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<RemoteDesktopState & { publishedRootId?: string }> {
  const response = await fetchImpl(API_ROUTES.publicDesktop(authority.desktopAlias, authority.itemAlias), { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(response.status === 404 ? "This public desktop link is unavailable." : `The public desktop could not be loaded (${response.status}).`);
  const value = await response.json() as unknown;
  const parsed = parsePublicDesktopState(value);
  return isRecord(value) && typeof value.publishedRootId === "string" ? { ...parsed, publishedRootId: value.publishedRootId } : parsed;
}

export async function fetchPublicFile(authority: PublicAuthority, file: FileEntry, contentRevision: number, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), purpose?: "preview") {
  const response = await fetchImpl(API_ROUTES.publicDesktopContent(authority.desktopAlias, authority.itemAlias, file.id, contentRevision, purpose), { cache: "no-store", credentials: "same-origin" });
  const gate = await largeDownloadError(response);
  if (gate) throw gate;
  if (response.ok && !response.headers.get("content-type")?.includes("application/json")) {
    const blob = await response.blob();
    if (blob.size !== file.size) throw new Error("The downloaded file has an unexpected size.");
    const digest = response.headers.get("X-Hiraya-Content-SHA256");
    if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("The download did not include valid integrity metadata.");
    if (await sha256Blob(blob) !== digest) throw new Error("The downloaded file failed integrity verification.");
    return new File([blob], file.name, { type: file.mimeType, lastModified: file.modifiedAt });
  }

  if (!response.ok) throw new Error(`The file could not be downloaded (${response.status}).`);
  const descriptor = parseContentAccessDescriptor(await response.json(), file.id, contentRevision, file.size);
  const contentResponse = await fetchImpl(descriptor.access.url, { method: "GET", headers: descriptor.access.headers, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
  const contentGate = await largeDownloadError(contentResponse);
  if (contentGate) throw contentGate;
  if (!contentResponse.ok) throw new Error(`The file could not be downloaded (${contentResponse.status}).`);
  const blob = await contentResponse.blob();
  if (blob.size !== descriptor.size) throw new Error("The downloaded file has an unexpected size.");
  if (await sha256Blob(blob) !== descriptor.sha256) throw new Error("The downloaded file failed integrity verification.");
  return new File([blob], file.name, { type: file.mimeType, lastModified: file.modifiedAt });
}

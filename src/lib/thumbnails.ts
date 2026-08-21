import { sha256Blob } from "./blob-transfer";
import { isRecord, parseDirectBlobAccess, type DirectBlobAccess } from "./contracts";

/** Defines the thumbnail profile. */
export const THUMBNAIL_PROFILE = "thumbnail-v1" as const;
/** Defines the thumbnail cache name. */
export const THUMBNAIL_CACHE_NAME = "hiraya-thumbnails-v1";
/** Defines the maximum thumbnail edge length. */
export const THUMBNAIL_MAX_EDGE = 320;
/** Defines the maximum thumbnail output size. */
export const THUMBNAIL_MAX_OUTPUT_SIZE = 256 * 1024;
/** Defines the maximum thumbnail source size. */
export const THUMBNAIL_MAX_SOURCE_SIZE = 100 * 1024 * 1024;
/** Lists the supported thumbnail MIME types. */
const THUMBNAIL_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/apng", "image/gif", "image/webp", "image/avif", "image/bmp", "image/tiff", "image/heic", "image/heif", "image/x-icon", "image/vnd.microsoft.icon",
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/mpeg", "video/ogg", "video/3gpp", "video/3gpp2", "video/x-msvideo",
]);

export type ThumbnailDescriptor = {
  entryId: string;
  contentRevision: number;
  profile: typeof THUMBNAIL_PROFILE;
  logicalPath: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  size: number;
  sha256: string;
  access: DirectBlobAccess;
};

type ThumbnailRequest = {
  authority: string;
  entryId: string;
  contentRevision: number;
  endpoint: string;
  expectedDirectOrigin?: string;
  descriptorInit: RequestInit;
  fetchImpl?: typeof fetch;
  cacheStorage?: Pick<CacheStorage, "open">;
  sleep?: (milliseconds: number) => Promise<void>;
  maxPendingPolls?: number;
  onDescriptorResponse?: (response: Response) => void;
};

/** Lists the supported descriptor keys. */
const DESCRIPTOR_KEYS = new Set(["entryId", "contentRevision", "profile", "logicalPath", "mimeType", "width", "height", "size", "sha256", "access"]);
/** Lists the supported access keys. */
const ACCESS_KEYS = new Set(["url", "method", "headers", "expiresAt"]);
/** Matches a lowercase SHA-256 digest. */
const SHA256_HEX = /^[a-f0-9]{64}$/;
/** Matches the expected MIME token. */
const MIME_TOKEN = "[!#$%&'*+.^_`|~\\w-]+";
/** Matches the expected MIME type. */
const MIME_TYPE = new RegExp(`^(${MIME_TOKEN}/${MIME_TOKEN})(?:\\s*;\\s*(${MIME_TOKEN})\\s*=\\s*(?:${MIME_TOKEN}|"(?:[^"\\\\]|\\\\.)*"))*\\s*$`, "i");
/** Defines the MIME parameter. */
const MIME_PARAMETER = new RegExp(`;\\s*(${MIME_TOKEN})\\s*=`, "gi");
/** Tracks thumbnail requests currently in flight. */
const inFlight = new Map<string, Promise<Blob>>();

/** Reports whether a MIME type supports thumbnail generation. */
export function supportsThumbnailMime(value: string) {
  const match = MIME_TYPE.exec(value);
  if (!match || !THUMBNAIL_MIME_TYPES.has(match[1].toLowerCase())) return false;
  const names = [...value.matchAll(MIME_PARAMETER)].map((parameter) => parameter[1].toLowerCase());
  return new Set(names).size === names.length;
}

/** Validates that a record contains exactly the expected keys. */
function exactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  return Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

/** Validates and returns a non-negative integer. */
function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`The thumbnail has an invalid ${label}.`);
  return value as number;
}

/** Builds the logical cache path for a thumbnail. */
export function thumbnailLogicalPath(entryId: string, contentRevision: number) {
  return `.hiraya/thumbnails/${entryId}/${contentRevision}/${THUMBNAIL_PROFILE}.webp`;
}

/** Parses and validates thumbnail descriptor. */
export function parseThumbnailDescriptor(value: unknown, expectedEntryId: string, expectedRevision: number, expectedDirectOrigin?: string): ThumbnailDescriptor {
  if (!isRecord(value) || !exactKeys(value, DESCRIPTOR_KEYS)) throw new Error("The thumbnail response has an unsupported format.");
  if (value.entryId !== expectedEntryId) throw new Error("The thumbnail response is for a different entry.");
  const contentRevision = nonNegativeInteger(value.contentRevision, "content revision");
  if (contentRevision !== expectedRevision) throw new Error("The thumbnail response is for a different revision.");
  if (value.profile !== THUMBNAIL_PROFILE) throw new Error("The thumbnail response has an unsupported profile.");
  if (value.logicalPath !== thumbnailLogicalPath(expectedEntryId, contentRevision)) throw new Error("The thumbnail response has an invalid logical path.");
  if (value.mimeType !== "image/webp") throw new Error("The thumbnail response has an unsupported media type.");
  const width = nonNegativeInteger(value.width, "width");
  const height = nonNegativeInteger(value.height, "height");
  if (width === 0 || height === 0 || width > THUMBNAIL_MAX_EDGE || height > THUMBNAIL_MAX_EDGE) throw new Error("The thumbnail has invalid dimensions.");
  const size = nonNegativeInteger(value.size, "size");
  if (size === 0 || size > THUMBNAIL_MAX_OUTPUT_SIZE) throw new Error("The thumbnail has an invalid size.");
  if (typeof value.sha256 !== "string" || !SHA256_HEX.test(value.sha256)) throw new Error("The thumbnail has an invalid SHA-256 digest.");
  if (!isRecord(value.access) || !exactKeys(value.access, ACCESS_KEYS)) throw new Error("The thumbnail response has invalid access metadata.");
  return { entryId: expectedEntryId, contentRevision, profile: THUMBNAIL_PROFILE, logicalPath: value.logicalPath, mimeType: "image/webp", width, height, size, sha256: value.sha256, access: parseDirectBlobAccess(value.access, "GET", expectedDirectOrigin) };
}

/** Builds the cache key for a thumbnail descriptor. */
function cacheKey(authority: string, entryId: string) {
  return `https://thumbnail-cache.hiraya.invalid/${encodeURIComponent(authority)}/${encodeURIComponent(entryId)}/${THUMBNAIL_PROFILE}`;
}

/** Reads cached thumbnail. */
async function readCachedThumbnail(cache: Cache, key: string, revision: number) {
  try {
    const response = await cache.match(key);
    if (!response) return null;
    const size = Number(response.headers.get("X-Hiraya-Thumbnail-Size"));
    const sha256 = response.headers.get("X-Hiraya-Thumbnail-SHA256");
    const blob = await response.blob();
    if (response.headers.get("X-Hiraya-Content-Revision") === String(revision) && Number.isSafeInteger(size) && size > 0 && size <= THUMBNAIL_MAX_OUTPUT_SIZE && sha256 && SHA256_HEX.test(sha256) && blob.size === size && await sha256Blob(blob) === sha256) return blob;
    await cache.delete(key).catch(() => false);
  } catch {
    await cache.delete(key).catch(() => false);
  }
  return null;
}

/** Parses a Retry-After header as milliseconds. */
function retryAfterMilliseconds(value: string | null) {
  if (!value) return 250;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3_000, Math.max(0, Math.ceil(seconds * 1_000)));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(3_000, Math.max(0, date - Date.now())) : 250;
}

/** Reads thumbnail body. */
async function readThumbnailBody(response: Response, expectedSize: number) {
  if (!response.body) throw new Error("The thumbnail response could not be streamed.");
  const contentLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > expectedSize) throw new Error("The downloaded thumbnail is larger than expected.");
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedSize) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The downloaded thumbnail is larger than expected.");
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("Content-Type") ?? "" });
}

/** Fetches thumbnail. */
async function fetchThumbnail(request: ThumbnailRequest) {
  const fetchImpl = request.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const cacheStorage = request.cacheStorage ?? (typeof caches === "undefined" ? undefined : caches);
  const cache = cacheStorage ? await cacheStorage.open(THUMBNAIL_CACHE_NAME).catch(() => null) : null;
  const key = cacheKey(request.authority, request.entryId);
  const cached = cache ? await readCachedThumbnail(cache, key, request.contentRevision) : null;
  if (cached) return cached;

  const sleep = request.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let response: Response;
  for (let pending = 0;; pending += 1) {
    response = await fetchImpl(request.endpoint, request.descriptorInit);
    request.onDescriptorResponse?.(response);
    if (response.status !== 202) break;
    if (pending >= (request.maxPendingPolls ?? 3)) throw new Error("The thumbnail is still being generated.");
    await sleep(retryAfterMilliseconds(response.headers.get("Retry-After")));
  }
  if (!response.ok) throw new Error(`The thumbnail could not be loaded (${response.status}).`);
  const descriptor = parseThumbnailDescriptor(await response.json(), request.entryId, request.contentRevision, request.expectedDirectOrigin);
  const direct = await fetchImpl(descriptor.access.url, { method: descriptor.access.method, headers: descriptor.access.headers, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: request.descriptorInit.signal });
  if (!direct.ok) throw new Error(`The thumbnail could not be downloaded (${direct.status}).`);
  const downloaded = await readThumbnailBody(direct, descriptor.size);
  if (downloaded.size !== descriptor.size) throw new Error("The downloaded thumbnail has an unexpected size.");
  if (await sha256Blob(downloaded) !== descriptor.sha256) throw new Error("The downloaded thumbnail failed integrity verification.");
  const blob = downloaded.type === descriptor.mimeType ? downloaded : new Blob([downloaded], { type: descriptor.mimeType });
  if (cache) await cache.put(key, new Response(blob, { headers: { "Content-Type": descriptor.mimeType, "X-Hiraya-Content-Revision": String(descriptor.contentRevision), "X-Hiraya-Thumbnail-Size": String(descriptor.size), "X-Hiraya-Thumbnail-SHA256": descriptor.sha256 } })).catch(() => undefined);
  return blob;
}

/** Loads thumbnail. */
export function loadThumbnail(request: ThumbnailRequest) {
  const key = `${request.authority}\0${request.entryId}\0${request.contentRevision}\0${THUMBNAIL_PROFILE}`;
  const current = inFlight.get(key);
  if (current) return current;
  const loading = fetchThumbnail(request).finally(() => {
    if (inFlight.get(key) === loading) inFlight.delete(key);
  });
  inFlight.set(key, loading);
  return loading;
}

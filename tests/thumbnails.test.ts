import { describe, expect, test } from "bun:test";
import { sha256Blob } from "../src/lib/blob-transfer";
import { loadThumbnail, parseThumbnailDescriptor, supportsThumbnailMime, thumbnailLogicalPath, THUMBNAIL_PROFILE } from "../src/lib/thumbnails";

/** Builds the descriptor test fixture. */
function descriptor(entryId: string, revision: number, blob: Blob, sha256: string) {
  return {
    entryId,
    contentRevision: revision,
    profile: THUMBNAIL_PROFILE,
    logicalPath: thumbnailLogicalPath(entryId, revision),
    mimeType: "image/webp",
    width: 64,
    height: 48,
    size: blob.size,
    sha256,
    access: { url: `https://objects.test/${entryId}/${revision}`, method: "GET", headers: {}, expiresAt: Date.now() + 60_000 },
  };
}

describe("thumbnail transport", () => {
  test("matches the server-declared source MIME set", () => {
    for (const mimeType of ["image/jpeg", "image/png", "image/apng", "image/gif", "image/webp", "image/avif", "image/bmp", "image/tiff", "image/heic", "image/heif", "image/x-icon", "image/vnd.microsoft.icon", "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/mpeg", "video/ogg", "video/3gpp", "video/3gpp2", "video/x-msvideo"]) expect(supportsThumbnailMime(mimeType.toUpperCase())).toBeTrue();
    for (const mimeType of ["image/svg+xml", "audio/mpeg", "video/x-flv", "image/jpeg/invalid", "image/jpeg; broken", "image/jpeg; quality=", "image/jpeg; quality=1; QUALITY=2"]) expect(supportsThumbnailMime(mimeType)).toBeFalse();
    expect(supportsThumbnailMime("image/jpeg; quality=90")).toBeTrue();
  });

  test("strictly validates the agreed descriptor", async () => {
    const blob = new Blob(["thumb"], { type: "image/webp" });
    const value = descriptor("image-1", 7, blob, await sha256Blob(blob));
    expect(parseThumbnailDescriptor(value, "image-1", 7, "https://objects.test")).toMatchObject({ entryId: "image-1", contentRevision: 7, width: 64, height: 48 });
    expect(() => parseThumbnailDescriptor({ ...value, extra: true }, "image-1", 7)).toThrow("unsupported format");
    expect(() => parseThumbnailDescriptor({ ...value, logicalPath: ".hiraya/thumbnails/other" }, "image-1", 7)).toThrow("logical path");
    expect(() => parseThumbnailDescriptor({ ...value, access: { ...value.access, method: "POST" } }, "image-1", 7)).toThrow("must use GET");
    expect(() => parseThumbnailDescriptor({ ...value, width: 321 }, "image-1", 7)).toThrow("dimensions");
    expect(() => parseThumbnailDescriptor({ ...value, height: 321 }, "image-1", 7)).toThrow("dimensions");
    expect(() => parseThumbnailDescriptor({ ...value, size: 256 * 1024 + 1 }, "image-1", 7)).toThrow("size");
  });

  test("coalesces requests, bounds pending polling, and verifies bytes", async () => {
    const blob = new Blob(["thumb"], { type: "image/webp" });
    const value = descriptor("video-1", 3, blob, await sha256Blob(blob));
    let descriptorRequests = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/thumbnail?")) {
        descriptorRequests += 1;
        return descriptorRequests === 1 ? new Response(null, { status: 202, headers: { "Retry-After": "0" } }) : Response.json(value);
      }
      return new Response(blob, { headers: { "Content-Type": "image/webp" } });
    }) as typeof fetch;
    const request = { authority: "catalog/desktop", entryId: "video-1", contentRevision: 3, endpoint: "/api/thumbnail?revision=3", descriptorInit: {}, fetchImpl, sleep: async () => undefined, cacheStorage: undefined };
    const [left, right] = await Promise.all([loadThumbnail(request), loadThumbnail(request)]);
    expect(await left.text()).toBe("thumb");
    expect(await right.text()).toBe("thumb");
    expect(descriptorRequests).toBe(2);

    await expect(loadThumbnail({ ...request, authority: "pending", fetchImpl: (async () => new Response(null, { status: 202 })) as typeof fetch, maxPendingPolls: 1 })).rejects.toThrow("still being generated");
  });

  test("replaces a stable authority and entry cache record when revision changes", async () => {
    const records = new Map<string, Response>();
    const cache = { match: async (key: RequestInfo | URL) => records.get(String(key))?.clone(), put: async (key: RequestInfo | URL, response: Response) => { records.set(String(key), response.clone()); }, delete: async (key: RequestInfo | URL) => records.delete(String(key)) } as Cache;
    const cacheStorage = { open: async () => cache };
    let descriptorRequests = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      const revision = url.includes("revision=2") || url.endsWith("/2") ? 2 : 1;
      const blob = new Blob([revision === 1 ? "one" : "two"], { type: "image/webp" });
      if (url.includes("thumbnail")) {
        descriptorRequests += 1;
        return Response.json(descriptor("image-1", revision, blob, await sha256Blob(blob)));
      }
      return new Response(blob, { headers: { "Content-Type": "image/webp" } });
    }) as typeof fetch;
    const base = { authority: "catalog/desktop", entryId: "image-1", descriptorInit: {}, fetchImpl, cacheStorage };
    await loadThumbnail({ ...base, contentRevision: 1, endpoint: "/thumbnail?revision=1" });
    await loadThumbnail({ ...base, contentRevision: 2, endpoint: "/thumbnail?revision=2" });
    expect(await (await loadThumbnail({ ...base, contentRevision: 2, endpoint: "/thumbnail?revision=2" })).text()).toBe("two");
    expect(records.size).toBe(1);
    expect(descriptorRequests).toBe(2);
  });

  test("deletes stale or corrupt entries and treats cache failures as misses", async () => {
    const blob = new Blob(["fresh"], { type: "image/webp" });
    const value = descriptor("image-cache", 2, blob, await sha256Blob(blob));
    let deleted = 0;
    let directRequests = 0;
    const stale = new Response("stale", { headers: { "X-Hiraya-Content-Revision": "1", "X-Hiraya-Thumbnail-Size": "5", "X-Hiraya-Thumbnail-SHA256": "0".repeat(64) } });
    const corrupt = new Response("bad!!", { headers: { "X-Hiraya-Content-Revision": "2", "X-Hiraya-Thumbnail-Size": "5", "X-Hiraya-Thumbnail-SHA256": "0".repeat(64) } });
    let cachedResponse = stale;
    const cache = { match: async () => cachedResponse.clone(), delete: async () => { deleted += 1; return true; }, put: async () => { throw new Error("quota"); } } as unknown as Cache;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).includes("thumbnail")) return Response.json(value);
      directRequests += 1;
      return new Response(blob, { headers: { "Content-Type": "image/webp" } });
    }) as typeof fetch;
    const request = { authority: "cache-hardening", entryId: "image-cache", contentRevision: 2, endpoint: "/thumbnail", descriptorInit: {}, fetchImpl };
    expect(await (await loadThumbnail({ ...request, cacheStorage: { open: async () => cache } })).text()).toBe("fresh");
    expect(deleted).toBe(1);
    expect(directRequests).toBe(1);
    cachedResponse = corrupt;
    expect(await (await loadThumbnail({ ...request, authority: "cache-corrupt", cacheStorage: { open: async () => cache } })).text()).toBe("fresh");
    expect(deleted).toBe(2);
    expect(await (await loadThumbnail({ ...request, authority: "cache-open-failure", cacheStorage: { open: async () => { throw new Error("blocked"); } } })).text()).toBe("fresh");
  });

  test("aborts a streamed direct response as soon as it exceeds the descriptor size", async () => {
    const expected = new Blob(["12345"], { type: "image/webp" });
    const value = descriptor("oversized", 1, expected, await sha256Blob(expected));
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input) === "/thumbnail") return Response.json(value);
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("123456")); controller.close(); } }), { headers: { "Content-Type": "image/webp" } });
    }) as typeof fetch;
    await expect(loadThumbnail({ authority: "oversized-stream", entryId: "oversized", contentRevision: 1, endpoint: "/thumbnail", descriptorInit: {}, fetchImpl, cacheStorage: undefined })).rejects.toThrow("larger than expected");
  });
});

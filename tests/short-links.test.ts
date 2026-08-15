import { describe, expect, test } from "bun:test";
import { createShortLink, deleteShortLink, listShortLinks, parseShortLink, parseShortLinks, resolveShortLinkUrl, updateShortLink } from "../src/lib/short-links";

const link = { slug: "launch-notes", destinationUrl: "https://example.test/notes", url: "https://go.example.test/r/launch-notes", enabled: true, createdAt: "2026-08-02T12:00:00Z", updatedAt: "2026-08-02T12:00:00Z" };

describe("short links", () => {
  test("strictly validates response records", () => {
    expect(parseShortLink(link)).toEqual(link);
    expect(parseShortLink({ ...link, url: "/r/launch-notes" }).url).toBe("/r/launch-notes");
    expect(resolveShortLinkUrl("/r/launch-notes", "https://hiraya.example.test")).toBe("https://hiraya.example.test/r/launch-notes");
    expect(parseShortLinks({ shortLinks: [link] })).toEqual([link]);
    expect(() => parseShortLink({ ...link, extra: true })).toThrow("unsupported format");
    expect(() => parseShortLink({ ...link, destinationUrl: "javascript:alert(1)" })).toThrow("destination URL");
    expect(() => parseShortLink({ ...link, destinationUrl: "http://example.test/notes" })).toThrow("destination URL");
    expect(() => parseShortLink({ ...link, destinationUrl: "https://user:secret@example.test/notes" })).toThrow("destination URL");
    for (const url of ["r/launch-notes", "//example.test/r/launch-notes", "/r/launch-notes?from=list", "/r/launch-notes#details", "/\\example.test/r/launch-notes", "https:example.test/r/launch-notes"]) {
      expect(() => parseShortLink({ ...link, url })).toThrow("public URL");
    }
    expect(() => parseShortLink({ ...link, updatedAt: "yesterday" })).toThrow("timestamp");
    expect(() => parseShortLinks({ shortLinks: [link, link] })).toThrow("duplicate slugs");
    expect(() => parseShortLinks({ shortLinks: [], cursor: null })).toThrow("unsupported format");
  });

  test("uses canonical methods, JSON bodies, and encoded immutable slugs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (!init?.method) return Response.json({ shortLinks: [link] });
      return Response.json(link, { status: init.method === "POST" ? 201 : 200 });
    }) as typeof fetch;

    expect(await listShortLinks(fetchImpl)).toEqual([link]);
    await createShortLink({ destinationUrl: link.destinationUrl }, fetchImpl);
    await updateShortLink("launch/notes", { enabled: false }, fetchImpl);
    await deleteShortLink("launch/notes", fetchImpl);

    expect(requests.map(({ url, init }) => `${init?.method ?? "GET"} ${url}`)).toEqual([
      "GET /api/short-links",
      "POST /api/short-links",
      "PATCH /api/short-links/launch%2Fnotes",
      "DELETE /api/short-links/launch%2Fnotes",
    ]);
    expect(requests[1].init?.body).toBe(JSON.stringify({ destinationUrl: link.destinationUrl }));
    expect(requests[2].init?.body).toBe(JSON.stringify({ enabled: false }));
    expect(requests.every(({ init }) => init?.credentials === "same-origin" && init.cache === "no-store")).toBeTrue();
  });

  test("surfaces server errors without accepting malformed success payloads", async () => {
    await expect(listShortLinks((async () => Response.json({ error: "Short links are unavailable." }, { status: 503 })) as typeof fetch)).rejects.toThrow("Short links are unavailable.");
    await expect(listShortLinks((async () => Response.json({ shortLinks: [{ ...link, enabled: "yes" }] })) as typeof fetch)).rejects.toThrow("unsupported format");
  });
});

import { describe, expect, test } from "bun:test";
import { parseShortLink, parseShortLinks, resolveShortLinkUrl } from "../src/lib/short-links";

const link = { slug: "launch-notes", destinationUrl: "https://example.test/notes", url: "/r/launch-notes", enabled: true, createdAt: "2026-08-02T12:00:00Z", updatedAt: "2026-08-02T12:00:00Z" };

describe("short links", () => {
  test("strictly validates projected Web2 records", () => {
    expect(parseShortLink(link)).toEqual(link);
    expect(resolveShortLinkUrl(link.url, "https://hiraya.example.test")).toBe("https://hiraya.example.test/r/launch-notes");
    expect(parseShortLinks({ shortLinks: [link] })).toEqual([link]);
    expect(() => parseShortLink({ ...link, extra: true })).toThrow("unsupported format");
    expect(() => parseShortLink({ ...link, destinationUrl: "http://example.test/notes" })).toThrow("destination URL");
    expect(() => parseShortLink({ ...link, url: "/r/other" })).toThrow("public URL");
    expect(() => parseShortLink({ ...link, updatedAt: "yesterday" })).toThrow("timestamp");
    expect(() => parseShortLinks({ shortLinks: [link, link] })).toThrow("duplicate slugs");
  });
});

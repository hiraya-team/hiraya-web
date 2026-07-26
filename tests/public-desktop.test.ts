import { describe, expect, test } from "bun:test";
import { fetchPublicFile, LargeDownloadAuthRequiredError, publicTokenFromPath } from "../src/lib/public-desktop";
import { resolvePublicLinkedEntry } from "../src/features/public-desktop/controller";

const file = {
  kind: "file" as const,
  id: "file",
  name: "archive.zip",
  parentId: null,
  createdAt: 1,
  modifiedAt: 1,
  position: { x: 0, y: 0 },
  mimeType: "application/zip",
  size: 100,
};

describe("public desktop", () => {
  test("recognizes only opaque public routes", () => {
    expect(publicTokenFromPath("/shared/a%2Bb")).toBe("a+b");
    expect(publicTokenFromPath("/shared/token/extra")).toBeNull();
    expect(publicTokenFromPath("/desktops/shared")).toBeNull();
  });

  test("surfaces the large-download authentication gate without session handling", async () => {
    const fetchImpl = (async () =>
      Response.json(
        {
          error: "sign in",
          code: "large_download_auth_required",
          loginUrl: "/login?returnTo=%2Fshared%2Ftoken",
        },
        { status: 401 },
      )) as typeof fetch;
    const result = fetchPublicFile("token", file, 3, fetchImpl);
    await expect(result).rejects.toBeInstanceOf(LargeDownloadAuthRequiredError);
    await expect(result).rejects.toMatchObject({
      loginUrl: "/login?returnTo=%2Fshared%2Ftoken",
    });
  });

  test("does not request content until explicitly asked", () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response();
    }) as typeof fetch;
    void fetchImpl;
    expect(calls).toBe(0);
  });

  test("does not expose public multi-selection behavior", async () => {
    const source = await Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text();

    expect(source).not.toContain("MobileSelectionToolbar");
    expect(source).not.toContain("multiSelect");
    expect(source).not.toContain("onLongPressSelect=");
    expect(source).toContain("const closePublicView = () => {\n    setSelectedIds(new Set());");
    expect(source).toContain("const backPublicView = () => {");
    expect(source).toContain("setSelectedIds(new Set());\n    setOpen({");
  });

  test("resolves linked files within the public desktop only", () => {
    const folder = { kind: "folder" as const, id: "folder", name: "docs", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    const source = { ...file, id: "source", name: "source.md" };
    const linked = { ...file, id: "linked", name: "guide.md", parentId: folder.id };

    expect(resolvePublicLinkedEntry([folder, source, linked], source, "docs/guide.md")).toEqual(linked);
    expect(() => resolvePublicLinkedEntry([folder, source, linked], source, "../guide.md")).toThrow("outside the desktop");
    expect(() => resolvePublicLinkedEntry([folder, source, linked], source, "https://example.com/guide.md")).toThrow("not a local relative file path");
  });
});

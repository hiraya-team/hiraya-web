import { describe, expect, test } from "bun:test";
import { fetchPublicFile, LargeDownloadAuthRequiredError, publicAuthorityFromPath } from "../src/lib/public-desktop";
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
  test("recognizes only stable alias routes", () => {
    expect(publicAuthorityFromPath("/published/team-desk")).toEqual({ desktopAlias: "team-desk" });
    expect(publicAuthorityFromPath("/published/team-desk/roadmap")).toEqual({ desktopAlias: "team-desk", itemAlias: "roadmap" });
    expect(publicAuthorityFromPath("/shared/token")).toBeNull();
    expect(publicAuthorityFromPath("/published/Bad_Alias")).toBeNull();
    expect(publicAuthorityFromPath("/published/-team-desk")).toBeNull();
    expect(publicAuthorityFromPath("/published/team-desk/roadmap-")).toBeNull();
  });

  test("surfaces the large-download authentication gate without session handling", async () => {
    const fetchImpl = (async () =>
      Response.json(
        {
          error: "sign in",
          code: "large_download_auth_required",
          loginUrl: "/login?returnTo=%2Fpublished%2Fteam-desk",
        },
        { status: 401 },
      )) as typeof fetch;
    const result = fetchPublicFile({ desktopAlias: "team-desk" }, file, 3, fetchImpl);
    await expect(result).rejects.toBeInstanceOf(LargeDownloadAuthRequiredError);
    await expect(result).rejects.toMatchObject({ loginUrl: "/login?returnTo=%2Fpublished%2Fteam-desk" });
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

  test("validates the size of legacy same-origin downloads", async () => {
    const fetchImpl = (async () => new Response("short", { headers: { "content-type": "application/zip" } })) as typeof fetch;
    await expect(fetchPublicFile({ desktopAlias: "team-desk" }, file, 3, fetchImpl)).rejects.toThrow("unexpected size");
  });

  test("rejects same-size corruption in same-origin downloads", async () => {
    const sameSize = { ...file, size: 4 };
    const fetchImpl = (async () => new Response("evil", { headers: { "content-type": "application/zip", "X-Hiraya-Content-SHA256": "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8" } })) as typeof fetch;
    await expect(fetchPublicFile({ desktopAlias: "team-desk" }, sameSize, 3, fetchImpl)).rejects.toThrow("integrity verification");
  });

  test("uses a direct descriptor returned by the public content route", async () => {
    const directFile = { ...file, size: 4 };
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      if (urls.length === 1) return Response.json({
        entryId: directFile.id,
        contentRevision: 3,
        size: directFile.size,
        sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        access: { url: "https://downloads.example.test/file", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 },
      });
      return new Response("test");
    }) as typeof fetch;

    const result = await fetchPublicFile({ desktopAlias: "team-desk" }, directFile, 3, fetchImpl);

    expect(await result.text()).toBe("test");
    expect(urls).toEqual([
      "/api/public/desktops/team-desk/entries/file/content?revision=3",
      "https://downloads.example.test/file",
    ]);
  });

  test("verifies the SHA-256 digest of direct downloads", async () => {
    const directFile = { ...file, size: 4 };
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return Response.json({
        entryId: directFile.id,
        contentRevision: 3,
        size: directFile.size,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        access: { url: "https://downloads.example.test/file", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 },
      });
      return new Response("test");
    }) as typeof fetch;
    await expect(fetchPublicFile({ desktopAlias: "team-desk", itemAlias: "archive" }, directFile, 3, fetchImpl)).rejects.toThrow("integrity verification");
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

  test("loads packaged wallpaper code only when selected", async () => {
    const publicSource = await Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text();
    const appSource = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
    for (const source of [publicSource, appSource]) {
      expect(source).toContain('lazy(() => import("./components/ThemeWallpaper")');
      expect(source).not.toContain('import { ThemeWallpaper } from "./components/ThemeWallpaper"');
    }
  });

  test("keeps public root icons scrollable, focus-reachable, and pinch-magnifiable", async () => {
    const source = await Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    expect(source).toContain('scrollIntoView({ block: "nearest", inline: "nearest" })');
    expect(source).not.toContain("event.currentTarget.setPointerCapture(event.pointerId);");
    expect(source).toContain('className="file-icon public-icon"');
    expect(source).toContain('className="file-icon__art"');
    expect(source).toContain('className="file-icon__name"');
    expect(css).toContain("touch-action: pan-x pan-y pinch-zoom;");
  });

  test("uses shared desktop geometry, area navigation, and adaptive public windows", async () => {
    const source = await Bun.file(new URL("../src/PublicDesktop.tsx", import.meta.url)).text();
    expect(source).toContain("themeIconMetrics(theme)");
    expect(source).toContain("iconAreaSize(desktopSize, desktop?.layout.gridSize)");
    expect(source).toContain("responsiveDesktop(desktop?.entries ?? [], iconArea, iconMetrics)");
    expect(source).toContain("<AreaSwitcher");
    expect(source).toContain("useMediaQuery(WINDOWED_DESKTOP_QUERY)");
    expect(source).toContain("initialWindowBounds(desktopSize, options)");
    expect(source).toContain("windowed={windowed}");
    expect(source).toContain("const wholeDesktop = !authority.itemAlias;");
  });

  test("guards public preview completion against a newer open request", async () => {
    const controller = await Bun.file(new URL("../src/features/public-desktop/controller.ts", import.meta.url)).text();
    expect(controller).toContain("const generation = downloadOnly ? null : ++fileLoadGenerationRef.current;");
    expect(controller).toContain("fileLoadGenerationRef.current === generation");
    expect(controller).toContain("fileLoadGenerationRef.current !== generation");
    expect(controller).toContain("next.publishedRootId");
    expect(controller).toContain('setOpenState({ kind: "folder", folderId: root.id })');
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

import { afterEach, describe, expect, test } from "bun:test";
import { sha256, THEME_MANIFEST_PATH } from "@hiraya-team/app-cli";
import { strToU8, zipSync } from "fflate";
import { BUILTIN_THEMES } from "../src/lib/themes";
import { fetchThemePackage, parseThemePackageAccess } from "../src/lib/theme-package";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("theme package downloads", () => {
  test("uses strict direct access validation and detached credentials for an absolute presigned URL", async () => {
    const bytes = zipSync({
      [THEME_MANIFEST_PATH]: strToU8(JSON.stringify({ schemaVersion: 1, id: "aurora", name: "Aurora", definition: BUILTIN_THEMES["hiraya-dusk"].definition, wallpaper: { kind: "static", entrypoint: "wallpaper.png" } })),
      "wallpaper.png": new Uint8Array([1, 2, 3]),
    });
    const expected = { assetId: "theme-asset", kind: "static" as const, size: bytes.byteLength, sha256: await sha256(bytes), revision: 4 };
    const access = { url: "https://downloads.example.test/theme?signature=secret", method: "GET", headers: { "X-Test": "yes" }, expiresAt: 2_000_000_000_000 };
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    let cached: Blob | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return calls.length === 1
        ? Response.json({ entryId: expected.assetId, contentRevision: expected.revision, size: expected.size, sha256: expected.sha256, access })
        : new Response(bytes);
    }) as typeof fetch;

    expect((await fetchThemePackage("/api/theme-access", "aurora", expected, undefined, {
      readVerified: async () => null,
      write: async (_themeId, _expected, content) => { cached = content; },
    })).manifest.id).toBe("aurora");
    expect(calls[1]).toMatchObject({ input: access.url, init: { method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" } });
    expect(new Headers(calls[1].init?.headers).get("X-Test")).toBe("yes");
    expect(cached?.size).toBe(bytes.byteLength);
    expect(() => parseThemePackageAccess({ entryId: expected.assetId, contentRevision: expected.revision, size: expected.size, sha256: expected.sha256, access: { ...access, url: "https://user:secret@downloads.example.test/theme" } }, expected)).toThrow("safe HTTPS");
  });

  test("loads a verified local package without requesting access again", async () => {
    const bytes = zipSync({
      [THEME_MANIFEST_PATH]: strToU8(JSON.stringify({ schemaVersion: 1, id: "aurora", name: "Aurora", definition: BUILTIN_THEMES["hiraya-dusk"].definition, wallpaper: { kind: "static", entrypoint: "wallpaper.png" } })),
      "wallpaper.png": new Uint8Array([1, 2, 3]),
    });
    const expected = { assetId: "theme-asset", kind: "static" as const, size: bytes.byteLength, sha256: await sha256(bytes), revision: 4 };
    globalThis.fetch = (async () => { throw new Error("unexpected network request"); }) as typeof fetch;

    const inspection = await fetchThemePackage("/api/theme-access", "aurora", expected, undefined, {
      readVerified: async () => new Blob([bytes]),
      write: async () => { throw new Error("unexpected cache write"); },
    });
    expect(inspection.manifest.id).toBe("aurora");
  });

  test("includes same-origin credentials for a validated root-relative package URL", async () => {
    const bytes = zipSync({
      [THEME_MANIFEST_PATH]: strToU8(JSON.stringify({ schemaVersion: 1, id: "aurora", name: "Aurora", definition: BUILTIN_THEMES["hiraya-dusk"].definition, wallpaper: { kind: "static", entrypoint: "wallpaper.png" } })),
      "wallpaper.png": new Uint8Array([1, 2, 3]),
    });
    const expected = { assetId: "theme-asset", kind: "static" as const, size: bytes.byteLength, sha256: await sha256(bytes), revision: 4 };
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return calls.length === 1
        ? Response.json({ entryId: expected.assetId, contentRevision: expected.revision, size: expected.size, sha256: expected.sha256, access: { url: "/api/theme-package", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } })
        : new Response(bytes);
    }) as typeof fetch;

    expect((await fetchThemePackage("/api/theme-access", "aurora", expected)).manifest.id).toBe("aurora");
    expect(calls[1]).toMatchObject({ input: "/api/theme-package", init: { credentials: "same-origin" } });
  });

  test("rejects a valid package for a different selected theme", async () => {
    const bytes = zipSync({
      [THEME_MANIFEST_PATH]: strToU8(JSON.stringify({ schemaVersion: 1, id: "other", name: "Other", definition: BUILTIN_THEMES["hiraya-dusk"].definition, wallpaper: { kind: "static", entrypoint: "wallpaper.png" } })),
      "wallpaper.png": new Uint8Array([1]),
    });
    const expected = { assetId: "theme-asset", kind: "static" as const, size: bytes.byteLength, sha256: await sha256(bytes), revision: 2 };
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).startsWith("/api/")
      ? Response.json({ entryId: expected.assetId, contentRevision: expected.revision, size: expected.size, sha256: expected.sha256, access: { url: "https://downloads.example.test/theme", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 } })
      : new Response(bytes)) as typeof fetch;
    await expect(fetchThemePackage("/api/theme-access", "aurora", expected)).rejects.toThrow("does not match");
  });
});

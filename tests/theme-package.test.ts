import { describe, expect, test } from "bun:test";
import { sha256, THEME_MANIFEST_PATH } from "@hiraya-team/app-cli";
import { strToU8, zipSync } from "fflate";
import { BUILTIN_THEMES } from "../src/lib/themes";
import { fetchThemePackage } from "../src/lib/theme-package";

function archive(id = "aurora") {
  return zipSync({
    [THEME_MANIFEST_PATH]: strToU8(JSON.stringify({ schemaVersion: 1, id, name: "Aurora", definition: BUILTIN_THEMES["hiraya-dusk"].definition, wallpaper: { kind: "static", entrypoint: "wallpaper.png" } })),
    "wallpaper.png": new Uint8Array([1, 2, 3]),
  });
}

describe("theme package downloads", () => {
  test("loads a verified Web2 filesystem package without a legacy content request", async () => {
    const bytes = archive();
    const expected = { assetId: "10000000-0000-4000-8000-000000000001", kind: "static" as const, size: bytes.byteLength, sha256: await sha256(bytes), revision: 4 };
    const inspection = await fetchThemePackage("", "aurora", expected, undefined, { readVerified: async () => new Blob([bytes]), write: async () => undefined });
    expect(inspection.manifest.id).toBe("aurora");
  });

  test("fails closed when the projected package is unavailable", async () => {
    const bytes = archive();
    const expected = { assetId: "10000000-0000-4000-8000-000000000001", kind: "static" as const, size: bytes.byteLength, sha256: await sha256(bytes), revision: 4 };
    await expect(fetchThemePackage("", "aurora", expected, undefined, { readVerified: async () => null, write: async () => undefined })).rejects.toThrow("unavailable");
  });

  test("rejects a valid package for a different selected theme", async () => {
    const bytes = archive("other");
    const expected = { assetId: "10000000-0000-4000-8000-000000000001", kind: "static" as const, size: bytes.byteLength, sha256: await sha256(bytes), revision: 2 };
    await expect(fetchThemePackage("", "aurora", expected, undefined, { readVerified: async () => new Blob([bytes]), write: async () => undefined })).rejects.toThrow("does not match");
  });
});

import { describe, expect, test } from "bun:test";
import { parseBlobMutationPreparation, parseContentAccessDescriptor, parseDirectBlobAccess, parseEntries, parseLayout, parseRemoteDesktopState, parseRootEntryPositionUpdates } from "../src/lib/contracts";
import { remoteDesktopState } from "./fixtures";
import { DEFAULT_WALLPAPER } from "../src/types";
import { BUILTIN_THEMES } from "../src/lib/themes";

describe("contracts", () => {
  test("requires createdAt", () => {
    const entry = { kind: "folder", id: "a", name: "A", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } };
    expect(parseEntries([entry])).toEqual([entry]);
    const missing = { ...entry } as Partial<typeof entry>;
    delete missing.createdAt;
    expect(() => parseEntries([missing])).toThrow("creation date");
  });

  test("parses strict remote desktop schema version 1", () => {
    const remote = remoteDesktopState();
    expect(parseRemoteDesktopState(remote)).toEqual(remote);
    expect(() => parseRemoteDesktopState({ ...remote, schemaVersion: 5 })).toThrow("schema version");
    expect(() => parseRemoteDesktopState({ ...remote, catalogId: undefined })).toThrow("catalog identity");
    expect(() => parseRemoteDesktopState({ ...remote, capabilities: undefined })).toThrow("capabilities");
    expect(() => parseRemoteDesktopState({ ...remote, role: "editor" })).toThrow("role");
  });

  test("validates structured wallpaper and legacy persisted presets", () => {
    expect(parseLayout({ snapToGrid: false, wallpaper: DEFAULT_WALLPAPER })).toEqual({ snapToGrid: false, wallpaper: DEFAULT_WALLPAPER });
    expect(parseLayout({ snapToGrid: false, wallpaper: "ember" }, true).wallpaper).toEqual({ ...DEFAULT_WALLPAPER, source: "ember" });
    expect(() => parseLayout({ snapToGrid: false, wallpaper: "dusk" })).toThrow("wallpaper");
    expect(() => parseLayout({ snapToGrid: false, wallpaper: { ...DEFAULT_WALLPAPER, overlayColor: "#ffffff" } })).toThrow("wallpaper");
    expect(() => parseLayout({ snapToGrid: false, wallpaper: { ...DEFAULT_WALLPAPER, dim: Number.NaN } })).toThrow("wallpaper");
    expect(() => parseLayout({ snapToGrid: false, wallpaper: { ...DEFAULT_WALLPAPER, extra: true } })).toThrow("wallpaper");
    const missingFit = { ...DEFAULT_WALLPAPER } as Partial<typeof DEFAULT_WALLPAPER>;
    delete missingFit.fit;
    expect(() => parseLayout({ snapToGrid: false, wallpaper: missingFit })).toThrow("wallpaper");
    expect(parseLayout({ snapToGrid: false, wallpaper: { ...DEFAULT_WALLPAPER, source: "theme:aurora" } }).wallpaper.source).toBe("theme:aurora");
    expect(() => parseLayout({ snapToGrid: false, wallpaper: { ...DEFAULT_WALLPAPER, source: "theme:../aurora" } })).toThrow("wallpaper");
  });

  test("accepts remote packaged wallpaper state only when its theme exists", () => {
    const remote = remoteDesktopState();
    const wallpaper = { assetId: "theme-asset", kind: "scene" as const, size: 4, sha256: "a".repeat(64), revision: 2 };
    const theme = { id: "aurora", name: "Aurora", definition: BUILTIN_THEMES["hiraya-dusk"].definition, wallpaper, revision: 2 };
    const themed = { ...remote, catalogRevision: 2, layout: { ...remote.layout, wallpaper: { ...DEFAULT_WALLPAPER, source: "theme:aurora" as const } }, layoutRevision: 2, appearance: { selectedThemeId: theme.id, selectionRevision: 2, customThemes: [theme] } };
    expect(parseRemoteDesktopState(themed).layout.wallpaper.source).toBe("theme:aurora");
    expect(() => parseRemoteDesktopState({ ...themed, appearance: { selectedThemeId: "hiraya-dusk", selectionRevision: 2, customThemes: [] } })).toThrow("packaged wallpaper");
  });

  test("requires a custom wallpaper to resolve to an eligible file on the same desktop", () => {
    const remote = remoteDesktopState();
    const wallpaper = { ...DEFAULT_WALLPAPER, source: "file:file-1" as const };
    expect(() => parseRemoteDesktopState({ ...remote, layout: { ...remote.layout, wallpaper } })).toThrow("JPEG, PNG, or WebP");
    expect(parseRemoteDesktopState({
      ...remote,
      entries: remote.entries.map((entry) => ({ ...entry, name: "wallpaper.webp", mimeType: "image/webp; variant=lossless", size: 4 })),
      layout: { ...remote.layout, wallpaper },
    }).layout.wallpaper).toEqual(wallpaper);
  });

  test("accepts positions only for root entries", () => {
    const entries = parseEntries([{ kind: "folder", id: "a", name: "A", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 } }]);
    expect(parseRootEntryPositionUpdates([{ entryId: "a", position: { x: -2, y: 3 } }], entries)).toHaveLength(1);
  });

  test("strictly validates direct blob targets and integrity metadata", () => {
    const sha256 = "edb465624291e4053c6c5ea4b7eb320dec773e10a57d26b95dcf0564f8e310f8";
    const uploadAccess = { url: "https://uploads.example.test/object?signature=secret", method: "PUT", headers: { "X-Bz-Info": "value" }, expiresAt: 2_000_000_000_000 };
    const downloadAccess = { url: "https://downloads.example.test/object", method: "GET", headers: {}, expiresAt: 2_000_000_000_000 };
    const prepared = parseBlobMutationPreparation({ state: "prepared", uploadId: "upload-1", expiresAt: 2_000_000_000_000, items: [{ entryId: "file-1", access: uploadAccess }] }, ["file-1"]);
    expect(prepared.state === "prepared" && prepared.items[0].entryId).toBe("file-1");
    expect(parseBlobMutationPreparation({ state: "committed" }, ["file-1"])).toEqual({ state: "committed" });
    expect(parseContentAccessDescriptor({ entryId: "file-1", contentRevision: 4, size: 4, sha256, access: downloadAccess }, "file-1", 4, 4)).toMatchObject({ contentRevision: 4, size: 4, sha256 });
    expect(parseDirectBlobAccess({ ...downloadAccess, url: "/api/desktops/desk/themes/aurora/package?revision=4" }, "GET").url).toBe("/api/desktops/desk/themes/aurora/package?revision=4");
    expect(() => parseBlobMutationPreparation({ state: "prepared", uploadId: "upload-1", expiresAt: 1, items: [{ entryId: "other", access: uploadAccess }] }, ["file-1"])).toThrow("unexpected targets");
    expect(() => parseBlobMutationPreparation({ state: "prepared", uploadId: "upload-1", expiresAt: 1, items: [{ entryId: "file-1", access: { ...uploadAccess, url: "https://user:secret@uploads.example.test/object" } }] }, ["file-1"])).toThrow("safe HTTPS");
    expect(() => parseBlobMutationPreparation({ state: "prepared", uploadId: "upload-1", expiresAt: 1, items: [{ entryId: "file-1", access: { ...uploadAccess, headers: { Cookie: "secret" } } }] }, ["file-1"])).toThrow("unsafe header");
    expect(() => parseBlobMutationPreparation({ state: "prepared", uploadId: "upload-1", expiresAt: 1, items: [{ entryId: "file-1", access: { ...uploadAccess, headers: { "X-Test": "one", "x-test": "two" } } }] }, ["file-1"])).toThrow("unsafe header");
    expect(() => parseContentAccessDescriptor({ entryId: "file-1", contentRevision: 4, size: 4, sha256: sha256.toUpperCase(), access: downloadAccess }, "file-1", 4, 4)).toThrow("SHA-256");
    expect(() => parseContentAccessDescriptor({ entryId: "file-1", contentRevision: 4, size: 4, sha256, access: { ...downloadAccess, method: "PUT" } }, "file-1", 4, 4)).toThrow("must use GET");
    expect(() => parseDirectBlobAccess({ ...downloadAccess, url: "//evil.example/object" }, "GET")).toThrow();
    expect(() => parseDirectBlobAccess({ ...downloadAccess, url: "/api/package#secret" }, "GET")).toThrow("invalid URL");
  });
});

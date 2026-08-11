import { describe, expect, test } from "bun:test";
import { parseManifestV2 } from "@hiraya-team/apps-contracts";
import { catalogWithoutRetiredSystemRelease, catalogWithRelease } from "../build/release-app";

const manifest = parseManifestV2({ schemaVersion: 2, uiRuntime: 1, id: "dev.hiraya.notes", name: "Notes", version: "1.2.0", entrypoint: "index.html", permissions: [] });

describe("app release catalog", () => {
  test("activates one immutable release per app ID", () => {
    const first = catalogWithRelease({ schemaVersion: 1, releases: [] }, "store", "notes", "a".repeat(64), 123, manifest);
    expect(first.releases[0]?.fileName).toBe("notes-1.2.0-aaaaaaaaaaaa.hiraya.app");
    const updated = catalogWithRelease(first, "store", "notes", "b".repeat(64), 456, { ...manifest, version: "1.3.0" });
    expect(updated.releases).toHaveLength(1);
    expect(updated.releases[0]?.manifest.version).toBe("1.3.0");
    expect(() => catalogWithRelease(first, "store", "notes", "b".repeat(64), 123, manifest)).toThrow("different bytes");
    expect(() => catalogWithRelease(first, "system", "notes", "a".repeat(64), 123, manifest)).toThrow("not supported");
  });

  test("retires only explicitly retired system app releases", () => {
    const retired = parseManifestV2({ ...manifest, id: "app.hiraya.markdown-preview", name: "Markdown Preview" });
    const active = parseManifestV2({ ...manifest, id: "app.hiraya.media-viewer", name: "Document & Media Viewer" });
    const catalog = { schemaVersion: 1 as const, releases: [
      { kind: "system" as const, slug: "markdown-preview", fileName: "markdown-preview.hiraya.app", digest: "a".repeat(64), size: 1, manifest: retired },
      { kind: "system" as const, slug: "media-viewer", fileName: "media-viewer.hiraya.app", digest: "b".repeat(64), size: 1, manifest: active },
    ] };
    expect(catalogWithoutRetiredSystemRelease(catalog, "markdown-preview").releases).toEqual([catalog.releases[1]]);
    const scene = parseManifestV2({ ...manifest, id: "app.hiraya.scene-editor", name: "Scene Studio" });
    expect(catalogWithoutRetiredSystemRelease({ ...catalog, releases: [{ ...catalog.releases[0], slug: "scene-editor", manifest: scene }] }, "scene-editor").releases).toEqual([]);
    expect(() => catalogWithoutRetiredSystemRelease(catalog, "media-viewer")).toThrow("not an active retired system app");
  });
});

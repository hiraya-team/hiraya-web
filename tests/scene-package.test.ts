import { describe, expect, test } from "bun:test";
import { createSceneArchive } from "@hiraya-team/app-cli";
import { HIRAYA_SCENE_MANIFEST_PATH, HIRAYA_SCENE_MIME_TYPE, importedFileMimeType } from "../src/domain/scene";
import { inspectSceneFile, sceneMotionBlocked, SCENE_CSP } from "../src/features/scenes/scene-package";
import { fileCapabilities } from "../src/ui/file-capabilities";

const encoder = new TextEncoder();
function scene() { return createSceneArchive(new Map([[HIRAYA_SCENE_MANIFEST_PATH, encoder.encode('{"schemaVersion":1,"entrypoint":"index.html"}')], ["index.html", encoder.encode("<!doctype html><button>Scene</button>")]])); }

describe("Scene packages", () => {
  test("inspects a compatible package and rejects misleading metadata", async () => {
    const bytes = scene();
    expect((await inspectSceneFile(new File([bytes], "demo.hiraya.scene", { type: HIRAYA_SCENE_MIME_TYPE }))).manifest.entrypoint).toBe("index.html");
    expect((await inspectSceneFile(new File([bytes], "renamed", { type: HIRAYA_SCENE_MIME_TYPE }))).manifest.entrypoint).toBe("index.html");
    await expect(inspectSceneFile(new File([bytes], "demo.hiraya.scene", { type: "application/zip" }))).rejects.toThrow("file type");
  });

  test("normalizes browser uploads to the published Scene MIME type", () => {
    expect(importedFileMimeType({ name: "demo.HIRAYA.SCENE", type: "application/octet-stream" })).toBe(HIRAYA_SCENE_MIME_TYPE);
    expect(importedFileMimeType({ name: "photo.png", type: "image/png" })).toBe("image/png");
  });

  test("recognizes Scene packages by their compound extension", () => {
    expect(fileCapabilities({ id: "scene", kind: "file", name: "demo.hiraya.scene", parentId: null, createdAt: 1, modifiedAt: 1, position: { x: 0, y: 0 }, mimeType: "application/octet-stream", size: 4 })).toMatchObject({ editable: false, preview: "none", icon: "archive" });
  });

  test("uses a no-network, no-frame, no-worker sandbox policy", () => {
    expect(SCENE_CSP).toContain("connect-src 'none'");
    expect(SCENE_CSP).toContain("frame-src 'none'");
    expect(SCENE_CSP).toContain("worker-src 'none'");
    expect(SCENE_CSP).toContain("object-src 'none'");
    expect(SCENE_CSP).toContain("form-action 'none'");
    expect(SCENE_CSP).toContain("navigate-to 'none'");
    expect(SCENE_CSP).not.toContain("https:");
  });

  test("keeps reduced-motion wallpaper execution disabled and widgets user-gated", async () => {
    expect(sceneMotionBlocked(true, "wallpaper", false)).toBe(true);
    expect(sceneMotionBlocked(true, "wallpaper", true)).toBe(true);
    expect(sceneMotionBlocked(true, "widget", false)).toBe(true);
    expect(sceneMotionBlocked(true, "widget", true)).toBe(false);
    expect(sceneMotionBlocked(false, "wallpaper", false)).toBe(false);
    const source = await Bun.file(new URL("../src/features/scenes/SceneFrame.tsx", import.meta.url)).text();
    expect(source).toContain('mode === "wallpaper" ? null');
    expect(source).toContain("Run Scene");
    expect(source).toContain('sandbox="allow-scripts"');
    expect(source).toContain('tabIndex={mode === "wallpaper" ? -1 : 0}');
  });
});

import { inspectHirayaArchive, sha256, type ThemePackageInspection } from "@hiraya-team/app-cli";
import { materializeAppPackage, SANDBOX_CSP, type MaterializedApp } from "@hiraya/app-runtime";
import type { AppPackageInspection } from "@hiraya-team/apps-contracts";
import type { ThemeWallpaperPackage } from "../domain/theme";

/** Defines the theme scene CSP. */
export const THEME_SCENE_CSP = SANDBOX_CSP.replace("frame-src data: blob:;", "frame-src 'none';").replace("allow-downloads", "");

export type ThemePackageCache = {
  readVerified(themeId: string, expected: ThemeWallpaperPackage): Promise<Blob | null>;
  write(themeId: string, expected: ThemeWallpaperPackage, content: Blob): Promise<unknown>;
};

/** Fetches theme package. */
export async function fetchThemePackage(_accessUrl: string, expectedThemeId: string, expected: ThemeWallpaperPackage, _signal?: AbortSignal, cache?: ThemePackageCache, _directBlobOrigin?: string): Promise<ThemePackageInspection> {
  void _accessUrl; void _signal; void _directBlobOrigin;
  let content: Blob | null = null;
  try { content = await cache?.readVerified(expectedThemeId, expected) ?? null; }
  catch (error) { console.warn("Hiraya could not read the cached theme package.", error); }
  if (!content) throw new Error("The theme package is unavailable.");
  const bytes = new Uint8Array(await content.arrayBuffer());
  if (bytes.byteLength !== expected.size || await sha256(bytes) !== expected.sha256) throw new Error("The downloaded theme package failed integrity verification.");
  const inspection = await inspectHirayaArchive(bytes);
  if (inspection.kind !== "theme" || inspection.manifest.id !== expectedThemeId || inspection.manifest.wallpaper?.kind !== expected.kind) throw new Error("The downloaded theme package does not match its saved wallpaper.");
  return inspection;
}

/** Computes wallpaper asset blob. */
export function wallpaperAssetBlob(inspection: ThemePackageInspection) {
  const wallpaper = inspection.manifest.wallpaper;
  if (!wallpaper || wallpaper.kind === "scene") throw new Error("The theme package does not contain a media wallpaper.");
  const bytes = inspection.files.get(wallpaper.entrypoint);
  if (!bytes) throw new Error("The theme wallpaper asset is missing.");
  const extension = wallpaper.entrypoint.toLowerCase().split(".").at(-1);
  const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "gif" ? "image/gif" : extension === "webm" ? "video/webm" : "video/mp4";
  return new Blob([bytes], { type: mime });
}

/** Materializes a theme scene from its package archive. */
export function materializeThemeScene(inspection: ThemePackageInspection): MaterializedApp {
  const wallpaper = inspection.manifest.wallpaper;
  if (!wallpaper || wallpaper.kind !== "scene") throw new Error("The theme package does not contain a scene wallpaper.");
  const appPackage = {
    ...inspection,
    manifest: { schemaVersion: 2, uiRuntime: 1, id: inspection.manifest.id, name: inspection.manifest.name, version: "0.0.0", entrypoint: wallpaper.entrypoint, permissions: [] },
  } as AppPackageInspection;
  return materializeAppPackage(appPackage, { abi: 1, script: "", styles: "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}" }, URL, THEME_SCENE_CSP);
}

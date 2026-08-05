import { inspectHirayaArchive, sha256, type ThemePackageInspection } from "@hiraya-team/app-cli";
import { materializeAppPackage, SANDBOX_CSP, type MaterializedApp } from "@hiraya/app-runtime";
import type { AppPackageInspection } from "@hiraya-team/apps-contracts";
import type { ThemeWallpaperPackage } from "../domain/theme";
import { parseContentAccessDescriptor, type DirectBlobAccess } from "./contracts";
import { authenticatedHeaders } from "./api-routes";

export const THEME_SCENE_CSP = SANDBOX_CSP.replace("frame-src data: blob:;", "frame-src 'none';").replace("allow-downloads", "");

export type ThemePackageCache = {
  readVerified(themeId: string, expected: ThemeWallpaperPackage): Promise<Blob | null>;
  write(themeId: string, expected: ThemeWallpaperPackage, content: Blob): Promise<unknown>;
};

export function parseThemePackageAccess(value: unknown, expected: ThemeWallpaperPackage): DirectBlobAccess {
  const descriptor = parseContentAccessDescriptor(value, expected.assetId, expected.revision, expected.size);
  if (descriptor.sha256 !== expected.sha256) throw new Error("The theme package content does not match the selected theme.");
  return descriptor.access;
}

export async function fetchThemePackage(accessUrl: string, expectedThemeId: string, expected: ThemeWallpaperPackage, signal?: AbortSignal, cache?: ThemePackageCache): Promise<ThemePackageInspection> {
  let content: Blob | null = null;
  try { content = await cache?.readVerified(expectedThemeId, expected) ?? null; }
  catch (error) { console.warn("Hiraya could not read the cached theme package.", error); }
  const cached = content !== null;
  if (!content) {
    const publicContent = accessUrl.startsWith("/api/public/");
    const descriptorResponse = await fetch(accessUrl, { credentials: "same-origin", cache: "no-store", headers: publicContent ? undefined : authenticatedHeaders(), signal });
    if (!descriptorResponse.ok) throw new Error("The theme package is unavailable.");
    if (!descriptorResponse.headers.get("content-type")?.includes("application/json")) content = await descriptorResponse.blob();
    else {
      const access = parseThemePackageAccess(await descriptorResponse.json(), expected);
      const response = await fetch(access.url, { method: access.method, headers: access.url.startsWith("/") ? authenticatedHeaders(access.headers) : access.headers, credentials: access.url.startsWith("/") ? "same-origin" : "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal });
      if (!response.ok) throw new Error("The theme package could not be downloaded.");
      content = await response.blob();
    }
  }
  const bytes = new Uint8Array(await content.arrayBuffer());
  if (bytes.byteLength !== expected.size || !cached && await sha256(bytes) !== expected.sha256) throw new Error("The downloaded theme package failed integrity verification.");
  const inspection = await inspectHirayaArchive(bytes);
  if (inspection.kind !== "theme" || inspection.manifest.id !== expectedThemeId || inspection.manifest.wallpaper?.kind !== expected.kind) throw new Error("The downloaded theme package does not match its saved wallpaper.");
  if (cache && !cached) try { await cache.write(expectedThemeId, expected, content); }
  catch (error) { console.warn("Hiraya could not cache the theme package.", error); }
  return inspection;
}

export function wallpaperAssetBlob(inspection: ThemePackageInspection) {
  const wallpaper = inspection.manifest.wallpaper;
  if (!wallpaper || wallpaper.kind === "scene") throw new Error("The theme package does not contain a media wallpaper.");
  const bytes = inspection.files.get(wallpaper.entrypoint);
  if (!bytes) throw new Error("The theme wallpaper asset is missing.");
  const extension = wallpaper.entrypoint.toLowerCase().split(".").at(-1);
  const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "gif" ? "image/gif" : extension === "webm" ? "video/webm" : "video/mp4";
  return new Blob([bytes], { type: mime });
}

export function materializeThemeScene(inspection: ThemePackageInspection): MaterializedApp {
  const wallpaper = inspection.manifest.wallpaper;
  if (!wallpaper || wallpaper.kind !== "scene") throw new Error("The theme package does not contain a scene wallpaper.");
  const appPackage = {
    ...inspection,
    manifest: { schemaVersion: 2, uiRuntime: 1, id: inspection.manifest.id, name: inspection.manifest.name, version: "0.0.0", entrypoint: wallpaper.entrypoint, permissions: [] },
  } as AppPackageInspection;
  return materializeAppPackage(appPackage, { abi: 1, script: "", styles: "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}" }, URL, THEME_SCENE_CSP);
}

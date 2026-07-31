import { inspectHirayaArchive, sha256, type ThemePackageInspection } from "@hiraya/app-cli";
import { materializeAppPackage, SANDBOX_CSP, type MaterializedApp } from "@hiraya/app-runtime";
import type { AppPackageInspection } from "@hiraya/apps-contracts";
import type { ThemeWallpaperPackage } from "../domain/theme";
import { parseDirectBlobAccess, type DirectBlobAccess } from "./contracts";

export const THEME_SCENE_CSP = SANDBOX_CSP.replace("frame-src data: blob:;", "frame-src 'none';").replace("allow-downloads", "");

export function parseThemePackageAccess(value: unknown, expected: ThemeWallpaperPackage): DirectBlobAccess {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The theme package access response is invalid.");
  const item = value as Record<string, unknown>;
  if (item.assetId !== expected.assetId || item.contentRevision !== expected.revision || item.size !== expected.size || item.sha256 !== expected.sha256
    || !item.access) throw new Error("The theme package access response does not match the selected theme.");
  return parseDirectBlobAccess(item.access, "GET");
}

export async function fetchThemePackage(accessUrl: string, expectedThemeId: string, expected: ThemeWallpaperPackage, signal?: AbortSignal): Promise<ThemePackageInspection> {
  const descriptorResponse = await fetch(accessUrl, { credentials: "same-origin", cache: "no-store", signal });
  if (!descriptorResponse.ok) throw new Error("The theme package is unavailable.");
  const access = parseThemePackageAccess(await descriptorResponse.json(), expected);
  const response = await fetch(access.url, { method: access.method, headers: access.headers, credentials: access.url.startsWith("/") ? "same-origin" : "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Error("The theme package could not be downloaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expected.size || await sha256(bytes) !== expected.sha256) throw new Error("The downloaded theme package failed integrity verification.");
  const inspection = await inspectHirayaArchive(bytes);
  if (inspection.kind !== "theme" || inspection.manifest.id !== expectedThemeId || inspection.manifest.wallpaper?.kind !== expected.kind) throw new Error("The downloaded theme package does not match its saved wallpaper.");
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

import { inspectSceneArchive, type ScenePackageInspection } from "@hiraya-team/app-cli";
import type { AppPackageInspection } from "@hiraya-team/apps-contracts";
import { materializeAppPackage, SANDBOX_CSP, type MaterializedApp } from "@hiraya/app-runtime";
import { HIRAYA_SCENE_MIME_TYPE, MAX_SCENE_BYTES } from "../../domain/scene";

export const SCENE_CSP = `${SANDBOX_CSP.replace("frame-src data: blob:;", "frame-src 'none';")}; worker-src 'none'`;

export function sceneMotionBlocked(reducedMotion: boolean, mode: "widget" | "wallpaper", allowed: boolean) {
  return reducedMotion && (mode === "wallpaper" || !allowed);
}

export async function inspectSceneFile(file: { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<ScenePackageInspection> {
  if (file.type.split(";", 1)[0].trim().toLowerCase() !== HIRAYA_SCENE_MIME_TYPE) throw new Error("The file does not have the Scene file type.");
  if (file.size > MAX_SCENE_BYTES) throw new Error("Scene files must be no larger than 32 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new Error("The Scene file has an unexpected size.");
  return inspectSceneArchive(bytes);
}

export function materializeScene(inspection: ScenePackageInspection): MaterializedApp {
  const appPackage = {
    ...inspection,
    manifest: { schemaVersion: 2, uiRuntime: 1, id: "app.hiraya.scene", name: "Hiraya Scene", version: "0.0.0", entrypoint: inspection.manifest.entrypoint, permissions: [] },
  } as AppPackageInspection;
  return materializeAppPackage(appPackage, { abi: 1, script: "", styles: "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}" }, URL, SCENE_CSP);
}

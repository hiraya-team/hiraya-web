import { HIRAYA_SCENE_EXTENSION, HIRAYA_SCENE_MANIFEST_PATH, HIRAYA_SCENE_MIME_TYPE } from "@hiraya-team/apps-contracts/scene";

export { HIRAYA_SCENE_EXTENSION, HIRAYA_SCENE_MANIFEST_PATH, HIRAYA_SCENE_MIME_TYPE };

export const MAX_SCENE_BYTES = 32 * 1024 * 1024;

export function importedFileMimeType(file: { name: string; type: string }) {
  return file.name.toLowerCase().endsWith(HIRAYA_SCENE_EXTENSION) ? HIRAYA_SCENE_MIME_TYPE : file.type || "application/octet-stream";
}

export function isSceneFile(file: { name: string; mimeType: string; size: number }) {
  return file.mimeType.split(";", 1)[0].trim().toLowerCase() === HIRAYA_SCENE_MIME_TYPE
    && file.size <= MAX_SCENE_BYTES;
}

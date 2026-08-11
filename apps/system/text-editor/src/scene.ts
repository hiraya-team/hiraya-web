import { createSceneArchive, normalizeArchivePath, openSceneArchive, repackSceneArchive, type SceneDraftInspection } from "@hiraya-team/app-cli";
import { HIRAYA_SCENE_MANIFEST_PATH } from "@hiraya-team/apps-contracts/scene";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const TEXT_FILE = /\.(?:css|html?|js|json|mjs|svg|txt)$/i;

function cloneFiles(files: ReadonlyMap<string, Uint8Array>) { return new Map([...files].map(([path, bytes]) => [path, bytes.slice()])); }
export function archiveWritePayload(bytes: Uint8Array) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }
function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined) { return left === right || Boolean(left && right && left.length === right.length && left.every((byte, index) => byte === right[index])); }
function sameFiles(left: ReadonlyMap<string, Uint8Array>, right: ReadonlyMap<string, Uint8Array>) {
  if (left.size !== right.size) return false;
  return [...left].every(([path, bytes]) => sameBytes(bytes, right.get(path)));
}

export function starterSceneArchive() {
  return createSceneArchive(new Map([
    [HIRAYA_SCENE_MANIFEST_PATH, encoder.encode('{\n  "schemaVersion": 1,\n  "entrypoint": "index.html"\n}\n')],
    ["index.html", encoder.encode('<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head><body><button id="star">A small scene</button><script src="scene.js"></script></body></html>\n')],
    ["style.css", encoder.encode('html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#243b3d;color:#f5deb0;font:600 18px system-ui}button{padding:16px 22px;border:1px solid currentColor;border-radius:12px;color:inherit;background:transparent}\n')],
    ["scene.js", encoder.encode('document.querySelector("#star").addEventListener("click",event=>event.currentTarget.textContent="Scene is running")\n')],
  ]));
}

export class SceneArchiveState {
  files = new Map<string, Uint8Array>();
  persisted = new Map<string, Uint8Array>();
  revision: number | null = null;
  conflict = false;

  static async open(bytes: Uint8Array, revision: number | null) {
    const draft = await openSceneArchive(bytes);
    const state = new SceneArchiveState();
    state.files = cloneFiles(draft.files);
    state.persisted = cloneFiles(draft.files);
    state.revision = revision;
    return { state, draft };
  }

  get dirty() { return !sameFiles(this.files, this.persisted); }
  paths() { return [...this.files.keys()].sort((a, b) => a.localeCompare(b)); }
  pathDirty(path: string) { return !sameBytes(this.files.get(path), this.persisted.get(path)); }
  isText(path: string) { return path === HIRAYA_SCENE_MANIFEST_PATH || TEXT_FILE.test(path); }
  readText(path: string) { const bytes = this.files.get(path); if (!bytes || !this.isText(path)) return null; return decoder.decode(bytes); }
  writeText(path: string, text: string) { if (!this.isText(path)) throw new Error("Binary assets cannot be edited as text."); this.files.set(path, encoder.encode(text)); }
  createText(path: string) { const next = normalizeArchivePath(path); if (this.files.has(next) || !TEXT_FILE.test(next)) throw new Error("Choose a new text file name."); this.files.set(next, new Uint8Array()); return next; }
  import(path: string, bytes: Uint8Array) { const next = normalizeArchivePath(path); if (this.files.has(next)) throw new Error(`“${next}” already exists.`); this.files.set(next, bytes.slice()); return next; }
  rename(path: string, next: string) { const bytes = this.files.get(path); const normalized = normalizeArchivePath(next); if (!bytes || path === HIRAYA_SCENE_MANIFEST_PATH || this.files.has(normalized)) throw new Error("Choose an unused file name. The Scene manifest cannot be renamed."); this.files.delete(path); this.files.set(normalized, bytes); return normalized; }
  delete(path: string) { if (path === HIRAYA_SCENE_MANIFEST_PATH) throw new Error("The Scene manifest cannot be deleted."); this.files.delete(path); }
  pack() { return repackSceneArchive({ files: this.files }); }
  beginSave() { return { bytes: this.pack(), files: cloneFiles(this.files) }; }
  saved(snapshot: ReadonlyMap<string, Uint8Array>, revision: number) { this.persisted = cloneFiles(snapshot); this.revision = revision; this.conflict = false; }
  async remote(bytes: Uint8Array, revision: number) {
    if (revision === this.revision) return true;
    if (this.dirty) { this.conflict = true; return false; }
    const opened = await SceneArchiveState.open(bytes, revision);
    this.files = opened.state.files;
    this.persisted = opened.state.persisted;
    this.revision = revision;
    this.conflict = false;
    return true;
  }
  async inspectDraft(): Promise<SceneDraftInspection> { return openSceneArchive(this.pack()); }
}

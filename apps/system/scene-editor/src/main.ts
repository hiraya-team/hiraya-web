import { inspectSceneArchive, openSceneArchive } from "@hiraya-team/app-cli";
import type { AppPackageInspection, FileHandle, FileMetadata } from "@hiraya-team/apps-contracts";
import { HIRAYA_SCENE_MIME_TYPE } from "@hiraya-team/apps-contracts/scene";
import type { HirayaClient } from "@hiraya-team/apps-sdk";
import { materializeAppPackage, SANDBOX_CSP, type MaterializedApp } from "@hiraya/app-runtime";
import { terminateSandboxNavigation } from "@hiraya/app-runtime/navigation";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { minimalSetup } from "codemirror";
import { connectSystemApp, describeError, formatBytes, required, setAppLoading } from "@hiraya/system-apps-shared";
import { archiveWritePayload, SceneArchiveState, starterSceneArchive } from "./archive-state";
import "./style.css";

const APP_ID = "app.hiraya.scene-editor";
const content = required<HTMLElement>("#content");
const loading = required<HTMLElement>("#loading");
const workbench = required<HTMLElement>("#workbench");
const fileTree = required<HTMLElement>("#file-tree");
const editorElement = required<HTMLElement>("#editor");
const binary = required<HTMLElement>("#binary");
const preview = required<HTMLElement>("#preview");
const validation = required<HTMLElement>("#validation");
const status = required<HTMLElement>("#status");
let hiraya: HirayaClient;
let archive = new SceneArchiveState();
let handle: FileHandle | null = null;
let metadata: FileMetadata | null = null;
let activePath = "";
let editor: EditorView | null = null;
let previewResource: MaterializedApp | null = null;
let stopPreview: (() => void) | null = null;
let previewTimer = 0;

required("#new-file").addEventListener("click", () => void createTextFile());
required("#import-assets").addEventListener("click", () => void importAssets());
required("#rename-file").addEventListener("click", () => void renameFile());
required("#delete-file").addEventListener("click", () => void deleteFile());
fileTree.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(fileTree.querySelectorAll<HTMLButtonElement>("button[data-path]"));
  const current = items.indexOf(event.target as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
  const path = items[next]?.dataset.path;
  if (!path) return;
  event.preventDefault();
  openPath(path);
  requestAnimationFrame(() => fileTree.querySelector<HTMLButtonElement>(`button[data-path="${CSS.escape(path)}"]`)?.focus());
});
addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(event.shiftKey); } });
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    app.onDispose(() => { clearTimeout(previewTimer); stopPreview?.(); previewResource?.revoke(); editor?.destroy(); });
    hiraya.on("commands.invoked", ({ id }) => id === "save" ? void save(false) : id === "save-as" ? void save(true) : id === "open" ? void chooseOpen() : id === "new" ? void newScene() : undefined);
    hiraya.on("files.changed", ({ handles }) => { if (handle && handles.includes(handle)) void remoteChanged(); });
    await hiraya.commands.set([{ id: "new", title: "New Scene" }, { id: "open", title: "Open Scene" }, { id: "save", title: "Save", shortcut: "Ctrl+S" }, { id: "save-as", title: "Save As", shortcut: "Ctrl+Shift+S" }]);
    const launchFile = app.launch.files[0];
    if (launchFile) await load(launchFile);
    else await newScene(true);
    setAppLoading(content, workbench, loading);
  } catch (error) {
    setAppLoading(content, workbench, loading);
    setStatus(describeError(error, "Scene Studio could not start."), true);
  }
}

async function newScene(offerSave = false) {
  const opened = await SceneArchiveState.open(starterSceneArchive(), null);
  archive = opened.state; handle = null; metadata = null; activePath = "index.html";
  render(); setStatus("Starter Scene ready.");
  if (offerSave) await save(true);
}

async function chooseOpen() {
  const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: [".hiraya.scene", HIRAYA_SCENE_MIME_TYPE] });
  if (selected?.[0]) await load(selected[0]);
}

async function load(next: FileHandle) {
  const entry = await hiraya.files.stat(next);
  if (entry.kind !== "file") throw new Error("Choose a Scene file.");
  const { data } = await hiraya.files.readAll(next);
  const opened = await SceneArchiveState.open(new Uint8Array(data), entry.metadata.contentRevision);
  archive = opened.state; handle = next; metadata = entry.metadata; activePath = opened.draft.manifest?.entrypoint ?? "hiraya.scene.json";
  render(); setStatus(opened.draft.manifestError ? "Opened an invalid draft. Fix validation errors when ready." : `Opened ${entry.metadata.name}.`);
}

async function save(saveAs: boolean) {
  let target = saveAs ? null : handle;
  if (!target) target = await hiraya.dialogs.saveFile({ suggestedName: metadata?.name ?? "Untitled.hiraya.scene", mimeType: HIRAYA_SCENE_MIME_TYPE });
  if (!target) return;
  const pending = archive.beginSave();
  try {
    const saved = await hiraya.files.writeAll(target, archiveWritePayload(pending.bytes), { mimeType: HIRAYA_SCENE_MIME_TYPE, ...(target === handle && archive.revision !== null ? { expectedRevision: archive.revision } : {}) });
    archive.saved(pending.files, saved.contentRevision); handle = target; metadata = saved;
    renderState(); setStatus(`Saved ${saved.name}${(await archive.inspectDraft()).manifestError ? " as an editable invalid draft" : ""}.`);
  } catch (error) { setStatus(describeError(error, "The Scene could not be saved. Your draft is preserved."), true); }
}

async function remoteChanged() {
  if (!handle) return;
  const entry = await hiraya.files.stat(handle);
  if (entry.kind !== "file" || entry.metadata.contentRevision === archive.revision) return;
  const { data } = await hiraya.files.readAll(handle);
  if (await archive.remote(new Uint8Array(data), entry.metadata.contentRevision)) { metadata = entry.metadata; render(); setStatus("Reloaded the updated Scene."); }
  else { required<HTMLElement>("#conflict").hidden = false; renderState(); setStatus("Remote changes detected. Your unsaved draft is preserved; use Save As to keep both.", true); }
}

function render() { renderTree(); openPath(activePath || archive.paths()[0] || ""); renderState(); }
function renderTree() {
  fileTree.replaceChildren(...archive.paths().map((path) => {
    const button = document.createElement("button");
    button.type = "button"; button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(path === activePath)); button.dataset.path = path;
    button.tabIndex = path === activePath ? 0 : -1;
    button.innerHTML = `<span>${archive.isText(path) ? "Text" : "Asset"}</span><strong></strong>`;
    button.querySelector("strong")!.textContent = path;
    button.addEventListener("click", () => openPath(path));
    return button;
  }));
}

function openPath(path: string) {
  activePath = path; renderTree(); editor?.destroy(); editor = null;
  required("#active-file").textContent = path || "No file selected";
  const text = archive.readText(path);
  editorElement.hidden = text === null; binary.hidden = text !== null;
  if (text === null) {
    const bytes = archive.files.get(path);
    binary.innerHTML = bytes ? `<strong>Packaged asset</strong><dl><dt>Path</dt><dd></dd><dt>Size</dt><dd>${formatBytes(bytes.byteLength)}</dd></dl>` : "";
    const pathValue = binary.querySelector("dd");
    if (pathValue) pathValue.textContent = path;
    required("#file-kind").textContent = "Binary";
  } else {
    required("#file-kind").textContent = "Text";
    editor = new EditorView({ parent: editorElement, state: EditorState.create({ doc: text, extensions: [minimalSetup, languageFor(path), syntaxHighlighting(HighlightStyle.define([
      { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.number, tags.bool, tags.null], color: "var(--editor-keyword)" },
      { tag: [tags.string, tags.special(tags.string)], color: "var(--editor-string)" },
      { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--hiraya-text-muted)", fontStyle: "italic" },
    ])), EditorView.contentAttributes.of({ "aria-label": `Edit ${path}` }), EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      archive.writeText(path, update.state.doc.toString()); renderState(); schedulePreview();
    })] }) });
    editor.scrollDOM.tabIndex = 0;
    editor.scrollDOM.setAttribute("aria-label", `Scroll ${path}`);
  }
  schedulePreview();
}

function languageFor(path: string) { return path.endsWith(".css") ? css() : path.endsWith(".json") ? json() : path.match(/\.m?js$/) ? javascript() : path.match(/\.html?$/) ? html() : []; }
async function requestFileAction(title: string, message: string, action: string, value?: string) {
  const dialog = required<HTMLDialogElement>("#file-dialog");
  const input = required<HTMLInputElement>("#file-dialog-input");
  required("#file-dialog-title").textContent = title;
  required("#file-dialog-message").textContent = message;
  required("#file-dialog-confirm").textContent = action;
  required<HTMLElement>("#file-dialog-field").hidden = value === undefined;
  input.value = value ?? "";
  dialog.returnValue = "";
  return new Promise<string | null>((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm" ? input.value.trim() : null), { once: true });
    dialog.showModal();
    if (value !== undefined) requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}
async function createTextFile() { const path = await requestFileAction("New text file", "Add a local HTML, CSS, JavaScript, JSON, SVG, or text file to this Scene.", "Create", "script.js"); if (!path) return; try { archive.createText(path); activePath = path; render(); } catch (error) { setStatus(String(error), true); } }
async function renameFile() { if (!activePath) return; const next = await requestFileAction("Rename file", `Choose a new package path for ${activePath}.`, "Rename", activePath); if (!next || next === activePath) return; try { archive.rename(activePath, next); activePath = next; render(); } catch (error) { setStatus(String(error), true); } }
async function deleteFile() { if (!activePath || await requestFileAction("Delete file", `Delete ${activePath} from this Scene? This takes effect when you save.`, "Delete") === null) return; try { archive.delete(activePath); activePath = archive.paths()[0] ?? ""; render(); } catch (error) { setStatus(String(error), true); } }
async function importAssets() {
  const selected = await hiraya.dialogs.openFile({ multiple: true });
  for (const selectedHandle of selected ?? []) {
    const entry = await hiraya.files.stat(selectedHandle);
    if (entry.kind !== "file") continue;
    const { data } = await hiraya.files.readAll(selectedHandle);
    try { archive.import(entry.metadata.name, new Uint8Array(data)); } catch (error) { setStatus(String(error), true); }
  }
  render();
}

function renderState() {
  required("#archive-name").textContent = metadata?.name ?? "Untitled Scene";
  required<HTMLElement>("#conflict").hidden = !archive.conflict;
  void hiraya?.window.setDirty(archive.dirty);
  void hiraya?.window.setTitle(`${archive.dirty ? "*" : ""}${metadata?.name ?? "Untitled Scene"} - Scene Studio`);
}
function setStatus(message: string, error = false) { status.textContent = message; status.closest("hiraya-status-bar")?.classList.toggle("error", error); }
function schedulePreview() { clearTimeout(previewTimer); previewTimer = window.setTimeout(() => void updatePreview(), 180); }
async function updatePreview() {
  stopPreview?.(); stopPreview = null; previewResource?.revoke(); previewResource = null; preview.replaceChildren(); validation.classList.remove("error");
  try {
    const inspection = await inspectSceneArchive(archive.pack());
    const app = { ...inspection, manifest: { schemaVersion: 2, uiRuntime: 1, id: "app.hiraya.scene-preview", name: "Scene preview", version: "0.0.0", entrypoint: inspection.manifest.entrypoint, permissions: [] } } as AppPackageInspection;
    const csp = `${SANDBOX_CSP.replace("frame-src data: blob:;", "frame-src 'none';")}; worker-src 'none'`;
    previewResource = materializeAppPackage(app, { abi: 1, script: "", styles: "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}" }, URL, csp);
    const frame = document.createElement("iframe"); frame.title = "Unsaved Scene preview"; frame.sandbox.add("allow-scripts"); frame.setAttribute("csp", csp); frame.tabIndex = 0;
    stopPreview = terminateSandboxNavigation(frame, previewResource.navigationToken, { onNavigation: () => { stopPreview?.(); stopPreview = null; previewResource?.revoke(); validation.textContent = "Preview navigation was blocked."; validation.classList.add("error"); } });
    frame.srcdoc = previewResource.html; preview.append(frame); validation.textContent = "Draft is valid. Previewing unsaved in-memory files."; required("#preview-state").textContent = "Live";
  } catch (error) {
    const draft = await openSceneArchive(archive.pack()).catch(() => null);
    validation.textContent = draft?.manifestError ?? (error instanceof Error ? error.message : "Strict Scene validation failed."); validation.classList.add("error");
    preview.innerHTML = '<div class="preview-empty"><strong>Preview unavailable</strong><span>Fix the validation error. You can still save this draft.</span></div>'; required("#preview-state").textContent = "Invalid draft";
  }
}

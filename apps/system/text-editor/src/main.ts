import { inspectSceneArchive } from "@hiraya-team/app-cli";
import type { AppPackageInspection } from "@hiraya-team/apps-contracts";
import { HIRAYA_SCENE_MIME_TYPE } from "@hiraya-team/apps-contracts/scene";
import { HirayaSdkError, type DirectoryEntry, type FileHandle, type FileMetadata, type FolderHandle, type FolderMetadata, type HirayaClient } from "@hiraya-team/apps-sdk";
import { materializeAppPackage, SANDBOX_CSP, type MaterializedApp } from "@hiraya/app-runtime";
import { terminateSandboxNavigation } from "@hiraya/app-runtime/navigation";
import { connectSystemApp, describeError, formatBytes, required, setAppLoading } from "@hiraya/system-apps-shared";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { minimalSetup } from "codemirror";
import { formatText, parseTextEditorSettings, textEditorControlState, textEditorLanguageFor, TextDocumentOperations, TextDocumentState, writeRestrictionMessage, type TextEditorLanguage, type TextEditorSettings } from "./editor";
import { archiveWritePayload, SceneArchiveState, starterSceneArchive } from "./scene";
import { editorFileKind, fileMimeTypeForSave, filterWorkspaceEntries, isEditableFile, isWithinFolder, sortWorkspaceEntries, type EditorFileKind } from "./workspace";
import "./style.css";

type DocumentTab = {
  id: string;
  handle: FileHandle | null;
  metadata: FileMetadata | null;
  name: string;
  kind: EditorFileKind;
  state: TextDocumentState | null;
  saving: boolean;
  autoSaveTimer: number;
  previewSource: string | null;
  previewObjectUrl: string | null;
  previewExpiresAt: number;
  previewRefreshAttempted: boolean;
  scenePath: string | null;
};

type SceneWorkspace = { archive: SceneArchiveState; handle: FileHandle | null; metadata: FileMetadata | null };

const APP_ID = "app.hiraya.text-editor";
const SETTINGS_KEY = "editor-settings";
const status = required<HTMLElement>("#status");
const content = required<HTMLElement>("#content");
const workbench = required<HTMLElement>("#workbench");
const editorElement = required<HTMLElement>("#editor");
const previewElement = required<HTMLElement>("#preview");
const stageContent = required<HTMLElement>("#stage-content");
const scenePreview = required<HTMLElement>("#scene-preview");
const sceneValidation = required<HTMLElement>("#scene-validation");
const loading = required<HTMLElement>("#loading");
const tabsElement = required<HTMLElement>("#tabs");
const breadcrumbs = required<HTMLElement>("#breadcrumbs");
const fileTree = required<HTMLElement>("#file-tree");
const workspaceHeading = required<HTMLElement>("#workspace-heading");
const searchInput = required<HTMLInputElement>("#workspace-search");
const searchResults = required<HTMLElement>("#search-results");
const sidebar = required<HTMLElement>("#sidebar");
const operations = new TextDocumentOperations();
const languageConfig = new Compartment();
const fontConfig = new Compartment();
const lineWrapConfig = new Compartment();
const editableConfig = new Compartment();
let switchingDocument = false;
const editorExtensions: Extension = [
  minimalSetup,
  EditorState.tabSize.of(2),
  EditorView.contentAttributes.of({ "aria-label": "Document text", spellcheck: "true" }),
  placeholder("Start writing..."),
  languageConfig.of([]),
  fontConfig.of(EditorView.theme({ "&": { fontSize: "13px" } })),
  lineWrapConfig.of(EditorView.lineWrapping),
  editableConfig.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
  syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--editor-keyword)" },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--editor-string)" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--hiraya-text-muted)", fontStyle: "italic" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--editor-keyword)" },
    { tag: [tags.heading, tags.strong], color: "var(--editor-keyword)", fontWeight: "700" },
    { tag: [tags.link, tags.url], color: "var(--editor-keyword)", textDecoration: "underline" },
  ])),
  EditorView.updateListener.of((update) => {
    if (!update.docChanged || switchingDocument || !activeTab) return;
    const text = update.state.doc.toString();
    activeTab.state?.edit(text);
    if (scene && activeTab.scenePath) {
      scene.archive.writeText(activeTab.scenePath, text);
      scheduleScenePreview();
    }
    renderDocumentState();
    if (!activeTab.scenePath) scheduleAutoSave(activeTab);
  }),
];
const editor = new EditorView({ parent: editorElement, extensions: editorExtensions });

let hiraya: HirayaClient;
let settings = parseTextEditorSettings(undefined);
let tabs: DocumentTab[] = [];
let activeTab: DocumentTab | null = null;
let workspace: FolderMetadata | null = null;
let scene: SceneWorkspace | null = null;
let workspaceGeneration = 0;
let selectedHandle: string | null = null;
let selectedPath: string | null = null;
let saving = false;
let formatting = false;
let opening = false;
let initialized = false;
let canWrite = false;
let sidebarOpen = true;
let writeReason: "available" | "read-only" | "shared-offline" | "temporarily-unavailable" = "temporarily-unavailable";
let windowTitle = "";
let windowDirty: boolean | null = null;
let commandSignature = "";
let scenePreviewResource: MaterializedApp | null = null;
let stopScenePreview: (() => void) | null = null;
let scenePreviewTimer = 0;
const children = new Map<FolderHandle, DirectoryEntry[]>();
const entries = new Map<string, DirectoryEntry>();
const parents = new Map<string, FolderHandle | null>();
const expanded = new Set<FolderHandle>();

required("#close-sidebar").addEventListener("click", () => setSidebarOpen(false));
required("#sidebar-backdrop").addEventListener("click", () => setSidebarOpen(false));
required("#explorer-view").addEventListener("click", () => toggleSidebar("explorer"));
required("#search-view").addEventListener("click", () => toggleSidebar("search"));
required("#settings-view").addEventListener("click", () => toggleSidebar("settings"));
required("#open-workspace").addEventListener("click", () => void chooseWorkspace());
workspaceHeading.addEventListener("click", () => { if (scene) { selectedPath = ""; renderWorkspace(); renderControlState(); } else if (workspace) { selectedHandle = workspace.handle; selectedPath = ""; renderWorkspace(); renderControlState(); } });
required("#refresh-tree").addEventListener("click", () => void refreshWorkspace());
required("#new-file").addEventListener("click", () => void createEntry("file"));
required("#new-folder").addEventListener("click", () => void createEntry("folder"));
required("#import-assets").addEventListener("click", () => void importSceneAssets());
required("#rename-entry").addEventListener("click", () => void renameEntry());
required("#delete-entry").addEventListener("click", () => void deleteEntry());
required<HTMLSelectElement>("#font-size").addEventListener("change", (event) => void changeSettings({ ...settings, fontSize: Number((event.target as HTMLSelectElement).value) }));
for (const [id, key] of [["line-wrap", "lineWrap"], ["auto-save", "autoSave"], ["auto-format", "autoFormat"]] as const) {
  required<HTMLInputElement>(`#${id}`).addEventListener("change", (event) => void changeSettings({ ...settings, [key]: (event.target as HTMLInputElement).checked }));
}
searchInput.addEventListener("input", () => void searchWorkspace(searchInput.value));
fileTree.addEventListener("click", (event) => void activateTreeTarget(event.target));
fileTree.addEventListener("keydown", (event) => void handleTreeKey(event));
searchResults.addEventListener("hiraya-item-select", (event) => void activateSearchResult((event as CustomEvent<{ id: string }>).detail.id));
addEventListener("keydown", handleShortcut);
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    publishWindowTitle("Integrated Editor");
    app.onDispose(() => { initialized = false; operations.invalidate(); clearTimeout(scenePreviewTimer); stopScenePreview?.(); scenePreviewResource?.revoke(); for (const tab of tabs) { clearTimeout(tab.autoSaveTimer); releasePreview(tab); } editor.destroy(); });
    let copiedSettings: unknown;
    try { copiedSettings = app.launch.arguments[0] ? JSON.parse(app.launch.arguments[0]) : undefined; } catch { copiedSettings = undefined; }
    const stored = await hiraya.storage.get(SETTINGS_KEY);
    settings = parseTextEditorSettings(stored, parseTextEditorSettings(copiedSettings));
    if (stored === undefined) await hiraya.storage.set(SETTINGS_KEY, settings);
    applySettings();
    applyCapabilities(await hiraya.app.getCapabilities());
    hiraya.on("capabilities.changed", applyCapabilities);
    hiraya.on("commands.invoked", ({ id }) => id === "save" ? void save(false) : id === "save-as" ? void save(true) : id === "open" ? void open() : id === "new-scene" ? void newScene() : id === "workspace" ? void chooseWorkspace() : id === "search" ? showSidebar("search") : id === "format" ? applyFormatting() : undefined);
    hiraya.on("files.changed", ({ handles }) => void remoteChanged(handles));
    const launchFile = app.launch.files[0];
    if (launchFile) {
      const generation = operations.beginForeground();
      try { await load(launchFile, generation); }
      catch (error) { setStatus(describeError(error, "Could not open the launch file."), true); }
      finally { operations.finishForeground(generation); }
    } else createUntitled();
    initialized = true;
    setAppLoading(content, workbench, loading);
    renderControlState();
    renderDocumentState();
    if (!launchFile) setStatus(canWrite ? "Ready. Open a workspace to browse and manage files." : writeRestrictionMessage(writeReason, false));
  } catch (error) {
    opening = false;
    setAppLoading(content, workbench, loading);
    renderControlState();
    setStatus(describeError(error, "Integrated Editor could not start."), true);
  }
}

function createUntitled() {
  const state = new TextDocumentState();
  state.load("", 0);
  const tab: DocumentTab = { id: crypto.randomUUID(), handle: null, metadata: null, name: "Untitled.txt", kind: "text", state, saving: false, autoSaveTimer: 0, previewSource: null, previewObjectUrl: null, previewExpiresAt: 0, previewRefreshAttempted: false, scenePath: null };
  tabs.push(tab);
  activateTab(tab, false);
}

async function open() {
  if (!initialized || saving || opening) return;
  const generation = operations.beginForeground();
  try {
    const selected = await hiraya.dialogs.openFile({ multiple: false });
    if (selected?.[0] && operations.isForegroundCurrent(generation)) await load(selected[0], generation);
  } catch (error) { if (operations.isForegroundCurrent(generation)) setStatus(describeError(error, "Could not open the file."), true); }
  finally { operations.finishForeground(generation); }
}

async function load(next: FileHandle, generation: number) {
  const entry = await statFile(next);
  if (!operations.isForegroundCurrent(generation)) return;
  if (editorFileKind(entry) === "scene") {
    if (scene?.handle === next) return;
    await loadScene(next, entry, generation);
    return;
  }
  if (scene && !await leaveScene("Open another file?")) return;
  const existing = tabs.find((tab) => tab.handle === next);
  if (existing) { activateTab(existing); return; }
  opening = true;
  setAppLoading(content, workbench, loading, "Opening file...");
  renderControlState();
  try {
    const kind = editorFileKind(entry);
    const loaded = kind === "text" ? await readText(next, entry) : null;
    const preview = kind === "text" ? emptyPreview() : await createPreview(next, entry, kind);
    if (!operations.isForegroundCurrent(generation)) { releasePreviewValue(preview.previewObjectUrl); return; }
    const state = loaded ? new TextDocumentState() : null;
    if (state && loaded) state.load(loaded.text, loaded.entry.contentRevision);
    const metadata = loaded?.entry ?? entry;
    const tab: DocumentTab = { id: crypto.randomUUID(), handle: next, metadata, name: metadata.name, kind, state, saving: false, autoSaveTimer: 0, ...preview, scenePath: null };
    const cleanUntitled = tabs.length === 1 && tabs[0]?.handle === null && !tabDirty(tabs[0]);
    if (cleanUntitled) tabs = [];
    tabs.push(tab);
    activateTab(tab);
    setStatus(kind === "text" ? canWrite ? `Opened ${tab.name}.` : writeRestrictionMessage(writeReason, false) : `${metadata.mimeType} · ${formatBytes(metadata.size)}`);
  } finally {
    if (operations.isForegroundCurrent(generation)) {
      opening = false;
      setAppLoading(content, workbench, loading);
      renderControlState();
    }
  }
}

async function statFile(next: FileHandle) {
  const entry = await hiraya.files.stat(next);
  if (entry.kind !== "file") throw new Error("The selected item is not a file.");
  return entry.metadata;
}

async function leaveScene(title: string) {
  if (!scene) return true;
  if (scene.archive.dirty && !await hiraya.dialogs.confirm({ title, message: "The Scene has changes that have not been saved.", confirmLabel: "Discard changes", destructive: true })) return false;
  clearSceneWorkspace();
  return true;
}

function clearSceneWorkspace() {
  clearTimeout(scenePreviewTimer);
  stopScenePreview?.(); stopScenePreview = null;
  scenePreviewResource?.revoke(); scenePreviewResource = null;
  scenePreview.replaceChildren();
  scene = null;
  tabs = tabs.filter((tab) => !tab.scenePath);
  activeTab = tabs[0] ?? null;
  if (activeTab) activateTab(activeTab, false);
  else { editorElement.hidden = true; previewElement.hidden = true; }
  stageContent.classList.remove("scene-mode");
  required<HTMLElement>("#scene-preview-pane").hidden = true;
  required<HTMLElement>("#scene-conflict").hidden = true;
}

async function loadScene(handle: FileHandle, metadata: FileMetadata, generation: number) {
  if (scene && !await leaveScene("Open another Scene?")) return;
  if (!scene && tabs.some(tabDirty) && !await hiraya.dialogs.confirm({ title: "Open Scene?", message: "Open tabs have unsaved changes. Opening a Scene will close them.", confirmLabel: "Open Scene", destructive: true })) return;
  opening = true;
  setAppLoading(content, workbench, loading, "Opening Scene...");
  renderControlState();
  try {
    const { data } = await hiraya.files.readAll(handle);
    const opened = await SceneArchiveState.open(new Uint8Array(data), metadata.contentRevision);
    if (!operations.isForegroundCurrent(generation)) return;
    openSceneWorkspace(opened.state, handle, metadata, opened.draft.manifest?.entrypoint ?? "hiraya.scene.json");
    setStatus(opened.draft.manifestError ? "Opened an invalid Scene draft. Fix validation errors when ready." : `Opened ${metadata.name}.`);
  } finally {
    if (operations.isForegroundCurrent(generation)) {
      opening = false;
      setAppLoading(content, workbench, loading);
      renderControlState();
    }
  }
}

function openSceneWorkspace(archive: SceneArchiveState, handle: FileHandle | null, metadata: FileMetadata | null, initialPath: string) {
  for (const tab of tabs) { clearTimeout(tab.autoSaveTimer); releasePreview(tab); }
  tabs = [];
  activeTab = null;
  workspace = null;
  selectedHandle = null;
  selectedPath = null;
  children.clear(); entries.clear(); parents.clear(); expanded.clear();
  scene = { archive, handle, metadata };
  workspaceHeading.textContent = metadata?.name ?? "Untitled Scene";
  workspaceHeading.hidden = false;
  stageContent.classList.add("scene-mode");
  required<HTMLElement>("#scene-preview-pane").hidden = false;
  openScenePath(archive.files.has(initialPath) ? initialPath : archive.paths()[0] ?? "");
  renderWorkspace();
  renderControlState();
  scheduleScenePreview();
}

async function newScene() {
  if (!await leaveScene("Create a new Scene?")) return;
  if (tabs.some(tabDirty) && !await hiraya.dialogs.confirm({ title: "Create a new Scene?", message: "Open tabs have unsaved changes. Creating a Scene will close them.", confirmLabel: "Create Scene", destructive: true })) return;
  const opened = await SceneArchiveState.open(starterSceneArchive(), null);
  openSceneWorkspace(opened.state, null, null, "index.html");
  setStatus("Starter Scene ready. Use Save As to store it.");
}

function openScenePath(path: string) {
  if (!scene || !path) return;
  selectedPath = path;
  let tab = tabs.find((candidate) => candidate.scenePath === path);
  if (!tab) {
    const text = scene.archive.readText(path);
    const state = text === null ? null : new TextDocumentState();
    state?.load(text ?? "", scene.archive.revision ?? 0);
    tab = { id: crypto.randomUUID(), handle: null, metadata: null, name: path, kind: text === null ? "metadata" : "text", state, saving: false, autoSaveTimer: 0, ...emptyPreview(), scenePath: path };
    tabs.push(tab);
  }
  activateTab(tab);
  renderWorkspace();
}

async function readText(next: FileHandle, entry?: FileMetadata) {
  entry ??= await statFile(next);
  const { data } = await hiraya.files.readAll(next);
  return { entry, text: new TextDecoder("utf-8", { fatal: true }).decode(data) };
}

function emptyPreview() { return { previewSource: null, previewObjectUrl: null, previewExpiresAt: 0, previewRefreshAttempted: false }; }

async function createPreview(handle: FileHandle, entry: FileMetadata, kind: EditorFileKind) {
  if (kind === "metadata") return emptyPreview();
  if (kind === "image" || kind === "pdf") {
    const { data } = await hiraya.files.readAll(handle);
    const objectUrl = URL.createObjectURL(new Blob([data], { type: entry.mimeType }));
    return { previewSource: objectUrl, previewObjectUrl: objectUrl, previewExpiresAt: 0, previewRefreshAttempted: false };
  }
  const source = await hiraya.host.getFilePreviewSource(handle);
  if (source.kind === "blob") {
    const objectUrl = URL.createObjectURL(source.blob);
    return { previewSource: objectUrl, previewObjectUrl: objectUrl, previewExpiresAt: 0, previewRefreshAttempted: false };
  }
  return { previewSource: source.url, previewObjectUrl: null, previewExpiresAt: source.expiresAt, previewRefreshAttempted: false };
}

function activateTab(tab: DocumentTab, focus = true) {
  activeTab = tab;
  editorElement.hidden = tab.kind !== "text";
  previewElement.hidden = tab.kind === "text";
  if (tab.state) {
    switchingDocument = true;
    editor.setState(EditorState.create({ doc: tab.state.text, extensions: editorExtensions }));
    switchingDocument = false;
    applySettings();
    editor.dispatch({ effects: languageConfig.reconfigure(languageExtension(textEditorLanguageFor(tab.name, tab.metadata?.mimeType))) });
  } else renderPreview(tab);
  renderControlState();
  renderDocumentState();
  if (focus) {
    if (tab.state) editor.focus();
    else previewElement.focus();
  }
}

async function closeTab(tab: DocumentTab, confirm = true) {
  if (confirm && !tab.scenePath && tabDirty(tab) && !await hiraya.dialogs.confirm({ title: `Close ${tab.name}?`, message: "This tab has changes that have not been saved.", confirmLabel: "Close without saving", destructive: true })) return false;
  clearTimeout(tab.autoSaveTimer);
  releasePreview(tab);
  const index = tabs.indexOf(tab);
  tabs.splice(index, 1);
  if (activeTab === tab) {
    activeTab = tabs[Math.min(index, tabs.length - 1)] ?? null;
    if (activeTab) activateTab(activeTab, false);
    else if (scene) {
      editorElement.hidden = true;
      previewElement.hidden = true;
      renderDocumentState();
    } else createUntitled();
  } else renderDocumentState();
  return true;
}

async function save(saveAs: boolean) {
  if (formatting) return;
  if (!saveAs && (scene?.handle && !scene.archive.dirty || activeTab?.handle && !activeTab.state?.dirty)) return;
  if (scene) await saveScene(saveAs);
  else if (activeTab) await saveTab(activeTab, saveAs);
}

async function saveTab(tab: DocumentTab, saveAs: boolean) {
  if (tab.scenePath) { await saveScene(saveAs); return; }
  if (!initialized || !tab.state || tab.saving || opening || !canWrite) return;
  const state = tab.state;
  tab.saving = true;
  saving = true;
  clearTimeout(tab.autoSaveTimer);
  renderControlState();
  try {
    let destination = saveAs ? null : tab.handle;
    const expected = saveAs ? null : state.revision;
    const mimeType = fileMimeTypeForSave(tab.metadata);
    if (!destination) destination = await hiraya.dialogs.saveFile({ suggestedName: tab.name, mimeType });
    if (!destination) return;
    const sourceText = state.text;
    const text = settings.autoFormat ? await formatText(tab.name, tab.metadata?.mimeType ?? "", sourceText) : sourceText;
    if (!canWrite) { setStatus(writeRestrictionMessage(writeReason, state.dirty), state.dirty); return; }
    const bytes = new TextEncoder().encode(text);
    const saved = await hiraya.files.writeAll(destination, bytes.buffer, { mimeType, expectedRevision: expected ?? undefined });
    tab.handle = destination;
    tab.metadata = saved;
    tab.name = saved.name;
    state.saved(sourceText, text, saved.contentRevision);
    if (activeTab === tab) {
      replaceEditorText(state.text);
      editor.dispatch({ effects: languageConfig.reconfigure(languageExtension(textEditorLanguageFor(tab.name, tab.metadata?.mimeType))) });
    }
    renderDocumentState();
    if (state.dirty) scheduleAutoSave(tab);
    setStatus(`Saved ${tab.name}.`);
  } catch (error) {
    const message = error instanceof HirayaSdkError && error.code === "CONFLICT" ? `This file changed elsewhere. ${tab.name}'s unsaved text is preserved.` : describeError(error, `Could not save ${tab.name}.`);
    setStatus(message, true);
  } finally {
    tab.saving = false;
    saving = tabs.some((candidate) => candidate.saving);
    renderControlState();
  }
}

async function saveScene(saveAs: boolean) {
  if (!initialized || !scene || saving || opening || !canWrite) return;
  saving = true;
  renderControlState();
  const current = scene;
  try {
    let destination = saveAs ? null : current.handle;
    if (!destination) destination = await hiraya.dialogs.saveFile({ suggestedName: current.metadata?.name ?? "Untitled.hiraya.scene", mimeType: HIRAYA_SCENE_MIME_TYPE });
    if (!destination) return;
    const pending = current.archive.beginSave();
    const saved = await hiraya.files.writeAll(destination, archiveWritePayload(pending.bytes), { mimeType: HIRAYA_SCENE_MIME_TYPE, ...(destination === current.handle && current.archive.revision !== null ? { expectedRevision: current.archive.revision } : {}) });
    current.archive.saved(pending.files, saved.contentRevision);
    current.handle = destination;
    current.metadata = saved;
    workspaceHeading.textContent = saved.name;
    for (const tab of tabs) if (tab.scenePath && tab.state) tab.state.load(current.archive.readText(tab.scenePath) ?? "", saved.contentRevision);
    renderDocumentState();
    setStatus(`Saved ${saved.name}${(await current.archive.inspectDraft()).manifestError ? " as an editable invalid draft" : ""}.`);
  } catch (error) {
    const message = error instanceof HirayaSdkError && error.code === "CONFLICT" ? "This Scene changed elsewhere. Your unsaved draft is preserved; use Save As to keep both." : describeError(error, "The Scene could not be saved. Your draft is preserved.");
    setStatus(message, true);
  } finally {
    saving = false;
    renderControlState();
  }
}

async function remoteChanged(handles: (FileHandle | FolderHandle)[]) {
  const generation = operations.beginBackground();
  if (generation === null) return;
  if (scene?.handle && handles.includes(scene.handle)) {
    try {
      const metadata = await statFile(scene.handle);
      if (metadata.contentRevision !== scene.archive.revision) {
        const { data } = await hiraya.files.readAll(scene.handle);
        if (await scene.archive.remote(new Uint8Array(data), metadata.contentRevision)) {
          scene.metadata = metadata;
          for (const tab of tabs) if (tab.scenePath && tab.state) tab.state.load(scene.archive.readText(tab.scenePath) ?? "", metadata.contentRevision);
          if (activeTab?.scenePath) activateTab(activeTab, false);
          renderWorkspace();
          scheduleScenePreview();
          setStatus("Reloaded the updated Scene.");
        } else {
          required<HTMLElement>("#scene-conflict").hidden = false;
          setStatus("The Scene changed elsewhere. Your unsaved draft is preserved; use Save As to keep both.", true);
        }
      }
    } catch (error) { setStatus(describeError(error, "Could not reload the Scene."), true); }
  }
  for (const tab of tabs) {
    if (tab.scenePath || !tab.handle || tab.saving || !handles.includes(tab.handle)) continue;
    try {
      if (tab.state) {
        const loaded = await readText(tab.handle);
        if (!operations.isBackgroundCurrent(generation)) return;
        if (!tab.state.remote(loaded.text, loaded.entry.contentRevision)) {
          setStatus(`${tab.name} changed elsewhere. Its unsaved text is preserved.`, true);
          continue;
        }
        tab.metadata = loaded.entry;
        tab.name = loaded.entry.name;
        if (activeTab === tab) replaceEditorText(tab.state.text);
      } else {
        const entry = await statFile(tab.handle);
        const preview = await createPreview(tab.handle, entry, tab.kind);
        if (!operations.isBackgroundCurrent(generation)) { releasePreviewValue(preview.previewObjectUrl); return; }
        releasePreview(tab);
        Object.assign(tab, preview, { metadata: entry, name: entry.name });
        if (activeTab === tab) renderPreview(tab);
      }
    } catch (error) { if (operations.isBackgroundCurrent(generation)) setStatus(describeError(error, `Could not reload ${tab.name}.`), true); }
  }
  renderDocumentState();
  if (workspace && handles.some((handle) => entries.has(handle) || handle === workspace?.handle)) void refreshWorkspace();
}

async function applyFormatting() {
  if (!initialized || opening || saving || formatting || !canWrite || !activeTab?.state) return;
  const tab = activeTab;
  const state = tab.state!;
  const sourceText = state.text;
  formatting = true;
  renderControlState();
  try {
    const formatted = await formatText(tab.name, tab.metadata?.mimeType ?? "", sourceText);
    if (!initialized || activeTab !== tab || state.text !== sourceText) {
      setStatus("Document changed while formatting. Try again.", true);
      return;
    }
    replaceEditorText(formatted);
    setStatus("Document formatted.");
  } catch (error) { setStatus(describeError(error, "Could not format the document."), true); }
  finally { formatting = false; if (initialized) renderControlState(); }
}

function scheduleAutoSave(tab: DocumentTab) {
  clearTimeout(tab.autoSaveTimer);
  if (initialized && canWrite && settings.autoSave && tab.handle && tab.state?.dirty && !tab.state.remoteConflict) tab.autoSaveTimer = setTimeout(() => void saveTab(tab, false), 750) as unknown as number;
}

async function chooseWorkspace() {
  if (!initialized || opening) return;
  if (dirtyDocuments() && !await hiraya.dialogs.confirm({ title: "Change workspace?", message: "Open tabs have unsaved changes. Changing workspace will close them.", confirmLabel: "Change workspace", destructive: true })) return;
  try {
    const selected = await hiraya.dialogs.openFolder();
    if (!selected) return;
    let metadata: FolderMetadata;
    try {
      const entry = await hiraya.files.stat(selected);
      if (entry.kind !== "folder") throw new Error("The selected item is not a folder.");
      metadata = entry.metadata;
    } catch (error) {
      if (!(error instanceof HirayaSdkError) || error.code !== "NOT_FOUND") throw error;
      metadata = { handle: selected, name: "Desktop", modifiedAt: 0, parent: null };
    }
    for (const tab of tabs) { clearTimeout(tab.autoSaveTimer); releasePreview(tab); }
    clearSceneWorkspace();
    tabs = [];
    activeTab = null;
    createUntitled();
    workspace = metadata;
    selectedHandle = null;
    selectedPath = null;
    workspaceGeneration += 1;
    children.clear(); entries.clear(); parents.clear(); expanded.clear();
    expanded.add(workspace.handle);
    workspaceHeading.textContent = workspace.name;
    workspaceHeading.hidden = false;
    await listFolder(workspace.handle);
    renderWorkspace();
    renderControlState();
    setStatus(`Opened workspace ${workspace.name}.`);
    if (matchMedia("(max-width: 700px)").matches) setSidebarOpen(false);
  } catch (error) { setStatus(describeError(error, "Could not open the workspace."), true); }
}

async function listFolder(folder: FolderHandle) {
  const listed = sortWorkspaceEntries(await hiraya.files.list(folder));
  for (const previous of children.get(folder) ?? []) {
    entries.delete(previous.metadata.handle);
    parents.delete(previous.metadata.handle);
  }
  children.set(folder, listed);
  for (const entry of listed) {
    entries.set(entry.metadata.handle, entry);
    parents.set(entry.metadata.handle, entry.metadata.parent);
  }
  return listed;
}

async function refreshWorkspace() {
  if (scene?.handle) {
    try {
      const metadata = await statFile(scene.handle);
      const { data } = await hiraya.files.readAll(scene.handle);
      if (!await scene.archive.remote(new Uint8Array(data), metadata.contentRevision)) { setStatus("The Scene changed elsewhere. Your unsaved draft is preserved; use Save As to keep both.", true); return; }
      scene.metadata = metadata;
      for (const tab of tabs) if (tab.scenePath && tab.state) tab.state.load(scene.archive.readText(tab.scenePath) ?? "", metadata.contentRevision);
      if (activeTab?.scenePath) activateTab(activeTab, false);
      renderWorkspace(); scheduleScenePreview(); setStatus(`Refreshed ${metadata.name}.`);
    } catch (error) { setStatus(describeError(error, "Could not refresh the Scene."), true); }
    return;
  }
  if (!workspace) return;
  try {
    const openFolders = [...expanded];
    children.clear(); entries.clear(); parents.clear();
    for (const folder of openFolders) await listFolder(folder);
    renderWorkspace();
    if (searchInput.value) void searchWorkspace(searchInput.value);
    setStatus(`Refreshed ${workspace.name}.`);
  } catch (error) { setStatus(describeError(error, "Could not refresh the workspace."), true); }
}

function renderWorkspace() {
  fileTree.replaceChildren();
  if (scene) { renderSceneWorkspace(); return; }
  if (!workspace) {
    const empty = document.createElement("p");
    empty.className = "sidebar-empty";
    empty.textContent = "Choose a folder to browse its files.";
    fileTree.append(empty);
    return;
  }
  if (selectedPath !== null) {
    if (!selectedPath) selectedHandle = workspace.handle;
    else selectedHandle = [...entries.values()].find((entry) => workspaceEntryPath(entry) === selectedPath)?.metadata.handle ?? selectedHandle;
  }
  workspaceHeading.setAttribute("aria-pressed", String(selectedHandle === workspace.handle));
  const list = document.createElement("ul");
  list.setAttribute("role", "group");
  appendChildren(list, workspace.handle, 0);
  fileTree.append(list);
}

function renderSceneWorkspace() {
  if (!scene) return;
  workspaceHeading.hidden = false;
  workspaceHeading.setAttribute("aria-pressed", String(selectedPath === ""));
  const list = document.createElement("ul");
  list.setAttribute("role", "group");
  for (const path of scene.archive.paths()) {
    const item = document.createElement("li"); item.setAttribute("role", "none");
    const row = document.createElement("button"); row.type = "button"; row.className = "tree-row"; row.setAttribute("role", "treeitem"); row.dataset.scenePath = path; row.style.setProperty("--tree-depth", "0"); row.setAttribute("aria-selected", String(path === selectedPath));
    row.append(document.createElement("span"), makeIcon(scene.archive.isText(path) ? "code" : "file", "tree-icon"));
    const label = document.createElement("span"); label.textContent = path; row.append(label);
    item.append(row); list.append(item);
  }
  fileTree.append(list);
}

function appendChildren(list: HTMLUListElement, parent: FolderHandle, depth: number) {
  for (const entry of children.get(parent) ?? []) {
    const item = document.createElement("li");
    item.setAttribute("role", "none");
    item.dataset.handle = entry.metadata.handle;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tree-row";
    row.setAttribute("role", "treeitem");
    row.dataset.handle = entry.metadata.handle;
    row.style.setProperty("--tree-depth", String(depth));
    row.setAttribute("aria-selected", String(selectedHandle === entry.metadata.handle));
    if (entry.kind === "folder") row.setAttribute("aria-expanded", String(expanded.has(entry.metadata.handle)));
    if (entry.kind === "folder") row.append(makeIcon("chevron", "tree-chevron"));
    else row.append(document.createElement("span"));
    row.append(makeIcon(entry.kind === "folder" ? "folder-open" : isEditableFile(entry.metadata) ? "code" : "file", "tree-icon"));
    const label = document.createElement("span");
    label.textContent = entry.metadata.name;
    row.append(label);
    item.append(row);
    if (entry.kind === "folder" && expanded.has(entry.metadata.handle)) {
      const nested = document.createElement("ul");
      nested.setAttribute("role", "group");
      appendChildren(nested, entry.metadata.handle, depth + 1);
      item.append(nested);
    }
    list.append(item);
  }
}

async function activateTreeTarget(target: EventTarget | null) {
  const button = target instanceof Element ? target.closest<HTMLButtonElement>(".tree-row") : null;
  if (!button) return;
  if (button.dataset.scenePath) { openScenePath(button.dataset.scenePath); return; }
  const entry = entries.get(button.dataset.handle ?? "");
  if (!entry) return;
  selectedHandle = entry.metadata.handle;
  selectedPath = workspaceEntryPath(entry);
  if (entry.kind === "folder") {
    if (expanded.has(entry.metadata.handle)) expanded.delete(entry.metadata.handle);
    else {
      expanded.add(entry.metadata.handle);
      if (!children.has(entry.metadata.handle)) await listFolder(entry.metadata.handle);
    }
    renderWorkspace();
    focusTreeHandle(entry.metadata.handle);
  } else {
    renderWorkspace();
    focusTreeHandle(entry.metadata.handle);
    await openWorkspaceFile(entry);
  }
  renderControlState();
}

async function openWorkspaceFile(entry: Extract<DirectoryEntry, { kind: "file" }>) {
  const generation = operations.beginForeground();
  try { await load(entry.metadata.handle, generation); }
  catch (error) { setStatus(describeError(error, `Could not open ${entry.metadata.name}.`), true); }
  finally { operations.finishForeground(generation); }
  if (matchMedia("(max-width: 700px)").matches) setSidebarOpen(false);
}

async function searchWorkspace(query: string) {
  const generation = workspaceGeneration;
  searchResults.replaceChildren();
  if ((!workspace && !scene) || !query.trim()) {
    const hint = document.createElement("p"); hint.className = "sidebar-empty"; hint.textContent = workspace || scene ? "Type a file name to search this workspace." : "Open a workspace before searching."; searchResults.append(hint); return;
  }
  if (scene) {
    const matches = scene.archive.paths().filter((path) => path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    if (!matches.length) { const empty = document.createElement("p"); empty.className = "sidebar-empty"; empty.textContent = `No files match “${query}”.`; searchResults.append(empty); return; }
    for (const path of matches) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.itemId = path; button.dataset.itemSelect = ""; button.setAttribute("role", "option"); button.append(makeIcon(scene.archive.isText(path) ? "code" : "file"));
      const text = document.createElement("span"); text.textContent = path; button.append(text); searchResults.append(button);
    }
    return;
  }
  if (!workspace) return;
  const pending = document.createElement("p"); pending.className = "sidebar-empty"; pending.textContent = "Indexing workspace..."; searchResults.append(pending);
  try {
    await indexFolder(workspace.handle, new Set());
    if (generation !== workspaceGeneration || query !== searchInput.value) return;
    const matches = filterWorkspaceEntries(entries.values(), query).filter((entry) => entry.kind === "file");
    searchResults.replaceChildren();
    if (!matches.length) { pending.textContent = `No files match “${query}”.`; searchResults.append(pending); return; }
    for (const entry of matches) {
      const button = document.createElement("button");
      button.type = "button"; button.dataset.itemId = entry.metadata.handle; button.dataset.itemSelect = ""; button.setAttribute("role", "option");
      button.append(makeIcon(isEditableFile((entry as Extract<DirectoryEntry, { kind: "file" }>).metadata) ? "code" : "file"));
      const text = document.createElement("span"); text.textContent = entry.metadata.name;
      const path = document.createElement("small"); path.textContent = workspaceParentPath(entry);
      const copy = document.createElement("span"); copy.className = "search-result-copy"; copy.append(text, path); button.append(copy);
      searchResults.append(button);
    }
  } catch (error) { setStatus(describeError(error, "Could not search the workspace."), true); }
}

async function indexFolder(folder: FolderHandle, seen: Set<FolderHandle>) {
  if (seen.has(folder)) return;
  seen.add(folder);
  const listed = children.get(folder) ?? await listFolder(folder);
  for (const entry of listed) if (entry.kind === "folder") await indexFolder(entry.metadata.handle, seen);
}

async function activateSearchResult(id: string) {
  if (scene?.archive.files.has(id)) { openScenePath(id); return; }
  const entry = entries.get(id);
  if (entry?.kind === "file") await openWorkspaceFile(entry);
}

function workspaceParentPath(entry: DirectoryEntry) {
  const parts: string[] = [];
  let parent = entry.metadata.parent;
  const seen = new Set<string>();
  while (parent && parent !== workspace?.handle && !seen.has(parent)) {
    seen.add(parent);
    const folder = entries.get(parent);
    if (!folder || folder.kind !== "folder") break;
    parts.unshift(folder.metadata.name);
    parent = folder.metadata.parent;
  }
  return parts.length ? parts.join(" / ") : workspace?.name ?? "Workspace";
}

function workspaceEntryPath(entry: DirectoryEntry) {
  const parent = workspaceParentPath(entry);
  return `${parent === workspace?.name ? "" : `${parent}/`}${entry.metadata.name}`;
}

function selectedParent() {
  if (!workspace) return null;
  const selected = selectedHandle ? entries.get(selectedHandle) : null;
  return selected?.kind === "folder" ? selected.metadata.handle : selected?.metadata.parent ?? workspace.handle;
}

async function createEntry(kind: "file" | "folder") {
  if (scene) {
    if (kind === "folder" || !canWrite) return;
    const path = await promptName("New Scene file", "Package path", "script.js", "Create", true);
    if (!path) return;
    try { openScenePath(scene.archive.createText(path)); scheduleScenePreview(); setStatus(`Created ${path}.`); } catch (error) { setStatus(describeError(error, "Could not create the Scene file."), true); }
    return;
  }
  const parent = selectedParent();
  if (!parent || !canWrite) return;
  const name = await promptName(kind === "file" ? "New file" : "New folder", kind === "file" ? "File name" : "Folder name", kind === "file" ? "untitled.txt" : "New folder", "Create");
  if (!name) return;
  try {
    const metadata = kind === "file" ? await hiraya.files.createFile({ parent, name, data: new ArrayBuffer(0), mimeType: "text/plain; charset=utf-8" }) : await hiraya.files.createFolder(parent, name);
    await listFolder(parent);
    const created = children.get(parent)?.find((entry) => entry.kind === kind && entry.metadata.name === metadata.name);
    selectedHandle = created?.metadata.handle ?? metadata.handle;
    selectedPath = created ? workspaceEntryPath(created) : metadata.name;
    renderWorkspace(); renderControlState();
    setStatus(`Created ${name}.`);
  } catch (error) { setStatus(describeError(error, `Could not create ${name}.`), true); }
}

async function renameEntry() {
  if (scene) {
    const path = selectedPath;
    if (!path || !canWrite) return;
    const next = await promptName("Rename Scene file", "Package path", path, "Rename", true);
    if (!next || next === path) return;
    try {
      const renamed = scene.archive.rename(path, next);
      const tab = tabs.find((candidate) => candidate.scenePath === path);
      if (tab) { tab.scenePath = renamed; tab.name = renamed; }
      selectedPath = renamed; renderWorkspace(); renderDocumentState(); scheduleScenePreview(); setStatus(`Renamed to ${renamed}.`);
    } catch (error) { setStatus(describeError(error, `Could not rename ${path}.`), true); }
    return;
  }
  const entry = selectedHandle ? entries.get(selectedHandle) : null;
  if (!entry || !canWrite) return;
  const name = await promptName("Rename item", "Name", entry.metadata.name, "Rename");
  if (!name || name === entry.metadata.name) return;
  try {
    const renamed = await hiraya.files.rename(entry.metadata.handle, name);
    entries.set(renamed.metadata.handle, renamed);
    const tab = tabs.find((candidate) => candidate.handle === renamed.metadata.handle);
    if (tab && renamed.kind === "file") { tab.name = renamed.metadata.name; tab.metadata = renamed.metadata; }
    const parent = entry.metadata.parent ?? workspace?.handle;
    if (parent) {
      const refreshed = (await listFolder(parent)).find((candidate) => candidate.kind === renamed.kind && candidate.metadata.name === renamed.metadata.name);
      if (refreshed) {
        selectedHandle = refreshed.metadata.handle;
        selectedPath = workspaceEntryPath(refreshed);
        if (tab && refreshed.kind === "file") { tab.handle = refreshed.metadata.handle; tab.metadata = refreshed.metadata; }
      }
    }
    renderWorkspace(); renderDocumentState();
    setStatus(`Renamed to ${name}.`);
  } catch (error) { setStatus(describeError(error, `Could not rename ${entry.metadata.name}.`), true); }
}

async function deleteEntry() {
  if (scene) {
    const path = selectedPath;
    if (!path || !canWrite || !await hiraya.dialogs.confirm({ title: `Delete ${path}?`, message: "The file will be removed from this Scene when you save.", confirmLabel: "Delete", destructive: true })) return;
    try {
      scene.archive.delete(path);
      const tab = tabs.find((candidate) => candidate.scenePath === path);
      if (tab) await closeTab(tab, false);
      selectedPath = scene.archive.paths()[0] ?? "";
      if (selectedPath) openScenePath(selectedPath); else renderWorkspace();
      scheduleScenePreview(); setStatus(`Deleted ${path}.`);
    } catch (error) { setStatus(describeError(error, `Could not delete ${path}.`), true); }
    return;
  }
  const entry = selectedHandle ? entries.get(selectedHandle) : null;
  if (!entry || !canWrite) return;
  const affected = tabs.filter((tab) => tab.handle && (tab.handle === entry.metadata.handle || entry.kind === "folder" && isWithinFolder(tab.handle, entry.metadata.handle, parents)));
  const draftWarning = affected.some(tabDirty) ? " Unsaved changes in affected tabs will be lost." : "";
  if (!await hiraya.dialogs.confirm({ title: `Delete ${entry.metadata.name}?`, message: `${entry.kind === "folder" ? "This folder and everything inside it" : "This file"} will move to Trash.${draftWarning}`, confirmLabel: "Delete", destructive: true })) return;
  try {
    await hiraya.files.delete(entry.metadata.handle, entry.kind === "folder");
    for (const tab of affected) await closeTab(tab, false);
    const parent = entry.metadata.parent ?? workspace?.handle ?? null;
    selectedHandle = null;
    selectedPath = null;
    if (parent) await listFolder(parent);
    renderWorkspace(); renderControlState();
    setStatus(`Deleted ${entry.metadata.name}.`);
  } catch (error) { setStatus(describeError(error, `Could not delete ${entry.metadata.name}.`), true); }
}

async function importSceneAssets() {
  if (!scene || !canWrite) return;
  const selected = await hiraya.dialogs.openFile({ multiple: true });
  let imported = 0;
  for (const handle of selected ?? []) {
    try {
      const metadata = await statFile(handle);
      const { data } = await hiraya.files.readAll(handle);
      scene.archive.import(metadata.name, new Uint8Array(data));
      imported += 1;
    } catch (error) { setStatus(describeError(error, "Could not import a Scene asset."), true); }
  }
  renderWorkspace(); renderDocumentState(); scheduleScenePreview();
  if (imported) setStatus(`Imported ${imported} ${imported === 1 ? "asset" : "assets"}.`);
}

function promptName(titleText: string, labelText: string, initial: string, submitText: string, allowPath = false) {
  const dialog = required<HTMLDialogElement>("#entry-dialog");
  const form = required<HTMLFormElement>("#entry-dialog form");
  const input = required<HTMLInputElement>("#entry-name");
  const error = required<HTMLElement>("#entry-dialog-error");
  required("#entry-dialog-title").textContent = titleText;
  required("#entry-dialog-label").textContent = labelText;
  required("#entry-submit").textContent = submitText;
  input.value = initial;
  error.hidden = true;
  return new Promise<string | null>((resolve) => {
    const submit = (event: SubmitEvent) => {
      event.preventDefault();
      if ((event.submitter as HTMLButtonElement | null)?.value === "cancel") { dialog.close("cancel"); return; }
      const value = input.value.trim();
      if (!value || value === "." || value === ".." || !allowPath && /[\\/]/.test(value)) { error.textContent = allowPath ? "Enter a valid package path." : "Enter a name without slashes."; error.hidden = false; return; }
      dialog.close("confirm");
    };
    const close = () => { form.removeEventListener("submit", submit); resolve(dialog.returnValue === "confirm" ? input.value.trim() : null); };
    form.addEventListener("submit", submit);
    dialog.addEventListener("close", close, { once: true });
    dialog.showModal(); input.select();
  });
}

function renderDocumentState() {
  renderTabs(); renderBreadcrumbs();
  const dirty = dirtyDocuments();
  const title = scene?.metadata?.name ?? (scene ? "Untitled Scene" : activeTab?.name);
  const titleDirty = scene?.archive.dirty ?? (activeTab ? tabDirty(activeTab) : false);
  publishWindowTitle(title ? `${titleDirty ? "*" : ""}${title} - Integrated Editor` : "Integrated Editor");
  required<HTMLElement>("#scene-conflict").hidden = !scene?.archive.conflict;
  if (dirty !== windowDirty) { windowDirty = dirty; void hiraya?.window.setDirty(dirty); }
  renderControlState();
}

function publishWindowTitle(title: string) {
  if (title === windowTitle) return;
  windowTitle = title;
  void hiraya?.window.setTitle(title);
}

function renderTabs() {
  tabsElement.replaceChildren();
  for (const tab of tabs) {
    const wrapper = document.createElement("div"); wrapper.className = "editor-tab"; wrapper.setAttribute("role", "presentation");
    const button = document.createElement("button"); button.type = "button"; button.setAttribute("aria-pressed", String(tab === activeTab)); button.title = tab.name;
    button.append(makeIcon(isEditableFile(tab.metadata ?? { handle: "" as FileHandle, name: tab.name, mimeType: "text/plain", size: 0, modifiedAt: 0, parent: null, contentRevision: 0 }) ? "code" : "file"));
    const label = document.createElement("span"); label.textContent = `${tabDirty(tab) ? "● " : ""}${tab.name}`; button.append(label);
    button.addEventListener("click", () => activateTab(tab));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      if (next) { activateTab(next, false); tabsElement.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus(); }
    });
    const close = document.createElement("button"); close.type = "button"; close.className = "tab-close"; close.setAttribute("aria-label", `Close ${tab.name}`); close.title = `Close ${tab.name}`; close.append(makeIcon("x")); close.addEventListener("click", () => void closeTab(tab));
    wrapper.append(button, close); tabsElement.append(wrapper);
  }
}

function renderBreadcrumbs() {
  breadcrumbs.replaceChildren();
  if (!activeTab || scene) { breadcrumbs.hidden = true; return; }
  const path: { name: string; handle: FolderHandle }[] = [];
  let parent = activeTab.metadata?.parent ?? null;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    if (workspace?.handle === parent) { path.unshift({ name: workspace.name, handle: parent }); break; }
    const entry = entries.get(parent);
    if (!entry || entry.kind !== "folder") break;
    path.unshift({ name: entry.metadata.name, handle: entry.metadata.handle });
    parent = entry.metadata.parent;
  }
  breadcrumbs.hidden = path.length === 0;
  for (const [index, part] of path.entries()) {
    if (index) { const separator = document.createElement("span"); separator.textContent = "/"; separator.ariaHidden = "true"; breadcrumbs.append(separator); }
    const button = document.createElement("button"); button.type = "button"; button.textContent = part.name; button.addEventListener("click", () => {
      selectedHandle = part.handle;
      const entry = entries.get(part.handle);
      selectedPath = part.handle === workspace?.handle ? "" : entry ? workspaceEntryPath(entry) : selectedPath;
      expanded.add(part.handle);
      showSidebar("explorer");
      renderWorkspace();
    }); breadcrumbs.append(button);
  }
}

function showSidebar(mode: "explorer" | "search" | "settings") {
  required("#sidebar-title").textContent = mode === "explorer" ? "Explorer" : mode === "search" ? "Search" : "Settings";
  required<HTMLElement>("#explorer-panel").hidden = mode !== "explorer";
  required<HTMLElement>("#search-panel").hidden = mode !== "search";
  required<HTMLElement>("#settings-panel").hidden = mode !== "settings";
  required<HTMLElement>("#explorer-actions").hidden = mode !== "explorer";
  required("#explorer-view").setAttribute("aria-pressed", String(mode === "explorer"));
  required("#search-view").setAttribute("aria-pressed", String(mode === "search"));
  required("#settings-view").setAttribute("aria-pressed", String(mode === "settings"));
  setSidebarOpen(true);
  if (mode === "search") { searchInput.focus(); void searchWorkspace(searchInput.value); }
}

function toggleSidebar(mode: "explorer" | "search" | "settings") {
  const active = required(`#${mode}-view`).getAttribute("aria-pressed") === "true";
  if (active) setSidebarOpen(!sidebarOpen);
  else showSidebar(mode);
}

function setSidebarOpen(open: boolean) {
  sidebarOpen = open;
  workbench.classList.toggle("sidebar-closed", !open);
  sidebar.classList.toggle("open", open);
  const mobile = matchMedia("(max-width: 700px)").matches;
  required<HTMLElement>("#sidebar-backdrop").hidden = !mobile || !open;
  for (const mode of ["explorer", "search", "settings"]) {
    const view = required(`#${mode}-view`);
    view.setAttribute("aria-expanded", String(open && view.getAttribute("aria-pressed") === "true"));
  }
}

function handleShortcut(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); if (initialized && canWrite) void save(event.shiftKey); return; }
  if (mod && event.key.toLowerCase() === "o") { event.preventDefault(); void open(); return; }
  if (mod && event.key.toLowerCase() === "b") { event.preventDefault(); setSidebarOpen(!sidebarOpen); return; }
  if (mod && event.key.toLowerCase() === "p") { event.preventDefault(); showSidebar("search"); return; }
  if (mod && event.shiftKey && event.key.toLowerCase() === "e") { event.preventDefault(); showSidebar("explorer"); return; }
  if (event.key === "Escape" && matchMedia("(max-width: 700px)").matches && sidebarOpen) { event.preventDefault(); setSidebarOpen(false); return; }
  if (event.key === "F2" && document.activeElement?.closest("#file-tree")) { event.preventDefault(); void renameEntry(); }
  if (event.key === "Delete" && document.activeElement?.closest("#file-tree")) { event.preventDefault(); void deleteEntry(); }
}

async function handleTreeKey(event: KeyboardEvent) {
  const row = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".tree-row") : null;
  if (!row) return;
  const visible = Array.from(fileTree.querySelectorAll<HTMLButtonElement>(".tree-row"));
  const index = visible.indexOf(row);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    selectTreeRow(visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]);
    return;
  }
  if (row.dataset.scenePath) {
    if (event.key === "Enter") { event.preventDefault(); openScenePath(row.dataset.scenePath); }
    return;
  }
  const entry = entries.get(row.dataset.handle ?? "");
  if (!entry) return;
  if (event.key === "Enter") { event.preventDefault(); await activateTreeTarget(row); }
  else if (event.key === "ArrowRight" && entry.kind === "folder") {
    event.preventDefault();
    if (!expanded.has(entry.metadata.handle)) await activateTreeTarget(row);
    else selectTreeRow(visible[index + 1]);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (entry.kind === "folder" && expanded.has(entry.metadata.handle)) await activateTreeTarget(row);
    else {
      const parent = entry.metadata.parent;
      if (!parent || parent === workspace?.handle) { selectedHandle = workspace?.handle ?? null; selectedPath = ""; renderWorkspace(); workspaceHeading.focus(); renderControlState(); }
      else selectTreeRow(fileTree.querySelector<HTMLButtonElement>(`.tree-row[data-handle="${CSS.escape(parent)}"]`));
    }
  }
}

function selectTreeRow(row?: HTMLButtonElement | null) {
  if (!row) return;
  if (row.dataset.scenePath) {
    selectedHandle = null;
    selectedPath = row.dataset.scenePath;
  } else {
    selectedHandle = row.dataset.handle ?? null;
    const entry = selectedHandle ? entries.get(selectedHandle) : null;
    selectedPath = entry ? workspaceEntryPath(entry) : selectedPath;
  }
  for (const candidate of Array.from(fileTree.querySelectorAll<HTMLButtonElement>(".tree-row"))) candidate.setAttribute("aria-selected", String(candidate === row));
  workspaceHeading.setAttribute("aria-pressed", "false");
  row.focus();
  renderControlState();
}

function focusTreeHandle(handle: string) {
  selectTreeRow(fileTree.querySelector<HTMLButtonElement>(`.tree-row[data-handle="${CSS.escape(handle)}"]`));
}

async function changeSettings(next: TextEditorSettings) {
  if (!initialized) return;
  settings = parseTextEditorSettings(next);
  applySettings();
  await hiraya.storage.set(SETTINGS_KEY, settings);
  for (const tab of tabs) scheduleAutoSave(tab);
  setStatus("Editor settings saved for this browser and account.");
}

function applySettings() {
  editor.dispatch({ effects: [fontConfig.reconfigure(EditorView.theme({ "&": { fontSize: `${settings.fontSize}px` } })), lineWrapConfig.reconfigure(settings.lineWrap ? EditorView.lineWrapping : [])] });
  required<HTMLSelectElement>("#font-size").value = String(settings.fontSize);
  required<HTMLInputElement>("#line-wrap").checked = settings.lineWrap;
  required<HTMLInputElement>("#auto-save").checked = settings.autoSave;
  required<HTMLInputElement>("#auto-format").checked = settings.autoFormat;
}

function applyCapabilities(capabilities: Awaited<ReturnType<HirayaClient["app"]["getCapabilities"]>>) {
  const restored = !canWrite && capabilities.files.write;
  canWrite = capabilities.files.write;
  writeReason = capabilities.files.writeReason;
  if (!canWrite) for (const tab of tabs) clearTimeout(tab.autoSaveTimer);
  else for (const tab of tabs) scheduleAutoSave(tab);
  renderControlState();
  if (initialized && (!canWrite || restored)) setStatus(writeRestrictionMessage(writeReason, tabs.some(tabDirty)), !canWrite && tabs.some(tabDirty));
}

function renderControlState() {
  const controls = textEditorControlState(initialized, saving || formatting || opening, canWrite);
  required<HTMLButtonElement>("#explorer-view").disabled = !controls.open;
  required<HTMLButtonElement>("#open-workspace").disabled = !controls.open;
  for (const id of ["font-size", "line-wrap"]) required<HTMLInputElement | HTMLSelectElement>(`#${id}`).disabled = !controls.settings;
  const writableTab = controls.write && Boolean(activeTab?.state);
  editor.dispatch({ effects: editableConfig.reconfigure([EditorState.readOnly.of(!writableTab), EditorView.editable.of(writableTab)]) });
  for (const id of ["auto-save", "auto-format"]) required<HTMLInputElement>(`#${id}`).disabled = !controls.write;
  required<HTMLButtonElement>("#new-file").disabled = !controls.write || (!workspace && !scene);
  required<HTMLButtonElement>("#new-folder").disabled = !controls.write || !workspace || Boolean(scene);
  required<HTMLButtonElement>("#import-assets").hidden = !scene;
  required<HTMLButtonElement>("#import-assets").disabled = !controls.write || !scene;
  for (const id of ["rename-entry", "delete-entry"]) required<HTMLButtonElement>(`#${id}`).disabled = !controls.write || (scene ? !selectedPath : !selectedHandle || !entries.has(selectedHandle));
  required<HTMLButtonElement>("#refresh-tree").disabled = scene ? !scene.handle || opening : !workspace || opening;
  required<HTMLElement>("#write-state").hidden = !initialized || canWrite;
  publishCommands();
}

function publishCommands() {
  const savable = Boolean(activeTab?.state || scene);
  const documentCommands = canWrite && savable ? [
    ...(activeTab?.state ? [{ id: "format", title: "Format", enabled: initialized && !saving && !formatting && !opening, promoted: true }] : []),
    { id: "save-as", title: "Save As", shortcut: "Ctrl+Shift+S", enabled: initialized && !saving && !formatting && !opening, promoted: true },
    { id: "save", title: "Save", shortcut: "Ctrl+S", enabled: initialized && !saving && !formatting && !opening && (scene ? !scene.handle || scene.archive.dirty : !activeTab?.handle || Boolean(activeTab?.state?.dirty)), promoted: true },
  ] : [];
  const commands = [
    { id: "open", title: "Open", shortcut: "Ctrl+O", enabled: initialized && !saving && !opening, promoted: true },
    { id: "new-scene", title: "New Scene", enabled: initialized && !saving && !opening },
    ...documentCommands,
    { id: "workspace", title: "Open workspace", enabled: initialized && !opening },
    { id: "search", title: "Search workspace files", shortcut: "Ctrl+P", enabled: initialized && Boolean(workspace || scene) },
  ];
  const signature = JSON.stringify(commands);
  if (signature === commandSignature) return;
  commandSignature = signature;
  void hiraya?.commands.set(commands);
}

function renderPreview(tab: DocumentTab) {
  previewElement.replaceChildren();
  const source = tab.previewSource;
  let element: HTMLElement;
  if (tab.scenePath && scene) {
    const bytes = scene.archive.files.get(tab.scenePath);
    const details = document.createElement("section"); details.className = "file-metadata";
    const heading = document.createElement("h2"); heading.textContent = "Packaged asset";
    const list = document.createElement("dl");
    for (const [label, value] of [["Path", tab.scenePath], ["Size", formatBytes(bytes?.byteLength ?? 0)]]) { const term = document.createElement("dt"); term.textContent = label; const description = document.createElement("dd"); description.textContent = value; list.append(term, description); }
    details.append(heading, list); element = details;
  } else if (tab.kind === "image" && source) {
    const image = document.createElement("img");
    image.src = source;
    image.alt = `Preview of ${tab.name}`;
    image.addEventListener("error", () => setStatus("The browser could not display this image.", true));
    element = image;
  } else if (tab.kind === "pdf" && source) {
    const frame = document.createElement("iframe");
    frame.src = source;
    frame.title = `PDF preview of ${tab.name}`;
    frame.setAttribute("sandbox", "");
    frame.referrerPolicy = "no-referrer";
    element = frame;
  } else if ((tab.kind === "audio" || tab.kind === "video") && source) {
    const media = document.createElement(tab.kind) as HTMLMediaElement;
    media.controls = true;
    media.preload = "metadata";
    media.src = source;
    if (media instanceof HTMLVideoElement) media.playsInline = true;
    media.addEventListener("canplay", () => { tab.previewRefreshAttempted = false; });
    media.addEventListener("error", () => void refreshMediaPreview(tab, media));
    element = media;
  } else {
    const details = document.createElement("section");
    details.className = "file-metadata";
    const heading = document.createElement("h2"); heading.textContent = "Read-only file information";
    const list = document.createElement("dl");
    for (const [label, value] of [["Type", tab.metadata?.mimeType ?? "Unknown"], ["Size", formatBytes(tab.metadata?.size ?? 0)], ["Modified", tab.metadata ? new Date(tab.metadata.modifiedAt).toLocaleString() : "Unknown"]]) {
      const term = document.createElement("dt"); term.textContent = label;
      const description = document.createElement("dd"); description.textContent = value;
      list.append(term, description);
    }
    details.append(heading, list);
    element = details;
  }
  previewElement.append(element);
}

async function refreshMediaPreview(tab: DocumentTab, media: HTMLMediaElement) {
  if (!tab.handle || activeTab !== tab || tab.previewRefreshAttempted || !tab.previewExpiresAt) {
    setStatus("The browser could not play this media.", true);
    return;
  }
  tab.previewRefreshAttempted = true;
  try {
    const source = await hiraya.host.getFilePreviewSource(tab.handle);
    const objectUrl = source.kind === "blob" ? URL.createObjectURL(source.blob) : null;
    releasePreviewValue(tab.previewObjectUrl);
    tab.previewObjectUrl = objectUrl;
    tab.previewSource = source.kind === "blob" ? objectUrl : source.url;
    tab.previewExpiresAt = source.kind === "url" ? source.expiresAt : 0;
    media.src = tab.previewSource!;
    media.load();
  } catch (error) { setStatus(describeError(error, "The media preview could not be refreshed."), true); }
}

function scheduleScenePreview() {
  clearTimeout(scenePreviewTimer);
  scenePreviewTimer = window.setTimeout(() => void updateScenePreview(), 180);
}

async function updateScenePreview() {
  stopScenePreview?.(); stopScenePreview = null;
  scenePreviewResource?.revoke(); scenePreviewResource = null;
  scenePreview.replaceChildren(); sceneValidation.classList.remove("error");
  if (!scene) return;
  try {
    const inspection = await inspectSceneArchive(scene.archive.pack());
    const app = { ...inspection, manifest: { schemaVersion: 2, uiRuntime: 1, id: "app.hiraya.scene-preview", name: "Scene preview", version: "0.0.0", entrypoint: inspection.manifest.entrypoint, permissions: [] } } as AppPackageInspection;
    const csp = `${SANDBOX_CSP.replace("frame-src data: blob:;", "frame-src 'none';")}; worker-src 'none'`;
    scenePreviewResource = materializeAppPackage(app, { abi: 1, script: "", styles: "html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}" }, URL, csp);
    const frame = document.createElement("iframe"); frame.title = "Unsaved Scene preview"; frame.sandbox.add("allow-scripts"); frame.setAttribute("csp", csp); frame.tabIndex = 0;
    stopScenePreview = terminateSandboxNavigation(frame, scenePreviewResource.navigationToken, { onNavigation: () => { stopScenePreview?.(); stopScenePreview = null; scenePreviewResource?.revoke(); sceneValidation.textContent = "Preview navigation was blocked."; sceneValidation.classList.add("error"); } });
    frame.srcdoc = scenePreviewResource.html;
    scenePreview.append(frame);
    sceneValidation.textContent = "Draft is valid. Previewing unsaved in-memory files.";
    required("#scene-preview-state").textContent = "Live";
  } catch (error) {
    sceneValidation.textContent = error instanceof Error ? error.message : "Strict Scene validation failed.";
    sceneValidation.classList.add("error");
    const empty = document.createElement("div"); empty.className = "scene-preview-empty";
    const heading = document.createElement("strong"); heading.textContent = "Preview unavailable";
    const copy = document.createElement("span"); copy.textContent = "Fix the validation error. You can still save this draft.";
    empty.append(heading, copy); scenePreview.append(empty);
    required("#scene-preview-state").textContent = "Invalid draft";
  }
}

function tabDirty(tab: DocumentTab) { return tab.scenePath && scene ? scene.archive.pathDirty(tab.scenePath) : tab.state?.dirty ?? false; }
function dirtyDocuments() { return scene?.archive.dirty ?? tabs.some(tabDirty); }

function releasePreview(tab: DocumentTab) {
  releasePreviewValue(tab.previewObjectUrl);
  Object.assign(tab, emptyPreview());
}

function releasePreviewValue(objectUrl: string | null) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

function languageExtension(language: TextEditorLanguage): Extension {
  switch (language) {
    case "markdown": return markdown(); case "json": return json(); case "javascript": return javascript(); case "typescript": return javascript({ typescript: true }); case "jsx": return javascript({ jsx: true }); case "tsx": return javascript({ jsx: true, typescript: true }); case "css": return css(); case "html": return html(); case "xml": return xml(); case "yaml": return yaml(); default: return [];
  }
}

function makeIcon(name: string, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (className) svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", `#icon-${name}`); svg.append(use); return svg;
}

function editorText() { return editor.state.doc.toString(); }
function replaceEditorText(text: string) {
  if (editorText() === text) return;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
}
function setStatus(message: string, error = false) { status.textContent = message; status.closest("hiraya-status-bar")?.classList.toggle("error", error); }

renderWorkspace();
setSidebarOpen(!matchMedia("(max-width: 700px)").matches);

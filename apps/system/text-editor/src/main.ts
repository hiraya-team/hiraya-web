import { HirayaSdkError, type FileHandle, type FileMetadata, type HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, required, setAppLoading } from "@hiraya/system-apps-shared";
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
import "./style.css";

type HirayaButton = HTMLElement & { disabled: boolean };

const APP_ID = "app.hiraya.text-editor";
const SETTINGS_KEY = "editor-settings";
const status = required<HTMLElement>("#status");
const title = required<HTMLElement>("#title");
const content = required<HTMLElement>("#content");
const editorElement = required<HTMLElement>("#editor");
const loading = required<HTMLElement>("#loading");
const documentState = new TextDocumentState();
const operations = new TextDocumentOperations();
const languageConfig = new Compartment();
const fontConfig = new Compartment();
const lineWrapConfig = new Compartment();
const editableConfig = new Compartment();
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
    if (!update.docChanged) return;
    documentState.edit(update.state.doc.toString());
    renderDirty();
    scheduleAutoSave();
  }),
];
const editor = new EditorView({
  parent: editorElement,
  extensions: editorExtensions,
});
let hiraya: HirayaClient;
let handle: FileHandle | null = null;
let name = "Untitled.txt";
let settings = parseTextEditorSettings(undefined);
let autoSaveTimer = 0;
let saving = false;
let opening = false;
let initialized = false;
let canWrite = false;
let writeReason: "available" | "read-only" | "shared-offline" | "temporarily-unavailable" = "temporarily-unavailable";

required("#open").addEventListener("click", () => void open());
required("#save").addEventListener("click", () => void save(false));
required("#save-as").addEventListener("click", () => void save(true));
required("#format").addEventListener("click", () => applyFormatting());
required<HTMLSelectElement>("#font-size").addEventListener("change", (event) => void changeSettings({ ...settings, fontSize: Number((event.target as HTMLSelectElement).value) }));
for (const [id, key] of [["line-wrap", "lineWrap"], ["auto-save", "autoSave"], ["auto-format", "autoFormat"]] as const) {
  required<HTMLInputElement>(`#${id}`).addEventListener("change", (event) => void changeSettings({ ...settings, [key]: (event.target as HTMLInputElement).checked }));
}
addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (initialized && !opening && canWrite) void save(event.shiftKey); }
});
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    app.onDispose(() => { initialized = false; operations.invalidate(); clearTimeout(autoSaveTimer); editor.destroy(); });
    let copiedSettings: unknown;
    try { copiedSettings = app.launch.arguments[0] ? JSON.parse(app.launch.arguments[0]) : undefined; } catch { copiedSettings = undefined; }
    const stored = await hiraya.storage.get(SETTINGS_KEY);
    settings = parseTextEditorSettings(stored, parseTextEditorSettings(copiedSettings));
    if (stored === undefined) await hiraya.storage.set(SETTINGS_KEY, settings);
    applySettings();
    applyCapabilities(await hiraya.app.getCapabilities());
    hiraya.on("capabilities.changed", applyCapabilities);
    hiraya.on("commands.invoked", ({ id }) => id === "save" ? initialized && !saving && !opening && canWrite && void save(false) : id === "open" ? initialized && !saving && !opening && void open() : id === "format" ? initialized && !saving && !opening && canWrite && applyFormatting() : undefined);
    hiraya.on("files.changed", ({ handles }) => { if (handle && handles.includes(handle)) void remoteChanged(); });
    const launchFile = app.launch.files[0];
    if (launchFile) {
      const generation = operations.beginForeground();
      try { await load(launchFile, generation, true); }
      catch (error) { setStatus(describeError(error, "Could not open the launch file."), true); }
      finally { operations.finishForeground(generation); }
    } else setAppLoading(content, editorElement, loading);
    initialized = true;
    renderControlState();
    publishCommands();
    if (!launchFile) setStatus(canWrite ? "Ready. Settings are stored for this browser and account." : writeRestrictionMessage(writeReason, false));
  } catch (error) { opening = false; setAppLoading(content, editorElement, loading); renderControlState(); setStatus(describeError(error, "Text Editor could not start."), true); }
}

async function confirmDiscard() {
  return !documentState.dirty || await hiraya.dialogs.confirm({ title: "Discard unsaved changes?", message: "The current document has changes that have not been saved.", confirmLabel: "Discard", destructive: true });
}

async function open() {
  if (!initialized || saving || opening) return;
  const generation = operations.beginForeground();
  try {
    if (!await confirmDiscard()) return;
    if (!operations.isForegroundCurrent(generation)) return;
    const selected = await hiraya.dialogs.openFile({ multiple: false });
    if (selected?.[0] && operations.isForegroundCurrent(generation)) await load(selected[0], generation);
  } catch (error) { if (operations.isForegroundCurrent(generation)) setStatus(describeError(error, "Could not open the file."), true); }
  finally { operations.finishForeground(generation); }
}

async function statFile(next: FileHandle) {
  const entry = await hiraya.files.stat(next);
  if (entry.kind !== "file") throw new Error("The selected item is not a file.");
  return entry.metadata;
}

async function read(next: FileHandle, entry?: FileMetadata) {
  entry ??= await statFile(next);
  const { data } = await hiraya.files.readAll(next);
  return { entry, text: new TextDecoder("utf-8", { fatal: true }).decode(data) };
}

async function load(next: FileHandle, generation: number, identifyBeforeRead = false) {
  opening = true;
  clearTimeout(autoSaveTimer);
  setAppLoading(content, editorElement, loading, "Opening file...");
  renderControlState();
  try {
    const entry = await statFile(next);
    if (!operations.isForegroundCurrent(generation)) return;
    setAppLoading(content, editorElement, loading, `Opening ${entry.name}...`);
    if (identifyBeforeRead) {
      setName(entry.name);
      renderDirty();
    }
    const loaded = await read(next, entry); if (!operations.isForegroundCurrent(generation)) return;
    documentState.load(loaded.text, loaded.entry.contentRevision);
    resetEditorText(loaded.text);
    handle = next;
    setName(loaded.entry.name);
    renderDirty();
    setStatus(canWrite ? `Opened ${name}.` : writeRestrictionMessage(writeReason, false));
  } finally {
    if (operations.isForegroundCurrent(generation)) {
      opening = false;
      setAppLoading(content, editorElement, loading);
      renderControlState();
      scheduleAutoSave();
    }
  }
}

async function remoteChanged() {
  if (!handle || saving) return;
  const generation = operations.beginBackground();
  if (generation === null) return;
  try {
    const loaded = await read(handle);
    if (!operations.isBackgroundCurrent(generation)) return;
    if (!documentState.remote(loaded.text, loaded.entry.contentRevision)) {
      setStatus("This file changed elsewhere. Your unsaved text is preserved; use Save as or review before replacing the remote version.", true);
      return;
    }
    replaceEditorText(documentState.text);
    setName(loaded.entry.name);
    renderDirty();
    setStatus(`Reloaded ${name} after an external change.`);
  } catch (error) { if (operations.isBackgroundCurrent(generation)) setStatus(describeError(error, "Could not reload the changed file."), true); }
}

async function save(saveAs: boolean) {
  if (!initialized || saving || opening || !canWrite) return;
  saving = true;
  renderControlState();
  publishCommands();
  clearTimeout(autoSaveTimer);
  try {
    let destination = saveAs ? null : handle;
    let expected = saveAs ? null : documentState.revision;
    if (!destination) {
      destination = await hiraya.dialogs.saveFile({ suggestedName: name, mimeType: "text/plain" });
      if (!destination) return;
      const entry = await hiraya.files.stat(destination);
      if (entry.kind !== "file") throw new Error("The save destination is not a file.");
      expected = entry.metadata.contentRevision;
    }
    const sourceText = editorText();
    const text = settings.autoFormat ? formatText(name, sourceText) : sourceText;
    const bytes = new TextEncoder().encode(text);
    if (!canWrite) { setStatus(writeRestrictionMessage(writeReason, documentState.dirty), documentState.dirty); return; }
    const saved = await hiraya.files.writeAll(destination, bytes.buffer, { mimeType: "text/plain; charset=utf-8", expectedRevision: expected ?? undefined });
    handle = destination;
    setName(saved.name);
    documentState.saved(sourceText, text, saved.contentRevision);
    replaceEditorText(documentState.text);
    renderDirty();
    if (documentState.dirty) scheduleAutoSave();
    setStatus(`Saved ${name}.`);
  } catch (error) {
    const message = error instanceof HirayaSdkError && error.code === "CONFLICT" ? "This file changed elsewhere. Your text is preserved; use Save as or review before replacing the remote version." : describeError(error, "Could not save the file.");
    setStatus(message, true);
  } finally { saving = false; renderControlState(); publishCommands(); }
}

function applyFormatting() {
  if (!initialized || opening || !canWrite) return;
  try {
    replaceEditorText(formatText(name, editorText()));
    setStatus("Document formatted.");
  } catch (error) { setStatus(describeError(error, "Could not format the document."), true); }
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  if (initialized && canWrite && settings.autoSave && handle && documentState.dirty && !documentState.remoteConflict) autoSaveTimer = setTimeout(() => void save(false), 750) as unknown as number;
}

async function changeSettings(next: TextEditorSettings) {
  if (!initialized) return;
  if (settings.autoSave && !next.autoSave && autoSaveTimer) await save(false);
  settings = parseTextEditorSettings(next);
  applySettings();
  await hiraya.storage.set(SETTINGS_KEY, settings);
  scheduleAutoSave();
  setStatus("Editor settings saved for this browser and account.");
}

function applySettings() {
  editor.dispatch({ effects: [
    fontConfig.reconfigure(EditorView.theme({ "&": { fontSize: `${settings.fontSize}px` } })),
    lineWrapConfig.reconfigure(settings.lineWrap ? EditorView.lineWrapping : []),
  ] });
  required<HTMLSelectElement>("#font-size").value = String(settings.fontSize);
  required<HTMLInputElement>("#line-wrap").checked = settings.lineWrap;
  required<HTMLInputElement>("#auto-save").checked = settings.autoSave;
  required<HTMLInputElement>("#auto-format").checked = settings.autoFormat;
}

function renderDirty() {
  const dirty = documentState.dirty;
  title.textContent = `${dirty ? "*" : ""}${name}`;
  void hiraya?.window.setDirty(dirty);
  void hiraya?.window.setTitle(`${dirty ? "*" : ""}${name} - Text Editor`);
}
function applyCapabilities(capabilities: Awaited<ReturnType<HirayaClient["app"]["getCapabilities"]>>) {
  const restored = !canWrite && capabilities.files.write;
  canWrite = capabilities.files.write;
  writeReason = capabilities.files.writeReason;
  renderControlState();
  if (!canWrite) clearTimeout(autoSaveTimer);
  else scheduleAutoSave();
  publishCommands();
  if (initialized && (!canWrite || restored)) setStatus(writeRestrictionMessage(writeReason, documentState.dirty), !canWrite && documentState.dirty);
}
function renderControlState() {
  const controls = textEditorControlState(initialized, saving || opening, canWrite);
  required<HirayaButton>("#open").disabled = !controls.open;
  required<HTMLSelectElement>("#font-size").disabled = !controls.settings;
  required<HTMLInputElement>("#line-wrap").disabled = !controls.settings;
  editor.dispatch({ effects: editableConfig.reconfigure([
    EditorState.readOnly.of(!controls.write),
    EditorView.editable.of(controls.write),
  ]) });
  for (const id of ["save", "save-as", "format"]) required<HirayaButton>(`#${id}`).disabled = !controls.write;
  for (const id of ["auto-save", "auto-format"]) required<HTMLInputElement>(`#${id}`).disabled = !controls.write;
  required<HTMLElement>("#write-state").hidden = !initialized || canWrite;
}
function publishCommands() {
  void hiraya.commands.set([{ id: "open", title: "Open", shortcut: "Ctrl+O", enabled: initialized && !saving && !opening }, { id: "save", title: "Save", shortcut: "Ctrl+S", enabled: initialized && !saving && !opening && canWrite }, { id: "format", title: "Format document", enabled: initialized && !saving && !opening && canWrite }]);
}
function setStatus(message: string, error = false) { status.textContent = message; status.classList.toggle("error", error); }

function languageExtension(language: TextEditorLanguage): Extension {
  switch (language) {
    case "markdown": return markdown();
    case "json": return json();
    case "javascript": return javascript();
    case "typescript": return javascript({ typescript: true });
    case "jsx": return javascript({ jsx: true });
    case "tsx": return javascript({ jsx: true, typescript: true });
    case "css": return css();
    case "html": return html();
    case "xml": return xml();
    case "yaml": return yaml();
    default: return [];
  }
}

function editorText() { return editor.state.doc.toString(); }
function resetEditorText(text: string) {
  editor.setState(EditorState.create({ doc: text, extensions: editorExtensions }));
  applySettings();
  renderControlState();
}
function replaceEditorText(text: string) {
  if (editorText() !== text) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
}
function setName(next: string) {
  name = next;
  editor.dispatch({ effects: languageConfig.reconfigure(languageExtension(textEditorLanguageFor(name))) });
}

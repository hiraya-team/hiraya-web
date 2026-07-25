import { HirayaSdkError, type FileHandle, type HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, readFileData, required, writeFileData } from "@hiraya/system-apps-shared";
import { formatText, parseTextEditorSettings, TextDocumentState, type TextEditorSettings } from "./editor";
import "./style.css";

const APP_ID = "app.hiraya.text-editor";
const SETTINGS_KEY = "editor-settings";
const editor = required<HTMLTextAreaElement>("#editor");
const status = required<HTMLElement>("#status");
const title = required<HTMLElement>("#title");
const documentState = new TextDocumentState();
let hiraya: HirayaClient;
let handle: FileHandle | null = null;
let name = "Untitled.txt";
let settings = parseTextEditorSettings(undefined);
let autoSaveTimer = 0;
let saving = false;

editor.addEventListener("input", () => {
  documentState.edit(editor.value);
  renderDirty();
  scheduleAutoSave();
});
required("#open").addEventListener("click", () => void open());
required("#save").addEventListener("click", () => void save(false));
required("#save-as").addEventListener("click", () => void save(true));
required("#format").addEventListener("click", () => applyFormatting());
required<HTMLSelectElement>("#font-size").addEventListener("change", (event) => void changeSettings({ ...settings, fontSize: Number((event.target as HTMLSelectElement).value) }));
for (const [id, key] of [["line-wrap", "lineWrap"], ["auto-save", "autoSave"], ["auto-format", "autoFormat"]] as const) {
  required<HTMLInputElement>(`#${id}`).addEventListener("change", (event) => void changeSettings({ ...settings, [key]: (event.target as HTMLInputElement).checked }));
}
addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(event.shiftKey); }
});
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    let copiedSettings: unknown;
    try { copiedSettings = app.launch.arguments[0] ? JSON.parse(app.launch.arguments[0]) : undefined; } catch { copiedSettings = undefined; }
    const stored = await hiraya.storage.get(SETTINGS_KEY);
    settings = parseTextEditorSettings(stored, parseTextEditorSettings(copiedSettings));
    if (stored === undefined) await hiraya.storage.set(SETTINGS_KEY, settings);
    applySettings();
    hiraya.on("commands.invoked", ({ id }) => id === "save" ? void save(false) : id === "open" ? void open() : id === "format" ? applyFormatting() : undefined);
    hiraya.on("files.changed", ({ handles }) => { if (handle && handles.includes(handle)) void remoteChanged(); });
    await hiraya.commands.set([{ id: "open", title: "Open", shortcut: "Ctrl+O" }, { id: "save", title: "Save", shortcut: "Ctrl+S" }, { id: "format", title: "Format document" }]);
    if (app.launch.files[0]) await load(app.launch.files[0]);
    else setStatus("Ready. Settings are stored for this browser and account.");
  } catch (error) { setStatus(describeError(error, "Text Editor could not start."), true); }
}

async function confirmDiscard() {
  return !documentState.dirty || await hiraya.dialogs.confirm({ title: "Discard unsaved changes?", message: "The current document has changes that have not been saved.", confirmLabel: "Discard", destructive: true });
}

async function open() {
  try {
    if (!await confirmDiscard()) return;
    const selected = await hiraya.dialogs.openFile({ multiple: false });
    if (selected?.[0]) await load(selected[0]);
  } catch (error) { setStatus(describeError(error, "Could not open the file."), true); }
}

async function read(next: FileHandle) {
  const entry = await hiraya.files.stat(next);
  if (entry.kind !== "file") throw new Error("The selected item is not a file.");
  const data = await readFileData(hiraya, next, entry.metadata.size);
  return { entry: entry.metadata, text: new TextDecoder("utf-8", { fatal: true }).decode(data) };
}

async function load(next: FileHandle) {
  const loaded = await read(next);
  documentState.load(loaded.text, loaded.entry.contentRevision);
  editor.value = loaded.text;
  handle = next;
  name = loaded.entry.name;
  renderDirty();
  setStatus(`Opened ${name}.`);
}

async function remoteChanged() {
  if (!handle) return;
  try {
    const loaded = await read(handle);
    if (!documentState.remote(loaded.text, loaded.entry.contentRevision)) {
      setStatus("This file changed elsewhere. Your unsaved text is preserved; use Save as or review before replacing the remote version.", true);
      return;
    }
    if (editor.value !== documentState.text) editor.value = documentState.text;
    name = loaded.entry.name;
    renderDirty();
    setStatus(`Reloaded ${name} after an external change.`);
  } catch (error) { setStatus(describeError(error, "Could not reload the changed file."), true); }
}

async function save(saveAs: boolean) {
  if (saving) return;
  saving = true;
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
    const sourceText = editor.value;
    const text = settings.autoFormat ? formatText(name, sourceText) : sourceText;
    const bytes = new TextEncoder().encode(text);
    const saved = await writeFileData(hiraya, destination, bytes.buffer, { mimeType: "text/plain; charset=utf-8", expectedRevision: expected ?? undefined });
    handle = destination;
    name = saved.name;
    documentState.saved(sourceText, text, saved.contentRevision);
    if (editor.value !== documentState.text) editor.value = documentState.text;
    renderDirty();
    if (documentState.dirty) scheduleAutoSave();
    setStatus(`Saved ${name}.`);
  } catch (error) {
    const message = error instanceof HirayaSdkError && error.code === "CONFLICT" ? "This file changed elsewhere. Your text is preserved; use Save as or review before replacing the remote version." : describeError(error, "Could not save the file.");
    setStatus(message, true);
  } finally { saving = false; }
}

function applyFormatting() {
  try {
    editor.value = formatText(name, editor.value);
    documentState.edit(editor.value);
    renderDirty();
    scheduleAutoSave();
    setStatus("Document formatted.");
  } catch (error) { setStatus(describeError(error, "Could not format the document."), true); }
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  if (settings.autoSave && handle && documentState.dirty && !documentState.remoteConflict) autoSaveTimer = setTimeout(() => void save(false), 750) as unknown as number;
}

async function changeSettings(next: TextEditorSettings) {
  settings = parseTextEditorSettings(next);
  applySettings();
  await hiraya.storage.set(SETTINGS_KEY, settings);
  scheduleAutoSave();
  setStatus("Editor settings saved for this browser and account.");
}

function applySettings() {
  editor.style.fontSize = `${settings.fontSize}px`;
  editor.wrap = settings.lineWrap ? "soft" : "off";
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
function setStatus(message: string, error = false) { status.textContent = message; status.classList.toggle("error", error); }

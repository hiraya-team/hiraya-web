import { HirayaSdkError, type FileHandle, type FileMetadata, type HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, readFileData, required, writeFileData } from "@hiraya/system-apps-shared";
import { formatText, parseTextEditorSettings, textEditorControlState, TextDocumentOperations, TextDocumentState, writeRestrictionMessage, type TextEditorSettings } from "./editor";
import "./style.css";

const APP_ID = "app.hiraya.text-editor";
const SETTINGS_KEY = "editor-settings";
const editor = required<HTMLTextAreaElement>("#editor");
const status = required<HTMLElement>("#status");
const title = required<HTMLElement>("#title");
const documentState = new TextDocumentState();
const operations = new TextDocumentOperations();
let hiraya: HirayaClient;
let handle: FileHandle | null = null;
let name = "Untitled.txt";
let settings = parseTextEditorSettings(undefined);
let autoSaveTimer = 0;
let saving = false;
let initialized = false;
let canWrite = false;
let writeReason: "available" | "read-only" | "shared-offline" | "temporarily-unavailable" = "temporarily-unavailable";

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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (initialized && canWrite) void save(event.shiftKey); }
});
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    app.onDispose(() => { initialized = false; operations.invalidate(); clearTimeout(autoSaveTimer); });
    let copiedSettings: unknown;
    try { copiedSettings = app.launch.arguments[0] ? JSON.parse(app.launch.arguments[0]) : undefined; } catch { copiedSettings = undefined; }
    const stored = await hiraya.storage.get(SETTINGS_KEY);
    settings = parseTextEditorSettings(stored, parseTextEditorSettings(copiedSettings));
    if (stored === undefined) await hiraya.storage.set(SETTINGS_KEY, settings);
    applySettings();
    applyCapabilities(await hiraya.app.getCapabilities());
    hiraya.on("capabilities.changed", applyCapabilities);
    hiraya.on("commands.invoked", ({ id }) => id === "save" ? initialized && !saving && canWrite && void save(false) : id === "open" ? initialized && !saving && void open() : id === "format" ? initialized && !saving && canWrite && applyFormatting() : undefined);
    hiraya.on("files.changed", ({ handles }) => { if (handle && handles.includes(handle)) void remoteChanged(); });
    const launchFile = app.launch.files[0];
    if (launchFile) {
      const generation = operations.beginForeground();
      try { await load(launchFile, generation, true); }
      catch (error) { setStatus(describeError(error, "Could not open the launch file."), true); }
      finally { operations.finishForeground(generation); }
    }
    initialized = true;
    renderControlState();
    publishCommands();
    if (!launchFile) setStatus(canWrite ? "Ready. Settings are stored for this browser and account." : writeRestrictionMessage(writeReason, false));
  } catch (error) { setStatus(describeError(error, "Text Editor could not start."), true); }
}

async function confirmDiscard() {
  return !documentState.dirty || await hiraya.dialogs.confirm({ title: "Discard unsaved changes?", message: "The current document has changes that have not been saved.", confirmLabel: "Discard", destructive: true });
}

async function open() {
  if (!initialized || saving) return;
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
  const data = await readFileData(hiraya, next, entry.size);
  return { entry, text: new TextDecoder("utf-8", { fatal: true }).decode(data) };
}

async function load(next: FileHandle, generation: number, identifyBeforeRead = false) {
  const entry = await statFile(next);
  if (!operations.isForegroundCurrent(generation)) return;
  if (identifyBeforeRead) {
    name = entry.name;
    renderDirty();
  }
  const loaded = await read(next, entry); if (!operations.isForegroundCurrent(generation)) return;
  documentState.load(loaded.text, loaded.entry.contentRevision);
  editor.value = loaded.text;
  handle = next;
  name = loaded.entry.name;
  renderDirty();
  setStatus(canWrite ? `Opened ${name}.` : writeRestrictionMessage(writeReason, false));
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
    if (editor.value !== documentState.text) editor.value = documentState.text;
    name = loaded.entry.name;
    renderDirty();
    setStatus(`Reloaded ${name} after an external change.`);
  } catch (error) { if (operations.isBackgroundCurrent(generation)) setStatus(describeError(error, "Could not reload the changed file."), true); }
}

async function save(saveAs: boolean) {
  if (!initialized || saving || !canWrite) return;
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
    const sourceText = editor.value;
    const text = settings.autoFormat ? formatText(name, sourceText) : sourceText;
    const bytes = new TextEncoder().encode(text);
    if (!canWrite) { setStatus(writeRestrictionMessage(writeReason, documentState.dirty), documentState.dirty); return; }
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
  } finally { saving = false; renderControlState(); publishCommands(); }
}

function applyFormatting() {
  if (!initialized || !canWrite) return;
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
  const controls = textEditorControlState(initialized, saving, canWrite);
  required<HTMLButtonElement>("#open").disabled = !controls.open;
  required<HTMLSelectElement>("#font-size").disabled = !controls.settings;
  required<HTMLInputElement>("#line-wrap").disabled = !controls.settings;
  editor.readOnly = !controls.write;
  for (const id of ["save", "save-as", "format", "auto-save", "auto-format"]) required<HTMLButtonElement | HTMLInputElement>(`#${id}`).disabled = !controls.write;
  required<HTMLElement>("#write-state").hidden = !initialized || canWrite;
}
function publishCommands() {
  void hiraya.commands.set([{ id: "open", title: "Open", shortcut: "Ctrl+O", enabled: initialized && !saving }, { id: "save", title: "Save", shortcut: "Ctrl+S", enabled: initialized && !saving && canWrite }, { id: "format", title: "Format document", enabled: initialized && !saving && canWrite }]);
}
function setStatus(message: string, error = false) { status.textContent = message; status.classList.toggle("error", error); }

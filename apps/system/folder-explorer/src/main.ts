import type { DirectoryEntry, FileHandle, FolderHandle, HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, downloadBuffer, formatBytes, readFileData, required } from "@hiraya/system-apps-shared";
import { selectionAfterInteraction, sortEntries } from "./entries";
import "./style.css";

const APP_ID = "app.hiraya.folder-explorer";
const body = required<HTMLTableSectionElement>("#entries");
const status = required<HTMLElement>("#status");
const dialog = required<HTMLDialogElement>("#name-dialog");
const input = required<HTMLInputElement>("#name-input");
const createMenuTrigger = required<HTMLButtonElement>("#create-menu-trigger");
const createActions = required<HTMLElement>("#create-actions");
let hiraya: HirayaClient;
let folder: FolderHandle | null = null;
let entries: DirectoryEntry[] = [];
let selectedHandles: string[] = [];
let selectionAnchor: string | null = null;
let crumbs: Array<{ handle: FolderHandle | null; name: string }> = [];
let nameAction: ((name: string) => Promise<void>) | null = null;

required("#up").addEventListener("click", () => void goUp());
required("#choose").addEventListener("click", () => void chooseFolder());
required("#upload").addEventListener("click", () => { closeCreateMenu(); void hostAction(() => hiraya.host.importFiles(folder), "Could not open file upload."); });
required("#import-folder").addEventListener("click", () => { closeCreateMenu(); void hostAction(() => hiraya.host.importFolder(folder), "Could not open folder import."); });
required("#new-file").addEventListener("click", () => { closeCreateMenu(); askName("Create file", "Untitled.txt", createFile); });
required("#new-folder").addEventListener("click", () => { closeCreateMenu(); askName("Create folder", "New folder", createFolder); });
required("#open").addEventListener("click", () => void openSelected());
required("#rename").addEventListener("click", () => selectedEntries()[0] && askName("Rename item", selectedEntries()[0].metadata.name, rename));
required("#move").addEventListener("click", () => void move());
required("#download").addEventListener("click", () => void download());
required("#offline").addEventListener("click", () => void toggleOffline());
required("#more").addEventListener("click", () => void showMoreActions());
required("#delete").addEventListener("click", () => void remove());
required("#cancel-name").addEventListener("click", () => dialog.close());
createMenuTrigger.addEventListener("click", () => setCreateMenuOpen(createActions.dataset.open !== "true"));
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node | null;
  if (target && !createActions.contains(target) && !createMenuTrigger.contains(target)) closeCreateMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || createActions.dataset.open !== "true") return;
  event.preventDefault();
  closeCreateMenu();
  createMenuTrigger.focus();
});
required<HTMLFormElement>("#name-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const action = nameAction;
  const name = input.value.trim();
  if (!action || !name) return;
  dialog.close();
  void mutate(() => action(name));
});
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    folder = app.launch.folders[0] ?? null;
    const name = folder ? await folderLabel(folder) : "Home";
    crumbs = [{ handle: folder, name }];
    hiraya.on("files.changed", () => void refresh());
    await refresh();
  } catch (error) { fail(error, "Folder Explorer could not start."); }
}

async function refresh() {
  try {
    entries = sortEntries(await hiraya.files.list(folder));
    const available = new Set(entries.map((entry) => entry.metadata.handle as string));
    selectedHandles = selectedHandles.filter((handle) => available.has(handle));
    if (!selectedHandles.length) selectionAnchor = null;
    render();
    status.textContent = `${entries.length} item${entries.length === 1 ? "" : "s"}.`;
    status.classList.remove("error");
    await hiraya.window.setTitle(`${crumbs.at(-1)?.name ?? "Home"} - Folder Explorer`);
  } catch (error) { fail(error, "Could not list this folder."); }
}

function render() {
  body.replaceChildren();
  renderBreadcrumbs();
  required<HTMLButtonElement>("#up").disabled = crumbs.length <= 1;
  const ordered = entries.map((entry) => entry.metadata.handle as string);
  for (const [entryIndex, entry] of entries.entries()) {
    const handle = entry.metadata.handle as string;
    const row = document.createElement("tr");
    row.tabIndex = selectedHandles.includes(handle) || selectedHandles.length === 0 && entryIndex === 0 ? 0 : -1;
    row.dataset.handle = handle;
    row.setAttribute("role", "row");
    row.setAttribute("aria-selected", String(selectedHandles.includes(handle)));
    const nameCell = document.createElement("td");
    nameCell.className = "entry-name";
    const icon = document.createElement("span");
    icon.className = "entry-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = entry.kind === "folder" ? "▰" : "▤";
    const label = document.createElement("span");
    label.textContent = entry.metadata.name;
    nameCell.append(icon, label);
    const type = document.createElement("td");
    type.textContent = entry.kind === "folder" ? "Folder" : entry.metadata.mimeType;
    const size = document.createElement("td");
    size.textContent = entry.kind === "file" ? formatBytes(entry.metadata.size) : "-";
    const modified = document.createElement("td");
    modified.textContent = new Date(entry.metadata.modifiedAt).toLocaleDateString();
    row.append(nameCell, type, size, modified);
    row.addEventListener("click", (event) => select(entry, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey }));
    row.addEventListener("dblclick", () => void activate(entry));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void activate(entry); return; }
      if (event.key === " ") { event.preventDefault(); select(entry, { toggle: true }); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const next = Math.min(ordered.length - 1, Math.max(0, ordered.indexOf(handle) + (event.key === "ArrowDown" ? 1 : -1)));
      body.querySelector<HTMLElement>(`tr[data-handle="${CSS.escape(ordered[next])}"]`)?.focus();
    });
    body.append(row);
  }
  required<HTMLElement>("#empty").hidden = entries.length > 0;
  void renderSelection();
}

function renderBreadcrumbs() {
  const breadcrumbs = required<HTMLElement>("#breadcrumbs");
  breadcrumbs.replaceChildren();
  crumbs.forEach((crumb, index) => {
    if (index) { const separator = document.createElement("span"); separator.textContent = "/"; separator.setAttribute("aria-hidden", "true"); breadcrumbs.append(separator); }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = crumb.name;
    button.disabled = index === crumbs.length - 1;
    button.addEventListener("click", () => void navigateToCrumb(index));
    breadcrumbs.append(button);
  });
}

function select(entry: DirectoryEntry, options: { toggle?: boolean; range?: boolean } = {}) {
  const handle = entry.metadata.handle as string;
  selectedHandles = selectionAfterInteraction(selectedHandles, handle, entries.map((item) => item.metadata.handle as string), { ...options, anchor: selectionAnchor });
  if (!options.range) selectionAnchor = handle;
  render();
}

function selectedEntries() {
  const selected = new Set(selectedHandles);
  return entries.filter((entry) => selected.has(entry.metadata.handle as string));
}

async function renderSelection() {
  const selected = selectedEntries();
  required<HTMLElement>(".selection-bar").dataset.active = String(selected.length > 0);
  required("#selection").textContent = selected.length === 0 ? "Nothing selected" : selected.length === 1 ? selected[0].metadata.name : `${selected.length} items selected`;
  required<HTMLButtonElement>("#open").disabled = selected.length !== 1;
  required<HTMLButtonElement>("#rename").disabled = selected.length !== 1;
  required<HTMLButtonElement>("#move").disabled = selected.length !== 1;
  required<HTMLButtonElement>("#download").disabled = selected.length !== 1 || selected[0].kind !== "file";
  for (const id of ["delete", "more", "offline"]) required<HTMLButtonElement>(`#${id}`).disabled = selected.length === 0;
  if (!selected.length) return;
  try {
    const states = await hiraya.host.getEntryStatus(selected.map((entry) => entry.metadata.handle));
    const allDirect = states.every((entry) => entry.directlyPinned);
    required<HTMLButtonElement>("#offline").textContent = allDirect ? "Unpin offline" : "Make available offline";
    status.textContent = states.length === 1 ? offlineLabel(states[0].status) : `${states.filter((entry) => entry.pinned).length} of ${states.length} selected items pinned.`;
  } catch { /* Older hosts retain the primary file actions. */ }
}

function setCreateMenuOpen(open: boolean) {
  createActions.dataset.open = String(open);
  createMenuTrigger.setAttribute("aria-expanded", String(open));
  if (open) requestAnimationFrame(() => createActions.querySelector<HTMLButtonElement>("button")?.focus());
}
function closeCreateMenu() { setCreateMenuOpen(false); }

async function activate(entry: DirectoryEntry) {
  if (entry.kind === "folder") await enter(entry.metadata.handle, entry.metadata.name);
  else await hostAction(() => hiraya.host.openEntry(entry.metadata.handle), "Could not open the file.");
}
async function openSelected() { const entry = selectedEntries()[0]; if (entry) await activate(entry); }
async function enter(next: FolderHandle, name: string) { folder = next; crumbs.push({ handle: next, name }); selectedHandles = []; selectionAnchor = null; await refresh(); }
async function navigateToCrumb(index: number) { const crumb = crumbs[index]; crumbs = crumbs.slice(0, index + 1); folder = crumb.handle; selectedHandles = []; selectionAnchor = null; await refresh(); }
async function goUp() { if (crumbs.length > 1) await navigateToCrumb(crumbs.length - 2); }
async function chooseFolder() { try { const chosen = await hiraya.dialogs.openFolder(); if (chosen) { folder = chosen; crumbs = [{ handle: chosen, name: await folderLabel(chosen) }]; await refresh(); } } catch (error) { fail(error, "Could not choose a folder."); } }
async function folderLabel(handle: FolderHandle) { const entry = await hiraya.files.stat(handle); return entry.kind === "folder" ? entry.metadata.name : "Folder"; }
function askName(title: string, value: string, action: (name: string) => Promise<void>) { required("#dialog-title").textContent = title; input.value = value; nameAction = action; dialog.showModal(); input.focus(); input.select(); }
async function createFile(name: string) { await hiraya.files.createFile({ parent: folder, name, data: new ArrayBuffer(0), mimeType: "text/plain" }); }
async function createFolder(name: string) { await hiraya.files.createFolder(folder, name); }
async function rename(name: string) { const entry = selectedEntries()[0]; if (entry) await hiraya.files.rename(entry.metadata.handle, name); }
async function move() { const entry = selectedEntries()[0]; if (!entry) return; try { const destination = await hiraya.dialogs.openFolder(); if (destination) await mutate(() => hiraya.files.move(entry.metadata.handle, destination).then(() => undefined)); } catch (error) { fail(error, "Could not move the item."); } }
async function remove() { const selected = selectedEntries(); if (!selected.length) return; try { const confirmed = await hiraya.dialogs.confirm({ title: selected.length === 1 ? `Delete ${selected[0].metadata.name}?` : `Delete ${selected.length} items?`, message: "The selected items and all selected folder contents will be deleted.", confirmLabel: "Delete", destructive: true }); if (confirmed) await mutate(() => hiraya.files.deleteMany(selected.map((entry) => entry.metadata.handle), true)); } catch (error) { fail(error, "Could not delete the selection."); } }
async function download() { const entry = selectedEntries()[0]; if (entry?.kind === "file") await downloadEntry(entry); }
async function downloadEntry(entry: Extract<DirectoryEntry, { kind: "file" }>) { try { status.textContent = `Preparing ${entry.metadata.name}...`; const data = await readFileData(hiraya, entry.metadata.handle as FileHandle, entry.metadata.size); downloadBuffer(data, entry.metadata.mimeType, entry.metadata.name); status.textContent = `Downloaded ${entry.metadata.name}.`; } catch (error) { fail(error, "Could not download the file."); } }
async function toggleOffline() { const selected = selectedEntries(); if (!selected.length) return; try { const states = await hiraya.host.getEntryStatus(selected.map((entry) => entry.metadata.handle)); await hiraya.host.setOfflinePinned(selected.map((entry) => entry.metadata.handle), !states.every((entry) => entry.directlyPinned)); await renderSelection(); } catch (error) { fail(error, "Could not change offline availability."); } }
async function showMoreActions() { const selected = selectedEntries(); if (selected.length) await hostAction(() => hiraya.host.showEntryActions(selected.map((entry) => entry.metadata.handle)), "Could not show Hiraya actions."); }
async function mutate(action: () => Promise<void>) { try { await action(); selectedHandles = []; selectionAnchor = null; await refresh(); } catch (error) { fail(error, "The change could not be completed."); } }
async function hostAction(action: () => Promise<void>, fallback: string) { try { await action(); } catch (error) { fail(error, fallback); } }
function offlineLabel(value: string) { return ({ cached: "Downloaded for offline use", pinned: "Pinned for offline use", protected: "Protected local content", partial: "Partly available offline", unavailable: "Not available offline", updating: "Updating offline copy", error: "Offline download failed" } as Record<string, string>)[value] ?? "Offline status unavailable"; }
function fail(error: unknown, fallback: string) { const message = describeError(error, fallback); if (message) { status.textContent = message; status.classList.add("error"); } }

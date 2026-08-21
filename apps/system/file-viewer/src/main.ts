import type { FileHandle, FileMetadata, HirayaClient } from "@hiraya-team/apps-sdk";
import { connectSystemApp, describeError, formatBytes, LatestOperation, required, setAppLoading } from "@hiraya/system-apps-shared";
import "./style.css";
type HirayaButton = HTMLElement & { disabled: boolean };
/** Identifies the File Viewer system app. */
const APP_ID = "app.hiraya.file-viewer";
/** References the status interface element. */
const status = required<HTMLElement>("#status");
/** References the download interface element. */
const download = required<HirayaButton>("#download");
/** Coordinates the latest file operation. */
const operations = new LatestOperation();
/** References the content interface element. */
const content = required<HTMLElement>("#content");
/** References the details interface element. */
const details = required<HTMLElement>("#details");
/** References the loading interface element. */
const loading = required<HTMLElement>("#loading"); let downloadUrl: string | null = null; let hiraya: HirayaClient; let file: FileMetadata | null = null; let ready = false; let opening = false;
download.addEventListener("click", () => void saveCopy()); void start();
/** Starts the application. */
async function start() { try { const app = await connectSystemApp(APP_ID); hiraya = app.hiraya; ready = true; hiraya.on("commands.invoked", ({ id }) => { if (id === "open") void open(); }); app.onDispose(() => { operations.invalidate(); if (downloadUrl) URL.revokeObjectURL(downloadUrl); }); publishCommands(); if (app.launch.files[0]) await load(app.launch.files[0]); else { setAppLoading(content, details, loading); status.textContent = "Choose any file to inspect it."; } } catch (error) { setAppLoading(content, details, loading); fail(error, "File Viewer could not start."); } }
/** Opens the file supplied in the launch context. */
async function open() { const generation = operations.begin(); try { const selected = await hiraya.dialogs.openFile({ multiple: false }); if (selected?.[0] && operations.isLatest(generation)) await load(selected[0], generation); } catch (error) { if (operations.isLatest(generation)) fail(error, "Could not choose a file."); } finally { if (operations.isLatest(generation) && file) download.disabled = false; } }
/** Loads metadata for the selected file. */
async function load(handle: FileHandle, generation = operations.begin()) { opening = true; publishCommands(); setAppLoading(content, details, loading, "Opening file..."); download.disabled = true; try { const entry = await hiraya.files.stat(handle); if (!operations.isLatest(generation)) return; if (entry.kind !== "file") throw new Error("The selected item is not a file."); setAppLoading(content, details, loading, `Opening ${entry.metadata.name}...`); file = entry.metadata; required("#name").textContent = file.name; required("#type").textContent = file.mimeType; required("#size").textContent = formatBytes(file.size); required("#modified").textContent = new Date(file.modifiedAt).toLocaleString(); status.textContent = "File details ready. Content is read only when downloaded."; await hiraya.window.setTitle(`${file.name} - File Viewer`); } finally { if (operations.isLatest(generation)) { opening = false; setAppLoading(content, details, loading); download.disabled = !file; publishCommands(); } } }
/** Saves copy. */
async function saveCopy() { if (!file) return; const generation = operations.begin(); const selected = file; try { download.disabled = true; status.textContent = "Preparing download..."; const { data } = await hiraya.files.readAll(selected.handle); if (!operations.isLatest(generation)) return; if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl = URL.createObjectURL(new Blob([data], { type: selected.mimeType })); const anchor = document.createElement("a"); anchor.href = downloadUrl; anchor.download = selected.name; anchor.click(); anchor.remove(); status.textContent = `Downloaded ${selected.name}.`; } catch (error) { if (operations.isLatest(generation)) fail(error, "Could not download the file."); } finally { if (operations.isLatest(generation)) download.disabled = false; } }
/** Displays a file loading failure. */
function fail(error: unknown, fallback: string) { status.textContent = describeError(error, fallback); status.classList.add("error"); }
/** Publishes commands. */
function publishCommands() { void hiraya?.commands.set([{ id: "open", title: "Choose file", enabled: ready && !opening, promoted: true }]); }

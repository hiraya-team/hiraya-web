import type { FileHandle, FolderHandle, HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, readFileData, relativeReader, required } from "@hiraya/system-apps-shared";
import { renderMarkdown } from "./markdown";
import "./style.css";

const APP_ID = "app.hiraya.markdown-preview";
const preview = required<HTMLElement>("#preview");
const status = required<HTMLElement>("#status");
let hiraya: HirayaClient;
let relativeFolder: FolderHandle | null = null;
let objectUrls: string[] = [];
required("#open").addEventListener("click", () => void open());
addEventListener("pagehide", revokeUrls, { once: true });
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID); hiraya = app.hiraya;
    relativeFolder = app.launch.folders[0] ?? null;
    if (app.launch.files[0]) await load(app.launch.files[0]); else status.textContent = "Ready.";
  } catch (error) { fail(error, "Markdown Preview could not start."); }
}
async function open() {
  try { const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: ["text/markdown", "text/plain"] }); if (selected?.[0]) await load(selected[0]); }
  catch (error) { fail(error, "Could not open the document."); }
}
async function load(handle: FileHandle) {
  const entry = await hiraya.files.stat(handle); if (entry.kind !== "file") throw new Error("The selected item is not a file.");
  const data = await readFileData(hiraya, handle, entry.metadata.size);
  revokeUrls(); preview.replaceChildren(renderMarkdown(new TextDecoder().decode(data), document));
  await loadRelativeContent(relativeFolder ?? handle);
  required("#title").textContent = entry.metadata.name;
  await hiraya.window.setTitle(`${entry.metadata.name} - Markdown Preview`);
  status.textContent = relativeReader(hiraya) ? "Preview ready. Relative images are supported by this host." : "Preview ready. Relative images require a newer host.";
}
async function loadRelativeContent(handle: FileHandle | FolderHandle) {
  const readRelative = relativeReader(hiraya); if (!readRelative) return;
  await Promise.all([...preview.querySelectorAll<HTMLImageElement>("img[data-relative-src]")].map(async (image) => {
    try { const result = await readRelative(handle, image.dataset.relativeSrc ?? ""); const url = URL.createObjectURL(new Blob([result.data], { type: result.mimeType })); objectUrls.push(url); image.src = url; }
    catch { image.replaceWith(document.createTextNode(`[Image unavailable: ${image.alt}]`)); }
  }));
  for (const link of preview.querySelectorAll<HTMLAnchorElement>("a[data-relative-href]")) link.addEventListener("click", (event) => {
    event.preventDefault();
    const path = link.dataset.relativeHref;
    if (!path) return;
    void hiraya.files.resolve(handle, path).then((entry) => hiraya.host.openEntry(entry.metadata.handle)).catch((error) => fail(error, "Could not open the linked file."));
  });
}
function revokeUrls() { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls = []; }
function fail(error: unknown, fallback: string) { const message = describeError(error, fallback); if (message) { status.textContent = message; status.classList.add("error"); } }

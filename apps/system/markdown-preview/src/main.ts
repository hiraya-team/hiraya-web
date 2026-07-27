import type { FileHandle, FolderHandle, HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, LatestOperation, readFileData, relativeReader, required } from "@hiraya/system-apps-shared";
import { renderMarkdown } from "./markdown";
import "./style.css";

const APP_ID = "app.hiraya.markdown-preview";
const preview = required<HTMLElement>("#preview");
const status = required<HTMLElement>("#status");
const openButton = required<HTMLButtonElement>("#open");
const contentOperations = new LatestOperation();
const renderOperations = new LatestOperation();
const linkOperations = new LatestOperation();
let hiraya: HirayaClient;
let relativeFolder: FolderHandle | null = null;
let objectUrls: string[] = [];
let externalEmbeddedPreviews = false;
let currentSource = "";
let currentRelativeHandle: FileHandle | FolderHandle | null = null;
openButton.addEventListener("click", () => void open());
addEventListener("pagehide", () => { contentOperations.invalidate(); renderOperations.invalidate(); linkOperations.invalidate(); revokeUrls(); }, { once: true });
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID); hiraya = app.hiraya; openButton.disabled = false;
    relativeFolder = app.launch.folders[0] ?? null;
    externalEmbeddedPreviews = (await hiraya.app.getCapabilities()).externalEmbeddedPreviews;
    hiraya.on("capabilities.changed", (capabilities) => {
      if (externalEmbeddedPreviews === capabilities.externalEmbeddedPreviews) return;
      externalEmbeddedPreviews = capabilities.externalEmbeddedPreviews;
       if (currentRelativeHandle) void renderDocument(renderOperations.begin());
    });
    if (app.launch.files[0]) await load(app.launch.files[0]); else status.textContent = "Ready.";
  } catch (error) { fail(error, "Markdown Preview could not start."); }
}
async function open() {
  const generation = contentOperations.begin();
  try { const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: ["text/markdown", "text/plain"] }); if (selected?.[0] && contentOperations.isLatest(generation)) await load(selected[0], generation); }
  catch (error) { if (contentOperations.isLatest(generation)) fail(error, "Could not open the document."); }
}
async function load(handle: FileHandle, generation = contentOperations.begin()) {
  const entry = await hiraya.files.stat(handle); if (!contentOperations.isLatest(generation)) return; if (entry.kind !== "file") throw new Error("The selected item is not a file.");
  const data = await readFileData(hiraya, handle, entry.metadata.size); if (!contentOperations.isLatest(generation)) return;
  currentSource = new TextDecoder().decode(data);
  currentRelativeHandle = relativeFolder ?? handle;
  await renderDocument(renderOperations.begin()); if (!contentOperations.isLatest(generation)) return;
  required("#title").textContent = entry.metadata.name;
  await hiraya.window.setTitle(`${entry.metadata.name} - Markdown Preview`);
  status.textContent = relativeReader(hiraya) ? "Preview ready. Relative images are supported by this host." : "Preview ready. Relative images require a newer host.";
}
async function renderDocument(generation = renderOperations.begin()) {
  if (!currentRelativeHandle || !renderOperations.isLatest(generation)) return;
  revokeUrls(); preview.replaceChildren(renderMarkdown(currentSource, document));
  await loadRelativeContent(currentRelativeHandle, generation); if (!renderOperations.isLatest(generation)) return;
  renderExternalContent();
}
async function loadRelativeContent(handle: FileHandle | FolderHandle, generation: number) {
  const readRelative = relativeReader(hiraya); if (!readRelative) return;
  await Promise.all([...preview.querySelectorAll<HTMLImageElement>("img[data-relative-src]")].map(async (image) => {
    try { const result = await readRelative(handle, image.dataset.relativeSrc ?? ""); if (!renderOperations.isLatest(generation)) return; const url = URL.createObjectURL(new Blob([result.data], { type: result.mimeType })); if (!renderOperations.isLatest(generation)) { URL.revokeObjectURL(url); return; } objectUrls.push(url); image.src = url; }
    catch { if (renderOperations.isLatest(generation)) image.replaceWith(document.createTextNode(`[Image unavailable: ${image.alt}]`)); }
  }));
  for (const link of preview.querySelectorAll<HTMLAnchorElement>("a[data-relative-href]")) link.addEventListener("click", (event) => {
    event.preventDefault();
    const path = link.dataset.relativeHref;
    if (!path) return;
    const linkGeneration = linkOperations.begin();
    void hiraya.files.resolve(handle, path).then((entry) => linkOperations.isLatest(linkGeneration) ? hiraya.host.openEntry(entry.metadata.handle) : undefined).catch((error) => { if (linkOperations.isLatest(linkGeneration)) fail(error, "Could not open the linked file."); });
  });
}
function renderExternalContent() {
  for (const image of preview.querySelectorAll<HTMLImageElement>("img[data-external-src]")) {
    const source = image.dataset.externalSrc ?? "";
    if (externalEmbeddedPreviews) { image.src = source; continue; }
    let host = "external site";
    try { host = new URL(source).host; } catch { /* The renderer already accepts only absolute HTTP URLs. */ }
    const placeholder = document.createElement("span");
    placeholder.className = "external-embed";
    placeholder.setAttribute("role", "group");
    placeholder.setAttribute("aria-label", `External image from ${host} blocked`);
    const copy = document.createElement("span");
    copy.textContent = `External image blocked from ${host}`;
    const once = document.createElement("button");
    once.type = "button"; once.textContent = "Load once";
    once.addEventListener("click", () => { image.src = source; placeholder.replaceWith(image); });
    const always = document.createElement("button");
    always.type = "button"; always.textContent = "Always load";
    always.addEventListener("click", () => void hiraya.host.setExternalEmbeddedPreviews(true).catch((error) => fail(error, "Could not save the external content preference.")));
    placeholder.append(copy, once, always);
    image.replaceWith(placeholder);
  }
}
function revokeUrls() { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls = []; }
function fail(error: unknown, fallback: string) { const message = describeError(error, fallback); if (message) { status.textContent = message; status.classList.add("error"); } }

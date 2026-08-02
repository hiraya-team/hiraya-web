import type { FileHandle, HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, formatBytes, LatestOperation, required } from "@hiraya/system-apps-shared";
import { DOCX_MIME, MAX_PARSED_DOCUMENT_BYTES, normalizedMime, parsedDocumentKind, RTF_MIMES } from "./document-types";
import "./style.css";

type HirayaButton = HTMLElement & { disabled: boolean };

const APP_ID = "app.hiraya.media-viewer";
const viewer = required<HTMLElement>("#viewer");
const status = required<HTMLElement>("#status");
const openButton = required<HirayaButton>("#open");
const fullscreenButton = required<HirayaButton>("#fullscreen");
const operations = new LatestOperation();
let hiraya: HirayaClient;
let url: string | null = null;

openButton.addEventListener("click", () => void open());
fullscreenButton.addEventListener("click", () => void toggleFullscreen());
addEventListener("pagehide", () => { operations.invalidate(); clear(); }, { once: true });
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    openButton.disabled = false;
    fullscreenButton.disabled = false;
    if (app.launch.files[0]) await load(app.launch.files[0]);
    else status.textContent = "Ready.";
  } catch (error) {
    showPreviewError(error, "Viewer could not start.");
  }
}

async function open() {
  const generation = operations.begin();
  try {
    const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: [DOCX_MIME, ...RTF_MIMES, "application/pdf", "audio/aac", "audio/flac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "video/mp4", "video/ogg", "video/quicktime", "video/webm"] });
    if (selected?.[0] && operations.isLatest(generation)) await load(selected[0], generation);
  } catch (error) {
    if (operations.isLatest(generation)) showPreviewError(error, "Could not open the file.");
  }
}

async function load(handle: FileHandle, generation = operations.begin()) {
  const entry = await hiraya.files.stat(handle);
  if (!operations.isLatest(generation)) return;
  if (entry.kind !== "file") throw new Error("The selected item is not a file.");
  const { mimeType: sourceMime, name, size } = entry.metadata;
  const mimeType = normalizedMime(sourceMime);
  const documentKind = parsedDocumentKind(name, mimeType);
  if (!(documentKind || mimeType === "application/pdf" || mimeType.startsWith("audio/") || mimeType.startsWith("video/"))) throw new Error("This viewer supports DOCX, RTF, PDF, audio, and video files.");
  if (documentKind && size > MAX_PARSED_DOCUMENT_BYTES) throw new Error(`This document is too large to preview safely. The preview limit is ${formatBytes(MAX_PARSED_DOCUMENT_BYTES)}.`);

  status.classList.remove("error");
  status.textContent = `Opening ${name}...`;
  const { data } = await hiraya.files.readAll(handle);
  if (!operations.isLatest(generation)) return;

  let element: HTMLElement;
  let nextUrl: string | null = null;
  if (documentKind) {
    const { renderParsedDocument } = await import("./document-preview");
    element = await renderParsedDocument(documentKind, data);
  } else {
    nextUrl = URL.createObjectURL(new Blob([data], { type: mimeType }));
    if (mimeType === "application/pdf") {
      const frame = document.createElement("iframe");
      frame.src = nextUrl;
      frame.title = name;
      frame.setAttribute("sandbox", "");
      frame.referrerPolicy = "no-referrer";
      element = frame;
    } else {
      const media = document.createElement(mimeType.startsWith("audio/") ? "audio" : "video");
      media.controls = true;
      media.src = nextUrl;
      media.preload = "metadata";
      if (media instanceof HTMLVideoElement) media.playsInline = true;
      const card = document.createElement("div");
      card.className = mimeType.startsWith("audio/") ? "media-card" : "";
      card.append(media);
      element = card;
    }
  }

  if (!operations.isLatest(generation)) {
    if (nextUrl) URL.revokeObjectURL(nextUrl);
    return;
  }
  clear();
  url = nextUrl;
  viewer.replaceChildren(element);
  required("#title").textContent = name;
  status.textContent = `${mimeType} · ${formatBytes(size)}`;
  await hiraya.window.setTitle(`${name} - Document & Media Viewer`);
}

async function toggleFullscreen() {
  try {
    const state = await hiraya.window.getState();
    await hiraya.window.setFullscreen(!state.fullscreen);
  } catch (error) {
    setStatusError(error, "Could not change fullscreen mode.");
  }
}

function clear() {
  if (url) URL.revokeObjectURL(url);
  url = null;
  viewer.querySelectorAll("audio,video").forEach((item) => {
    const media = item as HTMLMediaElement;
    media.pause();
    media.removeAttribute("src");
    media.load();
  });
}

function setStatusError(error: unknown, fallback: string) {
  status.textContent = describeError(error, fallback);
  status.classList.add("error");
}

function showPreviewError(error: unknown, fallback: string) {
  clear();
  const message = describeError(error, fallback);
  const empty = document.createElement("hiraya-empty-state");
  const title = document.createElement("strong");
  title.slot = "title";
  title.textContent = "Preview unavailable";
  empty.append(title, document.createTextNode(message));
  viewer.replaceChildren(empty);
  setStatusError(error, fallback);
}

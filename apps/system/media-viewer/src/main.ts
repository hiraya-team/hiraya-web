import type { FileHandle, FolderHandle, HirayaClient } from "@hiraya-team/apps-sdk";
import { connectSystemApp, describeError, formatBytes, LatestOperation, relativeReader, required, setAppLoading } from "@hiraya/system-apps-shared";
import { DOCX_MIME, isMarkdownDocument, MAX_PARSED_DOCUMENT_BYTES, normalizedMime, parsedDocumentKind, RTF_MIMES } from "./document-types";
import { renderParsedDocument } from "./document-preview";
import { renderMarkdown } from "./markdown";
import "./style.css";

const APP_ID = "app.hiraya.media-viewer";
const viewer = required<HTMLElement>("#viewer");
const status = required<HTMLElement>("#status");
const content = required<HTMLElement>("#content");
const loading = required<HTMLElement>("#loading");
const operations = new LatestOperation();
const renderOperations = new LatestOperation();
const linkOperations = new LatestOperation();
let hiraya: HirayaClient;
let objectUrls: string[] = [];
let previewHandle: FileHandle | null = null;
let previewExpiresAt = 0;
let previewGeneration = 0;
let refreshingPreview = false;
let previewRefreshAttempted = false;
let ready = false;
let opening = false;
let fullscreen = false;
let relativeFolder: FolderHandle | null = null;
let externalEmbeddedPreviews = false;
let currentMarkdown: { source: string; relativeHandle: FileHandle | FolderHandle } | null = null;

addEventListener("pagehide", () => { operations.invalidate(); clear(); }, { once: true });
void start();

async function start() {
  try {
    const app = await connectSystemApp(APP_ID);
    hiraya = app.hiraya;
    hiraya.on("commands.invoked", ({ id }) => id === "open" ? void open() : id === "fullscreen" ? void toggleFullscreen() : undefined);
    hiraya.on("window.stateChanged", (state) => { fullscreen = state.fullscreen; publishCommands(); });
    fullscreen = (await hiraya.window.getState()).fullscreen;
    relativeFolder = app.launch.folders[0] ?? null;
    externalEmbeddedPreviews = (await hiraya.app.getCapabilities()).externalEmbeddedPreviews;
    hiraya.on("capabilities.changed", (capabilities) => {
      if (externalEmbeddedPreviews === capabilities.externalEmbeddedPreviews) return;
      externalEmbeddedPreviews = capabilities.externalEmbeddedPreviews;
      if (currentMarkdown) void renderMarkdownDocument(renderOperations.begin());
    });
    ready = true;
    publishCommands();
    if (app.launch.files[0]) await load(app.launch.files[0], undefined, relativeFolder ?? app.launch.files[0]);
    else { setAppLoading(content, viewer, loading); status.textContent = "Ready."; }
  } catch (error) {
    showPreviewError(error, "Viewer could not start.");
  }
}

async function open() {
  const generation = operations.begin();
  try {
    const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: ["text/markdown", "text/plain", DOCX_MIME, ...RTF_MIMES, "application/pdf", "audio/aac", "audio/flac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "video/mp4", "video/ogg", "video/quicktime", "video/webm"] });
    if (selected?.[0] && operations.isLatest(generation)) await load(selected[0], generation);
  } catch (error) {
    if (operations.isLatest(generation)) showPreviewError(error, "Could not open the file.");
  }
}

async function load(handle: FileHandle, generation = operations.begin(), relativeHandle: FileHandle | FolderHandle = handle) {
  opening = true;
  publishCommands();
  renderOperations.invalidate();
  linkOperations.invalidate();
  setAppLoading(content, viewer, loading, "Opening file...");
  try {
    const entry = await hiraya.files.stat(handle);
    if (!operations.isLatest(generation)) return;
    if (entry.kind !== "file") throw new Error("The selected item is not a file.");
    const { mimeType: sourceMime, name, size } = entry.metadata;
    setAppLoading(content, viewer, loading, `Opening ${name}...`);
    const mimeType = normalizedMime(sourceMime);
    const markdown = isMarkdownDocument(name, mimeType);
    const documentKind = parsedDocumentKind(name, mimeType);
    if (!(markdown || documentKind || mimeType === "application/pdf" || mimeType.startsWith("audio/") || mimeType.startsWith("video/"))) throw new Error("This viewer supports Markdown, DOCX, RTF, PDF, audio, and video files.");
    if ((markdown || documentKind) && size > MAX_PARSED_DOCUMENT_BYTES) throw new Error(`This document is too large to preview safely. The preview limit is ${formatBytes(MAX_PARSED_DOCUMENT_BYTES)}.`);

    status.classList.remove("error");
    status.textContent = `Opening ${name}...`;
    const mediaPreview = mimeType.startsWith("audio/") || mimeType.startsWith("video/")
      ? await hiraya.host.getFilePreviewSource(handle)
      : null;
    const data = mediaPreview ? null : (await hiraya.files.readAll(handle)).data;
    if (!operations.isLatest(generation)) return;

    let element: HTMLElement | null = null;
    let markdownSource: string | null = null;
    let nextUrl: string | null = null;
    if (markdown) {
      markdownSource = new TextDecoder().decode(data!);
    } else if (documentKind) {
      element = await renderParsedDocument(documentKind, data!);
    } else {
      if (mimeType === "application/pdf") {
        nextUrl = URL.createObjectURL(new Blob([data!], { type: mimeType }));
        const frame = document.createElement("iframe");
        frame.src = nextUrl;
        frame.title = name;
        frame.setAttribute("sandbox", "allow-same-origin");
        frame.referrerPolicy = "no-referrer";
        element = frame;
      } else {
        const media = document.createElement(mimeType.startsWith("audio/") ? "audio" : "video");
        media.controls = true;
        if (mediaPreview!.kind === "blob") {
          nextUrl = URL.createObjectURL(mediaPreview!.blob);
          media.src = nextUrl;
        } else {
          media.src = mediaPreview!.url;
        }
        media.preload = "metadata";
        if (media instanceof HTMLVideoElement) media.playsInline = true;
        media.addEventListener("canplay", () => { previewRefreshAttempted = false; });
        media.addEventListener("error", () => void recoverExpiredPreview(media));
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
    if (nextUrl) objectUrls.push(nextUrl);
    if (mediaPreview) {
      previewHandle = handle;
      previewExpiresAt = mediaPreview.kind === "url" ? mediaPreview.expiresAt : 0;
      previewGeneration = generation;
    }
    if (markdownSource !== null) {
      currentMarkdown = { source: markdownSource, relativeHandle };
      await renderMarkdownDocument(renderOperations.begin());
      if (!operations.isLatest(generation)) return;
    } else viewer.replaceChildren(element!);
    status.textContent = `${mimeType} · ${formatBytes(size)}`;
    await hiraya.window.setTitle(`${name} - Document & Media Viewer`);
  } finally {
    if (operations.isLatest(generation)) { opening = false; setAppLoading(content, viewer, loading); publishCommands(); }
  }
}

async function toggleFullscreen() {
  try {
    const state = await hiraya.window.setFullscreen(!fullscreen);
    fullscreen = state.fullscreen;
    publishCommands();
  } catch (error) {
    setStatusError(error, "Could not change fullscreen mode.");
  }
}

function clear() {
  renderOperations.invalidate();
  linkOperations.invalidate();
  revokeObjectUrls();
  currentMarkdown = null;
  previewHandle = null;
  previewExpiresAt = 0;
  previewGeneration = 0;
  refreshingPreview = false;
  previewRefreshAttempted = false;
  viewer.querySelectorAll("audio,video").forEach((item) => {
    const media = item as HTMLMediaElement;
    media.pause();
    media.removeAttribute("src");
    media.load();
  });
}

async function recoverExpiredPreview(media: HTMLMediaElement) {
  if (!previewHandle || refreshingPreview || !operations.isLatest(previewGeneration)) return;
  if (!previewExpiresAt || previewRefreshAttempted) {
    setStatusError(new Error("The browser could not play this media."), "The browser could not play this media.");
    return;
  }
  previewRefreshAttempted = true;
  refreshingPreview = true;
  const handle = previewHandle;
  const generation = previewGeneration;
  const currentTime = media.currentTime;
  const wasPlaying = !media.paused;
  try {
    const source = await hiraya.host.getFilePreviewSource(handle);
    if (!operations.isLatest(generation) || previewHandle !== handle) return;
    revokeObjectUrls();
    const objectUrl = source.kind === "blob" ? URL.createObjectURL(source.blob) : null;
    if (objectUrl) objectUrls.push(objectUrl);
    previewExpiresAt = source.kind === "url" ? source.expiresAt : 0;
    media.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(currentTime)) media.currentTime = Math.min(currentTime, media.duration || currentTime);
      if (wasPlaying) void media.play().catch(() => undefined);
    }, { once: true });
    media.src = source.kind === "blob" ? objectUrl! : source.url;
    media.load();
  } catch (error) {
    if (operations.isLatest(generation)) setStatusError(error, "The media preview could not be refreshed.");
  } finally {
    if (previewHandle === handle) refreshingPreview = false;
  }
}

async function renderMarkdownDocument(generation: number) {
  if (!currentMarkdown || !renderOperations.isLatest(generation)) return;
  revokeObjectUrls();
  const article = renderMarkdown(currentMarkdown.source);
  viewer.replaceChildren(article);
  await loadRelativeContent(article, currentMarkdown.relativeHandle, generation);
  if (renderOperations.isLatest(generation)) renderExternalContent(article);
}

async function loadRelativeContent(article: HTMLElement, handle: FileHandle | FolderHandle, generation: number) {
  const readRelative = relativeReader(hiraya);
  await Promise.all(Array.from(article.querySelectorAll<HTMLImageElement>("img[data-relative-src]")).map(async (image) => {
    try {
      const result = await readRelative(handle, image.dataset.relativeSrc ?? "");
      if (!renderOperations.isLatest(generation)) return;
      const url = URL.createObjectURL(new Blob([result.data], { type: result.mimeType }));
      if (!renderOperations.isLatest(generation)) { URL.revokeObjectURL(url); return; }
      objectUrls.push(url);
      image.src = url;
    } catch {
      if (renderOperations.isLatest(generation)) image.replaceWith(document.createTextNode(`[Image unavailable: ${image.alt}]`));
    }
  }));
  for (const link of Array.from(article.querySelectorAll<HTMLAnchorElement>("a[data-relative-href]"))) link.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    const path = link.dataset.relativeHref;
    if (!path) return;
    const linkGeneration = linkOperations.begin();
    void hiraya.files.resolve(handle, path).then((entry) => linkOperations.isLatest(linkGeneration) ? hiraya.host.openEntry(entry.metadata.handle) : undefined).catch((error) => {
      if (linkOperations.isLatest(linkGeneration)) setStatusError(error, "Could not open the linked file.");
    });
  });
}

function renderExternalContent(article: HTMLElement) {
  for (const image of Array.from(article.querySelectorAll<HTMLImageElement>("img[data-external-src]"))) {
    const source = image.dataset.externalSrc ?? "";
    if (externalEmbeddedPreviews) { image.src = source; continue; }
    let host = "external site";
    try { host = new URL(source).host; } catch { /* The renderer accepts only absolute HTTP URLs. */ }
    const placeholder = document.createElement("hiraya-notice");
    placeholder.className = "external-embed";
    placeholder.setAttribute("tone", "accent");
    placeholder.setAttribute("role", "group");
    placeholder.setAttribute("aria-label", `External image from ${host} blocked`);
    const copy = document.createElement("strong");
    copy.slot = "title";
    copy.textContent = `External image blocked from ${host}`;
    const once = document.createElement("hiraya-button");
    once.slot = "actions";
    once.textContent = "Load once";
    once.addEventListener("click", () => { image.src = source; placeholder.replaceWith(image); });
    const always = document.createElement("hiraya-button");
    always.slot = "actions";
    always.textContent = "Always load";
    always.addEventListener("click", () => void hiraya.host.setExternalEmbeddedPreviews(true).catch((error) => setStatusError(error, "Could not save the external content preference.")));
    placeholder.append(copy, once, always);
    image.replaceWith(placeholder);
  }
}

function revokeObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

function setStatusError(error: unknown, fallback: string) {
  status.textContent = describeError(error, fallback);
  status.classList.add("error");
}

function showPreviewError(error: unknown, fallback: string) {
  opening = false;
  setAppLoading(content, viewer, loading);
  clear();
  const message = describeError(error, fallback);
  const empty = document.createElement("hiraya-empty-state");
  const title = document.createElement("strong");
  title.slot = "title";
  title.textContent = "Preview unavailable";
  empty.append(title, document.createTextNode(message));
  viewer.replaceChildren(empty);
  setStatusError(error, fallback);
  publishCommands();
}

function publishCommands() {
  void hiraya?.commands.set([
    { id: "open", title: "Open", enabled: ready && !opening, promoted: true },
    { id: "fullscreen", title: fullscreen ? "Exit Fullscreen" : "Fullscreen", enabled: ready, promoted: true },
  ]);
}

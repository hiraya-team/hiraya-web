import type { FileHandle, HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, formatBytes, LatestOperation, required } from "@hiraya/system-apps-shared";
import "./style.css";
type HirayaButton = HTMLElement & { disabled: boolean };
const APP_ID = "app.hiraya.media-viewer"; const viewer = required<HTMLElement>("#viewer"); const status = required<HTMLElement>("#status"); const openButton = required<HirayaButton>("#open"); const fullscreenButton = required<HirayaButton>("#fullscreen"); const operations = new LatestOperation(); let hiraya: HirayaClient; let url: string | null = null;
openButton.addEventListener("click", () => void open()); fullscreenButton.addEventListener("click", () => void toggleFullscreen()); addEventListener("pagehide", () => { operations.invalidate(); clear(); }, { once: true }); void start();
async function start() { try { const app = await connectSystemApp(APP_ID); hiraya = app.hiraya; openButton.disabled = false; fullscreenButton.disabled = false; if (app.launch.files[0]) await load(app.launch.files[0]); else status.textContent = "Ready."; } catch (error) { fail(error, "Viewer could not start."); } }
async function open() { const generation = operations.begin(); try { const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: ["application/pdf", "audio/aac", "audio/flac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "video/mp4", "video/ogg", "video/quicktime", "video/webm"] }); if (selected?.[0] && operations.isLatest(generation)) await load(selected[0], generation); } catch (error) { if (operations.isLatest(generation)) fail(error, "Could not open the file."); } }
async function load(handle: FileHandle, generation = operations.begin()) {
  const entry = await hiraya.files.stat(handle); if (!operations.isLatest(generation)) return; if (entry.kind !== "file") throw new Error("The selected item is not a file."); const { mimeType, name, size } = entry.metadata;
  if (!(mimeType === "application/pdf" || mimeType.startsWith("audio/") || mimeType.startsWith("video/"))) throw new Error("This viewer supports PDF, audio, and video files.");
  const { data } = await hiraya.files.readAll(handle); if (!operations.isLatest(generation)) return; const nextUrl = URL.createObjectURL(new Blob([data], { type: mimeType })); let element: HTMLElement;
  if (mimeType === "application/pdf") { const object = document.createElement("object"); object.data = nextUrl; object.type = mimeType; object.append(document.createTextNode("This browser cannot display the PDF.")); element = object; }
  else { const media = document.createElement(mimeType.startsWith("audio/") ? "audio" : "video"); media.controls = true; media.src = nextUrl; media.preload = "metadata"; if (media instanceof HTMLVideoElement) media.playsInline = true; const card = document.createElement("div"); card.className = mimeType.startsWith("audio/") ? "media-card" : ""; card.append(media); element = card; }
  if (!operations.isLatest(generation)) { URL.revokeObjectURL(nextUrl); return; } clear(); url = nextUrl;
  viewer.replaceChildren(element); required("#title").textContent = name; status.textContent = `${mimeType} · ${formatBytes(size)}`; await hiraya.window.setTitle(`${name} - Document & Media Viewer`);
}
async function toggleFullscreen() { try { const state = await hiraya.window.getState(); await hiraya.window.setFullscreen(!state.fullscreen); } catch (error) { fail(error, "Could not change fullscreen mode."); } }
function clear() { if (url) URL.revokeObjectURL(url); url = null; viewer.querySelectorAll("audio,video").forEach((item) => { const media = item as HTMLMediaElement; media.pause(); media.removeAttribute("src"); media.load(); }); }
function fail(error: unknown, fallback: string) { status.textContent = describeError(error, fallback); status.classList.add("error"); }

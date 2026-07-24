import type { FileHandle, HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, formatBytes, readFileData, required } from "@hiraya/system-apps-shared";
import "./style.css";
const APP_ID = "app.hiraya.media-viewer"; const viewer = required<HTMLElement>("#viewer"); const status = required<HTMLElement>("#status"); let hiraya: HirayaClient; let url: string | null = null;
required("#open").addEventListener("click", () => void open()); required("#fullscreen").addEventListener("click", () => void toggleFullscreen()); addEventListener("pagehide", clear, { once: true }); void start();
async function start() { try { const app = await connectSystemApp(APP_ID); hiraya = app.hiraya; if (app.launch.files[0]) await load(app.launch.files[0]); else status.textContent = "Ready."; } catch (error) { fail(error, "Viewer could not start."); } }
async function open() { try { const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: ["application/pdf", "audio/aac", "audio/flac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "video/mp4", "video/ogg", "video/quicktime", "video/webm"] }); if (selected?.[0]) await load(selected[0]); } catch (error) { fail(error, "Could not open the file."); } }
async function load(handle: FileHandle) {
  const entry = await hiraya.files.stat(handle); if (entry.kind !== "file") throw new Error("The selected item is not a file."); const { mimeType, name, size } = entry.metadata;
  if (!(mimeType === "application/pdf" || mimeType.startsWith("audio/") || mimeType.startsWith("video/"))) throw new Error("This viewer supports PDF, audio, and video files.");
  const data = await readFileData(hiraya, handle, size); clear(); url = URL.createObjectURL(new Blob([data], { type: mimeType })); let element: HTMLElement;
  if (mimeType === "application/pdf") { const object = document.createElement("object"); object.data = url; object.type = mimeType; object.append(document.createTextNode("This browser cannot display the PDF.")); element = object; }
  else { const media = document.createElement(mimeType.startsWith("audio/") ? "audio" : "video"); media.controls = true; media.src = url; media.preload = "metadata"; if (media instanceof HTMLVideoElement) media.playsInline = true; const card = document.createElement("div"); card.className = mimeType.startsWith("audio/") ? "media-card" : ""; card.append(media); element = card; }
  viewer.replaceChildren(element); required("#title").textContent = name; status.textContent = `${mimeType} · ${formatBytes(size)}`; await hiraya.window.setTitle(`${name} - Document & Media Viewer`);
}
async function toggleFullscreen() { try { const state = await hiraya.window.getState(); await hiraya.window.setFullscreen(!state.fullscreen); } catch (error) { fail(error, "Could not change fullscreen mode."); } }
function clear() { if (url) URL.revokeObjectURL(url); url = null; viewer.querySelectorAll("audio,video").forEach((item) => { const media = item as HTMLMediaElement; media.pause(); media.removeAttribute("src"); media.load(); }); }
function fail(error: unknown, fallback: string) { status.textContent = describeError(error, fallback); status.classList.add("error"); }

import type { FileHandle, HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, formatBytes, LatestOperation, readFileData, required } from "@hiraya/system-apps-shared";
import "./style.css";

const APP_ID = "app.hiraya.image-viewer";
const stage = required<HTMLElement>("#stage"); const status = required<HTMLElement>("#status"); const zoomOutput = required<HTMLOutputElement>("#zoom"); const openButton = required<HTMLButtonElement>("#open"); const operations = new LatestOperation();
let hiraya: HirayaClient; let image: HTMLImageElement | null = null; let url: string | null = null; let scale = 1; let rotation = 0;
openButton.addEventListener("click", () => void open()); required("#minus").addEventListener("click", () => setScale(scale / 1.25)); required("#plus").addEventListener("click", () => setScale(scale * 1.25)); required("#fit").addEventListener("click", fit); required("#rotate").addEventListener("click", () => { rotation = (rotation + 90) % 360; render(); });
addEventListener("pagehide", () => { operations.invalidate(); clearUrl(); }, { once: true }); void start();
async function start() { try { const app = await connectSystemApp(APP_ID); hiraya = app.hiraya; openButton.disabled = false; if (app.launch.files[0]) await load(app.launch.files[0]); else status.textContent = "Ready."; } catch (error) { fail(error, "Image Viewer could not start."); } }
async function open() { const generation = operations.begin(); try { const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: ["image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png", "image/svg+xml", "image/webp", "image/x-icon"] }); if (selected?.[0] && operations.isLatest(generation)) await load(selected[0], generation); } catch (error) { if (operations.isLatest(generation)) fail(error, "Could not open the image."); } }
async function load(handle: FileHandle, generation = operations.begin()) {
  const entry = await hiraya.files.stat(handle); if (!operations.isLatest(generation)) return; if (entry.kind !== "file") throw new Error("The selected item is not a file.");
  const data = await readFileData(hiraya, handle, entry.metadata.size); if (!operations.isLatest(generation)) return; const nextUrl = URL.createObjectURL(new Blob([data], { type: entry.metadata.mimeType }));
  const next = new Image(); next.alt = entry.metadata.name; next.src = nextUrl; try { await next.decode(); } catch (error) { URL.revokeObjectURL(nextUrl); throw error; } if (!operations.isLatest(generation)) { URL.revokeObjectURL(nextUrl); return; } clearUrl(); url = nextUrl; image = next; stage.replaceChildren(next); scale = 1; rotation = 0; fit();
  required("#title").textContent = entry.metadata.name; status.textContent = `${next.naturalWidth} × ${next.naturalHeight} · ${formatBytes(entry.metadata.size)}`; await hiraya.window.setTitle(`${entry.metadata.name} - Image Viewer`);
}
function fit() { if (!image) return; const rotated = rotation % 180 !== 0; const width = rotated ? image.naturalHeight : image.naturalWidth; const height = rotated ? image.naturalWidth : image.naturalHeight; setScale(Math.min(1, (stage.clientWidth - 64) / width, (stage.clientHeight - 64) / height)); }
function setScale(next: number) { scale = Math.max(.1, Math.min(8, next)); render(); }
function render() { if (!image) return; image.style.width = `${image.naturalWidth * scale}px`; image.style.height = `${image.naturalHeight * scale}px`; image.style.setProperty("--rotation", `${rotation}deg`); zoomOutput.value = `${Math.round(scale * 100)}%`; }
function clearUrl() { if (url) URL.revokeObjectURL(url); url = null; }
function fail(error: unknown, fallback: string) { status.textContent = describeError(error, fallback); status.classList.add("error"); }

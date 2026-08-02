import type { FileHandle, HirayaClient } from "@hiraya/apps-sdk";
import { connectSystemApp, describeError, formatBytes, LatestOperation, required, setAppLoading } from "@hiraya/system-apps-shared";
import "./style.css";

type HirayaButton = HTMLElement & { disabled: boolean };
type HirayaImageViewer = HTMLElement & { alt: string; rotation: number; src: string; fit(): void; rotateBy(degrees: number): void; zoomBy(delta: number): void };

const APP_ID = "app.hiraya.image-viewer";
const viewer = required<HirayaImageViewer>("#viewer"); const empty = required<HTMLElement>("#empty"); const status = required<HTMLElement>("#status"); const zoomOutput = required<HTMLOutputElement>("#zoom"); const openButton = required<HirayaButton>("#open"); const operations = new LatestOperation(); const stage = required<HTMLElement>("#stage"); const imageContent = required<HTMLElement>("#image-content"); const loading = required<HTMLElement>("#loading");
let hiraya: HirayaClient; let url: string | null = null; let hasImage = false; let opening = true;
openButton.addEventListener("click", () => void open()); required("#minus").addEventListener("click", () => viewer.zoomBy(-.25)); required("#plus").addEventListener("click", () => viewer.zoomBy(.25)); required("#fit").addEventListener("click", () => viewer.fit()); required("#rotate").addEventListener("click", () => viewer.rotateBy(90));
viewer.addEventListener("hiraya-zoom-change", (event) => { const { zoom } = (event as CustomEvent<{ zoom: number }>).detail; zoomOutput.value = `${Math.round(zoom * 100)}%`; });
addEventListener("pagehide", () => { operations.invalidate(); clearUrl(); }, { once: true }); void start();
async function start() { try { const app = await connectSystemApp(APP_ID); hiraya = app.hiraya; openButton.disabled = false; if (app.launch.files[0]) await load(app.launch.files[0]); else { opening = false; setAppLoading(stage, imageContent, loading); renderViewerControls(); status.textContent = "Ready."; } } catch (error) { opening = false; setAppLoading(stage, imageContent, loading); renderViewerControls(); fail(error, "Image Viewer could not start."); } }
async function open() { const generation = operations.begin(); try { const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: ["image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png", "image/svg+xml", "image/webp", "image/x-icon"] }); if (selected?.[0] && operations.isLatest(generation)) await load(selected[0], generation); } catch (error) { if (operations.isLatest(generation)) fail(error, "Could not open the image."); } }
async function load(handle: FileHandle, generation = operations.begin()) {
  opening = true; setAppLoading(stage, imageContent, loading, "Opening file..."); renderViewerControls();
  try {
    const entry = await hiraya.files.stat(handle); if (!operations.isLatest(generation)) return; if (entry.kind !== "file") throw new Error("The selected item is not a file.");
    setAppLoading(stage, imageContent, loading, `Opening ${entry.metadata.name}...`);
    const { data } = await hiraya.files.readAll(handle); if (!operations.isLatest(generation)) return; const nextUrl = URL.createObjectURL(new Blob([data], { type: entry.metadata.mimeType }));
    const next = new Image(); next.src = nextUrl; try { await next.decode(); } catch (error) { URL.revokeObjectURL(nextUrl); throw error; } if (!operations.isLatest(generation)) { URL.revokeObjectURL(nextUrl); return; } clearUrl(); url = nextUrl; viewer.alt = entry.metadata.name; viewer.rotation = 0; viewer.src = nextUrl; viewer.hidden = false; empty.hidden = true; viewer.fit(); hasImage = true;
    required("#title").textContent = entry.metadata.name; status.textContent = `${next.naturalWidth} × ${next.naturalHeight} · ${formatBytes(entry.metadata.size)}`; await hiraya.window.setTitle(`${entry.metadata.name} - Image Viewer`);
  } finally {
    if (operations.isLatest(generation)) { opening = false; setAppLoading(stage, imageContent, loading); renderViewerControls(); }
  }
}
function renderViewerControls() { for (const id of ["minus", "plus", "fit", "rotate"]) required<HirayaButton>(`#${id}`).disabled = opening || !hasImage; }
function clearUrl() { if (url) URL.revokeObjectURL(url); url = null; }
function fail(error: unknown, fallback: string) { status.textContent = describeError(error, fallback); status.classList.add("error"); }

import type { FileHandle, HirayaClient } from "@hiraya-team/apps-sdk";
import { connectSystemApp, describeError, formatBytes, LatestOperation, required, setAppLoading } from "@hiraya/system-apps-shared";
import "./style.css";

type HirayaButton = HTMLElement & { disabled: boolean };
type HirayaImageViewer = HTMLElement & { alt: string; rotation: number; src: string; fit(): void; rotateBy(degrees: number): void; zoomBy(delta: number): void };

/** Identifies the Image Viewer system app. */
const APP_ID = "app.hiraya.image-viewer";
/** References the viewer interface element. */
const viewer = required<HirayaImageViewer>("#viewer");
/** References the empty-state interface element. */
const empty = required<HTMLElement>("#empty");
/** References the status interface element. */
const status = required<HTMLElement>("#status");
/** References the zoom output interface element. */
const zoomOutput = required<HTMLOutputElement>("#zoom");
/** Coordinates the latest image operation. */
const operations = new LatestOperation();
/** References the image stage interface element. */
const stage = required<HTMLElement>("#stage");
/** References the loaded-image interface element. */
const imageContent = required<HTMLElement>("#image-content");
/** References the loading interface element. */
const loading = required<HTMLElement>("#loading");
let hiraya: HirayaClient; let url: string | null = null; let hasImage = false; let opening = true; let ready = false;
required("#minus").addEventListener("click", () => viewer.zoomBy(-.25)); required("#plus").addEventListener("click", () => viewer.zoomBy(.25)); required("#fit").addEventListener("click", () => viewer.fit()); required("#rotate").addEventListener("click", () => viewer.rotateBy(90));
viewer.addEventListener("hiraya-zoom-change", (event) => { const { zoom } = (event as CustomEvent<{ zoom: number }>).detail; zoomOutput.value = `${Math.round(zoom * 100)}%`; });
addEventListener("pagehide", () => { operations.invalidate(); clearUrl(); }, { once: true }); void start();
/** Starts the application. */
async function start() { try { const app = await connectSystemApp(APP_ID); hiraya = app.hiraya; ready = true; hiraya.on("commands.invoked", ({ id }) => { if (id === "open") void open(); }); if (app.launch.files[0]) await load(app.launch.files[0]); else { opening = false; setAppLoading(stage, imageContent, loading); renderViewerControls(); status.textContent = "Ready."; } } catch (error) { opening = false; setAppLoading(stage, imageContent, loading); renderViewerControls(); fail(error, "Image Viewer could not start."); } }
/** Opens the image supplied in the launch context. */
async function open() { const generation = operations.begin(); try { const selected = await hiraya.dialogs.openFile({ multiple: false, mimeTypes: ["image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png", "image/svg+xml", "image/webp", "image/x-icon"] }); if (selected?.[0] && operations.isLatest(generation)) await load(selected[0], generation); } catch (error) { if (operations.isLatest(generation)) fail(error, "Could not open the image."); } }
/** Loads the selected image into the viewer. */
async function load(handle: FileHandle, generation = operations.begin()) {
  opening = true; setAppLoading(stage, imageContent, loading, "Opening file..."); renderViewerControls();
  try {
    const entry = await hiraya.files.stat(handle); if (!operations.isLatest(generation)) return; if (entry.kind !== "file") throw new Error("The selected item is not a file.");
    setAppLoading(stage, imageContent, loading, `Opening ${entry.metadata.name}...`);
    const { data } = await hiraya.files.readAll(handle); if (!operations.isLatest(generation)) return; const nextUrl = URL.createObjectURL(new Blob([data], { type: entry.metadata.mimeType }));
    const next = new Image(); next.src = nextUrl; try { await next.decode(); } catch (error) { URL.revokeObjectURL(nextUrl); throw error; } if (!operations.isLatest(generation)) { URL.revokeObjectURL(nextUrl); return; } clearUrl(); url = nextUrl; viewer.alt = entry.metadata.name; viewer.rotation = 0; viewer.src = nextUrl; viewer.hidden = false; empty.hidden = true; viewer.fit(); hasImage = true;
    status.textContent = `${next.naturalWidth} × ${next.naturalHeight} · ${formatBytes(entry.metadata.size)}`; await hiraya.window.setTitle(`${entry.metadata.name} - Image Viewer`);
  } finally {
    if (operations.isLatest(generation)) { opening = false; setAppLoading(stage, imageContent, loading); renderViewerControls(); }
  }
}
/** Renders viewer controls. */
function renderViewerControls() { for (const id of ["minus", "plus", "fit", "rotate"]) required<HirayaButton>(`#${id}`).disabled = opening || !hasImage; void hiraya?.commands.set([{ id: "open", title: "Open", enabled: ready && !opening, promoted: true }]); }
/** Revokes and clears the current image URL. */
function clearUrl() { if (url) URL.revokeObjectURL(url); url = null; }
/** Displays an image loading failure. */
function fail(error: unknown, fallback: string) { status.textContent = describeError(error, fallback); status.classList.add("error"); }

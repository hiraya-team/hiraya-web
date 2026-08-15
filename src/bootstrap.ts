import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import { Shell, type WorkerStatus } from "./shell/Shell";
import "./styles.css";

function unsupportedCapabilities() {
  const missing: string[] = [];
  if (!("indexedDB" in globalThis)) missing.push("IndexedDB");
  if (!("storage" in navigator) || typeof navigator.storage.getDirectory !== "function") missing.push("origin-private file storage");
  if (!("locks" in navigator)) missing.push("Web Locks");
  if (!("serviceWorker" in navigator)) missing.push("service workers");
  if (!("caches" in globalThis)) missing.push("Cache Storage");
  if (!globalThis.crypto?.subtle) missing.push("Web Crypto");
  return missing;
}

function requestActivation(worker: ServiceWorker | null) {
  worker?.postMessage({ type: "ACTIVATE" });
}

async function registerWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("Service workers are unavailable.");
  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
  await registration.update();
  if (registration.installing) await new Promise<void>((resolve, reject) => {
    const installing = registration.installing!;
    if (installing.state === "installed") { resolve(); return; }
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") resolve();
      else if (installing.state === "redundant") reject(new Error("Service worker installation was discarded."));
    });
  });
  requestActivation(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    installing?.addEventListener("statechange", () => {
      if (installing.state === "installed") requestActivation(registration.waiting);
    });
  });
  await navigator.serviceWorker.ready;
}

const root = document.getElementById("root");
if (!root) throw new Error("Hiraya shell root is missing.");
const unsupported = unsupportedCapabilities();
const [workerStatus, setWorkerStatus] = createSignal<WorkerStatus>(unsupported.length ? "failed" : "installing");
render(() => Shell({ unsupported, workerStatus }), root);
if (!unsupported.length) void registerWorker().then(() => setWorkerStatus("ready")).catch((error: unknown) => {
  setWorkerStatus("failed");
  console.error("Service worker registration failed.", error);
});

/// <reference lib="webworker" />

/** References the service worker global scope. */
const worker = self as unknown as ServiceWorkerGlobalScope;
/** Names caches owned by the Hiraya application shell. */
const CACHE_PREFIX = "hiraya-shell-";
/** Identifies the shell cache for the current build. */
const CACHE_NAME = `${CACHE_PREFIX}__HIRAYA_CACHE_VERSION__`;
/** Lists shell resources injected into the build-time precache. */
const PRECACHE = ["/__HIRAYA_PRECACHE__"];
/** Identifies the cached shell response used for offline navigation. */
const NAVIGATION_FALLBACK = import.meta.env.BASE_URL;
/** Matches immutable, content-hashed build assets. */
const HASHED_ASSET = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;
let offlineForTest = false;

/** Broadcasts a service-worker message to open window clients. */
async function notifyClients(message: unknown) {
  for (const client of await worker.clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage(message);
}

/** Retires stale shell caches and claims open clients. */
async function activateShell() {
  for (const key of await caches.keys()) {
    if (key === CACHE_NAME) continue;
    const retiredShell = key.startsWith(CACHE_PREFIX) || Boolean(await (await caches.open(key)).match(`${import.meta.env.BASE_URL}manifest.webmanifest`, { ignoreSearch: true }));
    if (retiredShell) await caches.delete(key);
  }
  await worker.clients.claim();
}

worker.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => worker.registration.active ? notifyClients({ type: "HIRAYA_UPDATE_READY" }) : undefined));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(activateShell());
});

worker.addEventListener("message", (event) => {
  if (event.data?.type === "HIRAYA_ACTIVATE") void worker.skipWaiting();
  if (import.meta.env.HIRAYA_FRONTEND_ONLY === "true" && event.data?.type === "HIRAYA_E2E_UPDATE_READY") {
    event.source?.postMessage({ type: "HIRAYA_UPDATE_READY", simulated: true });
  }
  if (import.meta.env.HIRAYA_FRONTEND_ONLY === "true" && event.data?.type === "HIRAYA_E2E_ACTIVATE") {
    event.waitUntil(activateShell().then(() => notifyClients({ type: "HIRAYA_UPDATE_ACTIVATED", simulated: true })));
  }
  if (import.meta.env.HIRAYA_FRONTEND_ONLY === "true" && event.data?.type === "HIRAYA_E2E_OFFLINE") {
    offlineForTest = true;
    event.source?.postMessage({ type: "HIRAYA_E2E_OFFLINE_READY" });
  }
});

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        if (offlineForTest) throw new TypeError("Simulated offline network.");
        const response = await fetch(request);
        if (response.ok) return response;
      } catch { /* Use the complete cached shell below. */ }
      return (await caches.match(NAVIGATION_FALLBACK)) ?? Response.error();
    })());
    return;
  }
  if (request.method !== "GET" || !HASHED_ASSET.test(url.pathname)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    if (offlineForTest) return Response.error();
    const response = await fetch(request);
    if (response.ok) await (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  })());
});

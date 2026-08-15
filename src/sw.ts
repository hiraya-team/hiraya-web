/// <reference lib="webworker" />

import { requestPolicy } from "./sw-policy";

declare const __HIRAYA_BASE_PATH__: string;
declare const __HIRAYA_CACHE_PREFIX__: string;
declare const __HIRAYA_CACHE_NAME__: string;
declare const __HIRAYA_PRECACHE__: readonly string[];

const worker = self as unknown as ServiceWorkerGlobalScope;
const fallback = `${__HIRAYA_BASE_PATH__}index.html`;
const origin = new URL(worker.registration.scope).origin;

async function cached(path: string) {
  return await (await caches.open(__HIRAYA_CACHE_NAME__)).match(path, { ignoreVary: true });
}

worker.addEventListener("install", (event) => {
  event.waitUntil(caches.open(__HIRAYA_CACHE_NAME__).then((cache) => cache.addAll(__HIRAYA_PRECACHE__)));
});

worker.addEventListener("message", (event) => {
  if ((event.data as { type?: unknown } | null)?.type === "ACTIVATE") void worker.skipWaiting();
});

worker.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => name !== __HIRAYA_CACHE_NAME__ && (name.startsWith(__HIRAYA_CACHE_PREFIX__) || name.startsWith("workbox-precache") && name.includes(worker.registration.scope)) ? caches.delete(name) : false));
    await worker.clients.claim();
  })());
});

worker.addEventListener("fetch", (event) => {
  const policy = requestPolicy(event.request.url, event.request.mode, origin, __HIRAYA_BASE_PATH__);
  if (policy === "network-only") {
    event.respondWith(fetch(event.request));
    return;
  }
  if (policy === "cache-first") {
    event.respondWith(cached(new URL(event.request.url).pathname).then((response) => response ?? fetch(event.request)));
    return;
  }
  event.respondWith(fetch(event.request).catch(async () => await cached(fallback) ?? Response.error()));
});

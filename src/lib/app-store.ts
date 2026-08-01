import type { AppPackageInspection } from "@hiraya/apps-contracts";
import type { DesktopIdentity, FileEntry } from "../types";
import { API_ROUTES } from "./api-routes";
import { requireAuthenticatedResponse } from "./auth";
import { sha256Blob } from "./blob-transfer";
import { parseContentAccessDescriptor, parseRemoteDesktopState, type RemoteEntry } from "./contracts";

export type AppStoreDescriptor = Readonly<{ schemaVersion: 1; catalogId: string; catalogRevision: number; desktopId: string }>;
export type StorePackage = Readonly<{ entry: FileEntry; contentRevision: number; catalogId: string; desktopId: string }>;
export type InspectedStorePackage = Readonly<{ archive: Blob; inspection: AppPackageInspection }>;

function parseDescriptor(value: unknown): AppStoreDescriptor | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.catalogId !== "string" || typeof item.desktopId !== "string" || !Number.isSafeInteger(item.catalogRevision) || Number(item.catalogRevision) < 0) return null;
  return { schemaVersion: 1, catalogId: item.catalogId, catalogRevision: Number(item.catalogRevision), desktopId: item.desktopId };
}

export async function loadStorePackages(desktop: DesktopIdentity): Promise<StorePackage[]> {
  if (desktop.purpose !== "app-store" || !desktop.authorityCatalogId) return [];
  const response = requireAuthenticatedResponse(await fetch(API_ROUTES.desktop(desktop.id), { cache: "no-store", credentials: "same-origin" }));
  if (!response.ok) throw new Error(`The app store could not be loaded (${response.status}).`);
  const state = parseRemoteDesktopState(await response.json());
  if (state.id !== desktop.id || state.catalogId !== desktop.authorityCatalogId) throw new Error("The app store authority changed unexpectedly.");
  return state.entries
    .filter((entry): entry is RemoteEntry & FileEntry => entry.kind === "file" && entry.name.toLowerCase().endsWith(".hiraya.app"))
    .map((entry) => ({ entry, contentRevision: entry.contentRevision, catalogId: state.catalogId, desktopId: state.id }));
}

export async function inspectStorePackage(item: StorePackage): Promise<InspectedStorePackage> {
  const descriptorResponse = requireAuthenticatedResponse(await fetch(API_ROUTES.desktopContentAccess(item.desktopId, item.entry.id, item.contentRevision), { cache: "no-store", credentials: "same-origin" }));
  if (!descriptorResponse.ok) throw new Error(descriptorResponse.status === 404 ? "This app release is no longer available." : `The app release could not be loaded (${descriptorResponse.status}).`);
  const descriptor = parseContentAccessDescriptor(await descriptorResponse.json(), item.entry.id, item.contentRevision, item.entry.size);
  const response = await fetch(descriptor.access.url, {
    method: descriptor.access.method,
    headers: descriptor.access.headers,
    cache: "no-store",
    credentials: descriptor.access.url.startsWith("/") ? "same-origin" : "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`The app release could not be downloaded (${response.status}).`);
  const archive = await response.blob();
  if (archive.size !== descriptor.size || await sha256Blob(archive) !== descriptor.sha256) throw new Error("The app release failed integrity verification.");
  const { inspectAppArchive } = await import("@hiraya/app-cli");
  return { archive, inspection: await inspectAppArchive(new Uint8Array(await archive.arrayBuffer())) };
}

export function subscribeToAppStoreChanges(onChange: (descriptor: AppStoreDescriptor) => void) {
  let active = true;
  let current = "";
  let streamOpen = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let healthCheck: Promise<void> | null = null;
  const publish = (value: unknown) => {
    const descriptor = parseDescriptor(value);
    if (!active || !descriptor) return;
    const key = `${descriptor.catalogId}:${descriptor.catalogRevision}:${descriptor.desktopId}`;
    if (key === current) return;
    current = key;
    onChange(descriptor);
  };
  const schedulePoll = () => {
    if (!active || streamOpen) return;
    timer = globalThis.setTimeout(() => {
      timer = null;
      void poll();
    }, 5_000);
  };
  const poll = async () => {
    if (!active || streamOpen) return;
    if (healthCheck) return healthCheck;
    const check = (async () => {
      try {
        const response = requireAuthenticatedResponse(await fetch(API_ROUTES.syncHealth, { cache: "no-store", credentials: "same-origin" }));
        if (response.ok) publish((await response.json() as { appStore?: unknown }).appStore);
      } catch { /* The main connection UI reports connectivity failures. */ }
    })().finally(() => {
      if (healthCheck === check) healthCheck = null;
      schedulePoll();
    });
    healthCheck = check;
    return check;
  };
  let events: EventSource | null = null;
  try { if (typeof EventSource !== "undefined") events = new EventSource(API_ROUTES.events); } catch { events = null; }
  if (events) {
    events.onopen = () => {
      streamOpen = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
    };
    events.onerror = () => {
      streamOpen = false;
      void poll();
    };
    events.addEventListener("app-store", (event) => {
      try { publish(JSON.parse((event as MessageEvent<string>).data)); } catch { /* A reconnect or fallback probe will provide the current descriptor. */ }
    });
  } else {
    void poll();
  }
  return () => {
    active = false;
    events?.close();
    if (timer !== null) globalThis.clearTimeout(timer);
  };
}

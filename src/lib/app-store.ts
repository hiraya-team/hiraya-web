import { parseAppCatalog, type AppCatalogRelease, type AppPackageInspection } from "@hiraya-team/apps-contracts";
import type { InstalledApp } from "../apps/installed-apps";
import { RESERVED_SYSTEM_APP_IDS } from "../apps/system-app-ids";
import type { DesktopIdentity, FileEntry } from "../types";
import { API_ROUTES, authenticatedHeaders } from "./api-routes";
import { requireAuthenticatedResponse } from "./auth";
import { sha256Blob } from "./blob-transfer";
import { parseContentAccessDescriptor, parseRemoteDesktopState, type RemoteEntry } from "./contracts";

export type AppStoreDescriptor = Readonly<{ schemaVersion: 2; catalogId: string; catalogRevision: number; desktopId: string }>;
export type StorePackage = Readonly<{
  source: "remote";
  entry: FileEntry;
  contentRevision: number;
  catalogId: string;
  catalogRevision: number;
  desktopId: string;
  kind: "store" | "system";
  release?: AppCatalogRelease;
}>;

export function storeSearchMatches(query: string, ...values: Array<string | null | undefined>) {
  const searchable = values.filter(Boolean).join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every((term) => searchable.includes(term));
}
export type InspectedStorePackage = Readonly<{ archive: Blob; inspection: AppPackageInspection }>;
export type LoadedStorePackages = Readonly<{ packages: StorePackage[]; managed: boolean; descriptor: AppStoreDescriptor | null }>;

const SYSTEM_APP_ID_SET = RESERVED_SYSTEM_APP_IDS;
let cachedCatalog: { key: string; value: Promise<ReturnType<typeof parseAppCatalog>> } | null = null;

function parseDescriptor(value: unknown): AppStoreDescriptor | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 2 || typeof item.catalogId !== "string" || typeof item.desktopId !== "string" || !Number.isSafeInteger(item.catalogRevision) || Number(item.catalogRevision) < 0) return null;
  return { schemaVersion: 2, catalogId: item.catalogId, catalogRevision: Number(item.catalogRevision), desktopId: item.desktopId };
}

export function storePackageKey(item: StorePackage): string {
  return `${item.catalogId}:${item.catalogRevision}:${item.desktopId}:${item.entry.id}:${item.contentRevision}`;
}

export function storePackageManifest(item: StorePackage, inspection?: AppPackageInspection) {
  return item.release?.manifest ?? inspection?.manifest ?? null;
}

export function storePackageNeedsRefreshInspection(item: StorePackage, currentSystemRelease: boolean) {
  return !item.release || item.kind === "system" && !currentSystemRelease;
}

export function storePackageMatchesInstall(item: StorePackage, app: InstalledApp, appId: string | null, digest: string | null) {
  if (appId && digest) return app.appId === appId && app.digest === digest;
  return app.source === "store" && app.sourceCatalogId === item.catalogId && app.sourceDesktopId === item.desktopId && app.packageEntryId === item.entry.id && app.sourceContentRevision === item.contentRevision;
}

export async function loadStorePackages(desktop: DesktopIdentity, directBlobOrigin: string): Promise<LoadedStorePackages> {
  if (desktop.purpose !== "app-store" || !desktop.authorityCatalogId) return { packages: [], managed: false, descriptor: null };
  const response = requireAuthenticatedResponse(await fetch(API_ROUTES.desktopProjection(desktop.id), { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders() }));
  if (!response.ok) throw new Error(`The app store could not be loaded (${response.status}).`);
  const state = parseRemoteDesktopState(await response.json());
  if (state.id !== desktop.id || state.catalogId !== desktop.authorityCatalogId) throw new Error("The app store authority changed unexpectedly.");
  const descriptor = { schemaVersion: 2 as const, catalogId: state.catalogId, catalogRevision: state.catalogRevision, desktopId: state.id };
  const files = state.entries.filter((entry): entry is RemoteEntry & FileEntry => entry.kind === "file");
  const catalogEntry = files.find((entry) => entry.parentId === null && entry.name === "hiraya.apps.json");
  if (!catalogEntry) return { managed: false, descriptor, packages: files
    .filter((entry) => entry.name.toLowerCase().endsWith(".hiraya.app"))
    .map((entry) => ({ source: "remote", kind: "store", entry, contentRevision: entry.contentRevision, catalogId: state.catalogId, catalogRevision: state.catalogRevision, desktopId: state.id })) };
  const catalog = await loadAppCatalog(state.catalogId, state.id, catalogEntry, directBlobOrigin);
  if (catalog.releases.some((release) => release.kind === "system" && !SYSTEM_APP_ID_SET.has(release.manifest.id))) throw new Error("The app catalog contains an unsupported trusted system app.");
  return { managed: true, descriptor, packages: catalog.releases.map((release) => {
    const entry = files.find((entry) => entry.parentId === null && entry.name === release.fileName);
    if (!entry || entry.size !== release.size) throw new Error(`The app catalog release ${release.fileName} is unavailable.`);
    return { source: "remote" as const, kind: release.kind, release, entry, contentRevision: entry.contentRevision, catalogId: state.catalogId, catalogRevision: state.catalogRevision, desktopId: state.id };
  }) };
}

function loadAppCatalog(catalogId: string, desktopId: string, entry: RemoteEntry & FileEntry, directBlobOrigin: string) {
  const key = JSON.stringify([catalogId, desktopId, entry.id, entry.contentRevision, entry.size, directBlobOrigin]);
  if (cachedCatalog?.key === key) return cachedCatalog.value;
  const value = downloadRemoteEntry(desktopId, entry, directBlobOrigin)
    .then(async (content) => parseAppCatalog(JSON.parse(await content.text())));
  cachedCatalog = { key, value };
  void value.catch(() => { if (cachedCatalog?.value === value) cachedCatalog = null; });
  return value;
}

export async function appStoreDescriptorIsCurrent(expected: AppStoreDescriptor) {
  const response = requireAuthenticatedResponse(await fetch(API_ROUTES.syncHealth, { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders() }));
  if (!response.ok) throw new Error(`The app store could not be verified (${response.status}).`);
  const current = parseDescriptor((await response.json() as { appStore?: unknown }).appStore);
  return current?.catalogId === expected.catalogId && current.catalogRevision === expected.catalogRevision && current.desktopId === expected.desktopId;
}

async function downloadRemoteEntry(desktopId: string, entry: RemoteEntry & FileEntry, directBlobOrigin: string) {
  const descriptorResponse = requireAuthenticatedResponse(await fetch(API_ROUTES.desktopContent(desktopId, entry.id, entry.contentRevision), { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders() }));
  if (!descriptorResponse.ok) throw new Error(descriptorResponse.status === 404 ? "This app release is no longer available." : `The app release could not be loaded (${descriptorResponse.status}).`);
  const descriptor = parseContentAccessDescriptor(await descriptorResponse.json(), entry.id, entry.contentRevision, entry.size, directBlobOrigin);
  const response = await fetch(descriptor.access.url, {
    method: descriptor.access.method,
    headers: descriptor.access.headers,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`The app release could not be downloaded (${response.status}).`);
  const archive = await response.blob();
  if (archive.size !== descriptor.size || await sha256Blob(archive) !== descriptor.sha256) throw new Error("The app release failed integrity verification.");
  return archive;
}

export async function inspectStorePackage(item: StorePackage, directBlobOrigin: string): Promise<InspectedStorePackage> {
  const archive = await downloadRemoteEntry(item.desktopId, item.entry as RemoteEntry & FileEntry, directBlobOrigin);
  const { inspectAppArchive } = await import("@hiraya-team/app-cli");
  const inspection = await inspectAppArchive(new Uint8Array(await archive.arrayBuffer()));
  if (item.release && (inspection.digest !== item.release.digest || JSON.stringify(inspection.manifest) !== JSON.stringify(item.release.manifest))) throw new Error("The app release does not match the runtime catalog.");
  return { archive, inspection };
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
        const response = requireAuthenticatedResponse(await fetch(API_ROUTES.syncHealth, { cache: "no-store", credentials: "same-origin", headers: authenticatedHeaders() }));
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

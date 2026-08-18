import type { AppCatalogRelease, AppPackageInspection } from "@hiraya-team/apps-contracts";
import type { InstalledApp } from "../apps/installed-apps";
import type { DesktopIdentity, FileEntry } from "../types";

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

export async function loadStorePackages(_desktop: DesktopIdentity, _directBlobOrigin: string): Promise<LoadedStorePackages> {
  void _desktop; void _directBlobOrigin;
  return { packages: [], managed: false, descriptor: null };
}

export async function appStoreDescriptorIsCurrent(_expected: AppStoreDescriptor) {
  void _expected;
  return false;
}

export async function inspectStorePackage(_item: StorePackage, _directBlobOrigin: string): Promise<InspectedStorePackage> {
  void _item; void _directBlobOrigin;
  throw new Error("Administrator app-store workspaces are not part of the Web2 contract. Use account apps instead.");
}

export function subscribeToAppStoreChanges(_onChange: (descriptor: AppStoreDescriptor) => void) {
  void _onChange;
  return () => undefined;
}

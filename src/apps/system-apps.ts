import systemAppCatalog from "virtual:hiraya-system-apps";
import type { HirayaAppManifestV2 } from "@hiraya-team/apps-contracts";
import type { InstalledApp } from "./installed-apps";

export type SystemAppCatalogItem = Readonly<{
  slug: string;
  archivePath: string;
  digest: string;
  manifest: HirayaAppManifestV2;
}>;

export const SYSTEM_APP_CATALOG: readonly SystemAppCatalogItem[] = systemAppCatalog;

export function systemAppArchiveUrl(app: Pick<SystemAppCatalogItem, "archivePath">): string {
  return new URL(app.archivePath, new URL(import.meta.env.BASE_URL, window.location.origin)).href;
}

export function systemInstallFromCatalog(item: SystemAppCatalogItem, current?: Pick<InstalledApp, "approvedAt">): InstalledApp {
  return {
    appId: item.manifest.id,
    source: "system",
    packageEntryId: null,
    archivePath: item.archivePath,
    digest: item.digest,
    version: item.manifest.version,
    manifest: item.manifest,
    approvedAt: current?.approvedAt ?? Date.now(),
  };
}

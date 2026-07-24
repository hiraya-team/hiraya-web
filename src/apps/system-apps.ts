import systemAppCatalog from "virtual:hiraya-system-apps";
import type { HirayaAppManifestV1 } from "@hiraya/apps-contracts";

export type SystemAppCatalogItem = Readonly<{
  slug: string;
  archivePath: string;
  manifest: HirayaAppManifestV1;
}>;

export const SYSTEM_APP_CATALOG: readonly SystemAppCatalogItem[] = systemAppCatalog;

export function systemAppArchiveUrl(app: Pick<SystemAppCatalogItem, "archivePath">): string {
  return new URL(app.archivePath, new URL(import.meta.env.BASE_URL, window.location.origin)).href;
}

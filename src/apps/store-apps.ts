import storeAppCatalog from "virtual:hiraya-store-apps";
import type { HirayaAppManifestV2 } from "@hiraya/apps-contracts";

export type StoreAppCatalogItem = Readonly<{
  slug: string;
  archivePath: string;
  digest: string;
  size: number;
  contentRevision: number;
  manifest: HirayaAppManifestV2;
}>;

export const STORE_APP_CATALOG: readonly StoreAppCatalogItem[] = storeAppCatalog;

export function storeAppArchiveUrl(app: Pick<StoreAppCatalogItem, "archivePath">): string {
  return new URL(app.archivePath, new URL(import.meta.env.BASE_URL, window.location.origin)).href;
}

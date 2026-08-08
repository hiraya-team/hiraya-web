import type { InstalledApp } from "../../apps/installed-apps";
import { systemAppArchiveUrl } from "../../apps/system-apps";
import { readApprovedPackageArchive } from "../../platform/storage/blobs";

export function loadInstalledAppArchive(install: InstalledApp, readDesktopFile: (id: string) => Promise<Blob>): Promise<Blob> {
  if (install.source === "system") return readApprovedPackageArchive(install.digest).catch(() => fetch(systemAppArchiveUrl(install)).then((response) => {
    if (!response.ok) throw new Error(`${install.manifest.name} is unavailable. Reconnect and retry.`);
    return response.blob();
  }));
  if (install.source === "store" || install.source === "account") return readApprovedPackageArchive(install.digest);
  return readDesktopFile(install.packageEntryId);
}

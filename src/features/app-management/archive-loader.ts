import type { InstalledApp } from "../../apps/installed-apps";
import { systemAppArchiveUrl } from "../../apps/system-apps";
import { readApprovedPackageArchive, saveApprovedPackageArchive } from "../../platform/storage/package-archives";

export async function loadInstalledAppArchive(install: InstalledApp, readDesktopFile: (id: string) => Promise<Blob>): Promise<Blob> {
  if (install.source === "system") return readApprovedPackageArchive(install.digest).catch(() => fetch(systemAppArchiveUrl(install)).then(async (response) => {
    if (!response.ok) throw new Error(`${install.manifest.name} is unavailable. Reconnect and retry.`);
    const archive = await response.blob();
    await saveApprovedPackageArchive(install.digest, archive);
    return archive;
  }));
  if (install.source === "store" || install.source === "account") return readApprovedPackageArchive(install.digest);
  return readDesktopFile(install.packageEntryId);
}

import { accountStorage } from "./account-storage";

/** Returns the active approved-package archive repository. */
async function freshArchives() {
  return openFreshArchives();
}

/** Opens fresh archives. */
async function openFreshArchives() {
  const { openApprovedPackageArchives } = await import("./approved-package-archives");
  const { accountId, storageId } = accountStorage();
  return openApprovedPackageArchives(accountId, { storageId });
}

/** Saves approved package archive. */
export async function saveApprovedPackageArchive(digest: string, archive: Blob, retain?: () => Promise<void>) {
  const storage = await freshArchives();
  try { await storage.save(digest, archive, retain); } finally { storage.close(); }
}

/** Reads approved package archive. */
export async function readApprovedPackageArchive(digest: string) {
  const storage = await freshArchives();
  try { return await storage.read(digest); } finally { storage.close(); }
}

/** Removes approved package archive. */
export async function releaseApprovedPackageArchive(digest: string) {
  const storage = await freshArchives();
  try { await storage.release(digest); } finally { storage.close(); }
}

import { accountStorage } from "./account-storage";

async function freshArchives() {
  return openFreshArchives();
}

async function openFreshArchives() {
  const { openApprovedPackageArchives } = await import("./approved-package-archives");
  const { accountId, storageId } = accountStorage();
  return openApprovedPackageArchives(accountId, { storageId });
}

export async function saveApprovedPackageArchive(digest: string, archive: Blob, retain?: () => Promise<void>) {
  const storage = await freshArchives();
  try { await storage.save(digest, archive, retain); } finally { storage.close(); }
}

export async function readApprovedPackageArchive(digest: string) {
  const storage = await freshArchives();
  try { return await storage.read(digest); } finally { storage.close(); }
}

export async function releaseApprovedPackageArchive(digest: string) {
  const storage = await freshArchives();
  try { await storage.release(digest); } finally { storage.close(); }
}

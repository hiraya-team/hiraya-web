import { parseManifestV2, type HirayaAppManifestV2 } from "@hiraya-team/apps-contracts";
import { APP_PERMISSIONS } from "./permissions";
import type { SystemAppTarget } from "./types";

type InstalledAppBase = Readonly<{
  appId: string;
  digest: string;
  version: string;
  manifest: HirayaAppManifestV2;
  approvedAt: number;
}>;

export type InstalledApp = InstalledAppBase & Readonly<
  | { source: "desktop"; packageEntryId: string; archivePath: null }
  | { source: "system"; packageEntryId: null; archivePath: string }
  | { source: "account"; packageEntryId: null; archivePath: null; installationGeneration: number }
>;

export type FileAssociation = Readonly<{ matcher: string; appId: string; createdAt: number }>;

/** Matches canonical lowercase SHA-256 digests. */
const DIGEST = /^[a-f0-9]{64}$/;
/** Restricts bundled app archives to the generated system-app directory. */
const ARCHIVE_PATH = /^system-apps\/[a-z0-9-]+\.hiraya\.app$/;

/** Normalizes and validates a file extension or MIME association matcher. */
export function normalizeAssociationMatcher(value: string): string {
  const matcher = value.trim().toLowerCase();
  if (matcher.startsWith(".")) {
    if (!/^\.[a-z0-9][a-z0-9._+-]*$/.test(matcher)) throw new TypeError("File association extension is invalid.");
    return matcher;
  }
  if (!/^[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+)$/.test(matcher)) throw new TypeError("File association MIME type is invalid.");
  return matcher;
}

/** Parses persisted file-association data into its validated domain shape. */
export function parseFileAssociation(value: unknown): FileAssociation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("File association must be an object.");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !["matcher", "appId", "createdAt"].includes(key))) throw new TypeError("File association has an unsupported shape.");
  const matcher = normalizeAssociationMatcher(String(item.matcher ?? ""));
  if (typeof item.appId !== "string" || item.appId.length === 0 || item.appId.length > 160) throw new TypeError("File association app ID is invalid.");
  if (typeof item.createdAt !== "number" || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0) throw new TypeError("File association time is invalid.");
  return { matcher, appId: item.appId, createdAt: item.createdAt };
}

/** Parses persisted installed-app data and validates its source metadata. */
export function parseInstalledApp(value: unknown): InstalledApp {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Installed app must be an object.");
  const item = value as Record<string, unknown>;
  const manifest = parseManifestV2(item.manifest);
  const source = item.source;
  if (Object.keys(item).some((key) => !["appId", "source", "packageEntryId", "archivePath", "installationGeneration", "digest", "version", "manifest", "approvedAt"].includes(key))) throw new TypeError("Installed app has an unsupported shape.");
  if (item.appId !== manifest.id || item.version !== manifest.version) throw new TypeError("Installed app identity does not match its manifest.");
  if (typeof item.digest !== "string" || !DIGEST.test(item.digest)) throw new TypeError("Installed app digest is invalid.");
  if (typeof item.approvedAt !== "number" || !Number.isSafeInteger(item.approvedAt) || item.approvedAt < 0) throw new TypeError("Installed app approval time is invalid.");
  const base = { appId: manifest.id, digest: item.digest, version: manifest.version, manifest, approvedAt: item.approvedAt };
  if (source !== "account" && item.installationGeneration != null) throw new TypeError("Installed app account metadata is invalid.");
  if (source === "system") {
    if (item.packageEntryId !== null || typeof item.archivePath !== "string" || !ARCHIVE_PATH.test(item.archivePath)) throw new TypeError("Installed system app archive is invalid.");
    return { ...base, source, packageEntryId: null, archivePath: item.archivePath };
  }
  if (source === "account") {
    if (item.packageEntryId !== null || item.archivePath !== null || !Number.isSafeInteger(item.installationGeneration) || Number(item.installationGeneration) < 1) throw new TypeError("Installed account app metadata is invalid.");
    return { ...base, source, packageEntryId: null, archivePath: null, installationGeneration: Number(item.installationGeneration) };
  }
  if (source !== "desktop" || typeof item.packageEntryId !== "string" || item.packageEntryId.length === 0 || item.packageEntryId.length > 256 || item.archivePath !== null && item.archivePath !== undefined) throw new TypeError("Installed desktop app package entry ID is invalid.");
  return { ...base, source, packageEntryId: item.packageEntryId, archivePath: null };
}

/** Reports whether a desktop package still matches its approved installation. */
export function packageMatchesInstall(install: InstalledApp | undefined, packageEntryId: string, digest: string, version: string): boolean {
  return Boolean(install?.source === "desktop" && install.packageEntryId === packageEntryId && install.digest === digest && install.version === version);
}

/** Reports whether an installation matches a saved running-app identity. */
export function installedAppMatchesSavedIdentity(install: InstalledApp, saved: Pick<SystemAppTarget, "appId" | "source" | "digest" | "permissions">): boolean {
  if (install.appId !== saved.appId) return false;
  if (!saved.digest) return true;
  if (install.source === "system" && saved.source === "system") return true;
  return install.source === saved.source
    && install.digest === saved.digest
    && install.manifest.permissions.length === saved.permissions?.length
    && install.manifest.permissions.every((permission) => saved.permissions?.includes(permission));
}

/** Reports whether an installed app's package remains available. */
export function installedAppIsAvailable(install: InstalledApp, entries: readonly { id: string; kind: "file" | "folder" }[]): boolean {
  return install.source !== "desktop" || entries.some((entry) => entry.id === install.packageEntryId && entry.kind === "file");
}

/** Tests a file against a normalized extension or MIME matcher. */
export function matchingFileType(file: { name: string; mimeType: string }, matcher: string): boolean {
  const type = normalizeAssociationMatcher(matcher);
  const mimeType = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type);
  if (type.endsWith("/*")) return mimeType.startsWith(type.slice(0, -1));
  return type === mimeType;
}

/** Reports whether an installed app declares support for a file. */
export function installedAppAcceptsFile(install: InstalledApp, file: { name: string; mimeType: string }): boolean {
  return install.manifest.fileTypes?.some((value) => matchingFileType(file, value)) ?? false;
}

/** Reports whether an app can safely own an association matcher. */
export function installedAppAcceptsMatcher(install: InstalledApp, matcher: string): boolean {
  const expected = normalizeAssociationMatcher(matcher);
  return install.manifest.permissions.includes(APP_PERMISSIONS.filesRead) && Boolean(install.manifest.fileTypes?.some((value) => {
    const declared = normalizeAssociationMatcher(value);
    if (declared.startsWith(".") || expected.startsWith(".")) return declared === expected;
    if (declared === expected) return true;
    const [declaredGroup] = declared.split("/");
    const [expectedGroup] = expected.split("/");
    return declaredGroup === expectedGroup && (declared.endsWith("/*") || expected.endsWith("/*"));
  }));
}

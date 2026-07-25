import { parseManifestV1, type HirayaAppManifestV1 } from "@hiraya/apps-contracts";
import { parseJsonValue, type JsonValue } from "@hiraya/apps-contracts";
import type { SystemAppTarget } from "./types";

type InstalledAppBase = Readonly<{
  appId: string;
  digest: string;
  version: string;
  manifest: HirayaAppManifestV1;
  approvedAt: number;
}>;

export type InstalledApp = InstalledAppBase & Readonly<
  | { source: "desktop"; packageEntryId: string; archivePath: null }
  | { source: "system"; packageEntryId: null; archivePath: string }
>;

export type FileAssociation = Readonly<{ matcher: string; appId: string; createdAt: number }>;
export type QuarantinedApp = Readonly<{
  appId: string;
  packageEntryId: string;
  digest: string;
  version: string;
  manifest: JsonValue;
  approvedAt: number;
  storage: readonly Readonly<{ key: string; value: JsonValue; bytes: number }>[];
}>;

const DIGEST = /^[a-f0-9]{64}$/;
const ARCHIVE_PATH = /^system-apps\/[a-z0-9-]+\.hiraya\.app$/;

export function normalizeAssociationMatcher(value: string): string {
  const matcher = value.trim().toLowerCase();
  if (matcher.startsWith(".")) {
    if (!/^\.[a-z0-9][a-z0-9._+-]*$/.test(matcher)) throw new TypeError("File association extension is invalid.");
    return matcher;
  }
  if (!/^[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+)$/.test(matcher)) throw new TypeError("File association MIME type is invalid.");
  return matcher;
}

export function parseFileAssociation(value: unknown): FileAssociation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("File association must be an object.");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !["matcher", "appId", "createdAt"].includes(key))) throw new TypeError("File association has an unsupported shape.");
  const matcher = normalizeAssociationMatcher(String(item.matcher ?? ""));
  if (typeof item.appId !== "string" || item.appId.length === 0 || item.appId.length > 160) throw new TypeError("File association app ID is invalid.");
  if (typeof item.createdAt !== "number" || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0) throw new TypeError("File association time is invalid.");
  return { matcher, appId: item.appId, createdAt: item.createdAt };
}

export function parseQuarantinedApp(value: unknown): QuarantinedApp {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Quarantined app must be an object.");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !["appId", "packageEntryId", "digest", "version", "manifest", "approvedAt", "storage"].includes(key))) throw new TypeError("Quarantined app has an unsupported shape.");
  if (typeof item.appId !== "string" || item.appId.length === 0 || item.appId.length > 160) throw new TypeError("Quarantined app ID is invalid.");
  if (typeof item.packageEntryId !== "string" || item.packageEntryId.length === 0 || item.packageEntryId.length > 256) throw new TypeError("Quarantined package entry ID is invalid.");
  if (typeof item.digest !== "string" || !DIGEST.test(item.digest)) throw new TypeError("Quarantined app digest is invalid.");
  if (typeof item.version !== "string" || item.version.length === 0 || item.version.length > 128) throw new TypeError("Quarantined app version is invalid.");
  if (!Number.isSafeInteger(item.approvedAt) || Number(item.approvedAt) < 0 || !Array.isArray(item.storage)) throw new TypeError("Quarantined app metadata is invalid.");
  const storage = item.storage.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Quarantined app storage is invalid.");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["key", "value", "bytes"].includes(key)) || typeof row.key !== "string" || row.key.length === 0 || row.key.length > 128 || !Number.isSafeInteger(row.bytes) || Number(row.bytes) < 0) throw new TypeError("Quarantined app storage is invalid.");
    return { key: row.key, value: parseJsonValue(row.value), bytes: Number(row.bytes) };
  });
  return { appId: item.appId, packageEntryId: item.packageEntryId, digest: item.digest, version: item.version, manifest: parseJsonValue(item.manifest), approvedAt: Number(item.approvedAt), storage };
}

export function parseInstalledApp(value: unknown): InstalledApp {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Installed app must be an object.");
  const item = value as Record<string, unknown>;
  const manifest = parseManifestV1(item.manifest);
  const source = item.source ?? "desktop";
  if (Object.keys(item).some((key) => !["appId", "source", "packageEntryId", "archivePath", "digest", "version", "manifest", "approvedAt"].includes(key))) throw new TypeError("Installed app has an unsupported shape.");
  if (item.appId !== manifest.id || item.version !== manifest.version) throw new TypeError("Installed app identity does not match its manifest.");
  if (typeof item.digest !== "string" || !DIGEST.test(item.digest)) throw new TypeError("Installed app digest is invalid.");
  if (typeof item.approvedAt !== "number" || !Number.isSafeInteger(item.approvedAt) || item.approvedAt < 0) throw new TypeError("Installed app approval time is invalid.");
  const base = { appId: manifest.id, digest: item.digest, version: manifest.version, manifest, approvedAt: item.approvedAt };
  if (source === "system") {
    if (item.packageEntryId !== null || typeof item.archivePath !== "string" || !ARCHIVE_PATH.test(item.archivePath)) throw new TypeError("Installed system app archive is invalid.");
    return { ...base, source, packageEntryId: null, archivePath: item.archivePath };
  }
  if (source !== "desktop" || typeof item.packageEntryId !== "string" || item.packageEntryId.length === 0 || item.packageEntryId.length > 256 || item.archivePath !== null && item.archivePath !== undefined) throw new TypeError("Installed desktop app package entry ID is invalid.");
  return { ...base, source, packageEntryId: item.packageEntryId, archivePath: null };
}

export function packageMatchesInstall(install: InstalledApp | undefined, packageEntryId: string, digest: string, version: string): boolean {
  return Boolean(install?.source === "desktop" && install.packageEntryId === packageEntryId && install.digest === digest && install.version === version);
}

export function installedAppMatchesSavedIdentity(install: InstalledApp, saved: Pick<SystemAppTarget, "appId" | "source" | "digest" | "permissions">): boolean {
  if (install.appId !== saved.appId) return false;
  if (!saved.digest) return true;
  if (install.source === "system" && saved.source === "system") return true;
  return install.source === saved.source
    && install.digest === saved.digest
    && install.manifest.permissions.length === saved.permissions?.length
    && install.manifest.permissions.every((permission) => saved.permissions?.includes(permission));
}

export function replaceInstalledApp(current: readonly InstalledApp[], value: unknown): InstalledApp[] {
  const install = parseInstalledApp(value);
  return [...current.filter((item) => item.appId !== install.appId), install];
}

export function removeInstalledApp(current: readonly InstalledApp[], appId: string): InstalledApp[] {
  return current.filter((item) => item.appId !== appId || item.source === "system");
}

export function removeFileAssociationsForApp(current: readonly FileAssociation[], appId: string): FileAssociation[] {
  return current.filter((association) => association.appId !== appId);
}

export function installedAppIsAvailable(install: InstalledApp, entries: readonly { id: string; kind: "file" | "folder" }[]): boolean {
  return install.source === "system" || entries.some((entry) => entry.id === install.packageEntryId && entry.kind === "file");
}

export function matchingFileType(file: { name: string; mimeType: string }, matcher: string): boolean {
  const type = normalizeAssociationMatcher(matcher);
  const mimeType = file.mimeType.split(";", 1)[0].trim().toLowerCase();
  if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type);
  if (type.endsWith("/*")) return mimeType.startsWith(type.slice(0, -1));
  return type === mimeType;
}

export function installedAppAcceptsFile(install: InstalledApp, file: { name: string; mimeType: string }): boolean {
  return install.manifest.fileTypes?.some((value) => matchingFileType(file, value)) ?? false;
}

export function installedAppAcceptsMatcher(install: InstalledApp, matcher: string): boolean {
  const expected = normalizeAssociationMatcher(matcher);
  return install.manifest.permissions.includes("files:read") && Boolean(install.manifest.fileTypes?.some((value) => {
    const declared = normalizeAssociationMatcher(value);
    if (declared.startsWith(".") || expected.startsWith(".")) return declared === expected;
    if (declared === expected) return true;
    const [declaredGroup] = declared.split("/");
    const [expectedGroup] = expected.split("/");
    return declaredGroup === expectedGroup && (declared.endsWith("/*") || expected.endsWith("/*"));
  }));
}
